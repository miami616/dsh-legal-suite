/**
 * Push core: read deadlines → filter to those whose reminder time has arrived
 * → format the FIXED template → send via dsh-im proactive delivery → record
 * the dedupe ledger.
 *
 * Design decisions (confirmed 2026-09-03):
 *  - Reminder timing is PRECISE per deadline: a deadline with a concrete time
 *    (e.g. 开庭 09:00) is reminded exactly 24h before (yesterday 09:00); a
 *    deadline with no concrete time is reminded 1 day ahead at 08:00 (a
 *    reasonable morning hour, not midnight — a 0:00 push would be ignored).
 *  - The push text uses a FIXED template (a code constant) — field-complete
 *    but compact, identical across channels and times, never varying with
 *    content.
 *  - Channel credentials live entirely in dsh-im; this module only holds
 *    {botId, targetId} and calls dshIm.send().
 *
 * The same core is used by the host half (in-process, via ctx.get('dshIm'))
 * and by the command-job script (standalone, via the HTTP delivery endpoint).
 */

import { computeDeadlines, type DeadlineItem } from '../litigation/deadlines.ts'
import { createCaseStore } from '../litigation/store/case-store.ts'
import { createTimelineStore } from '../litigation/store/timeline-store.ts'
import { ledgerKey, type PushConfig, type PushStore } from './store/push-config.ts'

/** 无具体时间的期限：提前 1 天，早上 8:00 提醒（避免 0 点被忽略）。 */
export const DEFAULT_REMIND_HOUR = 8
/** 提前量：24 小时（有具体时间的期限按此精确提醒）。 */
export const REMIND_LEAD_HOURS = 24

/** The dsh-im delivery service face (ctx.get('dshIm') or an HTTP client). */
export interface DshImService {
  send(botId: string, targetId: string, text: string, options?: { signal?: AbortSignal }): Promise<{ sent: boolean }>
  listTargets?(botId: string): Promise<{ botId: string; channel: string; targets: Array<{ targetId: string; name?: string }> }>
}

/**
 * Build an HTTP-backed dsh-im delivery client that POSTs to the dsh-im
 * delivery endpoint. This is the documented integration path for external
 * callers and avoids cordis service-scope issues (dsh-im provides `dshIm` on
 * its own ctx, which a nested plugin cannot always see).
 *
 * @param baseUrl - the dsh web base URL (e.g. http://127.0.0.1:3080).
 */
export function createHttpDshIm(baseUrl: string): DshImService {
  const deliveryUrl = `${baseUrl.replace(/\/+$/, '')}/api/dsh-im/delivery/messages`
  return {
    async send(botId, targetId, text, options) {
      const res = await fetch(deliveryUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ botId, targetId, text }),
        signal: options?.signal,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: { message?: string } }).error?.message ?? `dsh-im delivery failed (${res.status})`)
      }
      return { sent: true }
    },
  }
}

/** Human "remaining" label for a deadline row. */
export function remainingLabel(daysLeft: number): string {
  if (daysLeft === 0) return '今天'
  if (daysLeft === 1) return '明天'
  if (daysLeft < 0) return `已逾期 ${-daysLeft} 天`
  return `${daysLeft} 天后`
}

/** Emoji per deadline kind. */
export function kindEmoji(kind: DeadlineItem['kind']): string {
  switch (kind) {
    case 'hearing': return '⚖️'
    case 'deadline': return '⏰'
    case 'keydate': return '📌'
    case 'task': return '✅'
    default: return '📌'
  }
}

/** One deadline row's detail lines (case number / court / time / courtroom). */
function rowDetail(row: DeadlineItem): string[] {
  const lines: string[] = []
  if (row.caseNumber !== undefined && row.caseNumber !== '' && row.caseNumber !== '【尚未立案】') {
    lines.push(`案号：${row.caseNumber}`)
  }
  if (row.court !== undefined && row.court !== '' && row.court !== '【尚未分配】') {
    lines.push(`法院：${row.court}`)
  }
  // 时间（几点几分）
  if (row.time !== undefined && row.time !== '') {
    lines.push(`时间：${row.time}`)
  }
  // 法庭/审判庭（来自 timeline 事件 detail，通常含「某某法庭」）
  if (row.detail !== undefined && row.detail !== '') {
    lines.push(`地点：${row.detail}`)
  }
  return lines
}

/**
 * Build the FIXED push text from the fresh deadline rows.
 *
 * Template (a constant — never varies with content), designed to render well
 * in plain text (feishu / weixin) with emoji + line breaks + structured info:
 *
 *   {prefix}📌 期限提醒 · {N} 项待办
 *
 *   ⚖️ 开庭 · 明天
 *   案件：张三诉李四合同纠纷
 *   案号：(2026)鲁0102民初10195号
 *   法院：济南市历下区人民法院
 *   时间：14:45
 *   地点：速裁审判法庭第一庭
 *   日期：2026-09-04
 *
 *   ⏰ 举证期限 · 今天
 *   案件：王五诉赵六
 *   日期：2026-09-03
 */
export function formatPush(rows: DeadlineItem[], titlePrefix?: string): string {
  const prefix = titlePrefix !== undefined && titlePrefix.trim() !== '' ? `${titlePrefix.trim()} ` : ''
  const header = `${prefix}📌 重要日程提醒 · ${rows.length} 项待办`
  const blocks = rows.map((row) => {
    const title = `${kindEmoji(row.kind)} ${row.label} · ${remainingLabel(row.daysLeft)}`
    const lines = [`案件：${row.caseName}`, ...rowDetail(row), `日期：${row.date}`]
    return `${title}\n${lines.join('\n')}`
  })
  return `${header}\n\n${blocks.join('\n\n')}`
}

/** Result of one push run. */
export interface PushRunResult {
  /** Number of deadline rows whose reminder time has arrived (before dedupe). */
  due: number
  /** Number actually pushed (fresh, after dedupe). */
  pushed: number
  /** Whether a push was attempted. */
  attempted: boolean
  /** Error text when the send failed (undefined on success). */
  error?: string
}

/**
 * Compute a deadline's reminder time (ms epoch).
 *
 * - With a concrete time (e.g. "09:00"): reminder = deadline date+time − 24h
 *   (precise to the minute — 明天 09:00 开庭 → 今天 09:00 提醒).
 * - Without a concrete time: reminder = deadline date − 1 day at 08:00
 *   (a reasonable morning hour, not midnight).
 *
 * Returns undefined when the deadline date is unparseable.
 */
export function reminderTimeMs(item: DeadlineItem): number | undefined {
  const date = new Date(`${item.date}T00:00:00`)
  if (Number.isNaN(date.getTime())) return undefined
  let remind: Date
  if (item.time !== undefined && item.time !== '') {
    const m = /^(\d{1,2}):(\d{2})$/.exec(item.time.trim())
    if (m !== null) {
      remind = new Date(date.getTime())
      remind.setHours(Number(m[1]), Number(m[2]), 0, 0)
      remind = new Date(remind.getTime() - REMIND_LEAD_HOURS * 3600_000)
    } else {
      // 无法解析的时间 → 按无时间处理。
      remind = new Date(date.getTime() - 24 * 3600_000)
      remind.setHours(DEFAULT_REMIND_HOUR, 0, 0, 0)
    }
  } else {
    remind = new Date(date.getTime() - 24 * 3600_000)
    remind.setHours(DEFAULT_REMIND_HOUR, 0, 0, 0)
  }
  return remind.getTime()
}

/**
 * Run one deadline-push pass.
 *
 * @param dataDir - the litigation data directory (reads case-registry.json /
 *   case-timeline.json) — the push store lives under the same root.
 * @param cfg - the resolved push config.
 * @param store - the push store (config + ledger).
 * @param dshIm - the dsh-im delivery service.
 * @param now - current time (ms epoch); injectable for tests.
 * @returns the run result.
 */
export async function runDeadlinePush(
  dataDir: string,
  cfg: PushConfig,
  store: PushStore,
  dshIm: DshImService,
  now: number = Date.now(),
): Promise<PushRunResult> {
  if (!cfg.enabled) return { due: 0, pushed: 0, attempted: false }
  if (cfg.botId === '' || cfg.targetId === '') return { due: 0, pushed: 0, attempted: false }

  // 1. Read the deadline engine (all cases, exclude overdue history).
  const caseStore = createCaseStore(dataDir)
  const timelineStore = createTimelineStore(dataDir)
  const [registry, events] = await Promise.all([caseStore.readRegistry(), timelineStore.listEvents()])
  const items = computeDeadlines(registry, events)

  // 2. Filter to deadlines whose reminder time has arrived (and not overdue).
  const due = items.filter((item) => {
    if (item.daysLeft < 0) return false
    const remind = reminderTimeMs(item)
    return remind !== undefined && remind <= now
  })

  // 3. Dedupe against the ledger.
  const fresh = []
  for (const item of due) {
    const key = ledgerKey(item.caseId, item.date, item.label)
    if (!(await store.hasPushed(key))) fresh.push(item)
  }
  if (fresh.length === 0) return { due: due.length, pushed: 0, attempted: false }

  // 4. Format the fixed template.
  const text = formatPush(fresh, cfg.titlePrefix)

  // 5. Send via dsh-im proactive delivery.
  try {
    await dshIm.send(cfg.botId, cfg.targetId, text)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { due: due.length, pushed: 0, attempted: true, error: message }
  }

  // 6. Record the ledger (only on success — a failure retries next tick).
  await store.recordPushed(fresh.map((item) => ledgerKey(item.caseId, item.date, item.label)))
  return { due: due.length, pushed: fresh.length, attempted: true }
}
