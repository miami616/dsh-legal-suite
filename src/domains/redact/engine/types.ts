/**
 * 脱敏引擎类型（host 半共享）。
 *
 * 引擎是**纯函数**：不 import cordis、不碰文件系统、不发网络请求。输入文本 +
 * 词条 + 既有映射 → 输出脱敏文本 + 命中报告 + 更新后的映射。所有 I/O 由
 * `store/` 与 `tools.ts`/`routes.ts` 负责，便于脱离插件独立跑自测。
 */

/** 脱敏模式：reversible=假名可还原（内部流转）；masked=对外提供，不可还原。 */
export type RedactMode = 'reversible' | 'masked'

/**
 * 实体类别。
 * - 假名类（alias pool）：person（自然人）/ org（机构）/ project（项目）/
 *   caseName（案件名）/ caseNumber（案号）/ address（地址）/ custom（自定义）；
 * - 打码类（确定性掩码）：phone / idCard / creditCode / bankAccount / email /
 *   passport / amount。
 */
export type EntityKind =
  | 'person' | 'org' | 'project' | 'caseName' | 'caseNumber' | 'address' | 'custom'
  | 'phone' | 'idCard' | 'creditCode' | 'bankAccount' | 'email' | 'passport' | 'amount'

/** 假名类类别（分配稳定假名，如 张某 / 机构A）。 */
export const ALIAS_KINDS: readonly EntityKind[] = [
  'person', 'org', 'project', 'caseName', 'caseNumber', 'address', 'custom',
] as const

/** 打码类类别（确定性掩码，如 138****5678）。 */
export const MASK_KINDS: readonly EntityKind[] = [
  'phone', 'idCard', 'creditCode', 'bankAccount', 'email', 'passport', 'amount',
] as const

export function isAliasKind(kind: EntityKind): boolean {
  return (ALIAS_KINDS as readonly string[]).includes(kind)
}

/** 中文类别名（报告用）。 */
export const KIND_LABELS: Record<EntityKind, string> = {
  person: '自然人',
  org: '机构',
  project: '项目',
  caseName: '案件名',
  caseNumber: '案号',
  address: '地址',
  custom: '自定义实体',
  phone: '电话号码',
  idCard: '身份证号',
  creditCode: '统一社会信用代码',
  bankAccount: '银行账号',
  email: '邮箱',
  passport: '护照号',
  amount: '金额',
}

/** 词条：一个可精确匹配的敏感值 + 类别 + 归属 scope。 */
export interface LexiconEntry {
  value: string
  kind: EntityKind
  /** 归属 scope（caseId / projectId / 'global'），用于按案过滤。 */
  scopes: string[]
  /** 来源标记（如 litigation.party / litigation.case / nonlitigation.project / custom）。 */
  source: string
  /** 备注（报告与词条列表展示，如「法定代表人」「承办法官」）。 */
  note?: string
}

/** 命中的一段（原始文本上的半开区间 [start, end)）。 */
export interface Span {
  start: number
  end: number
  /** 命中的原文。 */
  matched: string
  kind: EntityKind
  /** 替换文本。 */
  replacement: string
  origin: 'rule' | 'lexicon'
  /** 规则 id（origin=rule 时）。 */
  ruleId?: string
  /** 词条来源标记（origin=lexicon 时）。 */
  source?: string
}

/** 启发层候选（默认只报告、不替换）。 */
export interface HeuristicCandidate {
  /** 展示用打码值（如 王**）。 */
  display: string
  /** 锚点上下文（如 被告）。 */
  anchor: string
  count: number
  /**
   * 候选原文。**仅供本机界面**（设置页点「加入词条」用）——对外响应
   * （agent 工具 / API 默认）一律剥掉，绝不进模型上下文。
   */
  value: string
}

/** 报告中的一类统计。 */
export interface KindStat {
  kind: EntityKind | string
  label: string
  count: number
  /** 打码样例（最多 5 条，绝不回吐原文）。 */
  samples: string[]
}

/** 脱敏报告：给人看的审计面。 */
export interface RedactReport {
  mode: RedactMode
  scope: string
  totalHits: number
  byKind: KindStat[]
  /** 启发层候选（未替换，供确认后入自定义词条）。 */
  candidates: HeuristicCandidate[]
  /** 本次新分配的假名。 */
  newAliases: Array<{ original: string; alias: string; kind: string }>
  /** 提示（假名与原文撞名、同名合并等）。 */
  warnings: string[]
  /** 映射表是否可还原（masked 一经使用即 false，且不可逆转）。 */
  restorable: boolean
}

/** 引擎输出。 */
export interface RedactOutcome {
  text: string
  spans: Span[]
  report: RedactReport
  /** 更新后的映射实体表（调用方负责落盘）。 */
  entities: Record<string, import('../store/types.ts').MappingEntity>
}

/** 还原结果。 */
export interface RestoreOutcome {
  text: string
  restored: number
  /** 映射里缺失、无法还原的假名（按出现次数）。 */
  missing: Array<{ alias: string; count: number }>
  /** 一个假名对应多个原名（无法判定），保持原样。 */
  ambiguous: string[]
}
