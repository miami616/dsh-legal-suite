/**
 * 统一事项 store — items.json 的读写（单文件唯一真相源，0.2.2）。
 *
 * 0.2.2 起任务组壳并入 items.json 同一文件：文档 = { groups, items }。
 * 兼容读入 0.2.2 之前的旧 items.json（只有 items、无 groups 键）：每次读写
 * 先归一化，保证形状恒为 { groups: [], items: [] }。
 * 启动时自动迁移旧 task-groups.json → items.json.groups（按 id 合并，已存在
 * 优先），成功后把旧文件退役改名（task-groups.json.legacy），此后不再读取。
 * 每个写操作广播 agentlex:registry-changed，供各面板刷新。
 */
import { readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { JsonFileStore, clone } from '../../litigation/store/file-store.ts'
import { childId, nowIso } from '../../litigation/store/id.ts'
import type {
  Item, ItemChecklist, ItemRegistry, ItemStatus, ItemSubtask, ItemType, TaskGroup, TaskGroupRegistry,
} from './types.ts'

export type { Item, ItemRegistry, TaskGroup, TaskGroupRegistry }

/** items.json 默认文档（单文件：组壳 + 事项正文）。 */
function itemRegistryDefault(): ItemRegistry {
  return { registryVersion: '1.0', groups: [], items: [] }
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
   * upsert_subtask / upsert_check / toggle_check 的统一写入口：任务与子项都存
   * items.json，不触碰 case-registry（0.2.0 split-brain：task 写 items 而
   * checklist 找 case-registry → not found）。
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
 * 创建统一事项 store（单文件 items.json）。
 * @param dataDir - items.json 所在目录。
 * @param ctx - host ctx（可选，测试时省略）。
 */
export function createItemStore(dataDir: string, ctx?: Context): ItemStore {
  const file = join(dataDir, 'items.json')
  const store = new JsonFileStore<ItemRegistry>(file, itemRegistryDefault, ctx)
  /** 旧版独立任务组文件（task-groups.json）——退役迁移源。 */
  const legacyGroupsFile = join(dataDir, 'task-groups.json')

  const s = (v: unknown): string | undefined => (v === undefined || v === null) ? undefined : String(v)

  /**
   * 归一化读到的文档：兼容 0.2.2 之前的旧 items.json（只有 items、无 groups 键），
   * 保证任何读/写都看到完整的新形状 { groups, items }。
   */
  function normalize(reg: ItemRegistry): ItemRegistry {
    const any = reg as ItemRegistry & { groups?: unknown; items?: unknown }
    const out: ItemRegistry = { ...reg }
    out.groups = Array.isArray(any.groups) ? any.groups as TaskGroup[] : []
    out.items = Array.isArray(any.items) ? any.items as Item[] : []
    return out
  }

  /** 读取 + 归一化（每次读都确保两个数组存在）。 */
  async function readNormalized(): Promise<ItemRegistry> {
    return normalize(await store.read())
  }

  /* ------------------------- 旧 task-groups.json 退役迁移 ------------------------- */
  let migratePromise: Promise<void> | null = null
  const ensureMigrated = (): Promise<void> => {
    if (migratePromise === null) migratePromise = migrateLegacyGroups()
    return migratePromise
  }

  async function migrateLegacyGroups(): Promise<void> {
    let legacyRaw: string
    try {
      legacyRaw = await readFile(legacyGroupsFile, 'utf8')
    } catch (error) {
      // 无旧文件（全新安装）→ 无需迁移。
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      console.warn('[item-store] 读取旧 task-groups.json 失败:', error)
      return
    }
    let legacy: TaskGroupRegistry
    try {
      legacy = JSON.parse(legacyRaw) as TaskGroupRegistry
    } catch {
      console.warn('[item-store] 旧 task-groups.json 解析失败，跳过迁移（原文件保留）')
      return
    }
    const legacyGroups = Array.isArray(legacy?.groups) ? legacy.groups : []
    if (legacyGroups.length === 0) {
      // 空壳旧文件：直接退役，不落库。
      try { await rename(legacyGroupsFile, `${legacyGroupsFile}.legacy`) } catch { /* best-effort */ }
      return
    }
    try {
      await store.mutate((rawReg) => {
        const reg = normalize(rawReg)
        const next = clone(reg)
        const byId = new Map(next.groups.map((g) => [g.id, g]))
        for (const g of legacyGroups) {
          if (g === undefined || g === null || g.id === undefined || g.id === '') continue
          const existing = byId.get(g.id)
          if (existing !== undefined) {
            // 已存在优先；旧组缺 ownerType（早前写入）时补上。
            if (existing.ownerType === undefined && g.ownerType !== undefined) existing.ownerType = g.ownerType
            if (existing.updatedAt === undefined && g.updatedAt !== undefined) existing.updatedAt = g.updatedAt
          } else {
            const row: TaskGroup = {
              id: String(g.id),
              ownerId: String(g.ownerId ?? ''),
              ownerType: g.ownerType as TaskGroup['ownerType'],
              name: String(g.name ?? '新阶段'),
              order: typeof g.order === 'number' ? g.order : next.groups.length,
              createdAt: g.createdAt,
              updatedAt: g.updatedAt,
            }
            next.groups.push(row)
            byId.set(row.id, row)
          }
        }
        next.groups.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        next.lastUpdated = nowIso()
        return next
      }, 'tasks', undefined, 'legacy-groups-migrate')
      // 迁移成功 → 旧文件退役（改名保留现场，但不再被读取）。
      try { await rename(legacyGroupsFile, `${legacyGroupsFile}.legacy`) } catch { /* best-effort */ }
    } catch (error) {
      console.warn('[item-store] task-groups.json 并入 items.json 失败（保留旧文件）:', error)
    }
  }

  return {
    async listItems(ownerId?: string): Promise<Item[]> {
      await ensureMigrated()
      const reg = await readNormalized()
      const list = ownerId === undefined ? reg.items : reg.items.filter((i) => i.ownerId === ownerId)
      return clone(list)
    },

    async readItem(id: string): Promise<Item | undefined> {
      await ensureMigrated()
      const reg = await readNormalized()
      const item = reg.items.find((i) => i.id === id)
      return item === undefined ? undefined : clone(item)
    },

    async upsertItem(input: Partial<Item>): Promise<Item> {
      await ensureMigrated()
      const now = nowIso()
      let result: Item | undefined
      await store.mutate((rawReg) => {
        const reg = normalize(rawReg)
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
      await ensureMigrated()
      let deleted = false
      let ownerId: string | undefined
      await store.mutate((rawReg) => {
        const reg = normalize(rawReg)
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
      await ensureMigrated()
      let result: Item | undefined
      await store.mutate((rawReg) => {
        const reg = normalize(rawReg)
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
      await ensureMigrated()
      let result: Item | { deleted: boolean } | undefined
      await store.mutate((rawReg) => {
        const reg = normalize(rawReg)
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

    /* --------------------------- task groups --------------------------- */

    async listGroups(ownerId?: string): Promise<TaskGroup[]> {
      await ensureMigrated()
      const reg = await readNormalized()
      const list = ownerId === undefined ? reg.groups : reg.groups.filter((g) => g.ownerId === ownerId)
      return clone(list)
    },

    async upsertGroup(input: Partial<TaskGroup>): Promise<TaskGroup> {
      await ensureMigrated()
      const now = nowIso()
      let result: TaskGroup | undefined
      await store.mutate((rawReg) => {
        const reg = normalize(rawReg)
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
      await ensureMigrated()
      let deleted = false
      let ownerId: string | undefined
      await store.mutate((rawReg) => {
        const reg = normalize(rawReg)
        if (reg.groups.find((g) => g.id === id) === undefined) return reg
        const next = clone(reg)
        const group = next.groups.find((g) => g.id === id)
        ownerId = group?.ownerId
        next.groups = next.groups.filter((g) => g.id !== id)
        // 组壳删除 → 组内任务一并清理（groupId 引用），不留孤儿（0.2.2）。
        next.items = next.items.filter((i) => i.groupId !== id)
        next.lastUpdated = nowIso()
        deleted = true
        return next
      }, 'tasks', ownerId, 'group-delete')
      return { deleted }
    },
  }
}
