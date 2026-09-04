/**
 * Legacy AgentLex renderer compatibility routes — nonlitigation domain.
 *
 * 适配器消化：项目 / 项目任务树 / 合同 / 研究 的旧 `/api/agentlex/*` 兼容面按域
 * 归位到本插件，直接调用 projectStore，不再经 HTTP 环回。语义与旧 dsh-adapter
 * 一致（camelCase 请求体、group 查找、toLegacy 形状；contract/research 在 v1
 * 保留模块中不存在，返回空注册表避免旧渲染层报错）。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { RouteDeps } from './routes.ts'

/* ------------------------- response helpers ------------------------- */

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (raw.length === 0) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function sendJson(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function ok(res: ServerResponse, data: unknown): void {
  sendJson(res, 200, { success: true, data })
}

function fail(res: ServerResponse, error: unknown, status = 400): void {
  const message = error instanceof Error ? error.message : String(error)
  sendJson(res, status, { success: false, error: message })
}

/* ---------------------- legacy shape translation --------------------- */

function toPluginStatus(status: unknown): string {
  if (status === 'in_progress') return 'doing'
  return String(status ?? 'todo')
}

function toLegacyStatus(status: unknown): string {
  if (status === 'doing') return 'in_progress'
  return String(status ?? 'todo')
}

function toPluginGroup(group: Record<string, unknown>): Record<string, unknown> {
  const g = { ...group }
  if (g.title !== undefined && g.name === undefined) g.name = g.title
  return g
}

function toPluginTask(task: Record<string, unknown>): Record<string, unknown> {
  const t = { ...task }
  t.status = toPluginStatus(t.status)
  if (Array.isArray(t.subtasks)) {
    t.subtasks = t.subtasks.map((s) => {
      const sub = { ...(s as Record<string, unknown>) }
      if (sub.status !== undefined && sub.done === undefined) {
        sub.done = sub.status === 'done' || sub.status === 'in_progress' ? sub.status === 'done' : Boolean(sub.done)
      }
      sub.status = toPluginStatus(sub.status)
      return sub
    })
  }
  return t
}

function normalizeGroup(group: Record<string, unknown>): Record<string, unknown> {
  const g = { ...group }
  if (g.name !== undefined && g.title === undefined) g.title = g.name
  if (Array.isArray(g.tasks)) {
    g.tasks = g.tasks.map((t) => normalizeTask(t as Record<string, unknown>))
  }
  return g
}

function normalizeTask(task: Record<string, unknown>): Record<string, unknown> {
  const t = { ...task }
  t.status = toLegacyStatus(t.status)
  if (Array.isArray(t.subtasks)) {
    t.subtasks = t.subtasks.map((s) => {
      const sub = { ...(s as Record<string, unknown>) }
      if (sub.done !== undefined && sub.status === undefined) {
        sub.status = sub.done === true ? 'done' : 'todo'
      }
      sub.status = toLegacyStatus(sub.status)
      return sub
    })
  }
  return t
}

/** Normalize a DSH project record to the legacy renderer shape. */
function toLegacyProject(record: Record<string, unknown>): Record<string, unknown> {
  return {
    ...record,
    team: Array.isArray(record.team) ? record.team : [],
    serviceScope: Array.isArray(record.serviceScope) ? record.serviceScope : [],
    keyDates: Array.isArray(record.keyDates) ? record.keyDates : [],
    boundSessions: Array.isArray(record.boundSessions) ? record.boundSessions : [],
    taskGroups: Array.isArray(record.taskGroups) ? record.taskGroups : [],
    linkedContracts: Array.isArray(record.linkedContracts) ? record.linkedContracts : [],
    linkedResearch: Array.isArray(record.linkedResearch) ? record.linkedResearch : [],
    tags: Array.isArray(record.tags) ? record.tags : [],
  }
}

/** Find the project task-group containing `taskId` (legacy update/delete flows). */
async function findGroupByTaskId(
  deps: RouteDeps,
  projectId: string,
  taskId: string,
): Promise<{ id: string }> {
  const record = await deps.projectStore.readProject(projectId)
  if (record === undefined) throw new Error(`project not found: ${projectId}`)
  const groups = (record.taskGroups ?? []) as Array<{ id: string; tasks?: Array<{ id: string }> }>
  const group = groups.find((g) => g.tasks?.some((t) => t.id === taskId))
  if (group === undefined) throw new Error(`project task not found: ${taskId}`)
  return { id: group.id }
}

/* --------------------------- route family --------------------------- */

/** Register the nonlitigation-domain legacy `/api/agentlex/*` routes. */
export function registerLegacyCompatRoutes(ctx: Context, deps: RouteDeps): () => void {
  const disposers: Array<() => void> = []

  function route(
    path: string,
    handler: (body: Record<string, unknown>, res: ServerResponse) => Promise<void> | void,
  ): void {
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        try {
          const body = await readBody(req)
          await handler(body, res)
        } catch (error) {
          fail(res, error)
        }
      },
    }))
  }

  /* ------------------------------ projects ---------------------------- */
  route('/api/agentlex/register-project', async (body, res) => {
    ok(res, toLegacyProject(await deps.projectStore.registerProject(body) as unknown as Record<string, unknown>))
  })

  route('/api/agentlex/update-project', async (body, res) => {
    const { projectId, ...patch } = body
    ok(res, toLegacyProject(await deps.projectStore.updateProject(String(projectId ?? ''), patch) as unknown as Record<string, unknown>))
  })

  route('/api/agentlex/delete-project', async (body, res) => {
    const projectId = String(body.projectId ?? '')
    if (deps.itemStore !== undefined) {
      const { cascadeDeleteProject } = await import('../litigation/cascade-delete.ts')
      ok(res, await cascadeDeleteProject(deps.projectStore, deps.itemStore, projectId))
      return
    }
    ok(res, await deps.projectStore.deleteProject(projectId))
  })

  /* ------------------------- contracts / research ---------------------- */
  // The retained modules do not include contract/research in v1; return empty
  // registries so the legacy renderer does not break.
  route('/api/agentlex/list-contracts', async (_body, res) => {
    ok(res, { contracts: {} })
  })
  route('/api/agentlex/list-research', async (_body, res) => {
    ok(res, { research: {} })
  })
  route('/api/agentlex/add-contract', async (_body, res) => {
    ok(res, { ok: true })
  })
  route('/api/agentlex/update-contract', async (_body, res) => {
    ok(res, { ok: true })
  })
  route('/api/agentlex/add-research', async (_body, res) => {
    ok(res, { ok: true })
  })
  route('/api/agentlex/update-research', async (_body, res) => {
    ok(res, { ok: true })
  })

  /* ------------------------ project task tree -------------------------- */
  // 0.2.2：项目任务组/任务/子任务/检查项全部写统一事项 items.json（ownerType=
  // nonlitigation），不再写 project-registry 的 taskGroups（旧 GUI 曾写旧库分裂）。
  route('/api/agentlex/add-project-task-group', async (body, res) => {
    const projectId = String(body.projectId ?? '')
    const group: Record<string, unknown> = { ownerId: projectId, ownerType: 'nonlitigation', ...body }
    delete group.projectId
    if (group.title !== undefined && group.name === undefined) group.name = group.title
    if (deps.itemStore !== undefined) {
      const created = await deps.itemStore.upsertGroup(group as never)
      ok(res, { ...created, title: created.name })
      return
    }
    ok(res, await deps.projectStore.upsertTaskGroup(projectId, toPluginGroup(group) as never))
  })

  route('/api/agentlex/update-project-task-group', async (body, res) => {
    const projectId = String(body.projectId ?? '')
    const groupId = String(body.groupId ?? '')
    const patch = (body.patch ?? {}) as Record<string, unknown>
    if (deps.itemStore !== undefined) {
      const input: Record<string, unknown> = { id: groupId, ownerId: projectId, ownerType: 'nonlitigation' }
      if (patch.title !== undefined) input.name = String(patch.title)
      else if (patch.name !== undefined) input.name = String(patch.name)
      if (patch.order !== undefined) input.order = Number(patch.order)
      const updated = await deps.itemStore.upsertGroup(input as never)
      ok(res, { ...updated, title: updated.name })
      return
    }
    const group = { id: groupId, ...patch }
    ok(res, await deps.projectStore.upsertTaskGroup(projectId, toPluginGroup(group) as never))
  })

  route('/api/agentlex/delete-project-task-group', async (body, res) => {
    const projectId = String(body.projectId ?? '')
    const groupId = String(body.groupId ?? '')
    if (deps.itemStore !== undefined) {
      ok(res, await deps.itemStore.deleteGroup(groupId))
      return
    }
    ok(res, await deps.projectStore.deleteTaskGroup(projectId, groupId))
  })

  route('/api/agentlex/reorder-project-task-groups', async (body, res) => {
    const projectId = String(body.projectId ?? '')
    const orderedIds = Array.isArray(body.orderedIds) ? body.orderedIds.map(String) : []
    if (deps.itemStore !== undefined) {
      const groups = await deps.itemStore.listGroups(projectId)
      const byId = new Map(groups.map((g) => [g.id, g]))
      for (let i = 0; i < orderedIds.length; i++) {
        const g = byId.get(orderedIds[i])
        if (g !== undefined && g.order !== i) await deps.itemStore.upsertGroup({ id: g.id, order: i })
      }
      ok(res, { ok: true })
      return
    }
    ok(res, await deps.projectStore.reorderTaskGroups(projectId, orderedIds))
  })

  route('/api/agentlex/add-project-task', async (body, res) => {
    const projectId = String(body.projectId ?? '')
    const groupId = String(body.groupId ?? '')
    const { projectId: _c, groupId: _g, ...task } = body
    if (deps.itemStore !== undefined) {
      const groupName = (await deps.itemStore.listGroups(projectId)).find((g) => g.id === groupId)?.name
      const created = await deps.itemStore.upsertItem({
        ownerId: projectId,
        ownerType: 'nonlitigation',
        type: 'task',
        title: String(task.title ?? task.taskTitle ?? '新任务'),
        detail: task.detail === undefined ? undefined : String(task.detail),
        date: task.deadline === undefined ? undefined : String(task.deadline),
        time: task.time === undefined ? undefined : String(task.time),
        priority: (task.priority as never) ?? 'medium',
        status: (task.status === 'done' ? 'done' : task.status === 'doing' || task.status === 'in_progress' ? 'doing' : task.status === 'todo' ? 'pending' : undefined) as never,
        groupId: groupId || undefined,
        groupName,
        templateTitle: String(task.title ?? task.taskTitle ?? '新任务'),
        ...(task.id !== undefined ? { id: String(task.id) } : {}),
      })
      ok(res, { ...created, title: created.title })
      return
    }
    ok(res, await deps.projectStore.upsertTask(projectId, groupId, toPluginTask(task) as never))
  })

  route('/api/agentlex/update-project-task', async (body, res) => {
    const projectId = String(body.projectId ?? '')
    const taskId = String(body.taskId ?? '')
    const patch = (body.patch ?? {}) as Record<string, unknown>
    if (deps.itemStore !== undefined) {
      const existing = await deps.itemStore.readItem(taskId)
      if (existing === undefined) throw new Error(`project task not found: ${taskId}`)
      const input: Record<string, unknown> = { id: taskId, ownerId: projectId, ownerType: 'nonlitigation' }
      if (patch.title !== undefined) input.title = String(patch.title)
      if (patch.detail !== undefined) input.detail = String(patch.detail)
      if (patch.deadline !== undefined) input.date = patch.deadline === '' || patch.deadline === null ? undefined : String(patch.deadline)
      if (patch.time !== undefined) input.time = patch.time === '' ? undefined : String(patch.time)
      if (patch.priority !== undefined) input.priority = String(patch.priority)
      if (patch.status !== undefined) input.status = (patch.status === 'done' ? 'done' : patch.status === 'doing' || patch.status === 'in_progress' ? 'doing' : patch.status === 'todo' ? 'pending' : existing.status) as never
      if (patch.folder !== undefined) input.detail = String(patch.folder)
      const updated = await deps.itemStore.upsertItem(input as never)
      ok(res, updated)
      return
    }
    const group = await findGroupByTaskId(deps, projectId, taskId)
    const task = { id: taskId, ...patch }
    ok(res, await deps.projectStore.upsertTask(projectId, group.id, toPluginTask(task) as never))
  })

  route('/api/agentlex/delete-project-task', async (body, res) => {
    const projectId = String(body.projectId ?? '')
    const taskId = String(body.taskId ?? '')
    if (deps.itemStore !== undefined) {
      ok(res, await deps.itemStore.deleteItem(taskId))
      return
    }
    const group = await findGroupByTaskId(deps, projectId, taskId)
    ok(res, await deps.projectStore.deleteTask(projectId, group.id, taskId))
  })

  route('/api/agentlex/move-project-task', async (body, res) => {
    const projectId = String(body.projectId ?? '')
    const taskId = String(body.taskId ?? '')
    const toGroupId = String(body.targetGroupId ?? body.toGroupId ?? '')
    if (deps.itemStore !== undefined) {
      const toGroup = (await deps.itemStore.listGroups(projectId)).find((g) => g.id === toGroupId)
      await deps.itemStore.upsertItem({ id: taskId, groupId: toGroupId, groupName: toGroup?.name, ownerId: projectId, ownerType: 'nonlitigation' })
      ok(res, { ok: true })
      return
    }
    ok(res, await deps.projectStore.moveTask(projectId, taskId, toGroupId, typeof body.index === 'number' ? body.index : undefined))
  })

  route('/api/agentlex/add-project-subtask', async (body, res) => {
    const projectId = String(body.projectId ?? '')
    const taskId = String(body.taskId ?? '')
    const { projectId: _c, taskId: _t, title, deadline, done, ...subtask } = body
    if (deps.itemStore !== undefined) {
      const created = await deps.itemStore.addSubtask(taskId, {
        title: String(title ?? subtask.subtaskTitle ?? '子任务'),
        deadline: deadline === undefined ? undefined : String(deadline),
        done: done === true || subtask.status === 'done' || subtask.status === 'in_progress' ? done === true || subtask.status === 'done' : undefined,
      })
      ok(res, created)
      return
    }
    const group = await findGroupByTaskId(deps, projectId, taskId)
    ok(res, await deps.projectStore.upsertSubtask(projectId, group.id, taskId, toPluginTask(subtask as Record<string, unknown>) as never))
  })

  route('/api/agentlex/update-project-subtask', async (body, res) => {
    const projectId = String(body.projectId ?? '')
    const taskId = String(body.taskId ?? '')
    const subtaskId = String(body.subtaskId ?? '')
    const patch = (body.patch ?? {}) as Record<string, unknown>
    if (deps.itemStore !== undefined) {
      const updated = await deps.itemStore.updateSubtask(taskId, subtaskId, {
        ...(patch.title !== undefined ? { title: String(patch.title) } : {}),
        ...(patch.status !== undefined ? { done: patch.status === 'done' } : {}),
        ...(patch.deadline !== undefined ? { deadline: String(patch.deadline) } : {}),
      })
      ok(res, updated)
      return
    }
    const group = await findGroupByTaskId(deps, projectId, taskId)
    const subtask = { id: subtaskId, ...patch }
    ok(res, await deps.projectStore.upsertSubtask(projectId, group.id, taskId, toPluginTask(subtask as Record<string, unknown>) as never))
  })

  route('/api/agentlex/delete-project-subtask', async (body, res) => {
    const projectId = String(body.projectId ?? '')
    const taskId = String(body.taskId ?? '')
    const subtaskId = String(body.subtaskId ?? '')
    if (deps.itemStore !== undefined) {
      ok(res, await deps.itemStore.deleteSubtask(taskId, subtaskId))
      return
    }
    const group = await findGroupByTaskId(deps, projectId, taskId)
    ok(res, await deps.projectStore.deleteSubtask(projectId, group.id, taskId, subtaskId))
  })

  route('/api/agentlex/add-project-checklist-item', async (body, res) => {
    const projectId = String(body.projectId ?? '')
    const taskId = String(body.taskId ?? '')
    const text = String(body.text ?? '')
    if (deps.itemStore !== undefined) {
      const created = await deps.itemStore.addChecklist(taskId, { text })
      ok(res, created)
      return
    }
    const group = await findGroupByTaskId(deps, projectId, taskId)
    ok(res, await deps.projectStore.addChecklistItem(projectId, group.id, taskId, text))
  })

  route('/api/agentlex/toggle-project-checklist-item', async (body, res) => {
    const projectId = String(body.projectId ?? '')
    const taskId = String(body.taskId ?? '')
    const itemId = String(body.itemId ?? '')
    const done = body.done === undefined ? undefined : body.done === true
    if (deps.itemStore !== undefined) {
      ok(res, await deps.itemStore.toggleChecklist(taskId, itemId, done))
      return
    }
    const group = await findGroupByTaskId(deps, projectId, taskId)
    ok(res, await deps.projectStore.toggleChecklist(projectId, group.id, taskId, itemId))
  })

  route('/api/agentlex/delete-project-checklist-item', async (body, res) => {
    const projectId = String(body.projectId ?? '')
    const taskId = String(body.taskId ?? '')
    const itemId = String(body.itemId ?? '')
    if (deps.itemStore !== undefined) {
      ok(res, await deps.itemStore.deleteChecklist(taskId, itemId))
      return
    }
    const group = await findGroupByTaskId(deps, projectId, taskId)
    ok(res, await deps.projectStore.deleteChecklistItem(projectId, group.id, taskId, itemId))
  })

  return () => {
    for (const dispose of disposers.splice(0)) dispose()
  }
}
