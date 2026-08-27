/**
 * Shared DSH session bridge for AgentLex business modules.
 *
 * Turns the original renderer's "open a case/project session" callbacks into
 * real DSH sessions:
 *   1. ensure the module workspace exists (data directory as DSH workspace)
 *   2. create a session with the module's agent preset
 *   3. optionally rename it and seed an initial prompt
 *   4. select it in the DSH UI so the user lands in the conversation
 *   5. return the session id so the caller can bind it to a case/project
 *
 * The client runtime exposes `connection.api` (IApiClient) and `sessions`
 * (sessions manager). This module is bundled into each plugin client; it does
 * not depend on any one plugin's store.
 */

interface RpcResultLike<T = unknown> {
  ok?: boolean
  value?: T
}

interface RpcResponseLike<T = unknown> {
  result?: RpcResultLike<T>
}

interface SessionCreateResult {
  sessionId?: string
  agentPreset?: string
}

interface WorkspaceCreateResult {
  workspace?: { workspaceId?: string }
  created?: boolean
}

interface SessionApiLike {
  create(payload: { workspaceId?: string; cwd?: string; sessionId?: string; agentPreset?: string }): Promise<RpcResponseLike<SessionCreateResult>>
  rename(payload: { sessionId: string; title: string }): Promise<RpcResponseLike<{ title?: string }>>
  prompt(payload: {
    sessionId: string
    mode: 'queue' | 'steer'
    content: Array<{ type: 'text'; text: string }>
  }): Promise<RpcResponseLike<{ accepted?: boolean }>>
}

interface WorkspaceApiLike {
  create(payload: { path: string }): Promise<RpcResponseLike<WorkspaceCreateResult>>
  rename(payload: { workspaceId: string; title: string }): Promise<RpcResponseLike<{ workspace?: { workspaceId?: string } }>>
  list(payload: Record<string, never>): Promise<RpcResponseLike<{ archivedSessionIds?: string[] }>>
}

interface ConnectionLike {
  api?: {
    sessions?: SessionApiLike
    workspace?: WorkspaceApiLike
  }
}

interface SessionsManagerLike {
  open(sessionId: string): void
  /** The useSessions list feed — used to wait for a freshly created session to
   *  appear before open() (open throws on unknown ids). */
  list?: {
    getSnapshot(): { byId?: Record<string, unknown>; ids?: string[] }
    subscribe?(listener: () => void): () => void
  }
}

/** Minimal client context: a cordis-like `get(name)` service resolver. */
export interface SessionBridgeContext {
  get<T>(name: string): T | undefined
}

export interface CreateBusinessSessionOptions {
  /** Agent preset id, e.g. 'litigation-manager' / 'nonlitigation-manager'. */
  agentPreset: string
  /** Absolute directory used as the DSH workspace (e.g. plugin dataDir). */
  workspacePath: string
  /** Display title for the session, e.g. `案件: xxx`. */
  title: string
  /** Chinese display name for the DSH workspace, e.g. `诉讼管家`. */
  workspaceTitle?: string
  /** Optional first message to seed the conversation. */
  context?: string
}

function unwrap<T>(response: RpcResponseLike<T> | undefined): T | undefined {
  if (response?.result?.ok === true) return response.result.value
  return undefined
}

/**
 * Create (or idempotently resolve) a DSH workspace for the module data
 * directory. Returns the workspace id, or undefined when unavailable.
 */
export async function ensureWorkspace(
  ctx: SessionBridgeContext,
  path: string,
): Promise<string | undefined> {
  const connection = ctx.get<ConnectionLike>('connection')
  const workspaceApi = connection?.api?.workspace
  if (!workspaceApi) return undefined
  try {
    const response = await workspaceApi.create({ path })
    return unwrap(response)?.workspace?.workspaceId
  } catch (error) {
    console.warn('[agentlex-session-bridge] workspace.create failed:', error)
    return undefined
  }
}

/**
 * Open a DSH session for a business module.
 *
 * - Ensures a workspace over the module data directory (falls back to `cwd`).
 * - Creates a new session with the given agent preset.
 * - Renames it, seeds an optional initial prompt, and selects it in the UI.
 * - Returns the new session id (or undefined on failure).
 */
/**
 * Open an existing DSH session (jump to a previously bound conversation).
 * @returns true when the sessions manager accepted the open.
 */
export function openExistingSession(
  ctx: SessionBridgeContext,
  sessionId: string,
): boolean {
  const sessions = ctx.get<SessionsManagerLike>('sessions')
  if (!sessions) return false
  sessions.open(sessionId)
  return true
}

/**
 * Wait for a freshly created session to appear in the sessions list feed,
 * then select it. `sessions.open` throws on unknown ids, and a just-created
 * session may not be in the client's list snapshot yet (the list refreshes
 * asynchronously after the create RPC). Polling the list feed (with a
 * subscribe fallback) closes that gap so the UI reliably jumps to the new
 * session.
 * @returns true when the session was selected; false when it never appeared.
 */
async function openWhenListed(
  sessions: SessionsManagerLike,
  sessionId: string,
): Promise<boolean> {
  const list = sessions.list
  const listed = (): boolean => {
    const snap = list?.getSnapshot()
    if (snap?.byId && snap.byId[sessionId]) return true
    if (snap?.ids && snap.ids.includes(sessionId)) return true
    return false
  }
  if (listed()) {
    sessions.open(sessionId)
    return true
  }
  // 列表尚未包含新会话：轮询等待（最多 ~5s），期间若订阅可用则优先订阅。
  const DEADLINE = Date.now() + 5000
  const wait = (): Promise<boolean> => new Promise((resolve) => {
    let done = false
    const finish = (ok: boolean): void => {
      if (done) return
      done = true
      resolve(ok)
    }
    const unsub = list?.subscribe?.(() => {
      if (listed()) {
        unsub?.()
        finish(true)
      }
    })
    const timer = window.setInterval(() => {
      if (listed()) {
        window.clearInterval(timer)
        unsub?.()
        finish(true)
      } else if (Date.now() > DEADLINE) {
        window.clearInterval(timer)
        unsub?.()
        finish(false)
      }
    }, 100)
  })
  const ok = await wait()
  if (ok) {
    sessions.open(sessionId)
    return true
  }
  // 超时兜底：会话可能已在列表但快照未刷新，仍尝试 open（失败静默）。
  try {
    sessions.open(sessionId)
    return true
  } catch {
    return false
  }
}

/**
 * Fetch the DSH workspace archive set — session ids hidden from every
 * grouping surface (the web shell's 归档会话 action). Bound sessions in this
 * set must not be offered as "historical sessions" nor auto-reused.
 * @returns the archived session ids; empty set when the API is unavailable.
 */
export async function fetchArchivedSessionIds(ctx: SessionBridgeContext): Promise<Set<string>> {
  const connection = ctx.get<ConnectionLike>('connection')
  const workspaceApi = connection?.api?.workspace
  if (!workspaceApi?.list) return new Set()
  try {
    const response = await workspaceApi.list({})
    const value = unwrap<{ archivedSessionIds?: string[] }>(response)
    return new Set(value?.archivedSessionIds ?? [])
  } catch (error) {
    console.warn('[agentlex-session-bridge] workspace.list failed:', error)
    return new Set()
  }
}

export async function createBusinessSession(
  ctx: SessionBridgeContext,
  options: CreateBusinessSessionOptions,
): Promise<string | undefined> {
  const connection = ctx.get<ConnectionLike>('connection')
  const sessions = ctx.get<SessionsManagerLike>('sessions')
  const api = connection?.api
  if (!api?.sessions || !sessions) {
    console.warn('[agentlex-session-bridge] connection/sessions unavailable')
    return undefined
  }

  // 1. Create/ensure the module workspace, then give it a Chinese display name.
  const workspaceId = await ensureWorkspace(ctx, options.workspacePath)
  if (workspaceId && options.workspaceTitle) {
    try {
      await api.workspace?.rename({ workspaceId, title: options.workspaceTitle })
    } catch (error) {
      console.warn('[agentlex-session-bridge] workspace.rename failed:', error)
    }
  }

  // 2. Create the session with the module's agent preset.
  const createPayload: { workspaceId?: string; cwd?: string; agentPreset: string } = {
    agentPreset: options.agentPreset,
  }
  if (workspaceId) createPayload.workspaceId = workspaceId
  else createPayload.cwd = options.workspacePath

  let sessionId: string | undefined
  try {
    const createResponse = await api.sessions.create(createPayload)
    sessionId = unwrap(createResponse)?.sessionId
  } catch (error) {
    console.warn('[agentlex-session-bridge] session.create failed:', error)
    return undefined
  }
  if (!sessionId) {
    console.warn('[agentlex-session-bridge] session.create returned no sessionId')
    return undefined
  }

  // 3. Rename for a human-readable title.
  try {
    await api.sessions.rename({ sessionId, title: options.title })
  } catch (error) {
    console.warn('[agentlex-session-bridge] rename failed:', error)
  }

  // 4. Seed the first prompt (best-effort).
  if (options.context && options.context.trim() !== '') {
    try {
      await api.sessions.prompt({
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: options.context }],
      })
    } catch (error) {
      console.warn('[agentlex-session-bridge] seeding prompt failed:', error)
    }
  }

  // 5. Switch the DSH UI to this session. Wait for the session to appear in
  //    the list first (open throws on unknown ids; a just-created session may
  //    not be in the client's list snapshot yet).
  await openWhenListed(sessions, sessionId)
  return sessionId
}
