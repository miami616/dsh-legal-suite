/**
 * Non-litigation project taxonomy — type/status labels, colors, formatting.
 */

export interface ProjectTypeDef {
  key: string
  label: string
  dot: string
}

export interface ProjectStatusDef {
  id: string
  label: string
  tone: 'neutral' | 'info' | 'accent' | 'success'
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

export const PROJECT_STATUSES: ProjectStatusDef[] = [
  { id: 'active', label: '进行中', tone: 'accent' },
  { id: 'retained', label: '已签约', tone: 'info' },
  { id: 'completed', label: '已完成', tone: 'success' },
  { id: 'closed', label: '已归档', tone: 'neutral' },
  { id: 'suspended', label: '已暂停', tone: 'neutral' },
]

const STATUS_DEF: Record<string, ProjectStatusDef> = {
  active: { id: 'active', label: '进行中', tone: 'accent' },
  retained: { id: 'retained', label: '已签约', tone: 'info' },
  completed: { id: 'completed', label: '已完成', tone: 'success' },
  closed: { id: 'closed', label: '已归档', tone: 'neutral' },
  suspended: { id: 'suspended', label: '已暂停', tone: 'neutral' },
  '进行中': { id: 'active', label: '进行中', tone: 'accent' },
  '已完成': { id: 'completed', label: '已完成', tone: 'success' },
  '已归档': { id: 'closed', label: '已归档', tone: 'neutral' },
  '已签约': { id: 'retained', label: '已签约', tone: 'info' },
  '已暂停': { id: 'suspended', label: '已暂停', tone: 'neutral' },
}

export function getStatusDef(raw: string | undefined): ProjectStatusDef {
  const key = (raw ?? 'active').trim()
  return STATUS_DEF[key] ?? { id: key || 'active', label: key || '进行中', tone: 'neutral' }
}

export function normalizeStatusKey(raw: string | undefined): string {
  const key = (raw ?? '').trim()
  return STATUS_DEF[key]?.id ?? (key === '' ? 'active' : key)
}
