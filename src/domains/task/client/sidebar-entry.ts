/**
 * Sidebar entry injection for dsh-legal-suite/task.
 */
import type { PanelController } from './controller.ts'
import { tt } from './i18n.ts'
import css from './panel.module.css'
import { mountSidebarEntry as mountSharedSidebarEntry } from './sidebar-entry-core.ts'

export const ENTRY_SELECTOR = '[data-dsh-task-entry]'

/** Inline icon: the original app's ListChecks icon (任务管理). */
const ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 5h8"/><path d="M13 12h8"/><path d="M13 19h8"/><path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/></svg>'

export function mountSidebarEntry(controller: PanelController): () => void {
  return mountSharedSidebarEntry({
    rowAttribute: 'data-dsh-task-entry',
    rowSelector: ENTRY_SELECTOR,
    plugin: 'task',
    icon: ICON,
    css,
    label: () => tt('entry.label'),
    tooltip: () => tt('entry.tooltip'),
    onToggle: () => { controller.toggle() },
    position: 'after',
    familySelectors: ['[data-dsh-litigation-entry]', '[data-dsh-nonlitigation-entry]', '[data-dsh-task-entry]'],
    active: {
      subscribe: (listener) => controller.subscribe(listener),
      isOpen: () => controller.getSnapshot().panelOpen,
    },
  })
}
