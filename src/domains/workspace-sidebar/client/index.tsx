/**
 * Browser-half entry for dsh-legal-suite/workspace-sidebar.
 *
 * 优先接入 DSH 官方右边栏（`ctx.sidebarRightTabs` + `ctx.sidebarRight`，
 * 见 official-sidebar.tsx）：把 AgentLex 文件树（含右键菜单）注册为官方
 * 右边栏的 tab 并接管官方 `files` 页；服务缺席（旧 harness）时退回自绘
 * 右栏面板（mount.tsx，body 锚定 + AppFrame 右侧缩进）。
 *
 * Session context (current session id + cwd) comes from the dsh sessions feed
 * (`ctx.sessions`).
 */
import '@/i18n'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { mountWorkspacePanel } from './mount.tsx'
import { mountOfficialSidebarFiles } from './official-sidebar.tsx'
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
  let disposeOfficial: (() => void) | null = null
  let disposeLinks: (() => void) | null = null
  let disposeContextMenu: (() => void) | null = null
  let panelEnabled = true
  let autoCaseTabEnabled = true
  // 官方右边栏接入（备忘 #30）：服务/槽位可能晚于本插件就绪，短轮询重试；
  // 重试期内不挂自绘面板（避免两套面板同时出现），放弃后再退回自绘。
  let officialAttempts = 0
  let officialUnavailable = false
  let officialRetry: number | undefined

  const OFFICIAL_MAX_ATTEMPTS = 10
  const OFFICIAL_RETRY_MS = 300

  const clearOfficialRetry = (): void => {
    if (officialRetry !== undefined) {
      window.clearTimeout(officialRetry)
      officialRetry = undefined
    }
  }

  // 从 AgentLex 设置（设置 → AgentLex 设置 → 模块开关）读取：
  //   workspaceSidebarEnabled — 右侧文件栏总开关（官方右边栏接入 + 自绘兜底 +
  //                             会话内文件链接拦截）；
  //   openReferencesInSidebar  — 「自动打开案件卷宗」：会话绑定案件/项目时，
  //                             右边栏自动带上卷宗面板。
  const sync = (): void => {
    if (!panelEnabled) {
      disposeOfficial?.()
      disposeOfficial = null
      disposePanel?.()
      disposePanel = null
      disposeLinks?.()
      disposeLinks = null
      disposeContextMenu?.()
      disposeContextMenu = null
      clearOfficialRetry()
      return
    }
    // 官方右边栏优先：接管官方 files 页，自绘面板退役。
    if (disposeOfficial === null && !officialUnavailable) {
      disposeOfficial = mountOfficialSidebarFiles(ctx, { autoOpenCaseTab: autoCaseTabEnabled })
      if (disposeOfficial !== null) {
        disposePanel?.()
        disposePanel = null
        clearOfficialRetry()
      } else {
        officialAttempts += 1
        if (officialAttempts < OFFICIAL_MAX_ATTEMPTS) {
          if (officialRetry === undefined) {
            officialRetry = window.setTimeout(() => {
              officialRetry = undefined
              sync()
            }, OFFICIAL_RETRY_MS)
          }
        } else {
          officialUnavailable = true
        }
      }
    }
    if (disposePanel === null && disposeOfficial === null && officialUnavailable) {
      disposePanel = mountWorkspacePanel(ctx)
    }
    // 会话内文件/链接 → 右侧栏：属于「右侧文件栏」本体能力，只看总开关。
    if (disposeLinks === null) disposeLinks = mountConversationLinkHandler(ctx)
    // 右键菜单（显示路径/打开/复制/预览）独立于「点击用边栏打开」开关，常驻。
    if (disposeContextMenu === null) disposeContextMenu = mountConversationLinkContextMenu(ctx)
  }
  const onToggles = (e: Event): void => {
    const detail = (e as CustomEvent<Record<string, unknown>>).detail ?? {}
    if (typeof detail.workspaceSidebarEnabled === 'boolean') panelEnabled = detail.workspaceSidebarEnabled
    if (typeof detail.autoOpenCaseTab === 'boolean') {
      const changed = autoCaseTabEnabled !== detail.autoOpenCaseTab
      autoCaseTabEnabled = detail.autoOpenCaseTab
      // 「自动打开案件卷宗」改了：官方接入需按新值重挂。
      if (changed) {
        disposeOfficial?.()
        disposeOfficial = null
        officialUnavailable = false
        officialAttempts = 0
      }
    }
    sync()
  }
  window.addEventListener('agentlex:toggles-changed', onToggles)
  sync()
  ctx.effect(() => () => {
    window.removeEventListener('agentlex:toggles-changed', onToggles)
    clearOfficialRetry()
    disposeOfficial?.()
    disposePanel?.()
    disposeLinks?.()
    disposeContextMenu?.()
    removeCss()
  }, 'dsh-legal-suite/workspace-sidebar: panel + links + css')
}
