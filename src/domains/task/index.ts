/**
 * dsh-legal-suite/task — host half (S0 skeleton).
 *
 * 任务管理：独立任务 + 跨插件统一任务视图。
 * S0 先提供健康路由 + 设置卡片，后续里程碑补全存储/路由/UI。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import z from 'schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { createTaskStore } from './store/task-store.ts'
import { makeRoutes } from './routes.ts'

export const name = 'task'

/** Services required before the task-management surfaces can mount. */
export const inject = ['webServer', 'systemPrompt', 'settings']

export const TASK_SETTINGS_NAMESPACE = 'agentlex-task' as const

export interface Config {
  enabled?: boolean
  dataDir?: string
  litigationDir?: string
  nonlitigationDir?: string
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  dataDir: z.string().required(false),
  litigationDir: z.string().required(false),
  nonlitigationDir: z.string().required(false),
})

export function resolveDataDir(configured?: string): string {
  if (configured !== undefined && configured !== '') return configured
  const home = process.env.DSH_HOME ?? ''
  if (home !== '') return `${home}/agentlex/tasks`
  const os = process.platform === 'win32' ? 'USERPROFILE' : 'HOME'
  const userHome = process.env[os] ?? '.'
  return `${userHome}/.dsh/agentlex/tasks`
}

function siblingDir(name: string, configured?: string): string {
  if (configured !== undefined && configured !== '') return configured
  const home = process.env.DSH_HOME ?? ''
  if (home !== '') return `${home}/agentlex/${name}`
  const os = process.platform === 'win32' ? 'USERPROFILE' : 'HOME'
  const userHome = process.env[os] ?? '.'
  return `${userHome}/.dsh/agentlex/${name}`
}

/**
 * Module-level surface registry — cordis RELOADS the plugin fiber when an
 * injected service becomes available during boot (Fiber._reload re-runs apply
 * with fresh closures), so per-apply local disposers cannot see the previous
 * apply's registered routes and a second apply would crash startup with
 * "duplicate exact route". Holding the surface at module level lets every
 * apply/sync tear the previous registration down synchronously (makeRoutes
 * disposers are a synchronous table.delete) before re-registering; the token
 * keeps the fiber-unload effect from wiping a newer reload's surface.
 */
interface HostSurface {
  token: object
  dispose: () => void
}

let activeSurface: HostSurface | undefined

/** Wipe the module-level surface when it belongs to `owner`. */
function disposeSurface(owner: object): void {
  if (activeSurface !== undefined && activeSurface.token === owner) {
    activeSurface.dispose()
    activeSurface = undefined
  }
}

export function apply(ctx: Context, config: Config = {}): void {
  let current: () => Config = () => config
  const resolve = (): Config => ({
    enabled: current().enabled ?? true,
    dataDir: current().dataDir,
    litigationDir: current().litigationDir,
    nonlitigationDir: current().nonlitigationDir,
  })
  const token = {}

  const sync = (): void => {
    // Synchronous teardown of the previous surface (any apply's — reloads
    // re-enter with a fresh closure and a new token) BEFORE re-registering.
    if (activeSurface !== undefined) { activeSurface.dispose(); activeSurface = undefined }
    const value = resolve()
    if (!value.enabled) return
    const dataDir = resolveDataDir(value.dataDir)
    const taskStore = createTaskStore(dataDir, ctx)
    activeSurface = {
      token,
      dispose: makeRoutes(ctx, {
        taskStore,
        litigationDir: siblingDir('litigation', value.litigationDir),
        nonlitigationDir: siblingDir('nonlitigation', value.nonlitigationDir),
      }),
    }
  }

  ctx.settings.installSection(ctx, TASK_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => { current = source; sync() },
    onChange: sync,
  })

  // Fiber-unload safety net: only tears down this apply's surface. During a
  // fiber reload the old fiber's effect fires asynchronously — the token
  // check keeps it from wiping the newer apply's surface.
  ctx.effect(() => () => { disposeSurface(token) }, 'agentlex-task: teardown')

  sync()
}
