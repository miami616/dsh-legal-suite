/**
 * Panel view mounting.
 *
 * The `conversation` slot is single-occupant (ui-conversation) and external
 * plugins cannot declare slots, so the panel mounts at the DOM level: a
 * container is appended inside the center column (`[class*="centerCol"]`,
 * with `[data-pane="conversation"]` fallback for older shells) as an extra
 * trailing child React never manages. The panel is a RIGHT-SIDE column that
 * PUSHES the conversation aside (缩进展开): a stylesheet rule gives the
 * conversation content a right margin equal to the panel width while the
 * panel is active, so both stay visible side by side. Toggling is a data
 * attribute on <html> — no React involvement, so the conversation subtree
 * underneath stays mounted and stateful.
 */
import { createRoot, type Root } from 'react-dom/client'
import type { PanelController } from './controller.ts'
import { OriginalLitigationPanel } from './OriginalLitigationPanel.tsx'
import css from './panel.module.css'

/** The injected panel container (kept in the DOM, hidden when inactive). */
export const PANEL_VIEW_SELECTOR = '[data-dsh-litigation-view]'

const CONVERSATION_COLUMN_SELECTOR = '[data-pane="conversation"], [class*="centerCol"]'
const ACTIVE_ATTR = 'data-dsh-litigation-active'
/** Sibling panels' activation attributes (task board / ssh), evicted on open. */
const OTHER_ACTIVE_ATTRS = ['data-dsh-taskboard-active', 'data-dsh-ssh-active']
/** Cross-plugin activation event; detail is the activating panel name. */
const ACTIVATE_EVENT = 'dsh-panel-activate'
const PANEL_NAME = 'litigation'

/** 请求任务管理面板打开（备忘录 #12：案件看板统计点击 → 任务面板）。 */
export function requestTaskPanelOpen(): void {
  window.dispatchEvent(new CustomEvent('agentlex:open-task-panel'))
}

/** Panel width bounds (px) for the drag-to-resize handle. */
const PANEL_MIN_WIDTH = 360
const PANEL_MAX_WIDTH = 720
const PANEL_DEFAULT_WIDTH = 480
const PANEL_WIDTH_STORAGE = 'agentlex-litigation:panel-width'

/** Find the center column, or undefined while the frame is not mounted. */
function conversationColumn(): HTMLElement | undefined {
  return document.querySelector<HTMLElement>(CONVERSATION_COLUMN_SELECTOR) ?? undefined
}

/**
 * Mount the panel React tree into the center column and bind its visibility
 * to the controller's panelOpen state.
 * @param controller - the panel controller driving the view.
 * @param launchManager - opens the 诉讼管家 system agent session.
 * @param openCaseFolder - opens a bound case folder in the better-sidebar.
 * @param getArchivedSessionIds - resolves the DSH workspace archive set
 *   (sessions hidden by 归档会话 must not be offered as historical sessions).
 * @returns disposer unmounting the tree and restoring the column.
 */
export function mountPanel(
  controller: PanelController,
  launchManager: (opts?: { context?: string; caseName?: string; existingSessionId?: string; onLaunched?: (sessionId: string) => void }) => Promise<string | undefined>,
  openCaseFolder?: (folder: string, title?: string, sessionId?: string) => void,
  getArchivedSessionIds?: () => Promise<Set<string>>,
): () => void {
  let root: Root | undefined
  let container: HTMLDivElement | undefined
  let host: HTMLDivElement | undefined
  let closeBtn: HTMLButtonElement | undefined
  let handle: HTMLDivElement | undefined

  /** Panel width in px (persisted). */
  const readWidth = (): number => {
    try {
      const stored = Number(localStorage.getItem(PANEL_WIDTH_STORAGE))
      if (Number.isFinite(stored) && stored >= PANEL_MIN_WIDTH && stored <= PANEL_MAX_WIDTH) return stored
    } catch { /* storage unavailable */ }
    return PANEL_DEFAULT_WIDTH
  }
  let panelWidth = readWidth()

  const applyWidth = (): void => {
    document.documentElement.style.setProperty('--lit-panel-width', `${panelWidth}px`)
  }

  const ensure = (): void => {
    if (container !== undefined) {
      if (container.isConnected) return
      root?.unmount()
      root = undefined
      host = undefined
      closeBtn = undefined
      handle = undefined
      container.remove()
      container = undefined
    }
    const column = conversationColumn()
    if (column === undefined) return
    applyWidth()
    container = document.createElement('div')
    container.dataset.dshLitigationView = ''
    container.dataset.dshPlugin = 'litigation'
    container.className = css.view
    column.appendChild(container)

    // Close button floating on the conversation side of the panel edge.
    closeBtn = document.createElement('button')
    closeBtn.type = 'button'
    closeBtn.className = css.closeFab
    closeBtn.setAttribute('aria-label', '关闭诉讼案件面板')
    closeBtn.title = '关闭'
    closeBtn.textContent = '✕'
    closeBtn.addEventListener('click', () => controller.close())
    container.appendChild(closeBtn)

    // Drag-to-resize handle on the panel's left edge.
    handle = document.createElement('div')
    handle.className = css.resizeHandle
    handle.setAttribute('aria-hidden', 'true')
    let dragging = false
    let startX = 0
    let startWidth = panelWidth
    const onPointerDown = (e: PointerEvent): void => {
      dragging = true
      startX = e.clientX
      startWidth = panelWidth
      document.body.style.userSelect = 'none'
      e.preventDefault()
    }
    const onPointerMove = (e: PointerEvent): void => {
      if (!dragging) return
      // Handle sits on the panel's LEFT edge: dragging left widens the panel.
      const next = Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, Math.round(startWidth + (startX - e.clientX))))
      if (next !== panelWidth) {
        panelWidth = next
        try { localStorage.setItem(PANEL_WIDTH_STORAGE, String(panelWidth)) } catch { /* ignore */ }
        applyWidth()
      }
    }
    const onPointerUp = (): void => {
      if (!dragging) return
      dragging = false
      document.body.style.userSelect = ''
    }
    handle.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    container.appendChild(handle)

    // React tree host fills the panel.
    host = document.createElement('div')
    host.className = css.host
    container.appendChild(host)
    root = createRoot(host)
    root.render(<OriginalLitigationPanel launchManager={launchManager} onClose={() => controller.close()} openCaseFolder={openCaseFolder} getArchivedSessionIds={getArchivedSessionIds} controller={controller} />)
  }

  const waitObserver = new MutationObserver(() => { ensure() })
  waitObserver.observe(document.body, { childList: true, subtree: true })

  const applyActive = (): void => {
    if (controller.getSnapshot().panelOpen) {
      for (const attr of OTHER_ACTIVE_ATTRS) document.documentElement.removeAttribute(attr)
      document.documentElement.setAttribute(ACTIVE_ATTR, '')
      document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: PANEL_NAME }))
    } else {
      document.documentElement.removeAttribute(ACTIVE_ATTR)
    }
  }
  const onOtherActivate = (event: Event): void => {
    const other = (event as CustomEvent).detail as string
    if (other !== PANEL_NAME && controller.getSnapshot().panelOpen) controller.close()
  }
  // Jump out on sidebar context clicks: clicking a session/workspace row
  // hands the center column back to the conversation.
  const SIDEBAR_ROW_SELECTOR = '[class*="sessionRow"], [class*="projectRow"], [class*="searchResultRow"], [class*="searchResultWorkspace"], [class*="newSession"]'
  const onClickSidebarRow = (event: MouseEvent): void => {
    if (!controller.getSnapshot().panelOpen) return
    const target = event.target as HTMLElement | null
    if (target === null) return
    if (target.closest(SIDEBAR_ROW_SELECTOR) !== null) controller.close()
  }
  document.addEventListener('click', onClickSidebarRow, true)
  document.addEventListener(ACTIVATE_EVENT, onOtherActivate)
  const unsubscribe = controller.subscribe(applyActive)
  applyActive()
  ensure()

  return () => {
    document.removeEventListener('click', onClickSidebarRow, true)
    document.removeEventListener(ACTIVATE_EVENT, onOtherActivate)
    waitObserver.disconnect()
    unsubscribe()
    document.documentElement.removeAttribute(ACTIVE_ATTR)
    root?.unmount()
    root = undefined
    container?.remove()
    container = undefined
  }
}
