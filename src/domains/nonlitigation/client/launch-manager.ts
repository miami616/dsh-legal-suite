/**
 * 非诉管家 launcher — opens a DSH session with the nonlitigation-manager agent
 * preset, in the non-litigation module workspace.
 */
import { createBusinessSession, openExistingSession, fetchArchivedSessionIds, type SessionBridgeContext } from '../../../shared/session-bridge'

/** Archived DSH session ids (hidden from grouping surfaces by 归档会话). */
export { fetchArchivedSessionIds }

/** The agent-preset id that mounts the nonlitigation-manager composition. */
export const NONLITIGATION_MANAGER_PRESET = 'nonlitigation-manager'

async function fetchNonLitigationDataDir(): Promise<string> {
  const response = await fetch('/api/agentlex-nonlitigation/data-dir', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: '{}',
  })
  if (!response.ok) throw new Error(`data-dir HTTP ${response.status}`)
  const envelope = await response.json() as { success?: boolean; data?: { dataDir?: string } }
  if (envelope.success !== true || !envelope.data?.dataDir) {
    throw new Error('nonlitigation data-dir unavailable')
  }
  return envelope.data.dataDir
}

export interface LaunchOptions {
  context?: string
  projectName?: string
  existingSessionId?: string
  onLaunched?: (sessionId: string) => void
}

export async function launchNonLitigationManager(
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
      console.warn('[agentlex-nonlitigation] launch retry', attempt + 1)
    }
    try {
      const workspacePath = await fetchNonLitigationDataDir()
      const sessionId = await createBusinessSession(ctx, {
        agentPreset: NONLITIGATION_MANAGER_PRESET,
        workspacePath,
        workspaceTitle: '非诉管家',
        title: options.projectName ? `项目: ${options.projectName}` : '非诉管家',
        context: options.context,
      })
      if (sessionId !== undefined) {
        options.onLaunched?.(sessionId)
        return sessionId
      }
      lastError = new Error('createBusinessSession returned no session id')
    } catch (error) {
      lastError = error
      console.warn('[agentlex-nonlitigation] launch attempt failed:', error)
    }
  }
  console.warn('[agentlex-nonlitigation] launch failed after retries:', lastError)
  return undefined
}
