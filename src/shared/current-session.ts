/**
 * 当前会话（主视图会话）解析 —— 跨 harness 版本的唯一读法。
 *
 * 契约漂移（0.1.6-alpha.2 实测，2026-09-21）：
 *   - ≤ 0.1.5：选择态折在会话列表快照里 —— `ctx.sessions.list.getSnapshot().current`；
 *     导航入口是 `ctx.sessions.open(id)`。
 *   - ≥ 0.1.6：`SessionListState.current` 与 `ISessions.open/openSubagent/clear`
 *     一并删除（选择态搬到 ui-workspace，持久化名 `dsh.sessions.current`），
 *     导航改由 `ctx.uiWorkspace.openSession(id)` 承担。官方判定「主视图会话」的
 *     唯一公开读法：`byId[*].retainedBy.mainView > 0`（ui-workspace 内部
 *     `retain(target, { source: 'mainView' })`，见 dsh-client-ui-workspace 的
 *     `mainSessionId` / `containsCurrent`）。
 *
 * 两条路都读不到时返回 undefined（新会话 Hero / 未选中会话），调用方按
 * 「无当前会话」处理。全程防御式读取：字段漂移只降级、不抛错——这些读点都挂在
 * 会话渲染/订阅路径上，抛错会炸掉整个面板。
 */
import { serviceOf } from './dsh-services.ts'

/** 会话列表行里本模块关心的最小投影。 */
interface SessionSummaryLike {
  cwd?: string
  /** 0.1.6 起由 `sessions.retain` 的来源计数驱动（`mainView` = 当前主视图）。 */
  retainedBy?: Readonly<Record<string, number>> | undefined
}

/** 会话列表快照的最小投影（两代 harness 的并集）。 */
export interface SessionListSnapshotLike {
  /** ≤ 0.1.5 的当前会话 id；0.1.6 起该字段被删除。 */
  current?: string
  byId?: Record<string, SessionSummaryLike | undefined>
}

interface SessionsLike {
  list?: { getSnapshot?: () => SessionListSnapshotLike | undefined } | undefined
}

/** 当前会话 id 与工作目录。 */
export interface CurrentSessionScope {
  sessionId: string
  cwd: string
}

/**
 * 从会话列表快照里取当前会话 id。
 * @param snapshot - `ctx.sessions.list.getSnapshot()`。
 * @returns 当前会话 id；没有选中会话时返回空串。
 */
export function currentSessionIdOfSnapshot(snapshot: SessionListSnapshotLike | undefined): string {
  if (snapshot === undefined || snapshot === null) return ''
  // ≤ 0.1.5：选择态直接写在快照上。
  const legacy = snapshot.current
  if (typeof legacy === 'string' && legacy !== '') return legacy
  // ≥ 0.1.6：主视图会话 = 被 mainView 引用（retained）的那一个。
  const byId = snapshot.byId
  if (byId === undefined || byId === null) return ''
  for (const [id, row] of Object.entries(byId)) {
    const retained = row?.retainedBy
    if (retained !== undefined && (retained.mainView ?? 0) > 0) return id
  }
  return ''
}

/** 会话列表快照（两代 harness 兼容结构）。 */
export function sessionListSnapshot(ctx: unknown): SessionListSnapshotLike | undefined {
  try {
    return serviceOf<SessionsLike>(ctx, 'sessions')?.list?.getSnapshot?.()
  } catch {
    return undefined
  }
}

/**
 * 解析当前会话 id + cwd；没有选中会话（新会话 Hero / 仅面板态）时返回 undefined。
 * @param ctx - 插件 client 上下文（或任何可解析 `sessions` 的 ctx）。
 */
export function readCurrentSessionScope(ctx: unknown): CurrentSessionScope | undefined {
  const snapshot = sessionListSnapshot(ctx)
  if (snapshot === undefined) return undefined
  const sessionId = currentSessionIdOfSnapshot(snapshot)
  if (sessionId === '') return undefined
  return { sessionId, cwd: snapshot.byId?.[sessionId]?.cwd ?? '' }
}

/**
 * 当前会话 id（读不到时返回空串，便于 `?? ''` 式调用点直接替换）。
 * @param ctx - 插件 client 上下文。
 */
export function readCurrentSessionId(ctx: unknown): string {
  return readCurrentSessionScope(ctx)?.sessionId ?? ''
}

/**
 * 某个会话的 cwd（会话列表快照里读；读不到返回空串）。
 * @param ctx - 插件 client 上下文。
 * @param sessionId - 目标会话 id。
 */
export function readSessionCwd(ctx: unknown, sessionId: string | undefined): string {
  if (sessionId === undefined || sessionId === '') return ''
  const snapshot = sessionListSnapshot(ctx)
  return snapshot?.byId?.[sessionId]?.cwd ?? ''
}
