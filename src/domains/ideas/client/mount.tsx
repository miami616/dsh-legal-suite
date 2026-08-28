/**
 * Modal mounting for dsh-legal-suite/ideas.
 *
 * 弹窗模式：把想法面板渲染为「挂到 body 顶层的居中浮层」，随 controller 的
 * panelOpen 状态显示/隐藏。不再整列覆盖会话区。
 */
import { createRoot, type Root } from 'react-dom/client'
import type { PanelController } from './controller.ts'
import { OriginalIdeasPanel } from './OriginalIdeasPanel.tsx'

export const PANEL_VIEW_SELECTOR = '[data-dsh-ideas-modal]'

export function mountPanel(controller: PanelController): () => void {
  let root: Root | undefined
  let container: HTMLDivElement | undefined

  const render = (): void => {
    if (container === undefined) return
    if (controller.getSnapshot().panelOpen) {
      if (root === undefined) {
        root = createRoot(container)
      }
      root.render(<OriginalIdeasPanel onClose={() => controller.close()} />)
      container.style.display = ''
    } else if (root !== undefined) {
      root.unmount()
      root = undefined
      container.style.display = 'none'
    }
  }

  // Create a persistent body-level host once; the overlay visibility follows
  // the controller snapshot.
  const ensure = (): void => {
    if (container !== undefined && container.isConnected) return
    container = document.createElement('div')
    container.dataset.dshIdeasModal = ''
    container.dataset.dshPlugin = 'ideas'
    container.style.display = 'none'
    document.body.appendChild(container)
    render()
  }

  const waitObserver = new MutationObserver(() => { ensure() })
  waitObserver.observe(document.body, { childList: true, subtree: true })

  const unsubscribe = controller.subscribe(render)
  ensure()
  render()

  return () => {
    waitObserver.disconnect()
    unsubscribe()
    root?.unmount()
    root = undefined
    container?.remove()
    container = undefined
  }
}
