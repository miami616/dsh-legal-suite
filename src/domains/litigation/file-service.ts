/**
 * DSH-native case folder file service.
 *
 * The original AgentLex desktop used Tauri `cmd_workspace_*` commands to list
 * and open the bound case folder. Inside DSH web there is no Tauri runtime, so
 * the litigation host exposes equivalent HTTP routes backed by Node fs. The
 * client half calls these routes when `isTauriEnvironment()` is false.
 */

import { readdir, readFile, stat, writeFile, mkdir } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'

export interface FolderTreeNode {
  id: string
  name: string
  path: string
  type: 'file' | 'dir'
  children?: FolderTreeNode[]
  loaded?: boolean
}

export interface FolderTreeResult {
  root: string
  summary: { totalFiles: number; totalDirs: number }
  tree: FolderTreeNode
  truncated: boolean
}

export interface ExpandDirectoryResult {
  children: FolderTreeNode[]
  loaded: boolean
}

export interface PreviewResult {
  content: string
  name: string
  size: number
}

export interface DownloadResult {
  name: string
  mimeType: string
  data: string
}

export interface FolderSearchResult {
  /** Relative paths (from the folder root) of matching FILES, dirs excluded. */
  matches: string[]
  truncated: boolean
}

const MAX_PREVIEW_BYTES = 2 * 1024 * 1024
const MAX_TREE_ENTRIES = 500
const MAX_SEARCH_MATCHES = 200
const MAX_SEARCH_VISITED = 4000

function safeResolve(root: string, relative: string): string {
  const base = resolve(root)
  const target = resolve(base, relative || '.')
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error(`path escapes folder root: ${relative}`)
  }
  return target
}

function mimeType(name: string): string {
  const ext = extname(name).toLowerCase()
  const map: Record<string, string> = {
    '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json',
    '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
    '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  }
  return map[ext] ?? 'application/octet-stream'
}

async function listChildren(absDir: string): Promise<FolderTreeNode[]> {
  const entries = await readdir(absDir, { withFileTypes: true })
  const nodes: FolderTreeNode[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const abs = join(absDir, entry.name)
    const rel = abs.slice(resolve(absDir).length + 1)
    const isDir = entry.isDirectory()
    nodes.push({
      id: rel,
      name: entry.name,
      path: rel,
      type: isDir ? 'dir' : 'file',
      children: isDir ? [] : undefined,
      loaded: isDir ? false : undefined,
    })
  }
  nodes.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))
  return nodes
}

export async function buildFolderTree(root: string): Promise<FolderTreeResult> {
  const base = resolve(root)
  const info = await stat(base)
  if (!info.isDirectory()) throw new Error(`not a directory: ${root}`)

  const children = await listChildren(base)
  const totalDirs = children.filter((c) => c.type === 'dir').length
  const totalFiles = children.filter((c) => c.type === 'file').length
  const truncated = children.length > MAX_TREE_ENTRIES
  const limited = truncated ? children.slice(0, MAX_TREE_ENTRIES) : children

  return {
    root: base,
    summary: { totalFiles, totalDirs },
    tree: {
      id: '',
      name: basename(base) || base,
      path: '',
      type: 'dir',
      children: limited,
      loaded: true,
    },
    truncated,
  }
}

export async function expandFolder(root: string, dir: string): Promise<ExpandDirectoryResult> {
  const base = resolve(root)
  const target = safeResolve(base, dir)
  const info = await stat(target)
  if (!info.isDirectory()) throw new Error(`not a directory: ${dir}`)
  const children = await listChildren(target)
  return { children, loaded: true }
}

/**
 * Budgeted recursive name search over a case folder (mirrors the native
 * file tab's search box). Hidden entries are skipped; directories are never
 * returned as matches (they cannot be opened by the editor). The walk is
 * bounded so a huge folder can never stall the route.
 */
export async function searchFolder(root: string, query: string): Promise<FolderSearchResult> {
  const base = resolve(root)
  const needle = query.trim().toLowerCase()
  if (needle === '') return { matches: [], truncated: false }
  const matches: string[] = []
  let visited = 0
  let truncated = false

  const walk = async (absDir: string, relDir: string): Promise<void> => {
    if (truncated || visited >= MAX_SEARCH_VISITED) {
      truncated = true
      return
    }
    let entries
    try {
      entries = await readdir(absDir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (truncated || visited >= MAX_SEARCH_VISITED) {
        truncated = true
        return
      }
      if (entry.name.startsWith('.')) continue
      visited += 1
      const childAbs = join(absDir, entry.name)
      const childRel = relDir === '' ? entry.name : `${relDir}/${entry.name}`
      if (entry.isDirectory()) {
        await walk(childAbs, childRel)
      } else if (entry.name.toLowerCase().includes(needle)) {
        matches.push(childRel)
        if (matches.length >= MAX_SEARCH_MATCHES) {
          truncated = true
          return
        }
      }
    }
  }

  await walk(base, '')
  return { matches, truncated }
}

export async function readPreviewFile(root: string, file: string): Promise<PreviewResult> {
  const base = resolve(root)
  const target = safeResolve(base, file)
  const info = await stat(target)
  if (!info.isFile()) throw new Error(`not a file: ${file}`)
  if (info.size > MAX_PREVIEW_BYTES) throw new Error(`file too large to preview: ${file}`)
  const content = await readFile(target, 'utf8')
  return { content, name: basename(target), size: info.size }
}

export async function downloadFile(root: string, file: string): Promise<DownloadResult> {
  const base = resolve(root)
  const target = safeResolve(base, file)
  const info = await stat(target)
  if (!info.isFile()) throw new Error(`not a file: ${file}`)
  const data = await readFile(target)
  return {
    name: basename(target),
    mimeType: mimeType(basename(target)),
    data: data.toString('base64'),
  }
}

export interface WriteFileResult {
  name: string
  size: number
  ok: true
}

/**
 * Write UTF-8 text into a file under the folder root (create/overwrite).
 * Parent directories are created on demand so a nested target never fails
 * just because its dir doesn't exist yet. The path is confined to the folder
 * root (same safeResolve guard as every other folder operation).
 */
export async function writeTextFile(root: string, file: string, content: string): Promise<WriteFileResult> {
  const base = resolve(root)
  const target = safeResolve(base, file)
  if (target === base) throw new Error('cannot write the folder root')
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, content, 'utf8')
  return { name: basename(target), size: Buffer.byteLength(content, 'utf8'), ok: true }
}

/* --------------------------------------------------- 案件信息记忆文件 */

/** 记忆文件候选名（备忘录 #13）：用户卷宗里「案件信息.md」「案卷信息.md」两种叫法都存在，都认。 */
export const CASE_INFO_FILE_CANDIDATES = ['案件信息.md', '案卷信息.md'] as const
/** 新建时统一使用的文件名。 */
export const CASE_INFO_DEFAULT_FILE = '案件信息.md'

export interface CaseInfoResult {
  /** 命中的记忆文件名（相对 folder 根）；null = 尚未创建。 */
  name: string | null
  /** 记忆文件内容（不存在时为空串）。 */
  content: string
  /** 磁盘上实际用了哪个候选名（多候选都存在时取第一个）。 */
  matched?: string
}

/**
 * 读取案件记忆文件：遍历候选名取第一个存在的；都不存在返回 name:null
 * （不自动创建——由 case_info ensure 语义决定何时建）。
 */
export async function readCaseInfoFile(root: string): Promise<CaseInfoResult> {
  const base = resolve(root)
  for (const candidate of CASE_INFO_FILE_CANDIDATES) {
    try {
      const target = safeResolve(base, candidate)
      const content = await readFile(target, 'utf8')
      return { name: candidate, content, matched: candidate }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      // 存在但读失败（目录/权限等）——如实抛出，不做静默降级。
      throw error
    }
  }
  return { name: null, content: '' }
}

/**
 * 确保案件记忆文件存在：没有就按规范模板建一个；有就原样返回内容。
 * 模板只放「确定性可回填」的基本字段占位（编号/名称/案由/状态等），
 * 缺的信息由管家按案情补全，不编造。
 */
export async function ensureCaseInfoFile(root: string, seed: {
  caseId?: string; caseName?: string; type?: string; cause?: string;
  statusLabel?: string; level?: string; caseNumber?: string; court?: string;
}): Promise<CaseInfoResult & { created: boolean }> {
  const base = resolve(root)
  const existing = await readCaseInfoFile(base)
  if (existing.name !== null) return { ...existing, created: false }
  const name = CASE_INFO_DEFAULT_FILE
  const lines = [
    `# 案件信息 — ${seed.caseId ?? ''} ${seed.caseName ?? ''}`.trimEnd(),
    '',
    '## 基本信息',
    '',
    '| 字段 | 内容 |',
    '|------|------|',
    `| 案件编号 | ${seed.caseId ?? ''} |`,
    `| 案件名称 | ${seed.caseName ?? ''} |`,
    `| 案件类型 | ${seed.type ?? ''} |`,
    `| 案由 | ${seed.cause ?? ''} |`,
    `| 案件状态 | ${seed.statusLabel ?? ''} |`,
    `| 审级 | ${seed.level ?? ''} |`,
    `| 案号 | ${seed.caseNumber ?? ''} |`,
    `| 审理法院 | ${seed.court ?? ''} |`,
    '',
    '## 当事人',
    '',
    '（待补全：角色 | 名称 | 我方/对方 | 备注）',
    '',
    '## 案情概要',
    '',
    '（待补全：争议由来、我方立场、核心诉求）',
    '',
    '## 关键日期',
    '',
    '（待补全：开庭 / 举证期限 / 上诉期等，含日期与来源）',
    '',
  ]
  await writeTextFile(base, name, lines.join('\n'))
  return { name, content: lines.join('\n'), created: true }
}

export function openPath(root: string, file: string | undefined, kind: 'finder' | 'default'): void {
  const base = resolve(root)
  const target = file === undefined || file === '' ? base : safeResolve(base, file)
  const platform = process.platform
  let cmd: string
  let args: string[]
  if (platform === 'darwin') {
    cmd = 'open'
    args = kind === 'finder' ? ['-R', target] : [target]
  } else if (platform === 'win32') {
    cmd = 'explorer'
    args = kind === 'finder' ? [`/select,${target}`] : [target]
  } else {
    cmd = kind === 'finder' ? 'xdg-open' : 'xdg-open'
    args = [target]
  }
  const child = spawn(cmd, args, { stdio: 'ignore', detached: true })
  child.on('error', (err) => {
    console.error('[agentlex-case] open path failed:', err)
  })
  child.unref()
}
