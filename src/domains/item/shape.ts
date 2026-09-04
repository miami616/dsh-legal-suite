/**
 * 统一事项 → legacy 形状的转换（timeline 事件 / task 行）。
 *
 * 旧渲染层与部分读路径仍消费 legacy 形状（TimelineEvent / taskGroups[].tasks），
 * 这里集中定义「items.json → legacy」的映射，供 /api/agentlex-item/legacy、
 * litigation /events、deadlines 引擎与 suite 聚合共用——单一事实源 = items.json。
 *
 * 2026-09-04：ownerType（litigation/nonlitigation/standalone）随行透出，suite
 * 聚合据此把同号案件/项目（如诉讼 2026-001 与非诉 2026-001）的事项正确归属，
 * 不再因裸 YYYY-NNN 撞号串数据。
 */
import type { Item } from './store/types.ts'

/** 把一条 item（event/both）映射成 legacy TimelineEvent 形状。 */
export function itemToTimelineEvent(it: Item): Record<string, unknown> {
  return {
    id: it.id,
    caseId: it.ownerId,
    caseName: it.ownerName,
    ownerType: it.ownerType ?? '',
    type: it.type === 'both' ? 'hearing' : 'case_event',
    title: it.title,
    label: it.title,
    detail: it.detail,
    date: it.date ?? '',
    time: it.time,
    status: it.status === 'done' ? 'completed' : it.status === 'cancelled' ? 'cancelled' : 'pending',
    remindRules: it.remindRules ?? [],
    createdAt: it.createdAt,
    updatedAt: it.updatedAt,
  }
}

/** 把一条 item（task/both）映射成 legacy taskGroups[].tasks 行。 */
export function itemToLegacyTask(it: Item): Record<string, unknown> {
  return {
    id: it.id,
    ownerId: it.ownerId,
    ownerType: it.ownerType ?? '',
    caseId: it.ownerId,
    title: it.title,
    detail: it.detail,
    deadline: it.date,
    time: it.time,
    priority: it.priority ?? 'medium',
    status: it.status === 'done' ? 'done' : it.status === 'doing' ? 'in_progress' : 'todo',
    subtasks: it.subtasks ?? [],
    checklist: it.checklist ?? [],
    createdAt: it.createdAt,
    updatedAt: it.updatedAt,
  }
}

/** item legacy 任务组（带 ownerType 供聚合归属）。 */
export interface LegacyGroup {
  ownerId: string
  ownerType?: string
  id: string
  title: string
  order: number
  tasks: unknown[]
}
