import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context, Events } from '@deepseek-ai/cordis'
import { aggregateUnifiedTasks } from './aggregate/unified.ts'
import type { TaskStore } from './store/task-store.ts'
import type { ApiResponse } from './store/types.ts'
import { registerLegacyCompatRoutes } from './legacy-compat.ts'

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
