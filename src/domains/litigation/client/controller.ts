/**
 * Litigation panel controller: the single owner of the panel's open/closed
 * state. Framework-free (task-board controller.ts style) so the DOM mounts
 * and the React panel share one tiny subscription surface. State lives only
 * for the browser session (no persistence).
 */

/** Immutable controller snapshot for UI subscriptions. */
export interface PanelControllerSnapshot {
  panelOpen: boolean
  /** Case id requested from outside (e.g. the session-header detail button). */
  pendingCaseId: string | null
}

/** The panel state owner the sidebar entry toggles and the view renders from. */
export class PanelController {
  private panelOpen = false
  private pendingCaseId: string | null = null
  private listeners = new Set<() => void>()

  getSnapshot(): PanelControllerSnapshot {
    return { panelOpen: this.panelOpen, pendingCaseId: this.pendingCaseId }
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  open(): void {
    if (this.panelOpen) return
    this.panelOpen = true
    this.notify()
  }

  close(): void {
    if (!this.panelOpen) return
    this.panelOpen = false
    this.notify()
  }

  toggle(): void {
    if (this.panelOpen) this.close()
    else this.open()
  }

  /** Open the panel and select the given case detail when it renders. */
  openCase(caseId: string): void {
    this.pendingCaseId = caseId
    this.open()
    this.notify()
  }

  /** Read and clear the pending case id (called by the panel after applying it). */
  consumePendingCaseId(): string | null {
    const id = this.pendingCaseId
    this.pendingCaseId = null
    if (id !== null) this.notify()
    return id
  }

  private notify(): void {
    for (const fn of [...this.listeners]) fn()
  }
}
