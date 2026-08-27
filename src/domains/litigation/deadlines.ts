/**
 * Deadline engine — computes per-case upcoming deadlines and reminders.
 *
 * Sources merged into the calendar:
 *   - timeline events with a date (any status except done/cancelled is "open";
 *     done events are history and excluded from upcoming)
 *   - task deadlines (taskGroups[].tasks[].deadline) not yet done
 *   - key dates not yet done
 *
 * Output: a flat list of { caseId, caseName, date, label, kind, daysLeft,
 * urgent, source } sorted by date. `urgent` = within the remind horizon.
 */

import type { CaseRegistry, CaseRecord, TimelineEvent } from './store/types.ts'

/** Reminder horizon in days for the "urgent" flag (AgentLex 7d/1d convention). */
export const URGENT_HORIZON_DAYS = 7
/** Hard-overdue horizon: treat as overdue when < today. */
const TODAY = (): string => new Date().toISOString().slice(0, 10)

export interface DeadlineItem {
  caseId: string
  caseName: string
  date: string
  label: string
  kind: 'hearing' | 'deadline' | 'keydate' | 'task'
  daysLeft: number
  urgent: boolean
  overdue: boolean
  source: string
}

/** Human label for a timeline event type. */
export function eventTypeLabel(type: string): string {
  const map: Record<string, string> = {
    filing: '立案', arbitration: '仲裁', service: '送达', filing_deadline: '立案期限',
    case_event: '案件节点', court_notice: '法院通知', hearing: '开庭',
    defense_deadline: '答辩期', evidence_deadline: '举证期限', mediation: '调解',
    other: '其他', appeal_deadline: '上诉期', judgment: '判决', ruling: '裁定',
    appeal: '上诉', verdict: '宣判', execution: '执行', deadline: '期限',
  }
  return map[type] ?? type
}

/**
 * Category a timeline event maps to in the deadline summary (BUG-3).
 *
 * Legal-deadline milestones are surfaced as `deadline` (so the summary no
 * longer labels 举证期/答辩期/上诉期 as `hearing`); everything else is a
 * court/procedural event and buckets under `hearing`. Key dates and task
 * deadlines keep their own distinct kinds upstream.
 */
export function eventKind(type: string): Extract<DeadlineItem['kind'], 'deadline' | 'hearing'> {
  switch (type) {
    case 'evidence_deadline':
    case 'defense_deadline':
    case 'appeal_deadline':
    case 'filing_deadline':
    case 'deadline':
      return 'deadline'
    default:
      return 'hearing'
  }
}

/**
 * Compute the deadline list for all cases (or one case).
 *
 * Dedupe (Issue 5): the same matter may be registered in multiple systems
 * (timeline event, task deadline, key date — or a task whose reminder is a
 * derived key date). Rows are merged by case + date + normalized label, and
 * the most informative kind wins, so one matter shows once:
 *   - a task with a linked key-date reminder is represented by that key date
 *     (no separate plain `task` row for the same date/label);
 *   - a same-label/same-date key date vs timeline event vs task merge into
 *     one row (kind priority: keydate > deadline-event > hearing-event > task).
 *
 * @param registry - the case registry.
 * @param events - all timeline events.
 * @returns sorted upcoming deadlines.
 */
export function computeDeadlines(
  registry: CaseRegistry,
  events: TimelineEvent[],
  caseId?: string,
  opts: { includeOverdue?: boolean; maxItems?: number } = {},
): DeadlineItem[] {
  const today = TODAY()
  const items: DeadlineItem[] = []
  // Dedupe key -> row. `task` rows are only kept when nothing more specific
  // (event / key date) already represents the same case+date+label.
  const byKey = new Map<string, DeadlineItem>()
  const KIND_PRIORITY: Record<DeadlineItem['kind'], number> = {
    keydate: 4,
    deadline: 3,
    hearing: 2,
    task: 1,
  }

  const push = (date: string, label: string, kind: DeadlineItem['kind'], source: string, rec: CaseRecord): void => {
    if (!date) return
    const normLabel = String(label ?? '').trim()
    if (normLabel === '') return
    const daysLeft = Math.round((new Date(`${date}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86_400_000)
    const item: DeadlineItem = {
      caseId: rec.caseId,
      caseName: rec.name,
      date,
      label: normLabel,
      kind,
      daysLeft,
      urgent: daysLeft >= 0 && daysLeft <= URGENT_HORIZON_DAYS,
      overdue: daysLeft < 0,
      source,
    }
    const key = `${rec.caseId}|${date}|${normLabel}`
    const existing = byKey.get(key)
    if (existing === undefined || KIND_PRIORITY[kind] > KIND_PRIORITY[existing.kind]) {
      byKey.set(key, item)
    }
  }

  // Skips the plain task row when the task carries its own derived key-date
  // reminder for the same date/label (the key date row is the reminder).
  const taskHasLinkedKeyDate = (task: { remindKeyDate?: boolean; keyDateId?: string; deadline?: string }, rec: CaseRecord): boolean => {
    if (task.remindKeyDate !== true || task.keyDateId === undefined || task.deadline === undefined) return false
    return (rec.keyDates ?? []).some((kd) => kd.id === task.keyDateId && !kd.done && kd.date === task.deadline)
  }

  for (const rec of Object.values(registry.cases)) {
    if (caseId !== undefined && rec.caseId !== caseId) continue

    // timeline events with a future/ongoing date (open status)
    for (const e of events) {
      if (e.caseId !== rec.caseId) continue
      if (e.status === 'done' || e.status === 'cancelled') continue
      if (!e.date) continue
      push(e.date, e.title || eventTypeLabel(e.type), eventKind(e.type), e.type, rec)
    }

    // task deadlines not done
    for (const group of rec.taskGroups ?? []) {
      for (const task of group.tasks) {
        if (task.status === 'done' || !task.deadline) continue
        if (taskHasLinkedKeyDate(task, rec)) continue
        push(task.deadline, task.title, 'task', 'task', rec)
      }
    }

    // key dates not done
    for (const kd of rec.keyDates ?? []) {
      if (kd.done || !kd.date) continue
      push(kd.date, kd.label, 'keydate', 'keydate', rec)
    }
  }

  const merged = [...byKey.values()]
  merged.sort((a, b) => a.date.localeCompare(b.date) || a.caseId.localeCompare(b.caseId))
  // By default hide historical overdue entries (already-passed events/tasks)
  // so the summary focuses on what still matters; pass includeOverdue: true
  // to get the full audit list. maxItems bounds the payload either way.
  if (opts.includeOverdue !== true) {
    return merged.filter((i) => i.daysLeft >= 0).slice(0, opts.maxItems ?? 200)
  }
  return merged.slice(0, opts.maxItems ?? 500)
}
