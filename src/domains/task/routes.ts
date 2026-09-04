import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context, Events } from '@deepseek-ai/cordis'
import { join } from 'node:path'
import { aggregateUnifiedTasks } from './aggregate/unified.ts'
import type { TaskStore } from './store/task-store.ts'
import type { ApiResponse } from './store/types.ts'
import { registerLegacyCompatRoutes } from './legacy-compat.ts'
import { createItemStore, type ItemStore } from '../item/store/item-store.ts'

export interface RouteDeps {
  taskStore: TaskStore
  litigationDir: string
  nonlitigationDir: string
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (raw.length === 0) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function sendJson(res: ServerResponse, status: number, body: ApiResponse): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function ok<T>(res: ServerResponse, data: T): void {
  sendJson(res, 200, { success: true, data })
}

function fail(res: ServerResponse, error: unknown, status = 400): void {
  const message = error instanceof Error ? error.message : String(error)
  sendJson(res, status, { success: false, error: message })
}

export function makeRoutes(ctx: Context, deps: RouteDeps): () => void {
  const disposers: Array<() => void> = []

  function route(path: string, handler: (deps: RouteDeps, body: Record<string, unknown>, res: ServerResponse) => Promise<void> | void): void {
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        try {
          const body = await readBody(req)
          await handler(deps, body, res)
        } catch (error) {
          fail(res, error)
        }
      },
    }))
  }

  /* ------------------- live-refresh SSE event bridge ------------------- */
  // Every store write broadcasts the host `agentlex:registry-changed` cordis
  // event; DSH does not bridge host events to the browser, so this SSE
  // endpoint forwards them to the client's EventSource (which re-dispatches
  // the window CustomEvent the panels listen for).
  const sseClients = new Set<ServerResponse>()
  const broadcast = (payload: unknown): void => {
    const data = `data: ${JSON.stringify(payload)}\n\n`
    for (const res of sseClients) {
      try { res.write(data) } catch { /* client gone; cleaned on close */ }
    }
  }
  const onRegistryChanged = (payload: unknown): void => broadcast(payload)
  const disposeRegistryListener = ctx.on('agentlex:registry-changed' as keyof Events, onRegistryChanged)
  disposers.push(() => {
    disposeRegistryListener()
    for (const res of sseClients) { try { res.end() } catch { /* noop */ } }
    sseClients.clear()
  })
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/api/agentlex-task/events-stream',
    handler: (req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      res.write('retry: 3000\n\n')
      sseClients.add(res)
      req.on('close', () => { sseClients.delete(res) })
    },
  }))

  route('/api/agentlex-task/health', (_d, _b, res) => {
    ok(res, { ok: true, plugin: 'dsh-legal-suite/task', status: 'ready' })
  })

  route('/api/agentlex-task/tasks', async (d, _b, res) => {
    ok(res, await d.taskStore.listTasks())
  })

  route('/api/agentlex-task/task', async (d, b, res) => {
    // Accept either `id` (browser / canonical) or `taskId` (transport) for the
    // upsert key, so an update never silently becomes a new standalone task.
    const { taskId, ...input } = b
    if (taskId !== undefined) input.id = String(taskId)

    // Write-through: a task sourced from litigation / non-litigation updates
    // the unified-item store (items.json — 0.2.2 唯一真相源). Standalone tasks
    // stay in the task store.
    const source = input.source === undefined ? undefined : String(input.source)
    if (source === 'litigation' || source === 'nonlitigation') {
      const sourceId = input.sourceId === undefined ? undefined : String(input.sourceId)
      const groupId = input.groupId === undefined ? undefined : String(input.groupId)
      // id 可缺省：未传 id = 新建任务，由来源 store 生成 id；传了 id = 更新。
      const rawId = input.id === undefined ? undefined : String(input.id)
      if (sourceId === undefined || groupId === undefined) {
        return fail(res, 'source write-through requires sourceId/groupId')
      }
      // The unified view spells the id as `<src>-<sourceId>-<taskId>`; strip the
      // prefix to recover the real task id in the source store.
      const prefix = `${source === 'litigation' ? 'lit' : 'nl'}-${sourceId}-`
      const taskIdToEdit = rawId !== undefined && rawId.startsWith(prefix) ? rawId.slice(prefix.length) : rawId
      const itemsDir = source === 'litigation'
        ? join(d.litigationDir, '..', 'items')
        : join(d.nonlitigationDir, '..', 'items')
      const itemStore: ItemStore = createItemStore(itemsDir, ctx)
      const ownerType = source === 'litigation' ? 'litigation' as const : 'nonlitigation' as const
      const existing = taskIdToEdit === undefined ? undefined : await itemStore.readItem(taskIdToEdit)
      // status 解析：调用方显式传了 status 则优先（任务面板勾选/状态切换必须能
      // 从 done 改回 doing/todo）；没传才沿用现有值。统一项 status 语义：
      // done/doing/pending。
      let resolvedStatus: 'pending' | 'doing' | 'done' | undefined
      const inStatus = input.status === undefined ? undefined : String(input.status)
      if (inStatus !== undefined) {
        if (inStatus === 'done') resolvedStatus = 'done'
        else if (inStatus === 'doing' || inStatus === 'in_progress') resolvedStatus = 'doing'
        else if (inStatus === 'todo' || inStatus === 'pending') resolvedStatus = 'pending'
      } else {
        resolvedStatus = existing?.status as 'pending' | 'doing' | 'done' | undefined
      }
      const created = await itemStore.upsertItem({
        id: taskIdToEdit,
        ownerId: sourceId,
        ownerType,
        type: (existing?.type === 'event' || existing?.type === 'both' ? existing.type : 'task'),
        title: input.title === undefined ? (existing?.title ?? '新事项') : String(input.title),
        detail: input.detail === undefined ? existing?.detail : String(input.detail),
        date: input.deadline === undefined ? (existing?.date ?? undefined) : String(input.deadline),
        time: input.time === undefined ? existing?.time : String(input.time),
        priority: (input.priority as never) ?? existing?.priority ?? 'medium',
        status: resolvedStatus,
        groupId,
        ...(groupId !== undefined ? { groupName: (await itemStore.listGroups(sourceId)).find((g) => g.id === groupId)?.name } : {}),
      })
      return ok(res, { id: created.id, source, sourceId, ok: true, updatedAt: created.updatedAt })
    }

    ok(res, await d.taskStore.upsertTask(input))
  })

  route('/api/agentlex-task/delete-task', async (d, b, res) => {
    const id = String(b.id ?? '')
    if (id === '') return fail(res, 'id required')
    const source = b.source === undefined ? undefined : String(b.source)
    const sourceId = b.sourceId === undefined ? undefined : String(b.sourceId)
    if ((source === 'litigation' || source === 'nonlitigation') && sourceId !== undefined) {
      // 0.2.2：案件/项目任务从统一事项 items 删除（唯一真相源）。
      const itemsDir = source === 'litigation'
        ? join(d.litigationDir, '..', 'items')
        : join(d.nonlitigationDir, '..', 'items')
      const itemStore: ItemStore = createItemStore(itemsDir, ctx)
      // 任务域视图 id 可能带 <src>-<sourceId>- 前缀 → 还原真实 item id。
      const prefix = `${source === 'litigation' ? 'lit' : 'nl'}-${sourceId}-`
      const realId = id.startsWith(prefix) ? id.slice(prefix.length) : id
      ok(res, await itemStore.deleteItem(realId))
      return
    }
    ok(res, await d.taskStore.deleteTask(id))
  })

  route('/api/agentlex-task/unified', async (d, _b, res) => {
    const standalone = await d.taskStore.listTasks()
    ok(res, await aggregateUnifiedTasks(d.litigationDir, d.nonlitigationDir, standalone))
  })

  // 适配器消化：任务域 legacy 兼容面（/api/agentlex/*）与原生路由共用同一批 store。
  disposers.push(registerLegacyCompatRoutes(ctx, deps))

  return () => {
    for (const dispose of disposers.splice(0)) dispose()
  }
}
