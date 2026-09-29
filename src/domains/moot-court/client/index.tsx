/**
 * dsh-legal-suite/moot-court — 浏览器端入口（client half）。
 *
 * 装配顺序与其它域一致：
 *   1. 注册本域 locale 字典（NS = agentlex-moot-court）；
 *   2. 按 shared/module-toggles 的 mootCourtEnabled 挂载/卸载两个 DOM 面：
 *      侧边栏入口行（切换面板）与中栏面板（React root）；
 *   3. 订阅模块开关变更（跨插件 CustomEvent + 共享 store）；
 *   4. 订阅 /events-stream SSE，把 host 的变更广播转成页面事件，实现实时刷新。
 *
 * 失败策略：DOM 挂载异常只 console.warn，绝不 throw——外部插件 apply 抛错会让
 * 整个 web shell 启动失败。
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only：拉入 locale 插件的 Context 合并（ctx.locale）与 LocaleNamespaceMap 表。
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { MootPanelController } from './controller.ts'
import { en, zh, type MootKey } from './locales.ts'
import { mountPanel } from './mount.tsx'
import { mountSidebarEntry } from './sidebar-entry.ts'
import { subscribeMootEvents } from './api.ts'
import {
  getModuleToggles, setModuleToggles, subscribe as subscribeToggles, type ModuleToggles,
} from '../../../shared/module-toggles.ts'

/** 本插件拥有的 locale 命名空间。 */
const NS = 'agentlex-moot-court'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** AgentLex 模拟法庭面板文案。 */
    'agentlex-moot-court': MootKey
  }
}

export const name = 'dsh-legal-suite/moot-court'

/** 需要的客户端服务（locale 注册）。 */
export const inject = ['locale']

/** 仅类型导出（packages/client 规则：/client 面只带类型）。 */
export type { MootKey } from './locales.ts'
export type { MootPanelSnapshot, MootView } from './controller.ts'

/**
 * 挂载模拟法庭面板与侧边栏入口。
 * @param ctx - 客户端根上下文（locale 服务）。
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'agentlex-moot-court: dictionaries')

  let uiDisposers: Array<() => void> = []
  let mounted = false

  const mount = (): void => {
    if (mounted) return
    mounted = true
    const controller = new MootPanelController()
    try {
      uiDisposers.push(mountSidebarEntry(controller))
      uiDisposers.push(mountPanel(controller))
      // 实时刷新：host 在会话/记录写入后经 SSE 广播，本域转成页面事件
      // `agentlex:moot-changed`（列表、直播、报告视图都监听）。只在开关打开时订阅——
      // 关闭时 host 根本不注册该路由，无条件订阅会让每个页面都发一次 404 并反复重连。
      uiDisposers.push(subscribeMootEvents())
    } catch (error) {
      console.warn('[agentlex-moot-court] mount failed:', error)
    }
  }

  const unmount = (): void => {
    if (!mounted) return
    mounted = false
    for (const dispose of uiDisposers.splice(0)) {
      try {
        dispose()
      } catch (error) {
        console.warn('[agentlex-moot-court] unmount failed:', error)
      }
    }
  }

  const sync = (): void => {
    if (getModuleToggles().mootCourtEnabled) mount()
    else unmount()
  }
  sync()

  const onTogglesChanged = (event: Event): void => {
    setModuleToggles((event as CustomEvent<Partial<ModuleToggles>>).detail ?? {})
  }
  window.addEventListener('agentlex:toggles-changed', onTogglesChanged)
  const unsubscribe = subscribeToggles(sync)

  ctx.effect(() => () => {
    unsubscribe()
    window.removeEventListener('agentlex:toggles-changed', onTogglesChanged)
    unmount()
  }, 'agentlex-moot-court: ui mounts')
}
