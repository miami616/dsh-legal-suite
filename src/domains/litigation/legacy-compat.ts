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
    // 0.2.2：任务组从 items 重建（registry taskGroups 下岗）。
    if (deps.itemStore !== undefined) {
      const { hydrateCaseTaskGroups } = await import('./task-view.ts')
      const hydrated = await hydrateCaseTaskGroups(record, deps.caseStore, deps.itemStore)
      legacy.taskGroups = Array.isArray(hydrated.taskGroups) ? hydrated.taskGroups.map((g) => normalizeGroup(g as unknown as Record<string, unknown>)) : []
      ok(res, legacy)
      return
    }
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
    const caseId = String(body.caseId ?? '')
    // 级联删除（与原生 /api/agentlex-case/delete-case 一致）：案件 + items +
    // task-groups + legacy timeline/schedules 孤儿（备忘录 #3：删除后编号残留）。
    if (deps.itemStore !== undefined) {
      const { cascadeDeleteCase } = await import('./cascade-delete.ts')
      ok(res, await cascadeDeleteCase({
        caseStore: deps.caseStore,
        timelineStore: deps.timelineStore,
        scheduleStore: deps.scheduleStore,
        itemStore: deps.itemStore,
      }, caseId))
      return
    }
    ok(res, await deps.caseStore.deleteCase(caseId))
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
  // 0.2.2：时间轴事件统一写 items（type=event），case-timeline.json 退役。
  route('/api/agentlex/add-timeline-event', async (body, res) => {
    if (deps.itemStore !== undefined) {
      const created = await deps.itemStore.upsertItem({
        ownerId: String(body.caseId ?? ''),
        ownerType: 'litigation',
        type: 'event',
        title: String(body.title ?? body.label ?? '新事件'),
        detail: body.detail === undefined ? undefined : String(body.detail),
        date: body.date === undefined ? undefined : String(body.date),
        time: body.time === undefined ? undefined : String(body.time),
        status: (body.status === 'done' || body.status === 'completed' ? 'done' : body.status === 'cancelled' ? 'cancelled' : 'pending') as never,
        ...(body.eventId !== undefined ? { id: String(body.eventId) } : {}),
      })
      ok(res, created)
      return
    }
    ok(res, await deps.timelineStore.upsertEvent(body as never))
  })

  route('/api/agentlex/update-timeline-event', async (body, res) => {
    const eventId = String(body.eventId ?? '')
    const patch = (body.patch ?? {}) as Record<string, unknown>
    if (deps.itemStore !== undefined) {
      const existing = await deps.itemStore.readItem(eventId)
      if (existing === undefined) throw new Error(`timeline event not found: ${eventId}`)
      const input: Record<string, unknown> = { id: eventId, type: 'event' }
      if (patch.title !== undefined) input.title = String(patch.title)
      if (patch.detail !== undefined) input.detail = String(patch.detail)
      if (patch.date !== undefined) input.date = String(patch.date)
      if (patch.time !== undefined) input.time = patch.time === '' ? undefined : String(patch.time)
      if (patch.status !== undefined) input.status = (patch.status === 'completed' ? 'done' : patch.status === 'cancelled' ? 'cancelled' : patch.status === 'done' ? 'done' : existing.status) as never
      ok(res, await deps.itemStore.upsertItem(input as never))
      return
    }
    const events = await deps.timelineStore.listEvents()
    const existing = events.find((e) => e.id === eventId)
    if (existing === undefined) throw new Error(`timeline event not found: ${eventId}`)
    ok(res, await deps.timelineStore.upsertEvent({ ...existing, ...patch, id: eventId } as never))
  })

  route('/api/agentlex/delete-timeline-event', async (body, res) => {
    const eventId = String(body.eventId ?? '')
    if (deps.itemStore !== undefined) {
      const existing = await deps.itemStore.readItem(eventId)
      if (existing !== undefined && existing.type !== 'task') {
        ok(res, await deps.itemStore.deleteItem(eventId))
        return
      }
    }
    ok(res, await deps.timelineStore.deleteEvent(eventId))
  })

  route('/api/agentlex/toggle-timeline-event', async (body, res) => {
    const eventId = String(body.eventId ?? '')
    if (deps.itemStore !== undefined) {
      const existing = await deps.itemStore.readItem(eventId)
      if (existing !== undefined && existing.type !== 'task') {
        ok(res, await deps.itemStore.toggleItem(eventId))
        return
      }
    }
    ok(res, await deps.timelineStore.toggleEvent(eventId))
  })

  /* ------------------------- case task tree ---------------------------- */
  // 0.2.2：任务组/任务/子任务/检查项全部写统一事项 items.json（唯一真相源），
  // 不再写 case-registry 的 taskGroups（旧 GUI 勾子任务/检查项曾写旧库再分裂）。
  route('/api/agentlex/add-task-group', async (body, res) => {
    const caseId = String(body.caseId ?? '')
    const group: Record<string, unknown> = { ownerId: caseId, ownerType: 'litigation', ...body }
    delete group.caseId
    if (group.title !== undefined && group.name === undefined) group.name = group.title
    if (deps.itemStore !== undefined) {
      const created = await deps.itemStore.upsertGroup(group as never)
      ok(res, { ...created, title: created.name })
      return
    }
    ok(res, await deps.caseStore.upsertTaskGroup(caseId, toPluginGroup(group)))
  })

  route('/api/agentlex/update-task-group', async (body, res) => {
    const caseId = String(body.caseId ?? '')
    const groupId = String(body.groupId ?? '')
    const patch = (body.patch ?? {}) as Record<string, unknown>
    if (deps.itemStore !== undefined) {
      const input: Record<string, unknown> = { id: groupId, ownerId: caseId, ownerType: 'litigation' }
      if (patch.title !== undefined) input.name = String(patch.title)
      else if (patch.name !== undefined) input.name = String(patch.name)
      if (patch.order !== undefined) input.order = Number(patch.order)
      const updated = await deps.itemStore.upsertGroup(input as never)
      ok(res, { ...updated, title: updated.name })
      return
    }
    const group = { id: groupId, ...patch }
    ok(res, await deps.caseStore.upsertTaskGroup(caseId, toPluginGroup(group)))
  })

  route('/api/agentlex/delete-task-group', async (body, res) => {
    const caseId = String(body.caseId ?? '')
    const groupId = String(body.groupId ?? '')
    if (deps.itemStore !== undefined) {
      // deleteGroup 同时清理组内任务（0.2.2 store 语义）。
      ok(res, await deps.itemStore.deleteGroup(groupId))
      return
    }
    ok(res, await deps.caseStore.deleteTaskGroup(caseId, groupId))
  })

  route('/api/agentlex/reorder-task-groups', async (body, res) => {
    const caseId = String(body.caseId ?? '')
    const orderedIds = Array.isArray(body.orderedIds) ? body.orderedIds.map(String) : []
    if (deps.itemStore !== undefined) {
      const groups = await deps.itemStore.listGroups(caseId)
      const byId = new Map(groups.map((g) => [g.id, g]))
      for (let i = 0; i < orderedIds.length; i++) {
        const g = byId.get(orderedIds[i])
        if (g !== undefined && g.order !== i) await deps.itemStore.upsertGroup({ id: g.id, order: i })
      }
      ok(res, { ok: true })
      return
    }
    ok(res, await deps.caseStore.reorderTaskGroups(caseId, orderedIds))
  })

  route('/api/agentlex/add-task', async (body, res) => {
    const caseId = String(body.caseId ?? '')
    const groupId = String(body.groupId ?? '')
    const { caseId: _c, groupId: _g, ...task } = body
    if (deps.itemStore !== undefined) {
      // 旧 GUI 状态 in_progress/todo/done → 统一事项 pending/doing/done。
      const created = await deps.itemStore.upsertItem({
        ownerId: caseId,
        ownerType: 'litigation',
        type: 'task',
        title: String(task.title ?? task.taskTitle ?? '新任务'),
        detail: task.detail === undefined ? undefined : String(task.detail),
        date: task.deadline === undefined ? undefined : String(task.deadline),
        time: task.time === undefined ? undefined : String(task.time),
        priority: (task.priority as never) ?? 'medium',
        status: (task.status === 'done' ? 'done' : task.status === 'doing' || task.status === 'in_progress' ? 'doing' : task.status === 'todo' ? 'pending' : undefined) as never,
        groupId: groupId || undefined,
        ...(task.id !== undefined ? { id: String(task.id) } : {}),
        // 组名随任务冗余（展示用）。
        ...(groupId !== undefined ? { groupName: (await deps.itemStore.listGroups(caseId)).find((g) => g.id === groupId)?.name } : {}),
      })
      ok(res, { ...created, title: created.title })
      return
    }
    ok(res, await deps.caseStore.upsertTask(caseId, groupId, toPluginTask(task)))
  })

  route('/api/agentlex/update-task', async (body, res) => {
    const caseId = String(body.caseId ?? '')
    const taskId = String(body.taskId ?? '')
    const patch = (body.patch ?? {}) as Record<string, unknown>
    if (deps.itemStore !== undefined) {
      const existing = await deps.itemStore.readItem(taskId)
      if (existing === undefined) throw new Error(`task not found: ${taskId}`)
      const input: Record<string, unknown> = { id: taskId, ownerId: caseId, ownerType: 'litigation' }
      if (patch.title !== undefined) input.title = String(patch.title)
      if (patch.detail !== undefined) input.detail = String(patch.detail)
      if (patch.deadline !== undefined) input.date = patch.deadline === '' || patch.deadline === null ? undefined : String(patch.deadline)
      if (patch.time !== undefined) input.time = patch.time === '' ? undefined : String(patch.time)
      if (patch.priority !== undefined) input.priority = String(patch.priority)
      if (patch.status !== undefined) {
        input.status = (patch.status === 'done' ? 'done' : patch.status === 'doing' || patch.status === 'in_progress' ? 'doing' : patch.status === 'todo' ? 'pending' : existing.status) as never
      }
      if (patch.folder !== undefined) input.detail = String(patch.folder) // folder 无 items 字段 → 并入 detail 备注
      const updated = await deps.itemStore.upsertItem(input as never)
      ok(res, updated)
      return
    }
    const task = { id: taskId, ...patch }
    const group = await findGroupByTaskId(deps, caseId, taskId)
    ok(res, await deps.caseStore.upsertTask(caseId, group.id, toPluginTask(task)))
  })

  route('/api/agentlex/delete-task', async (body, res) => {
    const caseId = String(body.caseId ?? '')
    const taskId = String(body.taskId ?? '')
    if (deps.itemStore !== undefined) {
      ok(res, await deps.itemStore.deleteItem(taskId))
      return
    }
    const group = await findGroupByTaskId(deps, caseId, taskId)
    ok(res, await deps.caseStore.deleteTask(caseId, group.id, taskId))
  })

  route('/api/agentlex/move-task', async (body, res) => {
    const caseId = String(body.caseId ?? '')
    const taskId = String(body.taskId ?? '')
    const toGroupId = String(body.targetGroupId ?? body.toGroupId ?? '')
    if (deps.itemStore !== undefined) {
      const [item, groups] = await Promise.all([deps.itemStore.readItem(taskId), deps.itemStore.listGroups(caseId)])
      if (item === undefined) throw new Error(`task not found: ${taskId}`)
      const toGroup = groups.find((g) => g.id === toGroupId)
      await deps.itemStore.upsertItem({ id: taskId, groupId: toGroupId, groupName: toGroup?.name, ownerId: caseId, ownerType: 'litigation' })
      ok(res, { ok: true })
      return
    }
    ok(res, await deps.caseStore.moveTask(caseId, taskId, toGroupId, typeof body.index === 'number' ? body.index : undefined))
  })

  route('/api/agentlex/add-subtask', async (body, res) => {
    const caseId = String(body.caseId ?? '')
    const taskId = String(body.taskId ?? '')
    const { caseId: _c, taskId: _t, title, deadline, done, ...subtask } = body
    if (deps.itemStore !== undefined) {
      const created = await deps.itemStore.addSubtask(taskId, {
        title: String(title ?? subtask.subtaskTitle ?? '子任务'),
        deadline: deadline === undefined ? undefined : String(deadline),
        done: done === true || subtask.status === 'done' || subtask.status === 'in_progress' ? done === true || subtask.status === 'done' : undefined,
      })
      ok(res, created)
      return
    }
    const group = await findGroupByTaskId(deps, caseId, taskId)
    ok(res, await deps.caseStore.upsertSubtask(caseId, group.id, taskId, toPluginTask(subtask as Record<string, unknown>)))
  })

  route('/api/agentlex/update-subtask', async (body, res) => {
    const caseId = String(body.caseId ?? '')
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
    const group = await findGroupByTaskId(deps, caseId, taskId)
    const subtask = { id: subtaskId, ...patch }
    ok(res, await deps.caseStore.upsertSubtask(caseId, group.id, taskId, toPluginTask(subtask as Record<string, unknown>)))
  })

  route('/api/agentlex/delete-subtask', async (body, res) => {
    const caseId = String(body.caseId ?? '')
    const taskId = String(body.taskId ?? '')
    const subtaskId = String(body.subtaskId ?? '')
    if (deps.itemStore !== undefined) {
      ok(res, await deps.itemStore.deleteSubtask(taskId, subtaskId))
      return
    }
    const group = await findGroupByTaskId(deps, caseId, taskId)
    ok(res, await deps.caseStore.deleteSubtask(caseId, group.id, taskId, subtaskId))
  })

  route('/api/agentlex/add-checklist-item', async (body, res) => {
    const caseId = String(body.caseId ?? '')
    const taskId = String(body.taskId ?? '')
    const text = String(body.text ?? '')
    if (deps.itemStore !== undefined) {
      const created = await deps.itemStore.addChecklist(taskId, { text })
      ok(res, created)
      return
    }
    const group = await findGroupByTaskId(deps, caseId, taskId)
    ok(res, await deps.caseStore.upsertChecklist(caseId, group.id, taskId, { text }))
  })

  route('/api/agentlex/toggle-checklist-item', async (body, res) => {
    const caseId = String(body.caseId ?? '')
    const taskId = String(body.taskId ?? '')
    const itemId = String(body.itemId ?? '')
    const done = body.done === undefined ? undefined : body.done === true
    if (deps.itemStore !== undefined) {
      ok(res, await deps.itemStore.toggleChecklist(taskId, itemId, done))
      return
    }
    const group = await findGroupByTaskId(deps, caseId, taskId)
    ok(res, await deps.caseStore.toggleChecklist(caseId, group.id, taskId, itemId))
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
