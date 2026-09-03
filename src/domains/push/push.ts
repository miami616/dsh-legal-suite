/**
 * Push core: read deadlines → filter to the reminder window (1 day + today)
 * → format the FIXED template → send via dsh-im proactive delivery → record
 * the dedupe ledger.
 *
 * Design decisions (confirmed 2026-09-03):
 *  - Reminder window is FIXED to daysLeft ∈ {0, 1} (today / tomorrow). Far
 *    ahead reminders are covered by the daily/weekly reports, so this module
 *    only does "imminent" precision reminders.
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

/** Reminder window: daysLeft ∈ {0, 1} (today / tomorrow). */
export const WINDOW_DAYS = [0, 1] as const

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
  /** Number of deadline rows in the window (before dedupe). */
  due: number
  /** Number actually pushed (fresh, after dedupe). */
  pushed: number
  /** Whether a push was attempted. */
  attempted: boolean
  /** Error text when the send failed (undefined on success). */
  error?: string
}

/**
 * Run one deadline-push pass.
 *
 * @param dataDir - the litigation data directory (reads case-registry.json /
 *   case-timeline.json) — the push store lives under the same root.
 * @param cfg - the resolved push config.
 * @param store - the push store (config + ledger).
 * @param dshIm - the dsh-im delivery service.
 * @returns the run result.
 */
export async function runDeadlinePush(
  dataDir: string,
  cfg: PushConfig,
  store: PushStore,
  dshIm: DshImService,
): Promise<PushRunResult> {
  if (!cfg.enabled) return { due: 0, pushed: 0, attempted: false }
  if (cfg.botId === '' || cfg.targetId === '') return { due: 0, pushed: 0, attempted: false }

  // 1. Read the deadline engine (all cases, exclude overdue history).
  const caseStore = createCaseStore(dataDir)
  const timelineStore = createTimelineStore(dataDir)
  const [registry, events] = await Promise.all([caseStore.readRegistry(), timelineStore.listEvents()])
  const items = computeDeadlines(registry, events)

  // 2. Filter to the reminder window (today / tomorrow).
  const due = items.filter((item) => (WINDOW_DAYS as readonly number[]).includes(item.daysLeft))

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
