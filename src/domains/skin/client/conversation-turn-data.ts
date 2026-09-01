/**
 * 会话轮次数据源（TurnData）：为轨迹导航预览卡提供补充信息（状态/性能指标）。
 *
 * 说明：皮肤是无 UI 的 DOM 叠加层，无法像参考插件（dsh-codex-timeline，完整
 * conversation UI 替换）那样用 React useSession 读取 `chat.timeline` 的逐回合
 * 数据（raw session snapshot 不暴露 .chat，且 reactive getSnapshot 需 React
 * 追踪上下文）。本模块改为读**可用的投影**：`session.projections.faceOf('sessionStats')`
 * 提供会话级聚合指标（TTFT、解码时长、输出 tokens → tok/s），防御性降级。
 *
 * 逐回合的时间信息由 conversation-navigation.ts 从 DOM（回合 timeStart 标记）
 * 读取；这里只负责状态与指标。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

/** 单个轮次的预览信息（供卡片元信息行使用）。 */
export interface TurnPreviewData {
  /** 该轮开始时刻，格式 "HH:MM"；不可读取时为空串。 */
  time: string
  /** 状态：'open' 进行中 | 'closed' 已完成 | 'unknown' 未知。 */
  status: 'open' | 'closed' | 'unknown'
  /** 性能摘要，如 "TTFT 1.2s · 45 tok/s"；无法折算时为空串。 */
  metrics: string
}

/** 最小结构视图：会话服务（list + projections）。 */
interface SessionsServiceLike {
  list?: { getSnapshot?(): { current?: string } | undefined; subscribe?(fn: () => void): () => void } | undefined
  binding?(id: string): { session?: { projections?: { faceOf?(key: string): { getSnapshot?(): unknown } } } | undefined } | undefined
}

/** sessionStats 投影的结构。 */
interface SessionStatsLike {
  turns?: number
  steps?: number
  llmMs?: number
  toolMs?: number
  ttftMs?: number
  ttftSteps?: number
  decodeMs?: number
  decodeTokens?: number
}

/** 补零两位。 */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

/** 时间戳 → "HH:MM"；非数字返回空串。 */
export function formatClock(time: number): string {
  if (!Number.isFinite(time)) return ''
  const d = new Date(time)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** 每回合状态到展示文案。 */
export function statusLabel(status: TurnPreviewData['status']): string {
  const map: Record<TurnPreviewData['status'], string> = {
    open: '进行中',
    closed: '已完成',
    unknown: '—',
  }
  return map[status] ?? '—'
}

/** 从会话聚合 sessionStats 折算指标摘要："TTFT 1.2s · 45 tok/s"。 */
export function formatStatsMetrics(stats: SessionStatsLike | undefined): string {
  if (!stats) return ''
  const parts: string[] = []
  // TTFT 用平均首 token 延迟（总 ttftMs / 有 TTFT 的 step 数），更接近参考的单回合口径。
  const ttftMs = Number.isFinite(stats.ttftMs) ? stats.ttftMs as number : 0
  const ttftSteps = Number.isFinite(stats.ttftSteps) && (stats.ttftSteps as number) > 0 ? stats.ttftSteps as number : 0
  if (ttftMs > 0 && ttftSteps > 0) parts.push(`TTFT ${(ttftMs / ttftSteps / 1000).toFixed(1)}s`)
  const decodeMs = Number.isFinite(stats.decodeMs) ? stats.decodeMs as number : 0
  const decodeTokens = Number.isFinite(stats.decodeTokens) ? stats.decodeTokens as number : 0
  if (decodeMs > 0 && decodeTokens > 0) parts.push(`${Math.round(decodeTokens / (decodeMs / 1000))} tok/s`)
  return parts.join(' · ')
}

/** 维护 turn → 预览信息 的订阅源。 */
export type TurnDataSource = {
  /** 读取某一回合的预览信息；未知回合返回 undefined。 */
  get(turn: number): TurnPreviewData | undefined
  dispose(): void
}

/** 空数据源（session 服务不可用时用，永不抛）。 */
export function emptyTurnDataSource(): TurnDataSource {
  return {
    get() { return undefined },
    dispose() { /* noop */ },
  }
}

/**
 * 建立会话轮次数据源：订阅当前会话，读 sessionStats 折算每个回合的指标与状态。
 * 任何服务缺失/字段漂移都静默降级为空源/空信息。
 * @param ctx 皮肤 ClientContext（含 sessions 服务）
 * @returns 数据源句柄（get + dispose）
 */
export function setupTurnDataSource(ctx: ClientContext): TurnDataSource {
  if (typeof ctx === 'undefined') return emptyTurnDataSource()
  const sessions = (ctx as unknown as { sessions?: SessionsServiceLike }).sessions
  const list = sessions?.list
  if (!list?.getSnapshot) return emptyTurnDataSource()

  /** 会话级 stats（用于每个回合的指标展示；逐回合指标需 React 数据源，暂不可得）。 */
  let stats: SessionStatsLike | undefined
  /** 当前绑定会话的 unsubscribe。 */
  let unsubscribeSession: (() => void) | undefined

  /** 读取某会话的 sessionStats 投影。 */
  const probeStats = (sessionId: string | undefined): void => {
    stats = undefined
    if (!sessionId) return
    const binding = sessions?.binding?.(sessionId)
    const projection = binding?.session?.projections
    try {
      const face = projection?.faceOf?.('sessionStats')
      const value = face?.getSnapshot?.()
      if (value && typeof value === 'object') stats = value as SessionStatsLike
    } catch { /* ignore */ }
  }

  /** 绑定到某个会话并订阅其变化（列表/统计刷新时重读）。 */
  const bindSession = (sessionId: string | undefined): void => {
    unsubscribeSession?.()
    unsubscribeSession = undefined
    probeStats(sessionId)
  }

  /** 响应 list.current 变化。 */
  const onListChange = (): void => {
    bindSession(list.getSnapshot?.()?.current)
  }
  onListChange()
  const unsubList = list.subscribe?.(onListChange)

  return {
    get(turn: number) {
      void turn
      return {
        time: '',
        status: 'closed' as const,
        metrics: formatStatsMetrics(stats),
      }
    },
    dispose() {
      unsubscribeSession?.()
      unsubscribeSession = undefined
      unsubList?.()
      stats = undefined
    },
  }
}
