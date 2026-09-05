/**
 * 案件信息完整度与缺口清单（诉讼域）。
 *
 * 与 stage-expansion 的分工：那边回答「下一步该展开什么」，这边回答
 * 「当前该有的信息还缺什么」。
 *
 * 关键设计：**完整度按阶段动态计算**。诉前阶段不缺法院案号，立案之后才缺；
 * 罚「现在还没有的信息」只会逼着管家去编数据，比空着更糟。因此每个字段
 * 规则都带一个起始状态次序（fromOrder），只有案件推进到该阶段才计入分母。
 */

import { getLitigationStatus } from '../../shared/playbook/litigation.ts'
import type { CaseRecord, CaseRegistry } from './store/types.ts'
import { detectStageSuggestions, resolveStageForCase, stageTasksOf } from './stage-expansion.ts'
import type { StageSuggestion } from './stage-expansion.ts'

/* ------------------------------------------------------------ 字段规则 */

export interface HealthGap {
  field: string
  label: string
  /** 为什么在这个阶段需要它。 */
  why: string
}

interface FieldRule {
  /** 从哪个状态次序开始要求（含）。次序取自该 level 阶梯的 order。 */
  fromOrder: number
  /**
   * 到哪个状态次序为止（含），省略表示之后都要求。
   */
  untilOrder?: number
  /**
   * 精确状态 id 触发（v0.2.4，跨轨安全）：命中该状态 id 即要求。
   * 不同 level 阶梯的 order 含义不同（一审庭后=5、劳动仲裁庭后=4），
   * 用 order 数字跨轨会错位，故对这类「特定档位才要求」的规则改用状态 id 集合。
   * 传了 statuses 时忽略 fromOrder/untilOrder。
   */
  statuses?: string[]
  field: string
  label: string
  why: string
  /** 取值器：返回空串表示缺失。 */
  read: (record: CaseRecord) => string
}

const s = (v: unknown): string => (v === undefined || v === null ? '' : String(v).trim())

/** 关键日期里是否存在任一指定标签（且未完成）。 */
function hasKeyDate(record: CaseRecord, labels: string[]): boolean {
  return (record.keyDates ?? []).some((k) => labels.includes(k.label) && k.done !== true)
}

/**
 * 登记信息要求表。
 * 次序按 docx 阶梯（一审：收案 1 / 诉前准备 2 / 立案中 3 / 庭前准备 4 / 庭后管理 5 / 上诉期 6 / 二审中 7）；
 * 特定位要求（开庭关键日期等）用 statuses 精确匹配，跨轨安全。
 */
export const FIELD_RULES: FieldRule[] = [
  { fromOrder: 1, field: 'type', label: '案件类型', why: '决定适用的程序规则与阶段模板', read: (r) => s(r.type) },
  { fromOrder: 1, field: 'ourSide', label: '我方身份', why: '原被告身份决定举证责任与期限起算点', read: (r) => s(r.ourSide) || s(r.parties?.ourSide) },
  { fromOrder: 1, field: 'parties', label: '当事人信息', why: '起诉状与授权手续的基础信息', read: (r) => ((r.parties?.details ?? []).length > 0 ? 'ok' : '') },
  { fromOrder: 2, field: 'claimAmount', label: '标的额', why: '关系到诉讼费计算、级别管辖与保全担保', read: (r) => s(r.claimAmount) },
  { fromOrder: 3, field: 'court', label: '受理法院', why: '立案后必须登记，是后续所有程序动作的对象', read: (r) => s(r.court) },
  { fromOrder: 3, field: 'caseNumber', label: '案号', why: '立案后法院即赋予案号，是卷宗检索主键', read: (r) => s(r.caseNumber) },
  { fromOrder: 3, field: 'filingDate', label: '立案日期', why: '举证期限与审限的起算锚点', read: (r) => s(r.filingDate) },
  { fromOrder: 4, field: 'judge', label: '承办法官', why: '庭前沟通与材料递交的对接对象', read: (r) => s(r.judge) },
  {
    // 开庭关键日期：庭前准备（含开庭排期）期间要求。用状态 id 跨轨匹配
    // （一审/二审/劳动仲裁/商事仲裁的 pretrial 档都是 order 不同但语义相同）。
    fromOrder: 4, statuses: ['pretrial'], field: 'keyDate:开庭', label: '开庭关键日期',
    why: '庭前准备的一切排期都以开庭日为锚点',
    read: (r) => (hasKeyDate(r, ['开庭']) ? 'ok' : ''),
  },
  {
    // 执行案件需登记 level（区分首次/恢复执行）。
    fromOrder: 7, statuses: ['filing', 'executing', 'terminated', 'recovery'], field: 'level', label: '执行阶段标识',
    why: '需区分首次执行与恢复执行',
    read: (r) => (r.level !== undefined && r.level !== '' && /执行/.test(s(r.level)) ? 'ok' : ''),
  },
  {
    // 裁判文书送达/上诉期届满：庭后管理与上诉期要求（送达日算上诉期）。
    fromOrder: 5, statuses: ['post_trial', 'appeal_window'], field: 'keyDate:裁判文书送达', label: '裁判文书送达/上诉期届满',
    why: '送达之日开始计算上诉期，是不可顺延的不变期间',
    read: (r) => (hasKeyDate(r, ['裁判文书送达', '上诉期届满']) ? 'ok' : ''),
  },
  {
    // 执行立案/到账：执行立案与执行中状态要求。
    fromOrder: 7, statuses: ['filing', 'executing', 'terminated', 'recovery'], field: 'keyDate:执行立案', label: '执行立案/执行款项到账',
    why: '执行案件的查控进度与回款预期依赖这两个节点',
    read: (r) => (hasKeyDate(r, ['执行立案', '执行款项到账']) ? 'ok' : ''),
  },
]

/* ------------------------------------------------------------ 体检结果 */

export interface CaseHealth {
  caseId: string
  name: string
  status?: string
  statusLabel: string
  stage: {
    id?: string
    name?: string
    total: number
    done: number
    open: number
  }
  completeness: {
    score: number
    filled: number
    total: number
    gaps: HealthGap[]
  }
  /** 期限引擎给出的近期/逾期事项（引擎未挂载时省略）。 */
  deadlines?: unknown
  /** 阶段推进建议（与 stage_suggestions 同源）。 */
  suggestions: StageSuggestion[]
}

export interface HealthOptions {
  /** 期限引擎摘要；传入后才会在结果里带上 deadlines。 */
  deadlines?(caseId: string): unknown | Promise<unknown>
}

/** 计算单个案件的体检结果。 */
export async function computeCaseHealth(
  record: CaseRecord,
  opts: HealthOptions = {},
): Promise<CaseHealth> {
  const statusId = s(record.status) === '' ? 'intake' : s(record.status)
  const statusDef = getLitigationStatus(statusId, record.level)
  const order = statusDef.order

  const applicable = FIELD_RULES.filter((rule) => {
    // v0.2.4：带 statuses 的规则按当前状态 id 精确匹配（跨轨安全）；
    // 否则按 order 数字（仅对从收案起一直要求的基础字段）。
    if (rule.statuses !== undefined && rule.statuses.length > 0) {
      return rule.statuses.includes(statusId)
    }
    if (order < rule.fromOrder) return false
    return rule.untilOrder === undefined || order <= rule.untilOrder
  })
  const gaps: HealthGap[] = []
  let filled = 0
  for (const rule of applicable) {
    if (rule.read(record) !== '') filled++
    else gaps.push({ field: rule.field, label: rule.label, why: rule.why })
  }
  const total = applicable.length
  const score = total === 0 ? 100 : Math.round((filled / total) * 100)

  // 阶段进度（含散落在别组但 templateTitle 属本阶段的任务，备忘录 #10）
  // v0.3.0：按案件 level 选轨 → status 解析阶段；无对应阶段则留空。
  const stageDef = resolveStageForCase(record)
  let stage: CaseHealth['stage'] = { total: 0, done: 0, open: 0 }
  if (stageDef !== undefined) {
    const tasks = stageTasksOf(record, stageDef.id, record.level)
    stage = {
      id: stageDef.id,
      name: stageDef.name,
      total: tasks.length,
      done: tasks.filter((t) => t.status === 'done').length,
      open: tasks.filter((t) => t.status !== 'done').length,
    }
  }

  const suggestions = detectStageSuggestions(
    { registryVersion: '1.0', cases: { [record.caseId]: record } } as CaseRegistry,
    record.caseId,
  )[0]?.suggestions ?? []

  const health: CaseHealth = {
    caseId: record.caseId,
    name: record.name,
    status: statusId,
    statusLabel: statusDef.label,
    stage,
    completeness: { score, filled, total, gaps },
    suggestions,
  }
  if (opts.deadlines !== undefined) {
    health.deadlines = await opts.deadlines(record.caseId)
  }
  return health
}

/**
 * 扫描全部案件。默认跳过已结案（结案案件的信息缺口属于归档范畴，
 * 混在日常体检里会稀释真正紧急的事项）；按完整度升序排列，最需要补的在前。
 */
export async function computeRegistryHealth(
  registry: CaseRegistry,
  opts: HealthOptions & { includeClosed?: boolean } = {},
): Promise<CaseHealth[]> {
  const out: CaseHealth[] = []
  for (const record of Object.values(registry.cases)) {
    if (!opts.includeClosed && s(record.status) === 'closed') continue
    out.push(await computeCaseHealth(record, opts))
  }
  out.sort((a, b) => a.completeness.score - b.completeness.score)
  return out
}
