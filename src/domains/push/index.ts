/**
 * dsh-legal-suite/push — host half.
 *
 * 期限提醒（v0.2.25 智能分级版）：
 *  - 每日摘要：到设定时间（默认 08:30）推送当天的提醒计划到飞书卡片；
 *  - 精确提醒：开庭提前 2 小时/30 分钟、其他事项提前 30 分钟；
 *  - 每 5 分钟巡检一次：补发休眠/重启错过的档期，失败每 10 分钟重试。
 *
 * 架构（2026-10-18 调整）：
 *  - **不再用「排到明天 8:30 的一次性 setTimeout」**：笔记本合盖休眠、进程重启都会
 *    让那一次定时丢失，且无处补发。现在用一个 5 分钟心跳 + push-state.json 的
 *    `lastDigestDate` 判断「今天是否已发」，启动后立即补跑；
 *  - 定时与推送仍完全自包含（不依赖 dsh-timer-agent / dsh-im），直连飞书 open API；
 *  - 失败状态落盘（push-state.json），下次成功卡会注明「上次推送失败」，并弹
 *    macOS 本地通知兜底。
 *
 * 数据：$DSH_HOME/agentlex/push/（push-config.json + push-ledger.json + push-state.json）。
 * 依赖：飞书凭据（$DSH_HOME/integrations/dsh-feishu/config.json + .credentials.yaml）；
 *       缺席时推送失败并告警，不崩溃。
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { installSettingsSection } from '../../shared/settings-adapter.ts'
import { acquirePushRunLock, createPushStore, createRunStateStore } from './store/push-config.ts'
import { makeRoutes } from './routes.ts'
import { runReminderTick } from './push.ts'

/** Stable cordis plugin name. */
export const name = 'push'

/** Services required before the push surfaces can mount. */
export const inject = ['webServer', 'settings']

/** Settings namespace of the push capability. */
export const PUSH_SETTINGS_NAMESPACE = 'agentlex-push' as const

/** Plugin config, validated by the same-named schemastery schema. */
export interface Config {
  /** Master switch for the plugin (routes, built-in ticker). */
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

/** 巡检心跳间隔：5 分钟（精确到点提醒的粒度）。 */
export const TICK_INTERVAL_MS = 5 * 60_000
/** 启动后补跑延迟：留出 20 秒让数据存储与飞书配置就绪。 */
export const STARTUP_DELAY_MS = 20_000

/** Module-level surface registry (survives fiber reloads). */
interface PushSurface {
  token: object
  timer: NodeJS.Timeout | undefined
  startup: NodeJS.Timeout | undefined
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
    const stateStore = createRunStateStore(dataDir)
    const dirs = {
      litigation: litigationDataDir(),
      nonlitigation: nonlitigationDataDir(),
      tasks: tasksDataDir(),
    }

    const disposers: Array<() => void> = []
    disposers.push(makeRoutes(ctx, {
      store,
      stateStore,
      dataDir,
      litigationDataDir: dirs.litigation,
      nonlitigationDataDir: dirs.nonlitigation,
      tasksDataDir: dirs.tasks,
      // 配置变更（时间/开关）后重建巡检器并立即试跑一次。
      onConfigChange: sync,
    }))
    pendingDisposers = disposers

    // 5 分钟心跳（防重入：上一次未跑完则跳过本轮）。
    let inFlight = false
    const run = async (): Promise<void> => {
      if (inFlight) return
      inFlight = true
      // 跨进程互斥：live 与测试实例共用数据目录时，只允许一个实例发提醒。
      const release = await acquirePushRunLock(dataDir)
      if (release === undefined) {
        inFlight = false
        return
      }
      try {
        const cfg = await store.readConfig()
        if (!cfg.enabled) return
        const result = await runReminderTick(dirs, cfg, store, stateStore)
        if (result.error !== undefined) {
          console.warn(`[agentlex-push] 推送失败: ${result.error}`)
        } else if (result.pushed > 0) {
          console.log(`[agentlex-push] kind=${result.kind} due=${result.due} pushed=${result.pushed}`)
        }
      } catch (error) {
        console.warn('[agentlex-push] 巡检异常:', error instanceof Error ? error.message : String(error))
      } finally {
        await release().catch(() => { /* best-effort */ })
        inFlight = false
      }
    }

    // 启动补跑：若今天已过推送时间但状态里没有 lastDigestDate（关机/重启/休眠错过），
    // 20 秒后立即补一次；否则也会在下一个心跳周期自然处理。
    const startup = setTimeout(() => { void run() }, STARTUP_DELAY_MS)
    const timer = setInterval(() => { void run() }, TICK_INTERVAL_MS)
    if (typeof timer.unref === 'function') timer.unref()
    if (typeof startup.unref === 'function') startup.unref()

    pushSurface = {
      token,
      timer,
      startup,
      dispose: () => {
        if (timer !== undefined) clearInterval(timer)
        if (startup !== undefined) clearTimeout(startup)
        for (const dispose of disposers.splice(0).reverse()) dispose()
        if (pendingDisposers === disposers) pendingDisposers = []
      },
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
    for (const dispose of pendingDisposers.splice(0).reverse()) dispose()
  }, 'agentlex-push: teardown')

  sync()
}
