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
import { createTaskStore } from '../task/store/task-store.ts'
import { createItemStore } from '../item/store/item-store.ts'
import { sendFeishuCard } from './feishu-card.ts'
import { ledgerKey, type PushConfig, type PushStore } from './store/push-config.ts'
import { join } from 'node:path'

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

/** One deadline row's meta lines (case number / court / courtroom), each on its own line. */
function rowMetaLines(row: DeadlineItem): string[] {
  const lines: string[] = []
  if (row.caseNumber !== undefined && row.caseNumber !== '' && row.caseNumber !== '【尚未立案】') {
    lines.push(`案号：${row.caseNumber}`)
  }
  if (row.court !== undefined && row.court !== '' && row.court !== '【尚未分配】') {
    lines.push(`法院：${row.court}`)
  }
  if (row.detail !== undefined && row.detail !== '') {
    lines.push(`法庭：${row.detail}`)
  }
  return lines
}

/**
 * Build the FIXED push text from the fresh deadline rows.
 *
 * Template (a constant — never varies with content), designed to render well
 * in plain text (feishu / weixin) with a clean, scannable hierarchy:
 *
 *   {prefix}📌 重要日程提醒
 *
 *   ⚖️ 开庭 · 明天 09:00
 *   甲方与乙方买卖合同纠纷
 *   （2026）X民初XXXX号 · XX市XX区人民法院 · 第X法庭
 *
 *   ✅ 案件沟通会 · 明天 16:30
 *   某顾问单位
 *
 * Each block: a title line (emoji + 事项 + 剩余 + 时间), then the case name,
 * then an optional meta line (案号 · 法院 · 法庭) joined with ·.
 */
export function formatPush(rows: DeadlineItem[], titlePrefix?: string): string {
  const prefix = titlePrefix !== undefined && titlePrefix.trim() !== '' ? `${titlePrefix.trim()} ` : ''
  const header = `${prefix}重要日程提醒`
  const blocks = rows.map((row) => {
    const time = row.time !== undefined && row.time !== '' ? ` ${row.time}` : ''
    const title = `${row.label} · ${remainingLabel(row.daysLeft)}${time}`
    // 独立任务 caseName === label 时不重复显示案件名。
    const lines = row.caseName === row.label ? [] : [row.caseName]
    lines.push(...rowMetaLines(row))
    return `${title}\n${lines.join('\n')}`
  })
  return `${header}\n\n${blocks.join('\n\n')}`
}

/**
 * Build the FIXED push text as Feishu-card markdown (for the feishu channel).
 * Each deadline becomes a `## ` section (bold heading + large text), so the
 * Feishu card renders clean sectioned blocks with hr separators.
 */
export function formatPushMarkdown(rows: DeadlineItem[], titlePrefix?: string): string {
  const prefix = titlePrefix !== undefined && titlePrefix.trim() !== '' ? `${titlePrefix.trim()} ` : ''
  const header = `${prefix}重要日程提醒`
  const sections = rows.map((row) => {
    const time = row.time !== undefined && row.time !== '' ? ` ${row.time}` : ''
    const title = `${row.label} · ${remainingLabel(row.daysLeft)}${time}`
    // 独立任务 caseName === label 时不重复显示案件名。
    const lines = row.caseName === row.label ? [] : [row.caseName]
    lines.push(...rowMetaLines(row))
    return `## ${title}\n${lines.join('\n')}`
  })
  return `# ${header}\n\n${sections.join('\n\n')}`
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

/** 从日期字符串提取日期部分（YYYY-MM-DD）。 */
function datePart(value: string): string {
  return value.slice(0, 10)
}

/** 从日期字符串提取时间部分（HH:MM），无则 undefined。 */
function timePart(value: string): string | undefined {
  const m = /T(\d{1,2}:\d{2})/.exec(value)
  return m !== null ? m[1] : undefined
}

/**
 * 从自然语言 detail 提取具体时间（HH:MM），无则 undefined。
 *
 * 独立任务/非诉任务的 deadline 只存纯日期（界面 type="date"），具体时间点
 * 写在 detail 字段（如「9月4日下午3点10分开会」）。本函数解析常见中文/数字
 * 时间格式，使非诉/独立任务与诉讼（timeline 的 time 字段）统一按具体时间
 * 提前 24 小时提醒。
 *
 * 支持格式：
 *  - HH:MM / H:MM（如 09:00、14:45）
 *  - 下午X点Y分 / 上午X点Y分 / X点Y分 / X点 / X时
 *  - 下午X:Y / X:Y
 */
export function extractTimeFromDetail(detail: string | undefined): string | undefined {
  if (detail === undefined || detail === '') return undefined
  const text = detail.trim()

  // 1. HH:MM / H:MM（24 小时制）
  const colon = /(?:^|[^0-9])(\d{1,2}):(\d{2})(?:[^0-9]|$)/.exec(text)
  if (colon !== null) {
    const h = Number(colon[1])
    const min = Number(colon[2])
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
    }
  }

  // 2. 中文时间：下午/上午 X点Y分 / X点Y分 / X点 / X时 / X点半
  const cn = /(?:下午|晚上|上午|早上|凌晨)?(\d{1,2})\s*[点时]\s*((?:\d{1,2}\s*分?)|半)?/.exec(text)
  if (cn !== null) {
    let h = Number(cn[1])
    let min = 0
    if (cn[2] !== undefined && cn[2] !== '') {
      if (cn[2] === '半') min = 30
      else {
        const minNum = Number(cn[2].replace(/分/g, '').trim())
        if (!Number.isNaN(minNum)) min = minNum
      }
    }
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      // 下午/晚上/凌晨 12 小时制 → 24 小时制
      if (/下午|晚上/.test(text) && h < 12) h += 12
      if (/凌晨/.test(text) && h === 12) h = 0
      return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
    }
  }

  return undefined
}

/** 计算 daysLeft（相对今天）。 */
function daysLeftOf(date: string): number {
  const today = new Date().toISOString().slice(0, 10)
  return Math.round((new Date(`${date}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86_400_000)
}

/** 构造一个 DeadlineItem（统一字段）。 */
function makeItem(partial: {
  caseId: string
  caseName: string
  date: string
  label: string
  kind: DeadlineItem['kind']
  source: string
  time?: string
  detail?: string
  caseNumber?: string
  court?: string
}): DeadlineItem {
  const daysLeft = daysLeftOf(partial.date)
  return {
    caseId: partial.caseId,
    caseName: partial.caseName,
    caseNumber: partial.caseNumber,
    court: partial.court,
    time: partial.time,
    detail: partial.detail,
    date: partial.date,
    label: partial.label,
    kind: partial.kind,
    daysLeft,
    urgent: daysLeft >= 0 && daysLeft <= 1,
    overdue: daysLeft < 0,
    source: partial.source,
  }
}

/**
 * 聚合所有数据源的期限：诉讼（case-registry + case-timeline）、非诉
 * （project-registry）、独立任务（standalone-tasks）。统一成 DeadlineItem[]。
 *
 * @param litigationDir - 诉讼数据目录。
 * @param nonlitigationDir - 非诉数据目录。
 * @param tasksDir - 任务数据目录。
 */
export async function collectAllDeadlines(
  litigationDir: string,
  nonlitigationDir: string,
  tasksDir: string,
): Promise<DeadlineItem[]> {
  const items: DeadlineItem[] = []

  // 统一事项：从 items.json 读所有事项（event/task/both），自动分流。
  // 一个事项一次登记，type 决定它进日程/时间轴还是任务树。
  // 补充 owner 元信息（案号/法院）来自 case/project registry——push 文本需要。
  const ownerMeta = new Map<string, { caseNumber?: string; court?: string }>()
  try {
    const caseStore = createCaseStore(litigationDir)
    const reg = await caseStore.readRegistry()
    for (const c of Object.values(reg.cases)) {
      ownerMeta.set(c.caseId, { caseNumber: c.caseNumber, court: c.court })
    }
  } catch { /* best-effort */ }

  try {
    const itemStore = createItemStore(join(litigationDir, '..', 'items'))
    const all = await itemStore.listItems()
    for (const it of all) {
      if (it.status === 'done' || it.status === 'cancelled' || !it.date) continue
      const ownerId = it.ownerId ?? ''
      const ownerName = it.ownerName ?? ''
      // ownerType 区分同号案件/项目/独立（2026-09-04）；缺省按历史（案件/独立）。
      const ownerType = it.ownerType ?? (ownerId === '' ? 'standalone' : 'litigation')
      const meta = ownerId === '' ? undefined : ownerMeta.get(ownerId)
      const isEvent = it.type === 'event' || it.type === 'both'
      const isTask = it.type === 'task' || it.type === 'both'
      const source = ownerType === 'standalone' ? 'standalone' : ownerType === 'nonlitigation' ? 'nonlitigation' : 'litigation'
      // 事件 → 关键日程/时间轴（kind 按类型）。
      if (isEvent) {
        items.push(makeItem({
          caseId: ownerId,
          caseName: ownerName,
          date: datePart(it.date),
          label: it.title,
          kind: it.type === 'both' ? 'hearing' : 'keydate',
          source,
          time: timePart(it.date) ?? it.time,
          detail: it.detail,
          caseNumber: meta?.caseNumber,
          court: meta?.court,
        }))
      }
      // 任务 → 任务 deadline。both 事项只作为事件进一次（同一 deadline 不重复）。
      if (isTask && it.type !== 'both') {
        items.push(makeItem({
          caseId: ownerId,
          caseName: ownerName,
          date: datePart(it.date),
          label: it.title,
          kind: 'task',
          source,
          time: timePart(it.date) ?? it.time ?? extractTimeFromDetail(it.detail),
          detail: it.detail,
          caseNumber: meta?.caseNumber,
          court: meta?.court,
        }))
      }
    }
  } catch (error) {
    console.warn('[agentlex-push] 统一事项期限读取失败:', error instanceof Error ? error.message : String(error))
  }

  return items
}

/**
 * Run one deadline-push pass.
 *
 * @param dirs - the data directories for all sources.
 * @param cfg - the resolved push config.
 * @param store - the push store (config + ledger).
 * @param dshIm - the dsh-im delivery service.
 * @param now - current time (ms epoch); injectable for tests.
 * @returns the run result.
 */
export async function runDeadlinePush(
  dirs: { litigation: string; nonlitigation: string; tasks: string },
  cfg: PushConfig,
  store: PushStore,
  dshIm: DshImService,
  now: number = Date.now(),
): Promise<PushRunResult> {
  if (!cfg.enabled) return { due: 0, pushed: 0, attempted: false }
  if (cfg.botId === '' || cfg.targetId === '') return { due: 0, pushed: 0, attempted: false }

  // 1. Aggregate deadlines from all data sources (litigation + nonlitigation + standalone tasks).
  const items = await collectAllDeadlines(dirs.litigation, dirs.nonlitigation, dirs.tasks)

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

  // 4. Format the fixed template (feishu → card markdown; others → plain text).
  // 渠道实时解析：配置可能没存 channel（旧版保存时 dsh-im listTargets 不可用），
  // 推送前用 botId 现查投递目标渠道——避免「配了飞书却发普通文字」。
  let channel = cfg.channel
  if (channel === undefined && dshIm.listTargets !== undefined) {
    try {
      const result = await dshIm.listTargets(cfg.botId)
      if (result?.channel !== undefined && result.channel !== '') channel = result.channel
    } catch { /* 查询失败则保持 undefined → 走普通文字 */ }
  }
  const isFeishu = channel === 'feishu'
  const text = isFeishu ? formatPushMarkdown(fresh, cfg.titlePrefix) : formatPush(fresh, cfg.titlePrefix)

  // 5. Send: feishu renders a structured card; others use dsh-im plain text.
  try {
    if (isFeishu) {
      await sendFeishuCard(text)
    } else {
      await dshIm.send(cfg.botId, cfg.targetId, text)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { due: due.length, pushed: 0, attempted: true, error: message }
  }

  // 6. Record the ledger (only on success — a failure retries next tick).
  await store.recordPushed(fresh.map((item) => ledgerKey(item.caseId, item.date, item.label)))
  return { due: due.length, pushed: fresh.length, attempted: true }
}
