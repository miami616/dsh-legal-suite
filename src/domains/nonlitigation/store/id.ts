/**
 * ID generation. Mirrors AgentLex conventions:
 *   - caseId: YYYY-NNN, system-assigned from registry max+1 (per-year),
 *     retried on collision (the file lock serializes writers).
 *   - child ids: tg- / task- / sub- / chk- / kd- / evt- / sch-<timestamp-hex>.
 */

/** Current UTC year for case id prefixes. */
export function currentYear(): number {
  return new Date().getUTCFullYear()
}

/** Generate a per-year case number: YYYY-NNN, next after the highest existing. */
export function nextCaseId(cases: Record<string, unknown>): string {
  const year = currentYear()
  let max = 0
  for (const id of Object.keys(cases)) {
    const match = /^(\d{4})-(\d{3})$/.exec(id)
    if (match === null) continue
    const y = Number(match[1])
    if (y !== year) continue
    const n = Number(match[2])
    if (n > max) max = n
  }
  return `${year}-${String(max + 1).padStart(3, '0')}`
}

/** Generate a per-year project number: YYYY-NNN, next after the highest existing. */
export function nextProjectId(projects: Record<string, unknown>): string {
  const year = currentYear()
  let max = 0
  for (const id of Object.keys(projects)) {
    const match = /^(\d{4})-(\d{3})$/.exec(id)
    if (match === null) continue
    const y = Number(match[1])
    if (y !== year) continue
    const n = Number(match[2])
    if (n > max) max = n
  }
  return `${year}-${String(max + 1).padStart(3, '0')}`
}

/** Unique child id with a short prefix + timestamp-derived tail. */
export function childId(prefix: string): string {
  const tail = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  return `${prefix}-${tail}`
}

export function taskGroupId(): string {
  return childId('tg')
}

export function taskId(): string {
  return childId('task')
}

export function subtaskId(): string {
  return childId('sub')
}

export function checklistId(): string {
  return childId('chk')
}

export function keyDateId(): string {
  return childId('kd')
}

export function eventId(): string {
  return childId('evt')
}

export function scheduleId(): string {
  return childId('sch')
}

/** RFC3339-ish timestamp (UTC) like AgentLex writes. */
export function nowIso(): string {
  return new Date().toISOString()
}
