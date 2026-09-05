/**
 * Case status model — the 8-stage procedural ladder plus the procedure (审级)
 * axis, as display-only labels with theme-semantic colors.
 *
 * The ladder itself is owned by the shared playbook
 * (`src/shared/playbook/litigation.ts`) so that the agent persona, the tool
 * parameter docs, the seeded reference cases and these badges can never drift
 * apart. This module only adapts it for the UI (CSS tone classes).
 *
 * Historical note: this file previously declared its own 5-stage list, and any
 * status outside it (e.g. `审理中`) silently fell back to "收案" — a case that
 * was mid-trial rendered as just-received.
 */

import {
  LITIGATION_STATUSES,
  STATUS_LADDERS as PLAYBOOK_STATUS_LADDERS,
  getLitigationStatus,
  getStatusLadder,
} from '../../../shared/playbook/litigation.ts'
import type { LitigationStatusDef as CaseStatusDef } from '../../../shared/playbook/litigation.ts'

export type { CaseStatusDef }

/** 按审级的状态阶梯表（唯一事实源：shared playbook）。 */
export const STATUS_LADDERS: Record<string, CaseStatusDef[]> = PLAYBOOK_STATUS_LADDERS

/** The full status ladder of the default (一审) procedure — legacy single-axis export. */
export const CASE_STATUSES: CaseStatusDef[] = LITIGATION_STATUSES

/** 取某审级的状态阶梯。 */
export function getStatusLadderForLevel(level: string | undefined | null): CaseStatusDef[] {
  return getStatusLadder(level)
}

/** Resolve a status def by id, procedure-aware (fallback: that ladder's intake). */
export function getStatusDef(statusId: string | undefined | null, level?: string | undefined | null): CaseStatusDef {
  return getLitigationStatus(statusId, level)
}

/** Whether a status id is part of the canonical ladder. */
export function isKnownStatus(statusId: string | undefined | null): boolean {
  return CASE_STATUSES.some((s) => s.id === (statusId ?? '').trim())
}

/** Procedure (审级) tags — neutral, independent of status. */
export const PROCEDURE_LEVELS = ['一审', '二审', '再审', '劳动仲裁', '商事仲裁', '首次执行', '恢复执行', '刑事']

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
  if (/刑事/.test(trimmed) || type === '刑事') return '刑事'
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
  '刑事': '#8c2f28',
}

/** Dot color for a procedure level (fallback neutral). */
export function getProcedureDot(level: string | number | undefined | null): string {
  return PROCEDURE_LEVEL_DOTS[normalizeLevel(level)] ?? '#a69a90'
}
