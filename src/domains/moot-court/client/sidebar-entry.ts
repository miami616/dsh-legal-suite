/**
 * 模拟法庭侧边栏入口注入 —— 共享核心（shared/sidebar-entry-core.ts）的域内接线。
 *
 * DOM 注入 / 自愈 / 幂等逻辑都在共享核心里；这里只提供法槌图标、文案、CSS
 * module 与面板开关。入口行是纯 DOM（不含 React 树），因此不会干扰 shell 的
 * 协调；它切换的面板是独立 React root（见 mount.tsx）。
 */
import type { MootPanelController } from './controller.ts'
import { tt } from './i18n.ts'
import css from './panel.module.css'
import { mountSidebarEntry as mountSharedSidebarEntry } from '../../../shared/sidebar-entry-core.ts'

/** 入口行的稳定 data 属性（幂等键 / 选择器）。 */
export const ENTRY_SELECTOR = '[data-dsh-moot-entry]'

/** 内联图标：法槌（gavel）。 */
const ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14 13-7.5 7.5a2.12 2.12 0 0 1-3-3L11 10"/><path d="m16 16 6-6"/><path d="m8 8 6-6"/><path d="m9 7 8 8"/><path d="m21 11-8-8"/></svg>'

/**
 * 挂载侧边栏入口，等待 shell 渲染并在后续 React 重渲染时自愈。
 * @param controller - 入口切换的面板控制器。
 * @returns 清理函数（移除入口行与观察器）。
 */
export function mountSidebarEntry(controller: MootPanelController): () => void {
  return mountSharedSidebarEntry({
    rowAttribute: 'data-dsh-moot-entry',
    rowSelector: ENTRY_SELECTOR,
    plugin: 'moot-court',
    icon: ICON,
    css,
    label: () => tt('entry.label'),
    tooltip: () => tt('entry.tooltip'),
    onToggle: () => { controller.toggle() },
    position: 'after',
    familySelectors: [
      '[data-dsh-litigation-entry]',
      '[data-dsh-taskboard-entry]',
      '[data-dsh-ssh-entry]',
      '[data-dsh-moot-entry]',
    ],
    active: {
      subscribe: (listener) => controller.subscribe(listener),
      isOpen: () => controller.getSnapshot().panelOpen,
    },
  })
}
