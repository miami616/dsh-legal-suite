/**
 * 级联删除 —— 删除案件/项目时清理全部关联数据。
 *
 * 0.2.0 统一事项模型迁移后，一个案件的“身体”分布在四个文件里：
 *   - case-registry.json  案件记录（caseStore）
 *   - items.json          时间轴事件 + 任务（type=event/task/both，ownerId=caseId）
 *   - task-groups.json    任务组（ownerId=caseId）
 *   - case-timeline.json  旧版时间轴事件（历史孤儿，读路径兜底）
 *   - schedules.json      旧版日程
 *
 * 备忘录 #3：删除案件后旧编号的 timeline/schedule 记录仍残留在列表中。原因是
 * 各删除入口只删 caseStore.deleteCase（case-registry 一行），其余文件无人清理。
 * 本模块把四类存储串成一次原子语义的级联删除，供浏览器删除 / HTTP 工具 /
 * agent 工具三类入口统一复用。
 */

import type { CaseStore } from './store/case-store.ts'
import type { TimelineStore } from './store/timeline-store.ts'
import type { ScheduleStore } from './store/schedule-store.ts'
import type { ItemStore } from '../item/store/item-store.ts'

export interface CascadeDeleteDeps {
  caseStore: CaseStore
  timelineStore: TimelineStore
  scheduleStore: ScheduleStore
  /** 统一事项 store（装配层实例，带 ctx 才能广播 change 事件）。 */
  itemStore: ItemStore
  /** 是否同时清理旧版 case-timeline.json/schedules.json 里同 caseId 的记录。 */
  purgeLegacy?: boolean
}

/**
 * 删除一个案件并级联清理其全部关联数据。
 * 返回 { deleted, removed: { items, groups, timeline, schedules } }。
 */
export async function cascadeDeleteCase(
  deps: CascadeDeleteDeps,
  caseId: string,
): Promise<{ deleted: boolean; removed: Record<string, number> }> {
  const removed: Record<string, number> = { items: 0, groups: 0, timeline: 0, schedules: 0 }
  const caseResult = await deps.caseStore.deleteCase(caseId)
  if (!caseResult.deleted) {
    // 案件本就不存在——仍清理残留的孤儿数据（幂等）。
  }

  // 1) items.json：type=event/task/both 且 ownerId=caseId 且 ownerType=litigation
  //   （避免误删同号非诉项目的事项——2026-09-04 撞号修复）。
  const items = await deps.itemStore.listItems(caseId)
  for (const item of items) {
    if ((item.ownerType ?? 'litigation') !== 'litigation') continue
    const r = await deps.itemStore.deleteItem(item.id)
    if (r.deleted) removed.items++
  }

  // 2) task-groups.json：ownerId=caseId 且 ownerType=litigation
  const groups = await deps.itemStore.listGroups(caseId)
  for (const g of groups) {
    if ((g.ownerType ?? 'litigation') !== 'litigation') continue
    const r = await deps.itemStore.deleteGroup(g.id)
    if (r.deleted) removed.groups++
  }

  // 3) 旧版 case-timeline.json / schedules.json（list_events / 期限提醒的读取源）
  if (deps.purgeLegacy !== false) {
    const legacyEvents = await deps.timelineStore.listEvents(caseId)
    for (const e of legacyEvents) {
      const r = await deps.timelineStore.deleteEvent(e.id)
      if (r.deleted) removed.timeline++
    }
    const legacySchedules = await deps.scheduleStore.listItems(caseId)
    for (const s of legacySchedules) {
      const r = await deps.scheduleStore.deleteItem(s.id)
      if (r.deleted) removed.schedules++
    }
  }

  return { deleted: true, removed }
}

/**
 * 删除一个非诉项目并级联清理 items / task-groups。
 * 非诉项目的 timeline/schedule 也统一走 items，因此只需清理 items + groups。
 */
export async function cascadeDeleteProject(
  projectStore: {
    deleteProject(projectId: string): Promise<{ deleted: boolean }>
  },
  itemStore: ItemStore,
  projectId: string,
): Promise<{ deleted: boolean; removed: Record<string, number> }> {
  const removed: Record<string, number> = { items: 0, groups: 0 }
  await projectStore.deleteProject(projectId)
  const items = await itemStore.listItems(projectId)
  for (const item of items) {
    if ((item.ownerType ?? 'nonlitigation') !== 'nonlitigation') continue
    const r = await itemStore.deleteItem(item.id)
    if (r.deleted) removed.items++
  }
  const groups = await itemStore.listGroups(projectId)
  for (const g of groups) {
    if ((g.ownerType ?? 'nonlitigation') !== 'nonlitigation') continue
    const r = await itemStore.deleteGroup(g.id)
    if (r.deleted) removed.groups++
  }
  return { deleted: true, removed }
}
