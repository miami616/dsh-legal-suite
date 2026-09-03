import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context, Events } from '@deepseek-ai/cordis'
import { aggregateUnifiedTasks } from './aggregate/unified.ts'
import type { TaskStore } from './store/task-store.ts'
import type { ApiResponse } from './store/types.ts'
import { registerLegacyCompatRoutes } from './legacy-compat.ts'
import { createCaseStore } from '../litigation/store/case-store.ts'
import { createProjectStore } from '../nonlitigation/store/project-store.ts'

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
    // the source case/project store (same shared ctx → broadcasts the change
    // to both the task panel and the source panel). Standalone tasks stay in
    // the task store.
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
      const patch: Record<string, unknown> = {}
      if (rawId !== undefined) patch.id = taskIdToEdit
      if (input.status !== undefined) patch.status = String(input.status)
      if (input.title !== undefined) patch.title = String(input.title)
      if (input.deadline !== undefined) patch.deadline = String(input.deadline)
      if (input.time !== undefined) patch.time = String(input.time)
      if (input.priority !== undefined) patch.priority = String(input.priority)
      if (input.detail !== undefined) patch.detail = String(input.detail)
      let newId: string
      if (source === 'litigation') {
        const caseStore = createCaseStore(d.litigationDir, ctx)
        const record = await caseStore.upsertTask(sourceId, groupId, patch)
        const created = (record.taskGroups ?? []).find((g) => g.id === groupId)?.tasks.at(-1)
        newId = rawId ?? created?.id ?? ''
        return ok(res, { id: newId, source, sourceId, ok: true, updatedAt: record.updatedAt })
      }
      const projectStore = createProjectStore(d.nonlitigationDir, ctx)
      const record = await projectStore.upsertTask(sourceId, groupId, patch)
      const created = (record.taskGroups ?? []).find((g) => g.id === groupId)?.tasks.at(-1)
      newId = rawId ?? created?.id ?? ''
      return ok(res, { id: newId, source, sourceId, ok: true, updatedAt: record.updatedAt })
    }

    ok(res, await d.taskStore.upsertTask(input))
  })

  route('/api/agentlex-task/delete-task', async (d, b, res) => {
    const id = String(b.id ?? '')
    if (id === '') return fail(res, 'id required')
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
