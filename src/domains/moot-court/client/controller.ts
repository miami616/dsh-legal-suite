/**
 * moot-court 面板控制器：面板开关 / 当前视图 / 当前会话的唯一持有者。
 *
 * 与 litigation/client/controller.ts 同构——框架无关的小订阅面（subscribe +
 * getSnapshot），DOM 挂载层与 React 面板共享同一份状态，互不直接通信。
 * 状态只存在浏览器会话内，不落盘。
 */

/** 面板的四个视图。 */
export type MootView = 'list' | 'wizard' | 'live' | 'report'

/** 不可变控制器快照，供 UI 订阅。 */
export interface MootPanelSnapshot {
  panelOpen: boolean
  view: MootView
  /** 当前选中的模拟会话 id（列表/向导视图为空）。 */
  sessionId: string | null
}

/** 侧边栏入口切换、面板渲染共同依赖的状态宿主。 */
export class MootPanelController {
  private panelOpen = false
  private view: MootView = 'list'
  private sessionId: string | null = null
  private listeners = new Set<() => void>()

  getSnapshot(): MootPanelSnapshot {
    return { panelOpen: this.panelOpen, view: this.view, sessionId: this.sessionId }
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

  /** 切换视图（不改变当前会话）。 */
  setView(view: MootView): void {
    if (this.view === view) return
    this.view = view
    this.notify()
  }

  /** 选中一个会话并打开面板；默认进入直播视图。 */
  openSession(sessionId: string, view: MootView = 'live'): void {
    this.sessionId = sessionId
    this.view = view
    this.panelOpen = true
    this.notify()
  }

  /** 打开「新建模拟」向导（不预设会话）。 */
  startWizard(): void {
    this.sessionId = null
    this.view = 'wizard'
    this.panelOpen = true
    this.notify()
  }

  /** 回到列表（删除当前会话后调用）。 */
  backToList(): void {
    this.sessionId = null
    this.view = 'list'
    this.notify()
  }

  /** 当前会话被删除后清空选择。 */
  clearSession(): void {
    if (this.sessionId === null) return
    this.sessionId = null
    if (this.view === 'live' || this.view === 'report') this.view = 'list'
    this.notify()
  }

  private notify(): void {
    for (const fn of [...this.listeners]) fn()
  }
}
