/**
 * dsh-legal-suite/file-download — host half.
 *
 * 「会话文件 → 下载到本机」的服务端通道。
 *
 * 背景：Harness 的交付文件卡片（present 工具产出的 deliverables 卡片）
 * 原有动作只有「用某个应用打开 / 在文件夹中显示」——两者都由宿主所在
 * 机器执行。远程登录（浏览器在另一台设备上）时，这两个动作都落在服务端
 * 机器上，用户拿不到文件。本域补一个纯下载通道：按会话事件坐标
 * （sessionId / seq / index）在服务端校验并读出原始字节，以
 * `Content-Disposition: attachment` 交给浏览器，由浏览器保存到
 * **当前客户端设备**的下载目录——这正是远程场景需要的语义。
 *
 * 路由：
 *   GET /api/agentlex-download/presented?sessionId&seq&index
 *   GET /api/agentlex-download/changed?sessionId&seq&index
 *
 * 读取走 `workspaceFiles` 服务（与 Harness 自己的文件读取同一套权限与
 * 沙箱口径），按 512 KiB 分块流式写出，避免把大文件整体读进内存。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'

export const name = 'dsh-legal-suite/file-download'

/** Services required before the download routes can mount. */
export const inject = ['webServer']

/** Presented-file card coordinates (the `present` tool's deliverables event). */
const PRESENTED_PATH = '/api/agentlex-download/presented'
/** Changed-file card coordinates (the workspace/changes event). */
const CHANGED_PATH = '/api/agentlex-download/changed'

/** One streamed chunk; stays well under `workspaceFiles`' per-range byte cap. */
const CHUNK_BYTES = 512 * 1024

/** Minimal structural view of the session-query service we need. */
interface SessionQueryLike {
  readEvent(
    request: { sessionId: string; seq: number; before: number; after: number },
    signal?: AbortSignal,
  ): Promise<{
    session: { cwd?: string }
    target: { type: string; data?: unknown }
  }>
}

/** Minimal structural view of the workspace-files service we need. */
interface WorkspaceFilesLike {
  stat(
    scope: { sessionId: string; workspaceRoot: string },
    path: string,
    signal?: AbortSignal,
  ): Promise<{ absolutePath: string; bytes?: number }>
  readBytes(
    scope: { sessionId: string; workspaceRoot: string },
    path: string,
    options: { range?: { offset: number; length: number } },
    signal?: AbortSignal,
  ): Promise<{ data: Uint8Array; eof: boolean }>
}

/** Minimal structural view of the changed-files summary service. */
interface WorkspaceChangesLike {
  summary(
    sessionId: string,
    seq: number,
  ): { cwd: string; files: Array<{ path: string }> } | undefined
}

/** One declared file inside a deliverables/presented event. */
interface PresentedFile {
  path?: unknown
}

/** The deliverables/presented event payload subset we read. */
interface PresentedData {
  files?: unknown
}

interface Coordinates {
  sessionId: string
  seq: number
  index: number
}

function fail(res: ServerResponse, status: number, message: string): void {
  if (res.headersSent) {
    res.destroy()
    return
}

  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify({ success: false, error: message }))
}

/** Parse one non-negative safe integer query parameter. */
function intParam(search: URLSearchParams, name: string): number | undefined {
  const raw = search.get(name)
  if (raw === null || !/^\d+$/.test(raw)) return undefined
  const value = Number(raw)
  return Number.isSafeInteger(value) ? value : undefined
}

/** Read the three coordinates every download route shares. */
function coordinates(search: URLSearchParams): Coordinates | undefined {
  const sessionId = search.get('sessionId')
  const seq = intParam(search, 'seq')
  const index = intParam(search, 'index')
  if (sessionId === null || sessionId === '' || seq === undefined || index === undefined) return undefined
  return { sessionId, seq, index }
}

/** Best-effort MIME type by extension; documents download fine as octet-stream. */
function mimeType(name: string): string {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase()
  const map: Record<string, string> = {
    '.txt': 'text/plain; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.csv': 'text/csv; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.zip': 'application/zip',
    '.rar': 'application/vnd.rar',
    '.7z': 'application/x-7z-compressed',
    '.dmg': 'application/x-apple-diskimage',
    '.pkg': 'application/vnd.apple.installer+xml',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.mp4': 'video/mp4',
  }
  return map[ext] ?? 'application/octet-stream'
}

/** RFC 6266 / RFC 5987 attachment header that survives non-ASCII file names. */
function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

/** Basename that works for POSIX and Windows paths alike. */
function basename(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const slash = normalized.lastIndexOf('/')
  return slash === -1 ? normalized : normalized.slice(slash + 1)
}

/** True when the error names a missing/unreadable target rather than a server fault. */
function isNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const code = (error as { code?: unknown }).code
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'SESSION_QUERY_SESSION_NOT_FOUND' ||
    code === 'SESSION_QUERY_EVENT_NOT_FOUND' || code === 'workspace-file/not-found' ||
    code === 'workspace-file/not-regular-file'
}

/**
 * Stream one verified path to the browser as an attachment.
 *
 * @param res - HTTP response being written.
 * @param files - workspace-files service used for stat and byte ranges.
 * @param scope - session identity plus workspace root for relative resolution.
 * @param path - absolute or workspace-relative file path from the session event.
 * @param signal - request cancellation.
 */
async function streamFile(
  res: ServerResponse,
  files: WorkspaceFilesLike,
  scope: { sessionId: string; workspaceRoot: string },
  path: string,
  signal: AbortSignal,
): Promise<void> {
  const info = await files.stat(scope, path, signal)
  const name = basename(info.absolutePath) || basename(path) || 'download'
  const headers: Record<string, string> = {
    'content-type': mimeType(name),
    'content-disposition': contentDisposition(name),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  }
  if (info.bytes !== undefined) headers['content-length'] = String(info.bytes)
  res.writeHead(200, headers)

  let offset = 0
  for (;;) {
    signal.throwIfAborted()
    const chunk = await files.readBytes(scope, path, { range: { offset, length: CHUNK_BYTES } }, signal)
    if (chunk.data.byteLength === 0) break
    res.write(Buffer.from(chunk.data))
    offset += chunk.data.byteLength
    if (chunk.eof) break
  }
  res.end()
}

/**
 * Resolve the declared file path of one deliverables/presented event.
 *
 * @param query - session-query service.
 * @param coords - event coordinates from the request.
 * @param signal - request cancellation.
 * @returns the path plus the workspace root to resolve it against, or undefined when absent.
 */
async function presentedTarget(
  query: SessionQueryLike,
  coords: Coordinates,
  signal: AbortSignal,
): Promise<{ path: string; workspaceRoot: string } | undefined> {
  const read = await query.readEvent(
    { sessionId: coords.sessionId, seq: coords.seq, before: 0, after: 0 },
    signal,
  )
  if (read.target.type !== 'deliverables/presented') return undefined
  const data = read.target.data as PresentedData | undefined
  if (data === undefined || !Array.isArray(data.files)) return undefined
  const file = data.files[coords.index] as PresentedFile | undefined
  if (file === undefined || typeof file.path !== 'string' || file.path.trim() === '') return undefined
  return {
    path: file.path,
    workspaceRoot: read.session.cwd ?? process.cwd(),
  }
}

/**
 * Handle one download request and answer with the raw file bytes.
 *
 * @param ctx - host context used to resolve the lazily available services.
 * @param req - incoming HTTP request.
 * @param res - HTTP response being written.
 * @param changed - read changed-file coordinates instead of presented-file ones.
 */
async function handle(ctx: Context, req: IncomingMessage, res: ServerResponse, changed: boolean): Promise<void> {
  // Long files over a slow remote link should not be cut off at the default
  // fetch budget; a stale request still expires eventually.
  const signal = AbortSignal.timeout(60 * 60_000)
  const url = new URL(req.url ?? '/', 'http://localhost')
  const coords = coordinates(url.searchParams)
  if (coords === undefined) {
    fail(res, 400, 'sessionId、seq、index 三个参数缺一不可')
    return
  }

  const files = ctx.get('workspaceFiles') as unknown as WorkspaceFilesLike | undefined
  if (files === undefined) {
    fail(res, 501, '当前宿主没有文件读取服务（workspaceFiles），无法下载')
    return
  }

  try {
    let path: string | undefined
    let workspaceRoot = process.cwd()
    if (changed) {
      const changes = ctx.get('workspaceChanges') as unknown as WorkspaceChangesLike | undefined
      const summary = changes?.summary(coords.sessionId, coords.seq)
      if (summary === undefined) {
        fail(res, 404, '找不到这条改动记录的会话事件（可能已过期）')
        return
      }
      const file = summary.files[coords.index]
      if (file === undefined) {
        fail(res, 404, '这条改动记录里没有该文件')
        return
      }
      path = file.path
      workspaceRoot = summary.cwd
    } else {
      const query = ctx.get('sessionQuery') as unknown as SessionQueryLike | undefined
      if (query === undefined) {
        fail(res, 501, '当前宿主没有会话查询服务（sessionQuery），无法下载')
        return
      }
      const target = await presentedTarget(query, coords, signal)
      if (target === undefined) {
        fail(res, 404, '找不到该会话事件里声明的文件')
        return
      }
      path = target.path
      workspaceRoot = target.workspaceRoot
    }

    await streamFile(res, files, { sessionId: coords.sessionId, workspaceRoot }, path, signal)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    fail(res, isNotFound(error) ? 404 : 500, `下载失败：${message}`)
  }
}

/**
 * Register the download routes inside the host web server.
 *
 * @param ctx - host context (webServer injected).
 * @returns disposer removing both routes.
 */
export function apply(ctx: Context): void {
  const disposers: Array<() => void> = []
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: PRESENTED_PATH,
    handler: (req: IncomingMessage, res: ServerResponse) => {
      void handle(ctx, req, res, false)
    },
  }))
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: CHANGED_PATH,
    handler: (req: IncomingMessage, res: ServerResponse) => {
      void handle(ctx, req, res, true)
    },
  }))
  ctx.effect(() => () => {
    for (const dispose of disposers.splice(0)) dispose()
  }, 'dsh-legal-suite/file-download: routes')
}
