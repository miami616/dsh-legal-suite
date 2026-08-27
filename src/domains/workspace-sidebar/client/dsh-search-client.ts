/**
 * DSH search client — drop-in replacement for `@/api/searchClient`.
 *
 * The original Tauri search engine is replaced by the host route
 * `/api/agentlex-workspace/search`.
 */

export interface FileMatchLine {
  lineNumber: number
  lineContent: string
  highlights: [number, number][]
}

export interface FileSearchHit {
  path: string
  name: string
  matchCount: number
  matches: FileMatchLine[]
}

export interface FolderSearchHit {
  path: string
  name: string
}

export interface FileSearchResult {
  folderHits: FolderSearchHit[]
  hits: FileSearchHit[]
  totalFolders: number
  totalFiles: number
  queryTimeMs: number
}

interface Envelope<T> {
  success: boolean
  data?: T
  error?: string
}

async function call<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  })
  const envelope = await response.json() as Envelope<T>
  if (!envelope.success) throw new Error(envelope.error ?? `request failed (${response.status})`)
  return envelope.data as T
}

export async function searchWorkspaceFiles(
  query: string,
  workspace: string,
  _limit = 50,
  _maxMatchesPerFile = 10,
): Promise<FileSearchResult> {
  if (!query.trim()) {
    return { folderHits: [], hits: [], totalFolders: 0, totalFiles: 0, queryTimeMs: 0 }
  }
  return call<FileSearchResult>('/api/agentlex-workspace/search', { root: workspace, query })
}

export async function refreshWorkspaceFileIndex(_workspace: string): Promise<[number, number]> {
  // The DSH host search is stateless; a refresh is a no-op.
  return [0, 0]
}

export async function invalidateWorkspaceFileIndex(_workspace: string): Promise<void> {
  // no-op
}
