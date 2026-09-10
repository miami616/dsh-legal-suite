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
  pushTime?: string
  titlePrefix?: string
  updatedAt?: string
}

/** Read the current push config. */
export function readPushConfig(): Promise<PushConfigView> {
  return call('config', {}, 'GET')
}

/** Write the push config. */
export function writePushConfig(config: Partial<PushConfigView>): Promise<PushConfigView> {
  return call('config', config)
}

/** Send a test Feishu card. */
export function sendPushTest(config: { titlePrefix?: string }): Promise<{ sent: boolean }> {
  return call('test', config)
}

/** Trigger a manual push run now (force=true 绕过台账推全部). */
export function runPushNow(force = true): Promise<{ due: number; pushed: number; attempted: boolean; error?: string }> {
  return call('run', { force })
}

/** 飞书凭据配置状态（不含 secret）。 */
export interface FeishuConfigView {
  configured: boolean
  appId?: string
  ownerOpenId?: string
}

/** 读取飞书凭据配置状态。 */
export function readFeishuConfig(): Promise<FeishuConfigView> {
  return call('feishu-config', {}, 'GET')
}

/** 保存飞书凭据（appId / appSecret / 接收人 openId）。 */
export function writeFeishuConfig(config: { appId: string; appSecret: string; ownerOpenId: string }): Promise<FeishuConfigView> {
  return call('feishu-config', config)
}
