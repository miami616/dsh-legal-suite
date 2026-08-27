/**
 * Sidebar entry injection for dsh-legal-suite/nonlitigation.
 */
import type { PanelController } from './controller.ts'
import { tt } from './i18n.ts'
import css from './panel.module.css'
import { mountSidebarEntry as mountSharedSidebarEntry } from './sidebar-entry-core.ts'

export const ENTRY_SELECTOR = '[data-dsh-nonlitigation-entry]'

/** Inline icon: the original app's FileText icon (非诉项目). */
const ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>'

export function mountSidebarEntry(controller: PanelController): () => void {
  return mountSharedSidebarEntry({
    rowAttribute: 'data-dsh-nonlitigation-entry',
    rowSelector: ENTRY_SELECTOR,
    plugin: 'nonlitigation',
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
