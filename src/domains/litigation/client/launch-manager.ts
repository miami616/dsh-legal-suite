/**
 * 诉讼管家 launcher — opens a DSH session with the litigation-manager agent
 * preset, in the litigation module workspace.
 *
 * Uses the shared session bridge so the session is:
 *   - attached to the litigation data directory as a DSH workspace
 *   - created with the litigation-manager preset
 *   - renamed and optionally seeded with a first message
 *   - selected in the DSH UI (so the user lands in the conversation)
 */
import { createBusinessSession, openExistingSession, fetchArchivedSessionIds, type SessionBridgeContext } from '../../../shared/session-bridge'

/** The agent-preset id that mounts the litigation-manager composition. */
export const LITIGATION_MANAGER_PRESET = 'litigation-manager'

/** Archived DSH session ids (hidden from grouping surfaces by 归档会话). */
export { fetchArchivedSessionIds }

async function fetchLitigationDataDir(): Promise<string> {
  const response = await fetch('/api/agentlex-case/data-dir', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: '{}',
  })
  if (!response.ok) throw new Error(`data-dir HTTP ${response.status}`)
  const envelope = await response.json() as { success?: boolean; data?: { dataDir?: string } }
  if (envelope.success !== true || !envelope.data?.dataDir) {
    throw new Error('litigation data-dir unavailable')
  }
  return envelope.data.dataDir
}

export interface LaunchOptions {
  /** Optional first message to send the 诉讼管家 after the session starts. */
  context?: string
  /** When set, the session is titled `案件: <caseName>`. */
  caseName?: string
  /** When set, jump to this existing session instead of creating a new one. */
  existingSessionId?: string
  /** Called after the session is selected (e.g. close the plugin panel). */
  onLaunched?: (sessionId: string) => void
}

/**
 * Create a 诉讼管家 system session, select it, and optionally seed it.
 * @param ctx - plugin client context (connection + sessions services).
 * @param options - context prompt and post-launch callback.
 * @returns the new session id, or undefined when the environment lacks services.
 */
export async function launchLitigationManager(
  ctx: SessionBridgeContext,
  options: LaunchOptions = {},
): Promise<string | undefined> {
  if (options.existingSessionId !== undefined) {
    openExistingSession(ctx, options.existingSessionId)
    options.onLaunched?.(options.existingSessionId)
    return options.existingSessionId
  }
  // 首次点击常发生在 harness 刚启动、workspace/会话服务尚未就绪时——此时
  // createBusinessSession 会创建出「无工作区、无预设」的默认会话（第二次点击
  // 才正确）。失败自动重试（最多 3 次、间隔 500ms）把首次点击也收敛到正确结果。
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, 500))
      console.warn('[agentlex-litigation] launch retry', attempt + 1)
    }
    try {
      const workspacePath = await fetchLitigationDataDir()
      const sessionId = await createBusinessSession(ctx, {
        agentPreset: LITIGATION_MANAGER_PRESET,
        workspacePath,
        workspaceTitle: '诉讼管家',
        title: options.caseName ? `案件: ${options.caseName}` : '诉讼管家',
        context: options.context,
      })
      if (sessionId !== undefined) {
        options.onLaunched?.(sessionId)
        return sessionId
      }
    } catch (error) {
      lastError = error
      console.warn('[agentlex-litigation] launch attempt failed:', error)
    }
  }
  console.warn('[agentlex-litigation] launch failed after retries:', lastError)
  return undefined
}
