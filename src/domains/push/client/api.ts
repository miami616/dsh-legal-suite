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
  /** 智能分级提醒（按期限性质使用 T-30/T-15/T-7/T-3/T-2/T-1/D0 阶梯）。 */
  smartLead?: boolean
  /** 开庭/会议前精确提醒。 */
  preciseReminder?: boolean
  /** 卡片显示逾期后果。 */
  includeConsequence?: boolean
  /** 单卡最多展示条数。 */
  maxDigestRows?: number
  /** 提醒密度：concise（每日近 7 天+当天，积压只给数量）/ standard。 */
  density?: 'concise' | 'standard'
  /** 图片版提醒（渲染失败自动回退文字卡）。 */
  imageMode?: boolean
  /** 提醒频率：low（默认，低频）/ normal（标准）。 */
  frequency?: 'low' | 'normal'
  /** 周一「本周重点工作」（默认开；随早报时间发，替代当天日报，不重复）。 */
  weeklyPlanEnabled?: boolean
  /** 周五「本周总结与下周重点」（默认开）。 */
  weeklyReviewEnabled?: boolean
  /** 周五周报时间（HH:mm，默认 16:30）。 */
  weeklyReviewTime?: string
  updatedAt?: string
}

/** 推送运行状态（设置页展示失败/成功与下次时间）。 */
export interface PushStatusView {
  config: PushConfigView
  state: {
    lastDigestDate?: string
    lastAttemptAt?: string
    lastSuccessAt?: string
    lastError?: string
    consecutiveFailures: number
    lastIncrementalAt?: string
    lastPushedCount?: number
    lastKind?: string
    lastWeeklyPlanWeek?: string
    lastWeeklyReviewWeek?: string
  }
  feishuConfigured: boolean
  nextDigestAt: string
  /** 周报档期（设置页展示）。 */
  weekly?: {
    planEnabled: boolean
    reviewEnabled: boolean
    nextPlanAt: string
    nextReviewAt: string
  }
  due: number
  suppressed?: { overdue: number; ahead: number; oldestOverdueAge?: number }
  /** 今天是否工作日（周末/法定节假日每日摘要不发）。 */
  workday?: boolean
  serverTime: string
}

/** 今日提醒计划预览。 */
export interface PushPreviewView {
  total: number
  nextDigestAt: string
  suppressed?: { overdue: number; ahead: number; oldestOverdueAge?: number }
  bySection: Array<{ section: string; title: string; count: number }>
  items: Array<{
    label: string
    caseName: string
    date: string
    time?: string
    phaseLabel: string
    severity: 'critical' | 'high' | 'normal' | 'low'
    cls: string
    section: string
    consequence?: string
  }>
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

/** Trigger a manual push run now (force=true 绕过台账推全部；mode 可指定周报). */
export function runPushNow(
  force = true,
  mode?: 'manual' | 'digest' | 'intraday' | 'weekly-plan' | 'weekly-review',
): Promise<{ due: number; pushed: number; attempted: boolean; error?: string; kind?: string }> {
  return call('run', { force, ...(mode === undefined ? {} : { mode }) })
}

/** 读取提醒健康状态（上次成功/失败、下次摘要时间、今日计划条数）。 */
export function readPushStatus(): Promise<PushStatusView> {
  return call('status', {}, 'GET')
}

/** 预览今日提醒计划（不发消息、不写台账）。 */
export function previewPush(): Promise<PushPreviewView> {
  return call('preview', {})
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
