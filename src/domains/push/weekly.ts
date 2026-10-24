/**
 * 周报（每周一「本周重点工作」/ 每周五「本周总结与下周重点」）的纯逻辑层。
 *
 * 只做三件事，不碰网络与文件：
 *  1. 周历：ISO 周次、周一到周日、本周首个/末个工作日（节假日顺延）；
 *  2. 从既有的期限集合（collectAllDeadlines 的输出）里切出「本周」「下周」；
 *  3. 装配成一张卡需要的分区/行（结构化，渲染交给 feishu-card）。
 *
 * 去重/降噪口径：
 *  - 周一只发一张卡（本周重点），当天不再另发日报——调用方成功后写 lastDigestDate；
 *  - 周报不逐条罗列整周所有事项：硬节点（开庭/法定期限）全列，普通任务只列本周内；
 *  - 周五「顺延」只列已经过去的日子（今天仍在进行的不算未完成），「下周重点」只给要点；
 *  - 空周不发卡（调用方直接标记本周已处理，避免空卡与反复重试）。
 */
import type { DeadlineItem } from '../litigation/deadlines.ts'
import { classifyDeadline, localDate, severityOf, type Severity } from './reminder-plan.ts'
import { addDays, isWorkday, parseYmd } from '../../shared/workday-calendar.ts'

/** 周报类型：周一计划 / 周五回顾。 */
export type WeeklyKind = 'plan' | 'review'

/** 一行周报内容。 */
export interface WeeklyRow {
  label: string
  /** 展示用日期：10/27 周二（可带时间）。 */
  when: string
  caseName?: string
  detail?: string
  /** 右侧小标签，如「还剩 2 天」「今天」。 */
  tag?: string
  tagColor?: 'red' | 'orange' | 'grey' | 'green'
  severity: Severity
}

/** 一个分区。 */
export interface WeeklySection {
  title: string
  rows: WeeklyRow[]
  /** 分区末的补充说明（计数/建议）。 */
  note?: string
}

/** 一张周报卡的全部内容。 */
export interface WeeklyPayload {
  kind: WeeklyKind
  weekKey: string
  /** 10月26日 – 11月1日 */
  rangeLabel: string
  /** 2026 年第 44 周 */
  weekLabel: string
  sections: WeeklySection[]
  total: number
  /** 全卡最高严重度（决定卡片颜色）。 */
  worst: Severity
}

/** 本周已完成的条目（来自统一事项 store，status=done 且本周更新）。 */
export interface WeeklyDoneItem {
  title: string
  ownerName?: string
  date?: string
  updatedAt?: string
}

/** 案件进展检查的发现（与日报卡尾「需要核对」同源）。 */
export interface WeeklyFinding {
  caseId?: string
  caseName?: string
  message: string
  severity?: string
}

/** 提前提醒（日报「提前提醒」分区里、落到下周及更远的事项）。 */
export interface WeeklyAheadItem {
  label: string
  date: string
  time?: string
  caseName?: string
  phaseLabel?: string
  severity?: Severity
}

/** 装配周报所需的输入。 */
export interface WeeklyInput {
  /** 全部未完成期限（collectAllDeadlines 输出）。 */
  items: DeadlineItem[]
  /** 本周已完成事项。 */
  done: WeeklyDoneItem[]
  /** 案件进展检查发现。 */
  findings?: WeeklyFinding[]
  /** 提前提醒（周一计划卡补一节，避免替掉日报后丢掉 T-30/T-7 的进阶提醒）。 */
  ahead?: WeeklyAheadItem[]
  /** 单分区最多行数（默认 12）。 */
  maxRows?: number
}

const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const
const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, normal: 2, low: 3 }

/** YYYY-MM-DD → 本周一（周一为一周第一天）。 */
export function mondayOf(date: string): string {
  const d = parseYmd(date)
  if (d === undefined) return date
  const shift = (d.getDay() + 6) % 7
  return addDays(date, -shift)
}

/** YYYY-MM-DD → ISO 周次键（2026-W43）。 */
export function isoWeekKey(date: string): string {
  const d = parseYmd(date)
  if (d === undefined) return date
  // ISO 8601：以该周周四所在年份与周次为准（跨年周不会算错）。
  const thursday = new Date(d.getTime())
  thursday.setDate(thursday.getDate() + 3 - ((d.getDay() + 6) % 7))
  const firstThursday = new Date(thursday.getFullYear(), 0, 4)
  const firstDayShift = (firstThursday.getDay() + 6) % 7
  const week = 1 + Math.round(((thursday.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + firstDayShift) / 7)
  return `${thursday.getFullYear()}-W${String(week).padStart(2, '0')}`
}

/** ISO 周次 → 展示文案（2026 年第 44 周）。 */
export function weekLabelOf(date: string): string {
  const key = isoWeekKey(date)
  const [year, week] = key.split('-W')
  return `${year} 年第 ${Number(week)} 周`
}

/** 本周一的日期与本周日的日期。 */
export function weekBounds(date: string): { monday: string; sunday: string } {
  const monday = mondayOf(date)
  return { monday, sunday: addDays(monday, 6) }
}

/** 本周范围内的工作日列表。 */
function workdaysOfWeek(date: string): string[] {
  const { monday } = weekBounds(date)
  const days: string[] = []
  for (let i = 0; i < 7; i++) {
    const day = addDays(monday, i)
    if (isWorkday(day)) days.push(day)
  }
  return days
}

/** 是否本周第一个工作日（周一放假则顺延到周二）。 */
export function isFirstWorkdayOfWeek(date: string): boolean {
  const days = workdaysOfWeek(date)
  return days.length > 0 && days[0] === date
}

/** 是否本周最后一个工作日（周五放假则提前到周四）。 */
export function isLastWorkdayOfWeek(date: string): boolean {
  const days = workdaysOfWeek(date)
  return days.length > 0 && days[days.length - 1] === date
}

/** 10/27 周二（可带时间）。 */
function whenOf(date: string, time?: string): string {
  const d = parseYmd(date)
  if (d === undefined) return date
  const base = `${d.getMonth() + 1}/${d.getDate()} ${WEEKDAY_CN[d.getDay()]}`
  return time !== undefined && time !== '' ? `${base} ${time}` : base
}

/** 10月26日 – 11月1日。 */
function rangeLabelOf(monday: string, sunday: string): string {
  const a = parseYmd(monday)
  const b = parseYmd(sunday)
  if (a === undefined || b === undefined) return `${monday} – ${sunday}`
  return `${a.getMonth() + 1}月${a.getDate()}日 – ${b.getMonth() + 1}月${b.getDate()}日`
}

/** 行严重度：硬期限按性质分级，普通任务 normal。 */
function severityOfItem(item: DeadlineItem): Severity {
  if (item.kind === 'task') return item.daysLeft < 0 ? 'high' : 'normal'
  return severityOf(classifyDeadline(item))
}

/** 剩余天数标签。 */
function tagOf(item: DeadlineItem): { tag?: string; color?: WeeklyRow['tagColor'] } {
  if (item.daysLeft < 0) return { tag: `已逾期 ${-item.daysLeft} 天`, color: 'red' }
  if (item.daysLeft === 0) return { tag: '今天', color: 'red' }
  if (item.daysLeft === 1) return { tag: '明天', color: 'orange' }
  return { tag: `还剩 ${item.daysLeft} 天`, color: 'grey' }
}

/** DeadlineItem → WeeklyRow。 */
function rowOf(item: DeadlineItem): WeeklyRow {
  const { tag, color } = tagOf(item)
  const caseName = item.caseName !== undefined && item.caseName !== '' && item.caseName !== item.label
    ? item.caseName
    : undefined
  return {
    label: item.label,
    when: whenOf(item.date, item.time),
    caseName,
    detail: item.kind === 'hearing' && item.detail !== undefined && item.detail !== '' ? item.detail : undefined,
    tag,
    tagColor: color,
    severity: severityOfItem(item),
  }
}

/** 按日期/时间/严重度排序。 */
function sortItems(items: DeadlineItem[]): DeadlineItem[] {
  return [...items].sort((a, b) => (
    a.date.localeCompare(b.date)
    || (a.time ?? '').localeCompare(b.time ?? '')
    || SEVERITY_ORDER[severityOfItem(a)] - SEVERITY_ORDER[severityOfItem(b)]
  ))
}

function worstOf(rows: WeeklyRow[]): Severity {
  return rows.reduce<Severity>((acc, row) => (SEVERITY_ORDER[row.severity] < SEVERITY_ORDER[acc] ? row.severity : acc), 'low')
}

function capItems(items: DeadlineItem[], max: number): { rows: WeeklyRow[]; hidden: number } {
  const rows = items.slice(0, max).map(rowOf)
  return { rows, hidden: Math.max(0, items.length - max) }
}

function findingRows(findings: WeeklyFinding[] | undefined, max = 4): WeeklyRow[] {
  if (findings === undefined) return []
  return findings.slice(0, max).map((finding) => ({
    label: finding.message,
    when: '',
    caseName: finding.caseName,
    severity: finding.severity === 'high' ? 'high' : 'normal',
  }))
}

/**
 * 装配「本周重点工作」（周一早上；周一放假则在之后第一个工作日的早报时间）。
 *
 * 分区：本周硬节点（开庭/法定期限，全列）→ 本周要推进（任务）→ 逾期未办（只给数量+前 3）
 *      → 案件进展需要核对。
 *
 * @param input - 期限集合 + 已完成事项 + 巡检发现。
 * @param now - 计算基准时间。
 * @returns 卡片内容；整周没有任何事项时返回 null（不发空卡）。
 */
export function buildWeeklyPlan(input: WeeklyInput, now: number = Date.now()): WeeklyPayload | null {
  const today = localDate(now)
  const { monday, sunday } = weekBounds(today)
  const maxRows = input.maxRows ?? 12

  const inWeek = input.items.filter((item) => item.date >= today && item.date <= sunday)
  const hard = sortItems(inWeek.filter((item) => item.kind !== 'task'))
  const tasks = sortItems(inWeek.filter((item) => item.kind === 'task'))
  const overdue = sortItems(input.items.filter((item) => item.date < today))
  const aheadRows: WeeklyRow[] = (input.ahead ?? []).slice(0, 5).map((entry) => ({
    label: entry.label,
    when: whenOf(entry.date, entry.time),
    caseName: entry.caseName === entry.label ? undefined : entry.caseName,
    tag: entry.phaseLabel,
    tagColor: entry.severity === 'critical' || entry.severity === 'high' ? 'orange' : 'grey',
    severity: entry.severity ?? 'normal',
  }))

  const sections: WeeklySection[] = []
  const hardCap = capItems(hard, maxRows)
  if (hardCap.rows.length > 0) {
    sections.push({
      title: '本周硬节点',
      rows: hardCap.rows,
      ...(hardCap.hidden > 0 ? { note: `另有 ${hardCap.hidden} 项，见任务面板` } : {}),
    })
  }
  const taskCap = capItems(tasks, Math.min(8, maxRows))
  if (taskCap.rows.length > 0) {
    sections.push({
      title: '本周要推进',
      rows: taskCap.rows,
      ...(taskCap.hidden > 0 ? { note: `另有 ${taskCap.hidden} 项任务` } : {}),
    })
  }
  if (aheadRows.length > 0) {
    sections.push({ title: '提前提醒', rows: aheadRows })
  }
  if (overdue.length > 0) {
    sections.push({
      title: '逾期未办',
      rows: overdue.slice(0, 3).map(rowOf),
      note: `共 ${overdue.length} 项逾期，建议本周先清掉`,
    })
  }
  const findings = findingRows(input.findings)
  if (findings.length > 0) {
    sections.push({ title: '案件进展需要核对', rows: findings })
  }

  if (sections.length === 0) return null
  const allRows = sections.flatMap((section) => section.rows)
  return {
    kind: 'plan',
    weekKey: isoWeekKey(today),
    rangeLabel: rangeLabelOf(monday, sunday),
    weekLabel: weekLabelOf(today),
    sections,
    total: allRows.length,
    worst: worstOf(allRows),
  }
}

/**
 * 装配「本周总结与下周重点」（本周最后一个工作日的下午）。
 *
 * 分区：本周完成 → 本周顺延（只列已经过去的日子，今天仍在办的不算）→ 下周重点 → 需要核对。
 * 「下周重点」只给要点（最多 8 条，硬节点优先），避免周五下午又把下周整周刷一遍。
 *
 * @param input - 期限集合 + 已完成事项 + 巡检发现。
 * @param now - 计算基准时间。
 * @returns 卡片内容；本周无完成、无顺延、下周无重点时返回 null（不发空卡）。
 */
export function buildWeeklyReview(input: WeeklyInput, now: number = Date.now()): WeeklyPayload | null {
  const today = localDate(now)
  const { monday, sunday } = weekBounds(today)
  const nextMonday = addDays(sunday, 1)
  const nextSunday = addDays(sunday, 7)
  const maxRows = input.maxRows ?? 12

  const done = input.done
    .filter((item) => {
      const at = item.updatedAt ?? ''
      if (at === '') return true
      const day = at.slice(0, 10)
      return day >= monday && day <= today
    })
    .slice(0, 8)
    .map<WeeklyRow>((item) => ({
      label: item.title,
      when: item.updatedAt !== undefined && item.updatedAt !== '' ? whenOf(item.updatedAt.slice(0, 10)) : '',
      caseName: item.ownerName,
      severity: 'low',
    }))

  // 顺延：本周内、已经过去的日子仍未完成的（今天仍在进行的不算未完成）。
  const deferred = sortItems(input.items.filter((item) => item.date >= monday && item.date < today))
  const deferredCap = capItems(deferred, Math.min(6, maxRows))

  // 下周重点：硬节点优先，任务最多补 3 条。
  const nextItems = input.items.filter((item) => item.date >= nextMonday && item.date <= nextSunday)
  const nextHard = sortItems(nextItems.filter((item) => item.kind !== 'task'))
  const nextTasks = sortItems(nextItems.filter((item) => item.kind === 'task')).slice(0, 3)
  const nextCap = capItems([...nextHard, ...nextTasks].sort((a, b) => a.date.localeCompare(b.date)), Math.min(8, maxRows))

  const sections: WeeklySection[] = []
  if (done.length > 0) {
    sections.push({ title: '本周完成', rows: done, note: `${done.length} 项` })
  }
  if (deferredCap.rows.length > 0) {
    sections.push({
      title: '本周顺延',
      rows: deferredCap.rows,
      note: deferredCap.hidden > 0 ? `另有 ${deferredCap.hidden} 项未完成` : '未完成，建议安排到下周',
    })
  }
  if (nextCap.rows.length > 0) {
    sections.push({
      title: '下周重点',
      rows: nextCap.rows,
      ...(nextCap.hidden > 0 ? { note: `另有 ${nextCap.hidden} 项` } : {}),
    })
  }
  const findings = findingRows(input.findings, 3)
  if (findings.length > 0) {
    sections.push({ title: '需要核对', rows: findings })
  }

  if (sections.length === 0) return null
  const allRows = sections.flatMap((section) => section.rows)
  const overdueCount = input.items.filter((item) => item.date < monday).length
  if (overdueCount > 0) {
    const last = sections[sections.length - 1]
    const note = `更早已逾期 ${overdueCount} 项（见任务面板）`
    if (last?.title === '需要核对') last.note = last.note === undefined ? note : `${last.note} · ${note}`
    else sections.push({ title: '更早积压', rows: [], note })
  }
  return {
    kind: 'review',
    weekKey: isoWeekKey(today),
    rangeLabel: rangeLabelOf(monday, sunday),
    weekLabel: weekLabelOf(today),
    sections,
    total: allRows.length,
    worst: worstOf(allRows),
  }
}

/** 本周第一个工作日的日期（周一放假则顺延）。 */
export function firstWorkdayDate(now: number = Date.now()): string | undefined {
  return workdaysOfWeek(localDate(now))[0]
}

/** 本周最后一个工作日的日期（周五放假则提前）。 */
export function lastWorkdayDate(now: number = Date.now()): string | undefined {
  const days = workdaysOfWeek(localDate(now))
  return days[days.length - 1]
}

/**
 * 下一个周一计划档期的日期（设置页展示）：本周首个工作日的早报时间未过就是它，否则下周一
 * （下周一放假则顺延到下周首个工作日）。
 *
 * @param now - 计算基准时间。
 * @param hour - 早报小时（与 pushTime 一致）。
 * @param minute - 早报分钟。
 */
export function nextPlanDate(now: number = Date.now(), hour = 8, minute = 30): string {
  const today = localDate(now)
  const first = firstWorkdayDate(now)
  if (first !== undefined) {
    const slot = parseYmd(first)
    if (slot !== undefined) {
      slot.setHours(hour, minute, 0, 0)
      if (now < slot.getTime()) return first
    }
  }
  const nextWeek = addDays(weekBounds(today).monday, 7)
  const nextWeekDate = parseYmd(nextWeek)
  return nextWeekDate === undefined ? nextWeek : (firstWorkdayDate(nextWeekDate.getTime()) ?? nextWeek)
}

/**
 * 下一个周五总结档期的日期：本周末个工作日的复盘时间未过就是它，否则下周
 * （周五放假时按当周最后工作日）。
 */
export function nextReviewDate(now: number = Date.now(), hour = 16, minute = 30): string {
  const today = localDate(now)
  const last = lastWorkdayDate(now)
  if (last !== undefined) {
    const slot = parseYmd(last)
    if (slot !== undefined) {
      slot.setHours(hour, minute, 0, 0)
      if (now < slot.getTime()) return last
    }
  }
  const nextWeek = addDays(weekBounds(today).monday, 7)
  const nextWeekDate = parseYmd(nextWeek)
  return nextWeekDate === undefined ? nextWeek : (lastWorkdayDate(nextWeekDate.getTime()) ?? nextWeek)
}
