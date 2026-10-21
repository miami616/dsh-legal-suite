/**
 * 提醒计划引擎（纯函数，无 I/O）——把「期限」翻译成「今天该提醒什么」。
 *
 * 背景（2026-10-18 重构）：原实现只有一条 `daysLeft ∈ {0,1}` 的固定窗口，
 * 每天一次飞书卡片。对律师业务有三个硬伤：
 *   1. **法定期限没有提前量**：上诉期 15 天、举证期、保全到期，只在「今天/明天」
 *      才出现，最后一个工作日才发现材料没准备；
 *   2. **开庭没有精确到点**：09:00 开庭与 08:30 的日报同一时刻到，赶路/异地开庭
 *      没有缓冲；
 *   3. **不同性质的期限被同等对待**：错过上诉期是执业事故，错过一个普通任务只是
 *      待办，卡片却长得一样。
 *
 * 本引擎按「期限性质」分级，为每一级配置提醒阶梯（T-30/T-15/T-7/T-3/T-2/T-1/D0），
 * 每条事项在同一档只提醒一次（台账键含档位），并给出「逾期后果」提示。纯函数，
 * 便于单测与在路由里预览。
 */

import type { DeadlineItem } from '../litigation/deadlines.ts'
import { holidayGap, isWorkday } from '../../shared/workday-calendar.ts'

/** 期限性质（决定提醒阶梯、严重度与后果提示）。 */
export type DeadlineClass =
  | 'statutory_long' // 申请执行/再审/撤销仲裁等长期间
  | 'statutory'      // 上诉/起诉/答辩等法定不变期间
  | 'preservation'   // 保全到期/续封/续冻
  | 'hearing'        // 开庭/听证/调解
  | 'procedural'     // 举证/缴费/补正/履行期限
  | 'task'           // 普通任务
  | 'event'          // 一般日程（会议/送达/立案等）
  | 'misc'

/** 严重度（决定卡片颜色、排序与是否显示法律后果）。 */
export type Severity = 'critical' | 'high' | 'normal' | 'low'

/** 卡片分区。 */
export type ReminderSection = 'overdue' | 'today_critical' | 'today' | 'tomorrow' | 'ahead'

/** 一条「该提醒」的候选（尚未去重）。 */
export interface ReminderEntry {
  item: DeadlineItem
  /** 台账去重键：同一事项同一档只提醒一次。 */
  key: string
  cls: DeadlineClass
  severity: Severity
  /** 命中的提醒档位（距届满天数）；逾期任务为逾期升级档位。 */
  threshold?: number
  /** 逾期天数（仅 section=overdue），用于精简模式的积压聚合。 */
  overdueAge?: number
  /** 人读的剩余标签：今天 / 明天 / 还剩 6 天 / 已逾期 3 天。 */
  phaseLabel: string
  /** 逾期后果/法定期限提示（仅 critical/high 且配置开启时展示）。 */
  consequence?: string
  /** 是否属于「错过档位日后的补发」。 */
  catchUp: boolean
  section: ReminderSection
}

/** 提醒相关配置（推送配置的子集，纯函数只关心这些）。 */
export interface ReminderPlanOptions {
  /** 智能分级（false = 兼容旧版，只提醒今天/明天）。 */
  smartLead?: boolean
  /** 是否生成法定后果提示。 */
  includeConsequence?: boolean
  /** 一次摘要卡最多展示多少条（超出只给计数，避免刷屏）。 */
  maxDigestRows?: number
  /** 提醒密度：concise 只保留近 7 天与逾期前 3 天；standard 保留全部档位。 */
  density?: ReminderDensity
  /** 提醒频率：low 用低频阶梯；normal 用标准阶梯。 */
  frequency?: ReminderFrequency
}

/** 提醒频率：低频（默认）/ 标准。 */
export type ReminderFrequency = 'low' | 'normal'

/** 各期限性质的提醒阶梯（标准频率，距届满天数，降序）。 */
export const CLASS_LADDERS: Record<DeadlineClass, number[]> = {
  statutory_long: [90, 30, 15, 7, 3, 2, 1, 0],
  statutory: [30, 15, 7, 3, 2, 1, 0],
  preservation: [30, 15, 7, 3, 2, 1, 0],
  hearing: [7, 3, 1, 0],
  procedural: [7, 3, 1, 0],
  task: [7, 3, 1, 0],
  event: [1, 0],
  // 未能识别性质的 keydate：保守只提醒今天/明天，避免对普通节点刷屏。
  misc: [1, 0],
}

/**
 * 低频阶梯（默认）：砍掉中间过密的档位。
 *  - 法定期限：30 / 7 / 3 / 1 / 0（去掉 15、2）
 *  - 普通任务/程序期限：3 / 1 / 0（去掉 7）
 *  - 开庭保持 7 / 3 / 1 / 0（三次准备 + 当天）
 */
export const LOW_FREQUENCY_LADDERS: Record<DeadlineClass, number[]> = {
  statutory_long: [90, 30, 7, 3, 1, 0],
  statutory: [30, 7, 3, 1, 0],
  preservation: [30, 7, 3, 1, 0],
  hearing: [7, 3, 1, 0],
  procedural: [3, 1, 0],
  task: [3, 1, 0],
  event: [1, 0],
  misc: [1, 0],
}

/**
 * 错过档位日后允许补发的天数。
 *
 * 例：T-7 的提醒因电脑休眠/进程重启没发出去，3 天后开机仍应补一条，而不是
 * 静默跳到 T-3。法定期限放宽到 7 天（宁可补发，不可漏报），普通事项 2 天。
 */
export const CATCH_UP_DAYS: Record<DeadlineClass, number> = {
  statutory_long: 7,
  statutory: 7,
  preservation: 7,
  hearing: 2,
  procedural: 2,
  task: 2,
  event: 1,
  misc: 1,
}

/** 逾期任务的升级档位：第 1/2/3 天每日，之后 7/14/30 天，再每 30 天一次。 */
export const OVERDUE_THRESHOLDS = [1, 2, 3, 7, 14, 30] as const

/** 计算逾期任务当前命中的升级档位（不再每天重推）。 */
export function overdueSlot(age: number): number {
  if (age <= 3) return age
  for (const t of [7, 14, 30]) {
    if (age <= t) return t
  }
  return 30 + Math.ceil((age - 30) / 30) * 30
}

/** 提醒密度：精简（默认）/ 标准。 */
export type ReminderDensity = 'concise' | 'standard'

/** 严重度排序权重（小的先展示）。 */
export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
}

/** 期限性质对应的默认严重度。 */
export function severityOf(cls: DeadlineClass): Severity {
  switch (cls) {
    case 'statutory':
    case 'statutory_long':
    case 'preservation':
      return 'critical'
    case 'hearing':
    case 'procedural':
      return 'high'
    case 'task':
    case 'misc':
      return 'normal'
    default:
      return 'low'
  }
}

/** 本地日期 YYYY-MM-DD（**不用 toISOString**：UTC 会在凌晨 0–8 点错一天）。 */
export function localDate(now: number = Date.now()): string {
  const d = new Date(now)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 本地 HH:mm。 */
export function localTime(now: number = Date.now()): string {
  const d = new Date(now)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 两个 YYYY-MM-DD 之间的整天差（b - a）。 */
export function dateDiffDays(a: string, b: string): number {
  return Math.round((new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime()) / 86_400_000)
}

/** 把 YYYY-MM-DD + HH:mm 解析成本地时间戳；解析失败返回 undefined。 */
export function localDateTime(date: string, time: string): number | undefined {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim())
  if (m === null) return undefined
  const h = Number(m[1])
  const min = Number(m[2])
  if (h < 0 || h > 23 || min < 0 || min > 59) return undefined
  const t = new Date(`${date}T00:00:00`)
  if (Number.isNaN(t.getTime())) return undefined
  t.setHours(h, min, 0, 0)
  return t.getTime()
}

/** 人读剩余标签。 */
export function phaseLabelOf(daysLeft: number, catchUp = false): string {
  if (daysLeft < 0) return `已逾期 ${-daysLeft} 天`
  const base = daysLeft === 0 ? '今天' : daysLeft === 1 ? '明天' : `还剩 ${daysLeft} 天`
  return catchUp ? `${base}（补）` : base
}

/** 期限性质分类：先看 kind，再用标题关键词兜底（历史数据 kind 大量为空）。 */
export function classifyDeadline(item: DeadlineItem): DeadlineClass {
  const label = `${item.label} ${item.detail ?? ''}`
  const kind = item.kind
  const ruleId = item.ruleId ?? ''

  // 规则表派生的期限优先按 ruleId 判定（比标题措辞稳定）。
  if (/enforcement\.apply|revoke_final_award|retrial/i.test(ruleId)) return 'statutory_long'
  if (/appeal|claim_against|defense/i.test(ruleId)) return 'statutory'

  // 任务（含任务派生的 keydate）先按任务处理：任务标题里的「开庭/举证/调解」
  // 是**动作对象**，不是期限本身。否则「制作庭审提纲」「催问开庭排期」都会被
  // 当成开庭，带上错误的后果提示。只有少数强期限/缴费任务例外。
  if (kind === 'task' || item.source === 'task') {
    if (/上诉期|起诉期|答辩期|再审.{0,6}期限|申请执行期限/.test(label)) return 'statutory'
    if (/缴费|诉讼费|受理费|上诉费/.test(label)) return 'procedural'
    if (/保全.{0,6}(到期|期限|届满)|续封|续冻/.test(label)) return 'preservation'
    return 'task'
  }

  // 长期间：申请执行（2 年）、再审（6 个月）、撤销仲裁裁决（6 个月）。
  // 必须匹配「期限/届满」而不是「申请执行」这个动作，否则任务「申请强制执行」
  // 会被当成 2 年期间，提前 90 天开始提醒。
  if (/申请执行期限|执行期限届满|执行时效|再审.{0,6}期限|撤销.{0,6}裁决.{0,6}期限|不予执行.{0,4}期限/.test(label)) return 'statutory_long'
  // 保全：只收「到期/续封/续冻/届满」，不收「递交保全申请」这类动作任务。
  if (/保全.{0,6}(到期|期限|届满)|续封|续冻|查封.{0,4}到期|冻结.{0,4}到期|解除保全|保全措施到期/.test(label)) return 'preservation'
  // 法定不变期间。
  if (/上诉期|起诉期|答辩期|复议期|异议期|上诉期限/.test(label)) return 'statutory'
  // 缴费/举证/补正/履行期：法院指定或程序性期限。
  if (/举证|证据.{0,4}期限|补正|缴费|诉讼费|受理费|上诉费|履行期限|提交.{0,6}材料/.test(label)) return 'procedural'
  // 开庭类：用 source（原始事件类型）而不是 kind（engine 把非期限事件都归到
  // hearing 桶），否则「普通会议」「送达」都会被误判成开庭。
  if (item.source === 'hearing' || /开庭|庭审|听证|询问|调解|并案/.test(label)) return 'hearing'

  // 以动作动词开头的任务型事项（含任务派生的关键日期）：按任务对待。
  // 放在 kind 判断之前：任务派生的 keydate（如「提交上诉状」）也应走任务阶梯。
  if (/^(递交|提交|申请|办理|准备|起草|整理|联系|确认|缴纳|支付|领取|邮寄|跟进)/.test(item.label.trim())) return 'task'

  if (kind === 'deadline') return 'statutory'
  if (kind === 'keydate') return 'misc'
  // 事实节点（送达/立案/收案/判决/结案/归档/送达回证）只需当天提示。
  if (/送达|传票|立案|收案|判决|裁定|结案|归档|上诉|执行立案|开庭传票/.test(label)) return 'event'
  return 'event'
}

/**
 * 法定/程序期限的逾期后果，用于提醒卡里的一句话提示。
 *
 * 只写「逾期会发生什么」，不写操作指引（操作指引由提前量任务链承担）。
 */
export function consequenceOf(item: DeadlineItem, cls: DeadlineClass): string | undefined {
  const label = item.label
  if (/上诉期|上诉期限/.test(label)) return '逾期丧失上诉权，一审裁判生效'
  if (/起诉期/.test(label)) return '逾期仲裁裁决生效，丧失起诉权'
  if (/答辩期/.test(label)) return '逾期不答辩不影响审理，但丧失答辩权利'
  if (/举证|证据.{0,4}期限/.test(label)) return '逾期举证可能不被采纳，并可能被训诫、罚款'
  if (/申请执行|执行期限/.test(label)) return '逾期丧失申请强制执行的权利'
  if (/再审/.test(label)) return '逾期丧失申请再审的权利'
  if (/撤销.{0,6}裁决/.test(label)) return '逾期丧失申请撤销的权利'
  if (/诉讼费|受理费|上诉费|缴费/.test(label)) return '逾期未缴，可能按撤诉/撤回上诉处理'
  if (/保全|续封|续冻|查封|冻结/.test(label)) return '逾期保全措施解除，须在届满前续行查封/冻结'
  if (/履行期限/.test(label)) return '逾期可申请强制执行（注意二年申请执行期间）'
  if (cls === 'hearing') return '提前确认开庭时间、地点与携带材料'
  return undefined
}

/** 某事项在当前配置下应使用的提醒阶梯。 */
export function ladderOf(cls: DeadlineClass, smartLead: boolean, frequency: ReminderFrequency = 'low'): number[] {
  if (!smartLead) return [1, 0]
  return frequency === 'low' ? LOW_FREQUENCY_LADDERS[cls] : CLASS_LADDERS[cls]
}

/**
 * 计算当前应命中的档位。
 *
 * - 正好落在阶梯日 → 命中该档（catchUp=false）；
 * - 已错过最近一档但仍在补发窗口 → 命中该档（catchUp=true）；
 * - 否则不提醒。
 *
 * 只取「最近的上一档」，避免新导入一个 5 天后的期限时把 T-30/T-15/T-7 一次全推。
 */
export function thresholdFor(
  daysLeft: number,
  ladder: number[],
  catchUpDays: number,
): { threshold: number; catchUp: boolean } | undefined {
  if (daysLeft < 0) return undefined
  if (ladder.includes(daysLeft)) return { threshold: daysLeft, catchUp: false }
  const passed = ladder.filter((n) => n > daysLeft).sort((a, b) => a - b)
  const nearest = passed[0]
  if (nearest === undefined) return undefined
  const lag = nearest - daysLeft
  if (lag <= catchUpDays) return { threshold: nearest, catchUp: true }
  return undefined
}

/** 事项的分区。 */
function sectionOf(daysLeft: number, severity: Severity): ReminderSection {
  if (daysLeft < 0) return 'overdue'
  if (daysLeft === 0) return severity === 'critical' || severity === 'high' ? 'today_critical' : 'today'
  if (daysLeft === 1) return 'tomorrow'
  return 'ahead'
}

/**
 * 计算「摘要卡」候选：到期/临期事项 + 逾期未完成任务。
 *
 * @param items - 统一期限项（computeDeadlinesV2 输出）。
 * @param opts - 分级开关与后果提示开关。
 * @param now - 当前时间（可注入，便于测试）。
 */
export function isDigestWorkday(now: number = Date.now()): boolean {
  return isWorkday(localDate(now))
}

export function reminderCandidates(
  items: DeadlineItem[],
  opts: ReminderPlanOptions = {},
  now: number = Date.now(),
): ReminderEntry[] {
  const smart = opts.smartLead !== false
  const withConsequence = opts.includeConsequence !== false
  const today = localDate(now)
  const entries: ReminderEntry[] = []

  for (const item of items) {
    const d = dateDiffDays(today, item.date)
    const cls = classifyDeadline(item)
    const severity = severityOf(cls)

    // 逾期只属于任务（日程过期即历史，既有设计决策）。逾期任务每天保留一条，
    // 但不重复占用「档位」台账——按天去重，避免同一逾期项把阶梯键用掉。
    if (d < 0) {
      if (item.kind !== 'task') continue
      const age = -d
      const slot = overdueSlot(age)
      entries.push({
        item,
        key: `${item.caseId}|${item.date}|${item.label}|OD|${slot}`,
        cls: 'task',
        severity: age >= 7 ? 'critical' : age >= 3 ? 'high' : 'normal',
        threshold: slot,
        overdueAge: age,
        phaseLabel: phaseLabelOf(d),
        catchUp: false,
        section: 'overdue',
      })
      continue
    }

    // 今天已过具体时间的事项不再进摘要：09:00 的庭在 09:01 的日报里再出现一次
    // 只会制造「庭都开了才提醒」的错觉；这类事项由 2h/30m 精确提醒负责。
    if (d === 0 && item.time !== undefined && item.time !== '') {
      const startedAt = localDateTime(item.date, item.time)
      if (startedAt !== undefined && startedAt <= now) continue
    }

    const ladder = ladderOf(cls, smart, opts.frequency ?? 'low')
    const hit = thresholdFor(d, ladder, smart ? CATCH_UP_DAYS[cls] : 0)
    if (hit === undefined) continue

    const consequence = withConsequence && (severity === 'critical' || severity === 'high')
      ? consequenceOf(item, cls)
      : undefined

    entries.push({
      item,
      key: `${item.caseId}|${item.date}|${item.label}|T${hit.threshold}`,
      cls,
      severity,
      threshold: hit.threshold,
      phaseLabel: phaseLabelOf(d, hit.catchUp),
      consequence,
      catchUp: hit.catchUp,
      section: sectionOf(d, severity),
    })
  }

  return sortEntries(entries)
}

/** 排序：严重度 → 剩余天数 → 具体时间 → 事项名。 */
export function sortEntries(entries: ReminderEntry[]): ReminderEntry[] {
  return [...entries].sort((a, b) => {
    const sa = SEVERITY_RANK[a.severity]
    const sb = SEVERITY_RANK[b.severity]
    if (sa !== sb) return sa - sb
    if (a.item.daysLeft !== b.item.daysLeft) return a.item.daysLeft - b.item.daysLeft
    const ta = a.item.time ?? '99:99'
    const tb = b.item.time ?? '99:99'
    if (ta !== tb) return ta.localeCompare(tb)
    return a.item.label.localeCompare(b.item.label, 'zh-CN')
  })
}

/** 精简模式下被折叠的条目统计。 */
export interface SuppressedSummary {
  overdue: number
  ahead: number
  /** 本次因分区限额/总条数上限未展开的数量。 */
  capped?: number
  /** 是否在卡片上展示积压逾期（周一汇总；其他日期只在设置页可见）。 */
  showBacklog?: boolean
  /** 最久逾期天数（用于提示「最久 N 天」）。 */
  oldestOverdueAge?: number
}

/** 摘要选择结果。 */
export interface DigestSelection {
  entries: ReminderEntry[]
  suppressed: SuppressedSummary
}

/**
 * 从全部候选中挑出「今天真正要推」的条目。
 *
 * 精简模式（默认）的取舍：
 *  - 逾期只推前 3 天，之后折叠为数量（66 个逾期任务每天重推是最大的噪音源）；
 *  - 提前提醒只推 T-7 及更近；T-15/T-30 只在周一（周计划日）出现，
 *    其余日期折叠为数量；
 *  - 今日/明日/今日必办全部保留。
 *
 * 标准模式保留全部档位（适合案件量小、希望看到远期提醒的用户）。
 */
export function selectDigestEntries(
  entries: ReminderEntry[],
  opts: { density?: ReminderDensity; now?: number } = {},
): DigestSelection {
  const density = opts.density ?? 'concise'
  if (density === 'standard') return { entries: sortEntries(entries), suppressed: { overdue: 0, ahead: 0 } }

  const now = opts.now ?? Date.now()
  // 周一做一次「本周前瞻」：T-15/T-30 在这一天进入卡片，其余日期不重复。
  const isMonday = new Date(now).getDay() === 1
  const kept: ReminderEntry[] = []
  const suppressed: SuppressedSummary = { overdue: 0, ahead: 0, showBacklog: isMonday }

  for (const entry of entries) {
    if (entry.section === 'overdue') {
      const age = entry.overdueAge ?? 0
      if (age <= 3) {
        kept.push(entry)
      } else {
        suppressed.overdue++
        suppressed.oldestOverdueAge = Math.max(suppressed.oldestOverdueAge ?? 0, age)
      }
      continue
    }
    if (entry.section === 'ahead' && (entry.threshold ?? 0) > 7 && !isMonday) {
      suppressed.ahead++
      continue
    }
    kept.push(entry)
  }

  return { entries: sortEntries(kept), suppressed }
}

/** 精简模式的分区限额：今日必办不能被逾期积压挤掉。 */
export const DIGEST_SECTION_CAPS: Partial<Record<ReminderSection, number>> = {
  overdue: 3,
  today_critical: 5,
  // 今天必须全部展示；明天最多 6 条（未展示的次日成为「今天」会再出现，不会漏）。
  today: Number.POSITIVE_INFINITY,
  tomorrow: 6,
  ahead: 3,
}

/**
 * 给「已去重、准备发送」的条目套上显示预算。
 *
 * 必须在台账去重**之后**调用：否则每天都选中同一批最靠前的条目，已推送的被过滤后
 * 当天就空了，后面的条目永远轮不到（这是一个很容易写错的顺序）。
 *
 * @returns 实际要展示的条目 + 被折叠数量（未写入台账，次日仍可轮到）。
 */
export function applyDigestCaps(
  entries: ReminderEntry[],
  opts: { density?: ReminderDensity; maxRows?: number } = {},
): { entries: ReminderEntry[]; hidden: number } {
  const concise = (opts.density ?? 'concise') !== 'standard'
  if (!concise) {
    const maxRows = Math.max(1, opts.maxRows ?? 15)
    return { entries: sortEntries(entries).slice(0, maxRows), hidden: Math.max(0, entries.length - maxRows) }
  }

  const perSection = new Map<ReminderSection, number>()
  const kept: ReminderEntry[] = []
  let hidden = 0
  for (const entry of sortEntries(entries)) {
    const cap = DIGEST_SECTION_CAPS[entry.section] ?? Number.POSITIVE_INFINITY
    const used = perSection.get(entry.section) ?? 0
    if (used >= cap) {
      hidden++
      continue
    }
    perSection.set(entry.section, used + 1)
    kept.push(entry)
  }
  return { entries: kept, hidden }
}

/**
 * 假期前「补位」提醒：最后一个工作日，把假期内的开庭/硬期限提前纳入摘要。
 *
 * 平时只看当天/明天/阶梯；周五到周日的庭、节前到节后的硬期限，如果不补位，
 * 会因为没有工作日摘要而完全消失。只补 critical/hearing/procedural，普通任务不补。
 */
export function holidayGapCandidates(items: DeadlineItem[], now: number = Date.now()): ReminderEntry[] {
  const today = localDate(now)
  const gap = holidayGap(today)
  if (gap.length === 0) return []
  const gapSet = new Set(gap)
  const entries: ReminderEntry[] = []
  for (const item of items) {
    if (!gapSet.has(item.date)) continue
    const cls = classifyDeadline(item)
    if (!['statutory', 'statutory_long', 'preservation', 'hearing', 'procedural'].includes(cls)) continue
    const severity = severityOf(cls)
    entries.push({
      item,
      key: `${item.caseId}|${item.date}|${item.label}|GAP`,
      cls,
      severity,
      threshold: 0,
      phaseLabel: '假期',
      consequence: consequenceOf(item, cls),
      catchUp: false,
      section: 'tomorrow',
    })
  }
  return sortEntries(entries)
}

/** 合并候选项：同一「案件+日期+事项」只保留一条（优先常规阶梯）。 */
export function mergeCandidates(base: ReminderEntry[], extra: ReminderEntry[]): ReminderEntry[] {
  const seen = new Set(base.map((entry) => `${entry.item.caseId}|${entry.item.date}|${entry.item.label}`))
  const merged = [...base]
  for (const entry of extra) {
    const key = `${entry.item.caseId}|${entry.item.date}|${entry.item.label}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(entry)
  }
  return sortEntries(merged)
}

/** 卡片分区标题。 */
export const SECTION_TITLES: Record<ReminderSection, string> = {
  overdue: '逾期任务',
  today_critical: '今日必办',
  today: '今日安排',
  tomorrow: '明日安排',
  ahead: '提前提醒',
}

/** 按分区聚合（顺序固定：逾期 → 今日必办 → 今日 → 明日 → 提前）。 */
export function groupEntries(entries: ReminderEntry[]): Array<{ section: ReminderSection; title: string; entries: ReminderEntry[] }> {
  const order: ReminderSection[] = ['overdue', 'today_critical', 'today', 'tomorrow', 'ahead']
  const buckets = new Map<ReminderSection, ReminderEntry[]>()
  for (const entry of sortEntries(entries)) {
    const list = buckets.get(entry.section) ?? []
    list.push(entry)
    buckets.set(entry.section, list)
  }
  return order
    .filter((section) => (buckets.get(section)?.length ?? 0) > 0)
    .map((section) => ({ section, title: SECTION_TITLES[section], entries: buckets.get(section) ?? [] }))
}

/** 卡片/预览的纯文本行（无卡片渲染时使用）。 */
export function formatEntryLine(entry: ReminderEntry): string {
  const time = entry.item.time !== undefined && entry.item.time !== '' ? ` ${entry.item.time}` : ''
  return `${entry.item.label} · ${entry.phaseLabel}${time}`
}

/** 当日摘要的一行概要（设置页预览用）。 */
export interface ReminderPreview {
  total: number
  bySection: Array<{ section: ReminderSection; title: string; count: number }>
  items: Array<{
    label: string
    caseName: string
    date: string
    time?: string
    phaseLabel: string
    severity: Severity
    cls: DeadlineClass
    section: ReminderSection
    consequence?: string
  }>
}

/** 把候选转成设置页可展示的预览结构。 */
export function buildPreview(entries: ReminderEntry[], maxItems = 30): ReminderPreview {
  const limited = sortEntries(entries).slice(0, maxItems)
  const bySection = groupEntries(entries).map((g) => ({ section: g.section, title: g.title, count: g.entries.length }))
  return {
    total: entries.length,
    bySection,
    items: limited.map((e) => ({
      label: e.item.label,
      caseName: e.item.caseName,
      date: e.item.date,
      time: e.item.time,
      phaseLabel: e.phaseLabel,
      severity: e.severity,
      cls: e.cls,
      section: e.section,
      consequence: e.consequence,
    })),
  }
}

/** 一条「即将开始」的精确提醒。 */
export interface IntradayEntry {
  item: DeadlineItem
  key: string
  /** 提前分钟数（120/60/30）。 */
  leadMinutes: number
  /** 距开始还有多少分钟。 */
  minutesLeft: number
  cls: DeadlineClass
  severity: Severity
  phaseLabel: string
}

/**
 * 计算「即将开始」的精确提醒候选。
 *
 * 只在事项有具体时间且就在今天时生效；同一提前量只提醒一次（键含 lead）。
 * 到点前 `lead` 分钟内首次触发；进程休眠错过会在恢复后立即补发（仍显示实际剩余分钟）。
 *
 * @param items - 统一期限项。
 * @param opts - preciseReminder 关闭时返回空；smartLead 关闭时仍可用。
 * @param now - 当前时间。
 */
export function intradayCandidates(
  items: DeadlineItem[],
  opts: ReminderPlanOptions & { preciseReminder?: boolean } = {},
  now: number = Date.now(),
): IntradayEntry[] {
  if (opts.preciseReminder === false) return []
  const today = localDate(now)
  const entries: IntradayEntry[] = []

  for (const item of items) {
    if (item.date !== today) continue
    if (item.time === undefined || item.time === '') continue
    const target = localDateTime(item.date, item.time)
    if (target === undefined) continue
    const minutesLeft = Math.round((target - now) / 60_000)
    if (minutesLeft < 0) continue

    const cls = classifyDeadline(item)
    const severity = severityOf(cls)
    // 开庭提前 2 小时（异地/早高峰），其他事项提前 30 分钟。
    const low = (opts.frequency ?? 'low') === 'low'
    // 低频：开庭只提前 2 小时提醒一次；其他带时间事项不再单独提醒（进每日摘要）。
    // 标准：开庭 2h/30m，其他 30m。
    const leads = cls === 'hearing' ? (low ? [120] : [120, 30]) : (low ? [] : [30])
    // 选「下一个未到的提前量档」：剩 100 分钟命中 2h 档，剩 45 分钟命中 30m 档。
    // 若 2h 档因休眠错过，剩 60 分钟时仍补发 2h 档（显示实际剩余分钟），
    // 到 30 分钟再发 30m 档，两档不互相吞掉。
    const lead = leads.filter((n) => minutesLeft <= n).sort((a, b) => a - b)[0]
    if (lead === undefined) continue

    entries.push({
      item,
      key: `${item.caseId}|${item.date}|${item.label}|IN|${lead}`,
      leadMinutes: lead,
      minutesLeft,
      cls,
      severity,
      phaseLabel: minutesLeft <= 0 ? '现在开始' : `还有 ${minutesLeft} 分钟`,
    })
  }

  return entries.sort((a, b) => a.minutesLeft - b.minutesLeft)
}

/** 精确提醒的纯文本（飞书 markdown 卡）。 */
export function formatIntradayMarkdown(entries: IntradayEntry[], titlePrefix?: string): string {
  const prefix = titlePrefix !== undefined && titlePrefix.trim() !== '' ? `${titlePrefix.trim()} ` : ''
  const first = entries[0]
  const header = first === undefined ? `${prefix}即将开始` : `${prefix}即将开始 · ${first.item.label} ${first.item.time ?? ''}`.trim()
  const blocks = entries.map((entry) => {
    const lines = [
      `**${entry.item.label}** ${entry.item.time ?? ''} · ${entry.phaseLabel}`,
      entry.item.caseName !== entry.item.label ? entry.item.caseName : '',
      entry.item.detail ?? '',
    ].filter((line) => line !== '')
    return lines.join('\n')
  })
  return `# ${header}\n\n${blocks.join('\n\n')}`
}
