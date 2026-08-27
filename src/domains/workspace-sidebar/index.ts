/**
 * dsh-legal-suite/workspace-sidebar — host half.
 *
 * Registers the /api/agentlex-workspace/* route family used by the browser
 * half's file service and search client.
 */
import type { Context } from '@deepseek-ai/cordis'
import z from 'schemastery'
import { makeRoutes, type AppContext } from './routes.ts'

export const name = 'dsh-legal-suite/workspace-sidebar'
export const inject = ['webServer']

export interface Config {
  enabled?: boolean
}

export const Config: any = z.object({
  enabled: z.boolean().default(true),
})

// The dsh-super-injector loader resolves config through the Standard Schema
// `~standard` symbol. Schemastery's schema function is callable, so expose a
// small standard-schema adapter that delegates to it.
Object.defineProperty(Config, '~standard', {
  configurable: true,
  get() {
    return {
      version: 1,
      vendor: 'schemastery',
      validate: (value: unknown) => {
        try {
          return { value: Config(value ?? {}) as Config }
        } catch (error) {
          return { issues: [{ message: error instanceof Error ? error.message : String(error) }] }
        }
      },
    }
  },
})

export function apply(ctx: AppContext, config: Config = {}): void {
  if (config.enabled === false) return
  ctx.effect(() => {
    const disposeRoutes = makeRoutes(ctx)
    return () => {
      disposeRoutes()
    }
  }, 'dsh-legal-suite/workspace-sidebar: routes')
}
