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
  role?: string
  address?: string
  legalRep?: string
  creditCode?: string
  phone?: string
  /** True when this row is the client/our side (AgentLex source marker). */
  ourClient?: boolean
  [key: string]: string | boolean | undefined
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
