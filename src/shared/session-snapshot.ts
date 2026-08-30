/**
 * DSH 会话快照桥。
 *
 * 0.1.2-alpha.1 移除了旧版 `GET /sessions` REST 端点；旧渲染层（vendor
 * 面板 CaseManager/CaseDetailPage 的 sessionClient.getSessions）请求该端点
 * 会 404（用于「过期绑定会话清理」与历史会话列表）。此桥从宿主 sessions
 * 快照（ctx.sessions.list）读取当前会话列表，供 vendor 侧复用。root-first
 * 解析（与 session-bridge 一致），幂等安装。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

declare global {
  interface Window {
    __agentlexListSessions?: () => Promise<Array<{
      id: string
      title?: string
      agentDir?: string
      lastActiveAt?: string
    }>>
  }
}

/** root-first 服务解析（gateway 严格代理对子 fiber 的注入限制）。 */
function serviceOf<T>(ctx: unknown, name: string): T | undefined {
  const anyCtx = ctx as { root?: unknown }
  const candidates: unknown[] = [anyCtx.root, ctx]
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue
    const getter = (candidate as { get?: (n: string) => unknown }).get
    if (typeof getter !== 'function') continue
    try {
      const value = getter.call(candidate, name)
      if (value !== undefined) return value as T
    } catch {
      /* try next */
    }
  }
  return undefined
}

/** 会话列表快照形状（SessionListState.byId 的最小投影）。 */
interface SessionsSnapshot {
  byId?: Record<string, {
    displayTitle?: string
    cwd?: string
    updatedAt?: string
  }>
}

/**
 * 安装 window.__agentlexListSessions 桥（幂等：已有桥则不覆盖）。
 * @param ctx - 插件 client 上下文（root-first 取 sessions 服务）。
 * @returns disposer。
 */
export function installSessionSnapshotBridge(ctx: ClientContext): () => void {
  if (typeof window === 'undefined') return () => {}
  if (window.__agentlexListSessions !== undefined) return () => {}

  const list = (): Promise<Array<{ id: string; title?: string; agentDir?: string; lastActiveAt?: string }>> => {
    const sessions = serviceOf<{ list?: { getSnapshot(): SessionsSnapshot } }>(ctx, 'sessions')
    const snapshot = sessions?.list?.getSnapshot()
    const byId = snapshot?.byId ?? {}
    return Promise.resolve(
      Object.entries(byId).map(([id, row]) => ({
        id,
        title: row?.displayTitle,
        agentDir: row?.cwd ?? '',
        lastActiveAt: row?.updatedAt ?? '',
      })),
    )
  }

  window.__agentlexListSessions = list
  return () => {
    if (window.__agentlexListSessions === list) {
      delete window.__agentlexListSessions
    }
  }
}