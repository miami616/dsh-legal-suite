/**
 * Current-session scope reader for the workspace sidebar.
 *
 * Harness contract drift: rc.8 exposed the current-session projection as a
 * dedicated feed `ctx.sessions.currentProvideInfo` (`sessionId` + provided
 * bundle info). v0.1.2-alpha.1..v0.1.5 folded the live selection into the
 * standard list feed instead — `ctx.sessions.list` carried `current` (the
 * staged session id) and `byId[id].cwd`. **v0.1.6-alpha.2 removed `current`
 * again**: the selection moved to ui-workspace and the only public read of the
 * main-view session is `byId[id].retainedBy.mainView > 0`.
 *
 * All of that lives in one place now (shared/current-session.ts) so every
 * consumer upgrades together; this module keeps its original narrow shape
 * (only `list`, defensive, never throws at mount time).
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { readCurrentSessionScope } from '../../../shared/current-session.ts'

/** Current session id + working directory resolved from the sessions feed. */
export interface SessionScope {
  sessionId: string
  cwd: string
}

/**
 * Resolve the current session id + cwd, or `undefined` when no session is on
 * stage (e.g. the new-session / empty view). Never throws, even if the feed
 * shape differs from what this build was type-checked against.
 */
export function readSessionScope(ctx: ClientContext): SessionScope | undefined {
  return readCurrentSessionScope(ctx)
}
