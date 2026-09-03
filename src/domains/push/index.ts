/**
 * dsh-legal-suite/push — host half.
 *
 * 期限 IM 推送：关键日期快到期（提前 1 天 + 当天）时，向用户配置的 dsh-im
 * 投递目标推送固定模板提醒。
 *
 * 架构（2026-09-03 确认）：
 *  - 定时 = dsh-timer-agent 的 command 任务（固定 1 个，不随案件数增长）。
 *  - 推送 = @xmanrui/dsh-im 的主动投递（ctx.get('dshIm').send()）。
 *  - 本域只做「读期限 → 组文案 → 调投递 → 去重」的编排层。
 *
 * 数据：$DSH_HOME/agentlex/push/（push-config.json + push-ledger.json）。
 * 依赖：dsh-im 与 dsh-timer-agent 均为已装 bundle；不声明为 peer 依赖，
 * 缺席时降级提示而非崩溃（决策 4）。
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-settings'
import z from 'schemastery'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { installSettingsSection } from '../../shared/settings-adapter.ts'
import { createPushStore, type PushConfig } from './store/push-config.ts'
import { makeRoutes } from './routes.ts'
import { createHttpDshIm, type DshImService } from './push.ts'

/** Stable cordis plugin name. */
export const name = 'push'

/** Services required before the push surfaces can mount. */
export const inject = ['webServer', 'settings']

/** Settings namespace of the push capability. */
export const PUSH_SETTINGS_NAMESPACE = 'agentlex-push' as const

/** Plugin config, validated by the same-named schemastery schema. */
export interface Config {
  /** Master switch for the plugin (routes, command job). */
  enabled?: boolean
  /** Data directory override (default: $DSH_HOME/agentlex/push). */
  dataDir?: string
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  dataDir: z.string().required(false),
})

/** URL 形态的值不是合法目录路径。 */
const URLISH_PATH = /^[a-z][a-z0-9+.-]*:\/\//i

/** Resolve the data directory: explicit config wins, else $DSH_HOME/agentlex/push. */
export function resolveDataDir(configured?: string): string {
  if (configured !== undefined && configured !== '' && !URLISH_PATH.test(configured.trim())) return configured
  const home = process.env.DSH_HOME ?? ''
  if (home !== '') return `${home}/agentlex/push`
  const os = process.platform === 'win32' ? 'USERPROFILE' : 'HOME'
  const userHome = process.env[os] ?? '.'
  return `${userHome}/.dsh/agentlex/push`
}

/**
 * Resolve the litigation data directory (where case-registry.json /
 * case-timeline.json live). The push domain reads deadlines from here; it is
 * a sibling of the push data dir under $DSH_HOME/agentlex/.
 */
export function litigationDataDir(): string {
  const home = process.env.DSH_HOME ?? ''
  if (home !== '') return `${home}/agentlex/litigation`
  const os = process.platform === 'win32' ? 'USERPROFILE' : 'HOME'
  const userHome = process.env[os] ?? '.'
  return `${userHome}/.dsh/agentlex/litigation`
}

/** Resolve the nonlitigation data directory (project-registry.json). */
export function nonlitigationDataDir(): string {
  const home = process.env.DSH_HOME ?? ''
  if (home !== '') return `${home}/agentlex/nonlitigation`
  const os = process.platform === 'win32' ? 'USERPROFILE' : 'HOME'
  const userHome = process.env[os] ?? '.'
  return `${userHome}/.dsh/agentlex/nonlitigation`
}

/** Resolve the task data directory (standalone-tasks.json). */
export function tasksDataDir(): string {
  const home = process.env.DSH_HOME ?? ''
  if (home !== '') return `${home}/agentlex/tasks`
  const os = process.platform === 'win32' ? 'USERPROFILE' : 'HOME'
  const userHome = process.env[os] ?? '.'
  return `${userHome}/.dsh/agentlex/tasks`
}

/** The dsh web base URL (for the command job to reach the host). */
export function webBaseUrl(): string {
  return (process.env.DSH_WEB_URL ?? 'http://127.0.0.1:3080').replace(/\/+$/, '')
}

/** The absolute path to the push-cli command-job script. */
export function pushCliPath(): string {
  return new URL('./push-cli.mjs', import.meta.url).pathname
}

/** The fixed command-job title (the timer board shows exactly one row). */
export const PUSH_JOB_TITLE = '期限IM推送'

/** The command-job cron (every 5 minutes). */
export const PUSH_JOB_CRON = '*/5 * * * *'

/**
 * Register (or sync) the single timer-agent command job that triggers the
 * push run. Idempotent: looks up the job by its stable TITLE (the timer-agent
 * POST route assigns a random UUID, so a client-supplied id cannot be used to
 * find it), updates cron if present, creates if absent. Uses the timer-agent
 * HTTP API (it provides no service). Best-effort — a failure to reach
 * timer-agent is logged, never fatal.
 */
export async function syncTimerJob(enabled: boolean): Promise<void> {
  const base = webBaseUrl()
  const url = `${base}/api/dsh-timer-agent/jobs`
  try {
    // 1. Read the current ledger to find our job by title.
    const listRes = await fetch(url, { method: 'GET', headers: { accept: 'application/json' } })
    if (!listRes.ok) {
      console.warn(`[agentlex-push] timer-agent list failed (${listRes.status})`)
      return
    }
    const listBody = await listRes.json() as { jobs?: Array<{ id: string; title?: string; schedule?: { enabled?: boolean; cron?: string } }> }
    const matches = (listBody.jobs ?? []).filter((job) => job.title === PUSH_JOB_TITLE)
    const existing = matches[0]

    // Clean up any duplicate jobs left by earlier buggy versions (which could
    // not find the job by a client-supplied id and created a new one per
    // apply). Keep the first match, remove the rest.
    for (const dup of matches.slice(1)) {
      await fetch(`${url}?id=${encodeURIComponent(dup.id)}`, { method: 'DELETE' }).catch(() => undefined)
    }

    const payload = {
      title: PUSH_JOB_TITLE,
      description: '关键日期快到期（提前 1 天 + 当天）时，向 dsh-im 投递目标推送固定模板提醒。',
      kind: 'command',
      command: process.execPath,
      args: `"${pushCliPath()}"`,
      target: { workdir: '', sessionId: '' },
      cron: PUSH_JOB_CRON,
      scheduleEnabled: enabled,
    }

    if (existing === undefined) {
      const createRes = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!createRes.ok) {
        console.warn(`[agentlex-push] timer-agent create failed (${createRes.status})`)
      }
    } else {
      const updateRes = await fetch(`${url}?id=${encodeURIComponent(existing.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        // 同时校正 command/args 指向本实例的 push-cli（共享台账时避免残留旧路径）。
        body: JSON.stringify({ cron: PUSH_JOB_CRON, scheduleEnabled: enabled, command: process.execPath, args: `"${pushCliPath()}"` }),
      })
      if (!updateRes.ok) {
        console.warn(`[agentlex-push] timer-agent update failed (${updateRes.status})`)
      }
    }
  } catch (error) {
    console.warn('[agentlex-push] timer-agent sync failed:', error instanceof Error ? error.message : String(error))
  }
}

/** Module-level surface registry (survives fiber reloads). */
interface PushSurface {
  token: object
  dispose: () => void
}
let pushSurface: PushSurface | undefined

export function apply(ctx: Context, config: Config = {}): void {
  let current: () => Config = () => config
  const resolve = (): Config => ({
    enabled: current().enabled ?? true,
    dataDir: current().dataDir,
  })

  const token = {}

  const sync = (): void => {
    const value = resolve()
    if (pushSurface !== undefined) { pushSurface.dispose(); pushSurface = undefined }
    if (!value.enabled) return

    const dataDir = resolveDataDir(value.dataDir)
    const store = createPushStore(dataDir)

    // dsh-im delivery client. Prefer the in-process service (ctx.get('dshIm'))
    // when visible (it also exposes listTargets for the settings dropdown);
    // otherwise fall back to the HTTP endpoint for sending (documented
    // integration path, robust to cordis service-scope differences).
    const base = webBaseUrl()
    const ctxGet = (ctx as unknown as { get?: (name: string) => unknown }).get
    const rootGet = (ctx as unknown as { root?: { get?: (name: string) => unknown } }).root?.get
    // Try the root ctx first (dsh-im provides on its own ctx; the root shares
    // the store), then the local ctx, then fall back to HTTP for sending.
    let inProcess: DshImService | undefined
    if (typeof rootGet === 'function') {
      inProcess = rootGet.call((ctx as unknown as { root?: object }).root, 'dshIm') as DshImService | undefined
    }
    if (inProcess === undefined && typeof ctxGet === 'function') {
      inProcess = ctxGet.call(ctx, 'dshIm') as DshImService | undefined
    }
    const inProcessUsable = inProcess !== undefined && typeof inProcess.send === 'function'
    const httpClient = createHttpDshIm(base)
    // Combined service: send via in-process (preferred) or HTTP; listTargets
    // only via in-process (dsh-im exposes no HTTP list-targets endpoint).
    const dshIm: DshImService = {
      send: (botId, targetId, text, options) =>
        inProcessUsable ? inProcess!.send(botId, targetId, text, options) : httpClient.send(botId, targetId, text, options),
      ...(inProcessUsable && typeof inProcess!.listTargets === 'function'
        ? { listTargets: (botId: string) => inProcess!.listTargets!(botId) }
        : {}),
    }
    const disposers: Array<() => void> = []
    disposers.push(makeRoutes(ctx, {
      store,
      dshIm,
      litigationDataDir: litigationDataDir(),
      nonlitigationDataDir: nonlitigationDataDir(),
      tasksDataDir: tasksDataDir(),
    }))

    // Sync the timer-agent command job (best-effort). Enable/disable purely
    // on the user's master switch — the HTTP delivery fallback pushes without
    // the in-process dsh-im service, so dshImAvailable must NOT gate this
    // (it is false on nested-plugin scopes where dsh-im's ctx isn't visible,
    // which would wrongly disable the scheduled job).
    void store.readConfig().then((cfg) => {
      void syncTimerJob(cfg.enabled === true)
    })

    pushSurface = {
      token,
      dispose: () => { for (const dispose of disposers.splice(0).reverse()) dispose() },
    }
  }

  const disposeSettings = installSettingsSection(ctx, PUSH_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => { current = source; sync() },
    onChange: sync,
  })

  ctx.effect(() => () => {
    disposeSettings()
    if (pushSurface !== undefined && pushSurface.token === token) {
      pushSurface.dispose()
      pushSurface = undefined
    }
  }, 'agentlex-push: teardown')

  sync()
}
