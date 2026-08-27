/**
 * DSH workspace file service — drop-in replacement for the original
 * `@/hooks/useWorkspaceFileService` used by the ported DirectoryPanel.
 *
 * All operations are backed by the host route family
 * `/api/agentlex-workspace/*` registered by this plugin's host half.
 */
import { useCallback, useMemo } from 'react'

interface Envelope<T> {
  success: boolean
  data?: T
  error?: string
  hint?: string
}

function base64ToUint8(data: string): Uint8Array {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function call<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  })
  let envelope: Envelope<T>
  try {
    envelope = await response.json() as Envelope<T>
  } catch {
    throw new Error(`host returned non-JSON (${response.status})`)
  }
  if (!envelope.success) throw new Error(envelope.error ?? `request failed (${response.status})`)
  return envelope.data as T
}

export interface DshTreeNode {
  id: string
  name: string
  path: string
  type: 'file' | 'dir'
  children?: DshTreeNode[]
  loaded?: boolean
}

export interface DshTreeResult {
  root: string
  summary: { totalFiles: number; totalDirs: number }
  tree: DshTreeNode
  truncated: boolean
}

export interface DshExpandResult {
  children: DshTreeNode[]
  loaded: boolean
}

export interface DshPreviewResult {
  content: string
  name: string
  size: number
}

export interface DshDownloadResult {
  name: string
  mimeType: string
  data: string
}

export interface DshCopyResult {
  success: boolean
  copiedFiles: { sourcePath: string; targetPath: string; renamed: boolean }[]
  errors: string[]
}

export interface DshMoveResult {
  success: boolean
  movedFiles: { oldPath: string; newPath: string }[]
  errors: string[]
}

export interface DshDeleteResult {
  success: boolean
  deleted: boolean
}

export interface DshCreateResult {
  success: boolean
  path: string
}

export interface DshRenameResult {
  success: boolean
  newPath: string
}

export interface DshGitBranchResult {
  branch: string | null
}

export interface DshCheckPathsResult {
  results: Record<string, { exists: boolean; type: 'file' | 'dir' }>
}

/** The subset of the original WorkspaceFileService that DirectoryPanel uses. */
export interface DshWorkspaceFileService {
  isAvailable: boolean
  workspacePath: string | null
  dirTree(): Promise<DshTreeResult>
  dirExpand(args: { path: string }): Promise<DshExpandResult>
  readPreview(args: { path: string }): Promise<DshPreviewResult>
  downloadFile(args: { path: string }): Promise<DshDownloadResult>
  importBase64Files(args: { files: { name: string; content: string }[]; targetDir?: string }): Promise<{ success: boolean; files: string[] }>
  copyPaths(args: { sourcePaths: string[]; targetDir: string; autoRename?: boolean }): Promise<DshCopyResult>
  copyInternal(args: { sourcePaths: string[]; targetDir: string }): Promise<DshCopyResult>
  movePaths(args: { sourcePaths: string[]; targetDir: string }): Promise<DshMoveResult>
  newFile(args: { parentDir: string; name: string }): Promise<DshCreateResult>
  newFolder(args: { parentDir: string; name: string }): Promise<DshCreateResult>
  rename(args: { oldPath: string; newName: string }): Promise<DshRenameResult>
  deleteFile(args: { path: string; permanent?: boolean }): Promise<DshDeleteResult>
  openInFinder(args: { path: string }): Promise<void>
  openWithDefault(args: { path: string }): Promise<void>
  gitBranch(): Promise<DshGitBranchResult>
  checkPaths(args: { paths: string[] }): Promise<DshCheckPathsResult>
  /** Autosave (FilePreviewModal): write content, conflict-checked. */
  saveFile(args: { path: string; content: string; expectedContent?: string }): Promise<{ success: boolean; path: string }>
  /** Raw bytes for rich-doc viewers (decoded ArrayBuffer, mirrors original service). */
  downloadFileBytes(args: { path: string }): Promise<ArrayBuffer>
  /** Image / markdown-relative-image: base64 → Blob object URL (+revoke). */
  readFileAsBlobUrl(args: { path: string }): Promise<{ blobUrl: string; revoke(): void }>
  revokeBlobUrl(url: string): void
  /** Absolute-path preview outside the workspace root (e.g. ~/.myagents files). */
  readLocalPreview(args: { fullPath: string; workspace?: string | null }): Promise<{ content: string; name: string; size: number }>
  downloadLocalFile(args: { fullPath: string; workspace?: string | null }): Promise<{ name: string; mimeType: string; data: string }>
  downloadLocalFileBytes(args: { fullPath: string; workspace?: string | null }): Promise<ArrayBuffer>
  checkLocalPaths(args: { paths: string[]; workspace?: string | null }): Promise<{ results: Record<string, { exists: boolean; type: 'file' | 'dir' }> }>
  openPathExternal(args: { fullPath: string; workspace?: string | null }): Promise<void>
  openPathWithDefault(args: { fullPath: string; workspace?: string | null }): Promise<void>
}

/**
 * Hook name is intentionally `useWorkspaceFileService` — this module replaces
 * the original via tsconfig/tsdown alias.
 */
export function useWorkspaceFileService(workspacePath: string | null): DshWorkspaceFileService {
  const root = workspacePath?.trim() || null

  const requireRoot = useCallback((): string => {
    if (!root) throw new Error('请先选择工作区')
    return root
  }, [root])

  const dirTree = useCallback(async () => {
    return call<DshTreeResult>('/api/agentlex-workspace/tree', { root: requireRoot() })
  }, [requireRoot])

  const dirExpand = useCallback(async ({ path }: { path: string }) => {
    return call<DshExpandResult>('/api/agentlex-workspace/expand', { root: requireRoot(), dir: path })
  }, [requireRoot])

  const readPreview = useCallback(async ({ path }: { path: string }) => {
    return call<DshPreviewResult>('/api/agentlex-workspace/read-preview', { root: requireRoot(), path })
  }, [requireRoot])

  const downloadFile = useCallback(async ({ path }: { path: string }) => {
    return call<DshDownloadResult>('/api/agentlex-workspace/download', { root: requireRoot(), path })
  }, [requireRoot])

  const importBase64Files = useCallback(async ({ files, targetDir }: { files: { name: string; content: string }[]; targetDir?: string }) => {
    return call<{ success: boolean; files: string[] }>('/api/agentlex-workspace/import-base64', {
      root: requireRoot(),
      files,
      ...(targetDir === undefined ? {} : { targetDir }),
    })
  }, [requireRoot])

  const copyPaths = useCallback(async ({ sourcePaths, targetDir, autoRename }: { sourcePaths: string[]; targetDir: string; autoRename?: boolean }) => {
    return call<DshCopyResult>('/api/agentlex-workspace/copy-paths', {
      root: requireRoot(),
      sourcePaths,
      targetDir,
      autoRename: autoRename ?? true,
    })
  }, [requireRoot])

  const copyInternal = useCallback(async ({ sourcePaths, targetDir }: { sourcePaths: string[]; targetDir: string }) => {
    return call<DshCopyResult>('/api/agentlex-workspace/copy-internal', { root: requireRoot(), sourcePaths, targetDir })
  }, [requireRoot])

  const movePaths = useCallback(async ({ sourcePaths, targetDir }: { sourcePaths: string[]; targetDir: string }) => {
    return call<DshMoveResult>('/api/agentlex-workspace/move', { root: requireRoot(), sourcePaths, targetDir })
  }, [requireRoot])

  const newFile = useCallback(async ({ parentDir, name }: { parentDir: string; name: string }) => {
    return call<DshCreateResult>('/api/agentlex-workspace/create-file', { root: requireRoot(), parentDir, name })
  }, [requireRoot])

  const newFolder = useCallback(async ({ parentDir, name }: { parentDir: string; name: string }) => {
    return call<DshCreateResult>('/api/agentlex-workspace/create-folder', { root: requireRoot(), parentDir, name })
  }, [requireRoot])

  const rename = useCallback(async ({ oldPath, newName }: { oldPath: string; newName: string }) => {
    return call<DshRenameResult>('/api/agentlex-workspace/rename', { root: requireRoot(), oldPath, newName })
  }, [requireRoot])

  const deleteFile = useCallback(async ({ path }: { path: string }) => {
    return call<DshDeleteResult>('/api/agentlex-workspace/delete', { root: requireRoot(), path })
  }, [requireRoot])

  const openInFinder = useCallback(async ({ path }: { path: string }) => {
    await call<{ ok: boolean }>('/api/agentlex-workspace/open', { root: requireRoot(), path: path || undefined, kind: 'finder' })
  }, [requireRoot])

  const openWithDefault = useCallback(async ({ path }: { path: string }) => {
    await call<{ ok: boolean }>('/api/agentlex-workspace/open', { root: requireRoot(), path: path || undefined, kind: 'default' })
  }, [requireRoot])

  const gitBranch = useCallback(async () => {
    return call<DshGitBranchResult>('/api/agentlex-workspace/git-branch', { root: requireRoot() })
  }, [requireRoot])

  const checkPaths = useCallback(async ({ paths }: { paths: string[] }) => {
    return call<DshCheckPathsResult>('/api/agentlex-workspace/check-paths', { root: requireRoot(), paths })
  }, [requireRoot])

  const saveFile = useCallback(async ({ path, content, expectedContent }: { path: string; content: string; expectedContent?: string }) => {
    return call<{ success: boolean; path: string }>('/api/agentlex-workspace/save', {
      root: requireRoot(),
      path,
      content,
      ...(expectedContent === undefined ? {} : { expectedContent }),
    })
  }, [requireRoot])

  const downloadFileBytes = useCallback(async ({ path }: { path: string }): Promise<ArrayBuffer> => {
    const file = await call<{ name: string; mimeType: string; data: string }>('/api/agentlex-workspace/download-bytes', {
      root: requireRoot(),
      path,
    })
    return base64ToUint8(file.data).buffer as ArrayBuffer
  }, [requireRoot])

  const readFileAsBlobUrl = useCallback(async ({ path }: { path: string }): Promise<{ blobUrl: string; revoke(): void }> => {
    const file = await call<{ name: string; mimeType: string; data: string }>('/api/agentlex-workspace/download', {
      root: requireRoot(),
      path,
    })
    const bytes = base64ToUint8(file.data)
    const blobUrl = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: file.mimeType }))
    return {
      blobUrl,
      revoke: (): void => {
        if (blobUrl.startsWith('blob:')) URL.revokeObjectURL(blobUrl)
      },
    }
  }, [requireRoot])

  const readLocalPreview = useCallback(async ({ fullPath }: { fullPath: string }) => {
    return call<{ content: string; name: string; size: number }>('/api/agentlex-workspace/local-preview', { path: fullPath })
  }, [])

  const downloadLocalFile = useCallback(async ({ fullPath }: { fullPath: string }) => {
    return call<{ name: string; mimeType: string; data: string }>('/api/agentlex-workspace/local-download', { path: fullPath })
  }, [])

  const downloadLocalFileBytes = useCallback(async ({ fullPath }: { fullPath: string }): Promise<ArrayBuffer> => {
    const file = await call<{ name: string; mimeType: string; data: string }>('/api/agentlex-workspace/local-download', { path: fullPath })
    return base64ToUint8(file.data).buffer as ArrayBuffer
  }, [])

  const checkLocalPaths = useCallback(async ({ paths }: { paths: string[] }) => {
    return call<{ results: Record<string, { exists: boolean; type: 'file' | 'dir' }> }>('/api/agentlex-workspace/local-check', { paths })
  }, [])

  const openPathExternal = useCallback(async ({ fullPath }: { fullPath: string }) => {
    await call('/api/agentlex-workspace/open-path', { path: fullPath, kind: 'default' })
  }, [])

  const openPathWithDefault = openPathExternal

  const revokeBlobUrl = useCallback((url: string): void => {
    if (url.startsWith('blob:')) URL.revokeObjectURL(url)
  }, [])

  return useMemo(() => ({
    isAvailable: root !== null,
    workspacePath: root,
    dirTree,
    dirExpand,
    readPreview,
    downloadFile,
    importBase64Files,
    copyPaths,
    copyInternal,
    movePaths,
    newFile,
    newFolder,
    rename,
    deleteFile,
    openInFinder,
    openWithDefault,
    gitBranch,
    checkPaths,
    saveFile,
    downloadFileBytes,
    readFileAsBlobUrl,
    revokeBlobUrl,
    readLocalPreview,
    downloadLocalFile,
    downloadLocalFileBytes,
    checkLocalPaths,
    openPathExternal,
    openPathWithDefault,
  }), [root, dirTree, dirExpand, readPreview, downloadFile, importBase64Files, copyPaths, copyInternal, movePaths, newFile, newFolder, rename, deleteFile, openInFinder, openWithDefault, gitBranch, checkPaths, saveFile, downloadFileBytes, readFileAsBlobUrl, revokeBlobUrl, readLocalPreview, downloadLocalFile, downloadLocalFileBytes, checkLocalPaths, openPathExternal, openPathWithDefault])
}
