/**
 * 法定期限「闸门 + 每日巡检」（0.2.12）。
 *
 * 0.2.11 把「登记范式」换成了「只给事实、系统算届满日」，但**没有人负责检查
 * 「该登记的到底登记了没有」**——状态推进到庭后/上诉期，案件却没有任何法定
 * 期限，系统一路绿灯。本模块补上这道闸门：
 *
 *  - **闸门（write-time）**：案件状态变化时顺带复查一遍（自然的检查点）。
 *  - **每日巡检（read-time）**：每天扫全量，兜住历史存量与漏改。
 *
 * ⚠ **触发条件只认一件事：该案已有「裁判文书」类节点**（判决/裁定/裁决/送达）。
 *
 * 为什么不能用状态当条件（0.2.12 修正，用户指出）：`庭后管理`（post_trial）只是
 * 「开完庭、等判决」——**上诉期根本还没起算**，没有任何东西该登记。按状态触发会把
 * 一堆正常等判决的案件报成缺口（实测 8 个里 7 个是误报）。不变期间的起算**只取决于
 * 裁判文书送达**，与状态档位无关：
 *   - 文书没到 → 什么都不该登记（静默）；
 *   - 文书到了 → 期限必须在跑，没登记就是**确定的漏登**（这才是要抓的）。
 *
 * 判定口径：期限是否已登记 = 该案关键日期里存在**规范术语**（该程序轨下由裁判
 * 文书触发的规则 `term`）的条目。术语由规则表派生，不用硬编码词表——劳动仲裁案
 * 登「起诉期届满」不会被判缺失（0.2.11 修缺陷 B 的口径延续）。
 */

import type { CaseRecord } from './store/types.ts'
import {
  PERIOD_RULES, derivePeriod,
  type PeriodRule,
} from '../../shared/playbook/period-rules.ts'

/**
 * 候选节点（粗筛）：标题里出现裁判文书类字样的节点，供 `docNodesFromItems` 收集。
 * 粗筛只为省内存，**真正的触发判定用 SERVICE_EVIDENCE**。
 */
const DOC_NODE = /判决|裁定|裁决|裁判文书/

/**
 * 触发证据（精筛）：**裁判文书已经送达**。
 *
 * 光有「判决」字样不够——`判决履行期限届满` 是期限、`财产保全裁定` 是保全裁定、
 * `一审判决作出` 只是作出（送达前不起算），`准予撤诉裁定书送达` 的撤诉裁定不产生
 * 上诉期。实测：按「含判决/裁定/裁决」粗筛会在真实数据上命中 25 个案件（其中 7 个
 * 已结案），全是噪声；按下面这条精筛只剩 2 个，且其中 1 个是真缺口。
 *
 * 条件：标题同时含【裁判文书类文书】与【送达/收到/领取】，且不含【无上诉期的裁定】。
 */
const JUDGMENT_DOC_TITLE = /(判决书|裁定书|裁决书|裁判文书)/
const SERVED_WORD = /(送达|收到|领取)/
/** 这些裁定/程序不产生上诉期，命中即排除。 */
const NO_PERIOD_WORD = /(撤诉|保全|管辖|指定|不予受理|执行)/

/** 该节点是否构成「裁判文书已送达」的证据。 */
export function isServiceEvidence(title: string): boolean {
  const t = s(title)
  if (t === '') return false
  return JUDGMENT_DOC_TITLE.test(t) && SERVED_WORD.test(t) && !NO_PERIOD_WORD.test(t)
}

/** 裁判文书类触发文书（规则表里这些文书送达后才起算不变期间）。 */
const JUDGMENT_DOC = /判决书|裁定书|裁决书/

const s = (v: unknown): string => (v === undefined || v === null ? '' : String(v).trim())

/**
 * 该案在当前程序轨下、由裁判文书触发的规范术语集合（按审级匹配）。
 *
 * 旧版硬编码 `['裁判文书送达','上诉期届满']` 是诉讼程序中心词表：劳动仲裁案按
 * 正确术语登记「起诉期届满」反而被判缺失，等于**把管家推向错误的「上诉期」**。
 */
export function expectedJudgmentTerms(record: CaseRecord, rules: PeriodRule[] = PERIOD_RULES): string[] {
  const procedure = s(record.level)
  const terms = rules
    .filter((r) => (procedure === '' || r.scope.procedure === procedure) && JUDGMENT_DOC.test(r.trigger.doc))
    .map((r) => r.term)
  const unique = [...new Set(terms)]
  return unique.length > 0 ? unique : ['上诉期届满']
}

/** 派生建议：告诉管家该登记哪份文书、会派生出什么期间、依据什么。 */
export interface PeriodSuggestion {
  /** 触发文书名（喂给 register_service 的 doc）。 */
  doc: string
  /** 事实类型（送达/收到/生效）。 */
  fact: string
  procedure: string
  /** 规范术语（登记后关键日期的标签）。 */
  term: string
  /** 法律依据。 */
  cite: string
  /** 期间长度人读描述。 */
  length: string
  ruleId: string
}

export interface PeriodGateResult {
  /** true = 需要提示：已有裁判文书节点，但该轨法定期限没有登记。 */
  blocking: boolean
  /** 缺失的规范术语（该程序轨下应登记的）。 */
  missing: string[]
  /** 派生建议（可直接喂 register_service）。 */
  suggestions: PeriodSuggestion[]
  /** 人读提示。 */
  notice: string
  /** 触发本次提示的裁判文书节点（标题 + 日期），用于说明「凭什么说期限该登记了」。 */
  docNode?: { title: string; date?: string }
  /** 按规则推算的届满日（有送达日时才有）——用来判断这个期限是不是已经过了。 */
  derivedDueDate?: string
  /** 推算届满日已过（`derivedDueDate < 今天`）。 */
  overdue?: boolean
}

const lengthDesc = (r: PeriodRule): string =>
  r.period.days !== undefined ? `${r.period.days} 日`
    : r.period.months !== undefined ? `${r.period.months} 个月`
      : `${r.period.years} 年`

/** 该案的文书节点（来自 items 事件 + 关键日期），用于判断裁判文书到了没有。 */
export interface DocNode {
  title: string
  date?: string
}

/**
 * 从统一事项里挑出裁判文书类节点，按案件归集（巡检/闸门的证据来源）。
 *
 * ⚠ **只认事实，不认待办**：任务标题（如「领取裁判文书」是"去领"这个待办）不是
 * 送达证据。实测把任务算进来会多出 4 个误报（032/033/035/037 的「领取裁判文书」
 * 都还是 pending 任务）。所以只收 event/both 与 keydate。
 */
export function docNodesFromItems(
  items: Array<{ ownerId?: string; type?: string; title?: string; date?: string }>,
): Map<string, DocNode[]> {
  const map = new Map<string, DocNode[]>()
  for (const it of items) {
    if (s(it.type) === 'task') continue
    const title = s(it.title)
    if (title === '' || !DOC_NODE.test(title)) continue
    const owner = s(it.ownerId)
    const list = map.get(owner) ?? []
    list.push({ title, date: s(it.date) || undefined })
    map.set(owner, list)
  }
  return map
}

/**
 * 闸门检查：该案的裁判文书到了、期限登记了吗？
 *
 * @param record - 案件记录（keyDates 已由 case-store 从 items 装配）。
 * @param rules - 生效规则集合（内置 + 本地补丁表）。
 * @param docNodes - 该案的文书节点（items 事件 + 关键日期）；缺省只用 record.keyDates。
 */
export function checkPeriodGate(
  record: CaseRecord,
  rules: PeriodRule[] = PERIOD_RULES,
  docNodes?: DocNode[],
): PeriodGateResult {
  const empty: PeriodGateResult = { blocking: false, missing: [], suggestions: [], notice: '' }
  // 已确认无需在本案登记（如二审独立建档、一审案的上诉期由二审案跟踪）→ 不再提醒。
  if (record.periodGateMuted !== undefined) return empty

  // 已结案：程序已了结，没有期限需要保护（实测真实数据里 25 个命中中 7 个是已结案）。
  if (s(record.status) === 'closed') return empty

  // **触发条件（精筛）**：已有「裁判文书送达」类节点——这是不变期间**已起算**的唯一证据。
  // 没有它 → 文书还没到（典型：开完庭等判决的「庭后管理」），什么都不该登记，静默返回。
  const nodes = docNodes ?? (record.keyDates ?? []).map((k) => ({ title: s(k.label), date: s(k.date) || undefined }))
  const trigger = nodes.find((n) => isServiceEvidence(n.title))
  if (trigger === undefined) return empty

  const status = s(record.status)

  const procedure = s(record.level)
  const terms = expectedJudgmentTerms(record, rules)
  const registered = new Set(
    (record.keyDates ?? [])
      .filter((k) => k.done !== true)
      .map((k) => s(k.label)),
  )
  // **任一即满足**：同一程序轨下的规范术语是**互斥的备选救济路径**，不是并列义务
  // （劳动仲裁终局裁决：劳动者 15 日起诉 / 用人单位 30 日申请撤裁，只适用其中一条；
  //  非终局裁决则只有起诉期）。要求「全部登记」会把正确登记的案件判成缺失。
  // 判定与 health.ts 的 hasNode（labels.some）保持同一口径。
  if (terms.some((t) => registered.has(t))) return empty
  const missing = terms

  // 派生建议：该程序轨下、由裁判文书触发的规则（每条给一份可落库的建议）。
  const suggestions: PeriodSuggestion[] = rules
    .filter((r) => (procedure === '' || r.scope.procedure === procedure) && JUDGMENT_DOC.test(r.trigger.doc))
    .map((r) => ({
      doc: r.trigger.doc,
      fact: r.trigger.fact,
      procedure: r.scope.procedure,
      term: r.term,
      cite: r.cite,
      length: lengthDesc(r),
      ruleId: r.id,
    }))

  // 该轨没有可用规则 → 不提示（否则每天都变成「去提案」，是噪声）。
  // 提案是管家遇到未知文书时的动作，不是每日提醒的内容。
  if (suggestions.length === 0) return empty

  // 推算届满日：拿送达日 + 第一条候选规则算一遍（确定性，不猜）。
  // 这一步是给提示用的——「期限没登记」在期限**已经过了**的时候是完全不同的事，
  // 那时该说的是「核对是否已上诉」，而不是「请去登记」。
  let derivedDueDate: string | undefined
  if (trigger.date !== undefined && trigger.date !== '') {
    const rule = rules.find((r) => r.id === suggestions[0]!.ruleId)
    if (rule !== undefined) derivedDueDate = derivePeriod(rule, trigger.date).dueDate
  }
  const today = new Date().toISOString().slice(0, 10)
  const overdue = derivedDueDate !== undefined && derivedDueDate < today

  const docs = suggestions.map((x) => `${x.doc}${x.fact}日`).join(' / ')
  const nodeLabel = `${trigger.title}${trigger.date !== undefined ? `（${trigger.date}）` : ''}`
  // ⚠ 措辞纪律：**不断言「文书已送达」**。我们只看到"档案里登记了这个节点"，
  // 记录可能是预判/测试数据（实测 2026-034 就是一条脏记录）。所以这里是"记录待核对"
  // ——把两种可能和对应的动作都摆出来，判断权在律师。
  const due = derivedDueDate !== undefined ? `按规则推算届满日为 ${derivedDueDate}。` : ''
  const notice = overdue
    ? `⚠ 记录待核对：该案登记了「${nodeLabel}」，但没有「${missing.join(' 或 ')}」。` +
      `${due}**该推算日已过** —— 若送达属实，请立即核对是否已上诉/已申请撤裁（如已处理请补记）；` +
      '若这条送达记录不实，请用 delete_keydate 删掉它（脏记录比缺失更有害）。'
    : `⚠ 记录待核对：该案登记了「${nodeLabel}」，但没有「${missing.join(' 或 ')}」。${due}` +
      `若送达属实 → 用 register_service 补登记（只给触发事由：${docs}，届满日由规则表派生）；` +
      '若这条送达记录不实 → 用 delete_keydate 删掉它。'

  return { blocking: true, missing, suggestions, notice, docNode: trigger, derivedDueDate, overdue }
}

/** 巡检结果的一行。 */
export interface PeriodPatrolRow {
  caseId: string
  name: string
  status: string
  level?: string
  court?: string
  missing: string[]
  suggestions: PeriodSuggestion[]
  /** 触发本次提示的裁判文书节点。 */
  docNode?: DocNode
  /** 按规则推算的届满日。 */
  derivedDueDate?: string
  /** 推算届满日已过。 */
  overdue?: boolean
  /** 建议用的工具调用摘要（管家可直接照做）。 */
  action: string
}

export interface PeriodPatrolResult {
  /** 命中案件数。 */
  count: number
  rows: PeriodPatrolRow[]
  /** 一行摘要（日志/推送用）。 */
  summary: string
}

/**
 * 每日巡检：扫描「**裁判文书已到、但法定期限没登记**」的案件。
 *
 * 闸门只在状态变化时复查，巡检兜住历史存量与漏改——两者共用 checkPeriodGate，
 * 口径不可能分叉。**等判决的案件不会被扫到**（没有裁判文书节点 → 静默）。
 *
 * @param cases - 案件记录集合（keyDates 已装配）。
 * @param rules - 生效规则集合。
 * @param docNodesByCase - 各案的裁判文书节点（items 事件 + 关键日期）；缺省只用 keyDates。
 */
export function patrolPeriodGaps(
  cases: CaseRecord[],
  rules: PeriodRule[] = PERIOD_RULES,
  docNodesByCase?: Map<string, DocNode[]>,
): PeriodPatrolResult {
  const rows: PeriodPatrolRow[] = []
  for (const rec of cases) {
    const gate = checkPeriodGate(rec, rules, docNodesByCase?.get(rec.caseId))
    if (!gate.blocking) continue
    const first = gate.suggestions[0]
    rows.push({
      caseId: rec.caseId,
      name: rec.name,
      status: s(rec.status),
      level: rec.level,
      court: rec.court,
      missing: gate.missing,
      suggestions: gate.suggestions,
      docNode: gate.docNode,
      derivedDueDate: gate.derivedDueDate,
      overdue: gate.overdue,
      action: first !== undefined
        // 文书节点已在，只差期限登记 → 直接补（register_service 幂等，不会重复建送达日程）。
        ? `register_service(caseId="${rec.caseId}", doc="${first.doc}", date="${gate.docNode?.date ?? `<${first.fact}日>`}", procedure="${first.procedure}")`
        : `propose_period_rule(caseId="${rec.caseId}", …)`,
    })
  }
  rows.sort((a, b) => a.caseId.localeCompare(b.caseId))
  const overdueRows = rows.filter((r) => r.overdue === true)
  const summary = rows.length === 0
    ? '法定期限记录巡检：无待核对项。'
    : `法定期限记录巡检：${rows.length} 个案件登记了裁判文书送达、但没有期限登记` +
      (overdueRows.length > 0 ? `（其中 ${overdueRows.length} 个推算届满日已过：${overdueRows.map((r) => r.caseId).join('、')}）` : '') +
      ` —— ${rows.map((r) => `${r.caseId}(${r.missing.join('/')})`).join('、')}`
  return { count: rows.length, rows, summary }
}

/** 供工具/路由复用：把一条建议渲染成「为什么是这天」的预览（不落库）。 */
export function previewSuggestion(
  suggestion: PeriodSuggestion,
  baseDate: string,
  rules: PeriodRule[] = PERIOD_RULES,
): { dueDate?: string; trace?: string } {
  const rule = rules.find((r) => r.id === suggestion.ruleId)
  if (rule === undefined || baseDate === '') return {}
  const derived = derivePeriod(rule, baseDate)
  return { dueDate: derived.dueDate, trace: derived.computeTrace }
}
