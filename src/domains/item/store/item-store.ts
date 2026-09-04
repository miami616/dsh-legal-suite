/**
 * 统一事项 store — items.json 的读写。
 *
 * 单写者 JsonFileStore，扁平列表。提供事项 CRUD + 任务组 CRUD。
 * 每个写操作广播 agentlex:registry-changed，供各面板刷新。
 */
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { JsonFileStore, clone } from '../../litigation/store/file-store.ts'
import { childId, nowIso } from '../../litigation/store/id.ts'
import type {
  Item, ItemRegistry, ItemStatus, ItemType, TaskGroup, TaskGroupRegistry,
} from './types.ts'

export type { Item, ItemRegistry, TaskGroup, TaskGroupRegistry }

/** items.json 默认文档。 */
function itemRegistryDefault(): ItemRegistry {
  return { registryVersion: '1.0', items: [] }
}

/** task-groups.json 默认文档。 */
function taskGroupRegistryDefault(): TaskGroupRegistry {
  return { registryVersion: '1.0', groups: [] }
}

/** 统一事项 store 表面。 */
export interface ItemStore {
  /* ------------------------------ items ------------------------------ */
  listItems(ownerId?: string): Promise<Item[]>
  readItem(id: string): Promise<Item | undefined>
  upsertItem(input: Partial<Item>): Promise<Item>
  deleteItem(id: string): Promise<{ deleted: boolean }>
  toggleItem(id: string): Promise<Item>
  /* --------------------------- task groups --------------------------- */
  listGroups(ownerId?: string): Promise<TaskGroup[]>
  upsertGroup(input: Partial<TaskGroup>): Promise<TaskGroup>
  deleteGroup(id: string): Promise<{ deleted: boolean }>
}

/**
 * 创建统一事项 store。
 * @param dataDir - items.json / task-groups.json 所在目录。
 * @param ctx - host ctx（可选，测试时省略）。
 */
export function createItemStore(dataDir: string, ctx?: Context): ItemStore {
  const items = new JsonFileStore<ItemRegistry>(join(dataDir, 'items.json'), itemRegistryDefault, ctx)
  const groups = new JsonFileStore<TaskGroupRegistry>(join(dataDir, 'task-groups.json'), taskGroupRegistryDefault, ctx)

  const s = (v: unknown): string | undefined => (v === undefined || v === null) ? undefined : String(v)

  return {
    async listItems(ownerId?: string): Promise<Item[]> {
      const reg = await items.read()
      const list = ownerId === undefined ? reg.items : reg.items.filter((i) => i.ownerId === ownerId)
      return clone(list)
    },

    async readItem(id: string): Promise<Item | undefined> {
      const reg = await items.read()
      const item = reg.items.find((i) => i.id === id)
      return item === undefined ? undefined : clone(item)
    },

    async upsertItem(input: Partial<Item>): Promise<Item> {
      const now = nowIso()
      let result: Item | undefined
      await items.mutate((reg) => {
        const next = clone(reg)
        const index = input.id === undefined || input.id === '' ? -1 : next.items.findIndex((i) => i.id === input.id)
        if (index >= 0) {
          const merged = { ...next.items[index]!, ...clone(input), updatedAt: now }
          next.items[index] = merged
          result = clone(merged)
        } else {
          const created: Item = {
            id: input.id !== undefined && input.id !== '' ? String(input.id) : childId('item'),
            ownerId: String(input.ownerId ?? ''),
            ownerName: s(input.ownerName),
            type: (input.type as ItemType) ?? 'task',
            title: String(input.title ?? '新事项'),
            date: s(input.date),
            time: s(input.time),
            detail: s(input.detail),
            status: (input.status as ItemStatus) ?? 'pending',
            groupId: s(input.groupId),
            groupName: s(input.groupName),
            priority: (input.priority as Item['priority']) ?? 'medium',
            subtasks: input.subtasks === undefined ? [] : clone(input.subtasks),
            checklist: input.checklist === undefined ? [] : clone(input.checklist),
            remindRules: input.remindRules === undefined ? undefined : clone(input.remindRules),
            templateTitle: s(input.templateTitle),
            createdAt: now,
            updatedAt: now,
          }
          next.items.push(created)
          result = clone(created)
        }
        next.lastUpdated = now
        return next
      }, 'tasks', input.ownerId === undefined ? undefined : String(input.ownerId), 'item-upsert')
      return result!
    },

    async deleteItem(id: string): Promise<{ deleted: boolean }> {
      let deleted = false
      let ownerId: string | undefined
      await items.mutate((reg) => {
        const index = reg.items.findIndex((i) => i.id === id)
        if (index < 0) return reg
        const next = clone(reg)
        const [removed] = next.items.splice(index, 1)
        next.lastUpdated = nowIso()
        deleted = true
        ownerId = removed?.ownerId
        return next
      }, 'tasks', ownerId, 'item-delete')
      return { deleted }
    },

    async toggleItem(id: string): Promise<Item> {
      let result: Item | undefined
      await items.mutate((reg) => {
        const item = reg.items.find((i) => i.id === id)
        if (item === undefined) throw new Error(`item not found: ${id}`)
        const next = clone(reg)
        const target = next.items.find((i) => i.id === id)!
        target.status = target.status === 'done' ? 'pending' : 'done'
        target.completedAt = target.status === 'done' ? nowIso() : undefined
        target.updatedAt = nowIso()
        next.lastUpdated = target.updatedAt
        result = clone(target)
        return next
      }, 'tasks', result?.ownerId, 'item-toggle')
      return result!
    },

    async listGroups(ownerId?: string): Promise<TaskGroup[]> {
      const reg = await groups.read()
      const list = ownerId === undefined ? reg.groups : reg.groups.filter((g) => g.ownerId === ownerId)
      return clone(list)
    },

    async upsertGroup(input: Partial<TaskGroup>): Promise<TaskGroup> {
      const now = nowIso()
      let result: TaskGroup | undefined
      await groups.mutate((reg) => {
        const next = clone(reg)
        const index = input.id === undefined || input.id === '' ? -1 : next.groups.findIndex((g) => g.id === input.id)
        if (index >= 0) {
          const merged = { ...next.groups[index]!, ...clone(input), updatedAt: now }
          next.groups[index] = merged
          result = clone(merged)
        } else {
          const created: TaskGroup = {
            id: input.id !== undefined && input.id !== '' ? String(input.id) : childId('tg'),
            ownerId: String(input.ownerId ?? ''),
            name: String(input.name ?? '新阶段'),
            order: input.order ?? next.groups.length,
            createdAt: now,
            updatedAt: now,
          }
          next.groups.push(created)
          result = clone(created)
        }
        next.lastUpdated = now
        return next
      }, 'tasks', input.ownerId === undefined ? undefined : String(input.ownerId), 'group-upsert')
      return result!
    },

    async deleteGroup(id: string): Promise<{ deleted: boolean }> {
      let deleted = false
      await groups.mutate((reg) => {
        if (reg.groups.find((g) => g.id === id) === undefined) return reg
        const next = clone(reg)
        next.groups = next.groups.filter((g) => g.id !== id)
        next.lastUpdated = nowIso()
        deleted = true
        return next
      }, 'tasks', undefined, 'group-delete')
      return { deleted }
    },
  }
}
