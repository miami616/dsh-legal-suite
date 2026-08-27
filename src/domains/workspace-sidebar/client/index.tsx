/**
 * Browser-half entry for dsh-legal-suite/workspace-sidebar.
 *
 * Mounts the AgentLex workspace as an independent right panel — no longer a
 * dsh-better-sidebar tab. Session context (current session id + cwd) comes
 * from the dsh sessions feed (`ctx.sessions`).
 */
import '@/i18n'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { mountWorkspacePanel } from './mount.tsx'
import { workspaceCss } from './generated-workspace-css.ts'
import { mountConversationLinkHandler, mountConversationLinkContextMenu } from './conversation-links.ts'

export const name = 'dsh-legal-suite/workspace-sidebar'
export const inject = ['slots', 'sessions']

/** Inject the AgentLex renderer CSS once. */
function injectWorkspaceCss(): () => void {
  if (typeof document === 'undefined') return () => {}
  const EXTRA_CSS = `
[data-agentlex-workspace-root] .group\/cap-divider { display: none !important; }
[data-agentlex-workspace-root] [data-capabilities-panel] { display: none !important; }
/* 缩进展开：面板打开时给 AppFrame 加右侧 margin，会话区域同步收缩，
   而不是被 fixed 面板覆盖在顶层。宽度由 mount.tsx 的 --agentlex-ws-width 驱动。 */
html[data-agentlex-workspace-active="true"] [class*="frame"] {
  margin-right: var(--agentlex-ws-width, 340px);
}
@media (max-width: 1023px) {
  html[data-agentlex-workspace-active="true"] [class*="frame"] {
    margin-right: 0;
  }
}
/* 白色主题：覆盖注入的 AgentLex 米色 paper 主题，背景改纯白，
   强调色保持插件主题色（--accent #c26d3a）不变。!important 是为了压过
   ThemeRuntimeProvider 后注入的 myagents-active-theme-stylesheet。 */
html[data-color-scheme="light"], html[data-theme-id="myagents-default"][data-color-scheme="light"] {
  --paper: #ffffff !important;
  --paper-elevated: #ffffff !important;
  --paper-inset: #f2f0ec !important;
  --paper-a0: rgb(255 255 255 / 0) !important;
  --paper-elevated-a0: rgb(255 255 255 / 0) !important;
  --paper-inset-a0: rgb(242 240 236 / 0) !important;
  --global-sidebar-bg: #f7f7f7 !important;
  --global-sidebar-bg-a0: rgb(247 247 247 / 0) !important;
  --message-user-bg: #ffffff !important;
  --message-user-bg-a0: rgb(255 255 255 / 0) !important;
  --theme-body-background: linear-gradient(180deg, #ffffff 0%, #f7f7f7 100%) !important;
  --theme-body-texture-blend: normal !important;
}
/* 主题色联动：切换 AgentLex 主题（html[data-agentlex-theme]）时，工作区面板的
   强调色跟随 --alx-accent（dsh-skin themes.css 提供的当前主题强调色）。 */
html[data-agentlex-theme] [data-agentlex-workspace-root] {
  --accent: var(--alx-accent, var(--accent));
  --accent-warm: var(--alx-accent, var(--accent-warm));
  --accent-warm-hover: var(--alx-accent, var(--accent-warm-hover));
  --accent-warm-strong: var(--alx-accent, var(--accent-warm-strong));
}
`
  const tagId = 'agentlex-workspace-sidebar-css'
  if (document.querySelector(`style[data-agentlex-workspace-css="${tagId}"]`) !== null) return () => {}
  const tag = document.createElement('style')
  tag.dataset.agentlexWorkspaceCss = tagId
  tag.textContent = workspaceCss + EXTRA_CSS
  document.head.appendChild(tag)
  return () => tag.remove()
}

export function apply(ctx: ClientContext): void {
  const removeCss = injectWorkspaceCss()
  let disposePanel: (() => void) | null = null
  let disposeLinks: (() => void) | null = null
  let disposeContextMenu: (() => void) | null = null
  let panelEnabled = true
  let openRefsEnabled = true

  // 从 AgentLex 设置（设置 → AgentLex 设置 → 模块开关）读取：
  //   workspaceSidebarEnabled — 工作区右边栏总开关（卸载/重挂面板）；
  //   openReferencesInSidebar  — 会话内文件/链接点击用侧边栏打开。
  const sync = (): void => {
    if (panelEnabled) {
      if (disposePanel === null) disposePanel = mountWorkspacePanel(ctx)
      if (disposeLinks === null && openRefsEnabled) disposeLinks = mountConversationLinkHandler(ctx)
      // 右键菜单（显示路径/打开/复制/预览）独立于「点击用边栏打开」开关，常驻。
      if (disposeContextMenu === null) disposeContextMenu = mountConversationLinkContextMenu(ctx)
    } else {
      disposePanel?.()
      disposePanel = null
      disposeLinks?.()
      disposeLinks = null
      disposeContextMenu?.()
      disposeContextMenu = null
    }
  }
  const onToggles = (e: Event): void => {
    const detail = (e as CustomEvent<Record<string, unknown>>).detail ?? {}
    if (typeof detail.workspaceSidebarEnabled === 'boolean') panelEnabled = detail.workspaceSidebarEnabled
    if (typeof detail.openReferencesInSidebar === 'boolean') openRefsEnabled = detail.openReferencesInSidebar
    if (disposeLinks !== null && !openRefsEnabled) {
      disposeLinks()
      disposeLinks = null
    }
    sync()
  }
  window.addEventListener('agentlex:toggles-changed', onToggles)
  sync()
  ctx.effect(() => () => {
    window.removeEventListener('agentlex:toggles-changed', onToggles)
    disposePanel?.()
    disposeLinks?.()
    disposeContextMenu?.()
    removeCss()
  }, 'dsh-legal-suite/workspace-sidebar: panel + links + css')
}
