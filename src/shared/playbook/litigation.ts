/**
 * 诉讼实务 playbook — 管家 prompt、内置参考数据与界面词表共用的唯一事实源。
 *
 * 存在的意义只有一个：**保证出品一致性**。此前「开庭」在甲案叫「开庭」、
 * 在乙案叫「等待开庭」、在丙案叫「参加庭审」，同类事项三种措辞，既不可检索
 * 也不可统计。本模块把状态阶梯、阶段任务、关键日期标签、法定期限与提前量
 * 全部收敛成常量，让以下四处强制同源：
 *
 *   1. 管家 persona（presets/litigation-manager/agent.cordis.yml 的措辞来源）
 *   2. 工具参数描述（src/domains/litigation/tools.ts）
 *   3. 内置参考案例（src/shared/seed/index.ts）
 *   4. 界面状态徽章（src/domains/litigation/client/case-status.ts）
 *
 * 纯 TS 无副作用，服务端与客户端 bundle 均可安全引用。
 */

/* ------------------------------------------------------------------ 状态 */

/** 状态徽章色调（与 board/detail 的 .tone-* CSS 类一一对应）。 */
export type StatusTone = 'neutral' | 'info' | 'accent' | 'outline' | 'warning' | 'success'

export interface LitigationStatusDef {
  id: string
  label: string
  tone: StatusTone
  /** 展示与筛选排序位；closed 恒为末位。 */
  order: number
}

/**
 * 诉讼案件状态阶梯——按审级/程序分立多套。
 *
 * 不同程序的状态语义不同（一审走「诉前→立案→开庭」，二审走「上诉立案→
 * 审查→二审判决」，执行走「查控→处置→分配」），因此状态阶梯按 `level`
 * 分套，而不是用一审向的单一 8 档。未定制的程序（再审/仲裁）回退到一审套；
 * 每套均以 收案 → 已结案 收尾，未知状态回落 intake。
 */
export const STATUS_LADDERS: Record<string, LitigationStatusDef[]> = {
  /** 一审：诉前 → 立案 → 庭前 → 开庭 → 庭后 → 执行 → 结案（8 档）。 */
  一审: [
    { id: 'intake', label: '收案', tone: 'neutral', order: 1 },
    { id: 'pre_filing', label: '诉前', tone: 'neutral', order: 2 },
    { id: 'filing', label: '立案中', tone: 'info', order: 3 },
    { id: 'pretrial', label: '庭前准备', tone: 'info', order: 4 },
    { id: 'awaiting_trial', label: '待开庭', tone: 'accent', order: 5 },
    { id: 'post_trial', label: '庭后管理', tone: 'outline', order: 6 },
    { id: 'execution', label: '执行中', tone: 'warning', order: 7 },
    { id: 'closed', label: '已结案', tone: 'success', order: 99 },
  ],
  /** 二审：上诉立案 → 审查 → 开庭 → 二审判决 → 结案（6 档）。 */
  二审: [
    { id: 'intake', label: '收案', tone: 'neutral', order: 1 },
    { id: 'appeal_filed', label: '上诉立案', tone: 'info', order: 2 },
    { id: 'reviewing', label: '审查中', tone: 'info', order: 3 },
    { id: 'awaiting_trial', label: '待开庭', tone: 'accent', order: 4 },
    { id: 'post_judgment', label: '二审判决', tone: 'outline', order: 5 },
    { id: 'closed', label: '已结案', tone: 'success', order: 99 },
  ],
  /** 执行（首次/恢复执行共用）：查控 → 处置 → 分配 → 结案（5 档）。 */
  首次执行: [
    { id: 'intake', label: '收案', tone: 'neutral', order: 1 },
    { id: 'investigation', label: '财产查控', tone: 'info', order: 2 },
    { id: 'disposal', label: '处置中', tone: 'accent', order: 3 },
    { id: 'distribution', label: '分配发还', tone: 'outline', order: 4 },
    { id: 'closed', label: '已结案', tone: 'success', order: 99 },
  ],
  恢复执行: [
    { id: 'intake', label: '收案', tone: 'neutral', order: 1 },
    { id: 'investigation', label: '财产查控', tone: 'info', order: 2 },
    { id: 'disposal', label: '处置中', tone: 'accent', order: 3 },
    { id: 'distribution', label: '分配发还', tone: 'outline', order: 4 },
    { id: 'closed', label: '已结案', tone: 'success', order: 99 },
  ],
}

/** 未定制的程序（再审/仲裁等）回退到一审套。 */
const FALLBACK_LADDER = '一审'

/** 一审套兼容导出（既有调用方按单轴使用）。 */
export const LITIGATION_STATUSES: LitigationStatusDef[] = STATUS_LADDERS['一审']

/** 归一化 level → 阶梯 key（含「执行」等口语）。 */
function ladderKey(level: string | undefined | null): string {
  const key = (level ?? '').trim()
  if (key === '执行' || key === '执行中') return '首次执行'
  return STATUS_LADDERS[key] !== undefined ? key : FALLBACK_LADDER
}

/** 取某审级的状态阶梯。 */
export function getStatusLadder(level: string | undefined | null): LitigationStatusDef[] {
  return STATUS_LADDERS[ladderKey(level)]
}

/** 是否合法状态 id（管家/工具写入前的校验依据）。传 level 时按对应阶梯，不传按一审套。 */
export function isLitigationStatus(id: string | undefined | null, level?: string | undefined | null): boolean {
  if (id === undefined || id === null) return false
  return getStatusLadder(level).some((s) => s.id === id)
}

/** 取状态定义，未知值回落到该审级阶梯的 intake（收案）。 */
export function getLitigationStatus(id: string | undefined | null, level?: string | undefined | null): LitigationStatusDef {
  const key = (id ?? '').trim()
  return getStatusLadder(level).find((s) => s.id === key) ?? { id: 'intake', label: '收案', tone: 'neutral', order: 1 }
}

/* ------------------------------------------------------- 任务命名规范 */

/**
 * 任务名允许的开头动词。
 *
 * 核心规则：**任务名写「动作」，不写「状态」**。状态由 task.status
 * （todo/doing/done）表达，一旦把状态写进标题，就必然出现「开庭」与
 * 「等待开庭」并存、同一动作两种措辞的破窗。
 */
export const TASK_VERBS = [
  '核查', '检索', '梳理', '编制', '查阅', '起草', '撰写', '整理', '计算', '缴纳', '递交',
  '提交', '领取', '送达', '参加', '出庭', '申请', '配合', '督促', '跟进', '校对',
  '签署', '制作', '确认', '回复', '答复', '开展', '审查', '出具', '提供', '更新',
  '归档', '评估', '分析', '谈判', '协商', '盘点', '制定', '通知', '反馈',
  '签订', '发送', '核对', '结案',
] as const

/**
 * 任务名中禁止出现的词——它们描述状态而非动作。
 *
 * 注意：这里**只收词、不收字**。「整」「弄」这类单字看着该禁，但会把
 * 「整理证据」「整改落实」这些完全规范的说法误伤掉，反而逼着人换更差的措辞。
 */
export const FORBIDDEN_TASK_WORDS = [
  '等待', '待办', '跟进中', '处理中', '进行中', '已完成', '已提交', '已发送',
  '事儿', '搞一下', '看看', '那个', '这个', '东西',
] as const

/** 非规范措辞 → 规范任务名（管家接到口语化输入时先做归一）。 */
export const CANONICAL_TASK_TERMS: Record<string, string> = {
  '等待开庭': '出庭参加庭审',
  '开庭中': '出庭参加庭审',
  '去开庭': '出庭参加庭审',
  '参加庭审': '出庭参加庭审',
  '交证据': '提交证据',
  '递交证据': '提交证据',
  '举证': '提交证据',
  '答辩': '提交答辩状',
  '写答辩状': '起草答辩状',
  '拿判决': '领取裁判文书',
  '取判决': '领取裁判文书',
  '拿判决书': '领取裁判文书',
  '上诉截止': '提交上诉状',
  '举证截止': '提交证据',
  '举证期限届满前提交证据': '提交证据',
  '申请执行': '申请强制执行',
  '送立案': '递交立案材料',
  '立案': '递交立案材料',
  '案子结束': '结案归档',
  '结案': '结案归档',
}

/**
 * 任务名是否符合规范：以允许动词开头，且不含状态词。
 * 校验脚本用它扫描内置案例，防止参考数据本身成为破窗源头。
 */
export function isCanonicalTaskTitle(title: string): boolean {
  const t = title.trim()
  if (t === '') return false
  if (!TASK_VERBS.some((v) => t.startsWith(v))) return false
  return !FORBIDDEN_TASK_WORDS.some((w) => t.includes(w))
}

/** 把口语化/非规范的任务名归一为规范措辞（命中词表则替换，否则原样返回）。 */
export function canonicalTaskTitle(title: string): string {
  const t = title.trim()
  return CANONICAL_TASK_TERMS[t] ?? t
}

/* ---------------------------------------------------- 关键日期标签 */

/**
 * 关键日期规范标签。
 *
 * 关键日期只登记**有法律后果或不可逆**的时点；普通工作排期走任务 deadline，
 * 不要两头重复登记。
 */
export const KEYDATE_LABELS = [
  '诉讼时效届满',
  '答辩期届满',
  '举证期限届满',
  '开庭',
  '财产保全期限届满',
  '司法鉴定结论出具',
  '裁判文书送达',
  '上诉期届满',
  '判决履行期限届满',
  '申请执行期限届满',
  '执行立案',
  '执行款项到账',
] as const

/** 时间轴事件类型 → 人话标签（与期限引擎 eventTypeLabel 保持一致）。 */
export const EVENT_TYPE_LABELS: Record<string, string> = {
  filing: '立案',
  arbitration: '仲裁',
  service: '送达',
  filing_deadline: '立案期限',
  case_event: '案件节点',
  court_notice: '法院通知',
  hearing: '开庭',
  defense_deadline: '答辩期',
  evidence_deadline: '举证期限',
  mediation: '调解',
  other: '其他',
  appeal_deadline: '上诉期',
  judgment: '判决',
  ruling: '裁定',
  appeal: '上诉',
  verdict: '宣判',
  execution: '执行',
  deadline: '期限',
}

/* ---------------------------------------------------------- 阶段模板 */

export interface TaskTemplate {
  /** 规范任务名（动词短语）。 */
  title: string
  priority: 'low' | 'medium' | 'high'
  detail?: string
  /** 相对本阶段锚点日期的建议提前量（天），用于推算任务 deadline。 */
  leadDays?: number
  subtasks?: string[]
  checklist?: string[]
}

export interface StageTemplate {
  id: string
  /** 任务组显示名，格式「审级 · 阶段」。 */
  name: string
  status: string
  tasks: TaskTemplate[]
}

/**
 * 诉讼阶段任务模板。
 *
 * 覆盖一审全流程 + 执行阶段；二审沿用「庭前准备 / 开庭审理」模板，
 * 仅把组名前缀换成「二审 ·」。
 */
export const LITIGATION_STAGES: StageTemplate[] = [
  {
    id: 'pre_filing',
    name: '诉前 · 诉前准备',
    status: 'pre_filing',
    tasks: [
      { title: '核查利益冲突', priority: 'high', detail: '检索本所已办/在办案件，确认无利益冲突后方可收案', subtasks: ['检索本所案件库', '填写利益冲突核查表'] },
      { title: '签订委托代理合同', priority: 'high', detail: '明确代理权限、收费方式与收费金额', checklist: ['确认授权委托书签署', '确认收费到账'] },
      { title: '梳理案情并编制证据清单', priority: 'high', detail: '按要件事实逐项列明证据，标注原件/复印件与证明目的' },
      { title: '核查诉讼时效与管辖', priority: 'high', detail: '时效届满前必须完成起诉或中断时效；管辖错误将导致移送，徒增周期' },
      { title: '发送律师函', priority: 'medium', detail: '留痕催告，同时为后续主张利息/违约金固定证据' },
      { title: '评估诉前财产保全可行性', priority: 'medium', detail: '有转移财产迹象的，优先考虑诉前保全；注意保全后 30 日内须起诉' },
      { title: '开展诉前调解', priority: 'low', detail: '争议不大、对方有履行能力的，先行调解可显著缩短回款周期' },
    ],
  },
  {
    id: 'filing',
    name: '一审 · 立案',
    status: 'filing',
    tasks: [
      { title: '起草起诉状', priority: 'high', detail: '诉讼请求须具体、可执行，含本金、利息（起算日与标准）、诉讼费承担' },
      { title: '整理证据材料并编制证据清单', priority: 'high', detail: '按被告人数 + 1 准备副本，证据编号与清单一致' },
      { title: '计算并缴纳诉讼费', priority: 'medium', detail: '财产案件按标的额分段累计；缴费凭证是立案必备材料' },
      { title: '递交立案材料', priority: 'high', detail: '线上立案或窗口递交；法院一般 7 日内决定是否立案' },
      { title: '领取受理通知书与举证通知书', priority: 'high', detail: '举证通知书载明的举证期限是后续所有排期的锚点，必须第一时间入系统' },
    ],
  },
  {
    id: 'pretrial',
    name: '一审 · 庭前准备',
    status: 'pretrial',
    tasks: [
      { title: '提交答辩状', priority: 'high', detail: '被告应自收到起诉状副本之日起 15 日内提出；我方为原告时改为查阅对方答辩状', leadDays: 15 },
      { title: '提交证据', priority: 'high', detail: '一审普通程序举证期限不少于 15 日，简易程序不超过 15 日，以举证通知书为准；任务 deadline 设在期限届满前 2 日', leadDays: 5, subtasks: ['核对证据原件', '编制证据目录', '制作证据副本'], checklist: ['确认法院收到回执'] },
      { title: '申请财产保全', priority: 'medium', detail: '诉中保全需提供担保；保全裁定作出后立即跟进执行保全' },
      { title: '申请调查令', priority: 'medium', detail: '银行流水、工商内档、不动产登记等当事人无法自行调取的证据' },
      { title: '申请司法鉴定', priority: 'low', detail: '工程造价、笔迹、伤残等级等；鉴定期间不计入审限，须尽早提出' },
      { title: '参加庭前会议', priority: 'medium', detail: '交换证据、固定无争议事实、明确争议焦点' },
      { title: '梳理争议焦点', priority: 'high', detail: '围绕争议焦点组织证据与法律论证，是庭审提纲的骨架' },
    ],
  },
  {
    id: 'trial',
    name: '一审 · 开庭审理',
    status: 'awaiting_trial',
    tasks: [
      { title: '核对证据原件', priority: 'high', detail: '开庭须携带全部证据原件备查', leadDays: 7 },
      { title: '制作庭审提纲', priority: 'high', detail: '按法庭调查顺序写清发问、举证、质证要点', leadDays: 3, subtasks: ['拟定法庭调查发问提纲', '拟定质证意见', '拟定辩论意见'] },
      { title: '出庭参加庭审', priority: 'high', leadDays: 0, checklist: ['确认开庭时间与法庭', '确认出庭人员与授权手续', '携带证据原件与代理手续'] },
      { title: '提交书面代理词', priority: 'high', detail: '庭后按法庭指定期限提交，一般 5-10 日', leadDays: 10 },
      { title: '校对并签署庭审笔录', priority: 'medium', detail: '笔录是上诉与再审的关键依据，当庭或庭后立即校对' },
    ],
  },
  {
    id: 'post_trial',
    name: '一审 · 庭后管理',
    status: 'post_trial',
    tasks: [
      { title: '领取裁判文书', priority: 'high', detail: '判决书送达之日起开始计算上诉期，务必当日登记日期' },
      { title: '分析上诉可行性', priority: 'high', detail: '围绕事实认定与法律适用，给出明确的上诉/不上诉建议与理由', leadDays: 5 },
      { title: '确认当事人上诉意向', priority: 'high', detail: '须书面确认，避免错过上诉期引发执业风险', leadDays: 3 },
      { title: '提交上诉状', priority: 'medium', detail: '民事判决 15 日、裁定 10 日；刑事上诉期 10 日', leadDays: 2 },
      { title: '督促对方履行生效裁判', priority: 'medium', detail: '履行期限届满前发送履行催告函，为后续申请执行固定证据' },
      { title: '评估申请强制执行可行性', priority: 'medium', detail: '对方未按期履行的，申请执行期间为 2 年，切勿逾期' },
      { title: '结案归档', priority: 'low', detail: '卷宗归档、费用结算、未结事项交接' },
    ],
  },
  {
    id: 'execution',
    name: '执行 · 强制执行',
    status: 'execution',
    tasks: [
      { title: '申请强制执行', priority: 'high', detail: '提交执行申请书、生效裁判文书、送达证明与被执行人财产线索', subtasks: ['起草执行申请书', '准备生效证明与送达回证'] },
      { title: '提供被执行人财产线索', priority: 'high', detail: '银行账户、不动产、车辆、股权、应收账款——线索质量决定执行到位率' },
      { title: '配合法院财产查控', priority: 'medium', detail: '跟进网络查控结果，及时申请续查封、续冻结' },
      { title: '参加执行谈话', priority: 'medium', detail: '就履行方案、执行和解与执行法官沟通' },
      { title: '跟进执行回款', priority: 'high', detail: '核对执行款到账金额，办理领款手续' },
      { title: '申请恢复执行', priority: 'low', detail: '终结本次执行程序后发现新财产的，可随时申请恢复执行' },
    ],
  },
]

/** 按阶段 id 取模板。 */
export function getLitigationStage(id: string): StageTemplate | undefined {
  return LITIGATION_STAGES.find((s) => s.id === id)
}

/* ---------------------------------------------------------- 期限规则 */

export interface LegalPeriod {
  name: string
  days?: number
  months?: number
  years?: number
  /** 起算点。 */
  from: string
  note?: string
}

/**
 * 常用法定期限（以现行法律与受诉法院要求为准）。
 *
 * 管家引用时**必须提示用户复核**：程序细节因审级、程序类型、法院口径而异，
 * 系统只能给出排期依据，不能替代对期限的实质判断。
 */
export const LEGAL_PERIODS: LegalPeriod[] = [
  { name: '提交答辩状', days: 15, from: '被告收到起诉状副本之日', note: '民事一审；涉外为 30 日' },
  { name: '举证期限', days: 15, from: '举证通知书载明', note: '一审普通程序不少于 15 日；简易程序不超过 15 日；小额诉讼一般不超过 7 日' },
  { name: '民事上诉期（判决）', days: 15, from: '判决书送达之日' },
  { name: '民事上诉期（裁定）', days: 10, from: '裁定书送达之日' },
  { name: '刑事上诉/抗诉期', days: 10, from: '判决书送达之日' },
  { name: '申请再审', months: 6, from: '判决、裁定生效之日', note: '有法定特殊情形的自知道或应当知道之日起 6 个月' },
  { name: '申请执行期间', years: 2, from: '法律文书规定履行期间的最后一日起' },
  { name: '立案审查', days: 7, from: '法院收到起诉状之日', note: '符合起诉条件的应立案并通知当事人' },
  { name: '诉前保全后起诉', days: 30, from: '法院采取保全措施之日', note: '逾期不起诉的，法院解除保全' },
  { name: '执行立案审查', days: 7, from: '法院收到执行申请之日' },
  { name: '劳动仲裁时效', years: 1, from: '当事人知道或应当知道权利被侵害之日' },
  { name: '不服劳动仲裁裁决起诉', days: 15, from: '收到仲裁裁决书之日' },
]

/* -------------------------------------------------------- 排期提前量 */

export interface LeadTimeRule {
  anchor: string
  /** [{ 提前天数, 事项 }]，按距离锚点由远及近排列。 */
  steps: Array<{ days: number; item: string }>
}

/**
 * 排期提前量经验值。
 *
 * 期限类任务的 deadline 一律设在法定期限届满**之前** 2-5 日，留出打印、
 * 邮寄、补正的余量；把 deadline 直接设成法定期限当天，等于把风险留到最后一天。
 */
export const LEAD_TIME_RULES: LeadTimeRule[] = [
  {
    anchor: '开庭',
    steps: [
      { days: 7, item: '完成证据原件核对与证据目录定稿' },
      { days: 5, item: '完成争议焦点梳理' },
      { days: 3, item: '完成庭审提纲与代理词初稿' },
      { days: 2, item: '与当事人确认出庭人员与授权手续' },
      { days: 1, item: '复核开庭时间、法庭位置与携带材料' },
    ],
  },
  {
    anchor: '举证期限届满',
    steps: [
      { days: 7, item: '完成全部证据收集' },
      { days: 5, item: '完成证据整理与编号' },
      { days: 3, item: '完成证据目录与副本制作' },
      { days: 2, item: '提交法院并取得接收回执' },
    ],
  },
  {
    anchor: '上诉期届满',
    steps: [
      { days: 10, item: '领取并研读裁判文书' },
      { days: 7, item: '完成上诉可行性分析' },
      { days: 5, item: '取得当事人书面确认' },
      { days: 3, item: '完成上诉状起草与内部复核' },
      { days: 2, item: '递交上诉状并缴纳上诉费' },
    ],
  },
  {
    anchor: '申请执行期限届满',
    steps: [
      { days: 30, item: '发送履行催告函并留痕' },
      { days: 20, item: '完成被执行人财产线索梳理' },
      { days: 15, item: '起草执行申请书' },
      { days: 10, item: '递交执行申请' },
    ],
  },
]

/** 相对锚点日期前 N 天的日期字符串（YYYY-MM-DD）。 */
export function daysBefore(anchorDate: string, days: number): string {
  const base = new Date(`${anchorDate}T00:00:00`)
  base.setDate(base.getDate() - days)
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`
}

/**
 * 把法定期限换算成建议任务截止日：法定期限届满日往前推 `bufferDays` 天。
 * @param deadline - 法定期限届满日 YYYY-MM-DD
 * @param bufferDays - 安全余量，默认 2 个工作日概念上的 2 日
 */
export function suggestTaskDeadline(deadline: string, bufferDays = 2): string {
  return daysBefore(deadline, bufferDays)
}
