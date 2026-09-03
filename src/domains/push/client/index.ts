/**
 * Browser-half entry for dsh-legal-suite/push — runs inside the dsh web GUI.
 *
 * Registers the「IM 推送」settings block into the AgentLex 设置 workbench page
 * (agentlex.workbench.item slot). Failure policy: DOM mounting problems are
 * logged, never thrown — an external plugin must not take the GUI down.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import './workbench-slot.ts'
import { PushSettings } from './PushSettings.tsx'

/** Required services. */
export const inject = ['slots']

/**
 * Mount the push settings block.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    let dispose: (() => void) | undefined
    let timer: number | undefined
    let attempts = 0
    const MAX_ATTEMPTS = 30
    const register = (): void => {
      if (dispose !== undefined) return
      try {
        dispose = ctx.slots.register({
          name: 'agentlex.workbench.item',
          id: 'agentlex-push-settings',
          order: 70,
          label: 'IM 推送',
        }, PushSettings)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!message.includes('is not declared')) {
          console.warn('[agentlex-push] workbench item registration failed:', error)
          return
        }
        attempts += 1
        if (attempts < MAX_ATTEMPTS) {
          timer = window.setTimeout(register, 500)
        } else {
          console.warn('[agentlex-push] workbench item not declared after retries:', error)
        }
      }
    }
    register()
    return () => {
      if (timer !== undefined) window.clearTimeout(timer)
      if (dispose !== undefined) dispose()
    }
  }, 'agentlex-push: workbench item')
}
