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
import { createCaseStore } from '../litigation/store/case-store.ts'
import { createItemStore } from '../item/store/item-store.ts'
import { createProjectStore } from '../nonlitigation/store/project-store.ts'
import { installSettingsSection } from '../../shared/settings-adapter.ts'

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
    const litigationDir = siblingDir('litigation', value.litigationDir)
    const nonlitigationDir = siblingDir('nonlitigation', value.nonlitigationDir)
    // 统一事项 store（唯一真相源）：独立任务、案件/项目任务、跨域视图都读这里。
    const itemStore = createItemStore(siblingDir('items'), ctx)
    // 0.2.12：独立任务也存 items（ownerType='standalone'），旧 standalone-tasks.json 退役。
    const taskStore = createTaskStore(dataDir, ctx, itemStore)
    void import('./unify-store.ts')
      .then(async ({ unifyTaskStore }) => {
        const result = await unifyTaskStore(itemStore, dataDir)
        if (result.mergedTasks > 0 || result.retiredStandalone) {
          console.warn(`[agentlex-task] 0.2.12 统一完成：独立任务 ${result.mergedTasks}、退役 standalone-tasks.json ${result.retiredStandalone}`)
        }
      })
      .catch((error) => console.warn('[agentlex-task] 0.2.12 统一迁移失败:', error))
    activeSurface = {
      token,
      dispose: makeRoutes(ctx, {
        taskStore,
        litigationDir,
        nonlitigationDir,
        // 备忘 #21：任务面板勾选诉讼/非诉任务后 bump 来源案件/项目 updatedAt，
        // 让案件卡片按「最近更新」置顶（与 litigation 域路由同一 store）。
        // 0.2.12：case-store 只存案件元信息，任务/关键日期在 items → 必须传 itemStore。
        caseStore: createCaseStore(litigationDir, ctx, itemStore),
        projectStore: createProjectStore(nonlitigationDir, ctx, itemStore),
      }),
    }
  }

  const disposeSettings = installSettingsSection(ctx, TASK_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => { current = source; sync() },
    onChange: sync,
  })

  // Fiber-unload safety net: only tears down this apply's surface. During a
  // fiber reload the old fiber's effect fires asynchronously — the token
  // check keeps it from wiping the newer apply's surface.
  ctx.effect(() => () => { disposeSettings(); disposeSurface(token) }, 'agentlex-task: teardown')

  sync()
}
