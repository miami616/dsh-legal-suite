/**
 * 阶段模板展开 + 阶段推进检测（非诉域）。
 *
 * 与诉讼域同构，但阶段按**项目类型**分叉，而非按程序阶段：
 *   专项：服务启动 → 尽职调查 → 交易文件 → 交割 → 结项归档（严格顺序）
 *   常法：服务启动 → 日常履约（按服务范围分叉，长期并行）→ 服务报告与续约 → 结项归档
 *   咨询：日常咨询 → 结项归档
 *
 * 常法的「日常履约」不是一次性阶段，因此推进检测对常法只触发三类事：
 * 启动完成后的履约阶段补齐、服务期临近的续约提醒、台账断更提醒；
 * 专项才走「上一阶段全部完成 → 展开下一阶段」的顺序推进。
 */

import {
  PROJECT_STAGES,
  getProjectStage,
  getProjectStatus,
  type ProjectStageTemplate,
  type ProjectTaskTemplate,
} from '../../shared/playbook/nonlitigation.ts'
import type { ProjectStore } from './store/project-store.ts'
import type { ProjectRecord, ProjectRegistry, ServiceRecord } from './store/types.ts'

/* ------------------------------------------------------------ 阶段映射 */

/** 专项与常法的顺序轨道；常法的日常履约阶段不走顺序推进。 */
export const PROJECT_STAGE_SEQUENCE: Record<string, string[]> = {
  retainer: ['kickoff', 'service_report', 'closure'],
  special: ['kickoff', 'due_diligence', 'transaction_docs', 'closing', 'closure'],
  consult: ['consulting', 'closure'],
}

/** 常法日常履约阶段（按服务范围分叉）。 */
export const RETAINER_DAILY_STAGES = ['contract_review', 'consulting', 'compliance'] as const

/** 服务范围关键词 → 日常履约阶段 id。 */
const SCOPE_TO_STAGE: Record<string, string> = {
  合同审查: 'contract_review',
  法律咨询: 'consulting',
  合规审查: 'compliance',
  劳动用工: 'compliance',
}

/** 台账断更阈值（天）。 */
export const SERVICE_LOG_STALE_DAYS = 30
/** 续约提醒阈值（天）。 */
export const RENEWAL_LEAD_DAYS = 60

const todayStr = (): string => new Date().toISOString().slice(0, 10)

function daysUntil(date: string, from: string): number {
  return Math.round((new Date(`${date}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime()) / 86400000)
}

/** 按项目类型取适用阶段（含顺序轨道外的日常履约阶段）。 */
export function stagesForProject(project: ProjectRecord): ProjectStageTemplate[] {
  const type = (project.projectType ?? '').trim() as 'retainer' | 'special' | 'consult'
  return PROJECT_STAGES.filter((s) => s.appliesTo.includes(type))
}

/* ---------------------------------------------------------- 展开（plan/apply） */

export interface ProjectStageExpandOptions {
  anchorDate?: string
  only?: string[]
  skip?: string[]
  dryRun?: boolean
}

export interface PlannedProjectTask {
  title: string
  priority: 'low' | 'medium' | 'high'
  deadline?: string
  detail?: string
  deliverable?: string
  subtasks: string[]
  checklist: string[]
}

export interface ProjectStagePlan {
  projectId: string
  stageId: string
  groupName: string
  dryRun: boolean
  anchorDate?: string
  tasks: PlannedProjectTask[]
  skippedExisting: string[]
  skippedByFilter: string[]
  warnings: string[]
}

function daysBeforeStr(anchorDate: string, days: number): string {
  const base = new Date(`${anchorDate}T00:00:00`)
  base.setDate(base.getDate() - days)
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`
}

function planProjectTask(t: ProjectTaskTemplate, anchorDate: string | undefined): PlannedProjectTask {
  const deadline = t.leadDays !== undefined && anchorDate !== undefined
    ? daysBeforeStr(anchorDate, t.leadDays)
    : undefined
  return {
    title: t.title,
    priority: t.priority,
    deadline,
    detail: t.detail,
    deliverable: t.deliverable,
    subtasks: t.subtasks ?? [],
    checklist: t.checklist ?? [],
  }
}

/** 计算展开计划（不写库）。已存在性按目标任务组内标题判定（items 源）。 */
export async function planStageExpansion(
  projectStore: ProjectStore,
  projectId: string,
  stageId: string,
  opts: ProjectStageExpandOptions = {},
  itemStore?: import('../item/store/item-store.ts').ItemStore,
): Promise<ProjectStagePlan> {
  const stage = getProjectStage(stageId)
  if (stage === undefined) {
    throw new Error(`unknown stageId: ${stageId}（可选：${PROJECT_STAGES.map((s) => s.id).join(' / ')}）`)
  }
  const record = await projectStore.readProject(projectId)
  if (record === undefined) throw new Error(`project not found: ${projectId}`)

  const warnings: string[] = []
  // 0.2.2：已存在性判断读 items（唯一真相源），不再从 registry taskGroups。
  let existingTitles: Set<string>
  let existingTemplateTitles: Set<string>
  if (itemStore !== undefined) {
    const { buildOwnerTaskGroups } = await import('../item/shape.ts')
    const [groups, items] = await Promise.all([itemStore.listGroups(projectId), itemStore.listItems(projectId)])
    const own = buildOwnerTaskGroups(projectId, 'nonlitigation', groups, items)
    const stageGroup = own.find((g) => g.name === stage.name)
    const rows = stageGroup?.tasks ?? []
    existingTitles = new Set(rows.map((t) => String((t as { title?: unknown }).title ?? '')))
    existingTemplateTitles = new Set(
      rows.map((t) => String((t as { templateTitle?: unknown }).templateTitle ?? '')).filter((v) => v !== ''),
    )
  } else {
    const group = (record.taskGroups ?? []).find((g) => g.name === stage.name)
    const existing = group?.tasks ?? []
    existingTitles = new Set(existing.map((t) => t.title))
    // 同诉讼侧：管家改名后以 templateTitle 判定已展开，避免重复插入原名副本。
    existingTemplateTitles = new Set(
      existing
        .map((t) => (t as { templateTitle?: string }).templateTitle)
        .filter((v): v is string => v !== undefined && v !== ''),
    )
  }
  const only = opts.only === undefined ? undefined : new Set(opts.only)
  const skip = new Set(opts.skip ?? [])
  if (opts.anchorDate === undefined) {
    const withLead = stage.tasks.filter((t) => t.leadDays !== undefined)
    if (withLead.length > 0) {
      warnings.push(`未提供 anchorDate，${withLead.length} 个任务将不带 deadline：${withLead.map((t) => t.title).join('、')}`)
    }
  }

  const tasks: PlannedProjectTask[] = []
  const skippedExisting: string[] = []
  const skippedByFilter: string[] = []
  for (const t of stage.tasks) {
    if (only !== undefined && !only.has(t.title)) { skippedByFilter.push(t.title); continue }
    if (skip.has(t.title)) { skippedByFilter.push(t.title); continue }
    if (existingTitles.has(t.title) || existingTemplateTitles.has(t.title)) {
      skippedExisting.push(t.title)
      continue
    }
    tasks.push(planProjectTask(t, opts.anchorDate))
  }

  return {
    projectId,
    stageId,
    groupName: stage.name,
    dryRun: opts.dryRun === true,
    anchorDate: opts.anchorDate,
    tasks,
    skippedExisting,
    skippedByFilter,
    warnings,
  }
}

/** 应用展开计划：创建/复用任务组并逐任务落库。 */
export async function applyStageExpansion(
  projectStore: ProjectStore,
  projectId: string,
  stageId: string,
  opts: ProjectStageExpandOptions = {},
  itemStore?: import('../item/store/item-store.ts').ItemStore,
): Promise<ProjectStagePlan & { groupId?: string }> {
  const plan = await planStageExpansion(projectStore, projectId, stageId, { ...opts, dryRun: false }, itemStore)
  if (plan.tasks.length === 0) return plan
  const stage = getProjectStage(stageId)!

  // 统一事项模型：任务写 items.json（type=task，带 groupId）。
  if (itemStore !== undefined) {
    const groups = await itemStore.listGroups(projectId)
    let group = groups.find((g) => g.name === stage.name)
    if (group === undefined) {
      group = await itemStore.upsertGroup({ ownerId: projectId, ownerType: 'nonlitigation', name: stage.name })
    }
    for (const t of plan.tasks) {
      const detail = t.deliverable !== undefined
        ? `${t.detail ?? ''}${t.detail !== undefined ? '；' : ''}交付物：${t.deliverable}`
        : t.detail
      await itemStore.upsertItem({
        ownerId: projectId,
        ownerType: 'nonlitigation',
        type: 'task',
        title: t.title,
        status: 'pending',
        priority: t.priority,
        date: t.deadline,
        detail,
        groupId: group.id,
        groupName: group.name,
        templateTitle: t.title,
        subtasks: t.subtasks.map((st) => ({ id: `sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, title: st, done: false })),
        checklist: t.checklist.map((c) => ({ id: `chk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text: c, done: false })),
      })
    }
    return { ...plan, groupId: group.id }
  }

  const record = await projectStore.upsertTaskGroup(projectId, { name: stage.name })
  const group = record.taskGroups!.find((g) => g.name === stage.name)!
  for (const t of plan.tasks) {
    const detail = t.deliverable !== undefined
      ? `${t.detail ?? ''}${t.detail !== undefined ? '；' : ''}交付物：${t.deliverable}`
      : t.detail
    const updated = await projectStore.upsertTask(projectId, group.id, {
      title: t.title,
      status: 'todo',
      priority: t.priority,
      deadline: t.deadline,
      detail,
      // 溯源标记：任务后续被改名也能认出它来自哪个模板任务。
      templateTitle: t.title,
    })
    const created = updated.taskGroups!.find((g) => g.id === group.id)!.tasks
      .find((x) => x.title === t.title)
    if (created === undefined) continue
    for (const st of t.subtasks) {
      await projectStore.upsertSubtask(projectId, group.id, created.id, { title: st, done: false })
    }
    for (const c of t.checklist) {
      await projectStore.addChecklistItem(projectId, group.id, created.id, c)
    }
  }
  return { ...plan, groupId: group.id }
}

/* ---------------------------------------------------------- 推进检测 */

export interface ProjectSuggestion {
  type: 'expand_current' | 'expand_next' | 'advance_status' | 'renewal_due' | 'service_log_stale' | 'close_out'
  reason: string
  stageId?: string
  stageName?: string
  suggestStatus?: string
  suggestStatusLabel?: string
  preview?: string[]
  daysLeft?: number
  anchorDate?: string
}

export interface ProjectStageSuggestions {
  projectId: string
  name: string
  status?: string
  statusLabel: string
  suggestions: ProjectSuggestion[]
}

function groupTasks(project: ProjectRecord, stageId: string) {
  const stage = getProjectStage(stageId)
  if (stage === undefined) return { group: undefined, tasks: [] }
  const group = (project.taskGroups ?? []).find((g) => g.name === stage.name)
  return { group, tasks: group?.tasks ?? [] }
}

function suggestForProject(
  project: ProjectRecord,
  services: ServiceRecord[],
  today: string,
): ProjectSuggestion[] {
  const suggestions: ProjectSuggestion[] = []
  const status = (project.status ?? 'active').trim()
  const type = (project.projectType ?? '').trim()
  if (status === 'closed' || status === 'suspended') return suggestions
  const statusDef = getProjectStatus(status)

  // ── 顺序轨道推进（专项严格顺序；常法只看 kickoff/service_report/closure）──
  const sequence = PROJECT_STAGE_SEQUENCE[type] ?? PROJECT_STAGE_SEQUENCE.special
  if (status === 'retained' || status === 'active' || status === 'completed') {
    for (let i = 0; i < sequence.length; i++) {
      const stageId = sequence[i]
      const stage = getProjectStage(stageId)!
      const { tasks } = groupTasks(project, stageId)
      const hasGroup = tasks.length > 0
      const allDone = hasGroup && tasks.every((t) => t.status === 'done')

      if (status === 'completed' && stageId !== 'closure') continue

      if (!hasGroup) {
        if (status === 'retained' && stageId === 'kickoff') {
          suggestions.push({
            type: 'expand_current', stageId, stageName: stage.name,
            reason: `项目已签约（「${statusDef.label}」）但「${stage.name}」还没有任务，建议按模板展开`,
            preview: stage.tasks.slice(0, 5).map((t) => t.title),
          })
        }
        break
      }
      if (!allDone) break // 当前阶段仍在推进中，无新建议
      // allDone → 看下一阶段
      const nextId = sequence[i + 1]
      if (nextId === undefined) break
      const { tasks: nextTasks } = groupTasks(project, nextId)
      if (nextTasks.length > 0) break // 下一阶段已展开
      const nextStage = getProjectStage(nextId)!
      const targetStatus = nextId === 'closure' ? 'completed' : 'active'
      suggestions.push({
        type: status === 'retained' ? 'advance_status' : 'expand_next',
        stageId: nextId,
        stageName: nextStage.name,
        suggestStatus: targetStatus,
        suggestStatusLabel: getProjectStatus(targetStatus).label,
        reason: `「${stage.name}」任务已全部完成，建议展开「${nextStage.name}」${status === 'retained' ? '并将状态推进到「进行中」' : ''}`,
        preview: nextStage.tasks.slice(0, 5).map((t) => t.title),
      })
      break
    }
  }

  // ── 常法：启动完成后按服务范围补日常履约阶段 ──
  if (status === 'active' && type === 'retainer') {
    const kickoff = groupTasks(project, 'kickoff')
    if (kickoff.tasks.length > 0 && kickoff.tasks.every((t) => t.status === 'done')) {
      const scope = project.serviceScope ?? []
      const wanted = new Set<string>()
      for (const s of scope) {
        if (SCOPE_TO_STAGE[s] !== undefined) wanted.add(SCOPE_TO_STAGE[s])
      }
      const missing = RETAINER_DAILY_STAGES.filter((id) => wanted.has(id))
        .filter((id) => groupTasks(project, id).tasks.length === 0)
      if (missing.length > 0) {
        suggestions.push({
          type: 'expand_current',
          reason: `服务启动已完成，但服务范围涉及的日常履约阶段尚未展开：${missing.map((id) => getProjectStage(id)!.name).join('、')}`,
          preview: missing.map((id) => getProjectStage(id)!.name),
        })
      }
    }
  }

  // ── 常法：续约临近 ──
  if (status === 'active' && type === 'retainer' && project.servicePeriod?.end !== undefined) {
    const left = daysUntil(project.servicePeriod.end, today)
    if (left >= 0 && left <= RENEWAL_LEAD_DAYS) {
      const hasRenewalKeyDate = (project.keyDates ?? []).some((k) => k.label === '续约洽谈启动' && k.done !== true)
      const hasRenewalTask = (project.taskGroups ?? []).some((g) => g.tasks.some((t) => t.title === '洽谈续约' && t.status !== 'done'))
      if (!hasRenewalKeyDate || !hasRenewalTask) {
        suggestions.push({
          type: 'renewal_due',
          reason: `服务期 ${project.servicePeriod.end} 届满（剩 ${left} 天），应在届满前 ${RENEWAL_LEAD_DAYS} 日启动续约洽谈${hasRenewalTask ? '' : '并登记「续约洽谈启动」关键日期'}`,
          daysLeft: left,
          anchorDate: project.servicePeriod.end,
        })
      }
    }
  }

  // ── 台账断更 ──
  if (status === 'active') {
    const related = services.filter((s) => {
      const client = (s.client ?? '').trim()
      return client !== '' && project.name.includes(client)
    })
    const latest = related
      .map((s) => s.date)
      .filter((d): d is string => d !== undefined && d !== '')
      .sort()
      .at(-1)
    const staleDays = latest === undefined ? SERVICE_LOG_STALE_DAYS + 1 : daysUntil(today, latest)
    if (staleDays > SERVICE_LOG_STALE_DAYS) {
      suggestions.push({
        type: 'service_log_stale',
        reason: `服务台账已超过 ${SERVICE_LOG_STALE_DAYS} 天未登记（${latest === undefined ? '本项目尚无记录' : `最近一条为 ${latest}`}），常法服务的工作量证明依赖台账，请补登`,
        daysLeft: staleDays,
      })
    }
  }

  // ── 已完成：结项归档 ──
  if (status === 'completed') {
    const closure = groupTasks(project, 'closure')
    if (closure.tasks.length === 0) {
      suggestions.push({
        type: 'expand_current',
        stageId: 'closure',
        stageName: getProjectStage('closure')!.name,
        reason: '项目已完成但尚未展开结项归档（交付物归档、工时结算、结项报告）',
        preview: getProjectStage('closure')!.tasks.slice(0, 5).map((t) => t.title),
      })
    } else if (closure.tasks.every((t) => t.status === 'done')) {
      suggestions.push({
        type: 'close_out',
        reason: '结项归档任务已全部完成，建议将状态改为「已归档」',
        suggestStatus: 'closed',
        suggestStatusLabel: getProjectStatus('closed').label,
      })
    }
  }

  return suggestions
}

/**
 * 扫描 registry，返回每个项目（可选单个）的阶段推进建议。纯只读。
 */
export function detectStageSuggestions(
  registry: ProjectRegistry,
  services: ServiceRecord[],
  onlyProjectId?: string,
): ProjectStageSuggestions[] {
  const today = todayStr()
  const out: ProjectStageSuggestions[] = []
  for (const project of Object.values(registry.projects)) {
    if (onlyProjectId !== undefined && project.projectId !== onlyProjectId) continue
    const suggestions = suggestForProject(project, services, today)
    if (suggestions.length > 0) {
      out.push({
        projectId: project.projectId,
        name: project.name,
        status: project.status,
        statusLabel: getProjectStatus(project.status ?? 'active').label,
        suggestions,
      })
    }
  }
  return out
}
