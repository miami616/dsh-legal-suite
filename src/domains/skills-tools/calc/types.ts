/**
 * 律师小工具 — 结果模型（host 工具与浏览器端共用，纯数据、无依赖）。
 */

/** 结果主行（label / value 一行一条，emphasis 用于主结论）。 */
export interface CalcSummaryRow {
  label: string
  value: string
  hint?: string
  /** 主结论行（UI 加大加粗）。 */
  emphasis?: boolean
}

/** 结果明细表（columns[0] 为表头）。 */
export interface CalcTable {
  caption?: string
  columns: string[]
  rows: string[][]
}

/** 一次测算的完整结果。 */
export interface CalcResult {
  /** 工具名（如「诉讼费测算」）。 */
  title: string
  /** 主结果行。 */
  summary: CalcSummaryRow[]
  /** 明细表（分段、逐日等）。 */
  tables?: CalcTable[]
  /** 依据与提示（法条、口径、免责）。 */
  notes?: string[]
  /** 输入不合法时给出，summary 为空。 */
  error?: string
}

/** 参数定义（UI 表单与工具文档共用）。 */
export interface CalcParam {
  key: string
  label: string
  type: 'amount' | 'text' | 'date' | 'number' | 'select' | 'boolean'
  /** select 的取值（value/label）。 */
  options?: Array<{ value: string; label: string }>
  default?: string | number | boolean
  hint?: string
  placeholder?: string
  /** 仅当另一参数取值命中时显示（联动表单）。 */
  showWhen?: { key: string; in: string[] }
  /** 数值单位（渲染为输入框内后缀：元 / % / 倍 / 万分之 / 小时 …）。 */
  unit?: string
  /** 少量选项的选择项渲染成分段控件（radio）而非下拉。 */
  display?: 'segment'
}

/** 小工具目录条目。 */
export interface CalcToolMeta {
  id: string
  name: string
  /** 分组（费用测算 / 利息与违约金 / 期限与日期 / 文书辅助）。 */
  group: string
  /** 一句话说明（卡片副文案）。 */
  desc: string
  /** 依据摘要（卡片脚注/详情页页眉）。 */
  basis: string
  /** 图标 key（client 侧映射到 SVG，如 'scale' | 'percent' | 'clock'）。 */
  icon?: string
  params: CalcParam[]
}
