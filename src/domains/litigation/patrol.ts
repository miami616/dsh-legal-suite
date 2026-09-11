/**
 * 案件账实核对（巡检）—— 0.2.12。
 *
 * **定位**：发现「案件的实际状态」与「登记」不一致——漏登记、登记错了、该推进没推进。
 * 明确**不碰**另外两件事，否则同一问题会在三处各报一次：
 *   - 字段完整性（缺案号/缺标的额…）→ 归 `case_health`；
 *   - 任务逾期 → 归任务台账的逾期分桶。
 *
 * **每条规则 = 证据 + 期望 + 一键动作**。只给"有问题"而不给动作的告警，等于把活丢回
 * 给律师。规则是纯函数、可单测、可增删——不写死在引擎里。
 *
 * **误报比漏报贵**（本模块开发中实测踩过三次）：
 *   - 开庭节点已过但没勾完成（19 条）→ 读侧本来就按日期把过去的日程当历史，**无后果**；
 *   - 已过立案阶段却没案号（8 条）→ `filing` 状态**本来就是"等案号"**；
 *   - 节点日期早于立案日期（7 条）→ 跨审级/跨程序（仲裁开庭 3 月 → 诉讼立案 5 月）合法。
 * 所以每条规则都要能回答：「凭什么算不符？不符有什么后果？」
 *
 * **立案日期不参与核对**（用户裁定）：实践中很难同步——原告还好掌握正式立案时间，
 * 被告几乎不可能知道准确立案日。这不是"账实不符"，是客观不可得。
 */

import type { CaseRecord } from './store/types.ts'
import type { Item } from '../item/store/types.ts'
import type { PeriodRule } from '../../shared/playbook/period-rules.ts'
import { checkPeriodGate, docNodesFromItems, isServiceEvidence } from './period-gate.ts'
import { isEventItem, isTaskItem } from '../item/store/types.ts'

export type PatrolSeverity = 'high' | 'medium' | 'low'

/** 一条巡检发现。 */
export interface PatrolFinding {
  ruleId: string
  ruleName: string
  severity: PatrolSeverity
  caseId: string
  caseName: string
  /** 证据：凭什么说它不符（人读，逐条）。 */
  evidence: string[]
  /** 期望：应该是什么样。 */
  expectation: string
  /** 建议动作：可直接执行的工具调用摘要。 */
  action: string
  /** 稳定指纹（去重台账用）：只有新出现或证据变化才重新提醒。 */
  fingerprint: string
}

/** 规则检测的输入。 */
export interface PatrolContext {
  record: CaseRecord
  /** 该案的全部统一事项（任务/日程/关键日期）。 */
  items: Item[]
  /** 生效期限规则（内置 + 本地补丁表）。 */
  rules: PeriodRule[]
}

/** 规则产出的载荷（引擎补 caseId/severity/fingerprint）。 */
export interface PatrolHit {
  evidence: string[]
  expectation: string
  action: string
}

export interface PatrolRule {
  id: string
  name: string
  severity: PatrolSeverity
  /** 纯函数：命中返回载荷，无问题返回 null。 */
  detect(ctx: PatrolContext): PatrolHit | null
}

const s = (v: unknown): string => (v === undefined || v === null ? '' : String(v))
const d = (v: unknown): string => s(v).slice(0, 10)

/** 救济期限术语（不变期间：上诉/起诉/撤裁）。 */
const RELIEF_TERM = /(上诉期届满|起诉期届满|撤销裁决申请期届满)/
/** 一切"届满/期限"类节点。 */
const DEADLINE_LABEL = /(届满|期限)/
/** 含不变期间的状态档位。 */
const PERIOD_STATE = /^(post_trial|appeal_window)$/
/**
 * 立案**之前**的状态档位（收案 / 诉前准备 / 立案中）。
 * 这些档位一旦出现「已立案」的证据，就是账实不符。
 */
const PRE_FILING_STATE = /^(intake|pre_filing|filing)$/
/**
 * 「已经立案」的证据：这些文书/节点只可能在法院受理立案之后出现。
 *
 * 注意与「立案日期」的区别——立案日期字段**不参与核对**（用户裁定：被告几乎不可能
 * 知道准确立案日，这是客观不可得，不是账实不符）；但"收到传票了状态还写立案中"
 * 是**硬矛盾**，与日期精度无关。
 */
const FILED_EVIDENCE = /(传票|受理通知|立案通知|应诉通知|举证通知|缴费通知|开庭通知|开庭排期|缴纳诉讼费|受理案件通知|开庭|答辩期)/

/** 该案的关键日期事项。 */
const keyDatesOf = (items: Item[]): Item[] => items.filter(isEventItem)
/** 该案的日程事项（不含任务与关键日期）。 */
const eventsOf = (items: Item[]): Item[] => items.filter(isEventItem)
/** 该案的任务事项。 */
const tasksOf = (items: Item[]): Item[] => items.filter(isTaskItem)

const today = (): string => new Date().toISOString().slice(0, 10)

/* ══════════════════════════════ 规则 ══════════════════════════════ */

/**
 * R1 同一期限重复登记。
 * 后果：期限汇总/看板卡片/飞书推送可能重复计数；同一个期限两条不同的届满日更危险。
 */
const ruleDuplicateKeyDate: PatrolRule = {
  id: 'period.duplicate_registration',
  name: '同一期限重复登记',
  severity: 'medium',
  detect({ items }) {
    const kd = keyDatesOf(items)
    const byLabel = new Map<string, Item[]>()
    for (const k of kd) {
      const label = s(k.title).trim()
      if (label === '') continue
      const list = byLabel.get(label) ?? []
      list.push(k)
      byLabel.set(label, list)
    }
    const evidence: string[] = []
    const removable: string[] = []
    for (const [label, list] of byLabel) {
      if (list.length < 2) continue
      const dates = new Set(list.map((k) => d(k.date)))
      // 判据分两种（踩过坑：分期履行的同一标签、不同日期是**合法**的）：
      //  a) 同一标签 + 同一日期 → 铁定重复登记；
      //  b) 救济期限（上诉期/起诉期/撤裁期）同标签多条 → 一个案子只可能有一个，冲突。
      // 其他情形（如「判决履行期限届满」2026-12-31 / 2027-06-30 分两期）不报。
      const sameDate = dates.size < list.length
      const reliefConflict = RELIEF_TERM.test(label)
      if (!sameDate && !reliefConflict) continue
      evidence.push(`「${label}」登记了 ${list.length} 次：${list.map((k) => `${d(k.date)}(${k.id})`).join('、')}`)
      // 同日期重复 → 删多余；救济期限冲突 → 交给律师判断哪条对，只提示不自动删。
      if (sameDate) for (const extra of list.slice(1)) removable.push(extra.id)
    }
    if (evidence.length === 0) return null
    return {
      evidence,
      expectation: '同一期限只保留一条关键日期（去重键应为 ruleId+起算日，不是措辞）；分期履行的多期用不同标签区分',
      action: removable.length > 0
        ? `delete_keydate(caseId, keyDateId) 删掉重复项：${removable.join('、')}`
        : '核对哪一条才是实际届满日，删掉错的那条（delete_keydate）',
    }
  },
}

/**
 * R2 裁判文书已送达，但法定期限没登记。
 * 后果：期限在无人察觉中流逝（0.2.11 的 2026-002 就是这种）。
 * 口径复用 `checkPeriodGate`——与闸门同源，不可能分叉。
 */
const ruleMissingPeriod: PatrolRule = {
  id: 'period.missing_after_service',
  name: '裁判文书已送达但期限未登记',
  severity: 'high',
  detect({ record, items, rules }) {
    // ⚠ 证据只认**事实**（日程/关键日期）：任务标题「领取裁判文书」是待办，不是送达证据。
    // 这里用 docNodesFromItems（内部已排除 task），别自己 map——踩过一次，多报 6 条。
    const gate = checkPeriodGate(record, rules, docNodesFromItems(items).get(s(record.caseId)))
    if (!gate.blocking || gate.docNode === undefined) return null
    const node = `${gate.docNode.title}${gate.docNode.date !== undefined ? `（${gate.docNode.date}）` : ''}`
    const evidence = [`档案里登记了「${node}」，但没有「${gate.missing.join(' 或 ')}」`]
    if (gate.derivedDueDate !== undefined) {
      evidence.push(`按规则推算届满日为 ${gate.derivedDueDate}${gate.overdue === true ? '（已过）' : ''}`)
    }
    return {
      evidence,
      expectation: '送达之日即起算不变期间，必须有对应的期限节点（并由规则表派生届满日）',
      action: gate.docNode.date !== undefined && gate.docNode.date !== ''
        ? `若送达属实：register_service(caseId, doc="${gate.suggestions[0]?.doc ?? '判决书'}", date="${gate.docNode.date}", procedure="${gate.suggestions[0]?.procedure ?? record.level ?? ''}")；若不实：delete_keydate 删掉该脏记录`
        : '先补齐送达日期，再 register_service 登记触发事由',
    }
  },
}

/**
 * R3 期限已过，但案件状态没推进。
 * 后果：案子该定分止争（生效/上诉/执行）却还挂在"上诉期"里，后续动作全部错过。
 * 这是用户明确要求的一条：「上诉期或某个期限已经过了，需要推进进展的，就提示推进」。
 */
const ruleExpiredNeedsProgress: PatrolRule = {
  id: 'period.expired_needs_progress',
  name: '期限已过但案件未推进',
  severity: 'high',
  detect({ record, items }) {
    const status = s(record.status)
    if (!PERIOD_STATE.test(status)) return null
    const T = today()
    const expired = keyDatesOf(items)
      .filter((k) => RELIEF_TERM.test(s(k.title)) && d(k.date) !== '' && d(k.date) < T && k.status !== 'done')
    if (expired.length === 0) return null
    const list = expired.map((k) => `${s(k.title)} ${d(k.date)}`).join('、')
    return {
      evidence: [`「${list}」已过，但案件状态仍是「${status}」`],
      expectation: '期限届满后案件应有明确去向：上诉→二审立案；不上诉→生效/归档；生效后→申请执行',
      action: `先核对是否已上诉/已申请执行：已上诉→update_case(status="appeal_filed") 并按二审轨建档；未上诉→update_case(status="closed")；再对该关键日期 toggle_keydate 标记已处理`,
    }
  },
}

/**
 * R4 开庭已过，但案件状态仍停在「庭前准备」。
 * 后果：庭后管理阶段的任务（代理词/领取文书/上诉期跟踪）永远不会被铺开。
 */
const ruleHearingPassedStateNotAdvanced: PatrolRule = {
  id: 'hearing.passed_state_not_advanced',
  name: '开庭已过但状态仍「庭前准备」',
  severity: 'high',
  detect({ record, items }) {
    if (s(record.status) !== 'pretrial') return null
    const T = today()
    const past = eventsOf(items)
      .filter((e) => /开庭/.test(s(e.title)) && d(e.date) !== '' && d(e.date) < T)
      .sort((a, b) => d(a.date).localeCompare(d(b.date)))
    const last = past[past.length - 1]
    if (last === undefined) return null
    return {
      evidence: [`「${s(last.title)}」${d(last.date)} 已开庭（今天 ${T}）`, `案件状态仍为「pretrial / 庭前准备」`],
      expectation: '开庭结束后应推进到庭后管理（等判决/补充代理意见），否则庭后任务不会展开',
      action: `update_case(caseId="${s(record.caseId)}", status="post_trial")，再 apply_stage_template 展开「庭后管理」阶段`,
    }
  },
}

/**
 * R4.5 已有「已立案」的证据，但状态仍停在立案之前。
 * 后果：庭前准备阶段的任务不会展开，举证期限/开庭排期无人跟。
 *
 * 证据：传票 / 受理通知 / 应诉通知 / 举证通知 / 缴费通知 / 开庭排期，
 * 或已登记案号（案号由法院立案后赋予）。
 */
const ruleFiledButStatusNotAdvanced: PatrolRule = {
  id: 'status.filed_but_not_advanced',
  name: '已有立案证据但状态仍「立案中」',
  severity: 'high',
  detect({ record, items }) {
    if (!PRE_FILING_STATE.test(s(record.status))) return null
    const hits: string[] = []
    // 只认**事实**（日程 + 关键日期）：任务「催问开庭排期」是待办，不能当已立案证据。
    for (const f of items.filter((i) => i.type !== 'task')) {
      const title = s(f.title)
      if (!FILED_EVIDENCE.test(title)) continue
      hits.push(`「${title}」${d(f.date) !== '' ? `（${d(f.date)}）` : ''}`)
    }
    const caseNumber = s(record.caseNumber)
    if (hits.length === 0 && caseNumber === '') return null
    if (caseNumber !== '') hits.push(`已登记案号「${caseNumber}」（案号由法院立案后赋予）`)
    return {
      evidence: [`案件状态仍是「${s(record.status)} / 立案前」`, `但已有已立案的证据：${hits.join('；')}`],
      expectation: '法院受理立案后状态应推进到庭前准备（pretrial），否则举证期限与开庭排期的任务不会展开',
      action: `update_case(caseId="${s(record.caseId)}", status="pretrial")，再 apply_stage_template 展开「庭前准备」阶段（开庭排期已知则带 anchorDate）`,
    }
  },
}

/**
 * R5 已结案，但仍有未完成任务。
 * 后果：台账里的待办会一直挂着；也说明结案可能结早了或任务没销。
 */
const ruleClosedWithOpenTasks: PatrolRule = {
  id: 'case.closed_with_open_tasks',
  name: '已结案仍有未完成任务',
  severity: 'medium',
  detect({ record, items }) {
    if (s(record.status) !== 'closed') return null
    const open = tasksOf(items).filter((t) => t.status !== 'done' && t.status !== 'cancelled')
    if (open.length === 0) return null
    return {
      evidence: [`案件已结案，但有 ${open.length} 条未完成任务：${open.slice(0, 3).map((t) => `「${s(t.title)}」`).join('、')}${open.length > 3 ? ' 等' : ''}`],
      expectation: '结案后不应残留未完成任务；确实做过的要销账，确实没做的要评估是否影响结案',
      action: `逐条核对后 upsert_task(caseId, groupId, taskId, status="done") 销账，或确认未做是否有后果`,
    }
  },
}

/** 第一批规则集（顺序 = 报告顺序）。 */
export const PATROL_RULES: PatrolRule[] = [
  ruleMissingPeriod,
  ruleExpiredNeedsProgress,
  ruleHearingPassedStateNotAdvanced,
  ruleFiledButStatusNotAdvanced,
  ruleDuplicateKeyDate,
  ruleClosedWithOpenTasks,
]

const SEVERITY_ORDER: Record<PatrolSeverity, number> = { high: 0, medium: 1, low: 2 }

/** 把一条 finding 的载荷 + 规则元信息组装成结果（含稳定指纹）。 */
function makeFinding(rule: PatrolRule, record: CaseRecord, hit: PatrolHit): PatrolFinding {
  const fingerprint = [record.caseId, rule.id, hit.evidence.join('¦')].join('|')
  return {
    ruleId: rule.id,
    ruleName: rule.name,
    severity: rule.severity,
    caseId: record.caseId,
    caseName: record.name,
    evidence: hit.evidence,
    expectation: hit.expectation,
    action: hit.action,
    fingerprint,
  }
}

export interface PatrolResult {
  /** 全部发现（按严重级 → 案件号排序）。 */
  findings: PatrolFinding[]
  /** 命中案件数（去重）。 */
  caseCount: number
  /** 一行摘要。 */
  summary: string
}

/**
 * 跑一遍巡检。
 *
 * @param cases - 案件记录（keyDates 已由 case-store 装配，但**证据以 items 为准**）。
 * @param itemsByCase - 各案的全部统一事项。
 * @param rules - 生效期限规则（内置 + 本地补丁表）。
 * @param opts.rules - 覆盖规则集（测试用）。
 */
export function runPatrol(
  cases: CaseRecord[],
  itemsByCase: Map<string, Item[]>,
  rules: PeriodRule[],
  opts: { rules?: PatrolRule[] } = {},
): PatrolResult {
  const ruleSet = opts.rules ?? PATROL_RULES
  const findings: PatrolFinding[] = []
  for (const record of cases) {
    const ctx: PatrolContext = { record, items: itemsByCase.get(record.caseId) ?? [], rules }
    for (const rule of ruleSet) {
      let hit: PatrolHit | null = null
      try {
        hit = rule.detect(ctx)
      } catch (error) {
        console.warn(`[agentlex-patrol] 规则 ${rule.id} 在案件 ${record.caseId} 上抛错（跳过）:`, error)
        continue
      }
      if (hit === null) continue
      findings.push(makeFinding(rule, record, hit))
    }
  }
  findings.sort((a, b) =>
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    || a.caseId.localeCompare(b.caseId)
    || a.ruleId.localeCompare(b.ruleId))
  const caseCount = new Set(findings.map((f) => f.caseId)).size
  const high = findings.filter((f) => f.severity === 'high').length
  const summary = findings.length === 0
    ? '案件账实核对：无异常。'
    : `案件账实核对：${findings.length} 项异常，涉及 ${caseCount} 个案件（其中高优先级 ${high} 项）`
  return { findings, caseCount, summary }
}

/** 供工具/路由复用：把 items 按案件归集。 */
export function groupItemsByCase(items: Item[]): Map<string, Item[]> {
  const map = new Map<string, Item[]>()
  for (const it of items) {
    const owner = s(it.ownerId)
    const list = map.get(owner) ?? []
    list.push(it)
    map.set(owner, list)
  }
  return map
}

/** 供测试/工具复用：单案跑一遍。 */
export function patrolCase(record: CaseRecord, items: Item[], rules: PeriodRule[], opts?: { rules?: PatrolRule[] }): PatrolFinding[] {
  return runPatrol([record], new Map([[s(record.caseId), items]]), rules, opts).findings
}

export { isServiceEvidence }
