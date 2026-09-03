/**
 * Browser-half API client for /api/agentlex-push/*.
 *
 * Same-origin POST with a JSON body; the host responds with the envelope
 * { success, data|error, hint? }. Errors surface as thrown Error.
 */

/** Envelope as the host sends it. */
interface Envelope<T> {
  success: boolean
  data?: T
  error?: string
  hint?: string
}

/** POST a JSON body to an agentlex-push route and unwrap the envelope. */
async function call<T>(path: string, body: Record<string, unknown> = {}, method = 'POST'): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api/agentlex-push/${path}`, {
      method,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(body),
    })
  } catch (error) {
    throw new Error(`host unreachable: ${error instanceof Error ? error.message : String(error)}`)
  }
  let envelope: Envelope<T>
  try {
    envelope = await response.json() as Envelope<T>
  } catch {
    throw new Error(`host returned non-JSON (${response.status})`)
  }
  if (!envelope.success) {
    const err = new Error(envelope.error ?? `request failed (${response.status})`)
    ;(err as Error & { hint?: string }).hint = envelope.hint
    throw err
  }
  return envelope.data as T
}

/** The push config shape (mirrors the host store). */
export interface PushConfigView {
  enabled: boolean
  botId: string
  targetId: string
  channel?: string
  titlePrefix?: string
  testOnSave?: boolean
  updatedAt?: string
}

/** A dsh-im delivery target (for the dropdown). */
export interface DeliveryTarget {
  targetId: string
  name?: string
}

/** Read the current push config. */
export function readPushConfig(): Promise<PushConfigView> {
  return call('config', {}, 'GET')
}

/** Write the push config. */
export function writePushConfig(config: Partial<PushConfigView>): Promise<PushConfigView> {
  return call('config', config)
}

/** Enumerate the dsh-im delivery targets for a bot. */
export function listPushTargets(botId: string): Promise<{ available: boolean; targets: DeliveryTarget[]; error?: string }> {
  return call('targets', { botId })
}

/** Send a test message to a target. */
export function sendPushTest(config: { botId: string; targetId: string; titlePrefix?: string }): Promise<{ sent: boolean }> {
  return call('test', config)
}

/** Trigger a manual push run now. */
export function runPushNow(): Promise<{ due: number; pushed: number; attempted: boolean; error?: string }> {
  return call('run', {})
}
