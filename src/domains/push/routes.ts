/**
 * Host half route family: /api/agentlex-push/*.
 *
 * Same-origin POST with a JSON body; envelope { success, data|error, hint? }.
 * These routes let the browser half read/write the push config, enumerate the
 * dsh-im delivery targets, send a test message, and trigger a manual push run.
 *
 * Security: loopback-only binding is enforced by the webServer service's host
 * config; bodies are treated as untrusted and cloned.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { PushStore } from './store/push-config.ts'
import type { DshImService } from './push.ts'
import { runDeadlinePush } from './push.ts'

/** Route prefix for the whole family. */
export const API_PREFIX = '/api/agentlex-push'

/** Services the routes need. */
export interface PushRouteDeps {
  /** The push store (config + ledger). */
  store: PushStore
  /** The dsh-im delivery service (in-process or HTTP fallback). */
  dshIm?: DshImService
  /** The litigation data directory (reads case-registry.json / case-timeline.json). */
  litigationDataDir: string
}

/** Parse the request body as a JSON object (untrusted → {} on failure). */
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

/** Send a JSON response with the envelope. */
function sendJson(res: ServerResponse, status: number, body: { success: boolean; data?: unknown; error?: string; hint?: string }): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function ok<T>(res: ServerResponse, data: T): void {
  sendJson(res, 200, { success: true, data })
}

function fail(res: ServerResponse, error: unknown, status = 400, hint?: string): void {
  const message = error instanceof Error ? error.message : String(error)
  sendJson(res, status, { success: false, error: message, hint })
}

/**
 * Register the whole /api/agentlex-push route family on the webServer service.
 * @param ctx - host context (webServer injected).
 * @param deps - the stores/services backing the routes.
 * @returns disposer removing all routes.
 */
export function makeRoutes(ctx: Context, deps: PushRouteDeps): () => void {
  const disposers: Array<() => void> = []
  const registeredPaths = new Set<string>()

  function route(path: string, handler: (deps: PushRouteDeps, body: Record<string, unknown>, res: ServerResponse, method: string) => Promise<void> | void): void {
    if (registeredPaths.has(path)) {
      throw new Error(`duplicate route registration: ${path}`)
    }
    registeredPaths.add(path)
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        try {
          const body = await readBody(req)
          await handler(deps, body, res, req.method ?? 'GET')
        } catch (error) {
          fail(res, error)
        }
      },
    }))
  }

  // Read (GET) or write (POST) the push config.
  route(`${API_PREFIX}/config`, async (d, b, res, method) => {
    if (method === 'GET') {
      ok(res, await d.store.readConfig())
      return
    }
    const current = await d.store.readConfig()
    const next = { ...current }
    if (typeof b.enabled === 'boolean') next.enabled = b.enabled
    if (typeof b.botId === 'string') next.botId = b.botId.trim()
    if (typeof b.targetId === 'string') next.targetId = b.targetId.trim()
    if (typeof b.titlePrefix === 'string') next.titlePrefix = b.titlePrefix.trim()
    if (typeof b.testOnSave === 'boolean') next.testOnSave = b.testOnSave
    ok(res, await d.store.writeConfig(next))
  })

  // Enumerate the dsh-im delivery targets (for the settings dropdown).
  // Requires the in-process dsh-im service (dsh-im exposes no HTTP list-targets
  // endpoint); the HTTP fallback alone cannot enumerate targets.
  route(`${API_PREFIX}/targets`, async (d, b, res) => {
    if (d.dshIm === undefined || typeof d.dshIm.listTargets !== 'function') {
      ok(res, { available: false, targets: [] })
      return
    }
    const botId = typeof b.botId === 'string' ? b.botId.trim() : ''
    if (botId === '') {
      ok(res, { available: true, targets: [] })
      return
    }
    try {
      const result = await d.dshIm.listTargets(botId)
      const targets = result?.targets ?? []
      ok(res, { available: true, targets: targets.map((t) => ({ targetId: t.targetId, name: t.name })) })
    } catch (error) {
      ok(res, { available: true, targets: [], error: error instanceof Error ? error.message : String(error) })
    }
  })

  // Send a test message to the configured target.
  route(`${API_PREFIX}/test`, async (d, b, res) => {
    if (d.dshIm === undefined) {
      fail(res, 'dsh-im 未检测到：请先安装并接入 dsh-im（配置机器人 + 投递目标）', 501)
      return
    }
    const botId = typeof b.botId === 'string' ? b.botId.trim() : ''
    const targetId = typeof b.targetId === 'string' ? b.targetId.trim() : ''
    if (botId === '' || targetId === '') {
      fail(res, 'botId / targetId 不能为空', 400)
      return
    }
    const prefix = typeof b.titlePrefix === 'string' ? b.titlePrefix.trim() : ''
    const text = `${prefix}【期限提醒】测试消息：IM 推送配置已生效。`
    try {
      await d.dshIm.send(botId, targetId, text)
      ok(res, { sent: true })
    } catch (error) {
      fail(res, error, 502, '请检查 dsh-im 机器人是否在线、投递目标是否有效')
    }
  })

  // Trigger a manual push run now (for testing).
  route(`${API_PREFIX}/run`, async (d, b, res) => {
    if (d.dshIm === undefined) {
      fail(res, 'dsh-im 未检测到', 501)
      return
    }
    const cfg = await d.store.readConfig()
    if (typeof b.enabled === 'boolean') cfg.enabled = b.enabled
    if (typeof b.botId === 'string') cfg.botId = b.botId.trim()
    if (typeof b.targetId === 'string') cfg.targetId = b.targetId.trim()
    const result = await runDeadlinePush(d.litigationDataDir, cfg, d.store, d.dshIm)
    ok(res, result)
  })

  return () => { for (const dispose of disposers.splice(0).reverse()) dispose() }
}
