/**
 * 模拟法庭面板挂载（中栏整列接管）。
 *
 * `conversation` 槽位是单占用的，外部插件无法声明槽位，因此面板在 DOM 层挂载：
 * 在会话中栏（`[class*="centerCol"]`，老 shell 回退 `[data-pane="conversation"]`）
 * 末尾追加一个 React 从不管理的容器。面板打开时以 `html[data-dsh-moot-active]`
 * 属性切换显隐（React 无参与），会话子树保持挂载、不失状态。
 *
 * 自愈：MutationObserver 监听 shell 重渲染后容器被移除的情况；ResizeObserver
 * 在中栏尺寸变化时重新确认容器与宽度变量。挂载失败只 console.warn，绝不 throw
 * （否则整个 web shell 启动失败）。
 */
import { createRoot, type Root } from 'react-dom/client'
import type { MootPanelController } from './controller.ts'
import { MootPanel } from './MootPanel.tsx'
import css from './panel.module.css'

/** 注入的面板容器（常驻 DOM，未激活时隐藏）。 */
export const PANEL_VIEW_SELECTOR = '[data-dsh-moot-view]'

const CONVERSATION_COLUMN_SELECTOR = '[data-pane="conversation"], [class*="centerCol"]'
const ACTIVE_ATTR = 'data-dsh-moot-active'
/** 兄弟面板的激活属性（诉讼/非诉/任务/ssh），打开时互相排斥。 */
const OTHER_ACTIVE_ATTRS = [
  'data-dsh-litigation-active',
  'data-dsh-nonlitigation-active',
  'data-dsh-task-active',
  'data-dsh-taskboard-active',
  'data-dsh-ssh-active',
]
/** 跨面板互斥事件；detail 是激活的面板名。 */
const ACTIVATE_EVENT = 'dsh-panel-activate'
const PANEL_NAME = 'moot-court'

/** 面板内容宽度（阅读栏）边界，拖拽左缘手柄调整并持久化。 */
const PANEL_MIN_WIDTH = 720
const PANEL_MAX_WIDTH = 1600
const PANEL_DEFAULT_WIDTH = 1160
const PANEL_WIDTH_STORAGE = 'agentlex-moot-court:panel-width'

/** 取中栏容器；shell 尚未挂载时返回 undefined。 */
function conversationColumn(): HTMLElement | undefined {
  return document.querySelector<HTMLElement>(CONVERSATION_COLUMN_SELECTOR) ?? undefined
}

/**
 * 挂载面板 React 树，并把显隐绑定到控制器的 panelOpen。
 * @param controller - 驱动视图的面板控制器。
 * @returns 清理函数（卸载 React 树并恢复中栏）。
 */
export function mountPanel(controller: MootPanelController): () => void {
  let root: Root | undefined
  let container: HTMLDivElement | undefined
  let host: HTMLDivElement | undefined

  /** 面板内容宽度（px，持久化）。 */
  const readWidth = (): number => {
    try {
      const stored = Number(localStorage.getItem(PANEL_WIDTH_STORAGE))
      if (Number.isFinite(stored) && stored >= PANEL_MIN_WIDTH && stored <= PANEL_MAX_WIDTH) return stored
    } catch { /* storage unavailable */ }
    return PANEL_DEFAULT_WIDTH
  }
  let panelWidth = readWidth()

  const applyWidth = (): void => {
    document.documentElement.style.setProperty('--moot-panel-width', `${panelWidth}px`)
  }

  const ensure = (): void => {
    if (container !== undefined) {
      if (container.isConnected) return
      root?.unmount()
      root = undefined
      host = undefined
      container.remove()
      container = undefined
    }
    const column = conversationColumn()
    if (column === undefined) return
    applyWidth()
    container = document.createElement('div')
    container.dataset.dshMootView = ''
    container.dataset.dshPlugin = 'moot-court'
    container.className = css.view
    column.appendChild(container)

    // 浮在面板左缘的关闭按钮。
    const closeBtn = document.createElement('button')
    closeBtn.type = 'button'
    closeBtn.className = css.closeFab
    closeBtn.setAttribute('aria-label', '关闭模拟法庭面板')
    closeBtn.title = '关闭'
    closeBtn.textContent = '✕'
    closeBtn.addEventListener('click', () => controller.close())
    container.appendChild(closeBtn)

    // 左缘拖拽改宽手柄（手柄在面板左侧：向左拖变宽）。
    const handle = document.createElement('div')
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

    // React 树宿主填满面板。
    host = document.createElement('div')
    host.className = css.host
    container.appendChild(host)
    root = createRoot(host)
    // React 渲染失败不能把 shell 拖下水。
    try {
      root.render(<MootPanel controller={controller} onClose={() => controller.close()} />)
    } catch (error) {
      console.warn('[agentlex-moot-court] panel render failed:', error)
    }
  }

  const waitObserver = new MutationObserver(() => { ensure() })
  waitObserver.observe(document.body, { childList: true, subtree: true })

  // 尺寸变化自愈：中栏被 shell 重排后重新确认容器与宽度变量。
  const resizeObserver = new ResizeObserver(() => {
    applyWidth()
    ensure()
  })
  const observeColumn = (): void => {
    const column = conversationColumn()
    if (column !== undefined) resizeObserver.observe(column)
  }
  observeColumn()

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
  // 点击侧边栏会话/工作区行时让出中栏（与诉讼面板一致）。
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
    resizeObserver.disconnect()
    unsubscribe()
    document.documentElement.removeAttribute(ACTIVE_ATTR)
    try {
      root?.unmount()
    } catch (error) {
      console.warn('[agentlex-moot-court] panel unmount failed:', error)
    }
    root = undefined
    container?.remove()
    container = undefined
  }
}
