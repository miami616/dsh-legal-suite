/**
 * dsh-legal-suite/push — host half.
 *
 * 期限提醒：每天早上 8:30 统一推送「今日 + 明日」到期的关键日期，飞书卡片。
 *
 * 架构（2026-09-10 确认，自包含化）：
 *  - 定时 = 插件内置 ticker（setTimeout 排到每天 8:30，host 常驻，GUI 关闭也照常）。
 *    不再依赖 dsh-timer-agent 的 command 任务。
 *  - 推送 = 直连飞书 open API 发分区卡片（与 feishu_push.py 同一套凭据）。
 *    不再依赖 @xmanrui/dsh-im。
 *  - 本域只做「读期限 → 过滤今日/明日 → 组卡片文案 → 发飞书 → 按日去重」。
 *
 * 数据：$DSH_HOME/agentlex/push/（push-config.json + push-ledger.json）。
 * 依赖：飞书凭据（$DSH_HOME/integrations/dsh-feishu/config.json +
 *       $DSH_HOME/.credentials.yaml），与每日早报共用；缺席时推送失败并告警，不崩溃。
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-settings'
import z from 'schemastery'
import { homedir } from 'node:os'
import { installSettingsSection } from '../../shared/settings-adapter.ts'
import { createPushStore, parsePushTime } from './store/push-config.ts'
import { makeRoutes } from './routes.ts'
import { runDeadlinePush } from './push.ts'

/** Stable cordis plugin name. */
export const name = 'push'

/** Services required before the push surfaces can mount. */
export const inject = ['webServer', 'settings']

/** Settings namespace of the push capability. */
export const PUSH_SETTINGS_NAMESPACE = 'agentlex-push' as const

/** Plugin config, validated by the same-named schemastery schema. */
export interface Config {
  /** Master switch for the plugin (routes, built-in timer). */
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

/** Resolve the litigation data directory (where case-registry.json lives). */
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

/** 每日推送默认时间：早上 8:30（可在设置页配置 pushTime）。 */
export const DEFAULT_PUSH_HOUR = 8
export const DEFAULT_PUSH_MINUTE = 30

/**
 * 排下一次推送：计算到下一个「配置的推送时间」的毫秒数，setTimeout 到点执行后
 * 再排下一次。间隔恒 < 24h，远小于 setTimeout 的 2^31-1 ms 上限。
 * 每次排程时现读配置时间——用户改了推送时间后，下一次排程即用新时间。
 */
export function scheduleNextRun(fn: () => void, getPushTime: () => string): NodeJS.Timeout {
  const now = new Date()
  const [hour, minute] = parsePushTime(getPushTime())
  const next = new Date(now)
  next.setHours(hour, minute, 0, 0)
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1)
  return setTimeout(() => {
    try {
      fn()
    } finally {
      // 无论 fn 是否抛错，都排下一次（异常只记日志，不中断排程）。
      scheduleNextRun(fn, getPushTime)
    }
  }, next.getTime() - now.getTime())
}

/** Module-level surface registry (survives fiber reloads). */
interface PushSurface {
  token: object
  timer: NodeJS.Timeout | undefined
  dispose: () => void
}
let pushSurface: PushSurface | undefined
/** 异步创建定时器前的路由 disposers（sync 再次调用时先清理，避免泄漏）。 */
let pendingDisposers: Array<() => void> = []

export function apply(ctx: Context, config: Config = {}): void {
  let current: () => Config = () => config
  const resolve = (): Config => ({
    enabled: current().enabled ?? true,
    dataDir: current().dataDir,
  })

  const token = {}

  const sync = (): void => {
    const value = resolve()
    // 清理旧 surface 与 pending 路由（含异步未完成的）。
    if (pushSurface !== undefined) { pushSurface.dispose(); pushSurface = undefined }
    for (const dispose of pendingDisposers.splice(0).reverse()) dispose()
    if (!value.enabled) return

    const dataDir = resolveDataDir(value.dataDir)
    const store = createPushStore(dataDir)
    const dirs = {
      litigation: litigationDataDir(),
      nonlitigation: nonlitigationDataDir(),
      tasks: tasksDataDir(),
    }

    const disposers: Array<() => void> = []
    disposers.push(makeRoutes(ctx, {
      store,
      litigationDataDir: dirs.litigation,
      nonlitigationDataDir: dirs.nonlitigation,
      tasksDataDir: dirs.tasks,
      // 配置变更（含推送时间）后重建定时器。
      onConfigChange: sync,
    }))
    pendingDisposers = disposers

    // 内置定时器：每天按配置的推送时间触发一次（防重入：上一次未跑完则跳过本轮）。
    let inFlight = false
    const run = async (): Promise<void> => {
      if (inFlight) return
      inFlight = true
      try {
        const cfg = await store.readConfig()
        if (!cfg.enabled) return
        const result = await runDeadlinePush(dirs, cfg, store)
        if (result.error !== undefined) {
          console.warn(`[agentlex-push] 推送失败: ${result.error}`)
        } else {
          console.log(`[agentlex-push] due=${result.due} pushed=${result.pushed} attempted=${result.attempted}`)
        }
      } catch (error) {
        console.warn('[agentlex-push] 定时推送异常:', error instanceof Error ? error.message : String(error))
      } finally {
        inFlight = false
      }
    }

    // 异步读配置拿到推送时间后再建定时器（首次排程即用真实配置时间）。
    void store.readConfig().then((cfg) => {
      if (pendingDisposers !== disposers) return // 已被新的 sync 取代，放弃。
      const timer = scheduleNextRun(() => { void run() }, () => cfg.pushTime ?? '08:30')
      pushSurface = {
        token,
        timer,
        dispose: () => {
          if (timer !== undefined) clearTimeout(timer)
          for (const dispose of disposers.splice(0).reverse()) dispose()
          if (pendingDisposers === disposers) pendingDisposers = []
        },
      }
    })
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
    for (const dispose of pendingDisposers.splice(0).reverse()) dispose()
  }, 'agentlex-push: teardown')

  sync()
}
