/**
 * Browser-half entry for dsh-legal-suite/task — S0 skeleton.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { PanelController } from './controller.ts'
import { en, zh, type TaskKey } from './locales.ts'
import { mountPanel } from './mount.tsx'
import { mountSidebarEntry } from './sidebar-entry.ts'
import { getModuleToggles, setModuleToggles, subscribe as subscribeToggles } from '../../../shared/module-toggles'

const NS = 'agentlex-task'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'agentlex-task': TaskKey
  }
}

export const inject = ['slots', 'locale']

export type { PanelControllerSnapshot } from './controller.ts'
export type { TaskKey } from './locales.ts'

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'agentlex-task: dictionaries')

  let uiDisposers: Array<() => void> = []
  let mounted = false

  const mount = (): void => {
    if (mounted) return
    mounted = true
    const controller = new PanelController()
    try {
      uiDisposers.push(mountSidebarEntry(controller))
      uiDisposers.push(mountPanel(controller))
    } catch (error) {
      console.warn('[agentlex-task] mount failed:', error)
    }
  }

  const unmount = (): void => {
    if (!mounted) return
    mounted = false
    for (const dispose of uiDisposers.splice(0)) dispose()
  }

  const sync = (): void => {
    if (getModuleToggles().taskEnabled) mount()
    else unmount()
  }
  sync()
  const onTogglesChanged = (e: Event): void => {
    setModuleToggles((e as CustomEvent<Partial<import('../../../shared/module-toggles').ModuleToggles>>).detail ?? {})
  }
  window.addEventListener('agentlex:toggles-changed', onTogglesChanged)

  // Live refresh — SSE bridge: the host forwards every store write over
  // /api/agentlex-task/events-stream, re-dispatched as the window CustomEvent the panels listen for.
  ctx.effect(() => {
    let es: EventSource | null = null
    try {
      es = new EventSource('/api/agentlex-task/events-stream')
      es.onmessage = (): void => {
        window.dispatchEvent(new CustomEvent('agentlex:registry-changed'))
      }
      es.onerror = (): void => {
        // The browser auto-reconnects; nothing to do here.
      }
    } catch (error) {
      console.warn('[agentlex-task] EventSource unavailable:', error)
    }
    return () => { if (es) es.close() }
  }, 'agentlex-task: live-refresh sse')

  const unsubscribe = subscribeToggles(sync)
  ctx.effect(() => () => {
    unsubscribe()
    window.removeEventListener('agentlex:toggles-changed', onTogglesChanged)
    unmount()
  }, 'agentlex-task: ui mounts')
}
