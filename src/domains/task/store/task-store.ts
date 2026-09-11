/**
 * 独立任务 store —— 0.2.12 起**不再是独立存储**：独立任务与案件/项目任务
 * 一样存 items.json（ownerType='standalone'，唯一真相源）。
 *
 * 旧 `standalone-tasks.json` 由一次性迁移并入 items 后退役（.legacy）。本模块
 * 保留原 API 形状（TaskItem），把读写全部代理到 itemStore——调用方无需改动，
 * 但盘上只有一处存储。
 */
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { createItemStore, type ItemStore } from '../../item/store/item-store.ts'
import { isTaskItem } from '../../item/store/types.ts'
import type { Item } from '../../item/store/types.ts'
import type { StandaloneTasksRegistry, TaskItem } from './types.ts'

export interface TaskStore {
  readRegistry(): Promise<StandaloneTasksRegistry>
  listTasks(): Promise<TaskItem[]>
  upsertTask(input: Record<string, unknown>): Promise<TaskItem>
  deleteTask(id: string): Promise<{ deleted: boolean }>
}

const s = (v: unknown): string | undefined => (v === undefined || v === null) ? undefined : String(v)

/** items 事项 → legacy TaskItem 形状（任务面板读的仍是这个形状）。 */
export function itemToTaskItem(it: Item): TaskItem {
  return {
    id: it.id,
    title: it.title,
    detail: it.detail,
    status: (it.status === 'doing' ? 'doing' : it.status === 'done' ? 'done' : 'todo') as TaskItem['status'],
    priority: (it.priority as TaskItem['priority']) ?? 'medium',
    deadline: it.date,
    time: it.time,
    source: 'standalone',
    sourceId: undefined,
    sourceName: it.ownerName,
    groupId: it.groupId,
    createdAt: it.createdAt,
    updatedAt: it.updatedAt,
  }
}

/**
 * 创建独立任务 store（items 代理版）。
 * @param dataDir - 任务域数据目录（`$DSH_HOME/agentlex/tasks`）；仅用于兼容旧签名。
 * @param ctx - host ctx。
 * @param itemStore - 统一事项 store；缺省时按同根目录自动定位 `../items`。
 */
export function createTaskStore(dataDir: string, ctx: Context, itemStore?: ItemStore): TaskStore {
  const store = itemStore ?? createItemStore(join(dataDir, '..', 'items'), ctx)

  /** 独立任务 = items 里 ownerType='standalone' 的任务侧事项。 */
  async function standaloneItems(): Promise<Item[]> {
    const all = await store.listItems()
    return all.filter((i) => (i.ownerType ?? (i.ownerId === '' || i.ownerId === undefined ? 'standalone' : 'litigation')) === 'standalone')
  }

  return {
    async readRegistry(): Promise<StandaloneTasksRegistry> {
      const tasks: Record<string, TaskItem> = {}
      for (const it of await standaloneItems()) tasks[it.id] = itemToTaskItem(it)
      return { registryVersion: '1.0', tasks, lastUpdated: undefined }
    },
    async listTasks(): Promise<TaskItem[]> {
      return (await standaloneItems()).map(itemToTaskItem)
    },
    async upsertTask(input): Promise<TaskItem> {
      const id = s(input.id)
      const existing = id === undefined || id === '' ? undefined : await store.readItem(id)
      // 独立日程（事件）与独立任务共用 items；已有事项类型优先，避免把日程写成任务。
      const type = existing !== undefined && !isTaskItem(existing) ? existing.type : 'task'
      const created = await store.upsertItem({
        ...(id === undefined || id === '' ? {} : { id }),
        ownerId: '',
        ownerType: 'standalone',
        type,
        title: s(input.title) ?? existing?.title ?? '未命名任务',
        detail: s(input.detail) ?? existing?.detail,
        date: s(input.deadline) ?? existing?.date,
        time: s(input.time) ?? existing?.time,
        priority: (s(input.priority) as Item['priority']) ?? existing?.priority,
        status: (s(input.status) === 'done' ? 'done' : s(input.status) === 'doing' || s(input.status) === 'in_progress' ? 'doing' : s(input.status) === 'todo' || s(input.status) === 'pending' ? 'pending' : existing?.status) as Item['status'],
        source: 'standalone',
      })
      return itemToTaskItem(created)
    },
    async deleteTask(id): Promise<{ deleted: boolean }> {
      const existing = await store.readItem(id)
      if (existing === undefined) throw new Error(`task not found: ${id}`)
      return store.deleteItem(id)
    },
  }
}
