/**
 * DSH 会话快照桥。
 *
 * 0.1.2-alpha.1 移除了旧版 `GET /sessions` REST 端点；旧渲染层（vendor
 * 面板 CaseManager/CaseDetailPage 的 sessionClient.getSessions）请求该端点
 * 会 404（用于「过期绑定会话清理」与历史会话列表）。此桥从宿主 sessions
 * 快照（ctx.sessions.list）读取当前会话列表，供 vendor 侧复用。root-first
 * 解析（与 session-bridge 一致），幂等安装。
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { serviceOf } from './dsh-services.ts'

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