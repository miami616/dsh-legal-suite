/**
 * Host half route family: /api/agentlex-workspace/*.
 *
 * Provides the file operations the AgentLex workspace right sidebar needs in
 * a DSH web environment (no Tauri). The client half (dsh-file-service.ts /
 * dsh-search-client.ts) speaks this JSON envelope:
 *   { success: true, data } | { success: false, error, hint? }
 *
 * Security: every path is resolved against the caller-provided root and is
 * prevented from escaping it; bodies are treated as untrusted JSON.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { readdir, readFile, stat, writeFile, mkdir, rename, rm, copyFile, access } from 'node:fs/promises'
import { watch, type FSWatcher } from 'node:fs'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { spawn } from 'node:child_process'
import { indexFor } from './search-index.ts'

export const API_PREFIX = '/api/agentlex-workspace'

/** One row in a directory tree. */
export interface WorkspaceTreeNode {
  id: string
  name: string
  path: string
  type: 'file' | 'dir'
  children?: WorkspaceTreeNode[]
  loaded?: boolean
}

export interface WorkspaceTreeResult {
  root: string
  summary: { totalFiles: number; totalDirs: number }
  tree: WorkspaceTreeNode
  truncated: boolean
}

export interface ExpandResult {
  children: WorkspaceTreeNode[]
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

export interface SearchHit {
  path: string
  name: string
  matchCount: number
  matches: { lineNumber: number; lineContent: string; highlights: [number, number][] }[]
}

export interface SearchFolderHit {
  path: string
  name: string
}

export interface SearchResult {
  folderHits: SearchFolderHit[]
  hits: SearchHit[]
  totalFolders: number
  totalFiles: number
  queryTimeMs: number
  truncated: boolean
}

export interface CopyResult {
  success: boolean
  copiedFiles: { sourcePath: string; targetPath: string; renamed: boolean }[]
  errors: string[]
}

export interface MoveResult {
  success: boolean
  movedFiles: { oldPath: string; newPath: string }[]
  errors: string[]
}

export interface DeleteResult {
  success: boolean
  deleted: boolean
}

export interface CreateResult {
  success: boolean
  path: string
}

export interface RenameResult {
  success: boolean
  newPath: string
}

export interface GitBranchResult {
  branch: string | null
}

export interface CheckPathsResult {
  results: Record<string, { exists: boolean; type: 'file' | 'dir' }>
}

/** 目录切换弹层的目录列表（远程端也能浏览服务器文件系统）。 */
export interface PickerDirsResult {
  path: string
  name: string
  /** 上级目录；在家目录时返回 null（不再往上）。 */
  parent: string | null
  exists: boolean
  error?: string
  /** 当前目录的直接子目录名（含隐藏目录，便于进入 ~/.dsh 等）。 */
  dirs: string[]
}

interface Envelope<T> {
  success: boolean
  data?: T
  error?: string
  hint?: string
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (raw.length === 0) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function sendJson(res: ServerResponse, status: number, body: Envelope<unknown>): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function ok<T>(res: ServerResponse, data: T): void {
  sendJson(res, 200, { success: true, data })
}

function fail(res: ServerResponse, error: unknown, status = 400, hint?: string): void {
  const message = error instanceof Error ? error.message : String(error)
  sendJson(res, status, { success: false, error: message, hint })
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String).filter(Boolean) : []
}

/** Resolve a workspace-relative path against root and prevent escapes. */
function safeResolve(root: string, relative: string): string {
  const base = resolve(root)
  const target = resolve(base, relative || '.')
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error(`path escapes workspace root: ${relative}`)
  }
  return target
}

function mimeType(name: string): string {
  const ext = extname(name).toLowerCase()
  const map: Record<string, string> = {
    '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json',
    '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  }
  return map[ext] ?? 'application/octet-stream'
}

async function listChildren(absDir: string): Promise<WorkspaceTreeNode[]> {
  const entries = await readdir(absDir, { withFileTypes: true })
  const nodes: WorkspaceTreeNode[] = []
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

async function buildTree(root: string): Promise<WorkspaceTreeResult> {
  const base = resolve(root)
  const info = await stat(base)
  if (!info.isDirectory()) throw new Error(`not a directory: ${root}`)
  const children = await listChildren(base)
  const totalDirs = children.filter((c) => c.type === 'dir').length
  const totalFiles = children.filter((c) => c.type === 'file').length
  return {
    root: base,
    summary: { totalFiles, totalDirs },
    tree: {
      id: '',
      name: basename(base) || base,
      path: '',
      type: 'dir',
      children,
      loaded: true,
    },
    truncated: children.length > 1000,
  }
}

/** 目录切换弹层：列出指定绝对路径的直接子目录（空路径 → 家目录）。 */
async function listPickerDirs(requested: string): Promise<PickerDirsResult> {
  const target = requested && requested.trim() !== '' ? resolve(requested.trim()) : homedir()
  try {
    const info = await stat(target)
    if (!info.isDirectory()) {
      return {
        path: target,
        name: basename(target) || target,
        parent: dirname(target),
        exists: false,
        error: 'not a directory',
        dirs: [],
      }
    }
    const entries = await readdir(target, { withFileTypes: true })
    const dirs = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b))
    // 到达根 / 才没有上级；家目录也可以继续向上（/Users → /），否则浏览不到
    // /Volumes 下的移动硬盘等挂载卷。
    const parent = target === '/' ? null : dirname(target)
    return { path: target, name: basename(target) || target, parent, exists: true, dirs }
  } catch (error) {
    return {
      path: target,
      name: basename(target) || target,
      parent: dirname(target),
      exists: false,
      error: error instanceof Error ? error.message : String(error),
      dirs: [],
    }
  }
}

async function expandDir(root: string, dir: string): Promise<ExpandResult> {  const base = resolve(root)
  const target = safeResolve(base, dir)
  const info = await stat(target)
  if (!info.isDirectory()) throw new Error(`not a directory: ${dir}`)
  const children = await listChildren(target)
  // listChildren returns paths relative to `target`; the tree stores
  // ROOT-relative paths (buildTree's top level is root-relative). Without the
  // prefix, opening a file inside a subdirectory resolves against the
  // workspace root and fails with ENOENT.
  const prefixed = children.map((c) => ({
    ...c,
    path: c.path ? `${dir}/${c.path}` : dir,
  }))
  return { children: prefixed, loaded: true }
}

async function readPreview(root: string, file: string): Promise<PreviewResult> {
  const base = resolve(root)
  const target = safeResolve(base, file)
  let info
  try {
    info = await stat(target)
  } catch {
    // 不把原始 ENOENT 堆栈抛给前端：返回友好提示。
    throw new Error(`文件不存在或不可读：${target}`)
  }
  if (!info.isFile()) throw new Error(`not a file: ${file}`)
  const MAX = 2 * 1024 * 1024
  if (info.size > MAX) throw new Error(`file too large to preview: ${file}`)
  const content = await readFile(target, 'utf8')
  return { content, name: basename(target), size: info.size }
}

async function downloadFile(root: string, file: string): Promise<DownloadResult> {
  const base = resolve(root)
  const target = safeResolve(base, file)
  const info = await stat(target)
  if (!info.isFile()) throw new Error(`not a file: ${file}`)
  const data = await readFile(target)
  return { name: basename(target), mimeType: mimeType(basename(target)), data: data.toString('base64') }
}

async function downloadFileBytes(root: string, file: string): Promise<DownloadResult> {
  const base = resolve(root)
  const target = safeResolve(base, file)
  const info = await stat(target)
  if (!info.isFile()) throw new Error(`not a file: ${file}`)
  if (info.size > 50 * 1024 * 1024) throw new Error('file too large (max 50 MB)')
  const data = await readFile(target)
  return { name: basename(target), mimeType: mimeType(basename(target)), data: data.toString('base64') }
}

/** 按名查找时跳过的重目录（node_modules / VCS / 构建产物）。 */
const FIND_SKIP_DIRS = new Set([
  'node_modules', '.git', '.pnpm-store', 'dist', 'build', 'out',
  'target', '.next', '.cache', '.turbo', 'coverage',
])

/**
 * 会话链接「按文件名查找」：basename（如 CHANGELOG.md）拼到工作区根不存在时，
 * 在工作区下递归找同名文件。跳过 node_modules 等重目录，深度 ≤8、结果数有上限，
 * 返回绝对路径列表（浅层优先）。
 */
async function findFileByName(root: string, name: string, limit = 8): Promise<string[]> {
  const trimmed = name.trim()
  if (trimmed === '' || trimmed.includes('/') || trimmed.includes('\\')) return []
  const out: string[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 8 || out.length >= limit) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (out.length >= limit) return
      if (entry.name.startsWith('.')) continue
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (FIND_SKIP_DIRS.has(entry.name)) continue
        await walk(abs, depth + 1)
      } else if (entry.name === trimmed) {
        out.push(abs)
      }
    }
  }
  await walk(resolve(root), 0)
  return out
}

async function saveFile(
  root: string,
  path: string,
  content: string,
  expectedContent?: string,
): Promise<{ success: boolean; path: string }> {
  const base = resolve(root)
  const target = safeResolve(base, path)
  if (content.length > 2 * 1024 * 1024) throw new Error('content too large (max 2 MB)')
  if (expectedContent !== undefined) {
    let current = ''
    try {
      current = await readFile(target, 'utf8')
    } catch {
      /* new file — expectedContent compare only applies to existing files */
    }
    if (current !== expectedContent) throw new Error('File changed externally')
  }
  await writeFile(target, content, 'utf8')
  return { success: true, path: target.slice(base.length + 1) }
}

async function searchFiles(root: string, query: string): Promise<SearchResult> {
  const base = resolve(root)
  const needle = query.trim().toLowerCase()
  const started = Date.now()
  if (needle === '') {
    return { folderHits: [], hits: [], totalFolders: 0, totalFiles: 0, queryTimeMs: 0, truncated: false }
  }
  const folderHits: SearchFolderHit[] = []
  const hits: SearchHit[] = []
  let totalFolders = 0
  let totalFiles = 0
  let visited = 0
  let truncated = false
  const MAX_VISITED = 6000
  const MAX_MATCHES = 200

  const walk = async (absDir: string, relDir: string): Promise<void> => {
    if (truncated || visited >= MAX_VISITED) { truncated = true; return }
    let entries
    try {
      entries = await readdir(absDir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (truncated || visited >= MAX_VISITED) { truncated = true; return }
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      visited += 1
      const childAbs = join(absDir, entry.name)
      const childRel = relDir === '' ? entry.name : `${relDir}/${entry.name}`
      if (entry.isDirectory()) {
        totalFolders += 1
        if (entry.name.toLowerCase().includes(needle)) {
          folderHits.push({ path: childRel, name: entry.name })
          if (folderHits.length + hits.length >= MAX_MATCHES) { truncated = true; return }
        }
        await walk(childAbs, childRel)
      } else {
        totalFiles += 1
        const nameMatch = entry.name.toLowerCase().includes(needle)
        if (nameMatch || extname(entry.name).match(/\.(txt|md|json|js|mjs|cjs|ts|tsx|jsx|css|html?|ya?ml|yml|xml|csv|log|ini|conf|sh|py|java|c|cpp|h|hpp)$/i)) {
          const match: SearchHit = { path: childRel, name: entry.name, matchCount: 0, matches: [] }
          if (nameMatch) match.matchCount = 1
          if (match.matchCount === 0) {
            try {
              const info = await stat(childAbs)
              if (info.size <= 512 * 1024) {
                const text = await readFile(childAbs, 'utf8')
                const lines = text.split('\n')
                for (let i = 0; i < lines.length && match.matches.length < 10; i++) {
                  const idx = lines[i]!.toLowerCase().indexOf(needle)
                  if (idx !== -1) {
                    match.matches.push({ lineNumber: i + 1, lineContent: lines[i]!, highlights: [[idx, idx + needle.length]] })
                    match.matchCount += 1
                  }
                }
              }
            } catch {
              // unreadable binary / permission: filename match only
            }
          }
          if (nameMatch || match.matchCount > 0) {
            hits.push(match)
            if (folderHits.length + hits.length >= MAX_MATCHES) { truncated = true; return }
          }
        }
      }
    }
  }

  await walk(base, '')
  return {
    folderHits,
    hits,
    totalFolders,
    totalFiles,
    queryTimeMs: Date.now() - started,
    truncated,
  }
}

async function createFile(root: string, parentDir: string, name: string): Promise<CreateResult> {
  const base = resolve(root)
  const dir = safeResolve(base, parentDir || '.')
  const target = safeResolve(dir, name)
  if (target === dir) throw new Error('invalid file name')
  await writeFile(target, '', { flag: 'wx' })
  return { success: true, path: target.slice(base.length + 1) }
}

async function createFolder(root: string, parentDir: string, name: string): Promise<CreateResult> {
  const base = resolve(root)
  const dir = safeResolve(base, parentDir || '.')
  const target = safeResolve(dir, name)
  if (target === dir) throw new Error('invalid folder name')
  await mkdir(target, { recursive: false })
  return { success: true, path: target.slice(base.length + 1) }
}

async function renamePath(root: string, oldPath: string, newName: string): Promise<RenameResult> {
  const base = resolve(root)
  const oldAbs = safeResolve(base, oldPath)
  const parent = oldAbs.slice(0, oldAbs.lastIndexOf(sep))
  const target = safeResolve(parent, newName)
  await rename(oldAbs, target)
  return { success: true, newPath: target.slice(base.length + 1) }
}

async function deletePath(root: string, path: string): Promise<DeleteResult> {
  const base = resolve(root)
  const target = safeResolve(base, path)
  await rm(target, { recursive: true, force: true })
  return { success: true, deleted: true }
}

async function movePaths(root: string, sourcePaths: string[], targetDir: string): Promise<MoveResult> {
  const base = resolve(root)
  const dest = safeResolve(base, targetDir || '.')
  const movedFiles: MoveResult['movedFiles'] = []
  const errors: string[] = []
  for (const src of sourcePaths) {
    try {
      const from = safeResolve(base, src)
      const name = basename(from)
      let to = join(dest, name)
      let final = to
      let i = 1
      while (true) {
        try { await access(final); i += 1; final = join(dest, `${basenameWithoutExt(name)} (${i})${extname(name)}`) }
        catch { break }
      }
      await rename(from, final)
      movedFiles.push({ oldPath: src, newPath: final.slice(base.length + 1) })
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  return { success: errors.length === 0, movedFiles, errors }
}

async function copyInternal(root: string, sourcePaths: string[], targetDir: string): Promise<CopyResult> {
  const base = resolve(root)
  const dest = safeResolve(base, targetDir || '.')
  const copiedFiles: CopyResult['copiedFiles'] = []
  const errors: string[] = []
  for (const src of sourcePaths) {
    try {
      const from = safeResolve(base, src)
      const name = basename(from)
      let to = join(dest, name)
      let final = to
      let i = 1
      while (true) {
        try { await access(to); i += 1; to = join(dest, `${basenameWithoutExt(name)}-${i}${extname(name)}`) }
        catch { final = to; break }
      }
      await copyFile(from, final)
      copiedFiles.push({ sourcePath: src, targetPath: final.slice(base.length + 1), renamed: final !== join(dest, name) })
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  return { success: errors.length === 0, copiedFiles, errors }
}

async function copyPaths(root: string, sourcePaths: string[], targetDir: string, autoRename = true): Promise<CopyResult> {
  const base = resolve(root)
  const dest = safeResolve(base, targetDir || '.')
  const copiedFiles: CopyResult['copiedFiles'] = []
  const errors: string[] = []
  for (const src of sourcePaths) {
    try {
      const from = resolve(src)
      const name = basename(from)
      let to = join(dest, name)
      let final = to
      if (autoRename) {
        let i = 1
        while (true) {
          try { await access(to); i += 1; to = join(dest, `${basenameWithoutExt(name)}-${i}${extname(name)}`) }
          catch { final = to; break }
        }
      }
      await copyFile(from, final)
      copiedFiles.push({ sourcePath: src, targetPath: final.slice(base.length + 1), renamed: final !== join(dest, name) })
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  return { success: errors.length === 0, copiedFiles, errors }
}

async function importBase64(root: string, files: { name: string; content: string }[], targetDir?: string): Promise<{ success: boolean; files: string[] }> {
  const base = resolve(root)
  const dest = safeResolve(base, targetDir || '.')
  const created: string[] = []
  for (const file of files) {
    const target = safeResolve(dest, file.name)
    const buf = Buffer.from(file.content || '', 'base64')
    await writeFile(target, buf, { flag: 'wx' })
    created.push(target.slice(base.length + 1))
  }
  return { success: true, files: created }
}

async function gitBranch(root: string): Promise<GitBranchResult> {
  const base = resolve(root)
  try {
    const head = await readFile(join(base, '.git', 'HEAD'), 'utf8')
    const m = head.match(/ref: refs\/heads\/(.+)/)
    return { branch: m ? m[1]!.trim() : null }
  } catch {
    return { branch: null }
  }
}

async function checkPaths(root: string, paths: string[]): Promise<CheckPathsResult> {
  const base = resolve(root)
  const results: CheckPathsResult['results'] = {}
  for (const p of paths) {
    try {
      const target = safeResolve(base, p)
      const info = await stat(target)
      results[p] = { exists: true, type: info.isDirectory() ? 'dir' : 'file' }
    } catch {
      results[p] = { exists: false, type: 'file' }
    }
  }
  return { results }
}

function basenameWithoutExt(name: string): string {
  const ext = extname(name)
  return ext ? name.slice(0, -ext.length) : name
}

function exists(path: string): Promise<boolean> {
  return access(path).then(() => true).catch(() => false)
}

function openAbsolutePath(target: string, kind: 'finder' | 'default'): void {
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
    cmd = 'xdg-open'
    args = [target]
  }
  const child = spawn(cmd, args, { stdio: 'ignore', detached: true })
  child.on('error', (err) => console.error('[agentlex-workspace] open absolute path failed:', err))
  child.unref()
}

function openPath(root: string, file: string | undefined, kind: 'finder' | 'default'): void {
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
    cmd = 'xdg-open'
    args = [target]
  }
  const child = spawn(cmd, args, { stdio: 'ignore', detached: true })
  child.on('error', (err) => console.error('[agentlex-workspace] open path failed:', err))
  child.unref()
}

/** Register the whole route family. */
export function makeRoutes(ctx: Context & { webServer: WorkspaceWebServer }): () => void {
  const disposers: Array<() => void> = []
  function route(path: string, handler: (body: Record<string, unknown>, res: ServerResponse) => Promise<void> | void): void {
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        try {
          const body = await readBody(req)
          await handler(body, res)
        } catch (error) {
          fail(res, error)
        }
      },
    }))
  }

  // ── 目录变更监听（内核级 fs.watch，事件驱动，无轮询开销） ──
  // 每个 root 一个 watcher 单例；600ms 防抖合并批量写（构建/install 的
  // 事件风暴只推一次）；最后一个订阅者断开即关闭 watcher。
  const fsWatchers = new Map<string, {
    watcher: FSWatcher
    listeners: Set<() => void>
    timer: ReturnType<typeof setTimeout> | null
    pending: boolean
  }>()

  function watchRoot(root: string, onChange: () => void): () => void {
    let entry = fsWatchers.get(root)
    if (entry === undefined) {
      let watcher: FSWatcher
      try {
        watcher = watch(root, { persistent: false }, () => {
          const current = fsWatchers.get(root)
          if (current === undefined || current.pending) return
          current.pending = true
          current.timer = setTimeout(() => {
            const live = fsWatchers.get(root)
            if (live === undefined) return
            live.pending = false
            for (const notify of [...live.listeners]) notify()
          }, 600)
        })
        watcher.on('error', () => { /* root 消失等：保留入口，不再推送即可 */ })
      } catch {
        return () => {}
      }
      entry = { watcher, listeners: new Set(), timer: null, pending: false }
      fsWatchers.set(root, entry)
    }
    entry.listeners.add(onChange)
    return () => {
      const live = fsWatchers.get(root)
      if (live === undefined) return
      live.listeners.delete(onChange)
      if (live.listeners.size === 0) {
        live.watcher.close()
        if (live.timer !== null) clearTimeout(live.timer)
        fsWatchers.delete(root)
      }
    }
  }

  /** SSE：工作区文件变更推送（?root=<绝对路径>）。变更防抖后每批推一帧。 */
  disposers.push(ctx.webServer.register({
    kind: 'prefix',
    path: `${API_PREFIX}/fs-events`,
    handler: (req: IncomingMessage, res: ServerResponse): void => {
      try {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const root = decodeURIComponent(url.searchParams.get('root') ?? '')
        if (root === '') { res.writeHead(400); res.end(); return }
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        })
        res.write('retry: 5000\n\n')
        const disposeWatch = watchRoot(root, () => {
          try { res.write(`data: ${JSON.stringify({ root })}\n\n`) } catch { /* client gone */ }
        })
        const ping = setInterval(() => {
          try { res.write(': ping\n\n') } catch { /* client gone */ }
        }, 30_000)
        req.on('close', () => {
          disposeWatch()
          clearInterval(ping)
        })
      } catch {
        try { res.end() } catch { /* ignore */ }
      }
    },
  }))

  route(`${API_PREFIX}/health`, (_b, res) => ok(res, { ok: true, plugin: 'dsh-legal-suite/workspace-sidebar' }))
  route(`${API_PREFIX}/dirs`, async (b, res) => ok(res, await listPickerDirs(str(b.path))))
  route(`${API_PREFIX}/find-by-name`, async (b, res) => {
    const root = str(b.root)
    const matches = await findFileByName(root === '' ? process.env.HOME ?? '' : root, str(b.name))
    ok(res, { matches })
  })
  route(`${API_PREFIX}/tree`, async (b, res) => ok(res, await buildTree(str(b.root))))
  route(`${API_PREFIX}/expand`, async (b, res) => ok(res, await expandDir(str(b.root), str(b.dir))))
  route(`${API_PREFIX}/search`, async (b, res) => {
    const index = indexFor(str(b.root))
    const offset = Number.isFinite(Number(b.offset)) ? Math.max(0, Math.floor(Number(b.offset))) : 0
    const limit = Number.isFinite(Number(b.limit)) ? Math.max(1, Math.min(500, Math.floor(Number(b.limit)))) : 50
    ok(res, await index.search(str(b.query), offset, limit))
  })
  route(`${API_PREFIX}/search/refresh`, async (b, res) => ok(res, await indexFor(str(b.root)).refresh()))
  route(`${API_PREFIX}/search/invalidate`, async (b, res) => {
    indexFor(str(b.root)).invalidate()
    ok(res, { ok: true })
  })
  route(`${API_PREFIX}/read-preview`, async (b, res) => ok(res, await readPreview(str(b.root), str(b.path))))
  route(`${API_PREFIX}/download`, async (b, res) => ok(res, await downloadFile(str(b.root), str(b.path))))
  route(`${API_PREFIX}/download-bytes`, async (b, res) => ok(res, await downloadFileBytes(str(b.root), str(b.path))))
  route(`${API_PREFIX}/save`, async (b, res) => {
    const { success, path } = await saveFile(
      str(b.root),
      str(b.path),
      str(b.content),
      b.expectedContent === undefined ? undefined : str(b.expectedContent),
    )
    indexFor(str(b.root)).invalidate()
    ok(res, { success, path })
  })
  route(`${API_PREFIX}/open`, async (b, res) => {
    openPath(str(b.root), b.path === undefined ? undefined : str(b.path), b.kind === 'finder' ? 'finder' : 'default')
    ok(res, { ok: true })
  })
  // Absolute-path open outside any workspace root (localPath preview flows).
  route(`${API_PREFIX}/open-path`, async (b, res) => {
    openAbsolutePath(str(b.path), b.kind === 'finder' ? 'finder' : 'default')
    ok(res, { ok: true })
  })
  route(`${API_PREFIX}/local-preview`, async (b, res) => {
    const target = resolve(str(b.path))
    let info
    try {
      info = await stat(target)
    } catch {
      throw new Error(`文件不存在或不可读：${target}`)
    }
    if (!info.isFile()) throw new Error(`not a file: ${target}`)
    if (info.size > 2 * 1024 * 1024) throw new Error('file too large to preview (max 2 MB)')
    const content = await readFile(target, 'utf8')
    ok(res, { content, name: basename(target), size: info.size })
  })
  route(`${API_PREFIX}/local-download`, async (b, res) => {
    const target = resolve(str(b.path))
    const info = await stat(target)
    if (!info.isFile()) throw new Error(`not a file: ${target}`)
    if (info.size > 50 * 1024 * 1024) throw new Error('file too large (max 50 MB)')
    const data = await readFile(target)
    ok(res, { name: basename(target), mimeType: mimeType(basename(target)), data: data.toString('base64') })
  })
  route(`${API_PREFIX}/local-check`, async (b, res) => {
    const results: Record<string, { exists: boolean; type: 'file' | 'dir' }> = {}
    for (const p of strArray(b.paths)) {
      try {
        const info = await stat(resolve(p))
        results[p] = { exists: true, type: info.isDirectory() ? 'dir' : 'file' }
      } catch {
        results[p] = { exists: false, type: 'file' }
      }
    }
    ok(res, { results })
  })
  route(`${API_PREFIX}/create-file`, async (b, res) => {
    indexFor(str(b.root)).invalidate()
    ok(res, await createFile(str(b.root), str(b.parentDir), str(b.name)))
  })
  route(`${API_PREFIX}/create-folder`, async (b, res) => {
    indexFor(str(b.root)).invalidate()
    ok(res, await createFolder(str(b.root), str(b.parentDir), str(b.name)))
  })
  route(`${API_PREFIX}/rename`, async (b, res) => {
    indexFor(str(b.root)).invalidate()
    ok(res, await renamePath(str(b.root), str(b.oldPath), str(b.newName)))
  })
  route(`${API_PREFIX}/delete`, async (b, res) => {
    indexFor(str(b.root)).invalidate()
    ok(res, await deletePath(str(b.root), str(b.path)))
  })
  route(`${API_PREFIX}/move`, async (b, res) => {
    indexFor(str(b.root)).invalidate()
    ok(res, await movePaths(str(b.root), strArray(b.sourcePaths), str(b.targetDir)))
  })
  route(`${API_PREFIX}/copy-internal`, async (b, res) => {
    indexFor(str(b.root)).invalidate()
    ok(res, await copyInternal(str(b.root), strArray(b.sourcePaths), str(b.targetDir)))
  })
  route(`${API_PREFIX}/copy-paths`, async (b, res) => {
    indexFor(str(b.root)).invalidate()
    ok(res, await copyPaths(str(b.root), strArray(b.sourcePaths), str(b.targetDir), b.autoRename !== false))
  })
  route(`${API_PREFIX}/import-base64`, async (b, res) => {
    const files = Array.isArray(b.files) ? (b.files as unknown[]).map((f) => ({
      name: str((f as Record<string, unknown>).name),
      content: str((f as Record<string, unknown>).content),
    })) : []
    indexFor(str(b.root)).invalidate()
    ok(res, await importBase64(str(b.root), files, b.targetDir === undefined ? undefined : str(b.targetDir)))
  })
  route(`${API_PREFIX}/git-branch`, async (b, res) => ok(res, await gitBranch(str(b.root))))
  route(`${API_PREFIX}/check-paths`, async (b, res) => ok(res, await checkPaths(str(b.root), strArray(b.paths))))

  return () => { for (const dispose of disposers) dispose() }
}

/** Type augmentation for ctx.webServer used by routes. */
export interface WorkspaceWebServer {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler(req: IncomingMessage, res: ServerResponse): void | Promise<void>
  }): () => void
}

export type AppContext = Context & { webServer: WorkspaceWebServer }
