/**
 * DSH 原生挂载 for dsh-legal-suite/workspace-sidebar (Phase 1 / 1.1).
 *
 * 挂载方式与 dsh-better-sidebar 一致（DSH 原生，稳定，不被 React 重渲染挤掉）：
 *   - 面板 host 建在 `document.body` 上（`position: fixed` 右栏），而非改
 *     AppFrame 的 `grid-template-columns`；
 *   - 用 `createRoot` + `<ErrorBoundary>` 渲染内容（崩溃不再整块白屏）；
 *   - 开/合 = 开关 host 的 `data-*` 状态并位移 / 指针拦截，宽 240–640 可拖拽，
 *     持久化到 localStorage；
 *   - 会话绑定（sessionId / cwd）来自 DSH sessions feed，订阅变化自动重渲染；
 *   - MutationObserver 只在 host 节点被移除时重新挂回（自愈），不再和 grid 打架。
 *
 * 折叠按钮：优先贴到对话标题行（tablist）最右，找不到则回退为一个固定浮动按钮。
 */
import { createRoot, type Root } from 'react-dom/client'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { WorkspacePanel } from './WorkspacePanel.tsx'
import { ErrorBoundary } from './ErrorBoundary.tsx'
import { ThemeRuntimeProvider } from '@/theme'
import { disposeTitleBarStrip, subscribeTitleBarStrip } from './titlebar-strip.ts'

/** Attribute marking the injected panel host. */
export const PANEL_SELECTOR = '[data-agentlex-workspace-panel]'
const HOST_ATTR = 'data-agentlex-workspace-host'
const ACTIVE_ATTR = 'data-agentlex-workspace-active'
const TOGGLE_ATTR = 'data-agentlex-workspace-toggle'
const HANDLE_ATTR = 'data-agentlex-workspace-handle'

const STORAGE_OPEN = 'agentlex-workspace:open'
const STORAGE_WIDTH = 'agentlex-workspace:width'

const DEFAULT_WIDTH = 340
const MIN_WIDTH = 240
const MAX_WIDTH = 640
const MOBILE_QUERY = '(max-width: 1023px)'

/** dsw-token styled 16px panel-right / panel-left icons. */
const PANEL_LEFT_ICON = '<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="2"/><path d="M9.5 2.5v11"/></svg>'
const PANEL_RIGHT_ICON = '<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="2"/><path d="M6.5 2.5v11"/></svg>'

function readStorage(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* storage unavailable — non-critical */
  }
}

/** Current session id + cwd from the sessions feed. */
interface SessionScope {
  sessionId: string
  cwd: string
}

function readScope(ctx: ClientContext): SessionScope | undefined {
  const info = ctx.sessions.currentProvideInfo.getSnapshot()
  const sessionId = info?.sessionId
  if (!sessionId) return undefined
  const list = ctx.sessions.list.getSnapshot()
  const row = list?.byId ? (list.byId as Record<string, { cwd?: string }>)[sessionId] : undefined
  return { sessionId, cwd: row?.cwd ?? '' }
}

/**
 * Mount the workspace panel as a body-anchored, fixed right column.
 * Returns a disposer.
 */
export function mountWorkspacePanel(ctx: ClientContext): () => void {
  const isMobile = window.matchMedia(MOBILE_QUERY)
  // 默认关闭：新用户（无 localStorage 记录）首次进入时右边栏不默认展开，
  // 避免新会话页面被面板占据。用户手动打开过（localStorage='1'）或会话内
  // 触发 agentlex-workspace:panel-open 时仍会正常打开。
  const initialOpen = readStorage(STORAGE_OPEN, '0') !== '0'
  const initialWidth = Math.min(
    MAX_WIDTH,
    Math.max(MIN_WIDTH, Number(readStorage(STORAGE_WIDTH, String(DEFAULT_WIDTH))) || DEFAULT_WIDTH),
  )

  let open = initialOpen
  let width = initialWidth
  let host: HTMLElement | null = null
  let spanHost: HTMLElement | null = null
  let root: Root | null = null
  let toggle: HTMLButtonElement | null = null
  let handle: HTMLElement | null = null

  const paintToggle = (): void => {
    if (!toggle) return
    toggle.innerHTML = open ? PANEL_RIGHT_ICON : PANEL_LEFT_ICON
    toggle.setAttribute('aria-expanded', String(open))
  }

  const applyOpen = (): void => {
    const isClosed = !open
    host?.setAttribute(ACTIVE_ATTR, String(open))
    spanHost?.setAttribute(ACTIVE_ATTR, String(open))
    if (spanHost) {
      spanHost.style.width = `${width}px`
    }
    if (host) {
      host.style.pointerEvents = isClosed ? 'none' : 'auto'
      // 用 right 位移代替 transform 做滑入/滑出：transform 会给宿主创建
      // containing block，导致面板内 position:fixed 的子元素（右键菜单、
      // tooltip 等）以面板为基准定位而跑到屏幕外。
      host.style.right = isClosed ? `-${width}px` : '0'
      // 保留滚动能力：打开时禁用外层 pointer-events 干扰。
      host.style.visibility = 'visible'
    }
    // 缩进展开：把激活状态与当前宽度暴露到 <html>，CSS 据此给 AppFrame
    // 加右侧 margin，让会话区域同步收缩（而不是被面板覆盖）。
    if (open) {
      document.documentElement.setAttribute(ACTIVE_ATTR, 'true')
      document.documentElement.style.setProperty('--agentlex-ws-width', `${width}px`)
    } else {
      document.documentElement.removeAttribute(ACTIVE_ATTR)
    }
    paintToggle()

    // 打开时通知外部（如诉讼详情页「在侧边栏打开」）。
    if (open) {
      window.dispatchEvent(new CustomEvent('dsh-panel-activate', { detail: 'agentlex-workspace' }))
    }
  }

  /** Build the host + toggle once, attach to body. */
  const build = (): void => {
    if (host === null) {
      host = document.createElement('div')
      host.setAttribute(HOST_ATTR, '')
      host.setAttribute(PANEL_SELECTOR.slice(1, -1), '')
      host.style.cssText = [
        'position: fixed; top: 0; right: 0; bottom: 0; z-index: 40;',
        'min-width: 0; min-height: 0; overflow: hidden;',
        'display: flex; flex-direction: column;',
        'background: var(--dsw-alias-bg-layer-1, var(--paper-elevated, #ffffff));',
        'border-left: 1px solid var(--dsw-alias-border-l2, var(--line-subtle, #e5e5e5));',
        'transition: right 200ms ease;',
        // 无边框桌面壳（Windows）的原生标题栏按钮悬浮在内容右上角；跟随
        // titlebar-strip 契约（--dsh-title-bar-strip）把面板内容让出顶部，
        // 避免面板头部按钮也被关窗按钮盖住。
        'padding-top: var(--dsh-title-bar-strip, 0px);',
      ].join(' ')
    }
    host.style.width = `${width}px`

    if (spanHost === null) {
      spanHost = document.createElement('div')
      spanHost.style.cssText = 'flex: 1 1 auto; min-width: 0; min-height: 0; overflow: hidden; display: flex; flex-direction: column;'
      host.appendChild(spanHost)
    }

    // Drag handle (left edge).
    if (handle === null) {
      handle = document.createElement('div')
      handle.setAttribute(HANDLE_ATTR, '')
      handle.style.cssText = `
        position: absolute; left: -4px; top: 0; bottom: 0;
        width: 8px; cursor: col-resize; touch-action: none; z-index: 3;
      `
      let dragging = false
      let dragStartX = 0
      let dragStartWidth = width
      const onPointerDown = (e: PointerEvent): void => {
        if (isMobile.matches) return
        dragging = true
        dragStartX = e.clientX
        dragStartWidth = width
        document.body.style.userSelect = 'none'
        e.preventDefault()
      }
      const onPointerMove = (e: PointerEvent): void => {
        if (!dragging) return
        // 拖拽把手在左缘：向左移动增大面板。
        const dt = dragStartX - e.clientX
        const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(dragStartWidth + dt)))
        if (next !== width) {
          width = next
          writeStorage(STORAGE_WIDTH, String(width))
          applyOpen()
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
    }
    if (handle.parentElement !== host) host.appendChild(handle)

    if (toggle === null) {
      toggle = document.createElement('button')
      toggle.setAttribute(TOGGLE_ATTR, '')
      toggle.type = 'button'
      toggle.setAttribute('aria-label', '工作区')
      toggle.title = '工作区'
      toggle.setAttribute('aria-controls', 'agentlex-workspace-panel')
      toggle.style.cssText = `
        margin-left: auto; flex: none; display: inline-flex; align-items: center;
        justify-content: center; width: 34px; height: 34px; border: 0; border-radius: 9px;
        cursor: pointer; color: var(--dsw-alias-label-tertiary, var(--ink-muted, #8b8b98));
        background: transparent; transition: background-color 120ms ease, color 120ms ease;
      `
      toggle.addEventListener('click', () => {
        open = !open
        writeStorage(STORAGE_OPEN, open ? '1' : '0')
        applyOpen()
      })
    }

    placeToggle()

    // Render the panel content once (root).
    if (root === null) {
      root = createRoot(spanHost as HTMLElement)
      const render = (): void => {
        const scope = readScope(ctx)
        // 跟随 DSH 应用当前配色（深/浅），而不是强制 light：否则用户在设置里
        // 切深色模式时，这里会把 html 的 color-scheme 顶回 light，全局不生效。
        const appearanceMode =
          document.documentElement.getAttribute('data-color-scheme') === 'dark'
            ? 'dark'
            : 'light'
        root?.render(
          <ErrorBoundary title="工作区内容加载出错">
            {/* The app's Markdown/CodeBlock renderers call useResolvedTheme,
                which requires a ThemeRuntimeProvider. Provide a myagents-default
                runtime following the app's color scheme (no bootstrap
                persistence, no native window sync) so md previews don't throw
                and dark mode still applies. */}
            <ThemeRuntimeProvider
              selection={{ themeId: 'myagents-default', appearanceMode }}
              persistBootstrapSnapshot={false}
              syncNativeWindowBackground={false}
            >
              <WorkspacePanel sessionId={scope?.sessionId} cwd={scope?.cwd} />
            </ThemeRuntimeProvider>
          </ErrorBoundary>,
        )
      }
      const unsubInfo = ctx.sessions.currentProvideInfo.subscribe(render)
      const unsubList = ctx.sessions.list.subscribe(render)
      // 应用层切换深/浅色时会改 <html data-color-scheme>，跟随重渲染。
      const schemeObserver = new MutationObserver(render)
      schemeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-color-scheme'],
      })
      render()
      ;(root as unknown as { __unsubs?: () => void }).__unsubs = () => {
        unsubInfo()
        unsubList()
        schemeObserver.disconnect()
      }
    }

    if (host.parentElement !== document.body) document.body.appendChild(host)
    applyOpen()
  }

  const placeToggle = (): void => {
    if (!toggle) return
    // 固定视口右上角（better-sidebar 风格）：不进标签行、不随面板宽度移动。
    // 之前放进 [role=tablist] 时，面板展开会让 frame 收缩，按钮跟着标签行
    // 跑到视口中间——用户明确要求固定在最右侧。
    // 纵向位置跟随 --dsh-title-bar-strip（titlebar-strip.ts 解析的桌面壳
    // 标题栏高度，Windows 下 = 原生关闭按钮所在高度）：按钮整体下移到
    // 原生标题栏之下，避免落在「关闭窗口」按钮上（issue: win 用户反馈）。
    // 纯网页（无标题栏契约）时 strip = 0，仍为原来的 12px。
    toggle.style.position = 'fixed'
    toggle.style.top = 'calc(var(--dsh-title-bar-strip, 0px) + 1px)'
    toggle.style.right = '12px'
    toggle.style.margin = '0'
    toggle.style.zIndex = '2147483000'
    if (toggle.parentElement !== document.body) document.body.appendChild(toggle)
  }

  const place = (): void => {
    if (host === null) build()
    else if (host.parentElement !== document.body) document.body.appendChild(host)
    placeToggle()
  }

  // 自愈：host / toggle 被 React 或别的代码移除时重新挂回（不再改 grid）。
  const observer = new MutationObserver(() => {
    if (host !== null && host.parentElement !== document.body) document.body.appendChild(host)
    if (toggle !== null && toggle.parentElement === null) placeToggle()
    placeToggle()
  })
  observer.observe(document.body, { childList: true, subtree: true })

  // 外部「打开面板」请求（如 案件详情页「在侧边栏打开」）。
  const onPanelOpen = (): void => {
    if (!open) {
      open = true
      writeStorage(STORAGE_OPEN, '1')
      applyOpen()
    }
  }
  window.addEventListener('agentlex-workspace:panel-open', onPanelOpen)

  const onMobileChange = (): void => {
    placeToggle()
    if (!isMobile.matches) applyOpen()
  }
  isMobile.addEventListener('change', onMobileChange)

  build()
  place()

  // 桌面壳标题栏高度变化（最大化/还原/移动时 WCO geometrychange）→ 重新
  // 摆放折叠按钮。CSS var 本身会自动生效，这里仅为自愈路径兜底。
  const unsubStrip = subscribeTitleBarStrip(() => placeToggle())

  return () => {
    unsubStrip()
    disposeTitleBarStrip()
    observer.disconnect()
    isMobile.removeEventListener('change', onMobileChange)
    window.removeEventListener('agentlex-workspace:panel-open', onPanelOpen)
    if (root) {
      const unsubs = (root as unknown as { __unsubs?: () => void }).__unsubs
      unsubs?.()
      root.unmount()
    }
    host?.remove()
    toggle?.remove()
    handle?.remove()
    root = null
    host = null
    toggle = null
    handle = null
  }
}
