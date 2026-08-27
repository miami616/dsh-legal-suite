/**
 * taskAggregation — the pure core of the unified 任务管理 module.
 *
 * Tasks live in TWO physical stores (by design, Option 3):
 *   - case-bound tasks  ← cases[].taskGroups[].tasks[]  (case-registry.json,
 *                          the canonical store the UI + Rust + agent all write)
 *   - case-less tasks    ← standaloneTasks with caseId === ''  (case-tasks.json)
 *
 * This module flattens both into ONE UnifiedTask shape so the task manager can
 * present, filter and bucket every task in a single view. Reading case-bound
 * tasks ONLY from taskGroups (never from the stale standalone duplicates) is
 * what keeps the aggregation de-duplicated without touching the orphan data.
 *
 * "逾期" is a TASK concept (a deadline that passed while the task isn't done) —
 * distinct from events, which never go overdue. Pure + unit-testable.
 */

import type {
  CaseEntry, AgentLexStandaloneTask, TaskStatus, TaskPriority, SubTask, ChecklistItem,
  ProjectEntry,
} from '@/hooks/useAgentLex';

/** Where a unified task physically lives — decides which mutation path to use. */
export type TaskOrigin = 'case-task' | 'project-task' | 'standalone';

export interface UnifiedTask {
  /** Stable unique key (encodes origin so React keys never collide). */
  key: string;
  /** Underlying task id (taskId for case-task, standalone id for standalone). */
  id: string;
  title: string;
  detail?: string;
  caseId: string | null;
  caseName?: string;
  /** 展示用编号：案件任务 = 案号(caseNumber)，项目任务 = projectId；空 = 独立任务。 */
  caseNo?: string;
  /** Stage / group label ("庭前准备" …). For case-task = group title. */
  stage: string;
  /** For case-task: the owning group id (needed for some mutations). */
  groupId?: string;
  status: TaskStatus;
  priority: TaskPriority;
  deadline?: string;       // YYYY-MM-DD
  owner?: string;
  subtasks: SubTask[];
  checklist: ChecklistItem[];
  origin: TaskOrigin;
  createdAt: string;
  updatedAt: string;
}

export type TaskBucket = 'overdue' | 'today' | 'thisWeek' | 'later' | 'noDeadline' | 'done';

/**
 * 本地时区的今日日期 (YYYY-MM-DD)。任务的 deadline 是本地「日历日」——
 * 用 `new Date().toISOString().slice(0, 10)` 会取 UTC 日期，在东八区等正偏移下
 * 每天 0:00–8:00 会让「今天」错成「昨天」，把当日任务误判为逾期（回归测试覆盖）。
 */
export function localTodayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 本地时区下 date 距离 today 的整天数（负 = 已过）。 */
export function daysUntil(date: string, today = localTodayStr()): number {
  const a = new Date(date + 'T00:00:00');
  const b = new Date(today + 'T00:00:00');
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

function addDaysStr(isoDate: string, n: number): string {
  const d = new Date(isoDate + 'T00:00:00');
  d.setDate(d.getDate() + n);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** A task is overdue when it has a deadline in the past and isn't done. */
export function isTaskOverdue(t: UnifiedTask, today = localTodayStr()): boolean {
  return t.status !== 'done' && !!t.deadline && t.deadline < today;
}

/**
 * 台账时间桶（v1.2.0）：
 *   overdue → today → tomorrow → future(明天之后全部，不再丢 >7 天的任务) → none → done
 */
export type TaskTimeBucket = 'overdue' | 'today' | 'tomorrow' | 'future' | 'none' | 'done';
export function taskTimeBucket(t: UnifiedTask, today = localTodayStr()): TaskTimeBucket {
  if (t.status === 'done') return 'done';
  if (!t.deadline) return 'none';
  if (t.deadline < today) return 'overdue';
  if (t.deadline === today) return 'today';
  if (t.deadline === addDaysStr(today, 1)) return 'tomorrow';
  return 'future';
}

/** Classify a task into a time bucket for the dashboard. */
export function taskBucket(t: UnifiedTask, today = localTodayStr()): TaskBucket {
  if (t.status === 'done') return 'done';
  if (!t.deadline) return 'noDeadline';
  if (t.deadline < today) return 'overdue';
  const days = daysUntil(t.deadline, today);
  if (days === 0) return 'today';
  if (days <= 7) return 'thisWeek';
  return 'later';
}

/** Flatten all case-bound tasks (taskGroups) with their case + stage context. */
function caseTaskItems(cases: CaseEntry[]): UnifiedTask[] {
  const out: UnifiedTask[] = [];
  for (const c of cases) {
    const groups = Array.isArray(c.taskGroups) ? c.taskGroups : [];
    for (const g of groups) {
      for (const t of (g.tasks ?? [])) {
        out.push({
          key: `case:${c.caseId}:${t.id}`,
          id: t.id,
          title: t.title,
          detail: t.detail,
          caseId: c.caseId,
          caseName: c.name,
          caseNo: c.caseNumber || c.caseId,
          stage: g.title,
          groupId: g.id,
          status: t.status,
          priority: t.priority,
          deadline: t.deadline,
          subtasks: t.subtasks ?? [],
          checklist: t.checklist ?? [],
          origin: 'case-task',
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        });
      }
    }
  }
  return out;
}

/** Flatten all project-bound tasks (taskGroups) with their project context. */
function projectTaskItems(projects: ProjectEntry[]): UnifiedTask[] {
  const out: UnifiedTask[] = [];
  for (const p of projects) {
    const groups = Array.isArray(p.taskGroups) ? p.taskGroups : [];
    for (const g of groups) {
      for (const t of (g.tasks ?? [])) {
        out.push({
          key: `project:${p.projectId}:${t.id}`,
          id: t.id,
          title: t.title,
          detail: t.detail,
          caseId: p.projectId,
          caseName: p.name,
          caseNo: p.projectId,
          stage: g.title,
          groupId: g.id,
          status: t.status,
          priority: t.priority,
          deadline: t.deadline,
          subtasks: t.subtasks ?? [],
          checklist: t.checklist ?? [],
          origin: 'project-task',
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        });
      }
    }
  }
  return out;
}

/** Project ONLY case-less standalone tasks (caseId === ''); case-bound
 *  standalone entries are stale duplicates of taskGroups and are ignored. */
function caselessTaskItems(tasks: AgentLexStandaloneTask[]): UnifiedTask[] {
  return tasks
    .filter(t => !t.caseId)
    .map(t => ({
      key: `std:${t.id}`,
      id: t.id,
      title: t.title,
      caseId: null,
      caseName: undefined,
      stage: t.stage || t.groupTitle || '',
      status: t.status,
      priority: t.priority,
      deadline: t.deadline,
      owner: t.owner || undefined,
      subtasks: t.subtasks ?? [],
      checklist: t.checklist ?? [],
      origin: 'standalone' as const,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));
}

/**
 * Merge case-bound + case-less tasks into one list. Sorted: undated last,
 * otherwise by deadline ascending, then high priority first, then title.
 */
export function deriveAllTasks(
  cases: CaseEntry[],
  standaloneTasks: AgentLexStandaloneTask[],
  projects?: ProjectEntry[],
): UnifiedTask[] {
  const items = [
    ...caseTaskItems(cases),
    ...projectTaskItems(projects ?? []),
    ...caselessTaskItems(standaloneTasks),
  ];
  const prioRank: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 };
  items.sort((a, b) => {
    if (!!a.deadline !== !!b.deadline) return a.deadline ? -1 : 1;
    if (a.deadline && b.deadline && a.deadline !== b.deadline) return a.deadline.localeCompare(b.deadline);
    if (a.priority !== b.priority) return prioRank[a.priority] - prioRank[b.priority];
    return a.title.localeCompare(b.title);
  });
  return items;
}

export interface TaskBuckets {
  overdue: UnifiedTask[];
  today: UnifiedTask[];
  thisWeek: UnifiedTask[];
  later: UnifiedTask[];
  noDeadline: UnifiedTask[];
  done: UnifiedTask[];
}

/** Group tasks into dashboard buckets in one pass. */
export function bucketTasks(tasks: UnifiedTask[], today = localTodayStr()): TaskBuckets {
  const b: TaskBuckets = { overdue: [], today: [], thisWeek: [], later: [], noDeadline: [], done: [] };
  for (const t of tasks) b[taskBucket(t, today)].push(t);
  return b;
}
