/**
 * dsh-legal-suite/moot-court — 程序 playbook 模型。
 *
 * 一个 playbook = 某类程序（民事一审/二审、劳动仲裁、商事仲裁）的完整庭审
 * 阶段序列。引擎按 phases → turns 顺序推进；**程序性话术（clerk）硬编码**，
 * 不进模型，既省 token 又避免程序错误。
 *
 * 与 prompts/ 分离：本目录只描述「谁在什么阶段说什么」的结构，人格与措辞
 * 在 prompts/roles.ts（律师可直接改措辞而不动程序骨架）。
 */
import type { ActorId, ArbitrationRules, Mode, Procedure, Tribunal } from '../store/types.ts'

/** 阶段性质，决定引擎的收尾动作（如争点归纳要抽结构化 issues）。 */
export type PhaseKind =
  | 'opening'        // 开庭准备/核对当事人
  | 'investigation'  // 法庭调查/仲裁庭调查
  | 'issues'         // 争议焦点归纳（产出结构化 issues）
  | 'debate'         // 法庭辩论
  | 'mediation'      // 调解（劳动仲裁必走）
  | 'closing'        // 最后陈述
  | 'deliberation'   // 评议
  | 'judgment'       // 宣判/裁决
  | 'attack'         // 压力测试专用：对方攻击面推演

/** 一个发言节点。 */
export interface Turn {
  /** 由谁发言。self 在 rehearsal 模式下变为「等待用户输入」。 */
  actor: ActorId
  /** 展示角色标签（如「审判长」「被告代理人」「书记员」）。 */
  roleLabel: string
  /** 程序话术（kind='procedure' 时使用；纯文本，不调模型）。 */
  procedureText?: string
  /** 实体发言指令（kind='speech' 时使用；进模型）。 */
  instruction?: string
  /**
   * 程序话术也带一句进模型的指令时（极少）：此字段优先于 procedureText。
   */
  kind: 'procedure' | 'speech'
  /** 该发言前需要检索锚定（法条/类案）。 */
  needsRetrieval?: boolean
  /** 该发言前需要金额测算（legal_calc）。 */
  needsCalc?: boolean
  /** 单条发言 maxTokens 覆盖。 */
  maxTokens?: number
  /** 可选节点：预算不足时可跳过。 */
  optional?: boolean
  /**
   * 复现轮次控制：debate 阶段里本节点每轮是否重复。
   * 1 = 只执行一次；-1 = 由 config.maxRounds 决定轮数。
   */
  repeat?: number
}

/** 一个庭审阶段。 */
export interface Phase {
  id: string
  title: string
  kind: PhaseKind
  turns: Turn[]
  /**
   * 适用模式；缺省 = 三种模式都跑。压力测试只跑轻量阶段。
   */
  modes?: Mode[]
  /** phase 结束后的引擎动作（'issues' 抽争点、'judgment' 出文书）。 */
  produces?: 'issues' | 'judgment' | 'report'
}

/** 一类程序的完整剧本。 */
export interface ProcedurePlaybook {
  procedure: Procedure
  /** 展示名（如「民事一审（普通程序）」）。 */
  title: string
  /** 默认法庭组成。 */
  defaultTribunal: Tribunal
  /** 可选法庭组成（向导下拉）。 */
  tribunals: Tribunal[]
  /** 文书标题（如「民事判决书」「裁决书」）。 */
  judgmentTitle: string
  /** 裁判者称谓（审判长 / 首席仲裁员 / 仲裁员）。 */
  judgeLabel: string
  /** 我方称谓（原告 / 上诉人 / 申请人）。 */
  selfLabel: string
  /** 对方称谓（被告 / 被上诉人 / 被申请人）。 */
  opponentLabel: string
  /** 商事仲裁可选规则。 */
  rules?: ArbitrationRules[]
  /** 阶段序列。 */
  phases: Phase[]
  /** 程序性提示（写进报告）。 */
  proceduralNotes: string[]
  /** 强制输入要求（向导校验；缺则 error code）。 */
  requiredInputs: Array<{
    key: 'cause' | 'claims' | 'parties' | 'evidence' | 'facts' | 'priorJudgment' | 'appealGrounds'
    label: string
    /** 缺失时的错误码。 */
    code: string
    /** 缺失是否阻断开庭。 */
    blocking: boolean
  }>
}

/** 所有 playbook。 */
export type PlaybookMap = Record<Procedure, ProcedurePlaybook>
