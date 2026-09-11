/**
 * 状态变更 → 阶段任务展开策略（三态，v0.2.6）。
 *
 * 问题：状态档位（如 立案中→庭前准备）手动/工具变更后，任务树不会跟着展开
 * 对应阶段——「改状态」与「展开阶段」是两个独立动作，靠模型自觉补 apply。
 *
 * 解法：所有改状态的入口（litigation 工具 / /api/agentlex-case/update-case 路由
 * / 后续 UI）统一经 handleStatusTransition，把「状态档位 = 阶段宣告」做成硬绑定。
 * 三态（case 级字段 expandOnStatus，缺省 'confirm'）：
 *  - confirm：变更后挂起 pendingExpand（含 stageId + 任务/事件预览），由用户确认
 *    后再 resolvePendingExpand('expand') 落库；
 *  - agent：变更后同样挂起 pendingExpand（mode='agent'），交给管家按纪律自主
 *    处理（有明确依据直接展开、情况模糊先与用户确认）；
 *  - off：不挂起、不展开。
 *
 * 已展开判定以「目标阶段在该案已有任务」为准（stageTasksOf > 0），与
 * detectStageSuggestions 共用同一判定，避免重复铺。pendingExpand 随 case 记录
 * 持久化，读侧（get_case/read-case/case_health）可见，漏处理也能补。
 */

import type { CaseStore } from './store/case-store.ts'
import type { ExpandOnStatusMode, PendingExpand } from './store/types.ts'
import type { ItemStore } from '../item/store/item-store.ts'
import { stageForStatus } from '../../shared/playbook/litigation.ts'
import { checkPeriodGate } from './period-gate.ts'
import type { PeriodRule } from '../../shared/playbook/period-rules.ts'
import { isEventItem } from '../item/store/types.ts'
import {
  applyStageExpansion,
  findAnchorDate,
  stageTasksOf,
} from './stage-expansion.ts'

export type { ExpandOnStatusMode, PendingExpand }

export interface StatusTransitionResult {
  /** confirm/agent 模式且目标阶段未展开时挂起的标记。 */
  pendingExpand?: PendingExpand
  notice?: string
  /** 法定期限闸门结果（blocking=true 时案件上已落 periodGate）。 */
  periodGate?: { blocking: boolean; missing: string[]; notice: string }
}

/** 解析某案件的三态模式（case 级字段，缺省 'confirm'）。 */
export function resolveExpandMode(record: { expandOnStatus?: ExpandOnStatusMode }): ExpandOnStatusMode {
  return record.expandOnStatus ?? 'confirm'
}

/**
 * 状态档位变更入口。调用方应先把新 status/level 写入 case（updateCase），
 * 再以旧 status 调本函数——本函数只负责「该不该展开/挂起」的计算与写
 * pendingExpand，不重复更新 case。
 */
export async function handleStatusTransition(opts: {
  caseStore: CaseStore
  itemStore?: ItemStore
  caseId: string
  /** 变更前 status。 */
  prevStatus?: string
  /** 变更后 status（已写入 case）。 */
  nextStatus?: string
  /** 变更后的 level（决定选轨；缺省用 case 现值）。 */
  level?: string
  /** 三态模式；缺省解析 case.expandOnStatus，再缺省 'confirm'。 */
  mode?: ExpandOnStatusMode
  /** 生效规则集合（内置 + 本地补丁表）；缺省只用内置表。 */
  rules?: PeriodRule[]
}): Promise<StatusTransitionResult> {
  const { caseStore, itemStore, caseId } = opts
  if (opts.nextStatus === undefined || opts.nextStatus === opts.prevStatus) {
    return { notice: 'status 未变化，无需处理' }
  }
  const record = await caseStore.readCase(caseId)
  if (record === undefined) return { notice: 'case not found' }
  const mode = opts.mode ?? resolveExpandMode(record)
  const level = opts.level ?? record.level

  // 法定期限闸门（0.2.12）：**独立于阶段展开**——阶段早就展开过的案件一样可能
  // 漏登期限，所以先算闸门并落到案件字段（登记成功后由 period-service 自动清除）。
  // 闸门只提示不阻断落库：状态该改还是改，但「期限没登」必须浮出来。
  const gateResult = await syncPeriodGate(caseStore, caseId, opts.nextStatus, opts.rules)

  const clearPending = async (): Promise<void> => {
    if (record.pendingExpand !== undefined) {
      await caseStore.clearPendingExpand(caseId)
    }
  }

  // off / 已结案：不展开，清除任何挂起点。
  if (mode === 'off' || opts.nextStatus === 'closed') {
    await clearPending()
    return {
      notice: mode === 'off' ? 'expandOnStatus=off，不展开' : '已结案，无需展开',
      periodGate: gateResult,
    }
  }

  // 解析新状态对应的阶段模板（该轨内）；无模板（未知档位）→ 清除挂起。
  const stage = stageForStatus(level, opts.nextStatus)
  if (stage === undefined) {
    await clearPending()
    return { notice: `状态 ${opts.nextStatus}（level=${level ?? ''}）无对应阶段模板，不展开`, periodGate: gateResult }
  }

  // 已展开判定：目标阶段在该案已有任务 → 视为已展开，清除挂起。
  if (itemStore !== undefined) {
    const { hydrateCaseTaskGroups } = await import('./task-view.ts')
    const hydrated = await hydrateCaseTaskGroups(record, caseStore, itemStore)
    if (stageTasksOf(hydrated, stage.id, level).length > 0) {
      await clearPending()
      return { notice: `「${stage.name}」已展开，无需重复`, periodGate: gateResult }
    }
  } else if ((record.taskGroups ?? []).some((g) => g.name === stage.name && g.tasks.length > 0)) {
    await clearPending()
    return { notice: `「${stage.name}」已展开，无需重复`, periodGate: gateResult }
  }

  // 状态联动：进入庭前准备（=已立案）→ 落盘/校正「立案」时间轴事件。
  // 手动改到庭前准备且无受理通知 → 立案日期=进入阶段日期；
  // 有受理通知 → 以受理通知日期为准；后续补受理通知 → 修正立案日期。
  if (opts.nextStatus === 'pretrial' && itemStore !== undefined) {
    await syncFilingEventOnPretrial({ caseStore, itemStore, caseId })
  }

  // 未展开 → 挂起待展开标记（confirm/agent 同构，处理权在调用方纪律）。
  const pendingExpand: PendingExpand = {
    stageId: stage.id,
    stageName: stage.name,
    fromStatus: opts.prevStatus,
    toStatus: opts.nextStatus,
    mode,
    createdAt: new Date().toISOString(),
  }
  await caseStore.updateCase(caseId, { pendingExpand })
  const gateNote = gateResult.blocking ? `｜${gateResult.notice}` : ''
  return {
    pendingExpand,
    periodGate: gateResult,
    notice: `状态推进到「${opts.nextStatus}」，「${stage.name}」待展开（mode=${mode}）${gateNote}`,
  }
}

/**
 * 计算并落「法定期限闸门」到案件字段（0.2.12）。
 *
 * 阻断 → 写 periodGate；不再阻断（期限已登记）→ 清掉陈旧标记，避免界面一直挂着
 * 已经解决的告警。返回精简结果供调用方（工具返回值）内联展示。
 */
export async function syncPeriodGate(
  caseStore: CaseStore,
  caseId: string,
  status: string | undefined,
  rules?: PeriodRule[],
): Promise<{ blocking: boolean; missing: string[]; notice: string }> {
  const fresh = await caseStore.readCase(caseId)
  if (fresh === undefined) return { blocking: false, missing: [], notice: '' }
  const gate = checkPeriodGate({ ...fresh, status: status ?? fresh.status }, rules)
  if (gate.blocking) {
    await caseStore.setPeriodGate(caseId, {
      blocking: true,
      missing: gate.missing,
      notice: gate.notice,
      suggestions: gate.suggestions,
      createdAt: new Date().toISOString(),
    })
  } else if (fresh.periodGate !== undefined) {
    await caseStore.clearPeriodGate(caseId)
  }
  return { blocking: gate.blocking, missing: gate.missing, notice: gate.notice }
}

/**
 * 「立案」时间轴事件联动（v0.2.6）。
 *
 * 立案中→庭前准备 = 已立案。进入庭前准备（status=pretrial）时：
 *  - 立案事件不存在 → 落盘「立案」（date=进入本阶段的日期）；
 *  - 该案已登记「受理通知送达」事件 → 以受理通知日期作为立案日期；
 *  - 后续补充受理通知（管家 upsert_service_event）→ 同步更新立案事件日期。
 * 返回本次联动结果，供调用方（弹窗预览等）展示。
 */
export async function syncFilingEventOnPretrial(opts: {
  caseStore: CaseStore
  itemStore: ItemStore | undefined
  caseId: string
  /** 进入庭前准备的日期（缺省今天）。 */
  enteredAt?: string
}): Promise<{ ok: boolean; filingDate?: string; updated?: boolean; created?: boolean }> {
  if (opts.itemStore === undefined) return { ok: false }
  const { itemStore, caseId } = opts
  const today = opts.enteredAt ?? new Date().toISOString().slice(0, 10)
  const items = await itemStore.listItems(caseId)
  // 受理通知送达事件（管家登记后以此为准）
  const serviceEvent = items.find((i) => isEventItem(i) && i.title === '受理通知送达' && i.date)
  let filingEvent = items.find((i) => isEventItem(i) && i.title === '立案')
  if (filingEvent === undefined) {
    await itemStore.upsertItem({
      ownerId: caseId,
      ownerType: 'litigation',
      type: 'event',
      kind: 'filing',
      title: '立案',
      date: serviceEvent?.date ?? today,
      detail: serviceEvent !== undefined ? `以受理通知日期为准：${serviceEvent.date}` : '手动推进到庭前准备，视为已立案',
      status: 'done',
    })
    return { ok: true, filingDate: serviceEvent?.date ?? today, created: true }
  }
  // 已存在立案事件：若有受理通知且日期不同 → 修正立案日期
  if (serviceEvent !== undefined && serviceEvent.date !== filingEvent.date) {
    await itemStore.upsertItem({ id: filingEvent.id, date: serviceEvent.date, detail: `以受理通知日期为准：${serviceEvent.date}` })
    return { ok: true, filingDate: serviceEvent.date as string, updated: true }
  }
  return { ok: true, filingDate: filingEvent.date }
}

/** 处理挂起的待展开标记：expand 落库（任务+事件）或 ignore 仅清除。 */
export async function resolvePendingExpand(
  caseStore: CaseStore,
  itemStore: ItemStore | undefined,
  caseId: string,
  action: 'expand' | 'ignore',
): Promise<{ ok: boolean; expanded?: boolean; notice?: string; preview?: string[] }> {
  const record = await caseStore.readCase(caseId)
  if (record === undefined) throw new Error(`case not found: ${caseId}`)
  const pending = record.pendingExpand
  if (pending === undefined) return { ok: true, notice: '无待处理的阶段展开标记' }

  if (action === 'ignore') {
    await caseStore.clearPendingExpand(caseId)
    return { ok: true, notice: `已忽略「${pending.stageName}」展开（标记清除）` }
  }

  // expand：先复查该阶段是否已展开（防并发/手动作业重复铺），已展开则只清标记。
  if (itemStore !== undefined) {
    const { hydrateCaseTaskGroups } = await import('./task-view.ts')
    const hydrated = await hydrateCaseTaskGroups(record, caseStore, itemStore)
    if (stageTasksOf(hydrated, pending.stageId, record.level).length > 0) {
      await caseStore.clearPendingExpand(caseId)
      return { ok: true, notice: `「${pending.stageName}」已展开，仅清除标记` }
    }
  } else if ((record.taskGroups ?? []).some((g) => g.name === pending.stageName && g.tasks.length > 0)) {
    await caseStore.clearPendingExpand(caseId)
    return { ok: true, notice: `「${pending.stageName}」已展开，仅清除标记` }
  }

  const anchorDate = findAnchorDate(record, pending.stageId)
  const plan = await applyStageExpansion(caseStore, caseId, pending.stageId, { anchorDate }, itemStore)
  await caseStore.clearPendingExpand(caseId)
  return {
    ok: true,
    expanded: true,
    notice: `已展开「${pending.stageName}」：${plan.tasks.length} 个任务、${plan.events.length} 个事件${anchorDate !== undefined ? `（锚点 ${anchorDate}）` : ''}`,
    preview: plan.tasks.map((t) => t.title),
  }
}
