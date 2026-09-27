/**
 * dsh-legal-suite/moot-court — 数据模型（host + client 共用的事实源）。
 *
 * 设计基准：docs/模拟法庭-设计方案.md。要点：
 *   • 产物隔离：一切产物只落 $DSH_HOME/agentlex/moot-court/，绝不写入案件卷宗。
 *   • 案件输入是一次性快照（dossier.json），之后与卷宗解耦。
 *   • 四类程序 × 三种模式；裁判者/对方/己方三角色 + 书记员程序话术。
 *   • 判决必须锚定检索到的现行有效法条与类案（citation pool）。
 */

/** 支持的审理程序。刑事不在范围内。 */
export type Procedure = 'civil_first' | 'civil_second' | 'labor_arb' | 'commercial_arb'

/** 模拟模式。 */
export type Mode = 'stress' | 'auto' | 'rehearsal'

/** 法庭组成。 */
export type Tribunal = 'single' | 'collegial' | 'arb_solo' | 'arb_panel'

/** 商事仲裁机构规则口径（近似模拟）。 */
export type ArbitrationRules = 'cietac' | 'bac' | 'shiac' | 'generic'

/** 会话状态机状态。 */
export type SessionStatus =
  | 'draft'      // 已建、材料待确认
  | 'ready'      // 材料就绪，可开庭
  | 'running'    // 庭审进行中
  | 'waiting'    // 单方预演：等待用户发言
  | 'paused'     // 用户暂停
  | 'adjudicating' // 评议/文书生成中
  | 'done'       // 完成
  | 'aborted'    // 用户中止
  | 'failed'     // 引擎异常终止

/** 发言主体。clerk 为引擎硬编码的程序话术，不消耗模型调用。 */
export type ActorId = 'clerk' | 'judge' | 'opponent' | 'self' | 'user' | 'panel'

/** 会话内模型路由覆盖（"provider/model"）。缺省时按部署路由自动解析。 */
export interface ModelOverride {
  /** 主裁判者路由，形如 "provider/model"；空则自动解析。 */
  judgeModel?: string
  /** 对方代理人路由，形如 "provider/model"；空则同主路由。 */
  opponentModel?: string
}

/** 一次庭审的运行配置（建会话时固化，运行期只读）。 */
export interface MootRunConfig {
  judgeModel?: string
  opponentModel?: string
  /** 是否启用元典法条/类案锚定。关闭则判决标注「未锚定」。 */
  retrievalEnabled: boolean
  /** 检索地域过滤（省），空为全国。 */
  retrievalProvince?: string
  /** 最大辩论轮次（法庭辩论的往返次数）。 */
  maxRounds: number
  /** 整个会话的 token 预算上限。 */
  tokenBudget: number
  /** 单次发言的最大输出 token。 */
  maxTokensPerTurn: number
  /** 对方模型温度（高于裁判者，增强攻击性）。 */
  opponentTemperature: number
}

/** 会话运行统计。 */
export interface MootStats {
  tokensUsed: number
  calls: number
  startedAt?: string
  finishedAt?: string
  /** 完成的 phase id 列表（断点续跑依据）。 */
  phasesDone: string[]
  /** 预算超限被截断。 */
  truncated?: boolean
  /** 锚定降级说明（无检索工具 / 检索失败）。 */
  retrievalDegraded?: string
}

/* ─────────────────────────── 案件快照（dossier） ─────────────────────────── */

/** 快照中的一方当事人。 */
export interface DossierParty {
  name: string
  /** 程序角色：原告/被告/上诉人/被上诉人/申请人/被申请人/第三人。 */
  role: string
  /** 是否我方。 */
  ourClient: boolean
}

/** 快照中的一组证据。 */
export interface DossierEvidence {
  /** 证据编号（如「证据一」或「1」）。 */
  no: string
  name: string
  /** 证明目的。 */
  purpose?: string
}

/** 一次性复制的案件快照——此后与卷宗完全解耦。 */
export interface Dossier {
  /** 来源案件 id（可空：临时庭审）。 */
  caseId?: string
  caseName?: string
  /** 案由。 */
  cause?: string
  court?: string
  caseNumber?: string
  /** 审级（案件登记口径）。 */
  level?: string
  /** 我方一侧的角色标签（原告/被告/上诉人/申请人…）。 */
  ourRole?: string
  /** 对方一侧的角色标签。 */
  theirRole?: string
  /** 诉讼/仲裁请求。 */
  claims: string[]
  /** 事实摘要（案件信息.md 摘要或用户输入）。 */
  facts?: string
  /** 我方策略简报（可选，预演价值高）。 */
  brief?: string
  parties: DossierParty[]
  evidence: DossierEvidence[]
  /** 二审/再审程序专用：一审裁判文书全文或摘要。 */
  priorJudgment?: string
  /** 二审专用：上诉请求与理由。 */
  appealGrounds?: string[]
  /** 用户勾选的案件材料（文件名 + 可选提要；仅存引用与提要，不复制卷宗文件）。 */
  materials: Array<{ name: string; note?: string }>
  /** 快照构建时间。 */
  builtAt: string
  /** 快照来源说明（人类可读）。 */
  sources: string[]
}

/* ─────────────────────────── 庭审记录（transcript） ─────────────────────────── */

/** 一条检索锚定引用（法条或类案）。 */
export interface Citation {
  kind: 'article' | 'case'
  /** 展示引用：法条名/案号。 */
  ref: string
  title?: string
  /** 出处（法院/法规名/来源库）。 */
  source?: string
  /** 裁判要旨或法条原文摘要。 */
  summary?: string
  /** 相关性分值（检索返回，若有）。 */
  score?: number
}

/** 庭审记录条目。每追加一条即落盘（断点续跑）。 */
export interface TranscriptEntry {
  seq: number
  /** 所属 phase id。 */
  phase: string
  phaseTitle: string
  actor: ActorId
  /** 展示用角色标签（审判长/被告代理人/书记员…）。 */
  roleLabel: string
  text: string
  /** 本条发言锚定的引用。 */
  citations?: Citation[]
  /** 本条消耗的 token（估算）。 */
  tokens?: number
  /** 条目性质：程序话术 / 实体发言 / 系统提示。 */
  kind: 'procedure' | 'speech' | 'system'
  createdAt: string
}

/* ─────────────────────────── 争点与报告 ─────────────────────────── */

/** 争点评分。 */
export interface IssueScore {
  /** 我方在该争点的胜算（0-100，模型评估，非承诺）。 */
  usWinRate: number
  confidence: 'high' | 'medium' | 'low'
  /** 薄弱环节。 */
  weakPoints: string[]
}

/** 一个争议焦点。 */
export interface Issue {
  id: string
  title: string
  /** 双方立场。 */
  proCon: { us: string[]; them: string[] }
  /** 关联证据编号。 */
  evidenceRefs: string[]
  /** 评分（评议后回填）。 */
  score?: IssueScore
  /** 锚定：法条与类案。 */
  anchors: { articles: Citation[]; cases: Citation[] }
}

/** 对方/法官视角的攻击线路。 */
export interface AttackVector {
  point: string
  source: 'opponent' | 'judge'
  severity: 'high' | 'medium' | 'low'
  /** 支撑该攻击的类案/法条引用。 */
  anchors?: Citation[]
}

/** 证据/文书缺口。 */
export interface MootGap {
  /** 相关争点标题（可空）。 */
  issue?: string
  /** 缺失的证据或文书。 */
  missing: string
  reason: string
}

/** 改进建议（可回写案件任务树）。 */
export interface MootSuggestion {
  title: string
  detail: string
  priority: 'high' | 'medium' | 'low'
  kind: 'evidence' | 'document' | 'strategy'
}

/** 模拟结论与报告。 */
export interface MootReport {
  sessionId: string
  procedure: Procedure
  mode: Mode
  generatedAt: string
  /** 倾向性结论（不作承诺）。 */
  verdict: {
    summary: string
    /** 从裁判者视角的倾向：我方占优 / 对方占优 / 部分支持 / 难以判断。 */
    leaning: 'us' | 'them' | 'partial' | 'unclear'
    /** 综合胜算（0-100）。 */
    usWinRate: number
    confidence: 'high' | 'medium' | 'low'
  }
  issues: Issue[]
  attackVectors: AttackVector[]
  gaps: MootGap[]
  suggestions: MootSuggestion[]
  /** 程序性提示（如劳动仲裁 45+15 日时限、一裁终局）。 */
  proceduralNotes: string[]
  /**
   * 金额测算留痕（legal_calc 的输入与结果）。
   * 判决书中的金额必须与此一致——律师可据此复核每一个数字的来源。
   */
  calculations?: Array<{ action: string; input: string; summary: string; detail?: string }>
  /** 金额测算未执行的原因（材料缺少金额/日期/约定比例）。 */
  calculationSkipped?: string
  /** 模拟边界（固定段落 + 个案说明）。 */
  boundaries: string[]
  /** 免责声明（固定）。 */
  disclaimers: string[]
  retrieval: {
    enabled: boolean
    /** 成功锚定的引用数。 */
    citations: number
    degraded?: string
  }
  budget: { tokensUsed: number; truncated: boolean }
}

/* ─────────────────────────── 会话 ─────────────────────────── */

/** 一次模拟庭审会话。 */
export interface TrialSession {
  id: string
  /** 展示标题（默认取案件名 + 程序）。 */
  title: string
  procedure: Procedure
  mode: Mode
  tribunal: Tribunal
  /** 商事仲裁规则口径。 */
  arbitrationRules?: ArbitrationRules
  status: SessionStatus
  /** 当前 phase id。 */
  phase: string
  /** 当前 phase 在 playbook 中的序号。 */
  phaseIndex: number
  /** 法庭辩论已进行轮次。 */
  round: number
  /** 单方预演：正在等待用户发言的 phase（status=waiting 时有效）。 */
  awaitingPhase?: string
  config: MootRunConfig
  stats: MootStats
  createdAt: string
  updatedAt: string
  /** 失败原因（status=failed）。 */
  error?: string
}

/** 顶层会话索引（列表视图）。 */
export interface MootRegistry {
  registryVersion: number
  sessions: Record<string, TrialSession>
  lastUpdated: string
}

export const MOOT_REGISTRY_VERSION = 1

/* ─────────────────────────── 公共小工具 ─────────────────────────── */

/** HTTP 响应包络（与其它域一致）。 */
export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  hint?: string
}

/** 程序展示名。 */
export const PROCEDURE_LABEL: Record<Procedure, string> = {
  civil_first: '民事一审',
  civil_second: '民事二审',
  labor_arb: '劳动仲裁',
  commercial_arb: '商事仲裁',
}

/** 模式展示名。 */
export const MODE_LABEL: Record<Mode, string> = {
  stress: '文书压力测试',
  auto: '全自动演练',
  rehearsal: '单方预演',
}

/** 状态展示名。 */
export const STATUS_LABEL: Record<SessionStatus, string> = {
  draft: '草稿',
  ready: '待开庭',
  running: '庭审中',
  waiting: '等待我方发言',
  paused: '已暂停',
  adjudicating: '评议中',
  done: '已完成',
  aborted: '已中止',
  failed: '异常终止',
}

/** 法庭组成展示名。 */
export const TRIBUNAL_LABEL: Record<Tribunal, string> = {
  single: '独任审判',
  collegial: '合议庭',
  arb_solo: '独任仲裁庭',
  arb_panel: '三人仲裁庭',
}

/**
 * 强制免责口径——判决书、报告、agent 播报三处必须一字不差地带上。
 * 方案 §12：不得对裁判结果作出承诺。
 */
export const MOOT_DISCLAIMER =
  'AI 模拟，仅供律师内部参考，不构成对裁判结果的预测或承诺。'

/** 模拟边界固定段落（报告内）。 */
export const MOOT_BOUNDARIES: string[] = [
  '本模拟仅基于提交的材料与公开检索结果推演，不能复现真实庭审的全部变量。',
  '裁判者的个体风格、合议庭评议、审判委员会讨论、庭外因素均不在模拟范围内。',
  '庭审临场变量（当庭翻供、新证据突袭、证人表现、法官追问风格）无法模拟。',
  '同一争点在不同法院、不同时期可能存在裁判差异，检索结果仅代表已检索到的样本。',
]

/** 判断模式是否为自动演练（裁判者与双方均由模型扮演）。 */
export function isAutoMode(mode: Mode): boolean {
  return mode === 'auto' || mode === 'stress'
}

/** 该模式下己方发言是否由模型扮演。 */
export function selfIsModel(mode: Mode): boolean {
  return mode !== 'rehearsal'
}
