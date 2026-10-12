/**
 * 脱敏域文件 I/O：读文本（拒绝二进制）、写脱敏副本（原件绝不动）。
 *
 * 引擎只吃文本：扫描件/PDF/docx 一律先走既有 OCR/取文链路（vision-ocr、
 * pdftotext），本模块不承担文档解析。
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'

/** 单文件上限（防止把整本卷宗目录误传给引擎）。 */
const MAX_BYTES = 20 * 1024 * 1024
/** 二进制嗅探窗口。 */
const SNIFF_BYTES = 8192

export class BinaryFileError extends Error {
  constructor(path: string) {
    super(`不是纯文本文件（含二进制内容或为扫描件/PDF/docx）：${path}。请先用 OCR/取文链路转成文本再脱敏`)
    this.name = 'BinaryFileError'
  }
}

/** 读文本文件；二进制（含 NUL 字节）或超限时抛错。 */
export async function readTextFile(path: string): Promise<string> {
  const buffer = await readFile(path)
  if (buffer.byteLength > MAX_BYTES) {
    throw new Error(`文件过大（${Math.round(buffer.byteLength / 1024 / 1024)}MB 超过 20MB）：${path}`)
  }
  const sniff = buffer.subarray(0, Math.min(SNIFF_BYTES, buffer.byteLength))
  if (sniff.includes(0)) throw new BinaryFileError(path)
  return buffer.toString('utf8')
}

/** 默认输出路径：同目录 `<name>.redacted<ext>`。 */
export function defaultOutPath(originalPath: string): string {
  const ext = extname(originalPath)
  const name = basename(originalPath, ext)
  return join(dirname(originalPath), `${name}.redacted${ext}`)
}

/** 写脱敏副本（不改原文件），返回实际写入路径。 */
export async function writeRedactedCopy(
  originalPath: string,
  text: string,
  outPath?: string,
): Promise<string> {
  const target = outPath !== undefined && outPath.trim() !== '' ? outPath : defaultOutPath(originalPath)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, text, 'utf8')
  return target
}
