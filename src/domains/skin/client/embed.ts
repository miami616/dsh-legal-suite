/**
 * Embed the original AgentLexNext React app into the DSH center column.
 *
 * This is the "外壳皮肤" approach: DSH remains the shell, and the original
 * AgentLex UI is loaded in an iframe. The iframe talks to the DSH adapter
 * through the Vite proxy (dev) or a static build served by DSH (prod).
 */
import { mountSidebarEntry } from './sidebar-entry-core.ts'

export type AgentLexModule = 'cases' | 'contracts' | 'taskcenter' | 'home'

const css = {
  entry: 'agentlex-skin-entry',
  entryIcon: 'agentlex-skin-entry-icon',
  entryLabel: 'agentlex-skin-entry-label',
}

const APP_BASE = 'http://localhost:5173'
const VIEW_SELECTOR = '[data-dsh-agentlex-view]'
const ACTIVE_ATTR = 'data-dsh-agentlex-active'
const CONVERSATION_SELECTOR = '[data-pane="conversation"], [class*="centerCol"] > *:not([data-dsh-agentlex-view])'

let iframe: HTMLIFrameElement | undefined
let container: HTMLDivElement | undefined
let styleTag: HTMLStyleElement | undefined

function ensureStyle(): void {
  if (styleTag !== undefined && styleTag.isConnected) return
  styleTag = document.createElement('style')
  styleTag.textContent = `
    html[${ACTIVE_ATTR}] [data-pane="conversation"],
    html[${ACTIVE_ATTR}] [class*="centerCol"] > *:not([data-dsh-agentlex-view]) {
      display: none !important;
    }
    [data-dsh-agentlex-view] {
      display: none;
      width: 100%;
      height: 100%;
      min-height: 0;
      flex: 1;
      border: 0;
      background: var(--paper, #fff);
    }
    html[${ACTIVE_ATTR}] [data-dsh-agentlex-view] {
      display: flex;
    }
    [data-dsh-agentlex-view] iframe {
      width: 100%;
      height: 100%;
      border: 0;
      background: var(--paper, #fff);
    }
    .agentlex-skin-entry {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 7px 10px;
      border: 0;
      border-radius: 8px;
      background: transparent;
      color: var(--ink, inherit);
      font: inherit;
      cursor: pointer;
      text-align: left;
    }
    .agentlex-skin-entry:hover {
      background: var(--hover-bg, rgba(128,128,128,.12));
    }
    .agentlex-skin-entry[data-active='true'] {
      background: var(--hover-bg, rgba(128,128,128,.18));
    }
    .agentlex-skin-entry-icon {
      display: inline-flex;
      flex: none;
      color: var(--accent, currentColor);
    }
    .agentlex-skin-entry-label {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  `
  document.head.appendChild(styleTag)
}

function centerColumn(): HTMLElement | undefined {
  return document.querySelector<HTMLElement>('[data-pane="conversation"], [class*="centerCol"]') ?? undefined
}

function ensureContainer(): HTMLDivElement | undefined {
  ensureStyle()
  if (container !== undefined) {
    if (container.isConnected) return container
    container.remove()
    container = undefined
  }
  const column = centerColumn()
  if (column === undefined) return undefined
  container = document.createElement('div')
  container.dataset.dshAgentlexView = ''
  container.dataset.dshPlugin = 'agentlex-embed'
  column.appendChild(container)
  iframe = document.createElement('iframe')
  iframe.title = 'AgentLex'
  iframe.setAttribute('allow', 'clipboard-write; clipboard-read')
  container.appendChild(iframe)
  return container
}

export function openModule(module: AgentLexModule): void {
  const col = ensureContainer()
  if (col === undefined || iframe === undefined) return
  iframe.src = `${APP_BASE}/#/${module}`
  document.documentElement.setAttribute(ACTIVE_ATTR, '')
  // Evict sibling plugin panels.
  document.dispatchEvent(new CustomEvent('dsh-panel-activate', { detail: 'agentlex-embed' }))
}

export function close(): void {
  document.documentElement.removeAttribute(ACTIVE_ATTR)
}

export function mountAgentLexEntries(): () => void {
  const disposers: Array<() => void> = []
  const entries: Array<{ id: AgentLexModule; label: string; icon: string }> = [
    { id: 'cases', label: '诉讼案件', icon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 5a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h2.5a1.5 1.5 0 0 1 1.2.6l.6.8a1.5 1.5 0 0 0 1.2.6z"/><path d="M3 8.268a2 2 0 0 0-1 1.738V19a2 2 0 0 0 2 2h11a2 2 0 0 0 1.732-1"/></svg>' },
    { id: 'contracts', label: '非诉项目', icon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg>' },
    { id: 'taskcenter', label: '任务管理', icon: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 5h8"/><path d="M13 12h8"/><path d="M13 19h8"/><path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/></svg>' },
  ]
  for (const entry of entries) {
    disposers.push(mountSidebarEntry({
      rowAttribute: `data-dsh-agentlex-${entry.id}-entry`,
      rowSelector: `[data-dsh-agentlex-${entry.id}-entry]`,
      plugin: 'agentlex-embed',
      icon: entry.icon,
      css,
      label: () => entry.label,
      tooltip: () => `打开原版${entry.label}`,
      onToggle: () => openModule(entry.id),
      position: 'after',
      familySelectors: ['[data-dsh-agentlex-cases-entry]', '[data-dsh-agentlex-contracts-entry]', '[data-dsh-agentlex-taskcenter-entry]'],
    }))
  }
  // Close the embedded view when clicking normal DSH session rows.
  const onSidebarRow = (event: MouseEvent): void => {
    if (!document.documentElement.hasAttribute(ACTIVE_ATTR)) return
    const target = event.target as HTMLElement | null
    if (target === null) return
    if (target.closest('[class*="sessionRow"], [class*="newSession"], [class*="projectRow"]') !== null) close()
  }
  document.addEventListener('click', onSidebarRow, true)
  disposers.push(() => document.removeEventListener('click', onSidebarRow, true))
  return () => {
    for (const dispose of disposers.splice(0)) dispose()
    close()
    container?.remove()
    container = undefined
    iframe = undefined
    styleTag?.remove()
    styleTag = undefined
  }
}
