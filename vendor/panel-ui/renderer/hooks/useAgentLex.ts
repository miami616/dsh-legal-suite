/**
 * useAgentLex — single module-level store for AgentLex registry state.
 *
 * Authority model (v1.1.0): disk (`~/.myagents/agentlex/*.json`) is the SINGLE
 * source of truth for CASES and SCHEDULES. Every mutation invokes a locked Rust
 * command (`cmd_agentlex_*`) which writes disk and emits `agentlex:registry-changed`;
 * the store reloads from disk on that event so ALL views converge in real time.
 *
 * Why this shape: pre-1.1.0 this hook kept FOUR independent `useState` copies
 * (one per view) and every mutation wrote ONLY to localStorage. A separate
 * disk→localStorage *full-replace* sync (AgentLexLayout) raced a *merge* sync
 * (CaseManager) on the same `focus` event. Net effect: UI-created cases and
 * schedules never reached disk, the agent couldn't see them, and the
 * full-replace wiped them on the next focus. That is the "配合不起来" root cause.
 * This rewrite removes the misalignment: ONE store, ONE write path (Rust,
 * locked), ONE reload trigger (the Rust event + focus + first mount).
 *
 * CONTRACTS and RESEARCH: Phase 4 migrated to disk-first Rust commands
 * (cmd_agentlex_list_contracts, cmd_agentlex_list_research), same locked
 * mutate_file pattern as cases/projects. localStorage is no longer used.
 */

import { useSyncExternalStore, useCallback } from 'react';
import { isTauriEnvironment } from '@/utils/browserMock';
import { listenWithCleanup } from '@/utils/tauriListen';
import { normalizeStatus, normalizeLevel } from '@/utils/caseStatus';
import { normalizePartyRole, canonicalPartyRole } from '@/utils/caseFormat';
import { timelineEventToAddPayload, timelineEventToUpdatePatch } from '@/utils/caseTimeline';
import { normalizeCaseType } from '@/utils/caseTypes';
import { getClientRemoteTarget, remoteAuthHeaders, applyRemoteOrigin } from '@/api/remoteBackendClient';
import { proxyFetch } from '@/api/tauriClient';
import { buildAgentlexRemoteCall } from '@/api/agentlexRemote';

// ============================================================
// Types (unchanged — consumed across the renderer)
// ============================================================

// ── Task hierarchy (v1.1.0 Phase 1) ──
// A case's WORK BREAKDOWN: Case → TaskGroup[] (阶段) → Task[] → subtasks/checklist.
// Distinct from `keyDates` (court-imposed procedural dates the lawyer obeys);
// taskGroups are the lawyer's own todo plan. Both feed the schedule view.

export type TaskStatus = 'todo' | 'in_progress' | 'done' | 'blocked';
export type TaskPriority = 'high' | 'medium' | 'low';

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface SubTask {
  id: string;
  title: string;
  deadline?: string;       // YYYY-MM-DD
  priority?: TaskPriority;
  status: TaskStatus;
  createdAt?: string;
  updatedAt?: string;
}

export interface Task {
  id: string;
  title: string;
  detail?: string;
  folder?: string;         // task-level bound folder (absolute path)
  deadline?: string;       // YYYY-MM-DD
  time?: string;           // HH:mm — 具体时间，与 deadline 分开存
  priority: TaskPriority;
  status: TaskStatus;
  subtasks: SubTask[];
  checklist: ChecklistItem[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskGroup {
  id: string;
  title: string;           // 阶段名, e.g. "立案准备" / "证据梳理" / "庭审"
  order: number;           // ascending sort key for stage sequence
  tasks: Task[];
  createdAt: string;
  updatedAt: string;
}

export interface CaseEntry {
  caseId: string;
  caseNumber: string;
  name: string;
  alias: string[];
  type: string;
  cause?: string;
  status: string;
  folder: string;
  judge?: string;
  claimAmount?: string;
  /** 收费金额（自由字符串，与 claimAmount 同格式，如 "50万"/"80000"）。 */
  fee?: string;
  /** 所属常年顾问单位：对接非诉常法项目名（ProjectType='retainer'）或手填，空 = 非顾问案件。 */
  retainerUnit?: string;
  filingDate?: string;
  summary?: string;
  /** Current instance level — also used as a display tag. */
  level?: string;
  /** Multi-instance proceedings: arbitration → first → appeal → retrial. Newest first. */
  instances?: Array<{
    level: string; caseNo: string; court: string; plaintiff: string; defendant: string;
    judge?: string; filedAt?: string; result?: string;
  }>;
  parties: {
    plaintiff?: string;
    defendant?: string;
    ourSide: string;
    /** 我方当事人名（显式指认，2026-09-04）。 */
    ourClientName?: string;
    details: Array<{ name: string; role: string; roles?: string[]; firm?: string; phone?: string; address?: string; ourClient?: boolean }>;
  };
  court: string;
  keyDates: Array<{
    label: string;
    date: string;
    source: string;
    completed?: boolean;
  }>;
  boundSessions: Array<{
    sessionId: string;
    label: string;
    createdAt: string;
    /** Which agent type this session belongs to:
     *  'litigation' (诉讼管家) is in use.
     *  Absent = legacy 'litigation'. */
    agentKey?: string;
  }>;
  linkedContracts: string[];
  linkedResearch: string[];
  /** Work breakdown (阶段 → 任务 → 子任务/检查项). Additive in v1.1.0 — old
   * records without it normalize to []. Distinct from keyDates. */
  taskGroups: TaskGroup[];
  /** Free-form labels ("高净值"/"异地"/"系列案"…). Normalized to [] when absent. */
  tags: string[];
  /** Soft-delete flag (Phase 4). Archived cases hide from the dashboard by
   * default but are never destroyed — toggle via updateCase({archived}). */
  archived?: boolean;
  createdAt: string;
  updatedAt: string;
}

// ── Non-litigation project types (v1.1.0 project-based refactor) ──

export type ProjectType = 'retainer' | 'special';
export type ProjectStatus = 'active' | 'inactive' | 'closed';

export interface ServicePeriod {
  start: string;   // YYYY-MM-DD
  end: string;     // YYYY-MM-DD
}

export interface ProjectEntry {
  projectId: string;
  name: string;
  projectType: ProjectType;
  status: ProjectStatus;
  servicePeriod: ServicePeriod;
  serviceScope: string[];
  leadLawyer: string;
  team: string[];
  contractAmount: string;
  folder: string;
  keyDates: Array<{
    label: string;
    date: string;
    source: string;
    completed?: boolean;
  }>;
  boundSessions: Array<{
    sessionId: string;
    label: string;
    createdAt: string;
    agentKey?: string;
  }>;
  taskGroups: TaskGroup[];
  linkedContracts: string[];
  linkedResearch: string[];
  /** Free-form labels, normalized to [] when absent. */
  tags: string[];
  archived?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ContractEntry {
  id: string;
  name: string;
  filePath: string;
  reviewSessions: Array<{
    sessionId: string;
    reviewedAt: string;
    revisionCount: number;
    commentCount: number;
  }>;
  linkedCaseId: string | null;
  parties: { ourSide: string; counterparty: string };
  status: 'pending' | 'reviewing' | 'reviewed';
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleItem {
  id: string;
  title: string;
  date: string;
  time?: string;                    // HH:mm, optional
  caseId?: string | null;
  caseName?: string;
  priority: 'high' | 'medium' | 'low';
  completed: boolean;
  /** Who created this standalone event. `'case'` is NOT a stored value — it is
   * the derived `sourceType` used only by the calendar projection
   * (deriveCalendarItems); on disk a standalone schedule is always manual|agent. */
  source: 'manual' | 'agent';
  /** Minutes-before reminder lead time. Stored + rendered as a badge now; a real
   * firing notification (CronTaskManager) is a future step — see Phase 3 plan. */
  reminderLeadMinutes?: number;
  /** Optional link to a specific task this event reminds about (does NOT make it
   * a derived task-deadline — it stays an editable standalone reminder). */
  taskId?: string;
  /** External-system provenance for agent-created events (e.g. a 飞书 bot). */
  externalId?: string;
  externalSystem?: string;
  createdAt: string;
}

// ── Timeline events (v1.1.0) ──
// Unified event pool replacing schedules.json + case keyDates. The calendar
// derives from this single source; keyDates are a backward-compat projection.

export type TimelineEventType = 'case_event' | 'task_deadline' | 'reference' | 'meeting' | 'filing' | 'hearing' | 'deadline' | 'service' | 'arbitration' | 'court_notice' | 'limitation_expiry' | 'defense_deadline' | 'evidence_deadline' | 'appeal_deadline' | 'retrial_deadline' | 'filing_deadline';
export type TimelineEventSource = 'manual' | 'agent' | 'case-file' | 'court-sms';
export type TimelineEventStatus = 'pending' | 'upcoming' | 'completed' | 'cancelled';

export interface TimelineRemindRule {
  type: 'before_event' | 'on_date' | 'weekly';
  minutes?: number;
  days?: number;
  time?: string;
  enabled: boolean;
}

export interface TimelineEvent {
  id: string;
  caseId: string;
  caseName: string;
  type: TimelineEventType;
  title?: string;
  detail?: string;
  label: string;
  date: string;               // YYYY-MM-DD
  time?: string;              // HH:mm
  source: TimelineEventSource;
  status: TimelineEventStatus;
  completedAt?: string;
  remindRules: TimelineRemindRule[];
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

// ── Standalone tasks (v1.1.0) ──
// Extracted from case-registry taskGroups with owner/stage fields.
// Tasks can live independently (caseId can be "") for meetings, follow-ups, etc.

export type StandaloneTaskStatus = 'todo' | 'in_progress' | 'done' | 'blocked';

export interface AgentLexStandaloneTask {
  id: string;
  caseId: string;
  caseName: string;
  groupTitle: string;
  groupOrder: number;
  title: string;
  status: StandaloneTaskStatus;
  priority: TaskPriority;
  deadline?: string;          // YYYY-MM-DD
  time?: string;              // HH:mm — 具体时间，与 deadline 分开存
  owner: string;
  creator: string;
  stage: string;
  blockedReason?: string;
  subtasks: SubTask[];
  checklist: ChecklistItem[];
  createdAt: string;
  updatedAt: string;
}

export interface ResearchEntry {
  id: string;
  topic: string;
  agentType: string;
  query: string;
  resultFilePath: string;
  resultUrl: string;
  linkedCaseId: string | null;
  tags: string[];
  createdAt: string;
}

interface AgentLexState {
  cases: CaseEntry[];
  projects: ProjectEntry[];
  contracts: ContractEntry[];
  research: ResearchEntry[];
  schedules: ScheduleItem[];
  timelineEvents: TimelineEvent[];
  standaloneTasks: AgentLexStandaloneTask[];
  loading: boolean;
  error: string | null;
}

/** Test-only alias for the internal store shape (used by useAgentLex.test.ts). */
export type AgentLexStateForTest = AgentLexState;
// ============================================================
// Module-level singleton store (one instance for the whole app)
// ============================================================

const LS_KEY = 'agentlex_registry_cache';
const EMPTY: AgentLexState = { cases: [], projects: [], contracts: [], research: [], schedules: [], timelineEvents: [], standaloneTasks: [], loading: false, error: null };

function loadCache(): AgentLexState {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      // Harden the cache against pre-migration / partially-written shapes. The
      // store invariant downstream is that each case's array fields ARE arrays
      // (consumers spread/for-of them). A case persisted before the data-model
      // unification can carry taskGroups as an object or undefined, which would
      // crash rendering before the first disk reload re-normalizes. Coerce here.
      const sanitizeCase = (c: unknown): CaseEntry => {
        const o = (c ?? {}) as Record<string, unknown>;
        const arr = (v: unknown) => (Array.isArray(v) ? v : []);
        return {
          ...(o as object),
          taskGroups: arr(o.taskGroups),
          keyDates: arr(o.keyDates),
          boundSessions: arr(o.boundSessions),
          instances: arr(o.instances),
          linkedContracts: arr(o.linkedContracts),
          linkedResearch: arr(o.linkedResearch),
          tags: arr(o.tags),
        } as CaseEntry;
      };
      return {
        cases: arrayOf(p.cases).map(sanitizeCase),
        projects: arrayOf(p.projects),
        contracts: arrayOf(p.contracts), research: arrayOf(p.research),
        schedules: arrayOf(p.schedules), timelineEvents: arrayOf(p.timelineEvents),
        standaloneTasks: arrayOf(p.standaloneTasks), loading: false, error: null,
      };
    }
  } catch { /* corrupt cache */ }
  return { ...EMPTY };
}

/** Coerce any value to an array — non-arrays (object/undefined) become []. */
function arrayOf<T>(v: unknown): T[] { return Array.isArray(v) ? (v as T[]) : []; }

function saveCache(s: AgentLexState): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ cases: s.cases, projects: s.projects, contracts: s.contracts, research: s.research, schedules: s.schedules, timelineEvents: s.timelineEvents, standaloneTasks: s.standaloneTasks }));
  } catch { /* quota */ }
}

let state: AgentLexState = loadCache();
const listeners = new Set<() => void>();

function setState(next: AgentLexState): void {
  state = next;
  saveCache(next);
  for (const l of listeners) l();
}

/** Pure core of the disk reload: incremental merge by caseId/scheduleId.
 *
 * A4 (multi-device sync): when Synology delivers a registry written on another
 * device — or our own locked write just landed — we must reconcile disk against
 * the in-memory store WITHOUT either (a) wiping a case this device just created
 * that hasn't reached disk yet, or (b) resurrecting a case that was DELETED
 * (here or on another device). Those two look identical at a single instant —
 * both are "in memory, absent from disk" — so we disambiguate with the
 * `seenCaseIds` / `seenScheduleIds` baseline: the set of ids observed on disk at
 * the PREVIOUS reload.
 *
 *  - Disk entries: authoritative — added/updated by id (disk version wins).
 *  - In-memory entry absent from disk AND never seen on disk before
 *    (`!seen`): a local create whose write-back is still in flight → KEEP.
 *  - In-memory entry absent from disk but PREVIOUSLY seen on disk (`seen`):
 *    it was deleted (this device or another) or clobbered → DROP. This is the
 *    fix for "deleted case comes back": the old merge kept every local-only
 *    entry forever, so a delete never propagated through a reload.
 *  - contracts + research are local-only (no Rust commands yet) → untouched.
 *
 * Exported for regression tests. */
export function mergeDiskSlice(
  prev: AgentLexState,
  cases: CaseEntry[],
  schedules: ScheduleItem[],
  seenCaseIds: ReadonlySet<string>,
  seenScheduleIds: ReadonlySet<string>,
  timelineEvents?: TimelineEvent[],
  standaloneTasks?: AgentLexStandaloneTask[],
  seenTimelineEventIds?: ReadonlySet<string>,
  seenStandaloneTaskIds?: ReadonlySet<string>,
  projects?: ProjectEntry[],
  seenProjectIds?: ReadonlySet<string>,
  contracts?: ContractEntry[],
  research?: ResearchEntry[],
): AgentLexState {
  // Cases: disk wins; keep an in-memory case only if it was NEVER on disk
  // (pending local create), drop it if it was on disk before (deleted/clobbered).
  const diskCaseIds = new Set(cases.map(c => c.caseId));
  const merged: CaseEntry[] = [];
  for (const c of prev.cases) {
    if (!diskCaseIds.has(c.caseId) && !seenCaseIds.has(c.caseId)) {
      merged.push(c); // never persisted → local create in flight, keep
    }
  }
  for (const c of cases) merged.push(c);

  // Schedules: same disambiguation by id.
  const diskSchedIds = new Set(schedules.map(s => s.id).filter(Boolean) as string[]);
  const mergedSched: ScheduleItem[] = [];
  for (const s of prev.schedules) {
    if (s.id && !diskSchedIds.has(s.id) && !seenScheduleIds.has(s.id)) mergedSched.push(s);
  }
  for (const s of schedules) mergedSched.push(s);
  mergedSched.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  // Timeline events: same disambiguation by id.
  const tlEvents = timelineEvents ?? [];
  const stasks = standaloneTasks ?? [];
  const seenTl = seenTimelineEventIds ?? new Set();
  const seenSt = seenStandaloneTaskIds ?? new Set();

  const diskTlIds = new Set(tlEvents.map(e => e.id).filter(Boolean) as string[]);
  const mergedTl: TimelineEvent[] = [];
  for (const e of prev.timelineEvents) {
    if (e.id && !diskTlIds.has(e.id) && !seenTl.has(e.id)) mergedTl.push(e);
  }
  for (const e of tlEvents) mergedTl.push(e);

  const diskStIds = new Set(stasks.map(t => t.id).filter(Boolean) as string[]);
  const mergedSt: AgentLexStandaloneTask[] = [];
  for (const t of prev.standaloneTasks) {
    if (t.id && !diskStIds.has(t.id) && !seenSt.has(t.id)) mergedSt.push(t);
  }
  for (const t of stasks) mergedSt.push(t);

  // Projects: same disambiguation by projectId.
  const projs = projects ?? [];
  const seenPj = seenProjectIds ?? new Set();
  const diskProjIds = new Set(projs.map(p => p.projectId));
  const mergedProj: ProjectEntry[] = [];
  for (const p of prev.projects) {
    if (!diskProjIds.has(p.projectId) && !seenPj.has(p.projectId)) mergedProj.push(p);
  }
  for (const p of projs) mergedProj.push(p);

  // Phase 4: contracts + research — disk is authoritative (full replace, not merge)
  const mergedContracts = contracts ?? prev.contracts;
  const mergedResearch = research ?? prev.research;

  return { ...prev, cases: merged, projects: mergedProj, schedules: mergedSched, timelineEvents: mergedTl, standaloneTasks: mergedSt, contracts: mergedContracts, research: mergedResearch, loading: false, error: null };
}

/** Ids observed on disk at the last reload — the baseline mergeDiskSlice uses
 *  to tell "local create in flight" (never seen → keep) from "deleted/clobbered"
 *  (was seen, now gone → drop). Updated AFTER each successful merge.
 *
 *  SEEDED from the hydrated localStorage cache (not empty): the cache IS "what
 *  we last knew was on disk", so every cached case/schedule counts as
 *  previously-seen. Without this seed, a fresh launch left the baseline empty,
 *  so a CACHED case the host no longer has (e.g. a test case created against a
 *  different/earlier backend, or deleted on another device) read as "never seen
 *  → local create in flight → keep" and survived every reload AND every delete
 *  (delete routes to the host, which never had it) — an immortal ghost case.
 *  Seeding makes the first reload correctly DROP such a cached-but-not-on-disk
 *  case, while a genuinely new create (added after launch, absent from the
 *  initial cache) is still protected. */
let seenCaseIds: Set<string> = new Set(state.cases.map(c => c.caseId));
let seenScheduleIds: Set<string> = new Set(state.schedules.map(s => s.id).filter(Boolean) as string[]);
let seenTimelineEventIds: Set<string> = new Set((state.timelineEvents ?? []).map(e => e.id).filter(Boolean) as string[]);
let seenStandaloneTaskIds: Set<string> = new Set((state.standaloneTasks ?? []).map(t => t.id).filter(Boolean) as string[]);
let seenProjectIds: Set<string> = new Set((state.projects ?? []).map(p => p.projectId));

/** Patch all slices from disk; keep local contracts + research. */
function setDiskSlice(
  cases: CaseEntry[], schedules: ScheduleItem[],
  timelineEvents?: TimelineEvent[], standaloneTasks?: AgentLexStandaloneTask[],
  projects?: ProjectEntry[],
  contracts?: ContractEntry[], research?: ResearchEntry[],
): void {
  setState(mergeDiskSlice(state, cases, schedules, seenCaseIds, seenScheduleIds, timelineEvents, standaloneTasks, seenTimelineEventIds, seenStandaloneTaskIds, projects, seenProjectIds, contracts ?? state.contracts, research ?? state.research));
  // Refresh the baseline to exactly what disk just reported, so the NEXT reload
  // can distinguish a brand-new local create from a remote deletion.
  seenCaseIds = new Set(cases.map(c => c.caseId));
  seenScheduleIds = new Set(schedules.map(s => s.id).filter(Boolean) as string[]);
  seenTimelineEventIds = new Set((timelineEvents ?? []).map(e => e.id).filter(Boolean) as string[]);
  seenStandaloneTaskIds = new Set((standaloneTasks ?? []).map(t => t.id).filter(Boolean) as string[]);
  seenProjectIds = new Set((projects ?? []).map(p => p.projectId));
}

const getSnapshot = () => state;

// ============================================================
// Disk reload — disk is authoritative for cases + schedules
// ============================================================

// Loose shapes for the on-disk JSON (fields may be missing on older records).
export interface DiskKeyDate { label?: string; date?: string; source?: string; completed?: boolean }
export interface DiskBoundSession { sessionId?: string; label?: string; createdAt?: string; agentKey?: string }
export interface DiskChecklistItem { id?: string; text?: string; done?: boolean }
export interface DiskSubTask { id?: string; title?: string; deadline?: string; priority?: string; status?: string; createdAt?: string; updatedAt?: string }
export interface DiskTask {
  id?: string; title?: string; detail?: string; folder?: string; deadline?: string; time?: string;
  priority?: string; status?: string; subtasks?: DiskSubTask[]; checklist?: DiskChecklistItem[];
  createdAt?: string; updatedAt?: string;
}
export interface DiskTaskGroup {
  id?: string; title?: string; order?: number; tasks?: DiskTask[];
  createdAt?: string; updatedAt?: string;
}
export interface DiskCase {
  caseId?: string; caseNumber?: string; name?: string; alias?: string[];
  type?: string; caseType?: string; cause?: string; status?: string; folder?: string; court?: string;
  judge?: string; claimAmount?: string; fee?: string; retainerUnit?: string; filingDate?: string; summary?: string;
  level?: string;
  instances?: CaseEntry['instances'];
  parties?: CaseEntry['parties'];
  keyDates?: DiskKeyDate[]; boundSessions?: DiskBoundSession[];
  taskGroups?: DiskTaskGroup[];
  linkedContracts?: string[]; linkedResearch?: string[];
  tags?: string[];
  archived?: boolean;
  createdAt?: string; updatedAt?: string;
}
export interface DiskSchedule {
  id?: string; title?: string; date?: string; time?: string;
  caseId?: string | null; caseName?: string; priority?: string;
  completed?: boolean; source?: string; createdAt?: string;
  reminderLeadMinutes?: number; taskId?: string; externalId?: string; externalSystem?: string;
}

export interface DiskServicePeriod { start?: string; end?: string }
export interface DiskProject {
  projectId?: string; name?: string; projectType?: string; status?: string;
  servicePeriod?: DiskServicePeriod; serviceScope?: string[];
  leadLawyer?: string; team?: string[]; contractAmount?: string;
  folder?: string;
  keyDates?: DiskKeyDate[]; boundSessions?: DiskBoundSession[];
  taskGroups?: DiskTaskGroup[];
  linkedContracts?: string[]; linkedResearch?: string[];
  tags?: string[];
  archived?: boolean;
  createdAt?: string; updatedAt?: string;
}

// Normalize one disk task-group → full TaskGroup (defaults for sparse records).
function normalizeTaskGroup(dg: DiskTaskGroup, idx: number): TaskGroup {
  const now = new Date().toISOString();
  return {
    id: dg.id ?? `tg-${idx}`,
    title: dg.title ?? '',
    order: dg.order ?? idx,
    tasks: (dg.tasks ?? []).map((dt, ti) => ({
      id: dt.id ?? `task-${idx}-${ti}`,
      title: dt.title ?? '',
      detail: dt.detail,
      folder: dt.folder,
      deadline: dt.deadline,
      time: dt.time,
      priority: (dt.priority as TaskPriority) ?? 'medium',
      status: (dt.status as TaskStatus) ?? 'todo',
      subtasks: (dt.subtasks ?? []).map((ds, si) => ({
        id: ds.id ?? `st-${idx}-${ti}-${si}`,
        title: ds.title ?? '',
        deadline: ds.deadline,
        priority: ds.priority as TaskPriority | undefined,
        status: (ds.status as TaskStatus) ?? 'todo',
        createdAt: ds.createdAt,
        updatedAt: ds.updatedAt,
      })),
      checklist: (dt.checklist ?? []).map((dc, ci) => ({
        id: dc.id ?? `ck-${idx}-${ti}-${ci}`,
        text: dc.text ?? '',
        done: dc.done ?? false,
      })),
      createdAt: dt.createdAt ?? now,
      updatedAt: dt.updatedAt ?? now,
    })),
    createdAt: dg.createdAt ?? now,
    updatedAt: dg.updatedAt ?? now,
  };
}

function normalizeParties(raw: DiskCase['parties']): CaseEntry['parties'] {
  const p = (raw ?? {}) as Record<string, unknown>;
  // details 是权威（0.2.0 起 parties.details 存全量当事人，含 roles[] 多身份）。
  // 首级 plaintiff/defendant 仅是历史兼容冗余；只有当 details 完全缺失（纯 legacy
  // 记录）才从首级字段补行。修复：此前 auto-populate 用「精确字符串 hasRole('原告')」
  // 判定 + 无脑补首级行，导致已归一的数据（申请人/第一被申请人等 canonical 变体）
  // 被误判为「缺原告/被告」而重复补行——002 4 行、003 5 行 的根因。
  // 详见备忘录 #5：同一主体不重复列当事人。
  const rawDetails = Array.isArray(p.details) ? p.details as Array<Record<string, unknown>> : [];
  const details = rawDetails.map(d => ({
    name: typeof d.name === 'string' ? d.name : '',
    role: normalizePartyRole(typeof d.role === 'string' ? d.role : ''),
    roles: Array.isArray(d.roles) ? (d.roles as unknown[]).map(String) : undefined,
    firm: typeof d.firm === 'string' ? d.firm : undefined,
    phone: typeof d.phone === 'string' ? d.phone : undefined,
    address: typeof d.address === 'string' ? d.address : undefined,
    // 我方指认标记必须透传（2026-09-04：此前丢失导致 UI 无法识别我方当事人，
    // 003 两个被申请人里把非我方的邦得人力也标成我方）。
    ourClient: d.ourClient === true,
  }));
  // 仅当 details 为空时才从 legacy 首级字段兜底补行（避免重复主体）。
  if (details.length === 0) {
    const pushIfMissing = (name: string | undefined, roleLabel: '原告' | '被告') => {
      if (typeof name !== 'string' || name.trim() === '') return;
      // 顿号串 = 多人合并的旧首级写法，不再按单主体补行（details 应显式维护）。
      if (name.includes('、') || name.includes(',')) return;
      const sideRoles = roleLabel === '原告' ? ['原告', '申请人', '上诉人', '申请执行人']
        : ['被告', '被申请人', '被上诉人', '被执行人'];
      const exists = details.some(d => sideRoles.includes(canonicalPartyRole(d.role ?? '')));
      if (!exists) details.push({ name, role: roleLabel as string, firm: undefined, phone: undefined, address: undefined, ourClient: false });
    };
    pushIfMissing(typeof p.plaintiff === 'string' ? p.plaintiff : undefined, '原告');
    pushIfMissing(typeof p.defendant === 'string' ? p.defendant : undefined, '被告');
  }
  return {
    plaintiff: typeof p.plaintiff === 'string' ? p.plaintiff : undefined,
    defendant: typeof p.defendant === 'string' ? p.defendant : undefined,
    ourSide: typeof p.ourSide === 'string' ? p.ourSide : 'unknown',
    // 我方当事人名指认（与行内 ourClient 双保险）。
    ourClientName: typeof p.ourClientName === 'string' ? p.ourClientName : undefined,
    details,
  };
}

export function normalizeCase(id: string, dc: DiskCase): CaseEntry {
  const now = new Date().toISOString();
  const type = normalizeCaseType(dc.type ?? dc.caseType ?? '', `${dc.cause ?? ''} ${dc.name ?? ''}`);
  // 审级必须先于状态归一：状态阶梯按审级分套，normalizeStatus 必须带上 level，
  // 否则二审/执行案的状态会被按一审套误归一（如「上诉立案」被改成「庭前准备」，
  // 且用户改完状态一刷新又变回去）。
  const level = normalizeLevel(dc.level ?? dc.instances?.[0]?.level ?? '', type);
  return {
    caseId: dc.caseId ?? id,
    caseNumber: dc.caseNumber ?? '',
    name: dc.name ?? '',
    alias: dc.alias ?? [],
    type,
    cause: dc.cause ?? '',
    status: normalizeStatus(dc.status ?? 'intake', level),
    folder: dc.folder ?? '',
    judge: dc.judge ?? '',
    claimAmount: dc.claimAmount ?? '',
    fee: dc.fee ?? '',
    retainerUnit: typeof dc.retainerUnit === 'string' ? dc.retainerUnit : '',
    filingDate: dc.filingDate ?? '',
    summary: dc.summary ?? '',
    level,
    instances: (dc.instances ?? []).map(inst => ({
      ...inst,
      level: normalizeLevel(inst.level, type),
    })),
    court: dc.court ?? '',
    parties: normalizeParties(dc.parties),
    keyDates: (dc.keyDates ?? []).map(kd => ({
      label: kd.label ?? '', date: kd.date ?? '',
      source: kd.source ?? 'agent-computed', completed: kd.completed ?? false,
    })),
    boundSessions: (dc.boundSessions ?? []).map(bs => ({ sessionId: bs.sessionId ?? '', label: bs.label ?? '', createdAt: bs.createdAt ?? now, agentKey: bs.agentKey })),
    taskGroups: (dc.taskGroups ?? [])
      .map(normalizeTaskGroup)
      .sort((a, b) => a.order - b.order),
    linkedContracts: dc.linkedContracts ?? [],
    linkedResearch: dc.linkedResearch ?? [],
    tags: dc.tags ?? [],
    archived: dc.archived ?? false,
    createdAt: dc.createdAt ?? now,
    updatedAt: dc.updatedAt ?? now,
  };
}

export function normalizeSchedule(ds: DiskSchedule): ScheduleItem {
  return {
    id: ds.id ?? '', title: ds.title ?? '', date: ds.date ?? '', time: ds.time,
    caseId: ds.caseId ?? null, caseName: ds.caseName,
    priority: (ds.priority as ScheduleItem['priority']) ?? 'medium',
    completed: ds.completed ?? false,
    // Legacy disk records used 'case'; that's no longer a stored value (it's a
    // derived sourceType), so anything not 'agent' normalizes to 'manual'.
    source: ds.source === 'agent' ? 'agent' : 'manual',
    reminderLeadMinutes: ds.reminderLeadMinutes,
    taskId: ds.taskId, externalId: ds.externalId, externalSystem: ds.externalSystem,
    createdAt: ds.createdAt ?? new Date().toISOString(),
  };
}

export function normalizeProject(dp: DiskProject): ProjectEntry {
  const now = new Date().toISOString();
  return {
    projectId: dp.projectId ?? '',
    name: dp.name ?? '',
    projectType: (dp.projectType === 'retainer' || dp.projectType === 'special' ? dp.projectType : 'special') as ProjectType,
    status: (dp.status === 'active' || dp.status === 'inactive' || dp.status === 'closed' ? dp.status : 'active') as ProjectStatus,
    servicePeriod: {
      start: dp.servicePeriod?.start ?? '',
      end: dp.servicePeriod?.end ?? '',
    },
    serviceScope: dp.serviceScope ?? [],
    leadLawyer: dp.leadLawyer ?? '',
    team: dp.team ?? [],
    contractAmount: dp.contractAmount ?? '',
    folder: dp.folder ?? '',
    keyDates: (dp.keyDates ?? []).map(kd => ({
      label: kd.label ?? '', date: kd.date ?? '',
      source: kd.source ?? 'manual', completed: kd.completed ?? false,
    })),
    boundSessions: (dp.boundSessions ?? []).map(bs => ({
      sessionId: bs.sessionId ?? '', label: bs.label ?? '',
      createdAt: bs.createdAt ?? now, agentKey: bs.agentKey,
    })),
    taskGroups: (dp.taskGroups ?? [])
      .map(normalizeTaskGroup)
      .sort((a, b) => a.order - b.order),
    linkedContracts: dp.linkedContracts ?? [],
    linkedResearch: dp.linkedResearch ?? [],
    tags: dp.tags ?? [],
    archived: dp.archived ?? false,
    createdAt: dp.createdAt ?? now,
    updatedAt: dp.updatedAt ?? now,
  };
}

// ── Disk shapes for timeline events + standalone tasks ──

export interface DiskTimelineEvent {
  id?: string; caseId?: string; caseName?: string; type?: string;
  title?: string; label?: string; date?: string; time?: string;
  source?: string; status?: string; completedAt?: string;
  remindRules?: TimelineRemindRule[];
  createdAt?: string; createdBy?: string; updatedAt?: string;
}

export interface DiskStandaloneTask {
  id?: string; caseId?: string; caseName?: string;
  groupTitle?: string; groupOrder?: number;
  title?: string; status?: string; priority?: string;
  deadline?: string; owner?: string; creator?: string;
  stage?: string; blockedReason?: string; time?: string;
  subtasks?: SubTask[]; checklist?: ChecklistItem[];
  createdAt?: string; updatedAt?: string;
}

export function normalizeTimelineEvent(raw: DiskTimelineEvent): TimelineEvent {
  return {
    id: raw.id ?? '',
    caseId: raw.caseId ?? '',
    caseName: raw.caseName ?? '',
    type: (raw.type as TimelineEventType) ?? 'case_event',
    label: raw.title ?? raw.label ?? '',
    date: raw.date ?? '',
    time: raw.time,
    source: (raw.source as TimelineEventSource) ?? 'manual',
    status: (raw.status as TimelineEventStatus) ?? 'pending',
    completedAt: raw.completedAt,
    remindRules: (raw.remindRules ?? []) as TimelineRemindRule[],
    createdAt: raw.createdAt ?? new Date().toISOString(),
    createdBy: raw.createdBy ?? '诉讼管家',
    updatedAt: raw.updatedAt ?? new Date().toISOString(),
  };
}

/** Infer a TimelineEvent type from a legacy keyDate label (mirrors the agent SOP
 *  rules + the one-time backfill). Used only for the read-time fallback below. */
function inferEventType(label: string): TimelineEventType {
  if (label.includes('开庭')) return 'hearing';
  if (label.includes('举证')) return 'evidence_deadline';
  if (label.includes('答辩')) return 'defense_deadline';
  if (label.includes('上诉')) return 'appeal_deadline';
  if (label.includes('再审')) return 'retrial_deadline';
  if (label.includes('时效') || label.includes('审限')) return 'limitation_expiry';
  if (label.includes('立案') && label.includes('截止')) return 'filing_deadline';
  if (label.includes('立案') || label.includes('起诉')) return 'filing';
  if (label.includes('送达')) return 'service';
  return 'case_event';
}

/** Project a case's legacy `keyDates` into TimelineEvents. This is the read-time
 *  safety net for cases that predate the keyDates→timeline migration (or whose
 *  timeline got cleared): the case detail page + key-dates panel can still
 *  render without requiring the data to have been migrated on disk. Past dates
 *  become `completed` (so they never show as 逾期), future dates `pending`. */
export function projectKeyDatesToTimeline(c: CaseEntry): TimelineEvent[] {
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date().toISOString();
  return (c.keyDates ?? [])
    .filter(kd => kd.date && kd.label)
    .map((kd, i) => ({
      id: `kd-proj-${c.caseId}-${i}`,
      caseId: c.caseId,
      caseName: c.name,
      type: inferEventType(kd.label),
      label: kd.label,
      date: kd.date,
      source: (kd.source === 'agent-computed' ? 'agent' : kd.source === 'case-file' ? 'case-file' : 'manual') as TimelineEventSource,
      status: (kd.completed === true || kd.date < today ? 'completed' : 'pending') as TimelineEventStatus,
      remindRules: [],
      createdAt: now,
      createdBy: '诉讼管家',
      updatedAt: now,
    }));
}

export function normalizeStandaloneTask(raw: DiskStandaloneTask): AgentLexStandaloneTask {
  return {
    id: raw.id ?? '',
    caseId: raw.caseId ?? '',
    caseName: raw.caseName ?? '',
    groupTitle: raw.groupTitle ?? '',
    groupOrder: raw.groupOrder ?? 0,
    title: raw.title ?? '',
    status: (raw.status as StandaloneTaskStatus) ?? 'todo',
    priority: (raw.priority as TaskPriority) ?? 'medium',
    deadline: raw.deadline,
    time: raw.time,
    owner: raw.owner ?? '',
    creator: raw.creator ?? '诉讼管家',
    stage: raw.stage ?? '',
    blockedReason: raw.blockedReason,
    subtasks: (raw.subtasks ?? []) as SubTask[],
    checklist: (raw.checklist ?? []) as ChecklistItem[],
    createdAt: raw.createdAt ?? new Date().toISOString(),
    updatedAt: raw.updatedAt ?? new Date().toISOString(),
  };
}

/**
 * DSH plugin transport for the legacy `/api/agentlex/*` adapter surface.
 *
 * The original renderer calls `cmd_agentlex_*` IPC commands. Inside a DSH
 * browser plugin there is no Tauri core; instead the DSH adapter exposes the
 * same legacy API at `/api/agentlex/*` with camelCase bodies. This function
 * translates each command to that adapter route and unwraps the
 * `{ success, data }` envelope.
 */
async function tryRemoteAgentlex(
  command: string,
  args: Record<string, unknown>,
): Promise<{ ok: true; data: unknown } | undefined> {
  const target = getClientRemoteTarget();
  if (!target.isRemote || !target.origin) return undefined;
  const PREFIX = 'cmd_agentlex_';
  if (!command.startsWith(PREFIX)) return undefined;
  const verb = command.slice(PREFIX.length).replace(/_/g, '-');

  let path = `/api/agentlex/${verb}`
  let method = 'POST'
  let body: Record<string, unknown> | undefined = args

  if (verb === 'read-registry') {
    path = '/api/agentlex/read'
    method = 'GET'
    body = undefined
  } else if (verb === 'register-case' || verb === 'register-project') {
    // The adapter's register-* routes expect the flat record, not {record}.
    body = (args.record as Record<string, unknown> | undefined) ?? args
  } else if (verb === 'update-case' || verb === 'update-project') {
    const idKey = verb === 'update-case' ? 'caseId' : 'projectId'
    const patch = (args.patch ?? {}) as Record<string, unknown>
    body = { [idKey]: args[idKey], ...patch }
  } else if (verb === 'bind-session') {
    // The legacy adapter has no dedicated bind-session route; patch the case.
    const caseId = String(args.caseId ?? '')
    const sessionId = String(args.sessionId ?? '')
    const label = String(args.label ?? '会话')
    const agentKey = args.agentKey as string | undefined
    const current = state.cases.find((c) => c.caseId === caseId)
    const boundSessions = current ? current.boundSessions : []
    path = '/api/agentlex/update-case'
    body = {
      caseId,
      boundSessions: [
        ...boundSessions.filter((b) => b.sessionId !== sessionId),
        { sessionId, label, createdAt: new Date().toISOString(), agentKey },
      ],
    }
  }

  const url = `${target.origin}${path}`
  const resp = await fetch(url, {
    method,
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!resp.ok) throw new Error(`[agentlex] remote ${command} HTTP ${resp.status}`)
  const envelope = await resp.json().catch(() => ({})) as Record<string, unknown>
  const data =
    envelope && typeof envelope === 'object' && 'success' in envelope && 'data' in envelope
      ? (envelope as { data: unknown }).data
      : envelope
  return { ok: true, data }
}

async function fetchRegistry(): Promise<{
  cases: Record<string, DiskCase>;
  projects: Record<string, DiskProject>;
  schedules: DiskSchedule[];
  timeline: Record<string, DiskTimelineEvent>;
  standaloneTasks: Record<string, DiskStandaloneTask>;
} | null> {
  const parseAll = (data: Record<string, unknown>) => ({
    cases: (data.cases ?? {}) as Record<string, DiskCase>,
    projects: (data.projects ?? {}) as Record<string, DiskProject>,
    schedules: (data.schedules ?? []) as DiskSchedule[],
    timeline: (data.timeline ?? {}) as Record<string, DiskTimelineEvent>,
    standaloneTasks: (data.standaloneTasks ?? {}) as Record<string, DiskStandaloneTask>,
  });
  // Plan A: in remote mode read the registry from the host gateway.
  try {
    const remote = await tryRemoteAgentlex('cmd_agentlex_read_registry', {});
    if (remote) {
      return parseAll(remote.data as Record<string, unknown>);
    }
  } catch (e) {
    console.warn('[agentlex] remote registry read failed:', e);
    return null;
  }
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const raw = await invoke<string>('cmd_agentlex_read_registry');
      const data = JSON.parse(raw);
      return parseAll(data);
    } catch { /* fall through to HTTP */ }
  }
  // Last-resort web fallback: the real read route is GET /api/agentlex/read
  // (the old `/api/agentlex/registry` path was never mounted anywhere). Unwrap
  // the sidecar admin envelope the same way tryRemoteAgentlex does.
  try {
    const resp = await fetch(applyRemoteOrigin('/api/agentlex/read'));
    if (resp.ok) {
      const body = (await resp.json()) as Record<string, unknown>;
      const data =
        body && typeof body === 'object' && 'success' in body && 'data' in body
          ? (body as { data: unknown }).data
          : body;
      return parseAll(data as Record<string, unknown>);
    }
  } catch { /* no sidecar */ }
  return null;
}

let reloadInFlight: Promise<void> | null = null;
let pendingReload = false;

/** Reload cases + schedules from disk into the store. Coalesces concurrent calls
 *  but guarantees a re-read if a request arrived during an in-flight fetch. */
async function reloadFromDisk(): Promise<void> {
  if (reloadInFlight) { pendingReload = true; return reloadInFlight; }
  const doReload = async () => {
    pendingReload = false;
    const reg = await fetchRegistry();
    if (!reg) return;
    const cases: CaseEntry[] = [];
    for (const [id, dc] of Object.entries(reg.cases)) {
      if (id === 'research' || !dc?.caseId) continue;
      cases.push(normalizeCase(id, dc));
    }
    const schedules = (reg.schedules ?? []).map(normalizeSchedule).sort((a, b) => a.date.localeCompare(b.date));
    const timelineEvents = Object.values(reg.timeline ?? {}).map(normalizeTimelineEvent);
    const standaloneTasks = Object.values(reg.standaloneTasks ?? {}).map(normalizeStandaloneTask);
    const projects = Object.values(reg.projects ?? {}).filter(p => p.projectId).map(p => normalizeProject(p));
    // Phase 4: load contracts and research from disk (cmd_agentlex_list_contracts / list_research)
    let contracts: ContractEntry[] = [];
    let research: ResearchEntry[] = [];
    const parseContracts = (raw: Record<string, unknown>) => {
      const list = (raw.contracts ?? {}) as Record<string, unknown>;
      contracts = Object.values(list).map(c => normalizeContractFromDisk(c as Record<string, unknown>));
    };
    const parseResearch = (raw: Record<string, unknown>) => {
      const list = (raw.research ?? {}) as Record<string, unknown>;
      research = Object.values(list).map(r => normalizeResearchFromDisk(r as Record<string, unknown>));
    };
    // Web / remote mode reads through the host's /api/agentlex/list-* routes
    // (same locked core); Tauri reads via the desktop cmd_* commands.
    try {
      const rc = await tryRemoteAgentlex('cmd_agentlex_list_contracts', {});
      if (rc) parseContracts(rc.data as Record<string, unknown>);
    } catch { /* best-effort */ }
    try {
      const rr = await tryRemoteAgentlex('cmd_agentlex_list_research', {});
      if (rr) parseResearch(rr.data as Record<string, unknown>);
    } catch { /* best-effort */ }
    if (isTauriEnvironment()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const contractResult = JSON.parse(await invoke<string>('cmd_agentlex_list_contracts'));
        if (contractResult.ok && contractResult.contracts) parseContracts(contractResult);
        const researchResult = JSON.parse(await invoke<string>('cmd_agentlex_list_research'));
        if (researchResult.ok && researchResult.research) parseResearch(researchResult);
      } catch {
        // Disk loading is best-effort: if the file doesn't exist yet, use empty arrays.
      }
    }
    setDiskSlice(cases, schedules, timelineEvents, standaloneTasks, projects, contracts, research);
  };
  reloadInFlight = doReload();
  try { await reloadInFlight; } finally {
    reloadInFlight = null;
    if (pendingReload) { void reloadFromDisk(); }
  }
}

// ============================================================
// One-time init: subscribe to the Rust event + focus, do first load
// ============================================================

let initialized = false;

function ensureInitialized(): void {
  if (initialized) return;
  initialized = true;

  // Real-time: Rust emits `agentlex:registry-changed` after EVERY locked write
  // (UI command OR Phase 0b agent path). This is what makes an agent-added
  // schedule appear without restarting the app (pre-1.1.0 bug A). The store is
  // process-lifelong, so the listener never needs teardown — use a controller
  // that's never aborted (listenWithCleanup is the project's required wrapper;
  // bare `listen` is ESLint-banned).
  if (isTauriEnvironment()) {
    const neverAbort = new AbortController();
    void listenWithCleanup('agentlex:registry-changed', () => { void reloadFromDisk(); }, neverAbort.signal);
  }

  // Browser dev (no Tauri event bus) + belt-and-suspenders in Tauri: refresh on
  // window focus. This is the ONLY focus-sync now — the dueling full-replace /
  // merge effects in AgentLexLayout + CaseManager are removed.
  window.addEventListener('focus', () => { void reloadFromDisk(); });

  // DSH plugin mode: the litigation host writes are bridged to the browser as
  // a window CustomEvent (the plugin's live-refresh poller re-dispatches it
  // every few seconds). Accept it in every environment so tool/route writes
  // converge on the board without a focus change or reload.
  window.addEventListener('agentlex:registry-changed', () => { void reloadFromDisk(); });

  void reloadFromDisk();
}

function subscribe(listener: () => void): () => void {
  ensureInitialized();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// ============================================================
// Mutations — disk-first: invoke Rust command, then reload from disk.
// In browser dev (no Tauri) fall back to an optimistic local reducer so the
// UI still works without a Rust backend.
// ============================================================

/**
 * Run a disk-first mutation. In Tauri: invoke the Rust command; the
 * `registry-changed` event triggers reload, but we also reload explicitly so
 * the caller can await a consistent store. In the browser: apply `localReducer`
 * optimistically (no Rust backend to write to).
 */
async function mutateDisk(
  command: string,
  args: Record<string, unknown>,
  localReducer: (s: AgentLexState) => AgentLexState,
): Promise<void> {
  // Plan A: in remote mode the registry lives on the host — dispatch the write
  // through the gateway, then reload (the host emits registry-changed locally,
  // but this client reloads explicitly since it won't receive that Tauri event).
  const remote = await tryRemoteAgentlex(command, args);
  if (remote) {
    await reloadFromDisk();
    return;
  }
  if (isTauriEnvironment()) {
    // Optimistic update BEFORE disk write so the UI reacts instantly
    if (localReducer) setState(localReducer(state));
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke(command, args);
    await reloadFromDisk();
  } else {
    setState(localReducer(state));
  }
}

// ── Case actions ──

/** Read a single case with its timeline events joined in. */
async function readCase(caseId: string): Promise<{ case: CaseEntry; timeline: TimelineEvent[] } | null> {
  // If the joined timeline is empty but the case carries legacy keyDates, project
  // them — the read-time safety net for cases that predate the migration.
  const withFallback = (c: CaseEntry, timeline: TimelineEvent[]) =>
    ({ case: c, timeline: timeline.length ? timeline : projectKeyDatesToTimeline(c) });
  const target = getClientRemoteTarget();
  if (target.isRemote && target.origin) {
    try {
      const remote = await tryRemoteAgentlex('cmd_agentlex_read_case', { caseId });
      if (remote) {
        const data = remote.data as { caseId?: string; timeline?: TimelineEvent[] } & Record<string, unknown>;
        if (data.caseId) {
          const c = normalizeCase(caseId, data as DiskCase);
          return withFallback(c, ((data.timeline ?? []) as DiskTimelineEvent[]).map(normalizeTimelineEvent));
        }
      }
    } catch { /* fall through */ }
  }
  if (isTauriEnvironment()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const raw = await invoke<string>('cmd_agentlex_read_case', { caseId });
      const data = JSON.parse(raw);
      if (data.caseId) {
        const c = normalizeCase(caseId, data as DiskCase);
        return withFallback(c, ((data.timeline ?? []) as DiskTimelineEvent[]).map(normalizeTimelineEvent));
      }
    } catch { /* fall through */ }
  }
  // Fallback: the per-case command may be unavailable (e.g. not registered in
  // the running build) or return nothing. The global store's timelineEvents is
  // populated by the always-available read_registry path, so derive the same
  // per-case view from it. Keeps 关键日程 + 办案时间轴 rendering regardless.
  const entry = state.cases.find(c => c.caseId === caseId);
  if (entry) {
    const timeline = (state.timelineEvents ?? []).filter(e => e.caseId === caseId);
    return withFallback(entry, timeline);
  }
  return null;
}

async function addCase(c: CaseEntry): Promise<void> {
  // 新建案件登记（备忘录 #8 后续要求）：编号冲突必须报错、绝不静默覆盖既有案件。
  // 早前版本在 register 失败时回落 update（upsert parity），会把新卡片整个盖到
  // 旧案件上 → 数据丢失。现在冲突即抛错，由调用方（新建表单）提示用户改号。
  const target = getClientRemoteTarget();
  const existing = state.cases.find(x => x.caseId === c.caseId);
  if (existing) {
    throw new Error(`案件编号 ${c.caseId} 已存在（${existing.name}），请换一个编号`);
  }
  const friendly = (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    if (/collision/i.test(msg)) return `案件编号 ${c.caseId} 已被占用，请更换编号（未覆盖任何数据）`;
    return msg;
  };
  if (target.isRemote && target.origin) {
    try {
      await tryRemoteAgentlex('cmd_agentlex_register_case', { caseId: c.caseId, record: c });
    } catch (e) {
      throw new Error(friendly(e));
    }
    await reloadFromDisk();
    return;
  }
  if (isTauriEnvironment()) {
    const { invoke } = await import('@tauri-apps/api/core');
    try {
      await invoke('cmd_agentlex_register_case', { caseId: c.caseId, record: c });
    } catch (e) {
      throw new Error(friendly(e));
    }
    await reloadFromDisk();
  } else {
    setState({ ...state, cases: [...state.cases.filter(x => x.caseId !== c.caseId), c] });
  }
}

async function updateCase(caseId: string, updater: (c: CaseEntry) => CaseEntry): Promise<void> {
  const current = state.cases.find(c => c.caseId === caseId);
  if (!current) return;
  const updated = updater(current);
  await mutateDisk('cmd_agentlex_update_case', { caseId, patch: updated }, s => ({
    ...s, cases: s.cases.map(c => c.caseId === caseId ? updated : c),
  }));
}

async function deleteCase(caseId: string): Promise<void> {
  await mutateDisk('cmd_agentlex_delete_case', { caseId }, s => ({
    ...s, cases: s.cases.filter(c => c.caseId !== caseId),
  }));
}

// ── Project actions ──

async function addProject(p: ProjectEntry): Promise<void> {
  const target = getClientRemoteTarget();
  if (target.isRemote && target.origin) {
    try {
      await tryRemoteAgentlex('cmd_agentlex_register_project', { projectId: p.projectId, record: p });
    } catch {
      await tryRemoteAgentlex('cmd_agentlex_update_project', { projectId: p.projectId, patch: p });
    }
    await reloadFromDisk();
    return;
  }
  if (isTauriEnvironment()) {
    const { invoke } = await import('@tauri-apps/api/core');
    try {
      await invoke('cmd_agentlex_register_project', { projectId: p.projectId, record: p });
    } catch {
      await invoke('cmd_agentlex_update_project', { projectId: p.projectId, patch: p });
    }
    await reloadFromDisk();
  } else {
    setState({ ...state, projects: [...state.projects.filter(x => x.projectId !== p.projectId), p] });
  }
}

async function updateProject(projectId: string, updater: (p: ProjectEntry) => ProjectEntry): Promise<void> {
  const current = state.projects.find(p => p.projectId === projectId);
  if (!current) return;
  const updated = updater(current);
  await mutateDisk('cmd_agentlex_update_project', { projectId, patch: updated }, s => ({
    ...s, projects: s.projects.map(p => p.projectId === projectId ? updated : p),
  }));
}

async function deleteProject(projectId: string): Promise<void> {
  await mutateDisk('cmd_agentlex_delete_project', { projectId }, s => ({
    ...s, projects: s.projects.filter(p => p.projectId !== projectId),
  }));
}

async function bindProjectSession(projectId: string, sessionId: string, label?: string, agentKey?: string): Promise<void> {
  const lbl = label ?? '会话';
  const now = new Date().toISOString();
  const current = state.projects.find(p => p.projectId === projectId);
  if (!current) return;
  await mutateDisk('cmd_agentlex_update_project', { projectId, patch: {
    boundSessions: [...current.boundSessions.filter(b => b.sessionId !== sessionId),
      { sessionId, label: lbl, createdAt: now, agentKey }],
  }}, s => ({
    ...s,
    projects: s.projects.map(p => p.projectId === projectId ? {
      ...p,
      boundSessions: [...p.boundSessions.filter(b => b.sessionId !== sessionId),
        { sessionId, label: lbl, createdAt: now, agentKey }],
    } : p),
  }));
}

// ── Project task hierarchy (v1.1.0) — writes to project-registry.json ──
// Mirrors the case task hierarchy but uses `cmd_agentlex_*_project_*` commands
// that target project-registry.json.

const addProjectTaskGroup = (projectId: string, title: string, order?: number) =>
  taskMutate('cmd_agentlex_add_project_task_group', { projectId, title, order });
const updateProjectTaskGroup = (projectId: string, groupId: string, patch: Partial<TaskGroup>) =>
  taskMutate('cmd_agentlex_update_project_task_group', { projectId, groupId, patch });
const deleteProjectTaskGroup = (projectId: string, groupId: string) =>
  taskMutate('cmd_agentlex_delete_project_task_group', { projectId, groupId });
const reorderProjectTaskGroups = (projectId: string, orderedIds: string[]) =>
  taskMutate('cmd_agentlex_reorder_project_task_groups', { projectId, orderedIds });

const addProjectTask = (projectId: string, groupId: string, title: string, opts?: { detail?: string; deadline?: string; time?: string; priority?: TaskPriority; folder?: string }) =>
  taskMutate('cmd_agentlex_add_project_task', { projectId, groupId, title, detail: opts?.detail, deadline: opts?.deadline, time: opts?.time, priority: opts?.priority, folder: opts?.folder });
const updateProjectTask = (projectId: string, taskId: string, patch: Partial<Task>) =>
  taskMutate('cmd_agentlex_update_project_task', { projectId, taskId, patch });
const deleteProjectTask = (projectId: string, taskId: string) =>
  taskMutate('cmd_agentlex_delete_project_task', { projectId, taskId });
const moveProjectTask = (projectId: string, taskId: string, targetGroupId: string) =>
  taskMutate('cmd_agentlex_move_project_task', { projectId, taskId, targetGroupId });

const addProjectSubtask = (projectId: string, taskId: string, title: string, opts?: { deadline?: string; priority?: TaskPriority }) =>
  taskMutate('cmd_agentlex_add_project_subtask', { projectId, taskId, title, deadline: opts?.deadline, priority: opts?.priority });
const updateProjectSubtask = (projectId: string, taskId: string, subtaskId: string, patch: Partial<SubTask>) =>
  taskMutate('cmd_agentlex_update_project_subtask', { projectId, taskId, subtaskId, patch });
const deleteProjectSubtask = (projectId: string, taskId: string, subtaskId: string) =>
  taskMutate('cmd_agentlex_delete_project_subtask', { projectId, taskId, subtaskId });

const addProjectChecklistItem = (projectId: string, taskId: string, text: string) =>
  taskMutate('cmd_agentlex_add_project_checklist_item', { projectId, taskId, text });
const toggleProjectChecklistItem = (projectId: string, taskId: string, itemId: string, done?: boolean) =>
  taskMutate('cmd_agentlex_toggle_project_checklist_item', { projectId, taskId, itemId, done });
const deleteProjectChecklistItem = (projectId: string, taskId: string, itemId: string) =>
  taskMutate('cmd_agentlex_delete_project_checklist_item', { projectId, taskId, itemId });

export async function unbindProjectSession(sessionId: string): Promise<void> {
  // 1. Find affected projects BEFORE mutating state
  const affected: Array<{ projectId: string; boundSessions: ProjectEntry['boundSessions'] }> = [];
  for (const p of state.projects) {
    if (p.boundSessions.some(bs => bs.sessionId === sessionId)) {
      affected.push({ projectId: p.projectId, boundSessions: p.boundSessions.filter(bs => bs.sessionId !== sessionId) });
    }
  }
  if (affected.length === 0) return;
  
  // 2. Optimistic UI update — remove session from all projects immediately
  setState({
    ...state,
    projects: state.projects.map(p =>
      affected.some(a => a.projectId === p.projectId)
        ? { ...p, boundSessions: p.boundSessions.filter(bs => bs.sessionId !== sessionId), updatedAt: new Date().toISOString() }
        : p
    ),
  });
  
  // 3. Persist to disk (background — UI already updated)
  const target = getClientRemoteTarget();
  if (target.isRemote && target.origin) {
    for (const a of affected) {
      await tryRemoteAgentlex('cmd_agentlex_update_project', { projectId: a.projectId, patch: { boundSessions: a.boundSessions } });
    }
    return;
  }
  if (isTauriEnvironment()) {
    const { invoke } = await import('@tauri-apps/api/core');
    for (const a of affected) {
      await invoke('cmd_agentlex_update_project', { projectId: a.projectId, patch: { boundSessions: a.boundSessions } });
    }
    // Reload from disk to reconcile
    await reloadFromDisk();
  }
}

async function bindSession(caseId: string, sessionId: string, label?: string, agentKey?: string): Promise<void> {
  const lbl = label ?? '会话';
  await mutateDisk('cmd_agentlex_bind_session', { caseId, sessionId, label: lbl, agentKey }, s => ({
    ...s,
    cases: s.cases.map(c => c.caseId === caseId ? {
      ...c,
      boundSessions: [...c.boundSessions.filter(b => b.sessionId !== sessionId), { sessionId, label: lbl, createdAt: new Date().toISOString(), agentKey }],
    } : c),
  }));
}

/** Patch boundSessions on each affected case (multi-case write). */
async function rewriteBoundSessions(keep: (sessionId: string) => boolean): Promise<void> {
  const affected = state.cases.filter(c => c.boundSessions.some(s => !keep(s.sessionId)));
  if (affected.length === 0) return;
  // Plan A: in remote mode, patch each affected case on the host.
  const target = getClientRemoteTarget();
  if (target.isRemote && target.origin) {
    for (const c of affected) {
      const boundSessions = c.boundSessions.filter(s => keep(s.sessionId));
      await tryRemoteAgentlex('cmd_agentlex_update_case', { caseId: c.caseId, patch: { boundSessions } });
    }
    await reloadFromDisk();
    return;
  }
  if (isTauriEnvironment()) {
    // Optimistic UI update — immediately remove the session from all cases so
    // the detail-page session button reacts instantly, before the disk write.
    setState({ ...state, cases: state.cases.map(c => ({
      ...c, boundSessions: c.boundSessions.filter(s => keep(s.sessionId)),
    })) });
    const { invoke } = await import('@tauri-apps/api/core');
    for (const c of affected) {
      const boundSessions = c.boundSessions.filter(s => keep(s.sessionId));
      await invoke('cmd_agentlex_update_case', { caseId: c.caseId, patch: { boundSessions } });
    }
    await reloadFromDisk();
  } else {
    setState({ ...state, cases: state.cases.map(c => ({ ...c, boundSessions: c.boundSessions.filter(s => keep(s.sessionId)) })) });
  }
}

/** Remove a deleted session from ALL cases. */
async function unbindSession(sessionId: string): Promise<void> {
  await rewriteBoundSessions(sid => sid !== sessionId);
}

/** Drop bound sessions that no longer exist. Guards against a transient empty
 * fetch wiping every binding. */
async function pruneStaleSessions(validSessionIds: Set<string>): Promise<void> {
  if (validSessionIds.size === 0) return;
  await rewriteBoundSessions(sid => validSessionIds.has(sid));
  // Also prune project bound sessions
  const projectAffected = state.projects.filter(p =>
    p.boundSessions.some(bs => !validSessionIds.has(bs.sessionId))
  );
  if (projectAffected.length === 0) return;
  for (const p of projectAffected) {
    const boundSessions = p.boundSessions.filter(bs => validSessionIds.has(bs.sessionId));
    const target = getClientRemoteTarget();
    if (target.isRemote && target.origin) {
      await tryRemoteAgentlex('cmd_agentlex_update_project', { projectId: p.projectId, patch: { boundSessions } });
    } else if (isTauriEnvironment()) {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('cmd_agentlex_update_project', { projectId: p.projectId, patch: { boundSessions } });
    }
  }
  // Optimistic UI update
  setState({
    ...state,
    projects: state.projects.map(p =>
      projectAffected.some(a => a.projectId === p.projectId)
        ? { ...p, boundSessions: p.boundSessions.filter(bs => validSessionIds.has(bs.sessionId)) }
        : p
    ),
  });
  await reloadFromDisk();
}

// ── Schedule actions ──

async function addSchedule(s: ScheduleItem): Promise<void> {
  await mutateDisk('cmd_agentlex_add_schedule', {
    title: s.title, date: s.date, priority: s.priority,
    caseId: s.caseId ?? null, caseName: s.caseName ?? null,
    time: s.time ?? null, source: s.source,
    reminderLeadMinutes: s.reminderLeadMinutes ?? null,
    taskId: s.taskId ?? null, externalId: s.externalId ?? null, externalSystem: s.externalSystem ?? null,
  }, prev => ({ ...prev, schedules: [s, ...prev.schedules] }));
}

async function updateSchedule(id: string, updater: (s: ScheduleItem) => ScheduleItem): Promise<void> {
  const current = state.schedules.find(s => s.id === id);
  if (!current) return;
  const updated = updater(current);
  await mutateDisk('cmd_agentlex_update_schedule', { id, patch: updated }, prev => ({
    ...prev, schedules: prev.schedules.map(s => s.id === id ? updated : s),
  }));
}

async function deleteSchedule(id: string): Promise<void> {
  await mutateDisk('cmd_agentlex_delete_schedule', { id }, prev => ({
    ...prev, schedules: prev.schedules.filter(s => s.id !== id),
  }));
}

async function toggleScheduleComplete(id: string): Promise<void> {
  await mutateDisk('cmd_agentlex_toggle_schedule', { id }, prev => ({
    ...prev, schedules: prev.schedules.map(s => s.id === id ? { ...s, completed: !s.completed } : s),
  }));
}

// ── Timeline event actions (v1.1.0) ──

async function addTimelineEvent(evt: TimelineEvent): Promise<void> {
  // 统一事项：登记为 event 事项（进关键日程/时间轴）。
  await addItem({
    ownerId: evt.caseId,
    ownerType: 'litigation',
    ownerName: evt.caseName,
    type: 'event',
    title: evt.label || evt.title,
    date: evt.date,
    time: evt.time,
    detail: evt.detail,
    remindRules: evt.remindRules,
  });
}

/** Project-scoped timeline event. Routes to the project command so the event is
 *  stored with both `caseId` (= projectId) and `projectId`, matching the backend
 *  `add_project_timeline_event` (which also resolves the project name). */
async function addProjectTimelineEvent(evt: TimelineEvent): Promise<void> {
  await mutateDisk('cmd_agentlex_add_project_timeline_event', {
    projectId: evt.caseId, eventType: evt.type,
    title: evt.label, date: evt.date, time: evt.time ?? null,
    source: evt.source, remindRules: evt.remindRules,
    createdBy: evt.createdBy, status: evt.status,
  }, prev => ({ ...prev, timelineEvents: [...prev.timelineEvents, evt] }));
}

async function updateTimelineEvent(id: string, updater: (e: TimelineEvent) => TimelineEvent): Promise<void> {
  const current = state.timelineEvents.find(e => e.id === id);
  if (!current) return;
  const updated = updater(current);
  await updateItem(id, {
    title: updated.label || updated.title,
    date: updated.date,
    time: updated.time,
    detail: updated.detail,
    remindRules: updated.remindRules,
  });
}

async function deleteTimelineEvent(id: string): Promise<void> {
  await deleteItem(id);
}

async function toggleTimelineEvent(id: string): Promise<void> {
  await toggleItem(id);
}

// ── Standalone task actions (v1.1.0) ──

async function addStandaloneTask(task: AgentLexStandaloneTask): Promise<void> {
  // 统一事项：独立任务 = ownerId 为空的任务。
  await addItem({
    ownerId: task.caseId || '',
    ownerType: task.caseId ? 'litigation' : 'standalone',
    ownerName: task.caseName || undefined,
    type: 'task',
    title: task.title,
    date: task.deadline,
    time: task.time,
    priority: task.priority,
    detail: task.stage || undefined,
  });
}

async function updateStandaloneTask(id: string, updater: (t: AgentLexStandaloneTask) => AgentLexStandaloneTask): Promise<void> {
  const current = state.standaloneTasks.find(t => t.id === id);
  if (!current) return;
  const updated = updater(current);
  await updateItem(id, {
    title: updated.title,
    date: updated.deadline,
    time: updated.time,
    priority: updated.priority,
    detail: updated.stage || undefined,
  });
}

async function deleteStandaloneTask(id: string): Promise<void> {
  await mutateDisk('cmd_agentlex_delete_standalone_task', { taskId: id }, prev => ({
    ...prev, standaloneTasks: prev.standaloneTasks.filter(t => t.id !== id),
  }));
}

// ── 统一事项（v0.1.27 统一事项模型）──
// 写统一事项 items.json。登记一个事项（type: event/task/both），
// 自动分流到 timeline + taskGroups（由 /api/agentlex/read 聚合生成）。

async function itemCall<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const resp = await fetch(`/api/agentlex-item/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const env = await resp.json().catch(() => null) as { success: boolean; data?: T; error?: string } | null;
  if (!resp.ok || env === null || env.success === false) {
    throw new Error(env?.error ?? `item request failed (${resp.status})`);
  }
  return env.data as T;
}

async function addItem(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const created = await itemCall<Record<string, unknown>>('item', input);
  await reloadFromDisk();
  return created;
}

async function updateItem(id: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
  const updated = await itemCall<Record<string, unknown>>('item', { id, ...patch });
  await reloadFromDisk();
  return updated;
}

async function deleteItem(id: string): Promise<{ deleted: boolean }> {
  const result = await itemCall<{ deleted: boolean }>('delete-item', { id });
  await reloadFromDisk();
  return result;
}

async function toggleItem(id: string): Promise<Record<string, unknown>> {
  const result = await itemCall<Record<string, unknown>>('toggle-item', { id });
  await reloadFromDisk();
  return result;
}

// ── Contract + research actions (Phase 4: disk-first via Rust commands) ──

async function addContract(contract: ContractEntry): Promise<void> {
  await contractMutate('cmd_agentlex_add_contract', {
    contractId: contract.id,
    record: contract as unknown as Record<string, unknown>,
  });
}

async function addResearch(research: ResearchEntry): Promise<void> {
  await researchMutate('cmd_agentlex_add_research', {
    researchId: research.id,
    record: research as unknown as Record<string, unknown>,
  });
}

/** Link research → case. Updates both the research registry and case registry. */
async function linkResearchToCase(researchId: string, caseId: string): Promise<void> {
  await researchMutate('cmd_agentlex_update_research', {
    researchId,
    patch: { linkedCaseId: caseId },
  });
  await updateCase(caseId, c => c.linkedResearch.includes(researchId) ? c : { ...c, linkedResearch: [...c.linkedResearch, researchId] });
}

/** Link contract → case. Updates both the contract registry and case registry. */
async function linkContractToCase(contractId: string, caseId: string): Promise<void> {
  await contractMutate('cmd_agentlex_update_contract', {
    contractId,
    patch: { linkedCaseId: caseId },
  });
  await updateCase(caseId, c => c.linkedContracts.includes(contractId) ? c : { ...c, linkedContracts: [...c.linkedContracts, contractId] });
}

/** Phase 4: Invoke a contract Rust command, then reload from disk. */
async function contractMutate(command: string, args: Record<string, unknown>): Promise<void> {
  // Web / remote: dispatch through the host gateway (same locked core as the
  // desktop cmd_* commands), then reload so the store reflects the write.
  const remote = await tryRemoteAgentlex(command, args);
  if (remote) {
    await reloadFromDisk();
    return;
  }
  if (!isTauriEnvironment()) {
    console.warn(`[agentlex] ${command} skipped — contract writes require the desktop app`);
    return;
  }
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke(command, args);
  await reloadFromDisk();
}

/** Phase 4: Invoke a research Rust command, then reload from disk. */
async function researchMutate(command: string, args: Record<string, unknown>): Promise<void> {
  // Web / remote: dispatch through the host gateway (same locked core as the
  // desktop cmd_* commands), then reload so the store reflects the write.
  const remote = await tryRemoteAgentlex(command, args);
  if (remote) {
    await reloadFromDisk();
    return;
  }
  if (!isTauriEnvironment()) {
    console.warn(`[agentlex] ${command} skipped — research writes require the desktop app`);
    return;
  }
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke(command, args);
  await reloadFromDisk();
}

/** Phase 4: Normalize a raw contract object from disk into a ContractEntry. */
function normalizeContractFromDisk(raw: Record<string, unknown>): ContractEntry {
  return {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? ''),
    filePath: String(raw.filePath ?? ''),
    reviewSessions: Array.isArray(raw.reviewSessions) ? raw.reviewSessions as ContractEntry['reviewSessions'] : [],
    linkedCaseId: raw.linkedCaseId ? String(raw.linkedCaseId) : null,
    parties: { ourSide: String((raw.parties as Record<string, unknown>)?.ourSide ?? ''), counterparty: String((raw.parties as Record<string, unknown>)?.counterparty ?? '') },
    status: (raw.status as ContractEntry['status']) ?? 'pending',
    createdAt: String(raw.createdAt ?? ''),
    updatedAt: String(raw.updatedAt ?? ''),
  };
}

/** Phase 4: Normalize a raw research object from disk into a ResearchEntry. */
function normalizeResearchFromDisk(raw: Record<string, unknown>): ResearchEntry {
  return {
    id: String(raw.id ?? ''),
    topic: String(raw.topic ?? ''),
    agentType: String(raw.agentType ?? ''),
    query: String(raw.query ?? ''),
    resultFilePath: String(raw.resultFilePath ?? ''),
    resultUrl: String(raw.resultUrl ?? ''),
    linkedCaseId: raw.linkedCaseId ? String(raw.linkedCaseId) : null,
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    createdAt: String(raw.createdAt ?? ''),
  };
}

// ── Task-hierarchy actions (Phase 1) ──
// Deeply nested (group→task→subtask/checklist), so there's no clean local
// reducer for browser dev. These are Tauri-only writes: invoke the locked Rust
// command, then reload from disk. In browser dev (no Tauri) they no-op with a
// warning — the case detail page that drives them is a desktop surface.
async function taskMutate(command: string, args: Record<string, unknown>): Promise<void> {
  // Plan A: in remote mode the case registry (incl. its task hierarchy) lives on
  // the HOST. Dispatch the write through the gateway — the host's
  // /api/agentlex/<verb> routes call the SAME locked core as the desktop cmd_*,
  // and all 12 task verbs exist there. Without this, every case-task op
  // (add/update/delete/reorder group·task·subtask·checklist) hit the CLIENT's
  // local Rust core, which has no copy of the host-owned case → "任务远端没法处理".
  // Mirrors mutateDisk's remote-first pattern.
  const remote = await tryRemoteAgentlex(command, args);
  if (remote) {
    await reloadFromDisk();
    return;
  }
  if (!isTauriEnvironment()) {
    console.warn(`[agentlex] ${command} skipped — task hierarchy writes require the desktop app`);
    return;
  }
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke(command, args);
  await reloadFromDisk();
}

const addTaskGroup = (caseId: string, title: string, order?: number) =>
  itemCall('group', { ownerId: caseId, name: title, order }).then(() => reloadFromDisk());
const updateTaskGroup = (caseId: string, groupId: string, patch: Partial<TaskGroup>) =>
  itemCall('group', { id: groupId, ownerId: caseId, name: patch.title ?? patch.name }).then(() => reloadFromDisk());
const deleteTaskGroup = (caseId: string, groupId: string) =>
  itemCall('delete-group', { id: groupId }).then(() => reloadFromDisk());
const reorderTaskGroups = (caseId: string, orderedIds: string[]) =>
  Promise.all(orderedIds.map((id, index) => itemCall('group', { id, ownerId: caseId, order: index }))).then(() => reloadFromDisk());

const addTask = (caseId: string, groupId: string, title: string, opts?: { detail?: string; deadline?: string; time?: string; priority?: TaskPriority; folder?: string }) =>
  addItem({ ownerId: caseId, ownerType: 'litigation', type: 'task', title, detail: opts?.detail, date: opts?.deadline, time: opts?.time, priority: opts?.priority, groupId: groupId || undefined });
const updateTask = (caseId: string, taskId: string, patch: Partial<Task>) =>
  updateItem(taskId, {
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.deadline !== undefined ? { date: patch.deadline } : {}),
    ...(patch.time !== undefined ? { time: patch.time } : {}),
    ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
    ...(patch.status !== undefined ? { status: patch.status === 'done' ? 'done' : patch.status === 'in_progress' ? 'doing' : 'pending' } : {}),
    ...(patch.detail !== undefined ? { detail: patch.detail } : {}),
  });
const deleteTask = (caseId: string, taskId: string) =>
  deleteItem(taskId);
const moveTask = (caseId: string, taskId: string, targetGroupId: string) =>
  updateItem(taskId, { groupId: targetGroupId });

const addSubtask = (caseId: string, taskId: string, title: string, opts?: { deadline?: string; priority?: TaskPriority }) =>
  taskMutate('cmd_agentlex_add_subtask', { caseId, taskId, title, deadline: opts?.deadline, priority: opts?.priority });
const updateSubtask = (caseId: string, taskId: string, subtaskId: string, patch: Partial<SubTask>) =>
  taskMutate('cmd_agentlex_update_subtask', { caseId, taskId, subtaskId, patch });
const deleteSubtask = (caseId: string, taskId: string, subtaskId: string) =>
  taskMutate('cmd_agentlex_delete_subtask', { caseId, taskId, subtaskId });

const addChecklistItem = (caseId: string, taskId: string, text: string) =>
  taskMutate('cmd_agentlex_add_checklist_item', { caseId, taskId, text });
const toggleChecklistItem = (caseId: string, taskId: string, itemId: string, done?: boolean) =>
  taskMutate('cmd_agentlex_toggle_checklist_item', { caseId, taskId, itemId, done });
const deleteChecklistItem = (caseId: string, taskId: string, itemId: string) =>
  taskMutate('cmd_agentlex_delete_checklist_item', { caseId, taskId, itemId });

// ============================================================
// Hook — subscribes the calling component to the shared store.
// All actions are module-level (stable identity), so no useCallback needed.
// ============================================================

export function useAgentLex(): AgentLexState & {
  refresh: () => void;
  readCase: (caseId: string) => Promise<{ case: CaseEntry; timeline: TimelineEvent[] } | null>;
  addCase: (c: CaseEntry) => Promise<void>;
  updateCase: (caseId: string, updater: (c: CaseEntry) => CaseEntry) => Promise<void>;
  deleteCase: (caseId: string) => Promise<void>;
  bindSession: (caseId: string, sessionId: string, label?: string, agentKey?: string) => Promise<void>;
  unbindSession: (sessionId: string) => Promise<void>;
  unbindProjectSession: (sessionId: string) => Promise<void>;
  pruneStaleSessions: (validSessionIds: Set<string>) => Promise<void>;
  // Project actions (v1.1.0 project-based non-litigation)
  addProject: (p: ProjectEntry) => Promise<void>;
  updateProject: (projectId: string, updater: (p: ProjectEntry) => ProjectEntry) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
  bindProjectSession: (projectId: string, sessionId: string, label?: string, agentKey?: string) => Promise<void>;
  // Project task hierarchy (v1.1.0)
  addProjectTaskGroup: (projectId: string, title: string, order?: number) => Promise<void>;
  updateProjectTaskGroup: (projectId: string, groupId: string, patch: Partial<TaskGroup>) => Promise<void>;
  deleteProjectTaskGroup: (projectId: string, groupId: string) => Promise<void>;
  reorderProjectTaskGroups: (projectId: string, orderedIds: string[]) => Promise<void>;
  addProjectTask: (projectId: string, groupId: string, title: string, opts?: { detail?: string; deadline?: string; priority?: TaskPriority; folder?: string }) => Promise<void>;
  updateProjectTask: (projectId: string, taskId: string, patch: Partial<Task>) => Promise<void>;
  deleteProjectTask: (projectId: string, taskId: string) => Promise<void>;
  moveProjectTask: (projectId: string, taskId: string, targetGroupId: string) => Promise<void>;
  addProjectSubtask: (projectId: string, taskId: string, title: string, opts?: { deadline?: string; priority?: TaskPriority }) => Promise<void>;
  updateProjectSubtask: (projectId: string, taskId: string, subtaskId: string, patch: Partial<SubTask>) => Promise<void>;
  deleteProjectSubtask: (projectId: string, taskId: string, subtaskId: string) => Promise<void>;
  addProjectChecklistItem: (projectId: string, taskId: string, text: string) => Promise<void>;
  toggleProjectChecklistItem: (projectId: string, taskId: string, itemId: string, done?: boolean) => Promise<void>;
  deleteProjectChecklistItem: (projectId: string, taskId: string, itemId: string) => Promise<void>;
  addContract: (c: ContractEntry) => Promise<void>;
  addResearch: (r: ResearchEntry) => Promise<void>;
  linkResearchToCase: (researchId: string, caseId: string) => Promise<void>;
  linkContractToCase: (contractId: string, caseId: string) => Promise<void>;
  addSchedule: (s: ScheduleItem) => Promise<void>;
  updateSchedule: (id: string, updater: (s: ScheduleItem) => ScheduleItem) => Promise<void>;
  deleteSchedule: (id: string) => Promise<void>;
  toggleScheduleComplete: (id: string) => Promise<void>;
  // Timeline events (v1.1.0)
  addTimelineEvent: (evt: TimelineEvent) => Promise<void>;
  addProjectTimelineEvent: (evt: TimelineEvent) => Promise<void>;
  updateTimelineEvent: (id: string, updater: (e: TimelineEvent) => TimelineEvent) => Promise<void>;
  deleteTimelineEvent: (id: string) => Promise<void>;
  toggleTimelineEvent: (id: string) => Promise<void>;
  // Standalone tasks (v1.1.0)
  addStandaloneTask: (task: AgentLexStandaloneTask) => Promise<void>;
  updateStandaloneTask: (id: string, updater: (t: AgentLexStandaloneTask) => AgentLexStandaloneTask) => Promise<void>;
  deleteStandaloneTask: (id: string) => Promise<void>;
  // Task hierarchy (Phase 1) — Tauri-only writes through the locked Rust core.
  addTaskGroup: (caseId: string, title: string, order?: number) => Promise<void>;
  updateTaskGroup: (caseId: string, groupId: string, patch: Partial<TaskGroup>) => Promise<void>;
  deleteTaskGroup: (caseId: string, groupId: string) => Promise<void>;
  reorderTaskGroups: (caseId: string, orderedIds: string[]) => Promise<void>;
  addTask: (caseId: string, groupId: string, title: string, opts?: { detail?: string; deadline?: string; priority?: TaskPriority; folder?: string }) => Promise<void>;
  updateTask: (caseId: string, taskId: string, patch: Partial<Task>) => Promise<void>;
  deleteTask: (caseId: string, taskId: string) => Promise<void>;
  moveTask: (caseId: string, taskId: string, targetGroupId: string) => Promise<void>;
  addSubtask: (caseId: string, taskId: string, title: string, opts?: { deadline?: string; priority?: TaskPriority }) => Promise<void>;
  updateSubtask: (caseId: string, taskId: string, subtaskId: string, patch: Partial<SubTask>) => Promise<void>;
  deleteSubtask: (caseId: string, taskId: string, subtaskId: string) => Promise<void>;
  addChecklistItem: (caseId: string, taskId: string, text: string) => Promise<void>;
  toggleChecklistItem: (caseId: string, taskId: string, itemId: string, done?: boolean) => Promise<void>;
  deleteChecklistItem: (caseId: string, taskId: string, itemId: string) => Promise<void>;
  // 统一事项（v0.1.27 统一事项模型）
  addItem: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
  updateItem: (id: string, patch: Record<string, unknown>) => Promise<Record<string, unknown>>;
  deleteItem: (id: string) => Promise<{ deleted: boolean }>;
  toggleItem: (id: string) => Promise<Record<string, unknown>>;
} {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);
  const refresh = useCallback(() => { void reloadFromDisk(); }, []);

  return {
    ...snapshot,
    refresh,
    readCase, addCase, updateCase, deleteCase, bindSession, unbindSession, unbindProjectSession, pruneStaleSessions,
    addProject, updateProject, deleteProject, bindProjectSession,
    addProjectTaskGroup, updateProjectTaskGroup, deleteProjectTaskGroup, reorderProjectTaskGroups,
    addProjectTask, updateProjectTask, deleteProjectTask, moveProjectTask,
    addProjectSubtask, updateProjectSubtask, deleteProjectSubtask,
    addProjectChecklistItem, toggleProjectChecklistItem, deleteProjectChecklistItem,
    addContract, addResearch, linkResearchToCase, linkContractToCase,
    addSchedule, updateSchedule, deleteSchedule, toggleScheduleComplete,
    addTimelineEvent, addProjectTimelineEvent, updateTimelineEvent, deleteTimelineEvent, toggleTimelineEvent,
    addStandaloneTask, updateStandaloneTask, deleteStandaloneTask,
    addTaskGroup, updateTaskGroup, deleteTaskGroup, reorderTaskGroups,
    addTask, updateTask, deleteTask, moveTask,
    addSubtask, updateSubtask, deleteSubtask,
    addChecklistItem, toggleChecklistItem, deleteChecklistItem,
    addItem, updateItem, deleteItem, toggleItem,
  };
}