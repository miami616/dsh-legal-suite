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
import { acquirePushRunLock, parseMaxDigestRows, type PushStateStore, type PushStore } from './store/push-config.ts'
import { previewReminderPlan, runReminderTick } from './push.ts'
import { sendReminderCard, sendReminderImageCard } from './feishu-card.ts'
import { cleanupReminderImage, renderReminderImage } from './reminder-image.ts'
import { isFeishuConfigured, loadFeishuConfig, saveFeishuConfig } from './feishu-config.ts'
import { localDate, reminderCandidates, type ReminderPlanOptions } from './reminder-plan.ts'
import { nextPlanDate, nextReviewDate } from './weekly.ts'
import type { DeadlineItem } from '../litigation/deadlines.ts'

/** Route prefix for the whole family. */
export const API_PREFIX = '/api/agentlex-push'

/** Services the routes need. */
export interface PushRouteDeps {
  /** The push store (config + ledger). */
  store: PushStore
  /** 运行状态（上次成功/失败、失败重试）。 */
  stateStore: PushStateStore
  /** push 数据目录（跨进程运行锁）。 */
  dataDir: string
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
    if (typeof b.smartLead === 'boolean') next.smartLead = b.smartLead
    if (typeof b.preciseReminder === 'boolean') next.preciseReminder = b.preciseReminder
    if (typeof b.includeConsequence === 'boolean') next.includeConsequence = b.includeConsequence
    if (b.maxDigestRows !== undefined) next.maxDigestRows = parseMaxDigestRows(b.maxDigestRows)
    if (b.density === 'concise' || b.density === 'standard') next.density = b.density
    if (typeof b.imageMode === 'boolean') next.imageMode = b.imageMode
    if (b.frequency === 'low' || b.frequency === 'normal') next.frequency = b.frequency
    if (typeof b.weeklyPlanEnabled === 'boolean') next.weeklyPlanEnabled = b.weeklyPlanEnabled
    if (typeof b.weeklyReviewEnabled === 'boolean') next.weeklyReviewEnabled = b.weeklyReviewEnabled
    if (typeof b.weeklyReviewTime === 'string' && /^\d{1,2}:\d{2}$/.test(b.weeklyReviewTime.trim())) {
      next.weeklyReviewTime = b.weeklyReviewTime.trim()
    }
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

  // Send a test Feishu card to the bot owner (same smart card as production).
  route(`${API_PREFIX}/test`, async (d, b, res) => {
    const prefix = typeof b.titlePrefix === 'string' ? b.titlePrefix.trim() : ''
    const today = localDate()
    const plus = (days: number): string => {
      const dt = new Date(`${today}T00:00:00`)
      dt.setDate(dt.getDate() + days)
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
    }
    const sample: DeadlineItem[] = [
      {
        caseId: 'sample', caseName: '示例案件', caseNumber: '（2026）X民初XXXX号', court: 'XX市XX区人民法院',
        time: '09:00', detail: '第X法庭', date: plus(1), label: '开庭', kind: 'hearing',
        daysLeft: 1, urgent: true, overdue: false, source: 'sample',
      },
      {
        caseId: 'sample2', caseName: '甲方与乙方买卖合同纠纷', caseNumber: '（2026）X民初XXXX号',
        date: plus(3), label: '上诉期届满', kind: 'keydate', daysLeft: 3, urgent: true, overdue: false, source: 'sample',
      },
    ]
    const plan: ReminderPlanOptions = { smartLead: true, includeConsequence: true }
    const entries = reminderCandidates(sample, plan)
    const cfg = await d.store.readConfig()
    try {
      if (cfg.imageMode === true) {
        try {
          const png = await renderReminderImage({
            entries,
            now: Date.now(),
            pushTime: cfg.pushTime,
            total: entries.length,
          })
          try {
            await sendReminderImageCard(png, entries, { titlePrefix: prefix, pushTime: cfg.pushTime })
          } finally {
            await cleanupReminderImage(png)
          }
          ok(res, { sent: true, image: true })
          return
        } catch (error) {
          console.warn('[agentlex-push] 测试推送图片版失败，回退文字卡:', error instanceof Error ? error.message : String(error))
        }
      }
      await sendReminderCard(entries, { titlePrefix: prefix, pushTime: '08:30' })
      ok(res, { sent: true, image: false })
    } catch (error) {
      fail(res, error, 502, '请检查飞书凭据（integrations/dsh-feishu/config.json 与 .credentials.yaml）')
    }
  })

  // Trigger a manual reminder tick now (force=true 绕过台账推全部)。
  route(`${API_PREFIX}/run`, async (d, b, res) => {
    const cfg = await d.store.readConfig()
    if (typeof b.enabled === 'boolean') cfg.enabled = b.enabled
    if (typeof b.titlePrefix === 'string') cfg.titlePrefix = b.titlePrefix.trim()
    const release = await acquirePushRunLock(d.dataDir)
    if (release === undefined) {
      ok(res, { due: 0, pushed: 0, attempted: false, kind: 'none', error: '另一实例正在推送，请稍后重试' })
      return
    }
    try {
      const requested = typeof b.mode === 'string' ? b.mode : 'manual'
      const mode = requested === 'digest' || requested === 'intraday' || requested === 'weekly-plan' || requested === 'weekly-review'
        ? requested
        : 'manual'
      const result = await runReminderTick(
        { litigation: d.litigationDataDir, nonlitigation: d.nonlitigationDataDir, tasks: d.tasksDataDir },
        cfg, d.store, d.stateStore, { mode, force: b.force === true },
      )
      ok(res, result)
    } finally {
      await release().catch(() => { /* best-effort */ })
    }
  })

  // Reminder health/status for the settings page.
  route(`${API_PREFIX}/status`, async (d, _b, res, method) => {
    if (method !== 'GET') {
      fail(res, new Error('GET only'), 405)
      return
    }
    const config = await d.store.readConfig()
    const [state, feishuConfigured, preview] = await Promise.all([
      d.stateStore.read(),
      isFeishuConfigured(),
      previewReminderPlan(
        { litigation: d.litigationDataDir, nonlitigation: d.nonlitigationDataDir, tasks: d.tasksDataDir },
        config,
      ),
    ])
    // 周报的下一次档期：周一（或本周首个工作日）早报时间 / 周五（或本周末个工作日）16:30。
    const planTime = config.pushTime ?? '08:30'
    const reviewTime = config.weeklyReviewTime ?? '16:30'
    const [planHour, planMinute] = planTime.split(':').map(Number)
    const [reviewHour, reviewMinute] = reviewTime.split(':').map(Number)
    const planDay = nextPlanDate(Date.now(), planHour ?? 8, planMinute ?? 30)
    const reviewDay = nextReviewDate(Date.now(), reviewHour ?? 16, reviewMinute ?? 30)
    ok(res, {
      config,
      state,
      feishuConfigured,
      nextDigestAt: preview.nextDigestAt,
      due: preview.total,
      suppressed: preview.suppressed,
      workday: preview.workday,
      weekly: {
        planEnabled: config.weeklyPlanEnabled !== false,
        reviewEnabled: config.weeklyReviewEnabled !== false,
        nextPlanAt: `${planDay} ${planTime}`,
        nextReviewAt: `${reviewDay} ${reviewTime}`,
      },
      serverTime: new Date().toISOString(),
    })
  })

  // Preview today's reminder plan (no send, no ledger write).
  route(`${API_PREFIX}/preview`, async (d, b, res) => {
    const cfg = await d.store.readConfig()
    if (typeof b.smartLead === 'boolean') cfg.smartLead = b.smartLead
    if (typeof b.includeConsequence === 'boolean') cfg.includeConsequence = b.includeConsequence
    const preview = await previewReminderPlan(
      { litigation: d.litigationDataDir, nonlitigation: d.nonlitigationDataDir, tasks: d.tasksDataDir },
      cfg,
    )
    ok(res, preview)
  })

  return () => { for (const dispose of disposers.splice(0).reverse()) dispose() }
}
