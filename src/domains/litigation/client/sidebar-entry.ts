/**
 * Sidebar entry injection — package-specific wiring over the shared core.
 *
 * The DOM injection / self-healing / idempotency logic lives in
 * sidebar-entry-core.ts; this wrapper supplies the litigation icon, copy, CSS
 * module, and the panel toggle. The row is plain DOM (no React tree) so it
 * can never disturb the shell's reconciliation; the panel view it toggles is
 * a separate React root mounted in the center column (see mount.tsx).
 */
import type { PanelController } from './controller.ts'
import { tt } from './i18n.ts'
import css from './panel.module.css'
import { mountSidebarEntry as mountSharedSidebarEntry } from './sidebar-entry-core.ts'

/** Stable data attribute identifying the injected entry row. */
export const ENTRY_SELECTOR = '[data-dsh-litigation-entry]'

/** Inline icon: the original app's Folders icon (诉讼案件). */
const ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 5a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h2.5a1.5 1.5 0 0 1 1.2.6l.6.8a1.5 1.5 0 0 0 1.2.6z"/><path d="M3 8.268a2 2 0 0 0-1 1.738V19a2 2 0 0 0 2 2h11a2 2 0 0 0 1.732-1"/></svg>'

/**
 * Mount the sidebar entry, waiting for the shell to render and self-healing
 * on later React re-renders.
 * @param controller - the panel controller the entry toggles.
 * @returns disposer removing the entry and its observers.
 */
export function mountSidebarEntry(controller: PanelController): () => void {
  return mountSharedSidebarEntry({
    rowAttribute: 'data-dsh-litigation-entry',
    rowSelector: ENTRY_SELECTOR,
    plugin: 'litigation',
    icon: ICON,
    css,
    label: () => tt('entry.label'),
    tooltip: () => tt('entry.tooltip'),
    onToggle: () => { controller.toggle() },
    position: 'after',
    familySelectors: ['[data-dsh-taskboard-entry]', '[data-dsh-ssh-entry]', '[data-dsh-litigation-entry]'],
    active: {
      subscribe: (listener) => controller.subscribe(listener),
      isOpen: () => controller.getSnapshot().panelOpen,
    },
  })
}
