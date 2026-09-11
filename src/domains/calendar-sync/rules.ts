/**
 * 日历同步规则（0.2.13 收敛版）——「什么该进 Apple 日历」的唯一判定处。
 *
 * 用户口径（2026-09-11 明确）：
 *   1. 数据只有两类：任务 / 日程（both = 二者关联）。日程就是日程，没有
 *      「关键日期 / 期限 / 里程碑」这些额外概念——法定期限也是日程。
 *   2. 日程过了就是历史时间轴，**没有逾期**；尚未发生的日程才进日历。
 *   3. 有日期就带日期；**有时间点的一定要带时间点**（不许退化成全天）。
 *   4. 标题格式「【事项标题】案件名」，案件名取不到才用案号。
 *   5. 答辩期 / 举证期暂时不同步日历（关键词开关，后续放开时删掉即可）。
 *   6. 任务同步开关关着 → 一条任务都不进日历。
 *
 * 判定只依赖事项自身属性（有没有 date/time、标题关键词、类型是不是任务），
 * 不再维护 type 白名单——这样以后新增任何东西都不会再「顺手」灌进日历。
 */
import type { Item } from '../item/store/types.ts'

/**
 * 暂不同步的日程标题关键词。
 *
 * 用户 2026-09-11：答辩期、举证期暂时先不要同步；「裁判文书送达这一类也不要进日历」；
 * 「当事人的履行期限跟我方无关，不要再主动加进日程」。
 * 这些都是**记录性时点 / 他人义务**（期限届满、文书送达、对方分期付款），
 * 不是我方要去参加的日程。
 */
export const SYNC_SKIP_TITLE_KEYWORDS: readonly string[] = ['答辩期', '举证期', '送达', '履行期限']

/** 本地日期 yyyy-MM-dd（与 items 的 date 同口径，不走 UTC 以免跨日错位）。 */
export function localToday(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export interface SyncGateOptions {
  /** 日程同步开关（calendarSyncEvents）。 */
  syncEvents: boolean
  /** 任务同步开关（calendarSyncTasks）。 */
  syncTasks: boolean
  /** 今天（yyyy-MM-dd），便于测试注入。 */
  today?: string
}

export interface SyncGateResult {
  sync: boolean
  /** 不同步的原因（供路由回传统计，便于排查"为什么没进日历"）。 */
  reason?: 'disabled' | 'no-date' | 'past' | 'skip-keyword' | 'task-toggle-off' | 'not-scheduled'
}

/** 事项是否属于「日程」面（event / both）。 */
function hasEventFace(it: Pick<Item, 'type'>): boolean {
  return it.type === 'event' || it.type === 'both'
}

/** 事项是否属于「任务」面（task / both）。 */
function hasTaskFace(it: Pick<Item, 'type'>): boolean {
  return it.type === 'task' || it.type === 'both'
}

/**
 * 判定一条事项该不该同步到 Apple 日历。
 *
 * 纯任务（task）：必须任务开关打开。
 * 日程（event / both）：必须日程开关打开、有日期、日期在未来、标题不含跳过词。
 */
export function shouldSyncToCalendar(
  it: Pick<Item, 'type' | 'title' | 'date' | 'time'>,
  opts: SyncGateOptions,
): SyncGateResult {
  const isEvent = hasEventFace(it)
  const isTask = hasTaskFace(it)

  if (!isEvent && !isTask) return { sync: false, reason: 'not-scheduled' }
  // 纯任务只看任务开关；带日程面的事项按日程口径判断（它就是日程）。
  if (!isEvent && isTask && !opts.syncTasks) return { sync: false, reason: 'task-toggle-off' }
  if (isEvent && !opts.syncEvents) return { sync: false, reason: 'disabled' }

  const date = (it.date ?? '').trim()
  if (date === '') return { sync: false, reason: 'no-date' }

  const today = opts.today ?? localToday()
  // 尚未发生的日程才进日历；过去的日程是历史时间轴，不进、也不叫逾期。
  if (date < today) return { sync: false, reason: 'past' }

  const title = it.title ?? ''
  if (SYNC_SKIP_TITLE_KEYWORDS.some((k) => title.includes(k))) return { sync: false, reason: 'skip-keyword' }

  return { sync: true }
}

/**
 * 日历事件标题：「【事项标题】案件名」。
 *
 * 用户口径（2026-09-11）：「标题以『【开庭】』这样来开头」。方括号里就是事项
 * 标题本身（开庭 → 【开庭】、裁判文书送达 → 【裁判文书送达】），不另造分类词表；
 * 案件名取不到时才退回案号/项目名兜底。
 */
export function calendarEventTitle(title: string, ownerLabel: string): string {
  const t = (title ?? '').trim() || '日程'
  const label = (ownerLabel ?? '').trim()
  return label === '' ? `【${t}】` : `【${t}】${label}`
}

/**
 * 同一件事在日历里只留一条的键。
 *
 * 0.2.12 的重复问题：同一天同一件事被登记成两条事项（id 不同）→ 按 itemId 幂等
 * 的同步认为是两件事 → 日历里出现两条。这里按「归属 + 日期 + 标题」去重，
 * 与界面「统一期限清单」同一口径。
 */
export function dedupeKey(it: Pick<Item, 'ownerId' | 'date' | 'title'>): string {
  return `${it.ownerId ?? ''}|${(it.date ?? '').trim()}|${(it.title ?? '').trim()}`
}

/**
 * 从一组事项里挑出该同步的，并按 dedupeKey 去重。
 *
 * 同一件事常被登记成两条（同一天同一标题，一条带时间一条不带——如「开庭 14:45」
 * 与「开庭」）。去重时**优先保留信息更全的那条**：有时间 > 无时间，有 detail >
 * 无 detail。否则可能把带时间的丢掉，日历里变成全天事件。
 */
export function pickSyncableItems<T extends Pick<Item, 'id' | 'type' | 'title' | 'date' | 'time' | 'ownerId' | 'detail'>>(
  items: T[],
  opts: SyncGateOptions,
): T[] {
  const richness = (x: T): number => ((x.time ?? '') !== '' ? 2 : 0) + ((x.detail ?? '') !== '' ? 1 : 0)
  const best = new Map<string, T>()
  for (const it of items) {
    if (!shouldSyncToCalendar(it, opts).sync) continue
    const key = dedupeKey(it)
    const cur = best.get(key)
    if (cur === undefined || richness(it) > richness(cur)) best.set(key, it)
  }
  return [...best.values()]
}
