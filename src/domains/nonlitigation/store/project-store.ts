/**
 * Project store: 非诉项目 registry（**只存项目元信息**）。
 *
 * 0.2.12「全面完整统一」：任务、事件、关键日期一律存 items.json（唯一真相源）。
 *   - 写：本 store 的 task/keyDate 方法全部委托 itemStore（不再有第二个写入口）；
 *   - 读：readRegistry / readProject 从 items 实时装配 taskGroups + keyDates，
 *     既有消费方（项目详情/任务树/健康检查/读接口）形状不变，盘上只有一处存储。
 */
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { JsonFileStore } from './file-store.ts'
import { nextProjectId, nowIso } from './id.ts'
import type { ItemStore } from '../../item/store/item-store.ts'
import { isKeyDateItem } from '../../item/store/types.ts'
import { buildOwnerTaskGroups, itemToKeyDate } from '../../item/shape.ts'
import type { ProjectRecord, ProjectRegistry } from './types.ts'

export interface ProjectStore {
  readRegistry(): Promise<ProjectRegistry>
  /** 盘上原始 registry（不装配 items）；仅供一次性迁移读历史残留字段。 */
  readRegistryRaw(): Promise<ProjectRegistry>
  readProject(projectId: string): Promise<ProjectRecord | undefined>
  registerProject(input: Record<string, unknown>): Promise<ProjectRecord>
  updateProject(projectId: string, patch: Record<string, unknown>): Promise<ProjectRecord>
  deleteProject(projectId: string): Promise<{ deleted: boolean }>
  upsertTaskGroup(projectId: string, group: Record<string, unknown>): Promise<ProjectRecord>
  deleteTaskGroup(projectId: string, groupId: string): Promise<ProjectRecord>
  reorderTaskGroups(projectId: string, orderedIds: string[]): Promise<ProjectRecord>
  /**
   * 0.2.2：剥离 registry 里的 taskGroups 镜像。⚠ 不动 keyDates——keyDates 由
   * 0.2.12 统一迁移负责并入 items，此处一并删会静默丢关键日期。
   */
  stripTaskGroups(projectId: string): Promise<ProjectRecord>
  /** 0.2.12：剥离 registry 里全部第二份存储字段（taskGroups + keyDates）。 */
  stripLegacyFields(projectId: string): Promise<ProjectRecord>
  upsertTask(projectId: string, groupId: string, task: Record<string, unknown>): Promise<ProjectRecord>
  deleteTask(projectId: string, groupId: string, taskId: string): Promise<ProjectRecord>
  moveTask(projectId: string, taskId: string, toGroupId: string, index?: number): Promise<ProjectRecord>
  upsertSubtask(projectId: string, groupId: string, taskId: string, subtask: Record<string, unknown>): Promise<ProjectRecord>
  deleteSubtask(projectId: string, groupId: string, taskId: string, subtaskId: string): Promise<ProjectRecord>
  toggleChecklist(projectId: string, groupId: string, taskId: string, checklistId: string): Promise<ProjectRecord>
  addChecklistItem(projectId: string, groupId: string, taskId: string, text: string): Promise<ProjectRecord>
  deleteChecklistItem(projectId: string, groupId: string, taskId: string, checklistId: string): Promise<ProjectRecord>
  /** Key dates (常法续约/年审等提醒). */
  upsertKeyDate(projectId: string, keyDate: Record<string, unknown>): Promise<ProjectRecord>
  toggleKeyDate(projectId: string, keyDateId: string): Promise<ProjectRecord>
  deleteKeyDate(projectId: string, keyDateId: string): Promise<ProjectRecord>
}

export function createProjectStore(dataDir: string, ctx: Context, itemStore?: ItemStore): ProjectStore {
  const store = new JsonFileStore<ProjectRegistry>(
    join(dataDir, 'project-registry.json'),
    () => ({ registryVersion: '1.0', projects: {} }),
    ctx,
  )
  const s = (v: unknown): string | undefined => (v === undefined || v === null) ? undefined : String(v)

  const save = (mutate: (reg: ProjectRegistry) => ProjectRegistry, reason?: string): Promise<ProjectRegistry> =>
    store.mutate(mutate, 'projects', undefined, reason)

  /** 统一事项 store；缺省即配置错误（0.2.12 起任务/关键日期只有 items 一处）。 */
  function is(): ItemStore {
    if (itemStore === undefined) {
      throw new Error('project-store: itemStore is required (0.2.12 统一存储) — 任务与关键日期只存 items.json')
    }
    return itemStore
  }

  /** 把一条 registry 记录补上从 items 派生的 keyDates / taskGroups（只读装配）。 */
  async function hydrate(record: ProjectRecord): Promise<ProjectRecord> {
    if (itemStore === undefined) return record
    const [groups, allItems] = await Promise.all([itemStore.listGroups(), itemStore.listItems()])
    const own = allItems.filter((i) => i.ownerId === record.projectId && (i.ownerType ?? 'nonlitigation') === 'nonlitigation')
    return {
      ...record,
      keyDates: own.filter(isKeyDateItem).map((i) => itemToKeyDate(i)) as unknown as ProjectRecord['keyDates'],
      taskGroups: buildOwnerTaskGroups(record.projectId, 'nonlitigation', groups, allItems) as unknown as ProjectRecord['taskGroups'],
    }
  }

  async function requireProject(projectId: string): Promise<ProjectRecord> {
    const reg = await store.read()
    const record = reg.projects[projectId]
    if (record === undefined) throw new Error(`project not found: ${projectId}`)
    return hydrate(record)
  }

  return {
    async readRegistry() {
      const reg = await store.read()
      if (itemStore === undefined) return reg
      const [groups, allItems] = await Promise.all([itemStore.listGroups(), itemStore.listItems()])
      const next: ProjectRegistry = { ...reg, projects: {} }
      for (const [id, rec] of Object.entries(reg.projects)) {
        const own = allItems.filter((i) => i.ownerId === id && (i.ownerType ?? 'nonlitigation') === 'nonlitigation')
        next.projects[id] = {
          ...rec,
          keyDates: own.filter(isKeyDateItem).map((i) => itemToKeyDate(i)) as unknown as ProjectRecord['keyDates'],
          taskGroups: buildOwnerTaskGroups(id, 'nonlitigation', groups, allItems) as unknown as ProjectRecord['taskGroups'],
        }
      }
      return next
    },
    async readRegistryRaw() { return store.read() },
    async readProject(projectId) {
      const reg = await store.read()
      const record = reg.projects[projectId]
      if (record === undefined) return undefined
      return hydrate(record)
    },
    async registerProject(input) {
      const now = nowIso()
      // Respect an explicit projectId (AgentLex import carries its own ids);
      // otherwise assign the next per-year number (YYYY-NNN, like litigation).
      const explicitId = s(input.projectId)
      let record: ProjectRecord | undefined
      await save((reg) => {
        const id = explicitId !== undefined && explicitId !== ''
          ? (reg.projects[explicitId] !== undefined
            ? (() => { throw new Error(`project id collision: ${explicitId}`) })()
            : explicitId)
          : nextProjectId(reg.projects)
        if (reg.projects[id] !== undefined) throw new Error(`project exists: ${id}`)
        const created: ProjectRecord = {
          projectId: id,
          name: s(input.name) ?? '未命名项目',
          projectType: s(input.projectType) ?? 'other',
          status: s(input.status) ?? 'active',
          leadLawyer: s(input.leadLawyer),
          contractAmount: s(input.contractAmount),
          servicePeriod: typeof input.servicePeriod === 'object' && input.servicePeriod !== null
            ? input.servicePeriod as { start?: string; end?: string } : undefined,
          serviceScope: Array.isArray(input.serviceScope) ? (input.serviceScope as unknown[]).map(String) : [],
          folder: s(input.folder),
          summary: s(input.summary),
          createdAt: now,
          updatedAt: now,
        }
        reg.projects[id] = created
        reg.lastUpdated = now
        record = created
        return reg
      }, 'register-project')
      return record!
    },
    async updateProject(projectId, patch) {
      const now = nowIso()
      let updated: ProjectRecord | undefined
      await save((reg) => {
        const cur = reg.projects[projectId]
        if (cur === undefined) throw new Error(`project not found: ${projectId}`)
        const next: ProjectRecord = { ...cur, ...patch, projectId, updatedAt: now }
        // 0.2.12：keyDates / taskGroups 不是 registry 字段（存 items.json），
        // 任何写路径都不许把它们塞回项目档案——发现即删，杜绝第二份存储复活。
        delete (next as { keyDates?: unknown }).keyDates
        delete (next as { taskGroups?: unknown }).taskGroups
        reg.projects[projectId] = next
        reg.lastUpdated = now
        updated = next
        return reg
      }, 'update-project')
      return updated!
    },
    async deleteProject(projectId) {
      await save((reg) => {
        if (reg.projects[projectId] === undefined) throw new Error(`project not found: ${projectId}`)
        delete reg.projects[projectId]
        reg.lastUpdated = nowIso()
        return reg
      }, 'delete-project')
      return { deleted: true }
    },
    /* ------------- 任务 / 关键日期：统一存 items.json（0.2.12） ------------- */
    // project-registry.json 只存项目元信息。任务与关键日期一律走 itemStore，
    // 读侧由 readRegistry/readProject 实时装配 taskGroups + keyDates。

    async upsertTaskGroup(projectId, group) {
      const gid = s(group.id) ?? s(group.groupId)
      await is().upsertGroup({
        ...(gid === undefined || gid === '' ? {} : { id: gid }),
        ownerId: projectId,
        ownerType: 'nonlitigation',
        name: s(group.name) ?? s(group.title) ?? '新阶段',
        ...(typeof group.order === 'number' ? { order: group.order } : {}),
      })
      return requireProject(projectId)
    },

    async deleteTaskGroup(projectId, groupId) {
      await is().deleteGroup(groupId)
      return requireProject(projectId)
    },

    async stripTaskGroups(projectId) {
      // 只剥任务镜像；keyDates 留给 0.2.12 统一迁移（此处删会丢数据）。
      await save((reg) => {
        const proj = reg.projects[projectId]
        if (proj === undefined) throw new Error(`project not found: ${projectId}`)
        if (!Array.isArray(proj.taskGroups) || proj.taskGroups.length === 0) return reg
        const next = { ...proj, updatedAt: nowIso() }
        delete (next as { taskGroups?: unknown }).taskGroups
        reg.projects[projectId] = next
        reg.lastUpdated = next.updatedAt!
        return reg
      }, 'strip-taskgroups')
      return requireProject(projectId)
    },

    async stripLegacyFields(projectId) {
      // 0.2.12：taskGroups + keyDates 都已在 items → 两个字段一起剥离。
      // 判据是键是否存在（空壳也删），理由同 case-store。
      await save((reg) => {
        const proj = reg.projects[projectId]
        if (proj === undefined) throw new Error(`project not found: ${projectId}`)
        const hasField = (key: string): boolean => Object.prototype.hasOwnProperty.call(proj, key)
        if (!hasField('taskGroups') && !hasField('keyDates')) return reg
        const next = { ...proj, updatedAt: nowIso() }
        delete (next as { taskGroups?: unknown }).taskGroups
        delete (next as { keyDates?: unknown }).keyDates
        reg.projects[projectId] = next
        reg.lastUpdated = next.updatedAt!
        return reg
      }, 'strip-legacy-fields')
      return requireProject(projectId)
    },

    async reorderTaskGroups(projectId, orderedIds) {
      const byId = new Map((await is().listGroups(projectId)).map((g) => [g.id, g]))
      for (let i = 0; i < orderedIds.length; i++) {
        const g = byId.get(orderedIds[i]!)
        if (g !== undefined && g.order !== i) await is().upsertGroup({ id: g.id, order: i })
      }
      return requireProject(projectId)
    },

    async upsertTask(projectId, groupId, task) {
      const groupName = (await is().listGroups(projectId)).find((g) => g.id === groupId)?.name
      await is().upsertItem({
        ...(s(task.id) === undefined || s(task.id) === '' ? {} : { id: s(task.id)! }),
        ownerId: projectId,
        ownerType: 'nonlitigation',
        type: 'task',
        title: s(task.title) ?? '新任务',
        detail: s(task.detail),
        date: s(task.deadline),
        time: s(task.time),
        priority: (task.priority as never) ?? 'medium',
        status: (String(task.status ?? 'todo') === 'done' ? 'done' : String(task.status) === 'doing' || String(task.status) === 'in_progress' ? 'doing' : 'pending') as never,
        groupId: groupId === '' ? undefined : groupId,
        groupName,
        templateTitle: s(task.templateTitle),
        subtasks: Array.isArray(task.subtasks) ? (task.subtasks as never) : undefined,
        checklist: Array.isArray(task.checklist) ? (task.checklist as never) : undefined,
      })
      return requireProject(projectId)
    },

    async deleteTask(projectId, groupId, taskId) {
      await is().deleteItem(taskId)
      return requireProject(projectId)
    },

    async moveTask(projectId, taskId, toGroupId, index) {
      const task = await is().readItem(taskId)
      if (task === undefined) throw new Error(`task not found: ${taskId}`)
      const groupName = (await is().listGroups(projectId)).find((g) => g.id === toGroupId)?.name
      void index
      await is().upsertItem({ id: taskId, groupId: toGroupId, groupName })
      return requireProject(projectId)
    },

    async upsertSubtask(projectId, groupId, taskId, subtask) {
      await is().addSubtask(taskId, {
        ...(s(subtask.id) === undefined || s(subtask.id) === '' ? {} : { id: s(subtask.id)! }),
        title: s(subtask.title) ?? '子任务',
        detail: s(subtask.detail),
        deadline: s(subtask.deadline),
        done: subtask.done === undefined ? false : Boolean(subtask.done),
      })
      return requireProject(projectId)
    },

    async deleteSubtask(projectId, groupId, taskId, subtaskId) {
      await is().deleteSubtask(taskId, subtaskId)
      return requireProject(projectId)
    },

    async toggleChecklist(projectId, groupId, taskId, checklistId) {
      await is().toggleChecklist(taskId, checklistId)
      return requireProject(projectId)
    },

    async addChecklistItem(projectId, groupId, taskId, text) {
      await is().addChecklist(taskId, { text: String(text ?? '检查项') })
      return requireProject(projectId)
    },

    async deleteChecklistItem(projectId, groupId, taskId, checklistId) {
      await is().deleteChecklist(taskId, checklistId)
      return requireProject(projectId)
    },

    /* ------------------------------ key dates ------------------------------ */

    async upsertKeyDate(projectId, keyDate) {
      const kid = s(keyDate.id)
      const existing = kid === undefined || kid === '' ? undefined : await is().readItem(kid)
      await is().upsertItem({
        ...(existing === undefined ? {} : { id: existing.id }),
        ownerId: projectId,
        ownerType: 'nonlitigation',
        type: 'event',
        title: s(keyDate.label) ?? '关键日期',
        date: s(keyDate.date),
        status: keyDate.done !== undefined ? (Boolean(keyDate.done) ? 'done' : 'pending') : (existing?.status ?? 'pending'),
        source: s(keyDate.source) ?? existing?.source ?? 'keydate',
      })
      return requireProject(projectId)
    },

    async toggleKeyDate(projectId, keyDateId) {
      const item = await is().readItem(keyDateId)
      if (item === undefined) throw new Error(`key date not found: ${keyDateId}`)
      await is().toggleItem(keyDateId)
      return requireProject(projectId)
    },

    async deleteKeyDate(projectId, keyDateId) {
      await is().deleteItem(keyDateId)
      return requireProject(projectId)
    },
  }
}