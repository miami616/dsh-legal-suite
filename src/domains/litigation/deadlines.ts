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
  /** 案号（可能为「尚未立案」等占位）。 */
  caseNumber?: string
  /** 法院。 */
  court?: string
  /** 具体时间（如 09:30，来自 timeline 事件 time 字段）。 */
  time?: string
  /** 附加详情（如法庭/审判庭、时间地点等，来自 timeline 事件 detail）。 */
  detail?: string
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

  const push = (date: string, label: string, kind: DeadlineItem['kind'], source: string, rec: CaseRecord, extra?: { time?: string; detail?: string }): void => {
    if (!date) return
    const normLabel = String(label ?? '').trim()
    if (normLabel === '') return
    const daysLeft = Math.round((new Date(`${date}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86_400_000)
    const item: DeadlineItem = {
      caseId: rec.caseId,
      caseName: rec.name,
      caseNumber: rec.caseNumber,
      court: rec.court,
      time: extra?.time !== undefined && extra.time.trim() !== '' ? extra.time.trim() : undefined,
      detail: extra?.detail !== undefined && extra.detail.trim() !== '' ? extra.detail.trim() : undefined,
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
      // 合并缺失字段：高优先级项（如 keyDate）若缺 time/detail，从低优先级项
      // （如 timeline 事件，通常带时间/法庭）继承，避免开庭信息丢失。
      const merged: DeadlineItem = { ...item }
      if (existing !== undefined) {
        if (merged.time === undefined) merged.time = existing.time
        if (merged.detail === undefined) merged.detail = existing.detail
        if (merged.caseNumber === undefined) merged.caseNumber = existing.caseNumber
        if (merged.court === undefined) merged.court = existing.court
      }
      byKey.set(key, merged)
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
      push(e.date, e.title || eventTypeLabel(e.type), eventKind(e.type), e.type, rec, { time: e.time, detail: e.detail })
    }

    // task deadlines not done
    for (const group of rec.taskGroups ?? []) {
      for (const task of group.tasks) {
        if (task.status === 'done' || !task.deadline) continue
        if (taskHasLinkedKeyDate(task, rec)) continue
        push(task.deadline, task.title, 'task', 'task', rec, { time: task.time, detail: task.detail })
      }
    }

    // key dates not done
    for (const kd of rec.keyDates ?? []) {
      if (kd.done || !kd.date) continue
      // 继承同案同日的 timeline 事件的时间/法庭（即使该事件已 done——开庭的
      // 时间/法庭常记在已完成的 hearing 事件里，而 keyDate 只记日期）。
      let time: string | undefined
      let detail: string | undefined
      for (const e of events) {
        if (e.caseId !== rec.caseId || e.date !== kd.date) continue
        if (e.time !== undefined && e.time !== '') time = e.time
        if (e.detail !== undefined && e.detail !== '') detail = e.detail
      }
      push(kd.date, kd.label, 'keydate', 'keydate', rec, { time, detail })
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

/**
 * 统一事项版 deadline 计算（v2）：事件来自 items + legacy 合并，任务期限
 * 来自 items（type=task/both）。registry 仍提供案件元信息（名称/案号/法院）
 * 与 keyDates。兼容旧入口——旧 computeDeadlines 保留给无 item 的调用方。
 *
 * @param taskDeadlines - items 里的任务期限：Map<taskId, {caseId,title,date,time,status}>。
 */
export function computeDeadlinesV2(
  registry: CaseRegistry,
  events: TimelineEvent[],
  taskDeadlines: Map<string, { caseId: string; title: string; date: string; time?: string; status: string }>,
  caseId?: string,
  opts: { includeOverdue?: boolean; maxItems?: number } = {},
): DeadlineItem[] {
  const today = TODAY()
  const items: DeadlineItem[] = []
  const byKey = new Map<string, DeadlineItem>()
  const KIND_PRIORITY: Record<DeadlineItem['kind'], number> = {
    keydate: 4,
    deadline: 3,
    hearing: 2,
    task: 1,
  }

  const push = (rec: CaseRecord, date: string, label: string, kind: DeadlineItem['kind'], source: string, extra?: { time?: string; detail?: string }): void => {
    if (!date) return
    const normLabel = String(label ?? '').trim()
    if (normLabel === '') return
    const daysLeft = Math.round((new Date(`${date}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86_400_000)
    const item: DeadlineItem = {
      caseId: rec.caseId,
      caseName: rec.name,
      caseNumber: rec.caseNumber,
      court: rec.court,
      time: extra?.time !== undefined && extra.time.trim() !== '' ? extra.time.trim() : undefined,
      detail: extra?.detail !== undefined && extra.detail.trim() !== '' ? extra.detail.trim() : undefined,
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
      const mergedItem: DeadlineItem = { ...item }
      if (existing !== undefined) {
        if (mergedItem.time === undefined) mergedItem.time = existing.time
        if (mergedItem.detail === undefined) mergedItem.detail = existing.detail
        if (mergedItem.caseNumber === undefined) mergedItem.caseNumber = existing.caseNumber
        if (mergedItem.court === undefined) mergedItem.court = existing.court
      }
      byKey.set(key, mergedItem)
    }
  }

  // caseId → CaseRecord 映射（items 的 ownerId 可能对应 registry 里已删案件——
  // 此时孤儿事件自然跳过，配合 cascade delete 不再有孤儿）。
  const byCase = new Map<string, CaseRecord>()
  for (const rec of Object.values(registry.cases)) {
    byCase.set(rec.caseId, rec)
  }

  // 事件（items + legacy 合并）：kind 按事件类型。
  for (const e of events) {
    if (caseId !== undefined && e.caseId !== caseId) continue
    const rec = byCase.get(e.caseId)
    if (rec === undefined) continue
    if (e.status === 'done' || e.status === 'cancelled') continue
    if (!e.date) continue
    push(rec, e.date, e.title || eventTypeLabel(e.type), eventKind(e.type), e.type, { time: e.time, detail: e.detail })
  }

  // 任务期限（items 的 task/both）。
  const processedCases = new Set<string>()
  for (const td of taskDeadlines.values()) {
    if (caseId !== undefined && td.caseId !== caseId) continue
    const rec = byCase.get(td.caseId)
    if (rec === undefined) continue
    if (td.status === 'done' || td.status === 'cancelled') continue
    processedCases.add(td.caseId)
    push(rec, td.date, td.title, 'task', 'task', { time: td.time })
  }

  // keyDates：registry 里仍未 done 的（含任务派生的 keydate）。
  for (const [cid, rec] of byCase) {
    if (caseId !== undefined && cid !== caseId) continue
    for (const kd of rec.keyDates ?? []) {
      if (kd.done || !kd.date) continue
      let time: string | undefined
      let detail: string | undefined
      for (const e of events) {
        if (e.caseId !== cid || e.date !== kd.date) continue
        if (e.time !== undefined && e.time !== '') time = e.time
        if (e.detail !== undefined && e.detail !== '') detail = e.detail
      }
      push(rec, kd.date, kd.label, 'keydate', 'keydate', { time, detail })
    }
  }

  const merged = [...byKey.values()]
  merged.sort((a, b) => a.date.localeCompare(b.date) || a.caseId.localeCompare(b.caseId))
  if (opts.includeOverdue !== true) {
    return merged.filter((i) => i.daysLeft >= 0).slice(0, opts.maxItems ?? 200)
  }
  return merged.slice(0, opts.maxItems ?? 500)
}
