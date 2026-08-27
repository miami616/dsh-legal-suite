/**
 * Party resolution helpers for the litigation UI.
 *
 * The imported AgentLex data stores "our side" in two places:
 *   - `record.ourSide` (top-level, sparse)
 *   - `record.parties.ourSide` (the real source, values can be English keys
 *     like "plaintiff"/"applicant" or Chinese labels like "申请人")
 * and party rows in `record.parties.details[]` with Chinese `role` labels
 * (原告/被告/申请人/被申请人/上诉人/被上诉人/申请执行人/被执行人…), plus an
 * optional `ourClient: true` marker.
 *
 * These helpers normalise all of that into a reliable `{ role, name }` pair
 * for "我方" and the primary "对方", used by both the case card and detail.
 */
import type { CaseRecord } from '../store/types.ts'

export interface PartyInfo {
  role: string
  name: string
}

/** Canonical our-side keys used by the rest of the UI. */
export type OurSideKey =
  | 'plaintiff' | 'defendant' | 'applicant' | 'respondent'
  | 'appellant' | 'appellee' | 'executionApplicant' | 'executionRespondent'

/** English key / Chinese label → canonical key. */
const OUR_SIDE_ALIASES: Record<string, OurSideKey> = {
  plaintiff: 'plaintiff', 原告: 'plaintiff',
  defendant: 'defendant', 被告: 'defendant',
  applicant: 'applicant', 申请人: 'applicant',
  respondent: 'respondent', 被申请人: 'respondent',
  appellant: 'appellant', 上诉人: 'appellant',
  appellee: 'appellee', 被上诉人: 'appellee',
  executionApplicant: 'executionApplicant', 申请执行人: 'executionApplicant',
  executionRespondent: 'executionRespondent', 被执行人: 'executionRespondent',
}

/** Canonical key → Chinese role label(s) our side may appear under. */
const OUR_ROLE_LABELS: Record<OurSideKey, string[]> = {
  plaintiff: ['原告'],
  defendant: ['被告'],
  // In AgentLex data "applicant" is used for both 申请人 (arbitration) and
  // 申请执行人 (execution); "respondent" for 被申请人 / 被执行人 / 被告.
  applicant: ['申请人', '申请执行人'],
  respondent: ['被申请人', '被执行人', '被告'],
  appellant: ['上诉人'],
  appellee: ['被上诉人'],
  executionApplicant: ['申请执行人'],
  executionRespondent: ['被执行人'],
}

/** Canonical key → Chinese role label(s) the counterparty appears under. */
const OPPOSITE_ROLE_LABELS: Record<OurSideKey, string[]> = {
  plaintiff: ['被告'],
  defendant: ['原告'],
  applicant: ['被申请人', '被执行人', '被告'],
  respondent: ['申请人', '申请执行人', '原告'],
  appellant: ['被上诉人'],
  appellee: ['上诉人'],
  executionApplicant: ['被执行人'],
  executionRespondent: ['申请执行人'],
}

/** Read the our-side value from either storage location. */
export function rawOurSide(record: CaseRecord): string | undefined {
  return record.ourSide ?? record.parties?.ourSide
}

/** Normalise any our-side value (English key or Chinese label) to canonical. */
export function normalizeOurSide(value: unknown): OurSideKey | '' {
  if (value === undefined || value === null) return ''
  const s = String(value).trim()
  return OUR_SIDE_ALIASES[s] ?? ''
}

/** Chinese role label for our side ('' when unknown). */
export function ourRoleLabel(record: CaseRecord): string {
  const key = normalizeOurSide(rawOurSide(record))
  return key === '' ? '' : OUR_ROLE_LABELS[key][0]
}

/** Find the first party detail matching one of the given Chinese roles. */
function findPartyByRoles(record: CaseRecord, roles: string[]): PartyInfo | undefined {
  const details = record.parties?.details ?? []
  if (roles.length === 0) return undefined
  // Exact match first (avoids 被告一 vs 被告 confusion when both exist).
  for (const p of details) {
    if (p.role !== undefined && roles.some((r) => p.role === r)) {
      return { role: p.role, name: p.name }
    }
  }
  // Then segment/contains match (一审原告/二审被上诉人 → 被上诉人, 被告一 → 被告…).
  for (const p of details) {
    const role = p.role
    if (role !== undefined && roles.some((r) => role.includes(r) || role.startsWith(r))) {
      return { role, name: p.name }
    }
  }
  return undefined
}

/** Resolve "我方" party from a case record. */
export function resolveOurParty(record: CaseRecord): PartyInfo {
  const details = record.parties?.details ?? []

  // 1. Explicit ourClient marker wins.
  const marked = details.find((p) => p.ourClient === true)
  if (marked !== undefined) {
    return { role: marked.role ?? ourRoleLabel(record), name: marked.name }
  }

  // 2. Match by our-side role.
  const key = normalizeOurSide(rawOurSide(record))
  if (key !== '') {
    const roles = OUR_ROLE_LABELS[key]
    const found = findPartyByRoles(record, roles)
    if (found !== undefined) return found
    // 3. Fall back to top-level plaintiff/defendant names.
    if (key === 'plaintiff') return { role: roles[0], name: record.parties?.plaintiff ?? '' }
    if (key === 'defendant') return { role: roles[0], name: record.parties?.defendant ?? '' }
  }

  return { role: ourRoleLabel(record), name: '' }
}

/** Resolve the primary "对方" party (the opposite side of our party). */
export function resolveCounterparty(record: CaseRecord): PartyInfo {
  const our = resolveOurParty(record)
  const details = record.parties?.details ?? []
  const key = normalizeOurSide(rawOurSide(record))

  // 1. Prefer a detail carrying the opposite role.
  if (key !== '') {
    const oppRoles = OPPOSITE_ROLE_LABELS[key]
    const found = findPartyByRoles(record, oppRoles)
    if (found !== undefined && found.name !== our.name) return found
  }

  // 2. Otherwise the first non-our party detail.
  const other = details.find((p) => p.name !== our.name)
  if (other !== undefined) return { role: other.role ?? '', name: other.name }

  // 3. Fall back to top-level names.
  if (key === 'plaintiff') return { role: '被告', name: record.parties?.defendant ?? '' }
  if (key === 'defendant') return { role: '原告', name: record.parties?.plaintiff ?? '' }
  return { role: '', name: '' }
}
