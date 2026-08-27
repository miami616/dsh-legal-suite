/**
 * Browser-half entry for dsh-legal-suite/nonlitigation — S0 skeleton.
 * Registers locale dictionaries and mounts the sidebar entry + placeholder panel.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { bindCaseWorkspaces, installAgentlexPickBridge } from '../../../shared/folder-picker.ts'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { PanelController } from './controller.ts'
import { en, zh, type NonLitigationKey } from './locales.ts'
import { mountPanel } from './mount.tsx'
import { launchNonLitigationManager, fetchArchivedSessionIds } from './launch-manager.ts'
import { mountSidebarEntry } from './sidebar-entry.ts'
import { getModuleToggles, setModuleToggles, subscribe as subscribeToggles } from '../../../shared/module-toggles'

const NS = 'agentlex-nonlitigation'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'agentlex-nonlitigation': NonLitigationKey
  }
}

/** Required services (fiber inject waiting — the runtime must be up first).
 *  `workspaces` 必须注入：目录选择桥（旧版 UI 的「绑定/更换文件夹」）在点击时
 *  经 ctx 惰性解析 workspaces.pickDirectory()。
 *  `sessions` 必须注入：非诉管家 launcher 经 ctx.get('sessions') 创建并选中
 *  新会话；不注入则 cordis 不等待该服务挂载，首次点击时可能拿到 undefined，
 *  导致「点击非诉管家不跳转新会话」（与诉讼管家一致）。 */
export const inject = ['slots', 'locale', 'sessions', 'workspaces']

export type { PanelControllerSnapshot } from './controller.ts'
export type { NonLitigationKey } from './locales.ts'

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'agentlex-nonlitigation: dictionaries')
  bindCaseWorkspaces(ctx)
  // 旧版 AgentLex 渲染层（Original*Panel）的「绑定/更换文件夹」通过该桥调用
  // DSH 原生目录选择框（workspaces.pickDirectory）。
  const disposePickBridge = installAgentlexPickBridge()

  let uiDisposers: Array<() => void> = []
  let mounted = false

  const mount = (): void => {
    if (mounted) return
    mounted = true
    const controller = new PanelController()
    const launchManager = (opts: { context?: string; projectName?: string; existingSessionId?: string; onLaunched?: (sessionId: string) => void } = {}) => launchNonLitigationManager(ctx, opts)
    const getArchivedSessionIds = (): Promise<Set<string>> => fetchArchivedSessionIds(ctx)
    try {
      uiDisposers.push(mountSidebarEntry(controller))
      uiDisposers.push(mountPanel(controller, launchManager, getArchivedSessionIds))
    } catch (error) {
      console.warn('[agentlex-nonlitigation] mount failed:', error)
    }
  }

  const unmount = (): void => {
    if (!mounted) return
    mounted = false
    for (const dispose of uiDisposers.splice(0)) dispose()
  }

  const sync = (): void => {
    if (getModuleToggles().nonlitigationEnabled) mount()
    else unmount()
  }
  sync()
  const onTogglesChanged = (e: Event): void => {
    setModuleToggles((e as CustomEvent<Partial<import('../../../shared/module-toggles').ModuleToggles>>).detail ?? {})
  }
  window.addEventListener('agentlex:toggles-changed', onTogglesChanged)

  // Live refresh — SSE bridge: the host forwards every store write over
  // /api/agentlex-nonlitigation/events-stream, re-dispatched as the window CustomEvent the panels listen for.
  ctx.effect(() => {
    let es: EventSource | null = null
    try {
      es = new EventSource('/api/agentlex-nonlitigation/events-stream')
      es.onmessage = (): void => {
        window.dispatchEvent(new CustomEvent('agentlex:registry-changed'))
      }
      es.onerror = (): void => {
        // The browser auto-reconnects; nothing to do here.
      }
    } catch (error) {
      console.warn('[agentlex-nonlitigation] EventSource unavailable:', error)
    }
    return () => { if (es) es.close() }
  }, 'agentlex-nonlitigation: live-refresh sse')

  const unsubscribe = subscribeToggles(sync)
  ctx.effect(() => () => {
    unsubscribe()
    window.removeEventListener('agentlex:toggles-changed', onTogglesChanged)
    disposePickBridge()
    unmount()
  }, 'agentlex-nonlitigation: ui mounts')
}
