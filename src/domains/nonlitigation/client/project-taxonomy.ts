/**
 * Non-litigation project taxonomy — type/status labels, colors, formatting.
 *
 * The status ladder is owned by the shared playbook
 * (`src/shared/playbook/nonlitigation.ts`) so the agent persona, the tool
 * parameter docs, the seeded reference projects and these badges stay in sync.
 * The historical bug this fixes: the tool advertised `active/inactive/closed`
 * while the UI rendered five different values, so an agent-written status
 * could silently fall through to a raw unstyled string.
 */

import {
  PROJECT_STATUSES as PLAYBOOK_STATUSES,
  getProjectStatus,
  isProjectStatus,
  type ProjectStatusDef,
} from '../../../shared/playbook/nonlitigation.ts'

export type { ProjectStatusDef }

export interface ProjectTypeDef {
  key: string
  label: string
  dot: string
}

export const PROJECT_TYPES: ProjectTypeDef[] = [
  { key: 'retainer', label: '常法', dot: '#2e6f5e' },
  { key: 'special', label: '专项', dot: '#4a7ab5' },
  { key: 'consult', label: '咨询', dot: '#8b4fa0' },
  { key: '__all', label: '全部', dot: '#a69a90' },
]

const TYPE_LABEL: Record<string, string> = {
  retainer: '常法', special: '专项', consult: '咨询',
  '常年法律顾问': '常法', '专项法律服务': '专项', '咨询': '咨询',
}

const TYPE_DOT: Record<string, string> = {
  retainer: '#2e6f5e', special: '#4a7ab5', consult: '#8d4fa0',
  '常年法律顾问': '#2e6f5e', '专项法律服务': '#4a7ab5', '咨询': '#8d4fa0',
}

/** Normalize an arbitrary stored project type string to a known dot colour. */
export function getProjectTypeDot(raw: string | undefined): string {
  const key = (raw ?? '').trim()
  if (key === '') return '#a69a90'
  return TYPE_DOT[key] ?? '#a69a90'
}

/** Human label for a stored type (falls back to the raw value). */
export function projectTypeLabel(raw: string | undefined): string {
  const key = (raw ?? '').trim()
  if (key === '') return '项目'
  return TYPE_LABEL[key] ?? key
}

/** The full status ladder (single source of truth: shared playbook). */
export const PROJECT_STATUSES: ProjectStatusDef[] = PLAYBOOK_STATUSES

/** Chinese label → canonical id（兼容历史数据里存中文的情况）。 */
const LABEL_ALIASES: Record<string, string> = {
  '进行中': 'active',
  '已完成': 'completed',
  '已归档': 'closed',
  '已签约': 'retained',
  '已暂停': 'suspended',
}

export function getStatusDef(raw: string | undefined): ProjectStatusDef {
  const key = (raw ?? '').trim()
  const id = LABEL_ALIASES[key] ?? key
  return getProjectStatus(id === '' ? 'active' : id)
}

export function normalizeStatusKey(raw: string | undefined): string {
  const key = (raw ?? '').trim()
  const id = LABEL_ALIASES[key] ?? key
  if (id === '') return 'active'
  return isProjectStatus(id) ? id : id
}
