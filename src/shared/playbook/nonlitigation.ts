/**
 * 非诉实务 playbook — 管家 prompt、内置参考数据与界面词表共用的唯一事实源。
 *
 * 与诉讼 playbook 同源同理：把项目状态、阶段任务、交付物、关键日期与术语
 * 收敛成常量，保证管家产出、内置案例、界面标签三处措辞一致。
 *
 * 非诉与诉讼最大的差别：**非诉不是「程序推进」而是「交付物驱动」**。常法
 * 看服务期与响应时效，专项看里程碑与交付物质量。因此状态阶梯更短，阶段
 * 模板按项目类型（常法/专项/咨询）分叉，而不是按程序阶段分叉。
 */

/* ------------------------------------------------------------------ 状态 */

export type ProjectStatusTone = 'neutral' | 'info' | 'accent' | 'outline' | 'warning' | 'success'

export interface ProjectStatusDef {
  id: string
  label: string
  tone: ProjectStatusTone
  order: number
}

/**
 * 非诉项目状态阶梯（5 档）。
 *
 * retained（已签约，尚未启动交付）→ active（进行中）→ suspended（暂停）
 * → completed（已完成，交付物已验收）→ closed（已归档，结项清算完毕）。
 *
 * 「已完成」与「已归档」分开是刻意的：completed 仍可能发生补漏、回访与
 * 续约转化，closed 才是真正的生命周期终点。
 */
export const PROJECT_STATUSES: ProjectStatusDef[] = [
  { id: 'retained', label: '已签约', tone: 'info', order: 1 },
  { id: 'active', label: '进行中', tone: 'accent', order: 2 },
  { id: 'suspended', label: '已暂停', tone: 'outline', order: 3 },
  { id: 'completed', label: '已完成', tone: 'success', order: 4 },
  { id: 'closed', label: '已归档', tone: 'neutral', order: 99 },
]

const STATUS_BY_ID = new Map(PROJECT_STATUSES.map((s) => [s.id, s]))

/** 是否合法状态 id。 */
export function isProjectStatus(id: string | undefined | null): boolean {
  return id !== undefined && id !== null && STATUS_BY_ID.has(id)
}

/** 取状态定义，未知值回落到 active。 */
export function getProjectStatus(id: string | undefined | null): ProjectStatusDef {
  const key = (id ?? '').trim()
  return STATUS_BY_ID.get(key) ?? { id: 'active', label: '进行中', tone: 'accent', order: 2 }
}

/* ------------------------------------------------------------------ 类型 */

export interface ProjectTypeDef {
  key: string
  label: string
}

/** 非诉项目三大类；收费与组织方式各不相同，阶段模板按此分叉。 */
export const PROJECT_TYPES: ProjectTypeDef[] = [
  { key: 'retainer', label: '常法' },
  { key: 'special', label: '专项' },
  { key: 'consult', label: '咨询' },
]

/* ------------------------------------------------------- 任务命名规范 */

/**
 * 非诉任务名允许的开头动词。
 *
 * 同样遵守「写动作不写状态」：用「审查采购合同」，不用「合同审查中」。
 * 非诉任务名应尽量带上**对象**，因为常法服务高度同质，不带对象的
 * 「合同审查」在台账里无法区分是哪一份合同。
 */
export const PROJECT_TASK_VERBS = [
  '审查', '起草', '修订', '出具', '答复', '开展', '编制', '盘点', '制定',
  '召开', '参加', '协助', '跟进', '更新', '归档', '发送', '收集', '访谈', '核查',
  '谈判', '定稿', '签署', '交付', '结算', '培训', '梳理', '评估', '回访', '确认',
  '签订', '组建', '洽谈', '参与',
] as const

/**
 * 任务名中禁止出现的词。
 *
 * 与诉讼侧同理：只收词不收字，避免误伤「整改落实」这类规范表述。
 */
export const FORBIDDEN_PROJECT_TASK_WORDS = [
  '等待', '跟进中', '处理中', '进行中', '已完成', '搞一下', '看看',
  '那个', '这个', '东西',
] as const

/** 非规范措辞 → 规范任务名。 */
export const CANONICAL_PROJECT_TASK_TERMS: Record<string, string> = {
  '合同审查': '审查合同',
  '审合同': '审查合同',
  '看合同': '审查合同',
  '改合同': '修订合同',
  '出意见': '出具法律意见书',
  '写意见书': '出具法律意见书',
  '尽调': '开展尽职调查',
  '做尽调': '开展尽职调查',
  '尽调报告': '出具尽职调查报告',
  '交报告': '出具尽职调查报告',
  '写协议': '起草交易文件',
  '改协议': '修订交易文件',
  '签协议': '协助签署交易文件',
  '交割': '协助交割',
  '结项': '结项归档',
  '续签': '洽谈续约',
  '年度总结': '编制年度服务报告',
}

/** 任务名是否符合规范。 */
export function isCanonicalProjectTaskTitle(title: string): boolean {
  const t = title.trim()
  if (t === '') return false
  if (!PROJECT_TASK_VERBS.some((v) => t.startsWith(v))) return false
  return !FORBIDDEN_PROJECT_TASK_WORDS.some((w) => t.includes(w))
}

/** 归一非规范任务名。 */
export function canonicalProjectTaskTitle(title: string): string {
  const t = title.trim()
  return CANONICAL_PROJECT_TASK_TERMS[t] ?? t
}

/* ---------------------------------------------------- 关键日期标签 */

/**
 * 非诉关键日期规范标签。
 *
 * 非诉的「期限」绝大多数是**约定**而非法定，来源是服务合同、交易文件与
 * 监管要求。因此标签里必须写清是哪种来源，避免与法定期限混淆。
 */
export const PROJECT_KEYDATE_LABELS = [
  '服务期起始',
  '服务期届满',
  '续约洽谈启动',
  '续约签署',
  '服务费到期',
  '季度服务报告',
  '年度服务报告',
  '尽职调查报告交付',
  '交易文件定稿',
  '交割日',
  '工商变更完成',
  '合同到期',
  '合规年检',
  '项目结项',
] as const

/* ---------------------------------------------------------- 阶段模板 */

export interface ProjectTaskTemplate {
  title: string
  priority: 'low' | 'medium' | 'high'
  detail?: string
  /** 相对本阶段锚点的建议提前量（天）。 */
  leadDays?: number
  subtasks?: string[]
  checklist?: string[]
  /** 本任务的交付物——非诉按交付物验收，必须写清楚。 */
  deliverable?: string
}

export interface ProjectStageTemplate {
  id: string
  name: string
  appliesTo: Array<'retainer' | 'special' | 'consult'>
  tasks: ProjectTaskTemplate[]
}

/** 常法与专项共用的阶段模板库。 */
export const PROJECT_STAGES: ProjectStageTemplate[] = [
  {
    id: 'kickoff',
    name: '服务启动',
    appliesTo: ['retainer', 'special'],
    tasks: [
      { title: '签订法律服务合同', priority: 'high', detail: '明确服务范围、服务期限、收费方式与联系人', deliverable: '法律服务合同' },
      { title: '组建服务团队', priority: 'high', detail: '确定主办律师、协办律师与联系方式，向客户书面备案', deliverable: '服务团队联系表' },
      { title: '召开服务启动会', priority: 'high', detail: '对齐服务范围、响应时效、报送机制与保密要求', deliverable: '启动会纪要' },
      { title: '盘点存量法律风险', priority: 'medium', detail: '梳理存量合同、在办争议与合规缺口，形成风险台账', deliverable: '法律风险台账' },
      { title: '制定年度服务计划', priority: 'medium', detail: '按季度排布重点工作，作为服务期内的工作主线', deliverable: '年度服务计划' },
    ],
  },
  {
    id: 'contract_review',
    name: '日常履约 · 合同审查',
    appliesTo: ['retainer'],
    tasks: [
      { title: '审查采购合同', priority: 'high', detail: '重点核对付款条款、验收条款与违约责任', deliverable: '合同审查意见', subtasks: ['核对付款节点', '审查违约责任', '审查争议解决条款'], checklist: ['标注风险等级', '给出修改建议'] },
      { title: '审查销售合同', priority: 'high', detail: '重点核对回款保障、所有权保留与质保责任', deliverable: '合同审查意见' },
      { title: '修订合同模板', priority: 'medium', detail: '把审查意见沉淀为模板，减少重复审查成本', deliverable: '合同模板' },
    ],
  },
  {
    id: 'consulting',
    name: '日常履约 · 法律咨询',
    appliesTo: ['retainer', 'consult'],
    tasks: [
      { title: '答复日常法律咨询', priority: 'high', detail: '口头咨询当日回复，书面咨询按约定时效回复', deliverable: '咨询答复记录' },
      { title: '出具法律意见书', priority: 'high', detail: '重大事项须书面意见，明确结论、依据与风险提示', deliverable: '法律意见书' },
      { title: '更新咨询台账', priority: 'medium', detail: '每次咨询登记时间、事项、答复要点与耗时', deliverable: '咨询服务台账' },
    ],
  },
  {
    id: 'compliance',
    name: '日常履约 · 合规审查',
    appliesTo: ['retainer'],
    tasks: [
      { title: '开展数据合规审查', priority: 'medium', detail: '核查个人信息收集、处理与跨境传输的合规性', deliverable: '合规审查报告' },
      { title: '开展劳动用工合规审查', priority: 'medium', detail: '核查劳动合同、工时、社保与竞业限制', deliverable: '合规审查报告' },
      { title: '审查并修订内部制度', priority: 'medium', detail: '制度须经民主程序与公示，否则不能作为管理依据', deliverable: '制度文本' },
      { title: '跟进整改落实', priority: 'medium', detail: '合规整改闭环，留存整改证据', deliverable: '整改跟踪表' },
    ],
  },
  {
    id: 'due_diligence',
    name: '专项 · 尽职调查',
    appliesTo: ['special'],
    tasks: [
      { title: '发送尽职调查清单', priority: 'high', detail: '按主体资格、资产、业务、债权债务、劳动、争议分模块列清单', deliverable: '尽调清单' },
      { title: '收集并审阅尽调资料', priority: 'high', detail: '资料编号归档，缺口逐项催补', deliverable: '资料台账' },
      { title: '开展访谈与现场核查', priority: 'high', detail: '访谈记录须受访人签字确认', deliverable: '访谈记录' },
      { title: '出具尽职调查报告', priority: 'high', detail: '问题分级（重大/一般/提示），逐项给出处理建议', deliverable: '尽职调查报告' },
    ],
  },
  {
    id: 'transaction_docs',
    name: '专项 · 交易文件',
    appliesTo: ['special'],
    tasks: [
      { title: '起草交易文件', priority: 'high', detail: '按交易结构起草主协议与配套文件', deliverable: '交易文件初稿' },
      { title: '参与谈判并修订交易文件', priority: 'high', detail: '逐轮留痕，标注每轮让步与底线', deliverable: '修订对照表' },
      { title: '定稿并协助签署交易文件', priority: 'high', detail: '核对签署主体、授权文件与签署页', deliverable: '签署版交易文件' },
    ],
  },
  {
    id: 'closing',
    name: '专项 · 交割',
    appliesTo: ['special'],
    tasks: [
      { title: '核查交割先决条件', priority: 'high', detail: '逐项确认先决条件已满足或获豁免', deliverable: '交割条件核查表' },
      { title: '协助交割并签署交割确认', priority: 'high', deliverable: '交割确认书' },
      { title: '梳理交割后义务清单', priority: 'medium', detail: '工商变更、备案、通知义务等，逐项设定责任人与时限', deliverable: '交割后义务清单' },
      { title: '跟进工商变更完成', priority: 'medium', detail: '取得变更后的营业执照并归档', deliverable: '变更登记文件' },
    ],
  },
  {
    id: 'service_report',
    name: '服务报告与续约',
    appliesTo: ['retainer'],
    tasks: [
      { title: '编制季度服务报告', priority: 'medium', detail: '汇总本季服务事项、风险提示与下季重点', deliverable: '季度服务报告' },
      { title: '编制年度服务报告', priority: 'high', detail: '年度服务量、重大事项、遗留问题与改进建议', deliverable: '年度服务报告', leadDays: 30 },
      { title: '洽谈续约', priority: 'high', detail: '服务期届满前 60 日启动，避免服务断档', deliverable: '续约合同', leadDays: 60 },
    ],
  },
  {
    id: 'closure',
    name: '结项归档',
    appliesTo: ['retainer', 'special', 'consult'],
    tasks: [
      { title: '归档交付物', priority: 'medium', detail: '交付物、过程稿与往来邮件统一归档', deliverable: '项目卷宗' },
      { title: '结算工时与费用', priority: 'high', detail: '核对服务记录与实际工时，完成开票与回款', deliverable: '结算单' },
      { title: '编制结项报告', priority: 'medium', detail: '经验沉淀与风险提示，为续约或后续专项铺垫', deliverable: '结项报告' },
    ],
  },
]

/** 按项目类型取适用阶段模板。 */
export function stagesForProjectType(type: 'retainer' | 'special' | 'consult'): ProjectStageTemplate[] {
  return PROJECT_STAGES.filter((s) => s.appliesTo.includes(type))
}

/** 按阶段 id 取模板。 */
export function getProjectStage(id: string): ProjectStageTemplate | undefined {
  return PROJECT_STAGES.find((s) => s.id === id)
}

/* -------------------------------------------------------- 服务记录规范 */

/** 服务记录类型（服务台账的 kind 字段取值）。 */
export const SERVICE_KINDS = [
  '合同审查', '法律咨询', '文书起草', '合规审查', '尽职调查',
  '谈判支持', '培训', '争议处理', '其他',
] as const

/**
 * 服务记录规范。
 *
 * 常法服务是「预付费买时间」，客户看不到过程就只能靠台账感知工作量。
 * 因此**每一次服务都必须登记**，note 里写清：事项 + 交付物 + 耗时。
 * 缺台账的常法项目，续约时几乎必然被压价。
 */
export const SERVICE_LOG_RULES = [
  '每一次对外服务当日登记，不隔周补录',
  'name 写「动作 + 对象」，如「审查产品经销协议」',
  'note 写清交付物与耗时，如「出具审查意见，2.5 小时」',
  '一次服务一条记录；同一事项多次往返按最后一次交付登记',
  '服务量与年度服务报告、续约谈判直接挂钩，不得遗漏',
] as const

/* -------------------------------------------------------- 响应时效与提醒 */

export interface ResponseSla {
  kind: string
  hours: number
  note?: string
}

/** 常法服务常见响应时效（以服务合同约定为准）。 */
export const RESPONSE_SLAS: ResponseSla[] = [
  { kind: '口头咨询', hours: 24, note: '当日或次日回复' },
  { kind: '合同审查（普通）', hours: 48 },
  { kind: '合同审查（紧急）', hours: 8 },
  { kind: '法律意见书', hours: 72, note: '重大事项按约定另行协商' },
]

/**
 * 关键日期提醒提前量。
 *
 * 非诉没有法定的「最后一天」，但服务期届满、续约、年检这类日期一旦错过
 * 就会造成服务断档或合规风险，必须提前提醒。
 */
export const PROJECT_REMINDER_LEADS: Record<string, number[]> = {
  服务期届满: [90, 60, 30],
  续约洽谈启动: [60],
  服务费到期: [30, 7],
  年度服务报告: [30],
  合规年检: [60, 30],
  合同到期: [60, 30, 7],
  交割日: [7, 3, 1],
}

/** 相对锚点日期前 N 天的日期字符串（YYYY-MM-DD）。 */
export function daysBefore(anchorDate: string, days: number): string {
  const base = new Date(`${anchorDate}T00:00:00`)
  base.setDate(base.getDate() - days)
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`
}
