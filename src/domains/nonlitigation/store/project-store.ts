import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { JsonFileStore } from './file-store.ts'
import { childId, nextProjectId, nowIso } from './id.ts'
import type { ProjectRecord, ProjectRegistry, ProjectTask } from './types.ts'

export interface ProjectStore {
  readRegistry(): Promise<ProjectRegistry>
  readProject(projectId: string): Promise<ProjectRecord | undefined>
  registerProject(input: Record<string, unknown>): Promise<ProjectRecord>
  updateProject(projectId: string, patch: Record<string, unknown>): Promise<ProjectRecord>
  deleteProject(projectId: string): Promise<{ deleted: boolean }>
  upsertTaskGroup(projectId: string, group: Record<string, unknown>): Promise<ProjectRecord>
  deleteTaskGroup(projectId: string, groupId: string): Promise<ProjectRecord>
  reorderTaskGroups(projectId: string, orderedIds: string[]): Promise<ProjectRecord>
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

export function createProjectStore(dataDir: string, ctx: Context): ProjectStore {
  const store = new JsonFileStore<ProjectRegistry>(
    join(dataDir, 'project-registry.json'),
    () => ({ registryVersion: '1.0', projects: {} }),
    ctx,
  )
  const s = (v: unknown): string | undefined => (v === undefined || v === null) ? undefined : String(v)

  const save = (mutate: (reg: ProjectRegistry) => ProjectRegistry, reason?: string): Promise<ProjectRegistry> =>
    store.mutate(mutate, 'projects', undefined, reason)

  function findGroup(proj: ProjectRecord, groupId: string): { group: NonNullable<ProjectRecord['taskGroups']>[number]; index: number } {
    const groups = proj.taskGroups ?? []
    const index = groups.findIndex((g) => g.id === groupId)
    if (index < 0) throw new Error(`task group not found: ${groupId}`)
    return { group: groups[index], index }
  }

  function findTask(group: NonNullable<ProjectRecord['taskGroups']>[number], taskId: string): { task: ProjectTask; index: number } {
    const tasks = group.tasks ?? []
    const index = tasks.findIndex((t) => t.id === taskId)
    if (index < 0) throw new Error(`task not found: ${taskId}`)
    return { task: tasks[index], index }
  }

  return {
    async readRegistry() { return store.read() },
    async readProject(projectId) {
      const reg = await store.read()
      return reg.projects[projectId]
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
          taskGroups: Array.isArray(input.taskGroups) ? input.taskGroups as ProjectRecord['taskGroups'] : [],
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
    async upsertTaskGroup(projectId, group) {
      const now = nowIso()
      let updated: ProjectRecord | undefined
      await save((reg) => {
        const proj = reg.projects[projectId]
        if (proj === undefined) throw new Error(`project not found: ${projectId}`)
        const groups = [...(proj.taskGroups ?? [])]
        const gid = s(group.id) ?? childId('ptg')
        const idx = groups.findIndex((g) => g.id === gid)
        const name = s(group.name) ?? s(group.title) ?? '新阶段'
        const existing = idx >= 0 ? groups[idx] : { id: gid, name, title: name, order: groups.length, tasks: [], createdAt: now }
        const next = { ...existing, name, title: name, updatedAt: now }
        if (idx >= 0) groups[idx] = next
        else groups.push(next)
        const result: ProjectRecord = { ...proj, taskGroups: groups, updatedAt: now }
        reg.projects[projectId] = result
        reg.lastUpdated = now
        updated = result
        return reg
      }, 'upsert-group')
      return updated!
    },
    async deleteTaskGroup(projectId, groupId) {
      const now = nowIso()
      let updated: ProjectRecord | undefined
      await save((reg) => {
        const proj = reg.projects[projectId]
        if (proj === undefined) throw new Error(`project not found: ${projectId}`)
        const groups = (proj.taskGroups ?? []).filter((g) => g.id !== groupId)
        const result: ProjectRecord = { ...proj, taskGroups: groups, updatedAt: now }
        reg.projects[projectId] = result
        reg.lastUpdated = now
        updated = result
        return reg
      }, 'delete-group')
      return updated!
    },
    async reorderTaskGroups(projectId, orderedIds) {
      const now = nowIso()
      let updated: ProjectRecord | undefined
      await save((reg) => {
        const proj = reg.projects[projectId]
        if (proj === undefined) throw new Error(`project not found: ${projectId}`)
        const byId = new Map((proj.taskGroups ?? []).map((g) => [g.id, g]))
        const groups = orderedIds
          .map((id, index) => { const g = byId.get(id); if (g !== undefined) g.order = index; return g })
          .filter((g): g is NonNullable<ProjectRecord['taskGroups']>[number] => g !== undefined)
        const result: ProjectRecord = { ...proj, taskGroups: groups, updatedAt: now }
        reg.projects[projectId] = result
        reg.lastUpdated = now
        updated = result
        return reg
      }, 'reorder-groups')
      return updated!
    },
    async upsertTask(projectId, groupId, task) {
      const now = nowIso()
      let updated: ProjectRecord | undefined
      await save((reg) => {
        const proj = reg.projects[projectId]
        if (proj === undefined) throw new Error(`project not found: ${projectId}`)
        const groups = [...(proj.taskGroups ?? [])]
        const gi = groups.findIndex((g) => g.id === groupId)
        if (gi < 0) throw new Error(`group not found: ${groupId}`)
        const g = groups[gi]
        const tasks = [...(g.tasks ?? [])]
        const tid = s(task.id) ?? childId('ptask')
        const ti = tasks.findIndex((t) => t.id === tid)
        const existing: ProjectTask = ti >= 0 ? tasks[ti] : {
          id: tid, title: s(task.title) ?? '新任务', status: 'todo',
          priority: (s(task.priority) as ProjectTask['priority']) ?? 'medium',
          subtasks: [], checklist: [], createdAt: now,
        }
        const next = {
          ...existing,
          title: s(task.title) ?? existing.title,
          status: (s(task.status) as ProjectTask['status']) ?? existing.status,
          deadline: s(task.deadline) ?? existing.deadline,
          priority: (s(task.priority) as ProjectTask['priority']) ?? existing.priority,
          // detail / templateTitle 此前完全未透传——建项目时写的任务说明被
          // 静默丢弃（更新时同样丢弃）。此处新建与更新一并补上。
          detail: s(task.detail) ?? existing.detail,
          templateTitle: s(task.templateTitle) ?? existing.templateTitle,
          updatedAt: now,
        }
        if (ti >= 0) tasks[ti] = next
        else tasks.push(next)
        groups[gi] = { ...g, tasks, updatedAt: now }
        const result: ProjectRecord = { ...proj, taskGroups: groups, updatedAt: now }
        reg.projects[projectId] = result
        reg.lastUpdated = now
        updated = result
        return reg
      }, 'upsert-task')
      return updated!
    },
    async deleteTask(projectId, groupId, taskId) {
      const now = nowIso()
      let updated: ProjectRecord | undefined
      await save((reg) => {
        const proj = reg.projects[projectId]
        if (proj === undefined) throw new Error(`project not found: ${projectId}`)
        const groups = [...(proj.taskGroups ?? [])]
        const gi = groups.findIndex((g) => g.id === groupId)
        if (gi < 0) throw new Error(`group not found: ${groupId}`)
        const tasks = (groups[gi].tasks ?? []).filter((t) => t.id !== taskId)
        groups[gi] = { ...groups[gi], tasks, updatedAt: now }
        const result: ProjectRecord = { ...proj, taskGroups: groups, updatedAt: now }
        reg.projects[projectId] = result
        reg.lastUpdated = now
        updated = result
        return reg
      }, 'delete-task')
      return updated!
    },
    async moveTask(projectId, taskId, toGroupId, index) {
      const now = nowIso()
      let updated: ProjectRecord | undefined
      await save((reg) => {
        const proj = reg.projects[projectId]
        if (proj === undefined) throw new Error(`project not found: ${projectId}`)
        const groups = [...(proj.taskGroups ?? [])]
        let moved: ProjectTask | undefined
        for (let i = 0; i < groups.length; i++) {
          const tasks = groups[i].tasks ?? []
          const ti = tasks.findIndex((t) => t.id === taskId)
          if (ti >= 0) {
            moved = tasks[ti]
            groups[i] = { ...groups[i], tasks: tasks.filter((_, idx) => idx !== ti), updatedAt: now }
            break
          }
        }
        if (moved === undefined) throw new Error(`task not found: ${taskId}`)
        const gi = groups.findIndex((g) => g.id === toGroupId)
        if (gi < 0) throw new Error(`target group not found: ${toGroupId}`)
        const targetTasks = [...(groups[gi].tasks ?? [])]
        const insertAt = index === undefined || index < 0 || index > targetTasks.length ? targetTasks.length : index
        targetTasks.splice(insertAt, 0, moved)
        groups[gi] = { ...groups[gi], tasks: targetTasks, updatedAt: now }
        const result: ProjectRecord = { ...proj, taskGroups: groups, updatedAt: now }
        reg.projects[projectId] = result
        reg.lastUpdated = now
        updated = result
        return reg
      }, 'move-task')
      return updated!
    },
    async upsertSubtask(projectId, groupId, taskId, subtask) {
      const now = nowIso()
      let updated: ProjectRecord | undefined
      await save((reg) => {
        const proj = reg.projects[projectId]
        if (proj === undefined) throw new Error(`project not found: ${projectId}`)
        const groups = [...(proj.taskGroups ?? [])]
        const gi = groups.findIndex((g) => g.id === groupId)
        if (gi < 0) throw new Error(`group not found: ${groupId}`)
        const tasks = [...(groups[gi].tasks ?? [])]
        const ti = tasks.findIndex((t) => t.id === taskId)
        if (ti < 0) throw new Error(`task not found: ${taskId}`)
        const task = tasks[ti]
        const subtasks = [...(task.subtasks ?? [])]
        const sid = s(subtask.id) ?? childId('pst')
        const si = subtasks.findIndex((x) => x.id === sid)
        const done = subtask.done !== undefined ? Boolean(subtask.done) : subtask.status === 'done'
        const existing = si >= 0 ? subtasks[si] : { id: sid, title: s(subtask.title) ?? '子任务', done: false, createdAt: now }
        const next = { ...existing, title: s(subtask.title) ?? existing.title, done, status: done ? 'done' : 'todo', updatedAt: now }
        if (si >= 0) subtasks[si] = next
        else subtasks.push(next)
        tasks[ti] = { ...task, subtasks, updatedAt: now }
        groups[gi] = { ...groups[gi], tasks, updatedAt: now }
        const result: ProjectRecord = { ...proj, taskGroups: groups, updatedAt: now }
        reg.projects[projectId] = result
        reg.lastUpdated = now
        updated = result
        return reg
      }, 'upsert-subtask')
      return updated!
    },
    async deleteSubtask(projectId, groupId, taskId, subtaskId) {
      const now = nowIso()
      let updated: ProjectRecord | undefined
      await save((reg) => {
        const proj = reg.projects[projectId]
        if (proj === undefined) throw new Error(`project not found: ${projectId}`)
        const groups = [...(proj.taskGroups ?? [])]
        const gi = groups.findIndex((g) => g.id === groupId)
        if (gi < 0) throw new Error(`group not found: ${groupId}`)
        const tasks = [...(groups[gi].tasks ?? [])]
        const ti = tasks.findIndex((t) => t.id === taskId)
        if (ti < 0) throw new Error(`task not found: ${taskId}`)
        const task = tasks[ti]
        const subtasks = (task.subtasks ?? []).filter((x) => x.id !== subtaskId)
        tasks[ti] = { ...task, subtasks, updatedAt: now }
        groups[gi] = { ...groups[gi], tasks, updatedAt: now }
        const result: ProjectRecord = { ...proj, taskGroups: groups, updatedAt: now }
        reg.projects[projectId] = result
        reg.lastUpdated = now
        updated = result
        return reg
      }, 'delete-subtask')
      return updated!
    },
    async toggleChecklist(projectId, groupId, taskId, checklistId) {
      const now = nowIso()
      let updated: ProjectRecord | undefined
      await save((reg) => {
        const proj = reg.projects[projectId]
        if (proj === undefined) throw new Error(`project not found: ${projectId}`)
        const groups = [...(proj.taskGroups ?? [])]
        const gi = groups.findIndex((g) => g.id === groupId)
        if (gi < 0) throw new Error(`group not found: ${groupId}`)
        const tasks = [...(groups[gi].tasks ?? [])]
        const ti = tasks.findIndex((t) => t.id === taskId)
        if (ti < 0) throw new Error(`task not found: ${taskId}`)
        const task = tasks[ti]
        const checklist = [...(task.checklist ?? [])]
        const ci = checklist.findIndex((x) => x.id === checklistId)
        if (ci >= 0) checklist[ci] = { ...checklist[ci], done: !checklist[ci].done }
        tasks[ti] = { ...task, checklist, updatedAt: now }
        groups[gi] = { ...groups[gi], tasks, updatedAt: now }
        const result: ProjectRecord = { ...proj, taskGroups: groups, updatedAt: now }
        reg.projects[projectId] = result
        reg.lastUpdated = now
        updated = result
        return reg
      }, 'toggle-checklist')
      return updated!
    },
    async addChecklistItem(projectId, groupId, taskId, text) {
      const now = nowIso()
      let updated: ProjectRecord | undefined
      await save((reg) => {
        const proj = reg.projects[projectId]
        if (proj === undefined) throw new Error(`project not found: ${projectId}`)
        const groups = [...(proj.taskGroups ?? [])]
        const gi = groups.findIndex((g) => g.id === groupId)
        if (gi < 0) throw new Error(`group not found: ${groupId}`)
        const tasks = [...(groups[gi].tasks ?? [])]
        const ti = tasks.findIndex((t) => t.id === taskId)
        if (ti < 0) throw new Error(`task not found: ${taskId}`)
        const task = tasks[ti]
        const checklist = [...(task.checklist ?? []), { id: childId('pck'), text, done: false, createdAt: now }]
        tasks[ti] = { ...task, checklist, updatedAt: now }
        groups[gi] = { ...groups[gi], tasks, updatedAt: now }
        const result: ProjectRecord = { ...proj, taskGroups: groups, updatedAt: now }
        reg.projects[projectId] = result
        reg.lastUpdated = now
        updated = result
        return reg
      }, 'add-checklist')
      return updated!
    },
    async deleteChecklistItem(projectId, groupId, taskId, checklistId) {
      const now = nowIso()
      let updated: ProjectRecord | undefined
      await save((reg) => {
        const proj = reg.projects[projectId]
        if (proj === undefined) throw new Error(`project not found: ${projectId}`)
        const groups = [...(proj.taskGroups ?? [])]
        const gi = groups.findIndex((g) => g.id === groupId)
        if (gi < 0) throw new Error(`group not found: ${groupId}`)
        const tasks = [...(groups[gi].tasks ?? [])]
        const ti = tasks.findIndex((t) => t.id === taskId)
        if (ti < 0) throw new Error(`task not found: ${taskId}`)
        const task = tasks[ti]
        const checklist = (task.checklist ?? []).filter((x) => x.id !== checklistId)
        tasks[ti] = { ...task, checklist, updatedAt: now }
        groups[gi] = { ...groups[gi], tasks, updatedAt: now }
        const result: ProjectRecord = { ...proj, taskGroups: groups, updatedAt: now }
        reg.projects[projectId] = result
        reg.lastUpdated = now
        updated = result
        return reg
      }, 'delete-checklist')
      return updated!
    },
    async upsertKeyDate(projectId, keyDate) {
      const now = nowIso()
      let updated: ProjectRecord | undefined
      await save((reg) => {
        const proj = reg.projects[projectId]
        if (proj === undefined) throw new Error(`project not found: ${projectId}`)
        const keyDates = [...(proj.keyDates ?? [])]
        const kid = s(keyDate.id) ?? childId('pkd')
        const idx = keyDates.findIndex((k) => k.id === kid)
        const existing = idx >= 0 ? keyDates[idx] : { id: kid, label: s(keyDate.label) ?? '关键日期', date: s(keyDate.date) ?? '', done: false, createdAt: now }
        const next = {
          ...existing,
          label: s(keyDate.label) ?? existing.label,
          date: s(keyDate.date) ?? existing.date,
          done: keyDate.done !== undefined ? Boolean(keyDate.done) : existing.done,
          updatedAt: now,
        }
        if (idx >= 0) keyDates[idx] = next
        else keyDates.push(next)
        const result: ProjectRecord = { ...proj, keyDates, updatedAt: now }
        reg.projects[projectId] = result
        reg.lastUpdated = now
        updated = result
        return reg
      }, 'upsert-keydate')
      return updated!
    },
    async toggleKeyDate(projectId, keyDateId) {
      const now = nowIso()
      let updated: ProjectRecord | undefined
      await save((reg) => {
        const proj = reg.projects[projectId]
        if (proj === undefined) throw new Error(`project not found: ${projectId}`)
        const keyDates = [...(proj.keyDates ?? [])]
        const idx = keyDates.findIndex((k) => k.id === keyDateId)
        if (idx >= 0) keyDates[idx] = { ...keyDates[idx], done: !keyDates[idx].done, updatedAt: now }
        const result: ProjectRecord = { ...proj, keyDates, updatedAt: now }
        reg.projects[projectId] = result
        reg.lastUpdated = now
        updated = result
        return reg
      }, 'toggle-keydate')
      return updated!
    },
    async deleteKeyDate(projectId, keyDateId) {
      const now = nowIso()
      let updated: ProjectRecord | undefined
      await save((reg) => {
        const proj = reg.projects[projectId]
        if (proj === undefined) throw new Error(`project not found: ${projectId}`)
        const keyDates = (proj.keyDates ?? []).filter((k) => k.id !== keyDateId)
        const result: ProjectRecord = { ...proj, keyDates, updatedAt: now }
        reg.projects[projectId] = result
        reg.lastUpdated = now
        updated = result
        return reg
      }, 'delete-keydate')
      return updated!
    },
  }
}
