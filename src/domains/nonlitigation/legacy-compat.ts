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
  route('/api/agentlex/add-project-task-group', async (body, res) => {
    const { projectId, ...group } = body
    ok(res, await deps.projectStore.upsertTaskGroup(String(projectId ?? ''), toPluginGroup(group) as never))
  })

  route('/api/agentlex/update-project-task-group', async (body, res) => {
    const { projectId, groupId, patch } = body
    const group = { id: String(groupId ?? ''), ...(patch as Record<string, unknown>) }
    ok(res, await deps.projectStore.upsertTaskGroup(String(projectId ?? ''), toPluginGroup(group) as never))
  })

  route('/api/agentlex/delete-project-task-group', async (body, res) => {
    ok(res, await deps.projectStore.deleteTaskGroup(String(body.projectId ?? ''), String(body.groupId ?? '')))
  })

  route('/api/agentlex/reorder-project-task-groups', async (body, res) => {
    ok(res, await deps.projectStore.reorderTaskGroups(
      String(body.projectId ?? ''),
      Array.isArray(body.orderedIds) ? body.orderedIds.map(String) : [],
    ))
  })

  route('/api/agentlex/add-project-task', async (body, res) => {
    const { projectId, groupId, ...task } = body
    ok(res, await deps.projectStore.upsertTask(String(projectId ?? ''), String(groupId ?? ''), toPluginTask(task) as never))
  })

  route('/api/agentlex/update-project-task', async (body, res) => {
    const { projectId, taskId, patch } = body
    const group = await findGroupByTaskId(deps, String(projectId ?? ''), String(taskId ?? ''))
    const task = { id: String(taskId ?? ''), ...(patch as Record<string, unknown>) }
    ok(res, await deps.projectStore.upsertTask(String(projectId ?? ''), group.id, toPluginTask(task) as never))
  })

  route('/api/agentlex/delete-project-task', async (body, res) => {
    const { projectId, taskId } = body
    const group = await findGroupByTaskId(deps, String(projectId ?? ''), String(taskId ?? ''))
    ok(res, await deps.projectStore.deleteTask(String(projectId ?? ''), group.id, String(taskId ?? '')))
  })

  route('/api/agentlex/move-project-task', async (body, res) => {
    ok(res, await deps.projectStore.moveTask(
      String(body.projectId ?? ''),
      String(body.taskId ?? ''),
      String(body.targetGroupId ?? body.toGroupId ?? ''),
      typeof body.index === 'number' ? body.index : undefined,
    ))
  })

  route('/api/agentlex/add-project-subtask', async (body, res) => {
    const { projectId, taskId, ...subtask } = body
    const group = await findGroupByTaskId(deps, String(projectId ?? ''), String(taskId ?? ''))
    ok(res, await deps.projectStore.upsertSubtask(
      String(projectId ?? ''), group.id, String(taskId ?? ''), toPluginTask(subtask) as never,
    ))
  })

  route('/api/agentlex/update-project-subtask', async (body, res) => {
    const { projectId, taskId, subtaskId, patch } = body
    const group = await findGroupByTaskId(deps, String(projectId ?? ''), String(taskId ?? ''))
    const subtask = { id: String(subtaskId ?? ''), ...(patch as Record<string, unknown>) }
    ok(res, await deps.projectStore.upsertSubtask(
      String(projectId ?? ''), group.id, String(taskId ?? ''), toPluginTask(subtask) as never,
    ))
  })

  route('/api/agentlex/delete-project-subtask', async (body, res) => {
    const { projectId, taskId, subtaskId } = body
    const group = await findGroupByTaskId(deps, String(projectId ?? ''), String(taskId ?? ''))
    ok(res, await deps.projectStore.deleteSubtask(
      String(projectId ?? ''), group.id, String(taskId ?? ''), String(subtaskId ?? ''),
    ))
  })

  route('/api/agentlex/add-project-checklist-item', async (body, res) => {
    const { projectId, taskId, text } = body
    const group = await findGroupByTaskId(deps, String(projectId ?? ''), String(taskId ?? ''))
    ok(res, await deps.projectStore.addChecklistItem(
      String(projectId ?? ''), group.id, String(taskId ?? ''), String(text ?? ''),
    ))
  })

  route('/api/agentlex/toggle-project-checklist-item', async (body, res) => {
    const { projectId, taskId, itemId } = body
    const group = await findGroupByTaskId(deps, String(projectId ?? ''), String(taskId ?? ''))
    ok(res, await deps.projectStore.toggleChecklist(
      String(projectId ?? ''), group.id, String(taskId ?? ''), String(itemId ?? ''),
    ))
  })

  route('/api/agentlex/delete-project-checklist-item', async (body, res) => {
    const { projectId, taskId, itemId } = body
    const group = await findGroupByTaskId(deps, String(projectId ?? ''), String(taskId ?? ''))
    ok(res, await deps.projectStore.deleteChecklistItem(
      String(projectId ?? ''), group.id, String(taskId ?? ''), String(itemId ?? ''),
    ))
  })

  return () => {
    for (const dispose of disposers.splice(0)) dispose()
  }
}
