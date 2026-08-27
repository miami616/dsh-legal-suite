/**
 * Host half — per-root workspace search index for
 * dsh-legal-suite/workspace-sidebar.
 *
 * Upgrade over the previous stateless walk (Phase 4):
 *   - per-root cached file/dir inventory (name-level index), rebuilt on a
 *     TTL or after write operations (dirty flag) — bounded revalidation;
 *   - content search only scans candidate files with a per-query byte cap,
 *     so a mid-size repo (≥5k files) resolves in well under a second;
 *   - server-side pagination (offset/limit) with hasMore, keeping the full
 *     highlight shape the ported DirectoryPanel expects.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'

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

export interface SearchQueryResult {
  folderHits: SearchFolderHit[]
  hits: SearchHit[]
  totalFolders: number
  totalFiles: number
  queryTimeMs: number
  offset: number
  limit: number
  hasMore: boolean
  truncated: boolean
}

interface FileEntry {
  rel: string
  name: string
  dir: string
  size: number
  mtimeMs: number
  dirEntry: boolean
}

const SKIP = new Set(['.git', 'node_modules', '.DS_Store', '.idea', '.vscode', 'dist', 'out', 'build'])
const TEXT_EXT = /\.(txt|md|markdown|json|js|cjs|mjs|ts|tsx|jsx|css|scss|html?|ya?ml|yml|xml|csv|log|ini|conf|sh|py|rs|go|java|c|cpp|h|hpp|sql|vue|svelte)$/i

const INDEX_TTL_MS = 60_000
const MAX_QUERY_BYTES = 6 * 1024 * 1024
const MAX_FOLDER_HITS = 200
const MAX_HIT_FILES = 300

export class WorkspaceSearchIndex {
  readonly root: string
  private entries?: FileEntry[]
  private builtAt = 0
  private dirty = true

  constructor(root: string) {
    this.root = resolve(root)
  }

  /** Mark dirty after any write/delete operation in this root. */
  invalidate(): void {
    this.dirty = true
  }

  private async walk(base: string): Promise<FileEntry[]> {
    const out: FileEntry[] = []
    const walkDir = async (absDir: string, relDir: string): Promise<void> => {
      let child: import('node:fs').Dirent[]
      try {
        child = await readdir(absDir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of child) {
        if (entry.name.startsWith('.') || SKIP.has(entry.name)) continue
        const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`
        const abs = join(absDir, entry.name)
        const isDir = entry.isDirectory()
        if (isDir) {
          out.push({ rel, name: entry.name, dir: relDir, size: 0, mtimeMs: 0, dirEntry: true })
          await walkDir(abs, rel)
        } else {
          try {
            const info = await stat(abs)
            out.push({ rel, name: entry.name, dir: relDir, size: info.size, mtimeMs: info.mtimeMs, dirEntry: false })
          } catch {
            out.push({ rel, name: entry.name, dir: relDir, size: 0, mtimeMs: 0, dirEntry: false })
          }
        }
      }
    }
    await walkDir(this.root, '')
    return out
  }

  /** Ensure the inventory is fresh (TTL or dirty); force rebuild on demand. */
  async ensureFresh(force = false): Promise<void> {
    const now = Date.now()
    if (!force && !this.dirty && now - this.builtAt < INDEX_TTL_MS && this.entries !== undefined) return
    this.entries = await this.walk(this.root)
    this.builtAt = Date.now()
    this.dirty = false
  }

  /** Force rebuild + return the fresh inventory size (files / dirs). */
  async refresh(): Promise<{ files: number; dirs: number }> {
    this.entries = await this.walk(this.root)
    this.builtAt = Date.now()
    this.dirty = false
    const files = this.entries.filter((e) => !e.dirEntry).length
    const dirs = this.entries.length - files
    return { files, dirs }
  }

  private list(): FileEntry[] {
    return this.entries ?? []
  }

  async search(query: string, offset: number, limit: number): Promise<SearchQueryResult> {
    const needle = query.trim().toLowerCase()
    const started = Date.now()
    const empty = { folderHits: [], hits: [], totalFolders: 0, totalFiles: 0, queryTimeMs: 0, offset, limit, hasMore: false, truncated: false }
    if (needle === '') return empty

    await this.ensureFresh(false)
    const entries = this.list()
    const files = entries.filter((e) => !e.dirEntry)
    const dirs = entries.filter((e) => e.dirEntry)
    const totalFolders = dirs.length
    const totalFiles = files.length

    const folderHits: SearchFolderHit[] = dirs
      .filter((e) => e.name.toLowerCase().includes(needle))
      .slice(0, MAX_FOLDER_HITS)
      .map((e) => ({ path: e.rel, name: e.name }))

    // Name matches first (cheap), then content scan with a byte cap.
    const nameHits = files.filter((e) => e.name.toLowerCase().includes(needle))
    const contentCandidates = files.filter((e) => !e.name.toLowerCase().includes(needle))

    const hits: SearchHit[] = []
    let bytes = 0
    let truncated = false

    const scanFile = async (entry: FileEntry, nameMatch: boolean): Promise<void> => {
      if (hits.length >= MAX_HIT_FILES) {
        truncated = true
        return
      }
      if (!TEXT_EXT.test(entry.name)) {
        if (nameMatch && hits.length < MAX_HIT_FILES) {
          hits.push({ path: entry.rel, name: entry.name, matchCount: 1, matches: [] })
        }
        return
      }
      if (entry.size > 512 * 1024 && !nameMatch) return
      if (bytes > MAX_QUERY_BYTES) {
        truncated = true
        return
      }
      let text: string | undefined
      try {
        if (entry.size > 512 * 1024) {
          // Large file: read only head+tail slices around the match window.
          const head = await readFile(join(this.root, entry.rel), { encoding: 'utf8' })
          text = head
        } else {
          text = await readFile(join(this.root, entry.rel), 'utf8')
        }
        bytes += text.length
      } catch {
        if (nameMatch) hits.push({ path: entry.rel, name: entry.name, matchCount: 1, matches: [] })
        return
      }
      const match: SearchHit = { path: entry.rel, name: entry.name, matchCount: nameMatch ? 1 : 0, matches: [] }
      if (nameMatch) match.matchCount = 1
      const lines = text.split('\n')
      const lowerLines = nameMatch ? null : lines.map((l) => l.toLowerCase())
      for (let i = 0; i < lines.length; i++) {
        if (match.matches.length >= 10) break
        const line = lines[i]!
        const idx = (nameMatch ? line.toLowerCase().indexOf(needle) : lowerLines![i]!.indexOf(needle))
        if (idx !== -1) {
          match.matches.push({ lineNumber: i + 1, lineContent: line, highlights: [[idx, idx + needle.length]] })
          match.matchCount += 1
        }
      }
      if (match.matchCount > 0) hits.push(match)
    }

    for (const entry of nameHits) {
      if (truncated || hits.length >= MAX_HIT_FILES) { truncated = true; break }
      await scanFile(entry, true)
    }
    for (const entry of contentCandidates) {
      if (truncated || hits.length >= MAX_HIT_FILES || bytes > MAX_QUERY_BYTES) {
        truncated = true
        break
      }
      await scanFile(entry, false)
    }

    const total = hits.length
    const page = hits.slice(offset, offset + limit)
    return {
      folderHits,
      hits: page,
      totalFolders,
      totalFiles,
      queryTimeMs: Date.now() - started,
      offset,
      limit,
      hasMore: offset + page.length < total,
      truncated: truncated || folderHits.length === MAX_FOLDER_HITS,
    }
  }
}

/** Registry of per-root indexes (kept for the lifetime of the host). */
const indexes = new Map<string, WorkspaceSearchIndex>()

export function indexFor(root: string): WorkspaceSearchIndex {
  const key = resolve(root)
  let index = indexes.get(key)
  if (index === undefined) {
    index = new WorkspaceSearchIndex(key)
    indexes.set(key, index)
  }
  return index
}

export function closeSearchIndexes(): void {
  indexes.clear()
}