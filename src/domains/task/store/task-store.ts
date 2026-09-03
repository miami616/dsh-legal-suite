import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { JsonFileStore } from './file-store.ts'
import { childId, nowIso } from './id.ts'
import type { StandaloneTasksRegistry, TaskItem } from './types.ts'

export interface TaskStore {
  readRegistry(): Promise<StandaloneTasksRegistry>
  listTasks(): Promise<TaskItem[]>
  upsertTask(input: Record<string, unknown>): Promise<TaskItem>
  deleteTask(id: string): Promise<{ deleted: boolean }>
}

export function createTaskStore(dataDir: string, ctx: Context): TaskStore {
  const store = new JsonFileStore<StandaloneTasksRegistry>(
    join(dataDir, 'standalone-tasks.json'),
    () => ({ registryVersion: '1.0', tasks: {} }),
    ctx,
  )
  const s = (v: unknown): string | undefined => (v === undefined || v === null) ? undefined : String(v)

  return {
    async readRegistry() { return store.read() },
    async listTasks() {
      const reg = await store.read()
      return Object.values(reg.tasks)
    },
    async upsertTask(input) {
      const now = nowIso()
      const id = s(input.id) ?? childId('task')
      let result: TaskItem | undefined
      await store.mutate((reg) => {
        const existing = reg.tasks[id] ?? { id, createdAt: now }
        const next: TaskItem = {
          ...existing,
          id,
          title: s(input.title) ?? existing.title ?? '未命名任务',
          detail: s(input.detail) ?? existing.detail,
          status: (s(input.status) as TaskItem['status']) ?? existing.status ?? 'todo',
          priority: (s(input.priority) as TaskItem['priority']) ?? existing.priority,
          deadline: s(input.deadline) ?? existing.deadline,
          time: s(input.time) ?? existing.time,
          source: (s(input.source) as TaskItem['source']) ?? existing.source ?? 'standalone',
          sourceId: s(input.sourceId) ?? existing.sourceId,
          sourceName: s(input.sourceName) ?? existing.sourceName,
          updatedAt: now,
        }
        reg.tasks[id] = next
        reg.lastUpdated = now
        result = next
        return reg
      }, 'tasks', undefined, 'upsert-task')
      return result!
    },
    async deleteTask(id) {
      await store.mutate((reg) => {
        if (reg.tasks[id] === undefined) throw new Error(`task not found: ${id}`)
        delete reg.tasks[id]
        reg.lastUpdated = nowIso()
        return reg
      }, 'tasks', undefined, 'delete-task')
      return { deleted: true }
    },
  }
}
