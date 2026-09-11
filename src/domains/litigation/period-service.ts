/**
 * 期限派生登记（0.2.11）——只登记触发事由，届满日由规则表派生。
 *
 * 一次登记落「三件套」：
 *   1. 关键日程：规范术语 + 届满日（带 ruleId/baseDate/cite/computeTrace 审计字段）
 *   2. 时间轴日程：触发事实（如「裁判文书送达」status=done），作为纪年锚点
 *   3. 提前量任务链：按规则的 anchor 取 LEAD_TIME_RULES，在届满日之前铺动作节点
 *
 * 第 3 条是「精确提示到」的实体——任务本来就有逾期语义与推送窗口，把动作落成
 * 任务，提示自然逐级精确；日程那侧只作叙事与锚点，不承载逾期（v0.2.11 决策）。
 *
 * 幂等：关键日程按 ruleId+baseDate 更新不新增；事件按标题；任务按「组名+标题」。
 */

import type { CaseStore } from './store/case-store.ts'
import type { CaseRecord } from './store/types.ts'
import type { ItemStore, TaskGroup } from '../item/store/item-store.ts'
import { LEAD_TIME_RULES, daysBefore } from '../../shared/playbook/litigation.ts'
import { isEventItem } from '../item/store/types.ts'
import {
  PERIOD_RULES, addDaysStr, derivePeriod, matchPeriodRules, previousWorkday,
  type DerivedPeriod, type PeriodCandidate, type PeriodRule, type PeriodTrigger,
} from '../../shared/playbook/period-rules.ts'

/** 登记请求：管家/模型能确定的事实，不含任何推算。 */
export interface ServiceRequest {
  /** 文书名（如「仲裁裁决书」「判决书」）。 */
  doc: string
  /** 送达/收到/生效之日 YYYY-MM-DD。 */
  date: string
  fact?: PeriodTrigger['fact']
  /** 当事人地位（申请人/被告…）。 */
  party?: string
  /** 我方实体身份（劳动者/用人单位），终局裁决的救济路径靠它区分。 */
  clientRole?: string
  /** 文书种类定性（非终局裁决/终局裁决/判决/裁定）——定性本身是判断，由模型给出。 */
  docKind?: string
  /** 程序轨；缺省取案件 level。 */
  procedure?: string
  /** 案件类型；缺省取案件 type。 */
  caseType?: string
}

/** 候选摘要（歧义时给模型/律师看差异）。 */
export interface CandidateSummary {
  ruleId: string
  term: string
  cite: string
  length: string
  start: string
  effect: string
  dueDate?: string
}

export interface PeriodPlan {
  caseId: string
  procedure: string
  input: ServiceRequest
  /** 命中的全部候选（按具体度降序）。 */
  candidates: CandidateSummary[]
  /** true = 多候选并列，不得擅自择一；此时 matched 为空。 */
  ambiguous: boolean
  /** 唯一命中时的派生结果。 */
  matched?: DerivedPeriod
  /** 命中规则 id。 */
  ruleId?: string
  /** 规则关联的提前量锚点。 */
  anchor?: string
  /** 将落库的触发事由日程。 */
  events: Array<{ title: string; date: string; kind: string }>
  /** 将落库的提前量任务（deadline 已算好）。 */
  tasks: Array<{ title: string; deadline: string; anchorDays: number }>
  /** 任务组名（= 规范术语）。 */
  groupName?: string
  /** 人读提示。 */
  notes: string[]
  /** true = 规则表未命中，需要依法条提案（propose_period_rule）而不是编日期。 */
  proposedNeeded?: boolean
}

export interface PeriodApplyResult extends PeriodPlan {
  applied: { keyDateId?: string; eventId?: string; taskIds: string[] }
  skipped: string[]
}

/** 期间长度的人读描述。 */
function lengthDesc(rule: { period: { days?: number; months?: number; years?: number } }): string {
  if (rule.period.days !== undefined) return `${rule.period.days} 日`
  if (rule.period.months !== undefined) return `${rule.period.months} 个月`
  return `${rule.period.years} 年`
}

const summarize = (c: PeriodCandidate, due?: string): CandidateSummary => ({
  ruleId: c.rule.id,
  term: c.rule.term,
  cite: c.rule.cite,
  length: lengthDesc(c.rule),
  start: c.rule.start.from,
  effect: c.rule.effect,
  dueDate: due,
})

/** 触发事由的规范标题：裁判文书类归一为「裁判文书送达」，其余「<文书>送达」。 */
function triggerEventTitle(doc: string, fact: PeriodTrigger['fact']): string {
  if (/判决书|裁定书|裁决书/.test(doc)) return '裁判文书送达'
  return `${doc}${fact}`
}

/** 触发事由的日程 kind（开放词表，服务端只作标签与归类）。 */
function triggerEventKind(doc: string, fact: PeriodTrigger['fact']): string {
  if (/判决书|裁定书|裁决书/.test(doc)) return 'service'
  return 'court_notice'
}

/**
 * 提前量任务链：按锚点从 LEAD_TIME_RULES 取；deadline 落在休息日则往前挪。
 *
 * ⚠ 前移会造成**同日碰撞**：如上诉期链 T-3=周五、T-2=周六 → 前移到周五，于是
 * 「起草复核」和「递交」挤在同一天，链条退化成一句话。所以前移之后还要**从最晚
 * 一步往前**保证严格递减：前一步若与后一步同日或更晚，就再往前挪一个工作日。
 * 这样「递交」留在最贴近届满日的位置（它最需要晚），把起草/确认往前挤。
 */
function leadTasks(anchor: string | undefined, dueDate: string): Array<{ title: string; deadline: string; anchorDays: number }> {
  if (anchor === undefined || anchor === '') return []
  const rule = LEAD_TIME_RULES.find((r) => r.anchor === anchor)
  if (rule === undefined) return []
  const rows = rule.steps.map((s) => {
    const raw = daysBefore(dueDate, s.days)
    // 动作截止日落在周六/周日 → 往前挪到最近工作日（不能把动作留到办不了的一天）。
    const safe = previousWorkday(raw).date
    return { title: s.item, deadline: safe, anchorDays: s.days }
  })
  // 严格递减（日期递增）：从倒数第二步往前处理，避免同日碰撞。
  for (let i = rows.length - 2; i >= 0; i--) {
    const later = rows[i + 1]!
    let guard = 0
    while (rows[i]!.deadline >= later.deadline && guard < 30) {
      rows[i]!.deadline = previousWorkday(addDaysStr(rows[i]!.deadline, -1)).date
      guard++
    }
  }
  return rows
}

/**
 * 只读预览：查表 + 计算 + 给出将落库的三件套。不写任何数据。
 *
 * 歧义（ambigous=true）时不擅自择一——如「仲裁裁决书送达」在终局性未定性时
 * 会同时命中 15 日起诉与 30 日撤裁两条规则，须由模型结合案情判断或问律师。
 */
export async function planPeriodRegistration(
  caseStore: CaseStore,
  caseId: string,
  input: ServiceRequest,
  /** 生效规则集合（内置 + 本地补丁表）；缺省只用内置表。 */
  rules: PeriodRule[] = PERIOD_RULES,
): Promise<PeriodPlan> {
  const record: CaseRecord | undefined = await caseStore.readCase(caseId)
  if (record === undefined) throw new Error(`case not found: ${caseId}`)

  const procedure = input.procedure ?? record.level ?? ''
  const caseType = input.caseType ?? record.type
  const candidates = matchPeriodRules({
    procedure,
    doc: input.doc,
    fact: input.fact,
    date: input.date,
    party: input.party,
    clientRole: input.clientRole,
    docKind: input.docKind,
    caseType,
    // 受理法院：本地补丁表按法院口径覆盖通用规则（0.2.12）。
    court: record.court,
  }, rules)

  const notes: string[] = []
  const base: PeriodPlan = {
    caseId,
    procedure,
    input,
    candidates: candidates.map((c) => summarize(c)),
    ambiguous: false,
    events: [],
    tasks: [],
    notes,
  }

  if (candidates.length === 0) {
    notes.push(
      `规则表未命中（程序=${procedure}${input.docKind !== undefined ? `，文书种类=${input.docKind}` : ''}）——` +
      '请勿自行推算日期：用 propose_period_rule 依法条提案（带 cite），律师确认后再登记。',
    )
    base.proposedNeeded = true
    return base
  }

  const top = candidates[0]!
  const tied = candidates.filter((c) => c.specificity === top.specificity)
  if (tied.length > 1) {
    base.ambiguous = true
    base.candidates = candidates.map((c) => summarize(c, derivePeriod(c.rule, input.date).dueDate))
    notes.push(
      `命中 ${tied.length} 条并列候选（${tied.map((c) => c.rule.id).join('、')}）——` +
      '期间与救济路径不同，须先定性（如终局/非终局裁决、我方是劳动者还是用人单位）再登记，不得擅自择一。',
    )
    return base
  }

  const rule = top.rule
  const matched = derivePeriod(rule, input.date)
  const tasks = leadTasks(rule.anchor, matched.dueDate)
  const event = { title: triggerEventTitle(input.doc, rule.trigger.fact), date: input.date, kind: triggerEventKind(input.doc, rule.trigger.fact) }

  notes.push(`命中规则 ${rule.id}：${matched.computeTrace}；依据 ${rule.cite}。`)
  if (rule.confidence !== 'statutory') {
    notes.push(`该规则置信度为 ${rule.confidence}（非法条直接规定），落库前请复核。`)
  }
  if (matched.skipped.length > 0) {
    notes.push('已按民诉法 §85 顺延，请复核（节假日表尚未接入，目前仅按周末顺延）。')
  }
  if (tasks.length === 0 && rule.anchor !== undefined) {
    notes.push(`锚点「${rule.anchor}」暂无提前量任务链——期限保护将退化为「到期前提醒一次」。`)
  }

  return {
    ...base,
    candidates: candidates.map((c) => summarize(c, c.rule.id === rule.id ? matched.dueDate : derivePeriod(c.rule, input.date).dueDate)),
    matched,
    ruleId: rule.id,
    anchor: rule.anchor,
    events: [event],
    tasks,
    groupName: rule.term,
    notes,
  }
}

/**
 * 落库：关键日程 + 触发事由日程 + 提前量任务链。幂等。
 *
 * @param itemStore - 统一事项 store；缺席时只落关键日程（legacy 分支）。
 */
export async function applyPeriodRegistration(
  caseStore: CaseStore,
  caseId: string,
  input: ServiceRequest,
  itemStore?: ItemStore,
  /** 生效规则集合（内置 + 本地补丁表）；缺省只用内置表。 */
  rules: PeriodRule[] = PERIOD_RULES,
): Promise<PeriodApplyResult> {
  const plan = await planPeriodRegistration(caseStore, caseId, input, rules)
  const applied: PeriodApplyResult['applied'] = { taskIds: [] }
  const skipped: string[] = [...plan.notes]

  if (plan.ambiguous) {
    skipped.push('未落库：候选歧义，需先定性。')
    return { ...plan, applied, skipped }
  }
  if (plan.matched === undefined || plan.ruleId === undefined) {
    skipped.push('未落库：规则表未命中——请用 propose_period_rule 依法条提案，律师确认后再登记（不得自行推算）。')
    return { ...plan, applied, skipped }
  }

  const record = await caseStore.readCase(caseId)
  const existingKeyDate = (record?.keyDates ?? []).find(
    (k) => k.ruleId === plan.ruleId && k.baseDate === input.date,
  )
  const updated = await caseStore.addKeyDate(caseId, plan.matched.term, plan.matched.dueDate, {
    ruleId: plan.ruleId,
    baseDate: input.date,
    cite: plan.matched.cite,
    derivedAt: new Date().toISOString(),
    computeTrace: plan.matched.computeTrace,
  })
  const keyDate = (updated.keyDates ?? []).find((k) => k.ruleId === plan.ruleId && k.baseDate === input.date)
  applied.keyDateId = keyDate?.id
  if (existingKeyDate !== undefined) skipped.push(`关键日程已存在，按 ruleId+baseDate 更新：${plan.matched.term} ${plan.matched.dueDate}`)

  if (itemStore === undefined) {
    skipped.push('未落时间轴日程与任务链：统一事项 store 不可用。')
    return { ...plan, applied, skipped }
  }

  const items = await itemStore.listItems(caseId)

  // 2) 触发事由日程（已发生 → done，进时间轴纪年，不进关键日程倒计时）
  for (const ev of plan.events) {
    const dup = items.find((it) => isEventItem(it) && it.title === ev.title && it.date === ev.date)
    if (dup !== undefined) {
      skipped.push(`时间轴日程已存在：${ev.title} ${ev.date}`)
      continue
    }
    const created = await itemStore.upsertItem({
      ownerId: caseId,
      ownerType: 'litigation',
      type: 'event',
      kind: ev.kind,
      title: ev.title,
      date: ev.date,
      status: 'done',
      detail: `期限派生登记的触发事由（规则 ${plan.ruleId}，依据 ${plan.matched.cite}）`,
    })
    applied.eventId = created.id
    skipped.push(`新增时间轴日程：${ev.title} ${ev.date}`)
  }

  // 3) 提前量任务链
  if (plan.tasks.length > 0 && plan.groupName !== undefined) {
    const groups: TaskGroup[] = await itemStore.listGroups(caseId)
    let group = groups.find((g) => g.name === plan.groupName)
    if (group === undefined) {
      group = await itemStore.upsertGroup({ ownerId: caseId, ownerType: 'litigation', name: plan.groupName })
    }
    for (const t of plan.tasks) {
      const dup = items.find((it) => isEventItem(it) && it.title === t.title)
        ?? items.find((it) => it.title === t.title && it.groupId === group!.id)
      if (dup !== undefined) {
        skipped.push(`提前量任务已存在：${t.title}`)
        continue
      }
      const created = await itemStore.upsertItem({
        ownerId: caseId,
        ownerType: 'litigation',
        type: 'task',
        title: t.title,
        status: 'pending',
        priority: 'high',
        date: t.deadline,
        groupId: group.id,
        groupName: group.name,
        detail: `距「${plan.groupName}」（${plan.matched.dueDate}）T-${t.anchorDays}；依据 ${plan.matched.cite}`,
      })
      applied.taskIds.push(created.id)
    }
  }

  // 任务链落库后 bump 案件 updatedAt（卡片按最近更新置顶，与 0.2.2 事件/任务一致）。
  await caseStore.updateCase(caseId, {})

  // 登记成功 → 复算法定期限闸门：期限已齐则清掉陈旧告警（0.2.12）。
  try {
    const { syncPeriodGate } = await import('./status-transition.ts')
    const after = await caseStore.readCase(caseId)
    await syncPeriodGate(caseStore, caseId, after?.status, rules)
  } catch { /* 闸门清理由后续状态变更/巡检兜底，不阻塞登记结果 */ }

  return { ...plan, applied, skipped }
}

/** 便于路由/工具层复用：列出规则表（可按程序过滤）。 */
export function listRules(
  procedure?: string,
  rules: PeriodRule[] = PERIOD_RULES,
): Array<{ id: string; procedure: string; term: string; cite: string; length: string; effect: string; anchor?: string; confidence: string }> {
  return rules
    .filter((r) => procedure === undefined || procedure === '' || r.scope.procedure === procedure)
    .map((r) => ({
      id: r.id,
      procedure: r.scope.procedure,
      term: r.term,
      cite: r.cite,
      length: lengthDesc(r),
      effect: r.effect,
      anchor: r.anchor,
      confidence: r.confidence,
    }))
}
