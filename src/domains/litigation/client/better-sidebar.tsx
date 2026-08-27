/**
 * Minimal typed integration with dsh-better-sidebar.
 *
 * The plugin is installed as an external DSH web plugin and publishes
 * `ctx.betterSidebar` on the client context. We keep the dependency
 * optional: if the service is absent (better-sidebar not installed), the
 * litigation UI simply falls back to the existing OS-open behavior.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ReactNode } from 'react'
import { CaseFolderTab } from './case-folder-tab.tsx'
import { CaseFolderOpenIcon } from './case-folder-icons.tsx'

/** The tab type this plugin registers with better-sidebar. */
export const CASE_FOLDER_TAB_TYPE = 'agentlex:case-folder'

/** Unique tab id (several case-folder tabs may be open side by side). */
function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
}

/** Minimal session scope accepted by better-sidebar open calls. */
export interface BetterSidebarScope {
  sessionId: string
  cwd?: string
}

/** Minimal tab shape passed to tab components. */
export interface BetterSidebarTab {
  id: string
  type: string
  title: string
  path?: string
  meta?: unknown
}

/** Minimal props a registered tab component receives. */
export interface BetterSidebarTabComponentProps {
  ctx: ClientContextWithSidebar
  store: unknown
  scope: BetterSidebarScope
  tab: BetterSidebarTab
  visible: boolean
  expanded?: string[]
  onToggleDir?: (path: string) => void
  onReferenceFile?: (path: string) => void
  onOpenFile?: (path: string) => void
  onOpenDiff?: (tab: unknown) => void
  onSubagentJump?: (childSessionId: string) => void
}

/** Minimal tab descriptor accepted by registerTab. */
export interface BetterSidebarTabDescriptor {
  id: string
  title: string | (() => string)
  icon?: unknown
  order?: number
  hidden?: boolean
  single?: boolean
  dedupeKey?: (tab: BetterSidebarTab) => string | undefined
  component: (props: BetterSidebarTabComponentProps) => ReactNode
}

/** Minimal openTab seed. */
export interface BetterSidebarOpenTabSeed {
  type: string
  title?: string
  path?: string
  id?: string
  url?: string
  meta?: unknown
}

/** The subset of the better-sidebar service this plugin consumes. */
export interface BetterSidebarService {
  registerTab(descriptor: BetterSidebarTabDescriptor): () => void
  openTab(seed: BetterSidebarOpenTabSeed, scope?: BetterSidebarScope): void
  openFile(scope: BetterSidebarScope, path: string, title?: string): void
  closeTab(tabId: string, scope?: BetterSidebarScope): void
  getSnapshot(): unknown
  subscribeState(listener: () => void): () => void
  readonly version: string
  readonly features: readonly string[]
}

/** Client context with the optional better-sidebar service. */
export type ClientContextWithSidebar = ClientContext & { betterSidebar?: BetterSidebarService }

/**
 * Safe read of the optional better-sidebar service.
 *
 * The context proxy throws on unprovided properties (`cannot get property
 * "betterSidebar" without inject`), so a plain `ctx.betterSidebar` read
 * breaks the optional-dependency contract — and the retry loop in
 * `registerCaseFolderTab` — whenever better-sidebar hasn't provided its
 * service yet. Reading through a try/catch keeps the service optional:
 * absent → `undefined` → callers fall back / retry.
 */
export function getBetterSidebar(ctx: ClientContextWithSidebar): BetterSidebarService | undefined {
  // Use `ctx.get` (the inject-free service read) so the integration stays
  // optional: `ctx.betterSidebar` would require declaring `betterSidebar` in
  // `inject`, which would make the plugin fail to boot in profiles without
  // dsh-better-sidebar. `ctx.get` returns undefined when the service is not
  // (yet) provided, and the retry loop in `registerCaseFolderTab` covers the
  // late-provider case.
  return ctx.get('betterSidebar')
}

/**
 * Register the case-folder tab with better-sidebar. Safe to call when the
 * service is absent: it retries briefly so the tab is available even when
 * better-sidebar loads after this plugin's client apply.
 */
export function registerCaseFolderTab(ctx: ClientContextWithSidebar): void {
  let registered = false
  let timer: number | undefined
  let timeout: number | undefined

  const tryRegister = (): boolean => {
    if (registered) return true
    try {
      const service = getBetterSidebar(ctx)
      if (!service) return false
      registered = true
      ctx.effect(() => service.registerTab({
        id: CASE_FOLDER_TAB_TYPE,
        title: () => '案件文件夹',
        icon: (size: number) => <CaseFolderOpenIcon size={size} />,
        order: 15,
        // Visible in the tab strip's + menu: a path-less tab renders the
        // folder picker (choose a bound case folder or type any path).
        dedupeKey: (tab) => tab.path,
        component: (props) => <CaseFolderTab {...props} />,
      }), 'agentlex-litigation: case-folder tab')
      if (timer !== undefined) window.clearInterval(timer)
      if (timeout !== undefined) window.clearTimeout(timeout)
      return true
    } catch (error) {
      // Optional integration must never break plugin apply/boot. If the
      // service is present but registration still throws (e.g. effect on an
      // inactive fiber, or a not-yet-ready service), fall back to retrying
      // instead of letting the exception escape into the loader entry.
      console.warn('[agentlex-litigation] better-sidebar registration failed:', error)
      registered = false
      return false
    }
  }

  if (tryRegister()) return
  timer = window.setInterval(tryRegister, 200)
  timeout = window.setTimeout(() => {
    if (timer !== undefined) window.clearInterval(timer)
  }, 10000)
  ctx.effect(() => () => {
    if (timer !== undefined) window.clearInterval(timer)
    if (timeout !== undefined) window.clearTimeout(timeout)
  }, 'agentlex-litigation: case-folder tab retry')
}

/**
 * Open a case folder in the better-sidebar as a dedicated folder tab.
 * When `sessionId` is given the tab is opened in that session's sidebar;
 * otherwise it lands in the currently active session. Each open gets a
 * unique tab id so several case folders can sit side by side; the
 * descriptor's path-based dedupe still focuses an already-open tab of the
 * same folder instead of duplicating it.
 */
export function openCaseFolderInSidebar(
  ctx: ClientContextWithSidebar,
  folder: string,
  title?: string,
  sessionId?: string,
): void {
  const service = getBetterSidebar(ctx)
  const cleaned = folder.replace(/[\\/]+$/, '')
  const name = cleaned.split(/[\\/]/).pop() || cleaned
  if (service) {
    service.openTab(
      {
        type: CASE_FOLDER_TAB_TYPE,
        id: `${CASE_FOLDER_TAB_TYPE}:${uid()}`,
        title: title ? `${title} · 卷宗` : name,
        path: folder,
      },
      sessionId ? { sessionId } : undefined,
    )
    return
  }
  // Fallback（better-sidebar 未装配 / 已淘汰）：路由到
  // dsh-legal-suite/workspace-sidebar 原生右侧面板——先打开面板，
  // 再派发 reveal 请求让其在树内定位案件文件夹根。
  window.dispatchEvent(new CustomEvent('agentlex-workspace:panel-open', { detail: {} }))
  window.dispatchEvent(
    new CustomEvent('agentlex-workspace:reveal-request', { detail: { path: folder } }),
  )
}
