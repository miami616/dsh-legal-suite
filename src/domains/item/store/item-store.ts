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
  Item, ItemChecklist, ItemRegistry, ItemStatus, ItemSubtask, ItemType, TaskGroup, TaskGroupRegistry,
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
  /* ------------------------------ 任务子项（subtasks/checklist） ------------------------------ */
  /**
   * 以任务（type=task/both 的 item）为容器更新子任务/检查项。这是工具层
   * upsert_subtask / upsert_check / toggle_check 的统一写入口：任务在 items.json，
   * 其 subtasks/checklist 也存 items 上，不再回写 case-registry 的 taskGroups
   * （0.2.0 split-brain：task 写 items 而 checklist 找 case-registry → not found）。
   */
  addSubtask(taskId: string, input: { id?: string; title: string; deadline?: string; done?: boolean }): Promise<Item>
  updateSubtask(taskId: string, subtaskId: string, patch: Partial<ItemSubtask>): Promise<Item>
  deleteSubtask(taskId: string, subtaskId: string): Promise<{ deleted: boolean }>
  addChecklist(taskId: string, input: { id?: string; text: string; done?: boolean }): Promise<Item>
  toggleChecklist(taskId: string, checklistId: string, done?: boolean): Promise<Item>
  deleteChecklist(taskId: string, checklistId: string): Promise<{ deleted: boolean }>
  /** 内部：定位 task item 并就地变更 subtasks/checklist（实现细节，接口暴露以便自调用）。 */
  mutateTaskItems(taskId: string, mutateFn: (task: Item) => { item?: Item; deleted?: boolean }): Promise<Item | { deleted: boolean }>
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
            ownerType: input.ownerType as Item['ownerType'],
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

    /* ---------------- 任务子项（subtasks / checklist） ---------------- */

    /** 定位一个 item 并对其 subtasks/checklist 做就地变更（写回 items.json）。 */
    async mutateTaskItems(
      taskId: string,
      mutateFn: (task: Item) => { item?: Item; deleted?: boolean },
    ): Promise<Item | { deleted: boolean }> {
      let result: Item | { deleted: boolean } | undefined
      await items.mutate((reg) => {
        const task = reg.items.find((i) => i.id === taskId)
        if (task === undefined) throw new Error(`task not found: ${taskId}`)
        if (task.type === 'event') throw new Error(`item is not a task: ${taskId}`)
        const next = clone(reg)
        const target = next.items.find((i) => i.id === taskId)!
        const outcome = mutateFn(target)
        if (outcome.deleted === true) {
          const removed = next.items.find((i) => i.id === taskId)
          next.items = next.items.filter((i) => i.id !== taskId)
          result = { deleted: true }
          next.lastUpdated = removed?.updatedAt ?? nowIso()
          return next
        }
        target.updatedAt = nowIso()
        next.lastUpdated = target.updatedAt
        result = clone(outcome.item ?? target)
        return next
      }, 'tasks', taskId, 'task-children-mutate')
      return result!
    },

    async addSubtask(taskId: string, input: { id?: string; title: string; deadline?: string; done?: boolean }): Promise<Item> {
      const now = nowIso()
      const sid = input.id ?? childId('sub')
      return this.mutateTaskItems(taskId, (task) => {
        const subtasks = Array.isArray(task.subtasks) ? [...task.subtasks] : []
        const existingIdx = subtasks.findIndex((st) => st.id === sid)
        if (existingIdx >= 0) {
          const row = { ...subtasks[existingIdx]! }
          if (input.title !== undefined) row.title = String(input.title)
          if (input.done !== undefined) row.done = input.done === true
          if (input.deadline !== undefined) row.deadline = input.deadline === '' ? undefined : input.deadline
          row.updatedAt = now
          subtasks[existingIdx] = row
        } else {
          subtasks.push({
            id: sid,
            title: String(input.title ?? '子任务'),
            done: input.done === true,
            deadline: input.deadline === undefined ? undefined : String(input.deadline),
            createdAt: now,
            updatedAt: now,
          })
        }
        task.subtasks = subtasks
        return { item: task }
      }) as Promise<Item>
    },

    async updateSubtask(taskId: string, subtaskId: string, patch: Partial<ItemSubtask>): Promise<Item> {
      return this.mutateTaskItems(taskId, (task) => {
        const subtasks = Array.isArray(task.subtasks) ? [...task.subtasks] : []
        const idx = subtasks.findIndex((st) => st.id === subtaskId)
        if (idx < 0) throw new Error(`subtask not found: ${subtaskId}`)
        subtasks[idx] = { ...subtasks[idx]!, ...clone(patch), id: subtaskId, updatedAt: nowIso() }
        task.subtasks = subtasks
        return { item: task }
      }) as Promise<Item>
    },

    async deleteSubtask(taskId: string, subtaskId: string): Promise<{ deleted: boolean }> {
      const outcome = await this.mutateTaskItems(taskId, (task) => {
        const before = Array.isArray(task.subtasks) ? task.subtasks.length : 0
        task.subtasks = (task.subtasks ?? []).filter((st) => st.id !== subtaskId)
        if ((task.subtasks?.length ?? 0) === before) throw new Error(`subtask not found: ${subtaskId}`)
        return { item: task }
      })
      return { deleted: (outcome as { deleted: boolean }).deleted === true }
    },

    async addChecklist(taskId: string, input: { id?: string; text: string; done?: boolean }): Promise<Item> {
      const now = nowIso()
      const cid = input.id ?? childId('chk')
      return this.mutateTaskItems(taskId, (task) => {
        const checklist = Array.isArray(task.checklist) ? [...task.checklist] : []
        const existingIdx = checklist.findIndex((c) => c.id === cid)
        if (existingIdx >= 0) {
          const row = { ...checklist[existingIdx]! }
          if (input.text !== undefined) row.text = String(input.text)
          if (input.done !== undefined) row.done = input.done === true
          row.updatedAt = now
          checklist[existingIdx] = row
        } else {
          checklist.push({
            id: cid,
            text: String(input.text ?? '检查项'),
            done: input.done === true,
            createdAt: now,
            updatedAt: now,
          })
        }
        task.checklist = checklist
        return { item: task }
      }) as Promise<Item>
    },

    async toggleChecklist(taskId: string, checklistId: string, done?: boolean): Promise<Item> {
      return this.mutateTaskItems(taskId, (task) => {
        const checklist = Array.isArray(task.checklist) ? [...task.checklist] : []
        const idx = checklist.findIndex((c) => c.id === checklistId)
        if (idx < 0) throw new Error(`checklist item not found: ${checklistId}`)
        const target = checklist[idx]!
        target.done = done === undefined ? !target.done : done === true
        target.updatedAt = nowIso()
        checklist[idx] = target
        task.checklist = checklist
        return { item: task }
      }) as Promise<Item>
    },

    async deleteChecklist(taskId: string, checklistId: string): Promise<{ deleted: boolean }> {
      const outcome = await this.mutateTaskItems(taskId, (task) => {
        const before = Array.isArray(task.checklist) ? task.checklist.length : 0
        task.checklist = (task.checklist ?? []).filter((c) => c.id !== checklistId)
        if ((task.checklist?.length ?? 0) === before) throw new Error(`checklist item not found: ${checklistId}`)
        return { item: task }
      })
      return { deleted: (outcome as { deleted: boolean }).deleted === true }
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
            ownerType: input.ownerType as TaskGroup['ownerType'],
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
