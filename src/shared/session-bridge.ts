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
 * Harness contract note: >= v0.1.2-alpha.1 removed the old
 * `connection.api.sessions/workspace` (IApiClient) namespaces. RPC calls now
 * go through the typert-gateway `remote` namespace (`ctx.get('remote')`,
 * RemoteResult { ok, value }); seeding uses the session face
 * (`sessions.binding(id)?.session.prompt`); the archived-session set rides
 * the `workspaces.list` snapshot.
 */

interface RpcResultLike<T = unknown> {
  ok?: boolean
  value?: T
  error?: { code?: string; message?: string }
}

interface SessionCreateResult {
  sessionId?: string
  agentPreset?: string
}

interface WorkspaceCreateResult {
  workspace?: { workspaceId?: string }
  created?: boolean
}

/** typert-gateway remote sessions namespace. */
interface SessionRemoteLike {
  create(payload: { workspaceId?: string; cwd?: string; sessionId?: string; agentPreset?: string }): Promise<RpcResultLike<SessionCreateResult>>
  rename(payload: { sessionId: string; title: string }): Promise<RpcResultLike<{ title?: string }>>
}

/** typert-gateway remote workspaces namespace. */
interface WorkspaceRemoteLike {
  create(payload: { path: string }): Promise<RpcResultLike<WorkspaceCreateResult>>
  rename(payload: { workspaceId: string; title: string }): Promise<RpcResultLike<{ workspace?: { workspaceId?: string } }>>
}

/** The `remote` gateway namespaces the bridge depends on. */
interface RemoteLike {
  session?: SessionRemoteLike
  workspace?: WorkspaceRemoteLike
}

/** SessionFace prompt (no request id required at this level). */
interface SessionFaceLike {
  prompt(content: Array<{ type: 'text'; text: string }>, mode: 'queue' | 'steer'): Promise<unknown>
}

interface SessionBindingLike {
  session?: SessionFaceLike
}

interface SessionsManagerLike {
  open(sessionId: string): void
  /** The useSessions list feed — used to wait for a freshly created session to
   *  appear before open() (open throws on unknown ids). */
  list?: {
    getSnapshot(): { byId?: Record<string, unknown>; ids?: string[] }
    subscribe?(listener: () => void): () => void
  }
  /** Resolve a stable session binding (its `.session` face seeds prompts). */
  binding?(sessionId: string): SessionBindingLike | undefined
}

/** The workspaces service snapshot (archived session set). */
interface WorkspacesServiceLike {
  list?: {
    getSnapshot(): { archivedSessionIds?: string[] }
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

function unwrap<T>(response: RpcResultLike<T> | undefined): T | undefined {
  if (response?.ok === true) return response.value
  return undefined
}

/**
 * Resolve a cordis service by name, root-first.
 *
 * gateway `remote`（及严格代理类服务）要求访问者 ctx 的注入表显式声明
 * （"cannot get property ... without inject"），而子 fiber 的 `export const
 * inject` 在打包合并后不一定被 cordis 读取。cordis 根 ctx 无注入限制，从
 * `ctx.root` 解析可绕开该检查，也兼容已注入的 fiber。
 */
function serviceOf<T>(ctx: SessionBridgeContext, name: string): T | undefined {
  const anyCtx = ctx as unknown as { root?: unknown }
  const candidates: unknown[] = [anyCtx.root, ctx]
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue
    const getter = (candidate as { get?: (n: string) => unknown }).get
    if (typeof getter !== 'function') continue
    try {
      const value = getter.call(candidate, name)
      if (value !== undefined) return value as T
    } catch {
      /* 该 ctx 不可解析时试下一个 */
    }
  }
  return undefined
}

/**
 * Resolve the typert-gateway `remote` client, root-first (see {@link serviceOf}).
 */
function remoteOf(ctx: SessionBridgeContext): RemoteLike | undefined {
  const root = (ctx as unknown as { root?: unknown }).root ?? ctx
  const anyRoot = root as { remote?: RemoteLike; get?: (n: string) => unknown }
  try {
    if (anyRoot.remote !== undefined) return anyRoot.remote
  } catch {
    /* fall through to get() */
  }
  return serviceOf<RemoteLike>(ctx, 'remote')
}

/**
 * Create (or idempotently resolve) a DSH workspace for the module data
 * directory. Returns the workspace id, or undefined when unavailable.
 */
export async function ensureWorkspace(
  ctx: SessionBridgeContext,
  path: string,
): Promise<string | undefined> {
  const workspace = remoteOf(ctx)?.workspace
  if (!workspace?.create) return undefined
  try {
    const response = await workspace.create({ path })
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
  const sessions = serviceOf<SessionsManagerLike>(ctx, 'sessions')
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
  try {
    const workspaces = serviceOf<WorkspacesServiceLike>(ctx, 'workspaces')
    const snapshot = workspaces?.list?.getSnapshot()
    if (Array.isArray(snapshot?.archivedSessionIds)) {
      return new Set(snapshot.archivedSessionIds)
    }
  } catch (error) {
    console.warn('[agentlex-session-bridge] workspaces.list snapshot failed:', error)
  }
  return new Set()
}

export async function createBusinessSession(
  ctx: SessionBridgeContext,
  options: CreateBusinessSessionOptions,
): Promise<string | undefined> {
  const remote = remoteOf(ctx)
  const sessions = serviceOf<SessionsManagerLike>(ctx, 'sessions')
  if (!sessions) {
    console.warn('[agentlex-session-bridge] sessions unavailable')
    return undefined
  }

  // 1. Create/ensure the module workspace, then give it a Chinese display name
  //    (best-effort — remote 不可用时降级为 cwd 会话）。
  const workspaceId = await ensureWorkspace(ctx, options.workspacePath)
  if (workspaceId && options.workspaceTitle && remote?.workspace?.rename) {
    try {
      await remote.workspace.rename({ workspaceId, title: options.workspaceTitle })
    } catch (error) {
      console.warn('[agentlex-session-bridge] workspace.rename failed:', error)
    }
  }

  // 2. Create the session. 优先 remote.session.create（带 agentPreset）；
  //    0.1.2-alpha.1 的 gateway remote 子命名空间受限（without inject）时
  //    降级到 ctx.sessions.create（无 preset，但保证会话可建、按钮可用）。
  let sessionId: string | undefined
  if (remote?.session?.create) {
    const createPayload: { workspaceId?: string; cwd?: string; agentPreset: string } = {
      agentPreset: options.agentPreset,
    }
    if (workspaceId) createPayload.workspaceId = workspaceId
    else createPayload.cwd = options.workspacePath
    try {
      const createResponse = await remote.session.create(createPayload)
      sessionId = unwrap(createResponse)?.sessionId
    } catch (error) {
      console.warn('[agentlex-session-bridge] remote.session.create failed, falling back:', error)
      sessionId = undefined
    }
  }
  if (sessionId === undefined) {
    try {
      const sessionsCreate = sessions as unknown as {
        create?(o: { workspaceId?: string; cwd?: string }): Promise<string>
      }
      sessionId = await sessionsCreate.create?.({
        ...(workspaceId !== undefined ? { workspaceId } : { cwd: options.workspacePath }),
      })
    } catch (error) {
      console.warn('[agentlex-session-bridge] sessions.create fallback failed:', error)
      return undefined
    }
  }
  if (!sessionId) {
    console.warn('[agentlex-session-bridge] no session id from create')
    return undefined
  }

  // 3. Rename for a human-readable title (best-effort).
  try {
    if (remote?.session?.rename) {
      await remote.session.rename({ sessionId, title: options.title })
    } else {
      const face = sessions.binding?.(sessionId)?.session as unknown as
        | { rename?(p: { title: string }): Promise<unknown> }
        | undefined
      if (face?.rename) await face.rename({ title: options.title })
    }
  } catch (error) {
    console.warn('[agentlex-session-bridge] rename failed:', error)
  }

  // 4. Seed the first prompt (best-effort) through the session face.
  if (options.context && options.context.trim() !== '') {
    try {
      const face = sessions.binding?.(sessionId)?.session
      if (face !== undefined) {
        await face.prompt([{ type: 'text', text: options.context }], 'queue')
      } else {
        console.warn('[agentlex-session-bridge] session binding unavailable; seed skipped')
      }
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
