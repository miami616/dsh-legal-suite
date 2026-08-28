/**
 * Browser-half entry for dsh-legal-suite/ideas.
 *
 * 表面：
 *  - 侧边栏底部「想法」按钮（sidebar.footer.action 槽位，设置在按钮旁）
 *  - 「想法」弹窗（居中浮层）
 *  - 输入框「想法」选择按钮（conversation.input.left）
 *  - `#` 输入触发器
 *  - SSE 实时刷新
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { PanelController } from './controller.ts'
import { en, zh, type IdeaKey } from './locales.ts'
import { mountPanel } from './mount.tsx'
import { IdeasFooterAction } from './footer-action.tsx'
import { IdeasPicker } from './input-button.tsx'
import { registerIdeaTrigger } from './triggers.ts'
import { mountIdeasFooter } from './footer-move.ts'
import { getModuleToggles, setModuleToggles, subscribe as subscribeToggles } from '../../../shared/module-toggles'

const NS = 'agentlex-ideas'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'agentlex-ideas': IdeaKey
  }
}

export const inject = ['slots', 'locale', 'inputTriggers']

export type { PanelControllerSnapshot } from './controller.ts'
export type { IdeaKey } from './locales.ts'

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'agentlex-ideas: dictionaries')

  let uiDisposers: Array<() => void> = []
  let mounted = false

  const mount = (): void => {
    if (mounted) return
    mounted = true
    const controller = new PanelController()
    try {
      // 侧边栏底部「想法」按钮：注入样式 + 移入 settingsArea 与设置对齐。
      uiDisposers.push(mountIdeasFooter())
      // 弹窗面板。
      uiDisposers.push(mountPanel(controller))
      // 侧边栏底部「想法」按钮（设置在旁；点击打开弹窗）。
      uiDisposers.push(ctx.slots.register({
        name: 'sidebar.footer.action',
        id: 'agentlex-ideas',
        order: 70,
      }, IdeasFooterAction as never))
      // 输入框「想法」选择按钮。
      uiDisposers.push(ctx.slots.register({
        name: 'conversation.input.left',
        id: 'agentlex-ideas',
        order: 70,
      }, IdeasPicker as never))
      // `#` 输入触发器。
      uiDisposers.push(registerIdeaTrigger(ctx as never))

      // 让底部按钮能打开弹窗：监听点击事件桥接。
      const onFooterClick = (event: Event): void => {
        const target = event.target as HTMLElement | null
        if (target === null) return
        if (target.closest('[data-agentlex-ideas-footer]') !== null) {
          controller.open()
        }
      }
      document.addEventListener('click', onFooterClick, true)
      uiDisposers.push(() => document.removeEventListener('click', onFooterClick, true))
    } catch (error) {
      console.warn('[agentlex-ideas] mount failed:', error)
    }
  }

  const unmount = (): void => {
    if (!mounted) return
    mounted = false
    for (const dispose of uiDisposers.splice(0)) dispose()
  }

  const sync = (): void => {
    if (getModuleToggles().ideasEnabled) mount()
    else unmount()
  }
  sync()
  const onTogglesChanged = (e: Event): void => {
    setModuleToggles((e as CustomEvent<Partial<import('../../../shared/module-toggles').ModuleToggles>>).detail ?? {})
  }
  window.addEventListener('agentlex:toggles-changed', onTogglesChanged)

  // Live refresh — SSE bridge. 注：SSE 长连接可能占用浏览器同源连接池，
  // 导致 /api/agentlex-ideas/ideas 等 fetch 挂起；面板改为「挂载时拉取 +
  // 乐观更新」，SSE 仅作后台刷新兜底（失败不影响主流程）。
  ctx.effect(() => {
    let es: EventSource | null = null
    try {
      es = new EventSource('/api/agentlex-ideas/events-stream')
      es.onmessage = (): void => {
        window.dispatchEvent(new CustomEvent('agentlex:ideas-changed'))
      }
      es.onerror = (): void => {
        // auto-reconnect
      }
    } catch (error) {
      console.warn('[agentlex-ideas] EventSource unavailable:', error)
    }
    return () => { if (es) es.close() }
  }, 'agentlex-ideas: live-refresh sse')

  const unsubscribe = subscribeToggles(sync)
  ctx.effect(() => () => {
    unsubscribe()
    window.removeEventListener('agentlex:toggles-changed', onTogglesChanged)
    unmount()
  }, 'agentlex-ideas: ui mounts')
}
