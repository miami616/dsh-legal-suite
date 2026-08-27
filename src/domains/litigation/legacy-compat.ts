/**
 * Legacy AgentLex renderer compatibility routes — litigation domain.
 *
 * 适配器消化：旧渲染层（OriginalLitigationPanel 等）仍经 `/api/agentlex/*` 读
 * 写数据，这套兼容面按域归位——本文件承载诉讼域（案件 / 日程 / 时间轴 / 案件
 * 任务树 / 清单 / 案件文件夹文件服务）。与原生路由共用同一批 store，直接调用，
 * 不再经 HTTP 环回；跨域聚合 /read 与 chat 桥分别归套件层与退役。
 *
 * 语义与旧 dsh-adapter 完全一致（camelCase 请求体、group 查找、toLegacy 形状）。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { RouteDeps } from './routes.ts'
import { buildFolderTree, downloadFile, expandFolder, openPath, readPreviewFile } from './file-service.ts'

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

/** Map a legacy task status to the DSH plugin status. */
function toPluginStatus(status: unknown): string {
  if (status === 'in_progress') return 'doing'
  return String(status ?? 'todo')
}

/** Map a DSH plugin status to the legacy renderer status. */
function toLegacyStatus(status: unknown): string {
  if (status === 'doing') return 'in_progress'
  return String(status ?? 'todo')
}

/** Convert a legacy task group to the plugin shape before writing. */
function toPluginGroup(group: Record<string, unknown>): Record<string, unknown> {
  const g = { ...group }
  if (g.title !== undefined && g.name === undefined) g.name = g.title
  return g
}

/** Convert a legacy task to the plugin shape before writing. */
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

/** Normalize a task group from plugin shape to legacy shape. */
function normalizeGroup(group: Record<string, unknown>): Record<string, unknown> {
  const g = { ...group }
  if (g.name !== undefined && g.title === undefined) g.title = g.name
  if (Array.isArray(g.tasks)) {
    g.tasks = g.tasks.map((t) => normalizeTask(t as Record<string, unknown>))
  }
  return g
}

/** Normalize a task from plugin shape to legacy shape. */
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

/** Normalize a DSH case record to the legacy renderer shape. */
function toLegacyCase(record: Record<string, unknown>): Record<string, unknown> {
  return {
    ...record,
    alias: Array.isArray(record.alias) ? record.alias : [],
    keyDates: Array.isArray(record.keyDates) ? record.keyDates : [],
    boundSessions: Array.isArray(record.boundSessions) ? record.boundSessions : [],
    linkedContracts: Array.isArray(record.linkedContracts) ? record.linkedContracts : [],
    linkedResearch: Array.isArray(record.linkedResearch) ? record.linkedResearch : [],
    taskGroups: Array.isArray(record.taskGroups) ? record.taskGroups : [],
    tags: Array.isArray(record.tags) ? record.tags : [],
  }
}

/** Normalize a DSH schedule item to the legacy renderer shape. */
function toLegacySchedule(item: Record<string, unknown>): Record<string, unknown> {
  return {
    id: String(item.id ?? ''),
    title: String(item.title ?? ''),
    date: String(item.date ?? ''),
    time: item.time === undefined ? undefined : String(item.time),
    caseId: item.caseId === undefined || item.caseId === null ? null : String(item.caseId),
    caseName: item.caseName === undefined ? undefined : String(item.caseName),
    priority: item.priority === undefined ? undefined : String(item.priority),
    completed: Boolean(item.completed ?? item.done ?? false),
    source: item.source === undefined ? 'manual' : String(item.source),
    createdAt: item.createdAt === undefined ? undefined : String(item.createdAt),
    reminderLeadMinutes: item.reminderLeadMinutes === undefined ? undefined : Number(item.reminderLeadMinutes),
    taskId: item.taskId === undefined ? undefined : String(item.taskId),
    externalId: item.externalId === undefined ? undefined : String(item.externalId),
    externalSystem: item.externalSystem === undefined ? undefined : String(item.externalSystem),
  }
}

/** Normalize a DSH timeline event to the legacy renderer shape. */
function toLegacyTimelineEvent(event: Record<string, unknown>): Record<string, unknown> {
  return {
    ...event,
    id: String(event.id ?? ''),
    caseId: String(event.caseId ?? ''),
    type: String(event.type ?? 'case_event'),
    date: String(event.date ?? ''),
    status: event.status === undefined ? 'pending' : String(event.status),
    remindRules: Array.isArray(event.remindRules) ? event.remindRules : [],
  }
}

/** Find the case task-group containing `taskId` (legacy update/delete flows). */
async function findGroupByTaskId(
  deps: RouteDeps,
  caseId: string,
  taskId: string,
): Promise<{ id: string }> {
  const record = await deps.caseStore.readCase(caseId)
  if (record === undefined) throw new Error(`case not found: ${caseId}`)
  const groups = (record.taskGroups ?? []) as Array<{ id: string; tasks?: Array<{ id: string }> }>
  const group = groups.find((g) => g.tasks?.some((t) => t.id === taskId))
  if (group === undefined) throw new Error(`task not found: ${taskId}`)
  return { id: group.id }
}

/* --------------------------- route family --------------------------- */

/** Register the litigation-domain legacy `/api/agentlex/*` routes. */
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

  /* ------------------------------- cases ------------------------------ */
  route('/api/agentlex/read-case', async (body, res) => {
    const record = await deps.caseStore.readCase(String(body.caseId ?? ''))
    if (record === undefined) throw new Error(`case not found: ${String(body.caseId ?? '')}`)
    const legacy = toLegacyCase(record as unknown as Record<string, unknown>)
    if (Array.isArray(legacy.taskGroups)) {
      legacy.taskGroups = legacy.taskGroups.map((g) => normalizeGroup(g as Record<string, unknown>))
    }
    ok(res, legacy)
  })

  route('/api/agentlex/register-case', async (body, res) => {
    ok(res, toLegacyCase(await deps.caseStore.registerCase(body) as unknown as Record<string, unknown>))
  })

  route('/api/agentlex/update-case', async (body, res) => {
    const { caseId, ...patch } = body
    ok(res, toLegacyCase(await deps.caseStore.updateCase(String(caseId ?? ''), patch) as unknown as Record<string, unknown>))
  })

  route('/api/agentlex/delete-case', async (body, res) => {
    ok(res, await deps.caseStore.deleteCase(String(body.caseId ?? '')))
  })

  /* ------------------------------ schedules --------------------------- */
  route('/api/agentlex/add-schedule', async (body, res) => {
    ok(res, await deps.scheduleStore.upsertItem(body as never))
  })

  route('/api/agentlex/update-schedule', async (body, res) => {
    const id = String(body.id ?? '')
    const patch = (body.patch ?? {}) as Record<string, unknown>
    const schedules = await deps.scheduleStore.listItems()
    const existing = schedules.find((s) => s.id === id)
    if (existing === undefined) throw new Error(`schedule not found: ${id}`)
    ok(res, await deps.scheduleStore.upsertItem({ ...existing, ...patch, id } as never))
  })

  route('/api/agentlex/delete-schedule', async (body, res) => {
    ok(res, await deps.scheduleStore.deleteItem(String(body.id ?? '')))
  })

  route('/api/agentlex/toggle-schedule', async (body, res) => {
    ok(res, await deps.scheduleStore.toggleItem(String(body.id ?? '')))
  })

  /* ------------------------------ timeline ---------------------------- */
  route('/api/agentlex/add-timeline-event', async (body, res) => {
    ok(res, await deps.timelineStore.upsertEvent(body as never))
  })

  route('/api/agentlex/update-timeline-event', async (body, res) => {
    const eventId = String(body.eventId ?? '')
    const patch = (body.patch ?? {}) as Record<string, unknown>
    const events = await deps.timelineStore.listEvents()
    const existing = events.find((e) => e.id === eventId)
    if (existing === undefined) throw new Error(`timeline event not found: ${eventId}`)
    ok(res, await deps.timelineStore.upsertEvent({ ...existing, ...patch, id: eventId } as never))
  })

  route('/api/agentlex/delete-timeline-event', async (body, res) => {
    ok(res, await deps.timelineStore.deleteEvent(String(body.eventId ?? '')))
  })

  route('/api/agentlex/toggle-timeline-event', async (body, res) => {
    ok(res, await deps.timelineStore.toggleEvent(String(body.eventId ?? '')))
  })

  /* ------------------------- case task tree ---------------------------- */
  route('/api/agentlex/add-task-group', async (body, res) => {
    const { caseId, ...group } = body
    ok(res, await deps.caseStore.upsertTaskGroup(String(caseId ?? ''), toPluginGroup(group)))
  })

  route('/api/agentlex/update-task-group', async (body, res) => {
    const { caseId, groupId, patch } = body
    const group = { id: String(groupId ?? ''), ...(patch as Record<string, unknown>) }
    ok(res, await deps.caseStore.upsertTaskGroup(String(caseId ?? ''), toPluginGroup(group)))
  })

  route('/api/agentlex/delete-task-group', async (body, res) => {
    ok(res, await deps.caseStore.deleteTaskGroup(String(body.caseId ?? ''), String(body.groupId ?? '')))
  })

  route('/api/agentlex/reorder-task-groups', async (body, res) => {
    ok(res, await deps.caseStore.reorderTaskGroups(
      String(body.caseId ?? ''),
      Array.isArray(body.orderedIds) ? body.orderedIds.map(String) : [],
    ))
  })

  route('/api/agentlex/add-task', async (body, res) => {
    const { caseId, groupId, ...task } = body
    ok(res, await deps.caseStore.upsertTask(String(caseId ?? ''), String(groupId ?? ''), toPluginTask(task)))
  })

  route('/api/agentlex/update-task', async (body, res) => {
    const { caseId, taskId, patch } = body
    const task = { id: String(taskId ?? ''), ...(patch as Record<string, unknown>) }
    const group = await findGroupByTaskId(deps, String(caseId ?? ''), String(taskId ?? ''))
    ok(res, await deps.caseStore.upsertTask(String(caseId ?? ''), group.id, toPluginTask(task)))
  })

  route('/api/agentlex/delete-task', async (body, res) => {
    const { caseId, taskId } = body
    const group = await findGroupByTaskId(deps, String(caseId ?? ''), String(taskId ?? ''))
    ok(res, await deps.caseStore.deleteTask(String(caseId ?? ''), group.id, String(taskId ?? '')))
  })

  route('/api/agentlex/move-task', async (body, res) => {
    ok(res, await deps.caseStore.moveTask(
      String(body.caseId ?? ''),
      String(body.taskId ?? ''),
      String(body.targetGroupId ?? body.toGroupId ?? ''),
      typeof body.index === 'number' ? body.index : undefined,
    ))
  })

  route('/api/agentlex/add-subtask', async (body, res) => {
    const { caseId, taskId, ...subtask } = body
    const group = await findGroupByTaskId(deps, String(caseId ?? ''), String(taskId ?? ''))
    ok(res, await deps.caseStore.upsertSubtask(
      String(caseId ?? ''), group.id, String(taskId ?? ''), toPluginTask(subtask),
    ))
  })

  route('/api/agentlex/update-subtask', async (body, res) => {
    const { caseId, taskId, subtaskId, patch } = body
    const group = await findGroupByTaskId(deps, String(caseId ?? ''), String(taskId ?? ''))
    const subtask = { id: String(subtaskId ?? ''), ...(patch as Record<string, unknown>) }
    ok(res, await deps.caseStore.upsertSubtask(
      String(caseId ?? ''), group.id, String(taskId ?? ''), toPluginTask(subtask),
    ))
  })

  route('/api/agentlex/delete-subtask', async (body, res) => {
    const { caseId, taskId, subtaskId } = body
    const group = await findGroupByTaskId(deps, String(caseId ?? ''), String(taskId ?? ''))
    ok(res, await deps.caseStore.deleteSubtask(
      String(caseId ?? ''), group.id, String(taskId ?? ''), String(subtaskId ?? ''),
    ))
  })

  route('/api/agentlex/add-checklist-item', async (body, res) => {
    const { caseId, taskId, text } = body
    const group = await findGroupByTaskId(deps, String(caseId ?? ''), String(taskId ?? ''))
    // 映射到原生 checklist 模型（task.checklist 数组）；旧适配器经 /subtask 传
    // {checklist} 会生成空标题子任务并丢弃条目，此处一并修正。
    ok(res, await deps.caseStore.upsertChecklist(
      String(caseId ?? ''), group.id, String(taskId ?? ''), { text: String(text ?? '') },
    ))
  })

  route('/api/agentlex/toggle-checklist-item', async (body, res) => {
    const { caseId, taskId, itemId } = body
    const group = await findGroupByTaskId(deps, String(caseId ?? ''), String(taskId ?? ''))
    ok(res, await deps.caseStore.toggleChecklist(
      String(caseId ?? ''), group.id, String(taskId ?? ''), String(itemId ?? ''),
    ))
  })

  // The litigation plugin has no delete-checklist route; best-effort no-op.
  route('/api/agentlex/delete-checklist-item', async (_body, res) => {
    ok(res, { ok: true })
  })

  /* ------------------------- case folder file service ------------------- */
  route('/api/agentlex/folder-tree', async (body, res) => {
    const root = String(body.path ?? '')
    if (root === '') return fail(res, 'path required')
    ok(res, await buildFolderTree(root))
  })

  route('/api/agentlex/folder-expand', async (body, res) => {
    const root = String(body.path ?? '')
    const dir = String(body.dir ?? '')
    if (root === '' || dir === '') return fail(res, 'path/dir required')
    ok(res, await expandFolder(root, dir))
  })

  route('/api/agentlex/file-preview', async (body, res) => {
    const root = String(body.path ?? '')
    const file = String(body.file ?? '')
    if (root === '' || file === '') return fail(res, 'path/file required')
    ok(res, await readPreviewFile(root, file))
  })

  route('/api/agentlex/file-download', async (body, res) => {
    const root = String(body.path ?? '')
    const file = String(body.file ?? '')
    if (root === '' || file === '') return fail(res, 'path/file required')
    ok(res, await downloadFile(root, file))
  })

  route('/api/agentlex/open-path', async (body, res) => {
    const root = String(body.path ?? '')
    const file = body.file === undefined ? undefined : String(body.file)
    const kind = body.kind === 'finder' ? 'finder' : 'default'
    if (root === '') return fail(res, 'path required')
    openPath(root, file, kind)
    ok(res, { ok: true })
  })

  return () => {
    for (const dispose of disposers.splice(0)) dispose()
  }
}
