/**
 * Browser-half entry for dsh-legal-suite/litigation — runs inside the dsh web
 * GUI.
 *
 * Registers the plugin locale dictionaries and mounts the two DOM surfaces:
 * the sidebar entry row (toggles the panel) and the litigation panel in the
 * center column. Failure policy: DOM mounting problems are logged, never
 * thrown — the web shell fails the whole boot when a plugin apply throws, and
 * an external plugin must not take the GUI down.
 *
 * Export discipline (packages/client rule): the /client surface carries what
 * cordis loading needs plus types only — all value exports stay internal.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { bindCaseWorkspaces, installAgentlexPickBridge } from '../../../shared/folder-picker.ts'
import { installSessionSnapshotBridge } from '../../../shared/session-snapshot.ts'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the LocaleNamespaceMap merge table.
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the settings.section slot contract (settings page entries).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the agentlex.workbench.item slot contract (workbench block).
import './workbench-slot.ts'
import { PanelController } from './controller.ts'
import { en, zh, type LitigationKey } from './locales.ts'
import { launchLitigationManager, fetchArchivedSessionIds } from './launch-manager.ts'
import { mountPanel } from './mount.tsx'
import { mountSidebarEntry } from './sidebar-entry.ts'
import { mountCaseDetailView } from './case-detail-view.tsx'
import { openCaseFolderInSidebar, registerCaseFolderTab, type ClientContextWithSidebar } from './better-sidebar.tsx'
import { readRegistry } from './api.ts'
import { PluginUpdaterSettings } from './updater-settings.tsx'
import { getModuleToggles, setModuleToggles, subscribe as subscribeToggles } from '../../../shared/module-toggles'

/** Locale namespace this plugin owns. */
const NS = 'agentlex-litigation'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** AgentLex litigation surface copy. */
    'agentlex-litigation': LitigationKey
  }
}

/** Required services (fiber inject waiting — the runtime must be up first).
 *  `workspaces` 必须注入：目录选择桥（旧版 UI 的「绑定/更换文件夹」）在点击时
 *  经 ctx 惰性解析 workspaces.pickDirectory()；不注入则 apply 后该服务可能
 *  尚未挂载（issue:「案件绑定/更换文件夹仍然不可用」）。
 *  注意：不要 inject `remote` 系列（remote / remote.session / remote.workspace）——
 *  它们只在 harness >= v0.1.2-alpha.1（typert gateway）存在，老版（rc.2/rc.8）
 *  没有；那些版本上等待不存在的服务会让插件挂起。gateway remote 改由
 *  session-bridge 在运行时 root-first 解析（无则降级 ctx.sessions.create），
 *  `connection` 保留（老版公有的 ConnectionHandle）。 */
export const inject = ['slots', 'locale', 'sessions', 'workspaces', 'connection']

/** Type-only surface (export discipline: no value exports beyond the plugin contract). */
export type { PanelControllerSnapshot } from './controller.ts'
export type { LitigationKey } from './locales.ts'

/**
 * Mount the litigation panel.
 * @param ctx - client root context (locale service).
 */
export function apply(ctx: ClientContextWithSidebar): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'agentlex-litigation: dictionaries')
  bindCaseWorkspaces(ctx)
  // 旧版 AgentLex 渲染层（Original*Panel）的「绑定/更换文件夹」通过该桥调用
  // DSH 原生目录选择框（workspaces.pickDirectory）。
  const disposePickBridge = installAgentlexPickBridge()
  const disposeSnapshotBridge = installSessionSnapshotBridge(ctx)
  registerCaseFolderTab(ctx)

  let uiDisposers: Array<() => void> = []
  let mounted = false

  const mount = (): void => {
    if (mounted) return
    mounted = true
    const controller = new PanelController()
    const launchManager = (opts: { context?: string; caseName?: string; existingSessionId?: string; onLaunched?: (sessionId: string) => void } = {}): Promise<string | undefined> =>
      launchLitigationManager(ctx, opts)
    const getArchivedSessionIds = (): Promise<Set<string>> => fetchArchivedSessionIds(ctx)
    try {
      uiDisposers.push(mountSidebarEntry(controller))
      uiDisposers.push(mountCaseDetailView(ctx, launchManager, (folder, title, sessionId) => {
        openCaseFolderInSidebar(ctx, folder, title, sessionId)
      }, getArchivedSessionIds))
      uiDisposers.push(mountPanel(controller, launchManager, (folder, title, sessionId) => {
        openCaseFolderInSidebar(ctx, folder, title, sessionId)
      }, getArchivedSessionIds))
    } catch (error) {
      console.warn('[agentlex-litigation] mount failed:', error)
    }
  }

  const unmount = (): void => {
    if (!mounted) return
    mounted = false
    for (const dispose of uiDisposers.splice(0)) dispose()
  }

  const sync = (): void => {
    if (getModuleToggles().litigationEnabled) mount()
    else unmount()
  }
  sync()
  const onTogglesChanged = (e: Event): void => {
    setModuleToggles((e as CustomEvent<Partial<import('../../../shared/module-toggles').ModuleToggles>>).detail ?? {})
  }
  window.addEventListener('agentlex:toggles-changed', onTogglesChanged)

  const unsubscribe = subscribeToggles(sync)
  ctx.effect(() => () => {
    unsubscribe()
    window.removeEventListener('agentlex:toggles-changed', onTogglesChanged)
    disposePickBridge()
    disposeSnapshotBridge()
    unmount()
  }, 'agentlex-litigation: ui mounts')

  // Live refresh — PRIMARY channel is SSE: the host forwards every store
  // write (cases/tasks/timeline/schedules) over /api/agentlex-case/events-stream,
  // and the EventSource re-dispatches the `agentlex:registry-changed`
  // CustomEvent the panels (useAgentLex) listen for — real-time, no polling.
  ctx.effect(() => {
    let es: EventSource | null = null
    try {
      es = new EventSource('/api/agentlex-case/events-stream')
      es.onmessage = (): void => {
        window.dispatchEvent(new CustomEvent('agentlex:registry-changed'))
      }
      es.onerror = (): void => {
        // The browser auto-reconnects; the poll fallback below covers gaps.
      }
    } catch (error) {
      console.warn('[agentlex-litigation] EventSource unavailable:', error)
    }
    return () => { if (es) es.close() }
  }, 'agentlex-litigation: live-refresh sse')

  // Fallback channel: a slow registry-fingerprint poll, only for when the
  // SSE bridge is down (the host's lastUpdated only moves on case-registry
  // writes; timeline/schedule refresh rides the SSE channel).
  ctx.effect(() => {
    let last = ''
    let timer: number | undefined
    const poll = async (): Promise<void> => {
      try {
        const reg = await readRegistry()
        const stamp = reg.lastUpdated ?? ''
        if (stamp !== '' && stamp !== last) {
          last = stamp
          window.dispatchEvent(new CustomEvent('agentlex:registry-changed'))
        } else if (last === '' && stamp !== '') {
          last = stamp
        }
      } catch {
        // Backend not reachable yet; skip this tick.
      }
    }
    // Slow enough to be nearly free (cases-only fingerprint; SSE does the
    // real-time work), fast enough to self-heal a dead bridge.
    const INTERVAL = 30_000
    void poll()
    timer = window.setInterval(() => { void poll() }, INTERVAL)
    return () => { if (timer !== undefined) window.clearInterval(timer) }
  }, 'agentlex-litigation: live-refresh poll fallback')

  // 「插件版本与更新」设置块：挂在 dsh-skin 的「AgentLex 设置」设置页内
  // （agentlex.workbench.item 槽位），不再占用独立的顶层设置项。该槽位由 skin
  // 在注册工作台设置页时通过 children 声明；客户端加载顺序不保证，因此
  // 「未声明」时按 500ms 重试直到声明出现。皮肤缺席时该槽位无人渲染
  // （套件正规装配总带皮肤；单独安装时可用 CLI dsh plugin 更新）。
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
          id: 'agentlex-plugin-update',
          order: 60,
          label: '插件版本与更新',
        }, PluginUpdaterSettings)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (!message.includes('is not declared')) {
          console.warn('[agentlex-litigation] updater workbench item registration failed:', error)
          return
        }
        attempts += 1
        if (attempts < MAX_ATTEMPTS) {
          timer = window.setTimeout(register, 500)
        } else {
          console.warn('[agentlex-litigation] updater workbench item not declared after retries:', error)
        }
      }
    }
    register()
    return () => {
      if (timer !== undefined) window.clearTimeout(timer)
      if (dispose !== undefined) dispose()
    }
  }, 'agentlex-litigation: updater workbench item')
}
