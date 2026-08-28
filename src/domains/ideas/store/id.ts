/**
 * ID helpers for the ideas domain.
 * 想法 id 前缀 `idea-`，与 AgentLex 其余子实体（task-/sub-/chk-）风格一致。
 */

/** Unique idea id with a short prefix + timestamp-derived tail. */
export function ideaId(): string {
  const tail = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  return `idea-${tail}`
}

/** RFC3339-ish timestamp (UTC). */
export function nowIso(): string {
  return new Date().toISOString()
}
