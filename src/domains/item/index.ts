/**
 * 统一事项域 — host 半。
 *
 * 提供统一事项的 REST API（/api/agentlex-item/* CRUD + 任务组 CRUD），
 * 供诉讼/非诉/任务管理/备忘录各面板读写统一事项。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { createItemStore, type ItemStore } from './store/item-store.ts'
import { makeRoutes, type RouteDeps } from './routes.ts'

export const name = 'dsh-legal-suite/item'

/** Services required before the item surfaces can mount. */
export const inject = ['webServer']

export interface Config {
  dataDir?: string
}

export function resolveDataDir(configured?: string): string {
  if (configured !== undefined && configured !== '') return configured
  const home = process.env.DSH_HOME ?? ''
  if (home !== '') return `${home}/agentlex/items`
  const os = process.platform === 'win32' ? 'USERPROFILE' : 'HOME'
  const userHome = process.env[os] ?? '.'
  return `${userHome}/.dsh/agentlex/items`
}

export function apply(ctx: Context, config: Config = {}): void {
  const dataDir = resolveDataDir(config.dataDir)
  const itemStore: ItemStore = createItemStore(dataDir, ctx)
  const deps: RouteDeps = { itemStore }
  const disposeRoutes = makeRoutes(ctx, deps)

  ctx.effect(() => () => { disposeRoutes() }, 'dsh-legal-suite/item: teardown')
}
