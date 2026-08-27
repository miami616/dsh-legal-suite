/**
 * Case-detail conversation view — a real "案件详情页" tab in the DSH
 * conversation tab bar (对话/轨迹), shown only for sessions bound to a
 * litigation case.
 *
 * The tab bar is the `conversation.view` slot (chat=0, trajectory=10). This
 * entry registers at order 20 with the fixed label 案件详情页, and the view
 * renders the SAME detail surface the plugin itself uses — the original
 * CaseManager detail (OriginalLitigationPanel) preselected on the bound case
 * — so the tab content is identical to clicking the case in the plugin's
 * board. The entry is registered dynamically: only while the current session
 * is bound to a case, so unbound sessions keep the plain 对话/轨迹 tab bar.
 */
import { useEffect, useState } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import type { ClientContextWithSidebar } from './better-sidebar.tsx'
import type { CaseRegistry } from '../store/types.ts'
import * as api from './api.ts'
import { OriginalLitigationPanel } from './OriginalLitigationPanel.tsx'

/** The conversation.view entry id of this tab. */
export const CASE_DETAIL_VIEW_ID = 'case-detail'
/** Tab order: after chat (0) and trajectory (10). */
const CASE_DETAIL_VIEW_ORDER = 20
/** Fixed tab title — product requirement: exactly 案件详情页, nothing else. */
export const CASE_DETAIL_VIEW_LABEL = '案件详情页'

/** Opens a 诉讼管家 system session (same shape as the panel's launcher). */
export type LaunchManager = (opts?: { context?: string; caseName?: string; existingSessionId?: string; onLaunched?: (sessionId: string) => void }) => Promise<string | undefined>

/** Open the bound case folder in the better-sidebar (optional integration). */
export type OpenCaseFolder = (folder: string, title?: string, sessionId?: string) => void

/** Normalize a boundSessions entry (string id or { sessionId } object). */
function sessionIdOf(bound: unknown): string | null {
  if (typeof bound === 'string') return bound
  if (bound !== null && typeof bound === 'object') {
    const value = (bound as { sessionId?: unknown }).sessionId
    return typeof value === 'string' ? value : null
  }
  return null
}

/** Find the first case whose boundSessions include the given session id. */
function findBoundCase(registry: CaseRegistry, sessionId: string): { caseId: string; caseName: string } | null {
  for (const record of Object.values(registry.cases)) {
    const bound = Array.isArray(record.boundSessions) ? record.boundSessions : []
    if (bound.some((entry) => sessionIdOf(entry) === sessionId)) {
      return { caseId: record.caseId, caseName: record.name }
    }
  }
  return null
}

/** Mount-layer services captured by mountCaseDetailView (set before render). */
const serviceRefs: {
  current: {
    launchManager: LaunchManager | undefined
    openCaseFolder: OpenCaseFolder | undefined
    getArchivedSessionIds: (() => Promise<Set<string>>) | undefined
  }
} = { current: { launchManager: undefined, openCaseFolder: undefined, getArchivedSessionIds: undefined } }

/**
 * The conversation view body: renders the plugin's own case detail for the
 * bound case, or nothing while the session is not bound to a case.
 */
export function CaseDetailView({ sessionId }: ConvViewProps): React.JSX.Element | null {
  const [bound, setBound] = useState<{ caseId: string; caseName: string } | null>(null)

  useEffect(() => {
    let alive = true
    const load = async (): Promise<void> => {
      try {
        const registry = await api.readRegistry()
        if (!alive) return
        setBound(findBoundCase(registry, sessionId))
      } catch {
        if (alive) setBound(null)
      }
    }
    void load()
    const onRegistryChanged = (): void => { void load() }
    window.addEventListener('agentlex:registry-changed', onRegistryChanged)
    return () => {
      alive = false
      window.removeEventListener('agentlex:registry-changed', onRegistryChanged)
    }
  }, [sessionId])

  // Hand the center column back to the conversation: the DOM-overlay panel
  // (mount.tsx) closes itself on any dsh-panel-activate from another owner.
  useEffect(() => {
    document.dispatchEvent(new CustomEvent('dsh-panel-activate', { detail: 'case-detail-view' }))
  }, [])

  if (bound === null) return null
  const services = serviceRefs.current
  return (
    <OriginalLitigationPanel
      launchManager={services.launchManager ?? (async () => undefined)}
      onClose={() => {}}
      openCaseFolder={services.openCaseFolder}
      getArchivedSessionIds={services.getArchivedSessionIds}
      initialSelectedCaseId={bound.caseId}
    />
  )
}

/**
 * Mount the case-detail conversation view: register the `conversation.view`
 * entry while the current session is bound to a litigation case, unregister
 * it otherwise.
 * @param ctx - plugin client context (sessions service for the current id).
 * @param launchManager - opens the 诉讼管家 system agent session.
 * @param openCaseFolder - opens a bound case folder in the better-sidebar.
 * @param getArchivedSessionIds - resolves the DSH workspace archive set.
 * @returns disposer removing the entry and all subscriptions.
 */
export function mountCaseDetailView(
  ctx: ClientContextWithSidebar,
  launchManager: LaunchManager,
  openCaseFolder?: OpenCaseFolder,
  getArchivedSessionIds?: () => Promise<Set<string>>,
): () => void {
  if (typeof document === 'undefined') return () => {}
  serviceRefs.current.launchManager = launchManager
  serviceRefs.current.openCaseFolder = openCaseFolder
  serviceRefs.current.getArchivedSessionIds = getArchivedSessionIds

  let disposeEntry: (() => void) | undefined
  let currentSessionId: string | undefined
  let disposed = false

  // The node-side dsh-session package merges `Context.sessions` as its own
  // SessionStore (list(): Session[]), shadowing the client runtime's ISessions
  // under skipLibCheck — cast to the client face the runtime actually serves.
  const sessions = ctx.sessions as unknown as ISessions | undefined

  const sync = async (): Promise<void> => {
    if (disposed) return
    const sessionId = sessions?.list.getSnapshot().current
    const requestedSession = sessionId
    currentSessionId = sessionId
    if (sessionId === undefined) {
      disposeEntry?.()
      disposeEntry = undefined
      return
    }
    try {
      const registry = await api.readRegistry()
      if (disposed || currentSessionId !== requestedSession) return
      const bound = findBoundCase(registry, sessionId)
      if (bound === null) {
        disposeEntry?.()
        disposeEntry = undefined
        return
      }
      if (disposeEntry === undefined) {
        disposeEntry = ctx.slots.register({
          name: 'conversation.view',
          id: CASE_DETAIL_VIEW_ID,
          order: CASE_DETAIL_VIEW_ORDER,
          label: CASE_DETAIL_VIEW_LABEL,
        }, CaseDetailView)
      }
    } catch {
      // Registry read failed — keep the current registration state.
    }
  }

  const unsubscribeSessions = sessions?.list.subscribe(() => { void sync() })
  const onRegistryChanged = (): void => { void sync() }
  window.addEventListener('agentlex:registry-changed', onRegistryChanged)
  window.addEventListener('agentlex:session-bound', onRegistryChanged)
  window.addEventListener('agentlex:session-deleted', onRegistryChanged)

  void sync()

  return () => {
    disposed = true
    unsubscribeSessions?.()
    window.removeEventListener('agentlex:registry-changed', onRegistryChanged)
    window.removeEventListener('agentlex:session-bound', onRegistryChanged)
    window.removeEventListener('agentlex:session-deleted', onRegistryChanged)
    disposeEntry?.()
    disposeEntry = undefined
    serviceRefs.current.launchManager = undefined
    serviceRefs.current.openCaseFolder = undefined
    serviceRefs.current.getArchivedSessionIds = undefined
  }
}
