/**
 * 非诉域 read-side 统一 helper —— 项目任务组（阶段）一律从 items.json 聚合。
 *
 * 0.2.2：project-registry.json 的 taskGroups 彻底下岗（不再是任何读/改的来源）。
 * 项目任务从统一事项（ownerType=nonlitigation）实时重建，与诉讼域对称。
 */
import type { ProjectStore } from './store/project-store.ts'
import type { ProjectRecord, ProjectRegistry } from './store/types.ts'
import type { ItemStore } from '../item/store/item-store.ts'
import { buildOwnerTaskGroups, type LegacyGroup } from '../item/shape.ts'

/** 单项目：从 items 重建任务组并替换 record.taskGroups（不改盘上 registry）。 */
export async function hydrateProjectTaskGroups(
  record: ProjectRecord,
  itemStore: ItemStore,
): Promise<ProjectRecord> {
  const [groups, items] = await Promise.all([itemStore.listGroups(record.projectId), itemStore.listItems(record.projectId)])
  const own = buildOwnerTaskGroups(record.projectId, 'nonlitigation', groups, items)
  const next: ProjectRecord = { ...record }
  if (own.length > 0 || (record.taskGroups === undefined || record.taskGroups.length === 0)) {
    next.taskGroups = own as unknown as ProjectRecord['taskGroups']
  }
  return next
}

/** 整表：为每个项目重建任务组并替换（registry.taskGroups 一律忽略）。 */
export async function hydrateRegistryProjectTaskGroups(
  registry: ProjectRegistry,
  itemStore: ItemStore,
): Promise<ProjectRegistry> {
  const [groups, items] = await Promise.all([itemStore.listGroups(), itemStore.listItems()])
  const next: ProjectRegistry = { ...registry, projects: {} }
  for (const [id, rec] of Object.entries(registry.projects)) {
    const own = buildOwnerTaskGroups(id, 'nonlitigation', groups, items)
    const hydrated: ProjectRecord = { ...rec }
    if (own.length > 0 || (rec.taskGroups === undefined || rec.taskGroups.length === 0)) {
      hydrated.taskGroups = own as unknown as ProjectRecord['taskGroups']
    }
    next.projects[id] = hydrated
  }
  return next
}

/** 保留类型引用（项目本身带 ownerId=projectId 的 group 查壳用）。 */
export type { LegacyGroup }
