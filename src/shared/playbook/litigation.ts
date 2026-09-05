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
 * 诉讼案件状态阶梯——按审级/程序分立多套（v0.2.4 按修正稿 docx 六套对齐）。
 *
 * 每套阶梯以「收案 → … → 已结案」收尾。status 说「走到哪一步」，level 说
 * 「在第几审/哪个程序」，两轴正交。代码 id 保持稳定（存量数据不迁移），
 * 标签按 docx 档位命名。
 */
export const STATUS_LADDERS: Record<string, LitigationStatusDef[]> = {
  /**
   * 民商 · 一审（docx）：收案 → 诉前准备 → 立案中 → 庭前准备 → 庭后管理
   * → 上诉期 → 二审中 → 已结案。
   * - 庭前准备 = 正式立案后到开庭（含答辩/举证/保全/传票）；
   * - 庭后管理 = 开完庭后（可二次开庭，回调庭前准备）；
   * - 上诉期 = 收到裁判文书后（判决 15/裁定 10 日）；
   * - 二审中 = 任一方上诉后（无人上诉则直接结案）——只作状态，案件走二审轨模板。
   */
  一审: [
    { id: 'intake', label: '收案', tone: 'neutral', order: 1 },
    { id: 'pre_filing', label: '诉前准备', tone: 'neutral', order: 2 },
    { id: 'filing', label: '立案中', tone: 'info', order: 3 },
    { id: 'pretrial', label: '庭前准备', tone: 'info', order: 4 },
    { id: 'post_trial', label: '庭后管理', tone: 'outline', order: 5 },
    { id: 'appeal_window', label: '上诉期', tone: 'warning', order: 6 },
    { id: 'second_instance', label: '二审中', tone: 'warning', order: 7 },
    { id: 'closed', label: '已结案', tone: 'success', order: 99 },
  ],
  /** 民商 · 二审（docx）：收案 → 诉前准备 → 上诉立案 → 庭前准备 → 庭后管理 → 已结案。 */
  二审: [
    { id: 'intake', label: '收案', tone: 'neutral', order: 1 },
    { id: 'pre_filing', label: '诉前准备', tone: 'neutral', order: 2 },
    { id: 'appeal_filed', label: '上诉立案', tone: 'info', order: 3 },
    { id: 'pretrial', label: '庭前准备', tone: 'accent', order: 4 },
    { id: 'post_trial', label: '庭后管理', tone: 'outline', order: 5 },
    { id: 'closed', label: '已结案', tone: 'success', order: 99 },
  ],
  /** 再审（docx）：收案 → 申请与审查 → 再审审理 → 已结案。 */
  再审: [
    { id: 'intake', label: '收案', tone: 'neutral', order: 1 },
    { id: 'retrial_apply', label: '申请与审查', tone: 'info', order: 2 },
    { id: 'retrial_trial', label: '再审审理', tone: 'accent', order: 3 },
    { id: 'closed', label: '已结案', tone: 'success', order: 99 },
  ],
  /**
   * 执行（docx）：收案 → 立案 → 执行中 → 终本 → 恢复执行 → 已结案。
   * 首次执行与恢复执行共用同一套阶梯：立案=查控开始、执行中=查控/处置/分配、
   * 终本=穷尽措施未足额、恢复执行=发现新线索重启。存量 level '执行' 归一到这里。
   */
  首次执行: [
    { id: 'intake', label: '收案', tone: 'neutral', order: 1 },
    { id: 'filing', label: '立案', tone: 'info', order: 2 },
    { id: 'executing', label: '执行中', tone: 'accent', order: 3 },
    { id: 'terminated', label: '终本', tone: 'warning', order: 4 },
    { id: 'recovery', label: '恢复执行', tone: 'accent', order: 5 },
    { id: 'closed', label: '已结案', tone: 'success', order: 99 },
  ],
  /** 恢复执行 level = 首次执行的别名阶梯（docx 执行阶梯同一套）。 */
  恢复执行: [
    { id: 'intake', label: '收案', tone: 'neutral', order: 1 },
    { id: 'filing', label: '立案', tone: 'info', order: 2 },
    { id: 'executing', label: '执行中', tone: 'accent', order: 3 },
    { id: 'terminated', label: '终本', tone: 'warning', order: 4 },
    { id: 'recovery', label: '恢复执行', tone: 'accent', order: 5 },
    { id: 'closed', label: '已结案', tone: 'success', order: 99 },
  ],
  /** 劳动仲裁（docx）：收案 → 仲裁申请 → 庭前准备 → 庭后管理 → 起诉期 → 已结案。 */
  劳动仲裁: [
    { id: 'intake', label: '收案', tone: 'neutral', order: 1 },
    { id: 'arb_apply', label: '仲裁申请', tone: 'info', order: 2 },
    { id: 'pretrial', label: '庭前准备', tone: 'accent', order: 3 },
    { id: 'post_trial', label: '庭后管理', tone: 'outline', order: 4 },
    { id: 'appeal_window', label: '起诉期', tone: 'warning', order: 5 },
    { id: 'closed', label: '已结案', tone: 'success', order: 99 },
  ],
  /** 商业仲裁（docx）：收案 → 仲裁申请 → 组庭与答辩 → 庭前准备 → 庭后管理 → 已结案。 */
  商事仲裁: [
    { id: 'intake', label: '收案', tone: 'neutral', order: 1 },
    { id: 'arb_apply', label: '仲裁申请', tone: 'info', order: 2 },
    { id: 'arb_tribunal', label: '组庭与答辩', tone: 'accent', order: 3 },
    { id: 'pretrial', label: '庭前准备', tone: 'accent', order: 4 },
    { id: 'post_trial', label: '庭后管理', tone: 'outline', order: 5 },
    { id: 'closed', label: '已结案', tone: 'success', order: 99 },
  ],
  /** 刑事：收案 → 侦查 → 审查起诉 → 一审 → 二审 → 已结案（独立轨）。 */
  刑事: [
    { id: 'intake', label: '收案', tone: 'neutral', order: 1 },
    { id: 'investigation_c', label: '侦查', tone: 'info', order: 2 },
    { id: 'prosecution_c', label: '审查起诉', tone: 'accent', order: 3 },
    { id: 'trial_c', label: '一审', tone: 'accent', order: 4 },
    { id: 'appeal_c', label: '二审', tone: 'warning', order: 5 },
    { id: 'closed', label: '已结案', tone: 'success', order: 99 },
  ],
}

/** 未定制的程序回退到一审套。 */
const FALLBACK_LADDER = '一审'

/** 一审套兼容导出（既有调用方按单轴使用）。 */
export const LITIGATION_STATUSES: LitigationStatusDef[] = STATUS_LADDERS['一审']

/** 归一化 level → 阶梯 key（含「执行」等口语）。 */
function ladderKey(level: string | undefined | null): string {
  const key = (level ?? '').trim()
  if (key === '执行' || key === '执行中') return '首次执行'
  return STATUS_LADDERS[key] !== undefined ? key : FALLBACK_LADDER
}

/**
 * 状态 id 的存量归并（v0.2.4 按 docx 档位重排后，把旧阶梯里已更名/删除的档位
 * 归并到新 id，避免存量案件读侧静默回落 intake）。
 *  - 二审旧「审查中 reviewing」「待开庭 awaiting_trial」→ pretrial（二审庭前准备）
 *  - 二审旧「二审审理 appellate」「二审判决 post_judgment」→ post_trial（二审庭后管理）
 *  - 一审旧「待开庭 awaiting_trial」→ pretrial（docx 庭前准备含开庭前排期）
 *  - 一审旧「执行中 execution」→ 归到执行轨 executing（level 也应一并改 首次执行）
 *  - 执行旧「财产查控 investigation」「处置中 disposal」「分配发还 distribution」→ executing（docx 执行中）
 *  - 其余原样返回
 */
const STATUS_LEGACY_MERGE: Record<string, string> = {
  reviewing: 'pretrial',
  appellate: 'post_trial',
  post_judgment: 'post_trial',
  awaiting_trial: 'pretrial',
  execution: 'executing',
  investigation: 'executing',
  disposal: 'executing',
  distribution: 'executing',
}

/** 归并后状态 id；无归并则原样返回（含未知 id——合法性仍由各阶梯校验）。 */
export function normalizeStatusId(id: string | undefined | null): string {
  const key = (id ?? '').trim()
  return STATUS_LEGACY_MERGE[key] ?? key
}

/** 存量 level 归并：口语/旧值 → 规范 level（执行 → 首次执行等）。 */
export function normalizeLevel(level: string | undefined | null, type?: string | undefined | null): string {
  const key = (level ?? '').trim()
  if (key === '' || key === undefined) return ''
  if (key === '执行' || key === '执行中') return '首次执行'
  if (key === '仲裁') return type !== undefined && /劳动/.test(String(type)) ? '劳动仲裁' : '商事仲裁'
  return key
}

/** 取某审级的状态阶梯。 */
export function getStatusLadder(level: string | undefined | null): LitigationStatusDef[] {
  return STATUS_LADDERS[ladderKey(level)]
}

/** 是否合法状态 id（管家/工具写入前的校验依据）。传 level 时按对应阶梯，不传按一审套。 */
export function isLitigationStatus(id: string | undefined | null, level?: string | undefined | null): boolean {
  if (id === undefined || id === null) return false
  return getStatusLadder(level).some((s) => s.id === normalizeStatusId(id))
}

/** 取状态定义，未知值回落到该审级阶梯的 intake（收案）。 */
export function getLitigationStatus(id: string | undefined | null, level?: string | undefined | null): LitigationStatusDef {
  const key = normalizeStatusId(id)
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
  '归档', '评估', '分析', '谈判', '协商', '盘点', '制定', '通知', '反馈', '登记',
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
  /**
   * 条件任务（备忘录 #10）：只有收到特定触发（缴费通知、对方上诉等）才
   * 真正要做，**默认展开不创建**；管家按案情用 `only` 显式点名（或人工
   * upsert_task）时才纳入。模板保留它是为了给管家提供规范措辞参照与
   * when 适用条件，避免管家想建时凭感觉现编标题。
   */
  optional?: boolean
  /** optional 任务的触发条件（展示给管家判断何时才建）。 */
  when?: string
  /**
   * 我方阵营约束（v0.3.0 自适应）：仅当案件我方身份落在该侧时才展开。
   *  - 'plaintiff' 原告/申请人/上诉人/申请执行人（A 侧）
   *  - 'defendant' 被告/被申请人/被上诉人/被执行人（B 侧）
   * 省略 = 两侧通用。
   */
  side?: 'plaintiff' | 'defendant'
  /**
   * 案件类型约束（v0.3.0 自适应）：仅当案件 type 命中列表时才展开。
   * 省略 = 全部类型通用；命中列表取并集。
   * 类型取值与 case.type 一致：民商 / 刑事 / 行政 / 劳动争议 / 知识产权 / 执行 / 其他。
   */
  appliesTo?: string[]
}

export interface StageTemplate {
  id: string
  /** 任务组显示名，格式「审级 · 阶段」。 */
  name: string
  status: string
  /**
   * 所属审级/程序轨（v0.3.0）。决定阶段模板从哪个 level 的状态阶梯取状态。
   * 如 一审 / 二审 / 再审 / 劳动仲裁 / 商事仲裁 / 首次执行 / 恢复执行 / 刑事。
   */
  level: string
  /** 阶段类型：'linear' 主轨阶段 / 'side' 旁路阶段（保全/鉴定/调解/救济，不占阶梯）。 */
  kind?: 'linear' | 'side'
  /** 旁路/类型阶段挂载提示：哪些线性阶段的管家在推进时该考虑展开它。 */
  mountHint?: string
  tasks: TaskTemplate[]
}

/* ==================================================== 多轨阶段任务模板 */

/**
 * 阶段任务模板 —— 多轨制（v0.3.0）。
 *
 * 一个「轨」= 一个审级/程序（level）的阶段序列，轨道内阶段 id 唯一；
 * 跨轨可复用通用阶段 id（如 pretrial「庭前准备」在一审轨与劳动仲裁轨
 * 都有，但任务内容按该轨单独定义）。模板是管家的**参考骨架**，不是枷锁：
 * 展开时管家按 案件 level（选轨）→ status（选阶段）→ type/side（裁任务）
 * 自适应，落地后仍可增删改。
 *
 * 命名约定（任务名写动作不写状态）与旁路包原则沿用 v1/v2：
 * - kind:'side' 的阶段（保全/鉴定/调解和解/程序救济）不占状态阶梯，
 *   由管家按案情在合适的线性阶段并行展开；
 * - optional 任务默认不展开，只有触发条件出现（管家判断）才建；
 * - side:'plaintiff'|'defendant' 的任务只在案件我方身份落在对应侧时展开；
 * - appliesTo 限制任务适用的案件类型（民商/刑事/行政/劳动争议/知识产权/执行）。
 *
 * 与用户确认的口径（2026-09-05）：
 * - 「发送律师函」等非必做动作不作为标准任务（改 optional，不默认展开）；
 * - 收到文书后的「登记举证期限/开庭/三大期限倒排」是**管家自动动作**
 *   （add_keydate / upsert_event），不派成律师任务——模板中不再出现这类登记任务；
 * - 「二审中」只是状态，案件转二审 = 把 level 切到「二审」，instances 自动
 *   记录，任务在二审轨自己的模板展开，一审轨不再保留「二审中」过渡任务组。
 */

/** 案件 type 归一（模板 appliesTo 匹配用）。 */
export type CaseTypeName = '民商' | '刑事' | '行政' | '劳动争议' | '知识产权' | '执行' | '其他'

/** 规范化案件类型：口语/别名 → 模板匹配键。 */
export function normalizeCaseType(type: string | undefined | null): CaseTypeName {
  const t = String(type ?? '').trim()
  if (t === '') return '其他'
  if (/刑事/.test(t)) return '刑事'
  if (/行政/.test(t)) return '行政'
  if (/劳动|争议/.test(t) && !/仲裁/.test(t)) return '劳动争议'
  if (/知产|知识产权|专利|商标|著作权/.test(t)) return '知识产权'
  if (/执行/.test(t)) return '执行'
  if (/民|商|合同|借贷|买卖/.test(t)) return '民商'
  return '其他'
}

/** 我方身份 → 阵营侧（与 party-vocab 的 SIDE_OF_OURSIDE 同义，供模板 side 过滤）。 */
export function ourSideKey(ourSide: string | undefined | null): 'plaintiff' | 'defendant' | '' {
  const s = String(ourSide ?? '').trim()
  if (s === '') return ''
  if (['plaintiff', '原告', 'applicant', '申请人', 'appellant', '上诉人', 'executionApplicant', '申请执行人'].includes(s)) return 'plaintiff'
  if (['defendant', '被告', 'respondent', '被申请人', 'appellee', '被上诉人', 'executionRespondent', '被执行人'].includes(s)) return 'defendant'
  return ''
}

/**
 * 案件类型 → 默认审级/程序（level）。建案时 level 未指明则按 type 推断，
 * 不把刑事/劳动/执行硬塞进一审轨。商事仲裁需另有仲裁协议，故民商默认仍回一审，
 * 由管家按是否有仲裁条款改判。
 */
export function defaultLevelForType(type: string | undefined | null): string {
  const t = String(type ?? '').trim()
  if (t === '') return '一审'
  if (/刑事/.test(t)) return '刑事'
  if (/行政/.test(t)) return '一审'
  if (/劳动争议|劳动/.test(t)) return '劳动仲裁'
  if (/知产|知识产权/.test(t)) return '一审'
  if (/执行/.test(t)) return '首次执行'
  return '一审'
}

/**
 * 模板是否适用于该案件：
 * - optional 由调用方另行决定（only 点名）；本函数不含 optional 判定
 * - side 过滤：任务标注的侧与我方身份不一致 → 不适用
 * - appliesTo 过滤：任务限定的案件类型不含案件 type → 不适用
 */
export function templateTaskApplies(task: TaskTemplate, ctx: { type?: string; ourSide?: string }): boolean {
  if (task.side !== undefined && ourSideKey(ctx.ourSide) !== '' && task.side !== ourSideKey(ctx.ourSide)) return false
  if (task.appliesTo !== undefined && task.appliesTo.length > 0) {
    const norm = normalizeCaseType(ctx.type)
    if (!task.appliesTo.includes(norm)) return false
  }
  return true
}

/* ---------------- 一审轨（level 一审） ---------------- */
const STAGE_T1_PRE_FILING: StageTemplate = {
  id: 'pre_filing', name: '一审 · 诉前准备', status: 'pre_filing', level: '一审',
  tasks: [
    { title: '核查利益冲突', priority: 'high', detail: '检索本所已办/在办案件，确认无利益冲突后方可收案', subtasks: ['检索本所案件库', '填写利益冲突核查表'] },
    { title: '签订委托代理合同', priority: 'high', detail: '明确代理权限、收费方式与收费金额', checklist: ['确认授权委托书签署', '确认收费到账'] },
    { title: '梳理案情并编制证据清单', priority: 'high', detail: '按要件事实逐项列明证据，标注原件/复印件与证明目的' },
    { title: '核查诉讼时效与管辖', priority: 'high', detail: '时效届满前必须完成起诉或中断时效；管辖错误将导致移送，徒增周期' },
    { title: '评估诉前财产保全可行性', priority: 'medium', detail: '有转移财产迹象的，优先考虑诉前保全；注意保全后 30 日内须起诉', optional: true, when: '对方有转移/隐匿财产迹象，或判决执行存在明显困难时' },
    { title: '开展诉前调解', priority: 'low', detail: '争议不大、对方有履行能力的，先行调解可显著缩短回款周期', optional: true, when: '争议金额小、双方有和解基础或存在长期合作关系时' },
  ],
}

const STAGE_T1_FILING: StageTemplate = {
  id: 'filing', name: '一审 · 立案', status: 'filing', level: '一审',
  tasks: [
    { title: '起草起诉状', priority: 'high', detail: '诉讼请求须具体、可执行，含本金、利息（起算日与标准）、诉讼费承担' },
    { title: '整理证据材料并编制证据清单', priority: 'high', detail: '按被告人数 + 1 准备副本，证据编号与清单一致' },
    { title: '递交立案材料', priority: 'high', detail: '线上立案或窗口递交；法院一般 7 日内决定是否立案' },
    {
      title: '缴纳诉讼费', priority: 'medium', optional: true,
      when: '收到法院缴费通知（含案号与金额）后；未通知不必提前安排',
      detail: '财产案件按标的额分段累计；缴费凭证是立案/审理材料，随通知执行并留存回执',
    },
  ],
}

const STAGE_T1_PRETRIAL: StageTemplate = {
  id: 'pretrial', name: '一审 · 庭前准备', status: 'pretrial', level: '一审',
  tasks: [
    {
      title: '提交答辩状', priority: 'high', side: 'defendant',
      detail: '被告应自收到起诉状副本之日起 15 日内提出；期限以送达日期为锚点', leadDays: 15,
    },
    {
      title: '查阅对方答辩状', priority: 'medium', side: 'plaintiff', optional: true,
      when: '我方为原告且对方已提交答辩状时',
      detail: '分析对方抗辩要点，据此调整举证与庭审策略',
    },
    {
      title: '提交证据', priority: 'high',
      detail: '一审普通程序举证期限不少于 15 日，简易程序不超过 15 日，以举证通知书为准；任务 deadline 设在期限届满前 2 日',
      leadDays: 5, subtasks: ['核对证据原件', '编制证据目录', '制作证据副本'], checklist: ['确认法院收到回执'],
    },
    {
      title: '提出管辖权异议', priority: 'high', side: 'defendant', optional: true,
      when: '受诉法院可能无管辖权、我方为被告且有意争取有利法院时',
      detail: '须在提交答辩状期间内提出；被驳回可在 10 日内上诉', leadDays: 14,
    },
    { title: '评估反诉可行性', priority: 'medium', side: 'defendant', optional: true, when: '我方为被告且存在与本诉有牵连的反请求时', detail: '反诉请求须与本诉有牵连；举证期届满前提出并预交受理费' },
    { title: '申请财产保全', priority: 'medium', detail: '诉中保全需提供担保；保全裁定作出后立即跟进执行保全', optional: true, when: '存在转移财产风险或判决执行困难时' },
    { title: '申请调查令', priority: 'medium', detail: '银行流水、工商内档、不动产登记等当事人无法自行调取的证据', optional: true, when: '关键证据需法院/律师调查令调取时' },
    { title: '申请司法鉴定', priority: 'low', detail: '工程造价、笔迹、伤残等级等；鉴定期间不计入审限，须尽早提出', optional: true, when: '待证事实需专门性问题判断时' },
    { title: '参加庭前会议', priority: 'medium', detail: '交换证据、固定无争议事实、明确争议焦点', optional: true, when: '法院安排庭前会议或证据交换时' },
    { title: '梳理争议焦点', priority: 'high', detail: '围绕争议焦点组织证据与法律论证，是庭审提纲的骨架' },
    // docx 一审：庭前准备 = 立案后到开庭（含答辩/举证/开庭传票）。收到开庭传票后
    // 以下「开庭准备与出庭」动作在本档按需展开——管家收到传票即 add_keydate「开庭」
    // 并回调展开这几条（only 点名或整组展开）。
    { title: '核对证据原件', priority: 'high', detail: '开庭须携带全部证据原件备查', leadDays: 7 },
    { title: '制作庭审提纲', priority: 'high', detail: '按法庭调查顺序写清发问、举证、质证要点', leadDays: 3, subtasks: ['拟定法庭调查发问提纲', '拟定质证意见', '拟定辩论意见'] },
    { title: '出庭参加庭审', priority: 'high', leadDays: 0, checklist: ['确认开庭时间与法庭', '确认出庭人员与授权手续', '携带证据原件与代理手续'] },
    { title: '校对并签署庭审笔录', priority: 'medium', detail: '笔录是上诉与再审的关键依据，当庭或庭后立即校对' },
  ],
}

const STAGE_T1_POST_TRIAL: StageTemplate = {
  id: 'post_trial', name: '一审 · 庭后管理', status: 'post_trial', level: '一审',
  tasks: [
    { title: '提交书面代理词', priority: 'high', detail: '庭后按法庭指定期限提交，一般 5-10 日', leadDays: 10 },
    { title: '提交庭后补充证据', priority: 'medium', detail: '庭后新发现的证据按法庭指定期限补充提交', optional: true, when: '庭审后发现新证据需补充提交时' },
    { title: '领取裁判文书', priority: 'high', detail: '判决书送达之日起开始计算上诉期，务必当日核对电子送达回执' },
    { title: '督促对方履行生效裁判', priority: 'medium', detail: '履行期限届满前发送履行催告函，为后续申请执行固定证据', optional: true, when: '对方有履行能力但未按期履行时' },
    { title: '评估申请强制执行可行性', priority: 'medium', detail: '对方未按期履行的，申请执行期间为 2 年，切勿逾期', optional: true, when: '裁判生效且对方逾期不履行时' },
    {
      title: '分析上诉可行性', priority: 'high', optional: true,
      when: '我方对裁判结果不满，或案件存在法律适用/事实认定错误且当事人可能上诉时',
      detail: '围绕事实认定与法律适用，给出明确的上诉/不上诉建议与理由；判决对我方全胜或无上诉必要时不建此任务', leadDays: 5,
    },
    {
      title: '确认当事人上诉意向', priority: 'high', optional: true,
      when: '裁判对我方不利或部分不利，需要确认是否上诉时',
      detail: '须书面确认，避免错过上诉期引发执业风险', leadDays: 3,
    },
  ],
}

/* ---------------- 二审轨（level 二审） ---------------- */
/* ---------------- 二审轨（level 二审，docx：收案→诉前准备→上诉立案→庭前准备→庭后管理→已结案） ---------------- */
/** 二审 · 诉前准备：决定上诉后的材料与策略准备（status=pre_filing）。 */
const STAGE_T2_PRE_FILING: StageTemplate = {
  id: 't2_pre_filing', name: '二审 · 诉前准备', status: 'pre_filing', level: '二审',
  tasks: [
    { title: '重构上诉理由', priority: 'high', detail: '区分事实认定/法律适用/程序违法，逐项对应一审裁判文书具体段落' },
    { title: '调取并审阅一审卷宗', priority: 'medium', detail: '重点核对一审庭审笔录、质证意见、法院调查取证情况' },
    {
      title: '评估二审新证据', priority: 'medium', optional: true,
      when: '存在一审后新发现的证据或一审无法取得的证据时',
      detail: '二审新证据举证期不少于 10 日；说明逾期举证的正当理由',
    },
  ],
}

const STAGE_T2_APPEAL_FILED: StageTemplate = {
  id: 'appeal_filed', name: '二审 · 上诉立案', status: 'appeal_filed', level: '二审',
  tasks: [
    {
      title: '提交上诉状', priority: 'high',
      detail: '民事判决 15 日、裁定 10 日上诉期（自送达次日起）；逾期丧失上诉权',
      leadDays: 2, subtasks: ['起草上诉状', '核对上诉请求与理由'], checklist: ['确认上诉状已递交', '确认预交上诉费'],
    },
    {
      title: '准备二审答辩', priority: 'high', side: 'defendant', optional: true,
      when: '对方（被上诉人）提起上诉，我方应诉时',
      detail: '针对对方上诉请求逐项答辩；收到上诉状副本后 15 日内提交', leadDays: 14,
    },
  ],
}

/** 二审 · 庭前准备（status=pretrial）：二审开庭/询问前的准备与庭审（docx 档位「庭前准备」）。 */
const STAGE_T2_APPELLATE: StageTemplate = {
  id: 'appellate', name: '二审 · 庭前准备', status: 'pretrial', level: '二审',
  tasks: [
    { title: '起草二审代理词', priority: 'high', detail: '围绕上诉请求审查范围展开；针对新争点补充论证' },
    { title: '确定二审审理方式并应对', priority: 'medium', detail: '二审可开庭亦可询问/书面审理；书面审理时提前提交完备书面意见' },
    { title: '出庭参加二审庭审', priority: 'high', optional: true, when: '二审决定开庭审理时', detail: '开庭审理的二审案件适用' },
    { title: '制作庭审记录', priority: 'medium', detail: '记录法庭关注点（通常即裁判关键）；笔录核对签署后拍照留存' },
  ],
}

/** 二审 · 庭后管理（status=post_trial）：终审裁判确认与后续路径（docx 档位「庭后管理」）。 */
const STAGE_T2_POST_JUDGMENT: StageTemplate = {
  id: 'post_judgment', name: '二审 · 庭后管理', status: 'post_trial', level: '二审',
  tasks: [
    { title: '领取二审裁判文书', priority: 'high', detail: '二审裁判为终审裁判，作出即生效；记录送达日期' },
    { title: '确认终审裁判效力', priority: 'high', detail: '确认生效时点关系到执行与再审期限起算' },
    { title: '分析终审结果与路径', priority: 'high', detail: '区分维持/改判/发回重审；发回重审回一审并另行组成合议庭；评估再审可行性' },
    { title: '向当事人通报并确认后续', priority: 'high', detail: '书面通报结果；确认履行/申请执行/申请再审路径并取得书面指示' },
    {
      title: '申请生效证明与费用结算', priority: 'medium',
      detail: '终审生效证明；结算诉讼费与律师费；为执行或再审做准备',
    },
  ],
}

/* ---------------- 再审轨（level 再审） ---------------- */
const STAGE_RT_APPLY: StageTemplate = {
  id: 'retrial_apply', name: '再审 · 申请与审查', status: 'retrial_apply', level: '再审',
  tasks: [
    { title: '匹配再审事由', priority: 'high', detail: '逐项对照民诉法第二百零七条十三项事由明确援引具体项；同步书面告知再审不停止执行、改判率与成本' },
    { title: '核查申请再审期限', priority: 'high', detail: '自裁判生效之日起 6 个月（不变期间，不适用中止中断）' },
    { title: '起草再审申请书', priority: 'high', detail: '明确再审事由与法律依据；指向原裁判具体错误；避免重复已充分辩论的主张' },
    { title: '整理新证据', priority: 'medium', detail: '说明原审未能提供的理由；以达到足以推翻原裁判为标准', optional: true, when: '存在符合法定情形的新证据时' },
    { title: '跟踪审查期限并补充意见', priority: 'medium', detail: '法院应自收到申请书之日起 3 个月内审查；按要求补正、针对对方意见提交补充审查意见' },
  ],
}

const STAGE_RT_TRIAL: StageTemplate = {
  id: 'retrial_trial', name: '再审 · 再审审理', status: 'retrial_trial', level: '再审',
  tasks: [
    { title: '确定再审适用程序', priority: 'high', detail: '原为一审按一审程序（可上诉）；原为二审或上级提审按二审程序（终审）' },
    { title: '重组证据与代理意见', priority: 'high', detail: '围绕裁定再审的事由展开，不得超出再审范围' },
    { title: '制作庭审提纲', priority: 'medium', detail: '按再审程序重新组织质证与辩论要点' },
    { title: '出庭参加庭审', priority: 'high', optional: true, when: '再审开庭审理时', detail: '核对并签署庭审笔录' },
    { title: '接收再审裁判并确定后续', priority: 'high', detail: '按一审程序作出的可上诉；按二审程序作出的即生效，考虑申请执行或检察监督' },
  ],
}

/* ---------------- 执行轨（level 首次执行 / 恢复执行，docx：收案→立案→执行中→终本→恢复执行→已结案） ----------------
 * 执行案件分两方视角，模板按我方身份(side)自动裁剪：
 *  - 我方 = 申请执行人（A 侧 executionApplicant）：申请执行、查控、处置、回款、恢复执行；
 *  - 我方 = 被执行人（B 侧 executionRespondent）：被申请执行后的应对——核对执行依据、
 *    履行/异议策略、应对查封处置、执行异议救济、解除限高失信、执行和解。
 */
/** 执行 · 立案（status=filing）。A 侧：申请立案；B 侧：收到执行通知后的核对与应对。 */
const STAGE_EX_APPLY: StageTemplate = {
  id: 'exec_apply', name: '执行 · 立案', status: 'filing', level: '首次执行',
  tasks: [
    // ---- 我方 = 申请执行人 ----
    { title: '申请强制执行', priority: 'high', side: 'plaintiff', detail: '提交执行申请书、生效裁判文书、送达证明与被执行人财产线索', subtasks: ['起草执行申请书', '准备生效证明与送达回证'] },
    { title: '提供被执行人财产线索', priority: 'high', side: 'plaintiff', detail: '银行账户、不动产、车辆、股权、应收账款——线索质量决定执行到位率' },
    { title: '核查申请执行时效', priority: 'high', side: 'plaintiff', detail: '申请执行期间 2 年，自履行期间最后一日起算；逾期将丧失强制执行力' },
    { title: '衔接诉讼保全与执行查封', priority: 'medium', side: 'plaintiff', detail: '诉中保全自动转为执行查封；核对查封期限避免脱封', optional: true, when: '诉中已采取保全措施时' },
    // ---- 我方 = 被执行人 ----
    { title: '接收执行通知并核对执行依据', priority: 'high', side: 'defendant', detail: '法院立案执行后向被执行人发执行通知；核对执行依据文书是否生效、执行内容是否明确' },
    { title: '核对执行金额与迟延利息', priority: 'high', side: 'defendant', detail: '核对本金、利息、迟延履行期间债务利息与执行费的计算；异议在法定期限内书面提出' },
    { title: '评估履行或异议策略', priority: 'high', side: 'defendant', detail: '确无争议的评估一次性/分期履行；认为执行依据有误或超标的的评估执行异议' },
  ],
}

/** 执行 · 执行中（status=executing）：A 侧查控/处置/分配；B 侧应对措施与救济。 */
const STAGE_EX_CTRL: StageTemplate = {
  id: 'exec_ctrl', name: '执行 · 执行中', status: 'executing', level: '首次执行',
  tasks: [
    // ---- 我方 = 申请执行人 ----
    { title: '配合法院财产查控', priority: 'high', side: 'plaintiff', detail: '跟进网络查控结果，及时申请续查封、续冻结' },
    { title: '监控查封续封期限', priority: 'high', side: 'plaintiff', detail: '不动产 3 年、动产 2 年、存款 1 年；脱封即失去控制力，提前 30 日申请续封' },
    { title: '申请限制消费与纳入失信', priority: 'medium', side: 'plaintiff', detail: '核对措施是否依法采取并持续有效', optional: true, when: '被执行人有逃避履行迹象或终本风险时' },
    { title: '跟踪评估与拍卖程序', priority: 'medium', side: 'plaintiff', detail: '评估异议 10 日；一拍起拍价不低于评估价 70%；关注公告与竞买人情况', optional: true, when: '进入财产处置程序时' },
    { title: '制定流拍应对方案', priority: 'medium', side: 'plaintiff', detail: '二拍降价不超前次 20%；评估以物抵债/变卖可行性', optional: true, when: '一拍流拍时' },
    { title: '参加执行谈话', priority: 'medium', side: 'plaintiff', detail: '就履行方案、执行和解与执行法官沟通', optional: true, when: '法院通知谈话时' },
    { title: '跟进执行回款', priority: 'high', side: 'plaintiff', detail: '核对执行款到账金额，办理领款手续' },
    // ---- 我方 = 被执行人 ----
    { title: '应对财产查控措施', priority: 'high', side: 'defendant', detail: '核对查封冻结范围是否超标的、是否含生活必需财产；对超标的查封可提出异议' },
    { title: '核对评估与拍卖程序', priority: 'high', side: 'defendant', detail: '收到评估报告 10 日内可提异议；关注起拍价、拍卖公告与保留价是否合规' },
    { title: '提出执行行为异议', priority: 'high', side: 'defendant', optional: true, when: '执行行为违反法律规定（超标的查封、程序违法等）时', detail: '向执行法院书面异议，15 日内审查；对裁定不服 10 日内向上一级法院复议' },
    { title: '应对参与分配与优先受偿', priority: 'medium', side: 'defendant', optional: true, when: '多个债权人参与分配、存在优先权争议时', detail: '核对分配方案中债权顺位与计算；有异议 15 日内书面提出' },
    { title: '协商履行与执行和解', priority: 'high', side: 'defendant', optional: true, when: '有履行意愿但短期困难、或愿以物抵债时', detail: '与申请执行人协商分期履行/以物抵债并签订执行和解协议；和解期间暂缓执行' },
    { title: '评估申请不予执行', priority: 'medium', side: 'defendant', optional: true, when: '执行依据存在仲裁裁决可撤销情形或明显错误时', detail: '对照法定不予执行情形评估并准备申请' },
  ],
}

/** 执行 · 终本（status=terminated）。A 侧：终本后追踪；B 侧：程序终结与措施解除。 */
const STAGE_EX_TERMINATED: StageTemplate = {
  id: 'exec_terminated', name: '执行 · 终本', status: 'terminated', level: '首次执行',
  tasks: [
    { title: '应对终本前意见征询', priority: 'high', side: 'plaintiff', detail: '法院须告知执行情况并听取意见；不同意终本须书面说明理由', optional: true, when: '法院拟终本并征询意见时' },
    { title: '书面说明终本后果', priority: 'high', side: 'plaintiff', detail: '说明终本≠执行终结、可随时申请恢复执行、5 年内每 6 个月自动查控；管理预期' },
    { title: '建立终本后追踪台账', priority: 'medium', side: 'plaintiff', detail: '关注被执行人工商变更、股权变动、不动产交易、高消费；法院每 6 个月自动查控一次', optional: true, when: '案件进入终本时' },
    { title: '确认终本裁定并核对解封条件', priority: 'high', side: 'defendant', detail: '终本后通常解除查封冻结与限高失信；核对裁定书载明事项与措施解除情况' },
    { title: '申请解除限制消费与失信', priority: 'high', side: 'defendant', optional: true, when: '履行完毕或终本后仍被限高/失信时', detail: '向执行法院申请解除限高、屏蔽失信信息；保留履行完毕凭证' },
  ],
}

/** 执行 · 恢复执行（status=recovery）。A 侧：发现新线索重启；B 侧：被恢复执行的应对。 */
const STAGE_EX_RECOVERY: StageTemplate = {
  id: 'exec_recovery', name: '执行 · 恢复执行', status: 'recovery', level: '首次执行',
  tasks: [
    { title: '收集并固定新财产线索', priority: 'high', side: 'plaintiff', detail: '线索须明确具体并附初步证据；固定时间点与状态，防止转移' },
    { title: '申请恢复执行', priority: 'high', side: 'plaintiff', detail: '恢复执行不受申请执行时效期间限制；一经查实法院应即恢复执行' },
    { title: '评估追加变更被执行人', priority: 'medium', side: 'plaintiff', optional: true, when: '存在未实缴出资股东、一人公司股东、抽逃出资等情形时', detail: '评估追加/变更被执行人可行性并准备申请' },
    { title: '评估拒执罪线索移送', priority: 'low', side: 'plaintiff', optional: true, when: '存在转移财产、违反限高等证据时', detail: '收集证据，评估向法院移送或自诉的可行性' },
    { title: '应对恢复执行通知', priority: 'high', side: 'defendant', detail: '恢复执行后重新核对执行标的与措施；有异议及时书面提出' },
    { title: '评估再次和解或履行方案', priority: 'medium', side: 'defendant', optional: true, when: '恢复执行后仍有和解空间时', detail: '避免财产被处置的，尽早协商履行方案' },
  ],
}

/* ---------------- 劳动仲裁轨（level 劳动仲裁） ---------------- */
const STAGE_LAB_APPLY: StageTemplate = {
  id: 'lab_apply', name: '劳动仲裁 · 申请', status: 'arb_apply', level: '劳动仲裁',
  tasks: [
    { title: '核查劳动仲裁时效', priority: 'high', detail: '1 年自知道或应当知道权利被侵害之日；劳动关系存续期间拖欠劳动报酬不受 1 年限制' },
    { title: '组织劳动关系证据', priority: 'high', detail: '劳动合同/工资流水/社保记录/考勤/工作沟通记录——未签合同二倍工资等主张的证据链' },
    { title: '起草仲裁申请书', priority: 'high', detail: '按劳动争议仲裁规则列明请求与事实理由' },
    { title: '确认终局裁决范围', priority: 'high', detail: '小额（≤当地月最低工资 12 个月）与标准明确争议为终局裁决：劳动者可起诉、用人单位只能撤裁' },
    { title: '递交仲裁申请材料', priority: 'high', detail: '劳动争议仲裁不收费；仲裁委收到申请后 5 日内决定是否受理' },
  ],
}

const STAGE_LAB_PRETRIAL: StageTemplate = {
  id: 'lab_pretrial', name: '劳动仲裁 · 庭前准备', status: 'pretrial', level: '劳动仲裁',
  tasks: [
    { title: '提交仲裁答辩书', priority: 'high', side: 'defendant', detail: '被申请人适用；按仲裁规则期限提交' },
    { title: '提出仲裁反请求', priority: 'medium', side: 'defendant', optional: true, when: '我方为被申请人且存在反请求时', detail: '须在规则期限内提出' },
    { title: '准备仲裁证据与质证意见', priority: 'high', detail: '劳动仲裁证据规则相对灵活，庭前书面质证意见同样关键' },
    { title: '参加调解或调解前置', priority: 'medium', optional: true, when: '仲裁委组织调解时', detail: '劳动仲裁调解率极高，调解书经签收生效' },
    { title: '出庭参加仲裁庭审', priority: 'high', detail: '核对并签署庭审笔录' },
  ],
}

const STAGE_LAB_POST: StageTemplate = {
  id: 'lab_post', name: '劳动仲裁 · 庭后管理', status: 'post_trial', level: '劳动仲裁',
  tasks: [
    { title: '领取仲裁裁决书', priority: 'high', detail: '记录收到日期——起诉期 15 日/撤裁期 30 日均自此起算' },
    { title: '分析裁决结果与终局性', priority: 'high', detail: '区分终局/非终局裁决；逐项对照请求与裁决项，明确后续路径' },
    {
      title: '判断不服裁决起诉', priority: 'high', optional: true,
      when: '裁决对我方不利或部分不利时',
      detail: '劳动者不服可在 15 日内起诉（含终局裁决）；用人单位对终局裁决只能 30 日内申请撤销（仲裁法§49）',
    },
    { title: '申请先予执行', priority: 'low', optional: true, when: '追索劳动报酬/工伤医疗费且情况紧急时', detail: '仲裁委可裁决先予执行并移送法院' },
  ],
}

const STAGE_LAB_APPEAL_WINDOW: StageTemplate = {
  id: 'lab_appeal_window', name: '劳动仲裁 · 起诉期', status: 'appeal_window', level: '劳动仲裁',
  tasks: [
    {
      title: '起草并递交起诉状', priority: 'high', optional: true,
      when: '劳动者不服裁决决定起诉时',
      detail: '15 日内向有管辖权法院递交，转民商一审轨（level 切「一审」）', leadDays: 2,
    },
    {
      title: '起草撤销裁决申请', priority: 'high', side: 'defendant', optional: true,
      when: '用人单位对终局裁决不服时',
      detail: '向中院申请撤销终局裁决，30 日内（仲裁法§49）', leadDays: 2,
    },
  ],
}

/* ---------------- 商事仲裁轨（level 商事仲裁） ---------------- */
const STAGE_ARB_APPLY: StageTemplate = {
  id: 'arb_apply', name: '商事仲裁 · 申请', status: 'arb_apply', level: '商事仲裁',
  tasks: [
    { title: '审查仲裁协议效力', priority: 'high', detail: '仲裁条款是否明确、有效、覆盖本案争议；效力瑕疵将导致不予执行' },
    { title: '起草仲裁申请书', priority: 'high', detail: '按选定仲裁机构规则与格式列明请求与事实理由' },
    { title: '缴纳仲裁费', priority: 'medium', detail: '按仲裁机构收费标准预交', optional: true, when: '收到缴费通知后' },
  ],
}

const STAGE_ARB_TRIBUNAL: StageTemplate = {
  id: 'arb_tribunal', name: '商事仲裁 · 组庭与答辩', status: 'arb_tribunal', level: '商事仲裁',
  tasks: [
    { title: '选定仲裁员', priority: 'high', detail: '在规则期限内选定；逾期由仲裁机构主任指定' },
    { title: '提交仲裁答辩书', priority: 'high', side: 'defendant', detail: '被申请人适用；按仲裁规则期限提交' },
    { title: '提出仲裁反请求', priority: 'medium', side: 'defendant', optional: true, when: '我方为被申请人且存在反请求时', detail: '须在规则期限内提出' },
  ],
}

const STAGE_ARB_PRETRIAL: StageTemplate = {
  id: 'arb_pretrial', name: '商事仲裁 · 庭前准备', status: 'pretrial', level: '商事仲裁',
  tasks: [
    { title: '准备仲裁证据与质证意见', priority: 'high', detail: '仲裁对证据要求相对灵活，但庭前书面质证意见同样关键' },
    { title: '梳理争议焦点', priority: 'high', detail: '围绕争议焦点组织证据与论证' },
    { title: '出庭参加仲裁庭审', priority: 'high', detail: '质证辩论按仲裁庭程序进行；核对并签署庭审笔录' },
  ],
}

const STAGE_ARB_POST: StageTemplate = {
  id: 'arb_post', name: '商事仲裁 · 庭后管理', status: 'post_trial', level: '商事仲裁',
  tasks: [
    { title: '领取仲裁裁决书', priority: 'high', detail: '记录收到日期——申请撤销 6 个月、申请执行 2 年均自此起算' },
    { title: '评估申请撤销裁决', priority: 'medium', detail: '对照仲裁法第五十八条法定情形；一裁终局与司法审查有限性', optional: true, when: '裁决对我方不利且存在法定撤裁情形时' },
    { title: '申请执行仲裁裁决', priority: 'medium', detail: '一方不履行的向有管辖权的法院申请执行', optional: true, when: '对方不履行裁决时' },
  ],
}

/* ---------------- 刑事轨（level 刑事） ---------------- */
const STAGE_CR_INVESTIGATION: StageTemplate = {
  id: 'cr_investigation', name: '刑事 · 侦查', status: 'investigation_c', level: '刑事',
  tasks: [
    { title: '出具刑事委托风险告知', priority: 'high', detail: '告知不得承诺结果、家属沟通边界、各阶段工作内容与收费；家属签字确认' },
    { title: '会见在押当事人', priority: 'high', detail: '凭三证会见；首次会见核实涉嫌罪名、讯问情况、权利告知、身体与生活需求' },
    { title: '与办案机关沟通案情', priority: 'medium', detail: '向侦查机关了解涉嫌罪名与案件进展；适时提出法律意见' },
    { title: '申请取保候审', priority: 'high', optional: true, when: '符合刑诉法第六十七条情形时', detail: '拘留后及时评估；贯穿侦查全程可随时提出' },
    { title: '申请羁押必要性审查', priority: 'medium', optional: true, when: '羁押期限届满或情势变更时', detail: '向检察机关申请' },
    { title: '代理申诉或控告', priority: 'low', optional: true, when: '存在违法侦查行为（超期羁押、违法查封扣押等）时', detail: '针对违法侦查行为提出申诉/控告' },
  ],
}

const STAGE_CR_PROSECUTION: StageTemplate = {
  id: 'cr_prosecution', name: '刑事 · 审查起诉', status: 'prosecution_c', level: '刑事',
  tasks: [
    { title: '阅卷并制作摘要', priority: 'high', detail: '自移送审查起诉之日起可复制案卷；重点核对讯问笔录、证据目录、鉴定意见' },
    { title: '会见并核实证据', priority: 'high', detail: '向当事人核实关键证据与笔录记载；确认辩解与证据的矛盾点' },
    { title: '核对起诉意见书', priority: 'high', detail: '核对认定罪名、事实与证据是否与卷宗一致；发现出入的提出书面意见' },
    { title: '提交辩护意见', priority: 'high', detail: '围绕无罪、罪轻、情节轻微争取不起诉或缓刑建议；证据有疑点要求补充侦查' },
    { title: '参与认罪认罚量刑协商', priority: 'high', optional: true, when: '当事人自愿认罪认罚时', detail: '参与量刑建议协商并见证具结书签署；签署前完整解释法律后果' },
  ],
}

const STAGE_CR_TRIAL: StageTemplate = {
  id: 'cr_trial', name: '刑事 · 一审', status: 'trial_c', level: '刑事',
  tasks: [
    { title: '制定辩护方案', priority: 'high', detail: '无罪/罪轻/程序辩护路线选择；确定质证重点与发问提纲' },
    { title: '走访调查与收集罪轻证据', priority: 'medium', detail: '品格证据、退赃退赔、被害人谅解、和解协议', optional: true, when: '存在罪轻/量刑情节线索时' },
    { title: '申请非法证据排除', priority: 'medium', optional: true, when: '存在以非法方法收集言词证据的线索时', detail: '开庭前提出排非申请并提供线索' },
    { title: '申请证人或鉴定人出庭', priority: 'medium', optional: true, when: '关键证人证言/鉴定意见对定罪量刑有重大影响时', detail: '开庭前提交出庭申请' },
    { title: '制作辩护词', priority: 'high', detail: '围绕构成要件、证据体系、量刑情节展开；预判控方观点逐一回应' },
    { title: '出庭辩护', priority: 'high', detail: '质证、发问、辩论；对庭审程序违法当庭提出异议' },
    { title: '校对并签署庭审笔录', priority: 'medium', detail: '逐页核对，异议当场提出' },
    { title: '编写庭审报告并通报家属', priority: 'medium', detail: '庭审焦点、辩方意见采纳情况、可能的判决区间；庭审后 1 日内通报' },
  ],
}

const STAGE_CR_APPEAL: StageTemplate = {
  id: 'cr_appeal', name: '刑事 · 二审', status: 'appeal_c', level: '刑事',
  tasks: [
    { title: '提交上诉状', priority: 'high', detail: '刑事上诉期：不服判决 10 日、裁定 5 日（自收到次日起算）', leadDays: 2 },
    { title: '阅卷并会见', priority: 'high', detail: '二审阶段全面阅卷；会见核实一审庭审情况与上诉焦点' },
    { title: '提交二审辩护词', priority: 'high', detail: '书面审理的辩护词就是全部辩护，必须完备' },
    { title: '出庭或提交书面意见', priority: 'high', optional: true, when: '二审开庭审理时', detail: '开庭出庭辩护；不开庭提交书面辩护意见' },
  ],
}

/* ---------------- 行政轨专用任务包（挂一审轨阶段，appliesTo 行政） ---------------- */
const STAGE_ADMIN_PRE: StageTemplate = {
  id: 'admin_pre', name: '行政 · 起诉准备', status: 'pre_filing', level: '一审', kind: 'side',
  mountHint: '行政案件诉前阶段按需展开',
  tasks: [
    { title: '核查行政起诉期限', priority: 'high', appliesTo: ['行政'], detail: '6 个月自知道行政行为之日（行诉法§46）；不动产相关最长 20 年、其他 5 年', leadDays: 30 },
    { title: '评估复议与诉讼路径', priority: 'high', appliesTo: ['行政'], detail: '核查是否属复议前置（纳税争议等）；复议 60 日内申请，不服复议决定 15 日内起诉' },
    { title: '审查行政行为合法性要件', priority: 'high', appliesTo: ['行政'], detail: '职权依据/事实证据/法定程序/法律适用四要件逐项过' },
    { title: '申请停止执行', priority: 'medium', appliesTo: ['行政'], optional: true, when: '起诉期间执行会造成难以弥补损失时', detail: '起诉与复议期间原则上不停止执行；符合条件申请停止或暂缓' },
  ],
}

const STAGE_ADMIN_DEFENSE: StageTemplate = {
  id: 'admin_defense', name: '行政 · 答辩与举证', status: 'pretrial', level: '一审', kind: 'side',
  mountHint: '行政案件被告答辩/举证阶段按需展开',
  tasks: [
    { title: '跟踪被告举证期限', priority: 'high', appliesTo: ['行政'], side: 'plaintiff', detail: '被告须在收到起诉状副本 15 日内提供证据与依据，逾期视为没有证据——原告侧重要攻击点' },
    { title: '申请规范性文件一并审查', priority: 'medium', appliesTo: ['行政'], optional: true, when: '认为规章以下规范性文件不合法时', detail: '一并请求审查（行诉法§53）' },
  ],
}

const STAGE_ADMIN_TRIAL: StageTemplate = {
  id: 'admin_trial', name: '行政 · 庭前与开庭', status: 'pretrial', level: '一审', kind: 'side',
  mountHint: '行政案件开庭前按需展开',
  tasks: [
    { title: '应对负责人出庭与协调化解', priority: 'medium', appliesTo: ['行政'], side: 'plaintiff', detail: '负责人应出庭应诉；法院可能组织协调化解——准备方案与授权' },
  ],
}

/* ---------------- 知产专用任务包（appliesTo 知识产权） ---------------- */
const STAGE_IP: StageTemplate = {
  id: 'ip_pack', name: '知产 · 取证与保全', status: 'pre_filing', level: '一审', kind: 'side',
  mountHint: '知识产权案件在诉前/举证期/开庭前按需展开',
  tasks: [
    { title: '固定侵权证据', priority: 'high', appliesTo: ['知识产权'], detail: '公证购买/可信时间戳/区块链存证；侵权页面全留痕——知产胜负手常在取证' },
    { title: '评估诉前行为保全', priority: 'high', appliesTo: ['知识产权'], optional: true, when: '侵权正在持续、情况紧急时', detail: '依各知产单行法申请诉前行为保全（48 小时裁定）' },
    { title: '组织损害赔偿证据', priority: 'medium', appliesTo: ['知识产权'], detail: '许可费/侵权获利/法定赔偿三档证据；主张惩罚性赔偿的证明恶意与情节严重' },
    { title: '申请证据保全', priority: 'medium', appliesTo: ['知识产权'], optional: true, when: '证据可能灭失或以后难以取得时', detail: '举证期届满前申请保全' },
    { title: '制作技术特征比对表', priority: 'high', appliesTo: ['知识产权'], optional: true, when: '专利/技术类案件', detail: '专利：技术特征逐项比对（全面覆盖/等同）；商标：混淆可能性' },
  ],
}

/* ---------------- 通用旁路包（各轨按需并行） ---------------- */
const STAGE_SIDE_PRESERVATION: StageTemplate = {
  id: 'side_preservation', name: '旁路 · 财产保全', status: '', level: '一审', kind: 'side',
  mountHint: '存在判决难以执行或财产转移风险时，于起诉前/立案后/审理中任一阶段并行展开',
  tasks: [
    { title: '调查财产线索', priority: 'high', detail: '房产坐落、车辆牌号、银行账号、股权所在公司、应收账款债务人' },
    { title: '起草保全申请书', priority: 'high', detail: '明确请求保全的财产范围与金额，不得超过诉讼请求范围' },
    { title: '落实担保', priority: 'high', detail: '保险公司保函、现金担保或实物担保；法院可责令提供担保' },
    { title: '跟踪保全裁定与执行', priority: 'high', detail: '情况紧急的法院须 48 小时内作出裁定；裁定后立即执行' },
    { title: '提醒诉前保全后起诉期限', priority: 'high', optional: true, when: '诉前保全已采取时', detail: '诉前保全后 30 日内不起诉/不申请仲裁的，法院解除保全——最高失权风险点' },
    { title: '办理续保或解除', priority: 'high', detail: '同执行查封期限；案件了结或保全错误时及时申请解除', optional: true, when: '保全期限将届满或应解除时' },
  ],
}

const STAGE_SIDE_APPRAISAL: StageTemplate = {
  id: 'side_appraisal', name: '旁路 · 鉴定评估', status: '', level: '一审', kind: 'side',
  mountHint: '待证事实需专门性问题判断时（造价/笔迹/伤残/审计等），于举证期内并行展开',
  tasks: [
    { title: '论证鉴定必要性', priority: 'medium', detail: '明确待证事实、鉴定目的与事项；论证为何不能以其他证据证明' },
    { title: '提出鉴定申请', priority: 'high', detail: '须在法院指定期间内提出并预交费用；逾期视为放弃' },
    { title: '协商确定鉴定机构', priority: 'medium', detail: '协商优先，协商不成由法院指定；审查资质与回避情形' },
    { title: '组织并提交鉴定材料', priority: 'medium', detail: '材料须经质证；拒不提供致无法查明的承担举证不能后果' },
    { title: '质证鉴定意见', priority: 'high', detail: '围绕检材真实性、程序合法性、依据充分性、结论关联性展开' },
  ],
}

const STAGE_SIDE_SETTLEMENT: StageTemplate = {
  id: 'side_settlement', name: '旁路 · 调解和解', status: '', level: '一审', kind: 'side',
  mountHint: '任一阶段存在调解/和解可能（含立案后先行调解、庭后和解）时并行展开',
  tasks: [
    { title: '征询调解意愿并留痕', priority: 'medium', detail: '遵循自愿合法原则；取得当事人书面意见' },
    { title: '拟定调解方案与授权底线', priority: 'high', detail: '含金额、期限、分期、违约责任；明确哪些条款须经特别授权才能当庭表态' },
    { title: '审查调解协议条款', priority: 'high', detail: '重点审查可执行性：金额期限明确、违约责任具体；避免「一次性了结」歧义' },
    { title: '申请司法确认', priority: 'medium', optional: true, when: '调解组织主持达成协议时', detail: '自协议生效之日起 30 日内共同申请司法确认' },
    { title: '确认调解书签收与生效', priority: 'high', optional: true, when: '法院出具调解书时', detail: '调解书经双方签收后生效；签收前可反悔' },
    { title: '跟进调解履行', priority: 'medium', optional: true, when: '达成调解/和解后', detail: '设置分期履行提醒；一方不履行可直接申请执行调解书' },
  ],
}

const STAGE_SIDE_REMEDY: StageTemplate = {
  id: 'side_remedy', name: '旁路 · 程序救济', status: '', level: '一审', kind: 'side',
  mountHint: '出现可申请的程序性救济事由（回避/延期/中止/复议/顺延）时并行展开',
  tasks: [
    { title: '申请回避', priority: 'medium', optional: true, when: '存在法定回避事由时', detail: '案件开始审理时提出，辩论终结前发现的也可提出；法院 3 日内决定' },
    { title: '申请延期审理', priority: 'medium', optional: true, when: '存在正当理由（关键证据未到、当事人突发疾病等）时', detail: '附证明材料' },
    { title: '申请诉讼中止或终结', priority: 'medium', optional: true, when: '一方当事人死亡待继承、法人终止、另案结果为依据等时', detail: '写明法定中止/终结事由' },
    { title: '申请复议', priority: 'medium', optional: true, when: '对罚款/拘留决定不服时', detail: '收到决定书之日起 5 日内向上一级法院申请复议' },
    { title: '申请顺延期限', priority: 'medium', optional: true, when: '因不可抗拒事由或正当理由耽误期限时', detail: '障碍消除后 10 日内申请顺延' },
  ],
}

/** 全部轨（key = level）。 */
export const STAGE_TRACKS: Record<string, StageTemplate[]> = {
  一审: [STAGE_T1_PRE_FILING, STAGE_T1_FILING, STAGE_T1_PRETRIAL, STAGE_T1_POST_TRIAL],
  二审: [STAGE_T2_PRE_FILING, STAGE_T2_APPEAL_FILED, STAGE_T2_APPELLATE, STAGE_T2_POST_JUDGMENT],
  再审: [STAGE_RT_APPLY, STAGE_RT_TRIAL],
  首次执行: [STAGE_EX_APPLY, STAGE_EX_CTRL, STAGE_EX_TERMINATED, STAGE_EX_RECOVERY],
  恢复执行: [STAGE_EX_APPLY, STAGE_EX_CTRL, STAGE_EX_TERMINATED, STAGE_EX_RECOVERY],
  劳动仲裁: [STAGE_LAB_APPLY, STAGE_LAB_PRETRIAL, STAGE_LAB_POST, STAGE_LAB_APPEAL_WINDOW],
  商事仲裁: [STAGE_ARB_APPLY, STAGE_ARB_TRIBUNAL, STAGE_ARB_PRETRIAL, STAGE_ARB_POST],
  刑事: [STAGE_CR_INVESTIGATION, STAGE_CR_PROSECUTION, STAGE_CR_TRIAL, STAGE_CR_APPEAL],
}

/** 类型任务包/旁路包（不占阶梯，kind:'side'，按 level+案情挂载）。 */
export const SIDE_STAGES: StageTemplate[] = [
  STAGE_ADMIN_PRE, STAGE_ADMIN_DEFENSE, STAGE_ADMIN_TRIAL, STAGE_IP,
  STAGE_SIDE_PRESERVATION, STAGE_SIDE_APPRAISAL, STAGE_SIDE_SETTLEMENT, STAGE_SIDE_REMEDY,
]

/** 全部阶段模板（主轨 + 旁路），旧接口 LITIGATION_STAGES 的超集。 */
export const LITIGATION_STAGES: StageTemplate[] = [
  ...Object.values(STAGE_TRACKS).flat(),
  ...SIDE_STAGES,
]

/** 按阶段 id 取模板（跨轨唯一查找；id 冲突时取首个）。 */
export function getLitigationStage(id: string): StageTemplate | undefined {
  return LITIGATION_STAGES.find((s) => s.id === id)
}

/** 按 level + 阶段 id 取模板（同 id 跨轨时精确命中）。 */
export function getStageOnTrack(level: string | undefined | null, stageId: string): StageTemplate | undefined {
  const track = STAGE_TRACKS[ladderKey(level)]
  return (track ?? []).find((s) => s.id === stageId) ?? LITIGATION_STAGES.find((s) => s.id === stageId)
}

/** 该 level 轨道内的阶段推进序列（只含线性主轨，旁路不参与推进）。 */
export function stageOrderOnTrack(level: string | undefined | null): StageTemplate[] {
  return STAGE_TRACKS[ladderKey(level)] ?? STAGE_TRACKS['一审']
}

/** 取某 status 在当前 level 轨内对应的阶段模板（无则 undefined）。 */
export function stageForStatus(level: string | undefined | null, statusId: string | undefined | null): StageTemplate | undefined {
  const norm = normalizeStatusId(statusId)
  return stageOrderOnTrack(level).find((s) => s.status === norm) ?? SIDE_STAGES.find((s) => s.status === norm)
}

/** 兼容导出：一审轨阶段序列。 */
export const FIRST_INSTANCE_STAGES = STAGE_TRACKS['一审']

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
