/**
 * 阶段模板展开 + 阶段推进检测（诉讼域）。
 *
 * 两个能力：
 *
 * 1. planStageExpansion / applyStageExpansion —— 把 playbook 里的阶段模板
 *    （STAGE_TRACKS / SIDE_STAGES）实例化到具体案件。模板只提供**骨架**：
 *    标准动作的标题、优先级、交付提示与相对锚点的提前量；管家可用 only/skip
 *    裁剪，落地后仍可按案情增删改。规范约束的是「标准动作怎么说」，不是
 *    「不许有模板外的任务」。
 *
 *    v0.3.0：展开按案件自适应——
 *    - 选轨：按案件 level（一审/二审/再审/执行/劳动仲裁/商事仲裁/刑事）取该轨模板；
 *    - 选阶段：按案件 status 命中轨内阶段；status 为空回落 intake；
 *    - 裁任务：模板任务按 我方身份(side) + 案件类型(appliesTo) 过滤；
 *      条件任务(optional) 默认不展开，只有 only 点名才建。
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
  STAGE_TRACKS,
  SIDE_STAGES,
  LITIGATION_STAGES,
  getLitigationStage,
  getLitigationStatus,
  getStageOnTrack,
  stageForStatus,
  stageOrderOnTrack,
  templateTaskApplies,
  daysBefore,
  type StageTemplate,
  type TaskTemplate,
} from '../../shared/playbook/litigation.ts'
import type { CaseStore } from './store/case-store.ts'
import type { CaseRecord, CaseRegistry, CaseTask } from './store/types.ts'

/* ------------------------------------------------------------ 阶段映射 */

/**
 * 状态 id → 该轨内的阶段模板 id。
 * 一审：intake/pre_filing 共用诉前模板；execution 兼容档（存量）映射到执行轨立案模板。
 * 由于各轨 status 集合不同，按轨查 stageForStatus 最稳，这里仅保留
 * STATUS_TO_STAGE 兼容导出（一审主轨），并新增按案件的 resolveStageForCase。
 */
export const STATUS_TO_STAGE: Record<string, string> = {
  intake: 'pre_filing',
  pre_filing: 'pre_filing',
  filing: 'filing',
  pretrial: 'pretrial',
  awaiting_trial: 'pretrial',
  post_trial: 'post_trial',
  execution: 'exec_apply',
  appeal_window: 'post_trial',
  second_instance: 'post_trial',
}

/**
 * 案件 → 当前应展开/体检的阶段模板。
 * 按 record.level 选轨 → 按 status 取轨内阶段；未命中（如 closed、旁路）返回 undefined。
 * level 为空时按一审轨解释。
 */
export function resolveStageForCase(record: Pick<CaseRecord, 'level' | 'status'>): StageTemplate | undefined {
  const statusId = (record.status ?? 'intake').trim()
  if (statusId === 'closed') return undefined
  // intake（收案）与诉前共用诉前模板——只对一审轨成立；其他轨 intake 无独立模板，
  // 展开/体检时按该轨第一个有任务的阶段处理。
  const ladder = getLitigationStatus(statusId, record.level)
  const stage = stageForStatus(record.level, statusId)
  if (stage !== undefined) return stage
  // 兜底：该轨第一个线性阶段（intake 未单列模板的案件）。
  return stageOrderOnTrack(record.level).find((s) => s.status !== 'closed' && s.status !== '')
}

/** 取某案件轨内的阶段推进序列。 */
export function stageOrderForCase(record: Pick<CaseRecord, 'level'>): StageTemplate[] {
  return stageOrderOnTrack(record.level)
}

/** 下一阶段模板 id（同轨内线性顺序）。 */
export function nextStageOnTrack(level: string | undefined | null, stageId: string): string | undefined {
  const order = stageOrderOnTrack(level)
  const idx = order.findIndex((s) => s.id === stageId)
  return idx >= 0 && idx + 1 < order.length ? order[idx + 1]!.id : undefined
}

/** 兼容导出：一审轨内的阶段推进顺序。 */
export const STAGE_ORDER: string[] = STAGE_TRACKS['一审'].map((s) => s.id)

/** 兼容导出：旧 nextStageId（一审轨）。 */
export function nextStageId(stageId: string): string | undefined {
  return nextStageOnTrack('一审', stageId)
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
  /** 命中的轨道（level）。 */
  level?: string
  groupName: string
  dryRun: boolean
  anchorDate?: string
  /** 将创建的任务（已扣除已存在、被过滤与不适用者）。 */
  tasks: PlannedTask[]
  /** 已存在、被跳过的标题。 */
  skippedExisting: string[]
  /** 被 only/skip/条件/阵营/类型 过滤掉的标题。 */
  skippedByFilter: string[]
  /** 阶段模板对应的标准状态与案件当前状态不一致时的提示。 */
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
  const record = await caseStore.readCase(caseId)
  if (record === undefined) throw new Error(`case not found: ${caseId}`)
  // 选轨 + 选阶段：
  // - stageId 显式给定 → 必须是有效 id（跨轨全集查找），否则报错而不是静默回退；
  // - stageId 为空（''）→ 按案件 level/status 自动解析「当前应展开的阶段」。
  let stage: StageTemplate | undefined
  if (stageId !== undefined && stageId !== '') {
    stage = getStageOnTrack(record.level, stageId) ?? getLitigationStage(stageId)
    if (stage === undefined) {
      const order = stageOrderForCase(record).map((s) => s.id).join(' / ')
      throw new Error(`unknown stageId: ${stageId}（案件 ${caseId} level=${record.level ?? ''} 轨内可选：${order}）`)
    }
  } else {
    stage = resolveStageForCase(record)
    if (stage === undefined) throw new Error(`案件 ${caseId}（status=${record.status ?? ''}, level=${record.level ?? ''}）无法解析当前应展开的阶段`)
  }
  return planStageOnRecord(record, stage, opts, itemStore)
}

/** 按案件记录 + 已解析阶段展开（体检/建议共用同一实现）。 */
export async function planStageOnRecord(
  record: CaseRecord,
  stage: StageTemplate,
  opts: StageExpandOptions = {},
  itemStore?: import('../item/store/item-store.ts').ItemStore,
): Promise<StagePlan> {
  const warnings: string[] = []
  // 0.2.2：任务组/任务已存在性判断一律读 items（写路径唯一真相源），不再从
  // case-registry 的 taskGroups 判断（registry 副本已下岗）。
  let existingTitles: Set<string>
  let existingTemplateTitles: Set<string>
  if (itemStore !== undefined) {
    const { buildOwnerTaskGroups } = await import('../item/shape.ts')
    const [groups, items] = await Promise.all([itemStore.listGroups(record.caseId), itemStore.listItems(record.caseId)])
    const own = buildOwnerTaskGroups(record.caseId, 'litigation', groups, items)
    const stageGroup = own.find((g) => g.name === stage.name)
    const rows = stageGroup?.tasks ?? []
    existingTitles = new Set(rows.map((t) => String((t as { title?: unknown }).title ?? '')))
    existingTemplateTitles = new Set(
      rows.map((t) => String((t as { templateTitle?: unknown }).templateTitle ?? '')).filter((v) => v !== ''),
    )
    // 管家直写 upsert_task 可能把模板任务落在「未分组」/自建组：标题对不上阶段组，
    // 但 templateTitle 仍属于本阶段模板 → 视为已展开过，避免重复铺（备忘录 #10）。
    if (existingTemplateTitles.size > 0 || rows.length === 0) {
      const stageTitleSet = new Set(stage.tasks.map((x) => x.title))
      for (const g of own) {
        if (g.name === stage.name) continue
        for (const t of g.tasks) {
          const tt = String((t as { templateTitle?: unknown }).templateTitle ?? '')
          if (tt !== '' && stageTitleSet.has(tt)) existingTemplateTitles.add(tt)
        }
      }
    }
  } else {
    const legacyGroup = (record.taskGroups ?? []).find((g) => g.name === stage.name)
    const rows = legacyGroup?.tasks ?? []
    existingTitles = new Set(rows.map((t) => t.title))
    existingTemplateTitles = new Set(
      rows.map((t) => t.templateTitle).filter((v): v is string => v !== undefined && v !== ''),
    )
    const stageTitleSet = new Set(stage.tasks.map((x) => x.title))
    for (const g of record.taskGroups ?? []) {
      if (g.name === stage.name) continue
      for (const t of g.tasks) {
        if (t.templateTitle !== undefined && t.templateTitle !== '' && stageTitleSet.has(t.templateTitle)) {
          existingTemplateTitles.add(t.templateTitle)
        }
      }
    }
  }
  const only = opts.only === undefined ? undefined : new Set(opts.only)
  const skip = new Set(opts.skip ?? [])
  if (opts.anchorDate === undefined) {
    const withLead = stage.tasks.filter((t) => t.leadDays !== undefined)
    if (withLead.length > 0) {
      warnings.push(`未提供 anchorDate，${withLead.length} 个任务将不带 deadline：${withLead.map((t) => t.title).join('、')}`)
    }
  }

  const ctx = { type: record.type, ourSide: record.ourSide ?? record.parties?.ourSide }
  const tasks: PlannedTask[] = []
  const skippedExisting: string[] = []
  const skippedByFilter: string[] = []
  for (const t of stage.tasks) {
    if (only !== undefined && !only.has(t.title)) { skippedByFilter.push(t.title); continue }
    if (skip.has(t.title)) { skippedByFilter.push(t.title); continue }
    // 条件任务（备忘录 #10）：optional 任务只有被 only 显式点名才展开。
    if (t.optional === true && only === undefined) {
      skippedByFilter.push(t.title)
      continue
    }
    // v0.3.0 自适应：阵营/案件类型不适用 → 不展开（即便 only 点名也尊重 appliesTo，
    // 但 only 点名可覆盖 side 约束——管家显式点名意味着确实要做）。
    if (!templateTaskApplies(t, ctx) && !(only !== undefined && only.has(t.title))) {
      skippedByFilter.push(t.title)
      continue
    }
    if (existingTitles.has(t.title) || existingTemplateTitles.has(t.title)) {
      skippedExisting.push(t.title)
      continue
    }
    tasks.push(planTask(t, opts.anchorDate))
  }

  const plan: StagePlan = {
    caseId: record.caseId,
    stageId: stage.id,
    level: stage.level,
    groupName: stage.name,
    dryRun: opts.dryRun === true,
    anchorDate: opts.anchorDate,
    tasks,
    skippedExisting,
    skippedByFilter,
    warnings,
  }
  // 阶段模板自带的标准状态与案件现状不一致 → 提示管家可考虑推进 status
  if (record.status !== undefined && record.status !== '' && record.status !== stage.status && stage.status !== '') {
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
  const stage = getLitigationStage(plan.stageId)!

  // 统一事项模型：任务写 items.json（type=task，带 groupId）。
  if (itemStore !== undefined) {
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

  const statusDef = getLitigationStatus(statusId, record.level)
  // 该轨当前状态对应的阶段（如 一审·庭前准备 / 劳动仲裁·庭前准备）。
  const stage = resolveStageForCase(record)
  if (stage === undefined) return suggestions

  const uniqueTasks = stageTasksOf(record, stage.id, record.level)
  const openTasks = uniqueTasks.filter((t) => t.status !== 'done')

  // 1) 信息缺口：进入立案后应有而缺失的登记字段
  const gaps = FIELD_CHECKS
    .filter((c) => statusDef.order >= c.fromOrder)
    .filter((c) => record[c.field] === undefined || record[c.field] === '')
    .map((c) => c.label)
  if (statusId === 'pretrial' || statusId === 'trial_c') {
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
  if (uniqueTasks.length === 0) {
    suggestions.push({
      type: 'expand_current',
      stageId: stage.id,
      stageName: stage.name,
      reason: `案件处于「${statusDef.label}」但「${stage.name}」还没有任务，建议按模板展开当前阶段`,
      preview: expandablePreview(stage, record),
    })
    return suggestions
  }

  // 3) 当前阶段任务全部完成 → 展开下一阶段（或建议结案）
  if (openTasks.length === 0) {
    const next = nextStageOnTrack(record.level, stage.id)
    if (next === undefined) {
      suggestions.push({
        type: 'close_out',
        reason: `「${stage.name}」阶段任务已全部完成，建议结案归档，并将状态改为「已结案」`,
      })
      return suggestions
    }
    const nextStage = getStageOnTrack(record.level, next) ?? getLitigationStage(next)
    if (nextStage === undefined) return suggestions
    const nextStatusDef = getLitigationStatus(nextStage.status, record.level)
    const preview = expandablePreview(nextStage, record)
    suggestions.push({
      type: 'expand_next',
      stageId: next,
      stageName: nextStage.name,
      suggestStatus: nextStage.status,
      suggestStatusLabel: nextStatusDef.label,
      reason: `「${stage.name}」任务已全部完成，建议展开「${nextStage.name}」并将状态推进到「${nextStatusDef.label}」`,
      preview,
      anchorDate: findAnchorDate(record, next),
    })
    return suggestions
  }

  return suggestions
}

/** 预览标题：默认展开会创建的任务（optional 需 only 点名；含阵营/类型过滤）。 */
function expandablePreview(stage: StageTemplate, record: Pick<CaseRecord, 'type' | 'ourSide' | 'parties'>): string[] {
  const ctx = { type: record.type, ourSide: record.ourSide ?? record.parties?.ourSide }
  return stage.tasks
    .filter((t) => t.optional !== true && templateTaskApplies(t, ctx))
    .slice(0, 5)
    .map((t) => t.title)
}

/**
 * 取某案件某阶段的实际任务（含散落在别组但 templateTitle 属本阶段的，
 * 备忘录 #10）。health 的 stage 进度与 suggestForCase 共用同一判定。
 * level 用于跨轨同名阶段（如 pretrial 一审/劳动仲裁）精确取模板。
 */
export function stageTasksOf(record: CaseRecord, stageId: string, level?: string): CaseTask[] {
  const stage = level !== undefined ? (getStageOnTrack(level, stageId) ?? getLitigationStage(stageId)) : getLitigationStage(stageId)
  if (stage === undefined) return []
  const stageTitles = new Set(stage.tasks.map((t) => t.title))
  const taskGroups = (record.taskGroups ?? []) as Array<{ name: string; tasks: CaseTask[] }>
  const stageGroup = taskGroups.find((g) => g.name === stage.name)
  const stray = taskGroups
    .filter((g) => g.name !== stage.name)
    .flatMap((g) => g.tasks)
    .filter((t) => t.templateTitle !== undefined && t.templateTitle !== '' && stageTitles.has(t.templateTitle))
  const all = [...(stageGroup?.tasks ?? []), ...stray]
  const seen = new Set<string>()
  return all.filter((t) => {
    const key = t.id ?? t.title
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** 为下一阶段展开寻找锚点日期：下一阶段含开庭动作且有「开庭」关键日期时用它。 */
function findAnchorDate(record: CaseRecord, nextStageIdValue: string): string | undefined {
  if (nextStageIdValue !== 'pretrial' && nextStageIdValue !== 'cr_trial' && nextStageIdValue !== 'retrial_trial' && nextStageIdValue !== 'appellate') return undefined
  const keyDate = (record.keyDates ?? []).find((k) => k.label === '开庭' && k.done !== true)
  return keyDate?.date
}
