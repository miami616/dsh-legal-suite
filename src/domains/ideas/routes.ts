/**
 * HTTP route family for the ideas domain.
 *
 * /api/agentlex-ideas/* — 想法 CRUD、状态流转（done/archived）、按 id 解析
 * （供「#idea-xx」引用令牌）与 SSE 事件桥（host 变更 → 浏览器实时刷新）。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context, Events } from '@deepseek-ai/cordis'
import type { IdeaStore } from './store/idea-store.ts'
import type { ApiResponse } from './store/types.ts'
import { IDEAS_CHANGED_EVENT } from './store/idea-store.ts'

export interface RouteDeps {
  ideaStore: IdeaStore
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
  const sseClients = new Set<ServerResponse>()
  const broadcast = (payload: unknown): void => {
    const data = `data: ${JSON.stringify(payload)}\n\n`
    for (const res of sseClients) {
      try { res.write(data) } catch { /* client gone */ }
    }
  }
  const onChanged = (payload: unknown): void => broadcast(payload)
  const disposeListener = ctx.on(IDEAS_CHANGED_EVENT as keyof Events, onChanged)
  disposers.push(() => {
    disposeListener()
    for (const res of sseClients) { try { res.end() } catch { /* noop */ } }
    sseClients.clear()
  })
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/api/agentlex-ideas/events-stream',
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

  route('/api/agentlex-ideas/health', (_d, _b, res) => {
    ok(res, { ok: true, plugin: 'dsh-legal-suite/ideas', status: 'ready' })
  })

  /* 列表：默认返回全部；body 可传 status 过滤（active/done/archived）。 */
  route('/api/agentlex-ideas/ideas', async (d, b, res) => {
    const all = await d.ideaStore.listIdeas()
    const status = String(b.status ?? '')
    const data = status === '' || status === 'all'
      ? all
      : all.filter((i) => i.status === status)
    ok(res, data)
  })

  /* 单条解析：按 id 或按 id 令牌（去掉 #idea- 前缀）。 */
  route('/api/agentlex-ideas/resolve', async (d, b, res) => {
    let raw = String(b.id ?? b.token ?? '')
    if (raw.startsWith('#')) raw = raw.slice(1)
    if (raw.startsWith('idea-')) raw = raw.slice('idea-'.length)
    if (raw === '') return fail(res, 'id or token required')
    // 兼容完整 id 或仅尾部令牌：先按完整 id 查，再按前缀匹配。
    let idea = await d.ideaStore.getIdea(raw)
    if (idea === undefined) {
      const all = await d.ideaStore.listIdeas()
      idea = all.find((i) => i.id === raw || i.id.endsWith(raw))
    }
    if (idea === undefined) return fail(res, `idea not found: ${raw}`, 404)
    ok(res, idea)
  })

  /* 增/改：无 id 创建，带 id 更新。 */
  route('/api/agentlex-ideas/idea', async (d, b, res) => {
    const { ideaId: alias, ...input } = b
    if (alias !== undefined) input.id = String(alias)
    ok(res, await d.ideaStore.upsertIdea(input))
  })

  /* 状态流转：active / done / archived。 */
  route('/api/agentlex-ideas/status', async (d, b, res) => {
    const id = String(b.id ?? '')
    const status = String(b.status ?? '')
    if (id === '') return fail(res, 'id required')
    if (status !== 'active' && status !== 'done' && status !== 'archived') {
      return fail(res, `invalid status: ${status}`)
    }
    ok(res, await d.ideaStore.setStatus(id, status as 'active' | 'done' | 'archived'))
  })

  route('/api/agentlex-ideas/delete-idea', async (d, b, res) => {
    const id = String(b.id ?? '')
    if (id === '') return fail(res, 'id required')
    ok(res, await d.ideaStore.deleteIdea(id))
  })

  return () => {
    for (const dispose of disposers.splice(0)) dispose()
  }
}
