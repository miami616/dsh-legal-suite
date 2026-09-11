/**
 * 法定期限规则表（PeriodRule）——把「期限」从模型手算变成系统派生。
 *
 * 设计（docs/期限规则表设计.md）：
 *   - 表管「算」与「依据」：天数、起算、末日顺延、规范术语、法律依据；
 *   - 模型管「认」与「判」：从文书里读出触发事由，以及终局/非终局这类定性；
 *   - 管家只登记触发事由（收到什么文书、何时送达），届满日由本模块派生。
 *
 * 边界：只收「法条直接规定期间长度」的期间。法院在文书中指定的期间（如举证
 * 期限）不入表，登记仍以通知书载明日期为准。
 *
 * ⚠ 术语与期间一律以现行法律与受诉法院口径为准；派生结果带 cite 供复核，
 *   规则表不替代对期限的实质判断。
 */

/** 期间长度：日 / 月 / 年（三者取其一）。 */
export interface PeriodLength {
  days?: number
  months?: number
  years?: number
}

/** 规则适用范围。procedure 必填；其余留空表示不限制。 */
export interface PeriodScope {
  /** 程序轨：劳动仲裁/一审/二审/再审/首次执行/恢复执行/商事仲裁。 */
  procedure: string
  /** 案件类型（劳动争议/民商/刑事/行政/知产…）。留空 = 不限。 */
  caseType?: string[]
  /** 当事人地位（申请人/被申请人/原告/被告/上诉人/被上诉人…）。留空 = 双方均适用。 */
  party?: string[]
  /** 我方实体身份（劳动者/用人单位），用于区分终局裁决的救济路径。 */
  clientRole?: string[]
  /** 文书种类限定（非终局裁决/终局裁决/判决/裁定）。留空 = 不限。 */
  docKind?: string[]
  /**
   * 受理法院限定（**地方法院口径补丁**用）：如 ['济南市历下区人民法院']。
   * 留空 = 全国通用口径。带 court 的规则在匹配时算作更具体的一维，
   * 因此本地补丁可以「只在某法院覆盖通用口径」而不必改内置表。
   */
  court?: string[]
}

/** 触发事由：收到/发生什么。 */
export interface PeriodTrigger {
  /** 文书名（如「仲裁裁决书」「判决书」）；也接受「仲裁裁决书」这类包含匹配。 */
  doc: string
  /** 事实类型。 */
  fact: '送达' | '收到' | '作出' | '生效'
}

export interface PeriodRule {
  /** 稳定语义键——去重、幂等、审计一律用它，不用 label。 */
  id: string
  /**
   * 停用：不参与 matchPeriodRules 匹配。
   *
   * 用于 scope 已知有语义错误、但暂时无法正确表达（需要跨案信息）的规则——
   * 宁可先不生成，也不要生成废纸期限。
   */
  disabled?: boolean
  scope: PeriodScope
  trigger: PeriodTrigger
  period: PeriodLength
  /** 起算点说明（人读）。 */
  start: { from: string; excludeStartDay?: boolean }
  /** 末日落法定休假日时顺延（民诉法 §85）。 */
  rollForward: boolean
  /** 规范术语——关键日程的 label 用它，一个期限只有一个名字。 */
  term: string
  /** 逾期后果（说明用，不作为日程状态）。 */
  effect: string
  /** 关联 LEAD_TIME_RULES 的锚点，用于派生提前量任务链。 */
  anchor?: string
  /** 法律依据。 */
  cite: string
  /** 生效区间（法条修订可追溯）。 */
  effective: { from: string; to?: string }
  confidence: 'statutory' | 'local-practice' | 'proposed'
}

/* ------------------------------------------------------------ 规则表 */

/**
 * 内置法定期限规则。
 *
 * 收表原则：只收**法条直接规定期间长度**的不变期间/法定期间。
 * 增补规则时务必同时给 cite 与 effective，否则无法审计。
 */
export const PERIOD_RULES: PeriodRule[] = [
  /* ------------------------- 劳动仲裁轨 ------------------------- */
  {
    id: 'labor_arbitration.claim_against_award',
    scope: { procedure: '劳动仲裁', caseType: ['劳动争议'], docKind: ['非终局裁决'] },
    trigger: { doc: '仲裁裁决书', fact: '送达' },
    period: { days: 15 },
    start: { from: '收到仲裁裁决书之日', excludeStartDay: true },
    rollForward: true,
    term: '起诉期届满',
    effect: '逾期不起诉的，仲裁裁决发生法律效力',
    anchor: '起诉期届满',
    cite: '劳动争议调解仲裁法 §50',
    effective: { from: '2008-05-01' },
    confidence: 'statutory',
  },
  {
    id: 'labor_arbitration.claim_against_final_award_worker',
    scope: { procedure: '劳动仲裁', caseType: ['劳动争议'], docKind: ['终局裁决'], clientRole: ['劳动者'] },
    trigger: { doc: '仲裁裁决书', fact: '送达' },
    period: { days: 15 },
    start: { from: '收到仲裁裁决书之日', excludeStartDay: true },
    rollForward: true,
    term: '起诉期届满',
    effect: '劳动者对终局裁决不服的，可自收到裁决书之日起 15 日内向人民法院起诉',
    anchor: '起诉期届满',
    cite: '劳动争议调解仲裁法 §48',
    effective: { from: '2008-05-01' },
    confidence: 'statutory',
  },
  {
    id: 'labor_arbitration.revoke_final_award_employer',
    scope: { procedure: '劳动仲裁', caseType: ['劳动争议'], docKind: ['终局裁决'], clientRole: ['用人单位'] },
    trigger: { doc: '仲裁裁决书', fact: '送达' },
    period: { days: 30 },
    start: { from: '收到仲裁裁决书之日', excludeStartDay: true },
    rollForward: true,
    term: '撤销裁决申请期届满',
    effect: '用人单位可自收到终局裁决之日起 30 日内向劳动争议仲裁委员会所在地的中级人民法院申请撤销',
    cite: '劳动争议调解仲裁法 §49',
    effective: { from: '2008-05-01' },
    confidence: 'statutory',
  },
  {
    id: 'labor_arbitration.defense',
    scope: { procedure: '劳动仲裁', caseType: ['劳动争议'] },
    trigger: { doc: '仲裁申请书副本', fact: '送达' },
    period: { days: 10 },
    start: { from: '收到仲裁申请书副本之日', excludeStartDay: true },
    rollForward: true,
    term: '答辩期届满',
    effect: '被申请人应在收到仲裁申请书副本之日起 10 日内提交答辩书',
    cite: '劳动人事争议仲裁办案规则 §31',
    effective: { from: '2017-07-01' },
    confidence: 'statutory',
  },

  /* --------------------------- 民事一审 --------------------------- */
  {
    id: 'civil_first_instance.appeal_judgment',
    scope: { procedure: '一审', caseType: ['民商', '民事', '行政', '知识产权', '劳动争议'] },
    trigger: { doc: '判决书', fact: '送达' },
    period: { days: 15 },
    start: { from: '判决书送达之日', excludeStartDay: true },
    rollForward: true,
    term: '上诉期届满',
    effect: '逾期未上诉的，一审判决发生法律效力',
    anchor: '上诉期届满',
    cite: '民事诉讼法 §171（2023 修正）',
    effective: { from: '2024-01-01' },
    confidence: 'statutory',
  },
  {
    id: 'civil_first_instance.appeal_ruling',
    scope: { procedure: '一审', caseType: ['民商', '民事', '行政', '知识产权', '劳动争议'] },
    trigger: { doc: '裁定书', fact: '送达' },
    period: { days: 10 },
    start: { from: '裁定书送达之日', excludeStartDay: true },
    rollForward: true,
    term: '上诉期届满',
    effect: '逾期未上诉的，一审裁定发生法律效力',
    anchor: '上诉期届满',
    cite: '民事诉讼法 §171（2023 修正）',
    effective: { from: '2024-01-01' },
    confidence: 'statutory',
  },
  {
    id: 'civil_first_instance.defense',
    scope: { procedure: '一审', caseType: ['民商', '民事', '行政', '知识产权', '劳动争议'] },
    trigger: { doc: '起诉状副本', fact: '送达' },
    period: { days: 15 },
    start: { from: '收到起诉状副本之日', excludeStartDay: true },
    rollForward: true,
    term: '答辩期届满',
    effect: '被告应在收到起诉状副本之日起 15 日内提出答辩状（不答辩不影响审理）',
    anchor: '答辩期届满',
    cite: '民事诉讼法 §128（2023 修正）',
    effective: { from: '2024-01-01' },
    confidence: 'statutory',
  },

  /* --------------------------- 民事二审 --------------------------- */
  {
    id: 'civil_second_instance.appeal_judgment',
    scope: { procedure: '二审', caseType: ['民商', '民事', '行政', '知识产权', '劳动争议'] },
    trigger: { doc: '判决书', fact: '送达' },
    period: { days: 15 },
    start: { from: '判决书送达之日', excludeStartDay: true },
    rollForward: true,
    term: '上诉期届满',
    effect: '二审判决为终审判决，送达即生效（此期间仅适用于需另循再审/申请再审路径的判断）',
    anchor: '上诉期届满',
    cite: '民事诉讼法 §171（2023 修正，二审终审）',
    effective: { from: '2024-01-01' },
    confidence: 'local-practice',
  },

  /* --------------------------- 刑事 --------------------------- */
  {
    id: 'criminal.appeal_judgment',
    scope: { procedure: '刑事', caseType: ['刑事'] },
    trigger: { doc: '判决书', fact: '送达' },
    period: { days: 10 },
    start: { from: '接到判决书之日', excludeStartDay: true },
    rollForward: false,
    term: '上诉期届满',
    effect: '逾期未上诉、抗诉的，判决发生法律效力（在押期间不因节假日延长，此处从严不顺延）',
    anchor: '上诉期届满',
    cite: '刑事诉讼法 §230',
    effective: { from: '2018-10-26' },
    confidence: 'statutory',
  },
  {
    id: 'criminal.appeal_ruling',
    scope: { procedure: '刑事', caseType: ['刑事'] },
    trigger: { doc: '裁定书', fact: '送达' },
    period: { days: 5 },
    start: { from: '接到裁定书之日', excludeStartDay: true },
    rollForward: false,
    term: '上诉期届满',
    effect: '逾期未上诉、抗诉的，裁定发生法律效力（在押期间不因节假日延长，此处从严不顺延）',
    anchor: '上诉期届满',
    cite: '刑事诉讼法 §230',
    effective: { from: '2018-10-26' },
    confidence: 'statutory',
  },

  /* --------------------------- 执行 --------------------------- */
  {
    id: 'enforcement.apply',
    /**
     * ⚠ 0.2.13 停用（disabled）。
     *
     * 原 scope 是 `procedure: '首次执行'`——但「申请执行期限」的前提是**还没申请执行**，
     * 挂在执行案上毫无意义（2026-09-11 实测：2026-040 执行案自己挂着一条
     * 「申请执行期限届满 2028-07-05」，2026-025 二审案挂着一条而执行案 2026-041
     * 早已在 executing）。
     *
     * 正确的 scope 是**实质审理程序**（一审/二审/再审/仲裁）里"生效法律文书已生效、
     * 对方未履行、且我方尚未申请执行"的案件。最后那个条件需要跨案判断（同案是否已
     * 有执行案），0.2.13 未实现——宁可先不生成，也不要生成废纸期限。
     * 重新启用前先补：① scope.procedure 支持多值；② 「已有执行案」判定。
     */
    disabled: true,
    scope: { procedure: '首次执行' },
    trigger: { doc: '生效法律文书', fact: '生效' },
    period: { years: 2 },
    start: { from: '法律文书规定履行期间的最后一日起', excludeStartDay: true },
    rollForward: true,
    term: '申请执行期限届满',
    effect: '逾期申请执行的，法院不予受理（可申请中止/中断）',
    anchor: '申请执行期限届满',
    cite: '民事诉讼法 §250（2023 修正）',
    effective: { from: '2024-01-01' },
    confidence: 'statutory',
  },
]

/* ---------------------------------------------------------- 节假日 */

/**
 * 法定休假日表（含调休）。
 *
 * ⚠ 0.2.11 暂为空表：`rollForward` 目前只处理周六/周日。年度节假日表
 *   （春节/国庆长假与调休）接入后，只需往这里加 `YYYY-MM-DD` 即可生效——
 *   派生结果会记入 trace，因此表补全后已办案件的顺延可复核。
 */
export const HOLIDAYS: ReadonlySet<string> = new Set<string>()

/* -------------------------------------------------------- 匹配与派生 */

/** 触发事由（管家/模型给出的事实）。 */
export interface PeriodRequest {
  procedure: string
  /** 文书名（如「仲裁裁决书」）。 */
  doc?: string
  /** 事实类型。 */
  fact?: PeriodTrigger['fact']
  /** 送达/收到/生效之日 YYYY-MM-DD。 */
  date: string
  party?: string
  clientRole?: string
  docKind?: string
  caseType?: string
  /** 受理法院（地方法院口径补丁匹配用）。 */
  court?: string
}

export interface PeriodCandidate {
  rule: PeriodRule
  /** 匹配上的 scope 字段个数，用于排序与歧义判定。 */
  specificity: number
}

/**
 * 词表匹配。`mode`：
 *   - 'exact'（默认）：严格相等——docKind/clientRole 必须精确，
 *     因为「非终局裁决」包含「终局裁决」子串，宽松匹配会把两条规则同时命中。
 *   - 'prefix'：相等或以规则词开头（如「第一被申请人」匹配「被申请人」）。
 *
 * 请求侧**未给出**该维度时不排除候选（`ok: true`）但记为「未定」（resolved:false）：
 * 这样「终局裁决但未说明我方是劳动者还是用人单位」会同时列出 15 日起诉与 30 日
 * 撤裁两条并列候选，交由模型/律师定性，而不是静默漏掉一条。
 */
function matchToken(
  list: string[] | undefined,
  value: string | undefined,
  mode: 'exact' | 'prefix' = 'exact',
): { ok: boolean; resolved: boolean } {
  if (list === undefined || list.length === 0) return { ok: true, resolved: false }
  if (value === undefined || value === '') return { ok: true, resolved: false }
  const hit = mode === 'exact' ? list.includes(value) : list.some((item) => item === value || value.startsWith(item))
  return { ok: hit, resolved: hit }
}

/** 文书名匹配：规则 doc 与请求 doc 双向包含（「仲裁裁决书」⊂「劳动仲裁裁决书」）。 */
function docMatch(ruleDoc: string, reqDoc: string | undefined): boolean {
  if (reqDoc === undefined || reqDoc === '') return true
  return reqDoc.includes(ruleDoc) || ruleDoc.includes(reqDoc)
}

/**
 * 生效规则集合 = 内置表 + 本地补丁表（按 id 覆盖既有 / 新增本地口径规则）。
 *
 * **`confidence: 'proposed'` 的规则一律不生效**——模型提案只是「待确认的草案」，
 * 必须经律师 `resolve_period_rule(accept)` 转成 `local-practice` 后才进补丁表。
 * 这条是硬闸门：模型不得凭提案当已生效规则用（否则等于模型自己发明了期间长度）。
 */
export function mergePeriodRules(
  overrides: PeriodRule[] = [],
  builtin: PeriodRule[] = PERIOD_RULES,
): PeriodRule[] {
  const byId = new Map<string, PeriodRule>()
  for (const r of builtin) byId.set(r.id, r)
  for (const o of overrides) {
    if (o === undefined || o === null || o.id === undefined || o.id === '') continue
    if (o.confidence === 'proposed') continue
    byId.set(o.id, o)
  }
  return [...byId.values()]
}

/**
 * 按触发事由匹配规则，返回按具体度降序的候选。
 *
 * 只做确定性匹配，不猜：候选 > 1 时应由模型结合案情判断或问律师
 * （如终局裁决未定性时会出现 15 日起诉与 30 日撤裁两条候选）。
 */
export function matchPeriodRules(req: PeriodRequest, rules: PeriodRule[] = PERIOD_RULES): PeriodCandidate[] {
  const out: PeriodCandidate[] = []
  for (const rule of rules) {
    // 停用规则不参与匹配（scope 待重新定义，见 enforcement.apply 注释）。
    if (rule.disabled === true) continue
    if (rule.scope.procedure !== req.procedure) continue
    const caseType = matchToken(rule.scope.caseType, req.caseType, 'prefix')
    if (!caseType.ok) continue
    const party = matchToken(rule.scope.party, req.party, 'prefix')
    if (!party.ok) continue
    const clientRole = matchToken(rule.scope.clientRole, req.clientRole)
    if (!clientRole.ok) continue
    const docKind = matchToken(rule.scope.docKind, req.docKind)
    if (!docKind.ok) continue
    const court = matchToken(rule.scope.court, req.court, 'prefix')
    if (!court.ok) continue
    if (!docMatch(rule.trigger.doc, req.doc)) continue
    if (req.fact !== undefined && rule.trigger.fact !== req.fact) continue
    // 具体度 = 1（procedure 命中）+ 已确定的 scope 维度 + 给出了文书名。
    // court 也算一维：带法院限定的本地补丁天然比通用口径更具体，优先命中。
    let specificity = 1
    for (const m of [caseType, party, clientRole, docKind, court]) if (m.resolved) specificity++
    if (req.doc !== undefined && req.doc !== '') specificity++
    out.push({ rule, specificity })
  }
  out.sort((a, b) => b.specificity - a.specificity || a.rule.id.localeCompare(b.rule.id))
  return out
}

/** 规则 → 匹配度列表中的唯一命中（无命中返回 undefined；多候选返回 undefined 需自行判歧义）。 */
export function pickPeriodRule(req: PeriodRequest, rules: PeriodRule[] = PERIOD_RULES): { rule?: PeriodRule; candidates: PeriodCandidate[]; ambiguous: boolean } {
  const candidates = matchPeriodRules(req, rules)
  if (candidates.length === 0) return { candidates, ambiguous: false }
  const top = candidates[0]!
  const tied = candidates.filter((c) => c.specificity === top.specificity)
  if (tied.length > 1) return { candidates, ambiguous: true }
  return { rule: top.rule, candidates, ambiguous: false }
}

/* ------------------------------------------------------- 日期计算 */

const pad = (n: number): string => String(n).padStart(2, '0')

/** Date → YYYY-MM-DD（本地日历日）。 */
export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** YYYY-MM-DD → 本地零点的 Date。 */
export function fromDateStr(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1)
}

/** 加 N 天。 */
export function addDaysStr(date: string, days: number): string {
  const d = fromDateStr(date)
  d.setDate(d.getDate() + days)
  return toDateStr(d)
}

/** 加 N 月（日不存在时取该月最后一日）。 */
export function addMonthsStr(date: string, months: number): string {
  const d = fromDateStr(date)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + months)
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, last))
  return toDateStr(d)
}

/** 加 N 年（2 月 29 日 → 2 月 28 日）。 */
export function addYearsStr(date: string, years: number): string {
  return addMonthsStr(date, years * 12)
}

/** 是否法定休假日（周六/周日 + HOLIDAYS 表）。 */
export function isHoliday(date: string): boolean {
  if (HOLIDAYS.has(date)) return true
  const day = fromDateStr(date).getDay()
  return day === 0 || day === 6
}

/**
 * 末日顺延（民诉法 §85：期间的最后一日是法定休假日的，以休假日后的第一日
 * 为期间届满日）。返回顺延后的日期与被跳过的日期说明。
 */
export function rollForwardDate(date: string): { date: string; skipped: string[] } {
  const skipped: string[] = []
  let current = date
  let guard = 0
  while (isHoliday(current) && guard < 30) {
    skipped.push(current)
    current = addDaysStr(current, 1)
    guard++
  }
  return { date: current, skipped }
}

/**
 * 往前找最近的工作日（末日顺延的镜像）。
 *
 * 用途：提前量任务链的 deadline 是「动作应完成之日」，落在周末等于把风险留到
 * 无法办理的一天——往前挪到最近工作日更安全（2026-002 案人工兜底时也是把
 * 09-26（周六）提前到 09-24）。
 */
export function previousWorkday(date: string): { date: string; skipped: string[] } {
  const skipped: string[] = []
  let current = date
  let guard = 0
  while (isHoliday(current) && guard < 30) {
    skipped.push(current)
    current = addDaysStr(current, -1)
    guard++
  }
  return { date: current, skipped }
}

export interface DerivedPeriod {
  ruleId: string
  term: string
  /** 起算日（送达/收到/生效之日）。 */
  baseDate: string
  /** 计算出的期间届满日（未顺延）。 */
  naturalDueDate: string
  /** 期间届满日（已按需顺延）。 */
  dueDate: string
  /** 人读计算过程——回答「为什么是这天」。 */
  computeTrace: string
  cite: string
  /** 顺延时被跳过的日期。 */
  skipped: string[]
}

/**
 * 派生期间届满日：起算日 + 期间（日/月/年）→ 末日顺延。
 *
 * @param rule - 命中的规则。
 * @param baseDate - 触发日（送达/收到/生效之日）YYYY-MM-DD。
 */
export function derivePeriod(rule: PeriodRule, baseDate: string): DerivedPeriod {
  const { period, start } = rule
  // 期间开始的日不计算在内（民诉法 §85）：默认从次日起算。
  const excludeStart = start.excludeStartDay !== false
  const from = excludeStart ? addDaysStr(baseDate, 1) : baseDate
  let natural: string
  let lengthDesc: string
  if (period.days !== undefined) {
    natural = addDaysStr(from, period.days - 1)
    lengthDesc = `${period.days} 日`
  } else if (period.months !== undefined) {
    natural = addMonthsStr(from, period.months)
    natural = addDaysStr(natural, -1)
    lengthDesc = `${period.months} 个月`
  } else if (period.years !== undefined) {
    natural = addYearsStr(from, period.years)
    natural = addDaysStr(natural, -1)
    lengthDesc = `${period.years} 年`
  } else {
    throw new Error(`period rule ${rule.id} 未定义期间长度`)
  }

  let due = natural
  let skipped: string[] = []
  if (rule.rollForward) {
    const rolled = rollForwardDate(natural)
    due = rolled.date
    skipped = rolled.skipped
  }

  const bits = [
    `${baseDate} ${start.from}`,
    excludeStart ? '次日起算（期间开始的日不计算在内）' : '当日起算',
    `+ ${lengthDesc} → ${natural}`,
  ]
  if (skipped.length > 0) {
    bits.push(`${skipped.join('、')} 为休息日（周末，节假日表接入后含法定节假日） → 顺延至 ${due}（民诉法 §85）`)
  }
  if (HOLIDAYS.size === 0 && rule.rollForward && skipped.length > 0) {
    bits.push('（节假日表暂未接入，仅按周末顺延）')
  }

  return {
    ruleId: rule.id,
    term: rule.term,
    baseDate,
    naturalDueDate: natural,
    dueDate: due,
    computeTrace: bits.join('；'),
    cite: rule.cite,
    skipped,
  }
}

/** 规则摘要（工具描述内联用，模型据此知道表里有什么）。 */
export function summarizeRules(filter?: { procedure?: string }, rules: PeriodRule[] = PERIOD_RULES): string {
  const rows = rules.filter((r) => filter?.procedure === undefined || r.scope.procedure === filter.procedure)
  return rows
    .map((r) => {
      const len = r.period.days !== undefined ? `${r.period.days}日`
        : r.period.months !== undefined ? `${r.period.months}个月`
          : `${r.period.years}年`
      const kind = r.scope.docKind !== undefined ? `/${r.scope.docKind.join('|')}` : ''
      const role = r.scope.clientRole !== undefined ? `/${r.scope.clientRole.join('|')}` : ''
      return `${r.scope.procedure}${kind}${role}·${r.trigger.doc}${r.trigger.fact} → ${len} → ${r.term}`
    })
    .join('；')
}
