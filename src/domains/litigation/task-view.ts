/**
 * 诉讼域 read-side 统一 helper —— 案件任务组（阶段）一律从 items.json 聚合。
 *
 * 0.2.2：case-registry.json 的 taskGroups 彻底下岗（不再是任何读/改的来源），
 * 案件对象上携带的 taskGroups 只作为「内存形状」，一律由本 helper 从统一事项
 * 实时重建。调用方（/read-case、/read、legacy /api/agentlex/read-case、get_case、
 * case_health、stage 检测）都经此拿任务视图，保证与写路径同源。
 *
 * 说明：这些 hydrate 只替换内存对象上的 taskGroups，绝不回写 registry。
 */
import type { CaseStore } from './store/case-store.ts'
import type { CaseRecord, CaseRegistry } from './store/types.ts'
import type { ItemStore } from '../item/store/item-store.ts'
import { buildOwnerTaskGroups, type LegacyGroup } from '../item/shape.ts'

/** 单案件：从 items 重建任务组并替换 record.taskGroups（不改盘上 registry）。 */
export async function hydrateCaseTaskGroups(
  record: CaseRecord,
  caseStore: CaseStore,
  itemStore: ItemStore,
): Promise<CaseRecord> {
  const own = await taskGroupsForCase(record.caseId, caseStore, itemStore)
  const next: CaseRecord = { ...record }
  // LegacyGroup 形状带 name+title（双写），兼容 case-store/health/stage 的
  // TaskGroup 消费（按 name 匹配）与旧 GUI（读 title）。
  if (own.length > 0 || (record.taskGroups === undefined || record.taskGroups.length === 0)) {
    next.taskGroups = own as unknown as CaseRecord['taskGroups']
  }
  return next
}

/** 整表：为每个案件重建任务组并替换（registry.taskGroups 一律忽略）。 */
export async function hydrateRegistryTaskGroups(
  registry: CaseRegistry,
  caseStore: CaseStore,
  itemStore: ItemStore,
): Promise<CaseRegistry> {
  const [groups, items] = await Promise.all([itemStore.listGroups(), itemStore.listItems()])
  const next: CaseRegistry = { ...registry, cases: {} }
  for (const [id, rec] of Object.entries(registry.cases)) {
    const own = buildOwnerTaskGroups(id, 'litigation', groups, items)
    const hydrated: CaseRecord = { ...rec }
    if (own.length > 0 || (rec.taskGroups === undefined || rec.taskGroups.length === 0)) {
      hydrated.taskGroups = own as unknown as CaseRecord['taskGroups']
    }
    next.cases[id] = hydrated
  }
  return next
}

/**
 * 从统一事项重建某案件的 legacy taskGroups 视图。
 * 兼容过渡期：items 完全没有该案件任何事项、registry 仍残留旧镜像（一次性并库
 * 前的只读窗口）时回退到 registry 副本；迁移完成后该分支恒不命中。
 */
export async function taskGroupsForCase(
  caseId: string,
  caseStore: CaseStore,
  itemStore: ItemStore,
): Promise<LegacyGroup[]> {
  const [groups, items, record] = await Promise.all([
    itemStore.listGroups(caseId),
    itemStore.listItems(caseId),
    caseStore.readCase(caseId),
  ])
  const own = buildOwnerTaskGroups(caseId, 'litigation', groups, items)
  if (own.length > 0) return own
  if (items.length === 0 && record !== undefined && Array.isArray(record.taskGroups) && record.taskGroups.length > 0) {
    return record.taskGroups as unknown as LegacyGroup[]
  }
  return own
}
