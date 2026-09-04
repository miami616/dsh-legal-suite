/**
 * 阶段模板展开 + 阶段推进检测（诉讼域）。
 *
 * 两个能力：
 *
 * 1. planStageExpansion / applyStageExpansion —— 把 playbook 里的阶段模板
 *    （LITIGATION_STAGES）实例化到具体案件。模板只提供**骨架**：标准动作的
 *    标题、优先级、交付提示与相对锚点的提前量；管家可用 only/skip 裁剪，
 *    落地后仍可按案情增删改。规范约束的是「标准动作怎么说」，不是「不许
 *    有模板外的任务」。
 *
 * 2. detectStageSuggestions —— 只读的阶段推进检测。回答两类问题：
 *    a) 当前阶段任务已全部完成，是否该展开下一阶段（或建议结案）；
 *    b) 当前状态应有但缺失的信息（法院/案号/立案日期/开庭关键日期）。
 *    它是「到了一定阶段就能更新任务」的确定性检测层：update_case 改变
 *    status 时由工具层内联返回，管家会话开场体检时整体扫描。
 *
 * 幂等：按标题跳过已存在的任务，重复调用不会产生重复任务——
 * 管家把任务改名后也不会被模板再次创建一份原名版本。
 */

import {
  LITIGATION_STAGES,
  getLitigationStage,
  getLitigationStatus,
  daysBefore,
  type StageTemplate,
  type TaskTemplate,
} from '../../shared/playbook/litigation.ts'
import type { CaseStore } from './store/case-store.ts'
import type { CaseRecord, CaseRegistry } from './store/types.ts'

/* ------------------------------------------------------------ 阶段映射 */

/**
 * 案件状态 → 对应的阶段模板 id。
 * intake（收案）与 pre_filing（诉前）共用诉前模板。
 */
export const STATUS_TO_STAGE: Record<string, string> = {
  intake: 'pre_filing',
  pre_filing: 'pre_filing',
  filing: 'filing',
  pretrial: 'pretrial',
  awaiting_trial: 'trial',
  post_trial: 'post_trial',
  execution: 'execution',
}

/** 阶段推进顺序（对应 LITIGATION_STAGES 数组顺序）。 */
export const STAGE_ORDER: string[] = LITIGATION_STAGES.map((s) => s.id)

/** 下一阶段的模板 id；已是最后一个阶段返回 undefined。 */
export function nextStageId(stageId: string): string | undefined {
  const idx = STAGE_ORDER.indexOf(stageId)
  return idx >= 0 && idx + 1 < STAGE_ORDER.length ? STAGE_ORDER[idx + 1] : undefined
}

/* ---------------------------------------------------------- 展开（plan/apply） */

export interface StageExpandOptions {
  /** 锚点日期（如开庭日）。有 leadDays 的任务据此推算 deadline。 */
  anchorDate?: string
  /** 只展开这些标题（白名单）。 */
  only?: string[]
  /** 跳过这些标题。 */
  skip?: string[]
  /** true 时只返回计划，不落库。 */
  dryRun?: boolean
}

export interface PlannedTask {
  title: string
  priority: 'low' | 'medium' | 'high'
  deadline?: string
  detail?: string
  subtasks: string[]
  checklist: string[]
}

export interface StagePlan {
  caseId: string
  stageId: string
  groupName: string
  dryRun: boolean
  anchorDate?: string
  /** 将创建的任务（已扣除已存在与被过滤的）。 */
  tasks: PlannedTask[]
  /** 已存在、被跳过的标题。 */
  skippedExisting: string[]
  /** 被 only/skip 过滤掉的标题。 */
  skippedByFilter: string[]
  /** 模板阶段对应的标准状态与案件当前状态不一致时的提示。 */
  suggestStatus?: string
  warnings: string[]
}

/**
 * 计算展开计划（不写库）。
 * 已存在性按「目标任务组内」的标题判定——同一标题在别的阶段组里出现
 * （如两个阶段的「结案归档」）不算重复。
 */
export async function planStageExpansion(
  caseStore: CaseStore,
  caseId: string,
  stageId: string,
  opts: StageExpandOptions = {},
  itemStore?: import('../item/store/item-store.ts').ItemStore,
): Promise<StagePlan> {
  const stage = getLitigationStage(stageId)
  if (stage === undefined) {
    throw new Error(`unknown stageId: ${stageId}（可选：${STAGE_ORDER.join(' / ')}）`)
  }
  const record = await caseStore.readCase(caseId)
  if (record === undefined) throw new Error(`case not found: ${caseId}`)

  const warnings: string[] = []
  // 0.2.2：任务组/任务已存在性判断一律读 items（写路径唯一真相源），不再从
  // case-registry 的 taskGroups 判断（registry 副本已下岗）。
  let existingTitles: Set<string>
  let existingTemplateTitles: Set<string>
  if (itemStore !== undefined) {
    const { buildOwnerTaskGroups } = await import('../item/shape.ts')
    const [groups, items] = await Promise.all([itemStore.listGroups(caseId), itemStore.listItems(caseId)])
    const own = buildOwnerTaskGroups(caseId, 'litigation', groups, items)
    const stageGroup = own.find((g) => g.name === stage.name)
    const rows = stageGroup?.tasks ?? []
    existingTitles = new Set(rows.map((t) => String((t as { title?: unknown }).title ?? '')))
    existingTemplateTitles = new Set(
      rows.map((t) => String((t as { templateTitle?: unknown }).templateTitle ?? '')).filter((v) => v !== ''),
    )
  } else {
    const legacyGroup = (record.taskGroups ?? []).find((g) => g.name === stage.name)
    const rows = legacyGroup?.tasks ?? []
    existingTitles = new Set(rows.map((t) => t.title))
    // 管家把模板任务改名后（如「出庭参加庭审」→「出庭参加第二次庭审」），标题
    // 对不上但 templateTitle 仍指向模板原标题——据此认定已展开过，避免重复
    // 展开时又插入一个原名副本，把人工调整冲掉。
    existingTemplateTitles = new Set(
      rows.map((t) => t.templateTitle).filter((v): v is string => v !== undefined && v !== ''),
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

  const tasks: PlannedTask[] = []
  const skippedExisting: string[] = []
  const skippedByFilter: string[] = []
  for (const t of stage.tasks) {
    if (only !== undefined && !only.has(t.title)) { skippedByFilter.push(t.title); continue }
    if (skip.has(t.title)) { skippedByFilter.push(t.title); continue }
    if (existingTitles.has(t.title) || existingTemplateTitles.has(t.title)) {
      skippedExisting.push(t.title)
      continue
    }
    tasks.push(planTask(t, opts.anchorDate))
  }

  const plan: StagePlan = {
    caseId,
    stageId,
    groupName: stage.name,
    dryRun: opts.dryRun === true,
    anchorDate: opts.anchorDate,
    tasks,
    skippedExisting,
    skippedByFilter,
    warnings,
  }
  // 阶段模板自带的标准状态与案件现状不一致 → 提示管家可考虑推进 status
  // （只提示，不代改：状态推进属于案件判断，不是模板该替模型做的决定）。
  if (record.status !== undefined && record.status !== '' && record.status !== stage.status) {
    plan.suggestStatus = stage.status
  }
  return plan
}

function planTask(t: TaskTemplate, anchorDate: string | undefined): PlannedTask {
  const deadline = t.leadDays !== undefined && anchorDate !== undefined
    ? daysBefore(anchorDate, t.leadDays)
    : undefined
  return {
    title: t.title,
    priority: t.priority,
    deadline,
    detail: t.detail,
    subtasks: t.subtasks ?? [],
    checklist: t.checklist ?? [],
  }
}

/**
 * 应用展开计划：创建/复用任务组，逐任务落库（子任务与检查项一并创建）。
 * @returns 与 planStageExpansion 相同的计划对象，附带实际落库的任务组 id。
 */
export async function applyStageExpansion(
  caseStore: CaseStore,
  caseId: string,
  stageId: string,
  opts: StageExpandOptions = {},
  itemStore?: import('../item/store/item-store.ts').ItemStore,
): Promise<StagePlan & { groupId?: string }> {
  const plan = await planStageExpansion(caseStore, caseId, stageId, { ...opts, dryRun: false }, itemStore)
  if (plan.tasks.length === 0) return plan
  const stage = getLitigationStage(stageId)!

  // 统一事项模型：任务写 items.json（type=task，带 groupId）。
  if (itemStore !== undefined) {
    // 任务组：懒创建（同名组存在则复用）。
    const groups = await itemStore.listGroups(caseId)
    let group = groups.find((g) => g.name === stage.name)
    if (group === undefined) {
      group = await itemStore.upsertGroup({ ownerId: caseId, ownerType: 'litigation', name: stage.name })
    }
    for (const t of plan.tasks) {
      await itemStore.upsertItem({
        ownerId: caseId,
        ownerType: 'litigation',
        type: 'task',
        title: t.title,
        status: 'pending',
        priority: t.priority,
        date: t.deadline,
        detail: t.detail,
        groupId: group.id,
        groupName: group.name,
        templateTitle: t.title,
        subtasks: t.subtasks.map((st) => ({ id: `sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, title: st, done: false })),
        checklist: t.checklist.map((c) => ({ id: `chk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text: c, done: false })),
      })
    }
    return { ...plan, groupId: group.id }
  }

  const record = await caseStore.upsertTaskGroup(caseId, { name: stage.name })
  const group = record.taskGroups!.find((g) => g.name === stage.name)!
  for (const t of plan.tasks) {
    const updated = await caseStore.upsertTask(caseId, group.id, {
      title: t.title,
      status: 'todo',
      priority: t.priority,
      deadline: t.deadline,
      detail: t.detail,
      // 溯源标记：任务后续被改名也能认出它来自哪个模板任务。
      templateTitle: t.title,
    })
    const created = updated.taskGroups!.find((g) => g.id === group.id)!.tasks
      .find((x) => x.title === t.title)
    if (created === undefined) continue
    for (const st of t.subtasks) {
      await caseStore.upsertSubtask(caseId, group.id, created.id, { title: st, done: false })
    }
    for (const c of t.checklist) {
      await caseStore.upsertChecklist(caseId, group.id, created.id, { text: c, done: false })
    }
  }
  return { ...plan, groupId: group.id }
}

/* ---------------------------------------------------------- 推进检测 */

export interface StageSuggestion {
  type: 'expand_current' | 'expand_next' | 'advance_status' | 'fill_fields' | 'close_out'
  reason: string
  /** expand_* 时指向的阶段模板。 */
  stageId?: string
  stageName?: string
  /** expand_next 且案件状态应同步推进时的目标状态。 */
  suggestStatus?: string
  suggestStatusLabel?: string
  /** fill_fields 时缺失的字段人话清单。 */
  gaps?: string[]
  /** expand_next 附带下一阶段任务标题预览（前 5 条）。 */
  preview?: string[]
  /** expand_next 时若能定位到锚点日期（如下一阶段是开庭且已有「开庭」关键日期）。 */
  anchorDate?: string
}

export interface CaseStageSuggestions {
  caseId: string
  name: string
  status?: string
  statusLabel: string
  suggestions: StageSuggestion[]
}

/** 按案件 status 应补的登记信息。 */
const FIELD_CHECKS: Array<{ fromOrder: number; field: keyof CaseRecord; label: string }> = [
  { fromOrder: 3, field: 'court', label: '受理法院' },
  { fromOrder: 3, field: 'caseNumber', label: '案号' },
  { fromOrder: 3, field: 'filingDate', label: '立案日期' },
]

/**
 * 扫描 registry，返回每个案件（可选单个）的阶段推进建议。
 * 纯只读：不做任何写入。
 */
export function detectStageSuggestions(
  registry: CaseRegistry,
  onlyCaseId?: string,
): CaseStageSuggestions[] {
  const out: CaseStageSuggestions[] = []
  for (const record of Object.values(registry.cases)) {
    if (onlyCaseId !== undefined && record.caseId !== onlyCaseId) continue
    const statusId = (record.status ?? 'intake').trim()
    const statusDef = getLitigationStatus(statusId, record.level)
    const suggestions = suggestForCase(record, statusId)
    if (suggestions.length > 0) {
      out.push({
        caseId: record.caseId,
        name: record.name,
        status: statusId,
        statusLabel: statusDef.label,
        suggestions,
      })
    }
  }
  return out
}

function suggestForCase(record: CaseRecord, statusId: string): StageSuggestion[] {
  const suggestions: StageSuggestion[] = []
  if (statusId === 'closed') return suggestions
  if (STATUS_TO_STAGE[statusId] === undefined) return suggestions

  const statusDef = getLitigationStatus(statusId, record.level)
  const stageId = STATUS_TO_STAGE[statusId]
  const stage = getLitigationStage(stageId)!
  const group = (record.taskGroups ?? []).find((g) => g.name === stage.name)
  const tasks = group?.tasks ?? []
  const openTasks = tasks.filter((t) => t.status !== 'done')

  // 1) 信息缺口：进入立案后应有而缺失的登记字段
  const gaps = FIELD_CHECKS
    .filter((c) => statusDef.order >= c.fromOrder)
    .filter((c) => record[c.field] === undefined || record[c.field] === '')
    .map((c) => c.label)
  if (statusId === 'awaiting_trial') {
    const hasHearingKeyDate = (record.keyDates ?? []).some((k) => k.label === '开庭' && k.done !== true)
    if (!hasHearingKeyDate) gaps.push('开庭关键日期')
  }
  if (gaps.length > 0) {
    suggestions.push({
      type: 'fill_fields',
      reason: `「${statusDef.label}」阶段应补的登记信息：${gaps.join('、')}`,
      gaps,
    })
  }

  // 2) 当前阶段没有任务 → 展开当前阶段
  if (tasks.length === 0) {
    suggestions.push({
      type: 'expand_current',
      stageId,
      stageName: stage.name,
      reason: `案件处于「${statusDef.label}」但「${stage.name}」还没有任务，建议按模板展开当前阶段`,
      preview: stage.tasks.slice(0, 5).map((t) => t.title),
    })
    return suggestions
  }

  // 3) 当前阶段任务全部完成 → 展开下一阶段（或建议结案）
  if (openTasks.length === 0) {
    const next = nextStageId(stageId)
    if (next === undefined) {
      suggestions.push({
        type: 'close_out',
        reason: '「执行 · 强制执行」阶段任务已全部完成，建议跟进回款后结案归档，并将状态改为「已结案」',
      })
      return suggestions
    }
    const nextStage = getLitigationStage(next)!
    const nextStatusDef = getLitigationStatus(nextStage.status, record.level)
    suggestions.push({
      type: 'expand_next',
      stageId: next,
      stageName: nextStage.name,
      suggestStatus: nextStage.status,
      suggestStatusLabel: nextStatusDef.label,
      reason: `「${stage.name}」任务已全部完成，建议展开「${nextStage.name}」并将状态推进到「${nextStatusDef.label}」`,
      preview: nextStage.tasks.slice(0, 5).map((t) => t.title),
      anchorDate: findAnchorDate(record, next),
    })
    return suggestions
  }

  return suggestions
}

/** 为下一阶段展开寻找锚点日期：下一阶段是开庭且有「开庭」关键日期时用它。 */
function findAnchorDate(record: CaseRecord, nextStageIdValue: string): string | undefined {
  if (nextStageIdValue !== 'trial') return undefined
  const keyDate = (record.keyDates ?? []).find((k) => k.label === '开庭' && k.done !== true)
  return keyDate?.date
}
