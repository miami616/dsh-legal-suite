/**
 * DSH-native case folder file service.
 *
 * The original AgentLex desktop used Tauri `cmd_workspace_*` commands. Inside
 * DSH web there is no Tauri runtime, so this hook calls the adapter's
 * `/api/agentlex/folder-*` / `/api/agentlex/file-*` / `/api/agentlex/open-path`
 * routes, which are backed by Node fs on the DSH host.
 */

import { useCallback, useMemo } from 'react';

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: string;
}

async function call<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const envelope = await response.json() as Envelope<T>;
  if (!envelope.success) throw new Error(envelope.error ?? `request failed (${response.status})`);
  return envelope.data as T;
}

export interface DshFolderTreeNode {
  id: string;
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: DshFolderTreeNode[];
  loaded?: boolean;
}

export interface DshFolderTreeResult {
  root: string;
  summary: { totalFiles: number; totalDirs: number };
  tree: DshFolderTreeNode;
  truncated: boolean;
}

export interface DshExpandDirectoryResult {
  children: DshFolderTreeNode[];
  loaded: boolean;
}

export interface DshPreviewResult {
  content: string;
  name: string;
  size: number;
}

export interface DshDownloadResult {
  name: string;
  mimeType: string;
  data: string;
}

export interface DshFileService {
  isAvailable: boolean;
  workspacePath: string | null;
  dirTree(): Promise<DshFolderTreeResult>;
  dirExpand(args: { path: string }): Promise<DshExpandDirectoryResult>;
  readPreview(args: { path: string }): Promise<DshPreviewResult>;
  downloadFile(args: { path: string }): Promise<DshDownloadResult>;
  openWithDefault(args: { path: string }): Promise<void>;
  openInFinder(args: { path: string }): Promise<void>;
}

export function useDshFileService(workspacePath: string | null): DshFileService {
  const root = workspacePath?.trim() || null;

  const dirTree = useCallback(async () => {
    if (!root) throw new Error('请先选择工作区');
    return call<DshFolderTreeResult>('/api/agentlex/folder-tree', { path: root });
  }, [root]);

  const dirExpand = useCallback(async ({ path }: { path: string }) => {
    if (!root) throw new Error('请先选择工作区');
    return call<DshExpandDirectoryResult>('/api/agentlex/folder-expand', { path: root, dir: path });
  }, [root]);

  const readPreview = useCallback(async ({ path }: { path: string }) => {
    if (!root) throw new Error('请先选择工作区');
    return call<DshPreviewResult>('/api/agentlex/file-preview', { path: root, file: path });
  }, [root]);

  const downloadFile = useCallback(async ({ path }: { path: string }) => {
    if (!root) throw new Error('请先选择工作区');
    return call<DshDownloadResult>('/api/agentlex/file-download', { path: root, file: path });
  }, [root]);

  const openWithDefault = useCallback(async ({ path }: { path: string }) => {
    if (!root) throw new Error('请先选择工作区');
    await call<{ ok: boolean }>('/api/agentlex/open-path', { path: root, file: path || undefined, kind: 'default' });
  }, [root]);

  const openInFinder = useCallback(async ({ path }: { path: string }) => {
    if (!root) throw new Error('请先选择工作区');
    await call<{ ok: boolean }>('/api/agentlex/open-path', { path: root, file: path || undefined, kind: 'finder' });
  }, [root]);

  return useMemo(() => ({
    isAvailable: root !== null,
    workspacePath: root,
    dirTree,
    dirExpand,
    readPreview,
    downloadFile,
    openWithDefault,
    openInFinder,
  }), [root, dirTree, dirExpand, readPreview, downloadFile, openWithDefault, openInFinder]);
}
