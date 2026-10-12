/**
 * 取文与写回：把 Word / PDF / 图片变成文本（本机、不联网），并把脱敏结果写回 docx。
 *
 * 依赖本机命令行工具（macOS 自带或 homebrew）：`unzip` / `zip` / `pdftotext`。
 * 扫描件（图片、无文字层 PDF）复用已有 vision-ocr 技能脚本（若已安装）。
 *
 * 说明：docx 走「unzip → 改 XML → zip」可**保留原格式**；PDF 只出脱敏文本
 * （本机没有无损改写 PDF 的可靠手段，不假装能保格式）。
 */
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import { promisify } from 'node:util'
import type { DocxPart } from './docx.ts'
import { parsePart } from './docx.ts'

const exec = promisify(execFile)

export type FileKind = 'text' | 'docx' | 'pdf' | 'image'

/** docx 内需要脱敏的 XML part（正文 + 页眉页脚 + 脚注尾注批注）。 */
const DOCX_PART_RE = /^word\/(document\.xml|header\d*\.xml|footer\d*\.xml|footnotes\.xml|endnotes\.xml|comments\.xml)$/

/** 单文件上限。 */
const MAX_BYTES = 40 * 1024 * 1024

export class UnsupportedFileError extends Error {
  constructor(path: string) {
    super(`不支持的文件类型：${basename(path)}。支持 .docx / .txt / .md / .csv / .json / .pdf / 图片（图片与扫描件走 OCR）`)
    this.name = 'UnsupportedFileError'
  }
}

export function kindOf(path: string): FileKind {
  const ext = extname(path).toLowerCase()
  if (ext === '.docx') return 'docx'
  if (ext === '.pdf') return 'pdf'
  if (['.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp', '.webp', '.heic'].includes(ext)) return 'image'
  if (['.txt', '.md', '.markdown', '.csv', '.json', '.log', '.srt', '.html', '.xml', '.yml', '.yaml'].includes(ext)) return 'text'
  throw new UnsupportedFileError(path)
}

async function which(command: string): Promise<string | undefined> {
  try {
    const { stdout } = await exec('/usr/bin/which', [command])
    const found = stdout.trim()
    return found === '' ? undefined : found
  } catch {
    return undefined
  }
}

async function requireCommand(command: string, hint: string): Promise<void> {
  if (await which(command) === undefined) {
    throw new Error(`缺少本机命令 ${command}（${hint}）`)
  }
}

/** 列 zip 条目（unzip -Z1）。 */
async function listZip(file: string): Promise<string[]> {
  const { stdout } = await exec('unzip', ['-Z1', file], { maxBuffer: 8 * 1024 * 1024 })
  return stdout.split('\n').map((line) => line.trim()).filter((line) => line !== '')
}

/** 读 zip 内单个条目（unzip -p）。 */
async function readZipEntry(file: string, entry: string): Promise<string> {
  const { stdout } = await exec('unzip', ['-p', file, entry], { maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' })
  return stdout
}

/** 解析 docx 的文本 part。 */
export async function readDocxParts(path: string): Promise<DocxPart[]> {
  await requireCommand('unzip', 'macOS 自带；缺失请 brew install unzip')
  const entries = (await listZip(path)).filter((name) => DOCX_PART_RE.test(name))
  if (entries.length === 0) throw new Error(`不是有效的 .docx（未找到 word/document.xml）：${basename(path)}`)
  const parts: DocxPart[] = []
  for (const name of entries.sort()) {
    parts.push(parsePart(name, await readZipEntry(path, name)))
  }
  return parts
}

/** 写回保格式 docx 副本：解压 → 覆盖改动过的 XML → 重新打包。 */
export async function writeDocxCopy(
  originalPath: string,
  outPath: string,
  edited: ReadonlyMap<string, string>,
): Promise<void> {
  await requireCommand('unzip', 'macOS 自带')
  await requireCommand('zip', 'macOS 自带')
  const dir = await mkdtemp(join(tmpdir(), 'agentlex-docx-'))
  try {
    await exec('unzip', ['-o', '-q', originalPath, '-d', dir], { maxBuffer: 16 * 1024 * 1024 })
    for (const [name, xml] of edited) {
      const target = join(dir, name)
      await writeFile(target, xml, 'utf8')
    }
    // -D：不写入目录条目（与原 docx 的条目集合保持一致，避免多出空目录）
    await exec('zip', ['-q', '-r', '-D', '-X', outPath, '.'], { cwd: dir, maxBuffer: 16 * 1024 * 1024 })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** vision-ocr 技能脚本（若已安装）——扫描件取文复用已有能力。 */
async function visionOcrScript(): Promise<string | undefined> {
  const home = process.env.DSH_HOME ?? join(process.env.HOME ?? '', '.dsh')
  const candidates = [
    join(home, 'skills', 'vision-ocr', 'scripts', 'vision_ocr.sh'),
    join(process.env.HOME ?? '', '.dsh', 'skills', 'vision-ocr', 'scripts', 'vision_ocr.sh'),
  ]
  for (const candidate of candidates) {
    try {
      await readFile(candidate, 'utf8')
      return candidate
    } catch { /* 继续找 */ }
  }
  return undefined
}

/** 图片 / 无文字层 PDF → 本地 OCR 取文。 */
export async function ocrToText(path: string): Promise<{ text: string; note: string }> {
  const script = await visionOcrScript()
  if (script === undefined) {
    throw new Error('扫描件需要本机 OCR：未找到 vision-ocr 技能（~/.dsh/skills/vision-ocr）。请先装该技能，或手动把文字贴进「文本」模式')
  }
  const dir = await mkdtemp(join(tmpdir(), 'agentlex-ocr-'))
  try {
    const out = join(dir, 'ocr.txt')
    await exec('bash', [script, path, out], { maxBuffer: 32 * 1024 * 1024, timeout: 300_000 })
    const text = await readFile(out, 'utf8').catch(() => '')
    if (text.trim() === '') throw new Error(`OCR 未识别出文字：${basename(path)}`)
    return { text, note: `已用本地 OCR（vision-ocr）取文：${basename(script)}` }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/** 纯文本文件直读（含二进制嗅探）。 */
export async function readPlainText(path: string): Promise<string> {
  const buffer = await readFile(path)
  if (buffer.byteLength > MAX_BYTES) throw new Error(`文件过大（> ${Math.round(MAX_BYTES / 1024 / 1024)}MB）：${basename(path)}`)
  const sniff = buffer.subarray(0, Math.min(8192, buffer.byteLength))
  if (sniff.includes(0)) {
    throw new Error(`不是纯文本（含二进制内容或为旧版 .doc）：${basename(path)}。.doc 请先用 Word 另存为 .docx`)
  }
  return buffer.toString('utf8')
}

/** PDF 取文：pdftotext -layout；无文字层时回退本地 OCR。 */
export async function readPdfText(path: string): Promise<{ text: string; note: string }> {
  await requireCommand('pdftotext', 'brew install poppler')
  const dir = await mkdtemp(join(tmpdir(), 'agentlex-pdf-'))
  try {
    const out = join(dir, 'text.txt')
    await exec('pdftotext', ['-layout', '-enc', 'UTF-8', path, out], { maxBuffer: 16 * 1024 * 1024, timeout: 120_000 })
    const text = await readFile(out, 'utf8').catch(() => '')
    if (text.trim() === '') {
      const ocr = await ocrToText(path)
      return { text: ocr.text, note: `PDF 无文字层 → ${ocr.note}` }
    }
    return { text, note: 'pdftotext 取文（有文字层）' }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

export interface ExtractedText {
  kind: FileKind
  /** 整篇纯文本（docx 为各 part 串接，段落用 \n）。 */
  text: string
  note: string
}

/** 按类型取文（docx 用 parts 版本单独处理，见 service）。 */
export async function extractText(path: string): Promise<ExtractedText> {
  const kind = kindOf(path)
  if (kind === 'text') return { kind, text: await readPlainText(path), note: '纯文本直读' }
  if (kind === 'pdf') {
    const result = await readPdfText(path)
    return { kind, text: result.text, note: result.note }
  }
  if (kind === 'image') {
    const result = await ocrToText(path)
    return { kind, text: result.text, note: result.note }
  }
  const parts = await readDocxParts(path)
  return {
    kind,
    text: parts.filter((part) => part.text.trim() !== '').map((part) => part.text).join('\n\n'),
    note: `docx 取文（${parts.length} 个文本区：正文/页眉/脚注/批注）`,
  }
}

/**
 * 输出路径：同目录下「原名 + 后缀」。
 * 后缀自带全部标记（.redacted.docx / .restored.txt），所以还原一份
 * `起诉状.redacted.docx` 会得到 `起诉状.redacted.restored.docx`，不叠字。
 */
export function outputPathFor(originalPath: string, suffix: string): string {
  const base = basename(originalPath, extname(originalPath))
  return join(dirname(originalPath), `${base}${suffix}`)
}

/** 默认脱敏文本输出：<原名>.redacted.txt。 */
export function redactedOutPath(originalPath: string, ext: string): string {
  return outputPathFor(originalPath, `.redacted${ext}`)
}

/** 目录里是否存在可处理的文件（批量用）。 */
export async function listProcessable(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const out: string[] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const full = join(dir, entry.name)
    try { kindOf(full); out.push(full) } catch { /* 忽略不支持的类型 */ }
  }
  return out.sort()
}
