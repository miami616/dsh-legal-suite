/**
 * DSH-native case folder file service.
 *
 * The original AgentLex desktop used Tauri `cmd_workspace_*` commands to list
 * and open the bound case folder. Inside DSH web there is no Tauri runtime, so
 * the litigation host exposes equivalent HTTP routes backed by Node fs. The
 * client half calls these routes when `isTauriEnvironment()` is false.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { basename, extname, join, resolve, sep } from 'node:path'
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
