/**
 * 日历自动对账的判定（纯函数，便于自测）。
 *
 * 背景（2026-10-15）：日程进日历此前只依赖「写事项时派发一次事件」这条链路。
 * 派发丢失、或 osascript 瞬时失败（Calendar 忙 / 权限弹窗 / 20 秒超时 / 目标日历
 * 临时不可写）都会让这条日程**永久**漏在日历外——没有重试、没有提示。
 * 对账要做两件事，且都必须是**增量**的（正常情况零开销）：
 *   ① 补漏：规则上该同步、但日历映射里没有的日程；
 *   ② 清理：映射里有、items.json 里已不存在的事项（只认「事项被删」，不认
 *      「日程过了 / 命中跳过词」——那些是规则变更，不该反过来删用户日历里的历史）。
 */
export interface ReconcilePlanInput<T extends { id: string } = { id: string }> {
  /** 规则筛出的「该同步」日程（已去重）。 */
  targets: ReadonlyArray<T>
  /** 当前 itemId → 日历事件的映射。 */
  mapped: Readonly<Record<string, unknown>>
  /** items.json 里仍然存在的事项 id。 */
  aliveIds: Iterable<string>
  /** 单轮补漏上限，避免一次把 Calendar 拖住。 */
  limit?: number
}

export interface ReconcilePlan<T extends { id: string } = { id: string }> {
  /** 需要补建到日历的事项（原样返回，调用方还要用 title/date 等信息）。 */
  toCreate: T[]
  /** 需要从日历删除（并清映射）的事项 id。 */
  toRemove: string[]
}

/** 计算一轮对账要补建 / 删除什么。纯函数：不读盘、不调 osascript。 */
export function planCalendarReconcile<T extends { id: string }>(input: ReconcilePlanInput<T>): ReconcilePlan<T> {
  const limit = input.limit ?? 50
  const alive = new Set(input.aliveIds)
  const toCreate = input.targets.filter((item) => input.mapped[item.id] === undefined).slice(0, Math.max(0, limit))
  const toRemove = Object.keys(input.mapped).filter((id) => !alive.has(id))
  return { toCreate, toRemove }
}
