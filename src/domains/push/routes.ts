/**
 * Host half route family: /api/agentlex-push/*.
 *
 * Same-origin POST with a JSON body; envelope { success, data|error, hint? }.
 * These routes let the browser half read/write the push config, send a test
 * Feishu card, and trigger a manual push run.
 *
 * Security: loopback-only binding is enforced by the webServer service's host
 * config; bodies are treated as untrusted and cloned.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { PushStore } from './store/push-config.ts'
import { runDeadlinePush } from './push.ts'
import { sendDeadlineCard } from './feishu-card.ts'
import { isFeishuConfigured, loadFeishuConfig, saveFeishuConfig } from './feishu-config.ts'

/** Route prefix for the whole family. */
export const API_PREFIX = '/api/agentlex-push'

/** Services the routes need. */
export interface PushRouteDeps {
  /** The push store (config + ledger). */
  store: PushStore
  /** The litigation data directory (reads case-registry.json / items.json). */
  litigationDataDir: string
  /** The nonlitigation data directory (reads project-registry.json). */
  nonlitigationDataDir: string
  /** The task data directory (reads standalone-tasks.json). */
  tasksDataDir: string
  /** Called after a config write (e.g. push time changed) so the host can reschedule. */
  onConfigChange?: () => void
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
    if (typeof b.pushTime === 'string') next.pushTime = b.pushTime.trim()
    if (typeof b.titlePrefix === 'string') next.titlePrefix = b.titlePrefix.trim()
    ok(res, await d.store.writeConfig(next))
    // 配置变更（如推送时间）后让 host 重建定时器。
    d.onConfigChange?.()
  })

  // 飞书凭据配置：GET 返回是否已配置（不含 secret）；POST 保存 appId/appSecret/接收人。
  route(`${API_PREFIX}/feishu-config`, async (d, b, res, method) => {
    if (method === 'GET') {
      const configured = await isFeishuConfigured()
      let appId: string | undefined
      let ownerOpenId: string | undefined
      if (configured) {
        try {
          const bot = await loadFeishuConfig()
          appId = bot.appId
          ownerOpenId = bot.ownerOpenIds?.[0]
        } catch { /* 保持 undefined */ }
      }
      ok(res, { configured, appId, ownerOpenId })
      return
    }
    const appId = typeof b.appId === 'string' ? b.appId : ''
    const appSecret = typeof b.appSecret === 'string' ? b.appSecret : ''
    const ownerOpenId = typeof b.ownerOpenId === 'string' ? b.ownerOpenId : ''
    try {
      await saveFeishuConfig(appId, appSecret, ownerOpenId)
      ok(res, { configured: true, appId: appId.trim(), ownerOpenId: ownerOpenId.trim() })
    } catch (error) {
      fail(res, error, 400)
    }
  })

  // Send a test Feishu card to the bot owner.
  route(`${API_PREFIX}/test`, async (d, b, res) => {
    const prefix = typeof b.titlePrefix === 'string' ? b.titlePrefix.trim() : ''
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
    const today = new Date().toISOString().slice(0, 10)
    const sample: Array<Parameters<typeof sendDeadlineCard>[0][number]> = [
      { caseId: 'sample', caseName: '示例案件', caseNumber: '（2026）X民初XXXX号', court: 'XX市XX区人民法院', time: '09:00', detail: '第X法庭', date: tomorrow, label: '开庭', kind: 'hearing', daysLeft: 1, urgent: true, overdue: false, source: 'sample' },
      { caseId: 'sample2', caseName: '某顾问单位', date: today, label: '案件沟通会', kind: 'keydate', daysLeft: 0, urgent: true, overdue: false, source: 'sample' },
    ]
    try {
      await sendDeadlineCard(sample, prefix)
      ok(res, { sent: true })
    } catch (error) {
      fail(res, error, 502, '请检查飞书凭据（integrations/dsh-feishu/config.json 与 .credentials.yaml）')
    }
  })

  // Trigger a manual push run now (for testing). force=true 绕过台账推全部。
  route(`${API_PREFIX}/run`, async (d, b, res) => {
    const cfg = await d.store.readConfig()
    if (typeof b.enabled === 'boolean') cfg.enabled = b.enabled
    if (typeof b.titlePrefix === 'string') cfg.titlePrefix = b.titlePrefix.trim()
    const result = await runDeadlinePush(
      { litigation: d.litigationDataDir, nonlitigation: d.nonlitigationDataDir, tasks: d.tasksDataDir },
      cfg, d.store, { force: b.force === true },
    )
    ok(res, result)
  })

  return () => { for (const dispose of disposers.splice(0).reverse()) dispose() }
}
