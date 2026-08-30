/**
 * Current-session scope reader for the workspace sidebar.
 *
 * Harness contract drift: rc.8 exposed the current-session projection as a
 * dedicated feed `ctx.sessions.currentProvideInfo` (`sessionId` + provided
 * bundle info). The current harness (>= v0.1.2-alpha.1) folds the live
 * selection into the standard list feed instead — `ctx.sessions.list`
 * carries `current` (the staged session id) and `byId[id].cwd`. There is no
 * public `selection`/`currentProvideInfo` property on `ISessions` anymore.
 *
 * Read only `list` and stay defensive (optional chaining + structural cast)
 * so the plugin loads on either contract without throwing at mount time.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

/** Current session id + working directory resolved from the sessions feed. */
export interface SessionScope {
  sessionId: string
  cwd: string
}

/** Minimal structural view of `SessionListState` we depend on. */
interface SessionsListSnapshot {
  current?: string
  byId?: Record<string, { cwd?: string } | undefined>
}

/** Minimal structural view of the sessions service we depend on. */
type SessionsServiceLike = {
  list?: { getSnapshot: () => SessionsListSnapshot | undefined } | undefined
}

/**
 * Resolve the current session id + cwd, or `undefined` when no session is on
 * stage (e.g. the new-session / empty view). Never throws, even if the feed
 * shape differs from what this build was type-checked against.
 */
export function readSessionScope(ctx: ClientContext): SessionScope | undefined {
  const sessions = ctx.sessions as unknown as SessionsServiceLike
  const list = sessions.list?.getSnapshot()
  const sessionId = list?.current
  if (!sessionId) return undefined
  const row = list?.byId?.[sessionId]
  return { sessionId, cwd: row?.cwd ?? '' }
}
