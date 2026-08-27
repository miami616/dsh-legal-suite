/**
 * Case status model — the 5-stage workflow (2026-08 AgentLex) plus the
 * procedure (审级) axis, as display-only labels with theme-semantic colors.
 */

export interface CaseStatusDef {
  id: string
  label: string
  /** Tailwind-free: semantic role → our CSS token class (mapped in board CSS). */
  tone: 'neutral' | 'info' | 'accent' | 'outline' | 'success'
  order: number
}

/** 5-stage status workflow (user-set, display only). */
export const CASE_STATUSES: CaseStatusDef[] = [
  { id: 'intake', label: '收案', tone: 'neutral', order: 1 },
  { id: 'pretrial', label: '庭前准备', tone: 'info', order: 2 },
  { id: 'awaiting_trial', label: '待开庭', tone: 'accent', order: 3 },
  { id: 'post_trial', label: '庭后管理', tone: 'outline', order: 4 },
  { id: 'closed', label: '已结案', tone: 'success', order: 99 },
]

const STATUS_MAP = new Map(CASE_STATUSES.map((s) => [s.id, s]))

/** Resolve a status def by id (fallback: intake). */
export function getStatusDef(statusId: string | undefined | null): CaseStatusDef {
  return (statusId !== null && statusId !== undefined && STATUS_MAP.has(statusId))
    ? STATUS_MAP.get(statusId)!
    : { id: 'intake', label: '收案', tone: 'neutral', order: 1 }
}

/** Procedure (审级) tags — neutral, independent of status. */
export const PROCEDURE_LEVELS = ['一审', '二审', '再审', '劳动仲裁', '商事仲裁', '首次执行', '恢复执行']

/** Normalize a stored level string into a canonical procedure tag ('' if none). */
export function normalizeLevel(level: string | number | undefined | null, type?: string): string {
  if (level === undefined || level === null || level === '') return ''
  const trimmed = String(level).trim()
  if (PROCEDURE_LEVELS.includes(trimmed)) return trimmed
  // Alias normalization
  if (trimmed === '一审' || trimmed === '二审' || trimmed === '再审') return trimmed
  if (/一审/.test(trimmed)) return '一审'
  if (/二审/.test(trimmed)) return '二审'
  if (/再审/.test(trimmed)) return '再审'
  if (/劳动/.test(trimmed) || /仲裁/.test(trimmed)) return type === '劳动争议' ? '劳动仲裁' : '商事仲裁'
  if (/执行/.test(trimmed)) return /恢复/.test(trimmed) ? '恢复执行' : '首次执行'
  return trimmed
}

/** Short display for a procedure level. */
export function getProcedureShort(level: string | number | undefined | null): string {
  const norm = normalizeLevel(level)
  return norm
}

/** 审级 8px 色点 hex — 左轨节点 / 筛选色点（AgentLex PROCEDURE_LEVEL_DOTS）。 */
const PROCEDURE_LEVEL_DOTS: Record<string, string> = {
  '一审': '#4a7ab5', '二审': '#7d6ab0', '再审': '#b0648a',
  '劳动仲裁': '#3a7d6b', '商事仲裁': '#2f7d77', '首次执行': '#4d7a4f', '恢复执行': '#2f7d77',
}

/** Dot color for a procedure level (fallback neutral). */
export function getProcedureDot(level: string | number | undefined | null): string {
  return PROCEDURE_LEVEL_DOTS[normalizeLevel(level)] ?? '#a69a90'
}
