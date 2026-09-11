/**
 * Data model for the litigation store — mirrors the AgentLex litigation
 * module's on-disk shapes exactly so import (M5) and future export are
 * lossless. Field names match ~/.myagents/agentlex/*.json verbatim.
 *
 * Storage roots: <dataDir>/case-registry.json, case-timeline.json,
 * case-tasks.json (denormalized for tasks view), schedules.json.
 */

/* ------------------------------------------------------------------ cases */

/** One side's identity block (party.details[i]). */
export interface PartyDetail {
  name: string
  /** 主角色（中文，如 原告/第一被申请人）。读侧一律按字符串处理。 */
  role?: string
  /** 全量角色标签（同一主体跨审级的多个身份，如 ["申请人","上诉人"]）。 */
  roles?: string[]
  address?: string
  legalRep?: string
  creditCode?: string
  phone?: string
  firm?: string
  /** True when this row is the client/our side (AgentLex source marker). */
  ourClient?: boolean
  [key: string]: string | string[] | boolean | undefined
}

/** Parties block of a case record. */
export interface Parties {
  plaintiff?: string
  defendant?: string
  ourSide?: string
  details?: PartyDetail[]
}

/** A checklist item inside a task. */
export interface ChecklistItem {
  id: string
  text: string
  done: boolean
  createdAt?: string
  updatedAt?: string
}

/** A subtask inside a task. */
export interface Subtask {
  id: string
  title: string
  detail?: string
  done: boolean
  deadline?: string
  createdAt?: string
  updatedAt?: string
}

/** A task inside a task group. */
export interface CaseTask {
  id: string
  title: string
  detail?: string
  deadline?: string
  /** 具体时间（HH:mm），与 deadline（纯日期）分开存。 */
  time?: string
  priority?: 'low' | 'medium' | 'high'
  status: 'todo' | 'doing' | 'done'
  subtasks?: Subtask[]
  checklist?: ChecklistItem[]
  /** True when the task carries a linked key-date reminder (生成的关键日期). */
  remindKeyDate?: boolean
  /** Id of the linked case key date (task ↔ keydate bidirectional link). */
  keyDateId?: string
  /**
   * 该任务由哪个阶段模板任务展开而来（存模板里的规范标题）。
   * 管家把任务改名后，据此仍能识别「这一条已经展开过了」，
   * 避免重复展开时又新建一个原名版本。
   */
  templateTitle?: string
  createdAt?: string
  updatedAt?: string
}

/** A named group of tasks (stage). */
export interface TaskGroup {
  id: string
  name: string
  order: number
  tasks: CaseTask[]
  createdAt?: string
  updatedAt?: string
}

/** A key date on the case timeline. */
export interface KeyDate {
  id: string
  label: string
  date: string
  done?: boolean
  /* ---- 派生审计字段（0.2.11 期限规则表）：手工登记时全部留空 ---- */
  /** 命中的规则 id（PeriodRule.id）——去重/幂等/审计一律用它，不用 label。 */
  ruleId?: string
  /** 起算日（送达/收到/生效之日）。 */
  baseDate?: string
  /** 法律依据。 */
  cite?: string
  /** 派生时间（ISO）。 */
  derivedAt?: string
  /** 人读计算过程——回答「为什么是这天」。 */
  computeTrace?: string
  /** 数据来源标记（agent-computed / manual / task-linked / migration…）。 */
  source?: string
  createdAt?: string
  updatedAt?: string
}

/** One litigation case record (CaseRecord). */
export interface CaseRecord {
  caseId: string
  name: string
  caseNumber?: string
  type: string
  cause?: string
  status?: string
  court?: string
  judge?: string
  /** 承办法官联系电话（备忘 #31：案件详情页需要能记/看法官电话）。 */
  judgePhone?: string
  level?: string
  /** 审级历程（原应用 instances），用于卡片左轨轨迹。 */
  instances?: Array<Record<string, unknown>>
  claimAmount?: string
  filingDate?: string
  ourSide?: string
  parties?: Parties
  keyDates?: KeyDate[]
  taskGroups?: TaskGroup[]
  folder?: string
  summary?: string
  alias?: string[]
  fee?: string
  retainerUnit?: string
  tags?: string[]
  archived?: boolean
  /** 状态变更后任务展开策略：confirm（提示确认）/ agent（交管家）/ off（关闭）。 */
  expandOnStatus?: ExpandOnStatusMode
  /** 状态档位变更后尚未处理的「待展开阶段」（confirm/agent 模式产生）。 */
  pendingExpand?: PendingExpand
  /**
   * 法定期限闸门（0.2.12）：案件状态进入含**不变期间**的档位（庭后管理/上诉期）
   * 却没有期限登记时的阻断级提示 + 派生建议。
   *
   * 为什么挂在案件上而不是 pendingExpand 里：闸门与「阶段是否待展开」是两件事
   * ——阶段早就展开过的案件一样可能漏登期限，挂在 pendingExpand 上会随展开被清掉。
   * 案件级字段是唯一存储处，登记成功后由 applyPeriodRegistration 自动清除。
   */
  periodGate?: PeriodGate
  /**
   * 闸门已确认（不再提醒）：用于**确实无需在本案登记期限**的情形——典型是二审
   * 独立建档后，一审案的「上诉期届满」由二审案跟踪（用户 2026-09-10 的建档惯例）。
   * 与「已登记」不同：这是律师的判断，必须留 reason 备查。
   */
  periodGateMuted?: { at: string; reason?: string }
  boundSessions?: string[]
  linkedContracts?: string[]
  linkedResearch?: string[]
  createdAt?: string
  updatedAt?: string
}

/** case-registry.json document. */
export interface CaseRegistry {
  registryVersion: string
  lastUpdated?: string
  cases: Record<string, CaseRecord>
}

/* -------------------------------------------------------------- timeline */

/** Timeline event types observed in AgentLex (18 canonical kinds). */
export type TimelineEventType =
  | 'filing' | 'arbitration' | 'service' | 'filing_deadline' | 'case_event'
  | 'court_notice' | 'hearing' | 'defense_deadline' | 'evidence_deadline'
  | 'mediation' | 'other' | 'appeal_deadline' | 'judgment' | 'ruling'
  | 'appeal' | 'verdict' | 'execution' | 'deadline'
  | 'engagement' | 'close' | 'archive'

/** A reminder rule attached to a timeline event. */
export interface RemindRule {
  enabled: boolean
  minutes: number
  type: 'before_event' | 'after_event'
}

/** One timeline event. */
export interface TimelineEvent {
  id: string
  caseId: string
  caseName?: string
  type: TimelineEventType | string
  title: string
  detail?: string
  /** 具体时间（如 09:30）。 */
  time?: string
  date: string
  status: 'pending' | 'done' | 'cancelled'
  source?: string
  createdBy?: string
  remindRules?: RemindRule[]
  createdAt?: string
  updatedAt?: string
  completedAt?: string
}

/** case-timeline.json document. */
export interface TimelineRegistry {
  registryVersion: string
  lastUpdated?: string
  events: TimelineEvent[]
}

/* ------------------------------------------------------- status transition */

/** 状态变更后的任务展开策略（case 级覆盖，缺省走全局默认 'confirm'）。 */
export type ExpandOnStatusMode = 'confirm' | 'agent' | 'off'

/** 状态档位变更时挂起的「待展开阶段」标记（confirm/agent 模式产生）。 */
/** 法定期限闸门（0.2.12）——状态已进入不变期间但没有期限登记时的提示。 */
export interface PeriodGate {
  blocking: true
  /** 缺失的规范术语（该程序轨下应登记的）。 */
  missing: string[]
  /** 人读提示。 */
  notice: string
  /** 派生建议（可直接喂 register_service）。 */
  suggestions: Array<{
    doc: string
    fact: string
    procedure: string
    term: string
    cite: string
    length: string
    ruleId: string
  }>
  createdAt: string
}

export interface PendingExpand {
  stageId: string
  stageName: string
  fromStatus?: string
  toStatus: string
  mode: ExpandOnStatusMode
  createdAt: string
}

/* -------------------------------------------------------------- schedules */

/** One schedule item (calendar). */
export interface ScheduleItem {
  id: string
  caseId?: string
  title: string
  date: string
  time?: string
  kind?: string
  done?: boolean
  createdAt?: string
  updatedAt?: string
}

/** schedules.json document. */
export interface ScheduleRegistry {
  registryVersion: string
  lastUpdated?: string
  items: ScheduleItem[]
}

/* -------------------------------------------------------------- responses */

/** Standard host-API response envelope. */
export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  hint?: string
}
