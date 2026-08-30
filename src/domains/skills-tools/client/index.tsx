/**
 * 技能与工具 — browser half（合包域，纯 client）。
 *
 * 表面：
 *  1. 边栏入口行（与 AGENTLEX 组同级并列、组下方）——切换技能与工具面板；
 *  2. 面板（整列覆盖）：MyAgents 风格 —— 标题 + 描述 + Sticky 选项卡
 *     （技能 / 工具 · MCP），技能支持上传解析创建，MCP 支持 JSON 粘贴
 *     添加，全部即时生效；「召唤」把指令复制到剪贴板。
 *
 * 数据经宿主 /api/agentlex-skills/* 读写：技能落盘 ~/.dsh/skills，
 * MCP 热加载并持久化到 $DSH_HOME/plugins/dsh-skill-config/state.json。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { createRoot, type Root } from 'react-dom/client'
import { SkillsToolsPanel } from './SkillsToolsPanel.tsx'
import { SkillsToolsPicker } from './input-button.tsx'
import { mountSkillsSidebarEntry } from './sidebar-entry.ts'
import { registerSlashSource } from './triggers.ts'
import { OPEN_PANEL_EVENT, type SkillsToolsTab } from './summon.ts'
import { fetchState } from './api.ts'
import { getState, setState, startPolling } from './store.ts'
import { getModuleToggles, subscribe as subscribeToggles } from '../../../shared/module-toggles'
import css from './skills-tools.module.css'

export const name = 'dsh-legal-suite'

/** 所需服务（并集：slots/locale/sessions/inputTriggers 由套件注入）。 */
export const inject = ['slots', 'locale', 'sessions', 'inputTriggers']

const CONVERSATION_COLUMN_SELECTOR = '[data-pane="conversation"], [class*="centerCol"]'
const ACTIVE_ATTR = 'data-agentlex-skills-active'
const OTHER_ACTIVE_ATTRS = ['data-dsh-litigation-active', 'data-dsh-nonlitigation-active', 'data-dsh-task-active', 'data-dsh-taskboard-active', 'data-dsh-ssh-active']
const ACTIVATE_EVENT = 'dsh-panel-activate'
const PANEL_NAME = 'skills-tools'

/** 简单订阅器：面板开合状态。 */
class SkillsPanelState {
  private open = false
  private listeners = new Set<() => void>()
  isOpen(): boolean { return this.open }
  setOpen(next: boolean): void {
    if (this.open === next) return
    this.open = next
    for (const listener of this.listeners) listener()
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

export function apply(ctx: ClientContext): void {
  const state = new SkillsPanelState()
  let uiDisposers: Array<() => void> = []
  let mounted = false
  let stopPolling: (() => void) | null = null
  /** 面板未挂载时由输入框/命令发来的目标选项卡（挂载后作为 initialTab）。 */
  let pendingTab: SkillsToolsTab = 'skills'

  // 加载状态（后端不可用时保持空）。
  void fetchState().then(setState).catch(() => undefined)

  // 面板未挂载时也能被打开：输入框按钮 / `/` 命令发出的事件在此兜底
  // （面板组件内部的监听只在挂载后生效）。
  const onOpenPanel = (event: Event): void => {
    const detail = (event as CustomEvent<SkillsToolsTab>).detail
    if (detail === 'tools' || detail === 'skills') pendingTab = detail
    if (!state.isOpen()) {
      state.setOpen(true)
      applyActive?.()
    }
  }
  let applyActive: () => void = () => {}

  const mount = (): void => {
    if (mounted) return
    mounted = true
    stopPolling = startPolling()

    let root: Root | undefined
    let container: HTMLDivElement | undefined

    const ensurePanel = (): void => {
      if (!state.isOpen()) return
      if (container !== undefined && container.isConnected) return
      const column = document.querySelector<HTMLElement>(CONVERSATION_COLUMN_SELECTOR)
      if (column === null || column === undefined) return
      container = document.createElement('div')
      container.dataset.agentlexSkillsView = ''
      container.dataset.dshPlugin = 'skills-tools'
      container.className = css.view
      column.appendChild(container)
      root = createRoot(container)
      root.render(
        <SkillsToolsPanel
          initialTab={pendingTab}
          onClose={() => state.setOpen(false)}
        />,
      )
    }

    const teardownPanel = (): void => {
      root?.unmount()
      root = undefined
      container?.remove()
      container = undefined
    }

    applyActive = (): void => {
      if (state.isOpen()) {
        for (const attr of OTHER_ACTIVE_ATTRS) document.documentElement.removeAttribute(attr)
        document.documentElement.setAttribute(ACTIVE_ATTR, '')
        document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: PANEL_NAME }))
        ensurePanel()
      } else {
        document.documentElement.removeAttribute(ACTIVE_ATTR)
        teardownPanel()
      }
    }
    const onOtherActivate = (event: Event): void => {
      const other = (event as CustomEvent).detail as string
      if (other !== PANEL_NAME && state.isOpen()) state.setOpen(false)
    }
    const onClickSidebarRow = (event: MouseEvent): void => {
      if (!state.isOpen()) return
      const target = event.target as HTMLElement | null
      if (target === null) return
      const SIDEBAR_ROW_SELECTOR = '[class*="sessionRow"], [class*="projectRow"], [class*="searchResultRow"], [class*="searchResultWorkspace"], [class*="newSession"]'
      if (target.closest(SIDEBAR_ROW_SELECTOR) !== null) state.setOpen(false)
    }

    const waitObserver = new MutationObserver(() => { if (state.isOpen()) ensurePanel() })
    waitObserver.observe(document.body, { childList: true, subtree: true })

    try {
      // 边栏入口（与 AGENTLEX 组同级并列、组下方）。
      uiDisposers.push(mountSkillsSidebarEntry({
        onToggle: () => state.setOpen(!state.isOpen()),
        active: {
          subscribe: (listener) => state.subscribe(listener),
          isOpen: () => state.isOpen(),
        },
      }))
      // 输入框「技能」选择按钮（conversation.input.left 槽位，codex-ui 同款）。
      // 0.1.2-alpha.1 时序：直接注册会撞 not-declared，改用 slots.inject 等
      // ui-conversation 声明就绪（槽渲染时）再注册；老版无 slots.inject 时直接注册。
      const slotsService = ctx.slots as unknown as {
        inject?(name: string, fn: () => unknown): unknown
        register(o: unknown, c: unknown): unknown
      }
      const registerSkillsPicker = (): void => {
        uiDisposers.push(slotsService.register({
          name: 'conversation.input.left',
          id: 'agentlex-skills-tools',
          order: 60,
        }, SkillsToolsPicker as never))
      }
      if (typeof slotsService.inject === 'function') {
        const injected = slotsService.inject('conversation.input.left', registerSkillsPicker)
        if (injected === undefined) registerSkillsPicker()
      } else {
        registerSkillsPicker()
      }
      // `/` 命令（打开面板 / 添加技能 / 添加 MCP）。
      uiDisposers.push(registerSlashSource(ctx as never))
    } catch (error) {
      console.warn('[agentlex-skills] mount failed:', error)
    }

    document.addEventListener('click', onClickSidebarRow, true)
    document.addEventListener(ACTIVATE_EVENT, onOtherActivate)
    window.addEventListener(OPEN_PANEL_EVENT, onOpenPanel)
    const unsubscribe = state.subscribe(applyActive)
    applyActive()

    uiDisposers.push(() => {
      document.removeEventListener('click', onClickSidebarRow, true)
      document.removeEventListener(ACTIVATE_EVENT, onOtherActivate)
      window.removeEventListener(OPEN_PANEL_EVENT, onOpenPanel)
      waitObserver.disconnect()
      unsubscribe()
      teardownPanel()
      document.documentElement.removeAttribute(ACTIVE_ATTR)
      stopPolling?.()
      stopPolling = null
    })
  }

  const unmount = (): void => {
    if (!mounted) return
    mounted = false
    for (const dispose of uiDisposers.splice(0)) dispose()
  }

  const sync = (): void => {
    if (getModuleToggles().skillsToolsEnabled) mount()
    else unmount()
  }
  sync()
  const unsubscribeToggles = subscribeToggles(sync)
  ctx.effect(() => () => {
    unsubscribeToggles()
    unmount()
  }, 'agentlex-skills-tools: ui mounts')
}
