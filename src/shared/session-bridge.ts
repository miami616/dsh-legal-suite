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
 *
 * Harness contract note (v0.1.6-alpha.2, 2026-09-21): session **selection**
 * moved out of the sessions service — `ISessions.open()/openSubagent()/clear()`
 * and the `SessionListState.current` field are gone; navigation is now
 * `ctx.uiWorkspace.openSession(id)` (dsh-client-ui-workspace). The old calls
 * threw `sessions.open is not a function` *after* the session had been created,
 * which made the launch-manager retry loop create a session per attempt
 * (3 per click) and never fire `onLaunched` — the "管家按钮点了没反应" bug.
 * {@link selectSession} prefers the new face and falls back to the legacy
 * method for older harnesses; navigation failures are non-fatal everywhere.
 */
import { serviceOf } from './dsh-services.ts'

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

/**
 * v0.1.6-alpha.2 起的会话选择入口（dsh-client-ui-workspace）。
 * `openSession` 同步一步完成「保留会话 + 切主视图 + 显示对话」。
 */
interface UiWorkspaceLike {
  openSession?(target: string): void
}

/** SessionFace prompt (no request id required at this level). */
interface SessionFaceLike {
  prompt(content: Array<{ type: 'text'; text: string }>, mode: 'queue' | 'steer'): Promise<unknown>
}

interface SessionBindingLike {
  session?: SessionFaceLike
}

interface SessionsManagerLike {
  /** 会话选择入口：≤ 0.1.5 由本服务承担；0.1.6 起已从服务面删除（见 UiWorkspaceLike）。 */
  open?(sessionId: string): void
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
 * 通用管家会话标题（没有案件/项目归属时用）。
 *
 * 形如 `诉讼管家 · 09-21 16:50`：同一模块按钮点多次会产生多个会话，
 * 只写模块名会让侧边栏里一排会话标题完全相同（用户 2026-09-21 反馈
 * 「会话标题只显示一个诉讼管家」）。带分钟级时间戳即可区分。
 * @param base - 模块显示名（诉讼管家 / 非诉管家）。
 * @param now - 注入当前时间（测试用）。
 */
export function managerSessionTitle(base: string, now: Date = new Date()): string {
  const pad = (value: number): string => (value < 10 ? `0${value}` : `${value}`)
  return `${base} · ${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

/**
 * Resolve the typert-gateway `remote` client, root-first (see {@link serviceOf}
 * in shared/dsh-services.ts).
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
 *
 * 优先 gateway `remote.workspace.create`（≤ 0.1.5 与 0.1.6 都在）；失败/不可用时
 * 退回 `ctx.workspaces.create`（同一条 RPC 的服务面，0.1.6 起在 client 服务目录里
 * 直接可读）。
 */
export async function ensureWorkspace(
  ctx: SessionBridgeContext,
  path: string,
): Promise<string | undefined> {
  const workspace = remoteOf(ctx)?.workspace
  if (workspace?.create) {
    try {
      const response = await workspace.create({ path })
      const workspaceId = unwrap(response)?.workspace?.workspaceId
      if (workspaceId !== undefined && workspaceId !== '') return workspaceId
    } catch (error) {
      console.warn('[agentlex-session-bridge] remote.workspace.create failed, falling back:', error)
    }
  }
  try {
    const direct = serviceOf<{
      create?(input: { path: string }): Promise<{ workspaceId?: string } | undefined>
    }>(ctx, 'workspaces')
    const view = await direct?.create?.({ path })
    return view?.workspaceId
  } catch (error) {
    console.warn('[agentlex-session-bridge] workspaces.create failed:', error)
    return undefined
  }
}

/**
 * Give a workspace its Chinese display name (best-effort, two-generation
 * dispatch: gateway remote first, `ctx.workspaces.rename(id, title)` second).
 */
async function renameWorkspace(
  ctx: SessionBridgeContext,
  workspaceId: string,
  title: string,
): Promise<void> {
  const remote = remoteOf(ctx)
  if (remote?.workspace?.rename) {
    try {
      await remote.workspace.rename({ workspaceId, title })
      return
    } catch (error) {
      console.warn('[agentlex-session-bridge] remote.workspace.rename failed, falling back:', error)
    }
  }
  try {
    const direct = serviceOf<{
      rename?(id: string, name: string): Promise<unknown>
    }>(ctx, 'workspaces')
    await direct?.rename?.(workspaceId, title)
  } catch (error) {
    console.warn('[agentlex-session-bridge] workspaces.rename failed:', error)
  }
}

/**
 * Select a session through the v0.1.6 ui-workspace face (synchronous).
 * @returns true when the new navigation entry accepted the call.
 */
function openViaUiWorkspace(ctx: SessionBridgeContext, sessionId: string): boolean {
  const uiWorkspace = serviceOf<UiWorkspaceLike>(ctx, 'uiWorkspace')
  if (typeof uiWorkspace?.openSession !== 'function') return false
  try {
    uiWorkspace.openSession(sessionId)
    return true
  } catch (error) {
    console.warn('[agentlex-session-bridge] uiWorkspace.openSession failed:', error)
    return false
  }
}

/**
 * Open an existing DSH session (jump to a previously bound conversation).
 *
 * v0.1.6-alpha.2：先走 `uiWorkspace.openSession`；旧 harness（≤ 0.1.5）没有该
 * 服务，退回异步等待列表收录后再 `sessions.open`。
 * @returns true when some navigation entry accepted the request.
 */
export function openExistingSession(
  ctx: SessionBridgeContext,
  sessionId: string,
): boolean {
  if (openViaUiWorkspace(ctx, sessionId)) return true
  const sessions = serviceOf<SessionsManagerLike>(ctx, 'sessions')
  if (typeof sessions?.open !== 'function') return false
  void openWhenListed(sessions, sessionId)
  return true
}

/**
 * Switch the DSH UI to a session (used right after creating one).
 *
 * Same two-generation dispatch as {@link openExistingSession}, awaited so the
 * caller can log the outcome. **Never throws** — a navigation failure must not
 * be mistaken for a creation failure (that is what made the launch managers
 * retry and create duplicate sessions).
 * @returns true when the selection was accepted.
 */
export async function selectSession(
  ctx: SessionBridgeContext,
  sessionId: string,
): Promise<boolean> {
  if (openViaUiWorkspace(ctx, sessionId)) return true
  const sessions = serviceOf<SessionsManagerLike>(ctx, 'sessions')
  if (typeof sessions?.open !== 'function') return false
  try {
    return await openWhenListed(sessions, sessionId)
  } catch (error) {
    console.warn('[agentlex-session-bridge] sessions.open failed:', error)
    return false
  }
}

/**
 * Wait for a freshly created session to appear in the sessions list feed,
 * then select it. `sessions.open` throws on unknown ids, and a just-created
 * session may not be in the client's list snapshot yet (the list refreshes
 * asynchronously after the create RPC). Polling the list feed (with a
 * subscribe fallback) closes that gap so the UI reliably jumps to the new
 * session. Only used on harnesses that still expose `sessions.open`.
 * @returns true when the session was selected; false when it never appeared.
 */
async function openWhenListed(
  sessions: SessionsManagerLike,
  sessionId: string,
): Promise<boolean> {
  const select = (): void => { sessions.open?.(sessionId) }
  const list = sessions.list
  const listed = (): boolean => {
    const snap = list?.getSnapshot()
    if (snap?.byId && snap.byId[sessionId]) return true
    if (snap?.ids && snap.ids.includes(sessionId)) return true
    return false
  }
  if (listed()) {
    select()
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
    select()
    return true
  }
  // 超时兜底：会话可能已在列表但快照未刷新，仍尝试 open（失败静默）。
  try {
    select()
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
  //    (best-effort — remote 不可用时降级为 cwd 会话；显示名失败不影响建会话）。
  const workspaceId = await ensureWorkspace(ctx, options.workspacePath)
  if (workspaceId !== undefined && workspaceId !== '' && options.workspaceTitle) {
    await renameWorkspace(ctx, workspaceId, options.workspaceTitle)
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
      sessionId = undefined
    }
  }
  // 第三降级：rc 世代 harness 的 connection.api.sessions.create（0.1.2-alpha.1
  // 已无该 RPC；老版有）。返回体为 { result: { ok, value } }。
  if (sessionId === undefined) {
    try {
      const connection = serviceOf<{
        api?: {
          sessions?: {
            create(p: { workspaceId?: string; cwd?: string; agentPreset?: string }): Promise<{
              result?: { ok?: boolean; value?: { sessionId?: string } }
            }>
          }
        }
      }>(ctx, 'connection')
      const legacyCreate = connection?.api?.sessions?.create
      if (typeof legacyCreate === 'function') {
        const payload: { workspaceId?: string; cwd?: string; agentPreset: string } = {
          agentPreset: options.agentPreset,
        }
        if (workspaceId) payload.workspaceId = workspaceId
        else payload.cwd = options.workspacePath
        const legacyResult = await legacyCreate(payload)
        sessionId = legacyResult?.result?.ok === true ? legacyResult.result.value?.sessionId : undefined
      }
    } catch (error) {
      console.warn('[agentlex-session-bridge] connection.api.sessions.create fallback failed:', error)
      sessionId = undefined
    }
  }
  if (!sessionId) {
    console.warn('[agentlex-session-bridge] no session id from create')
    return undefined
  }

  // 3. Rename for a human-readable title (best-effort). 必须在 seed 之前：标题服务
  //    以「user 来源」的最新标题为锚，先落标题就不会被自动标题（首条人消息的
  //    fallback / provider）顶掉。
  try {
    if (remote?.session?.rename) {
      await remote.session.rename({ sessionId, title: options.title })
    } else {
      const face = sessions.binding?.(sessionId)?.session as unknown as
        | { rename?(title: string): Promise<unknown> }
        | undefined
      if (face?.rename) await face.rename(options.title)
    }
  } catch (error) {
    console.warn('[agentlex-session-bridge] rename failed:', error)
  }

  // 4. Switch the DSH UI to this session. 这一步必须在 seed 之前：会话绑定
  //    （`sessions.binding`）只有在该会话被保留之后才存在 —— 0.1.6 的
  //    uiWorkspace.openSession 正是那个保留点，所以先切后喂。
  //    ⚠ 导航失败绝不能让整个函数失败（否则调用方的重试会为一次点击反复建会话、
  //    且 onLaunched 永不触发 → 按钮「点了没反应」）。
  let selected = false
  try {
    selected = await selectSession(ctx, sessionId)
  } catch (error) {
    console.warn('[agentlex-session-bridge] session selection failed:', error)
  }
  if (!selected) {
    console.warn('[agentlex-session-bridge] session created but not selected:', sessionId)
  }

  // 5. Seed the first prompt (best-effort) through the retained session face.
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

  return sessionId
}
