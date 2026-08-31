import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context, Events } from '@deepseek-ai/cordis'
import type { MemoItem, ApiResponse } from './store/types.ts'
import type { MemoStore } from './store/memo-store.ts'

export interface RouteDeps {
  memoStore: MemoStore
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

/** 收集返回给浏览器的 memo（不含内部字段）。 */
function toView(m: MemoItem): MemoItem {
  return m
}

export function makeRoutes(ctx: Context, deps: RouteDeps): () => void {
  const disposers: Array<() => void> = []

  const sseClients = new Set<ServerResponse>()
  const broadcast = (payload: unknown): void => {
    const data = `data: ${JSON.stringify(payload)}\n\n`
    for (const res of sseClients) {
      try { res.write(data) } catch { /* client gone */ }
    }
  }
  const onRegistryChanged = (payload: unknown): void => broadcast(payload)
  const disposeListener = ctx.on('agentlex:registry-changed' as keyof Events, onRegistryChanged)
  disposers.push(() => {
    disposeListener()
    for (const res of sseClients) { try { res.end() } catch { /* noop */ } }
    sseClients.clear()
  })

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/api/agentlex-memo/events-stream',
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

  // 健康检查
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/api/agentlex-memo/health',
    handler: async (_req: IncomingMessage, res: ServerResponse) => {
      ok(res, { ok: true, plugin: 'dsh-legal-suite/memo', status: 'ready' })
    },
  }))

  // 列表：可选 ?status=active|archived 与 ?tag=xxx（client 侧也自己筛，这里透传全量）。
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/api/agentlex-memo/memos',
    handler: async (_req: IncomingMessage, res: ServerResponse) => {
      try {
        const all = await deps.memoStore.listMemos()
        ok(res, all.map(toView))
      } catch (error) {
        fail(res, error)
      }
    },
  }))

  // 读取单条（按 id 或 ref）或创建/更新：
  //   GET  /api/agentlex-memo/memo?id=xxx | ?ref=xxx
  //   POST /api/agentlex-memo/memo  body: { id?, content, tags?, ref?, status? }
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/api/agentlex-memo/memo',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      try {
        if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
          const body = await readBody(req)
          if (body.content === undefined && body.id === undefined) return fail(res, 'content required')
          const memo = await deps.memoStore.upsertMemo(body)
          return ok(res, toView(memo))
        }
        const url = new URL(req.url ?? '/', 'http://localhost')
        const id = url.searchParams.get('id') ?? ''
        const ref = url.searchParams.get('ref') ?? ''
        const all = await deps.memoStore.listMemos()
        let memo: MemoItem | undefined
        if (id !== '') memo = all.find((m) => m.id === id)
        else if (ref !== '') memo = all.find((m) => m.ref === ref)
        if (memo === undefined) return fail(res, 'memo not found', 404)
        ok(res, toView(memo))
      } catch (error) {
        fail(res, error)
      }
    },
  }))

  // 归档 / 恢复：POST /api/agentlex-memo/archive  body: { id, archived }
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/api/agentlex-memo/archive',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const body = await readBody(req)
        const id = String(body.id ?? '')
        if (id === '') return fail(res, 'id required')
        const memo = await deps.memoStore.archiveMemo(id, String(body.archived) === 'true')
        ok(res, toView(memo))
      } catch (error) {
        fail(res, error)
      }
    },
  }))

  // 删除：POST /api/agentlex-memo/delete  body: { id }
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/api/agentlex-memo/delete',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const body = await readBody(req)
        const id = String(body.id ?? '')
        if (id === '') return fail(res, 'id required')
        ok(res, await deps.memoStore.deleteMemo(id))
      } catch (error) {
        fail(res, error)
      }
    },
  }))

  return () => {
    for (const dispose of disposers.splice(0)) dispose()
  }
}
