/**
 * 项目信息完整度与缺口清单（非诉域）。
 *
 * 与诉讼侧同构，但「该有的信息」按项目类型分叉：常法看服务范围与服务期，
 * 专项看里程碑与交付节点。共同点是——**服务台账的时效性**始终是硬指标，
 * 常法的工作量证明全靠它。
 */

import { getProjectStage, getProjectStatus } from '../../shared/playbook/nonlitigation.ts'
import type { ProjectRecord, ProjectRegistry, ServiceRecord } from './store/types.ts'
import { detectStageSuggestions, PROJECT_STAGE_SEQUENCE } from './stage-expansion.ts'
import type { ProjectSuggestion } from './stage-expansion.ts'

/* ------------------------------------------------------------ 字段规则 */

export interface ProjectHealthGap {
  field: string
  label: string
  why: string
}

interface ProjectFieldRule {
  /** null 表示所有类型都适用。 */
  types: Array<'retainer' | 'special' | 'consult'> | null
  /** null 表示所有状态都适用。 */
  statuses: Array<'retained' | 'active' | 'suspended' | 'completed' | 'closed'> | null
  field: string
  label: string
  why: string
  read: (record: ProjectRecord) => string
}

const s = (v: unknown): string => (v === undefined || v === null ? '' : String(v).trim())

const ALL_STATUSES = ['retained', 'active', 'suspended', 'completed', 'closed'] as const

export const PROJECT_FIELD_RULES: ProjectFieldRule[] = [
  {
    types: null, statuses: ALL_STATUSES as unknown as ProjectFieldRule['statuses'],
    field: 'leadLawyer', label: '负责人', why: '服务对接与工时归属的主体',
    read: (r) => s(r.leadLawyer),
  },
  {
    types: null, statuses: ALL_STATUSES as unknown as ProjectFieldRule['statuses'],
    field: 'servicePeriod', label: '服务周期', why: '续约提醒、年度报告与结项的唯一时间基准',
    read: (r) => (s(r.servicePeriod?.start) !== '' && s(r.servicePeriod?.end) !== '' ? 'ok' : ''),
  },
  {
    types: ['retainer', 'special'], statuses: null,
    field: 'contractAmount', label: '合同金额', why: '结算与开票的依据',
    read: (r) => s(r.contractAmount),
  },
  {
    types: ['retainer'], statuses: null,
    field: 'serviceScope', label: '服务范围', why: '常法按服务范围分叉展开日常履约阶段，缺此项无法排任务',
    read: (r) => ((r.serviceScope ?? []).length > 0 ? 'ok' : ''),
  },
  {
    types: ['special'], statuses: ['retained', 'active'],
    field: 'deliverable', label: '交付物里程碑', why: '专项按交付物验收，至少应有一个里程碑关键日期',
    read: (r) => ((r.keyDates ?? []).some((k) => /交付|定稿|交割|结项|变更完成/.test(k.label)) ? 'ok' : ''),
  },
  {
    types: ['retainer'], statuses: ['active'],
    field: 'keyDate:服务期届满', label: '服务期届满关键日期', why: '续约提醒要在届满前 60 天触发，依赖这个日期',
    read: (r) => ((r.keyDates ?? []).some((k) => k.label === '服务期届满') ? 'ok' : ''),
  },
]

/* ------------------------------------------------------------ 体检结果 */

export interface ProjectHealth {
  projectId: string
  name: string
  status?: string
  statusLabel: string
  projectType?: string
  stage: {
    id?: string
    name?: string
    total: number
    done: number
    open: number
  }
  completeness: {
    score: number
    filled: number
    total: number
    gaps: ProjectHealthGap[]
  }
  /** 服务台账：最近一条服务记录的日期与距今天数。 */
  serviceLog: {
    count: number
    lastDate?: string
    daysSince?: number
    stale: boolean
  }
  /** 服务期剩余天数（有 end 时给出）。 */
  daysToExpiry?: number
  suggestions: ProjectSuggestion[]
}

const STALE_DAYS = 30

const todayStr = (): string => new Date().toISOString().slice(0, 10)

function daysBetween(from: string, to: string): number {
  return Math.round(
    (new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86400000,
  )
}

/** 计算单个项目的体检结果。 */
export function computeProjectHealth(
  record: ProjectRecord,
  services: ServiceRecord[],
  today = todayStr(),
): ProjectHealth {
  const statusId = s(record.status) === '' ? 'active' : s(record.status)
  const type = s(record.projectType)
  const statusDef = getProjectStatus(statusId)

  const applicable = PROJECT_FIELD_RULES.filter((rule) => {
    const typeOk = rule.types === null || (rule.types as string[]).includes(type)
    const statusOk = rule.statuses === null || (rule.statuses as string[]).includes(statusId)
    return typeOk && statusOk
  })

  const gaps: ProjectHealthGap[] = []
  let filled = 0
  for (const rule of applicable) {
    if (rule.read(record) !== '') filled++
    else gaps.push({ field: rule.field, label: rule.label, why: rule.why })
  }
  const total = applicable.length
  const score = total === 0 ? 100 : Math.round((filled / total) * 100)

  // 阶段进度：取顺序轨道上第一个「有任务且未全部完成」的阶段，否则取最后一个有任务的阶段
  const sequence = PROJECT_STAGE_SEQUENCE[type] ?? PROJECT_STAGE_SEQUENCE.special
  let stage: ProjectHealth['stage'] = { total: 0, done: 0, open: 0 }
  for (const stageId of sequence) {
    const stageDef = getProjectStage(stageId)
    const group = (record.taskGroups ?? []).find((g) => g.name === stageDef?.name)
    const tasks = group?.tasks ?? []
    if (tasks.length === 0) continue
    const done = tasks.filter((t) => t.status === 'done').length
    stage = { id: stageId, name: stageDef?.name, total: tasks.length, done, open: tasks.length - done }
    if (done < tasks.length) break
  }

  // 服务台账时效性
  const related = services.filter((svc) => {
    const client = s(svc.client)
    return client !== '' && record.name.includes(client)
  })
  const lastDate = related
    .map((svc) => s(svc.date))
    .filter((d) => d !== '')
    .sort()
    .at(-1)
  const daysSince = lastDate === undefined ? undefined : daysBetween(lastDate, today)
  const stale = statusId === 'active' && (daysSince === undefined || daysSince > STALE_DAYS)

  const suggestions = detectStageSuggestions(
    { registryVersion: '1.0', projects: { [record.projectId]: record } } as ProjectRegistry,
    services,
    record.projectId,
  )[0]?.suggestions ?? []

  const health: ProjectHealth = {
    projectId: record.projectId,
    name: record.name,
    status: statusId,
    statusLabel: statusDef.label,
    projectType: type,
    stage,
    completeness: { score, filled, total, gaps },
    serviceLog: { count: related.length, lastDate, daysSince, stale },
    suggestions,
  }
  const end = s(record.servicePeriod?.end)
  if (end !== '') health.daysToExpiry = daysBetween(today, end)
  return health
}

/** 扫描全部项目，按完整度升序排列。 */
export function computeRegistryHealth(
  registry: ProjectRegistry,
  services: ServiceRecord[],
  opts: { includeClosed?: boolean } = {},
): ProjectHealth[] {
  const today = todayStr()
  const out: ProjectHealth[] = []
  for (const record of Object.values(registry.projects)) {
    if (!opts.includeClosed && s(record.status) === 'closed') continue
    out.push(computeProjectHealth(record, services, today))
  }
  out.sort((a, b) => a.completeness.score - b.completeness.score)
  return out
}
