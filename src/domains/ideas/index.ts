/**
 * dsh-legal-suite/ideas — host half.
 *
 * 想法/备忘：侧边栏「想法」入口 + 面板；落盘 $DSH_HOME/agentlex/ideas/ideas.json；
 * 支持关联案件/标签、状态流转（active/done/archived）、输入框 #idea-id 引用。
 */
import type { Context } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from 'schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { createIdeaStore } from './store/idea-store.ts'
import { makeRoutes } from './routes.ts'
import { registerIdeasTool } from './tools.ts'

export const name = 'ideas'

/** Services required before the ideas surfaces can mount. */
export const inject = ['webServer', 'systemPrompt', 'tools']

export const IDEAS_SETTINGS_NAMESPACE = settingsNamespace('agentlex-ideas')

export interface Config {
  enabled?: boolean
  dataDir?: string
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  dataDir: z.string().required(false),
})

export function resolveDataDir(configured?: string): string {
  if (configured !== undefined && configured !== '') return configured
  const home = process.env.DSH_HOME ?? ''
  if (home !== '') return `${home}/agentlex/ideas`
  const os = process.platform === 'win32' ? 'USERPROFILE' : 'HOME'
  const userHome = process.env[os] ?? '.'
  return `${userHome}/.dsh/agentlex/ideas`
}

/** Module-level surface registry (see task domain apply comment for the reload race). */
interface HostSurface {
  token: object
  dispose: () => void
}

let activeSurface: HostSurface | undefined

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
  })
  const token = {}

  const sync = (): void => {
    if (activeSurface !== undefined) { activeSurface.dispose(); activeSurface = undefined }
    const value = resolve()
    if (!value.enabled) return
    const dataDir = resolveDataDir(value.dataDir)
    const ideaStore = createIdeaStore(dataDir, ctx)
    activeSurface = {
      token,
      dispose: (() => {
        const disposers: Array<() => void> = []
        disposers.push(makeRoutes(ctx, { ideaStore }))
        disposers.push(registerIdeasTool(ctx, { ideaStore }))
        return () => { for (const d of disposers.splice(0)) d() }
      })(),
    }
  }

  installSettingsSection(ctx, IDEAS_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => { current = source; sync() },
    onChange: sync,
  })

  ctx.effect(() => () => { disposeSurface(token) }, 'agentlex-ideas: teardown')

  sync()
}
