/**
 * Push core: read deadlines → filter to today/tomorrow → format the FIXED
 * template → send as a Feishu card → record the dedupe ledger.
 *
 * Design decisions (confirmed 2026-09-10):
 *  - Reminder timing is a DAILY 8:30 run: every morning the run pushes the
 *    deadlines due TODAY (daysLeft === 0) and TOMORROW (daysLeft === 1) as
 *    one Feishu card. No per-deadline 24h-precise reminders anymore.
 *  - Delivery is FIXED to the Feishu card channel (direct Feishu open API,
 *    same credentials as feishu_push.py). No dsh-im dependency, no channel
 *    detection — the card path is the only path.
 *  - The push text uses a FIXED template (a code constant) — field-complete
 *    but compact, identical across runs, never varying with content.
 *  - Dedupe is per-day: a deadline pushed in today's run is skipped by a
 *    second run the same day; tomorrow's run re-pushes the fresh window.
 *
 * The same core is used by the host half (in-process, from the built-in
 * 8:30 timer or a manual /run trigger).
 */

import { computeDeadlinesV2, eventKind, type DeadlineItem, type OwnerMeta } from '../litigation/deadlines.ts'
import { createCaseStore } from '../litigation/store/case-store.ts'
import { JsonFileStore } from '../litigation/store/file-store.ts'
import { createItemStore } from '../item/store/item-store.ts'
import { isEventItem, isTaskItem } from '../item/store/types.ts'
import { runPatrol, groupItemsByCase, type PatrolFinding } from '../litigation/patrol.ts'
import { createPatrolLedgerStore } from '../litigation/store/patrol-ledger-store.ts'
import { createPeriodRuleStore } from '../litigation/store/period-rule-store.ts'
import { sendPatrolCard } from './feishu-card.ts'
import type { CaseRegistry, TimelineEvent } from '../litigation/store/types.ts'
import { sendDeadlineCard } from './feishu-card.ts'
import { ledgerKey, type PushConfig, type PushStore } from './store/push-config.ts'
import { join } from 'node:path'

/** 提醒窗口：今天（daysLeft === 0）与明天（daysLeft === 1）。 */
export const WINDOW_DAYS = [0, 1]

/**
 * 推送窗口选择（0.2.11）：今天/明天到期的事项，**外加逾期未完成的任务**。
 *
 * 逾期只属于任务——日程过期即历史（vendor taskAggregation 的既有约定：
 * events never go overdue），所以这里是 `kind === 'task' && daysLeft < 0`，
 * 而不是对一切 kind 放宽。
 */
export function selectPushRows(items: DeadlineItem[]): DeadlineItem[] {
  return items.filter((item) => WINDOW_DAYS.includes(item.daysLeft) || (item.kind === 'task' && item.daysLeft < 0))
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
 * Build the FIXED push text as Feishu-card markdown (the ONLY delivery path).
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
  /** Number of deadline rows in the window (today/tomorrow, before dedupe). */
  due: number
  /** Number actually pushed (fresh, after dedupe). */
  pushed: number
  /** Whether a push was attempted. */
  attempted: boolean
  /** Error text when the send failed (undefined on success). */
  error?: string
  /** 案件账实核对（0.2.12）：独立消息、独立台账，与每日到期提醒无关。 */
  patrol?: { total: number; pushed: number; summary: string }
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
 * 时间格式，使非诉/独立任务与诉讼（timeline 的 time 字段）统一带具体时间。
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
 * 聚合所有数据源的期限（0.2.12 统一出口版）。
 *
 * **不再自建一份聚合**：以前这里按 items 自己拼一份 DeadlineItem[]，与
 * `deadlines.ts` 的引擎各算各的——同一期限在两处去重/优先级口径不同，就会出现
 * 「期限汇总一行、飞书推送两行」这类分叉。现在统一调 `computeDeadlinesV2`：
 *   - 事件（items event/both）+ 任务期限（items task/both）+ 关键日期（registry 装配）
 *     由引擎按 `caseId|date|label` 去重、按 kind 优先级择一；
 *   - 非诉项目与独立事项通过 `ownerMeta` 补名称/来源，因此不必再为它们单独开分支。
 *
 * @param litigationDir - 诉讼数据目录。
 * @param nonlitigationDir - 非诉数据目录。
 * @param tasksDir - 任务数据目录（独立任务已并入 items，仅作兼容签名）。
 */
export async function collectAllDeadlines(
  litigationDir: string,
  nonlitigationDir: string,
  _tasksDir: string,
): Promise<DeadlineItem[]> {
  const itemsDir = join(litigationDir, '..', 'items')

  // 归属元信息：案件（名称/案号/法院）+ 非诉项目（名称）+ 独立（ownerId=''）。
  const ownerMeta = new Map<string, OwnerMeta>()
  let registry: CaseRegistry = { registryVersion: '1.0', cases: {} }
  try {
    const caseStore = createCaseStore(litigationDir, undefined, createItemStore(itemsDir))
    registry = await caseStore.readRegistry()
    for (const c of Object.values(registry.cases)) {
      ownerMeta.set(c.caseId, { name: c.name, caseNumber: c.caseNumber, court: c.court, source: 'litigation' })
    }
  } catch { /* best-effort：案件元信息缺失不阻塞推送 */ }
  try {
    const projectStore = new JsonFileStore<{ projects?: Record<string, { name?: string }> }>(
      join(nonlitigationDir, 'project-registry.json'),
      () => ({ projects: {} }),
    )
    const reg = await projectStore.read()
    for (const [pid, p] of Object.entries(reg.projects ?? {})) {
      const existing = ownerMeta.get(pid)
      ownerMeta.set(pid, { ...existing, name: p.name ?? existing?.name, source: 'nonlitigation' })
    }
  } catch { /* best-effort */ }
  ownerMeta.set('', { name: '独立', source: 'standalone' })

  try {
    const itemStore = createItemStore(itemsDir)
    const all = await itemStore.listItems()

    // 事件侧：items 的 event/both → TimelineEvent 形状（keydate 不进这里——它由
    // registry 装配的 keyDates 走 keydate 通道，否则同一期限会进两次）。
    const events: TimelineEvent[] = []
    const taskDeadlines = new Map<string, { caseId: string; title: string; date: string; time?: string; status: string }>()
    for (const it of all) {
      if (!it.date) continue
      const date = datePart(it.date)
      if (isEventItem(it)) {
        events.push({
          id: it.id,
          caseId: it.ownerId ?? '',
          caseName: it.ownerName ?? '',
          type: (it.kind ?? (it.type === 'both' ? 'hearing' : 'case_event')) as TimelineEvent['type'],
          title: it.title,
          detail: it.detail,
          date,
          time: timePart(it.date) ?? it.time ?? extractTimeFromDetail(it.detail),
          status: (it.status === 'done' ? 'done' : it.status === 'cancelled' ? 'cancelled' : 'pending') as TimelineEvent['status'],
          remindRules: (it.remindRules ?? []) as TimelineEvent['remindRules'],
          createdAt: it.createdAt,
          updatedAt: it.updatedAt,
        })
      } else if (isTaskItem(it)) {
        taskDeadlines.set(it.id, {
          caseId: it.ownerId ?? '',
          title: it.title,
          date,
          time: timePart(it.date) ?? it.time ?? extractTimeFromDetail(it.detail),
          status: it.status,
        })
      }
    }

    return computeDeadlinesV2(registry, events, taskDeadlines, undefined, { includeOverdue: true, ownerMeta })
  } catch (error) {
    console.warn('[agentlex-push] 统一事项期限读取失败:', error instanceof Error ? error.message : String(error))
    return []
  }
}

/**
 * Run one deadline-push pass.
 *
 * @param dirs - the data directories for all sources.
 * @param cfg - the resolved push config.
 * @param store - the push store (config + ledger).
 * @param opts - force: true 时绕过台账去重，推送窗口内全部（手动「立即执行」用）。
 * @param now - current time (ms epoch); injectable for tests.
 * @returns the run result.
 */
export async function runDeadlinePush(
  dirs: { litigation: string; nonlitigation: string; tasks: string },
  cfg: PushConfig,
  store: PushStore,
  opts: { force?: boolean } = {},
  now: number = Date.now(),
): Promise<PushRunResult> {
  if (!cfg.enabled) return { due: 0, pushed: 0, attempted: false }

  // 1. Aggregate deadlines from all data sources (litigation + nonlitigation + standalone tasks).
  const items = await collectAllDeadlines(dirs.litigation, dirs.nonlitigation, dirs.tasks)

  // 2. Filter to the daily window: today (daysLeft === 0) and tomorrow (daysLeft === 1).
  //
  // ⚠ 逾期任务不设上限（0.2.11 修）：任务到期未完成就是**逾期**（taskAggregation
  // 的 isTaskOverdue 语义），一个 09-24 到期未办的「递交起诉状」在 09-25 之后
  // 从提醒里消失，等于把最该催的事静默掉了。日程仍维持 [0,1]——日程过期即历史，
  // 不产生逾期，不重推。
  const due = selectPushRows(items)

  // 3. Dedupe against the ledger (per-day: only today's records count).
  //    force=true（手动触发）绕过台账，推送窗口内全部。
  const fresh = []
  for (const item of due) {
    const key = ledgerKey(item.caseId, item.date, item.label)
    if (opts.force === true || !(await store.hasPushed(key))) fresh.push(item)
  }
  // 3.5 案件账实核对（0.2.12）：**独立一条消息**，不与每日到期提醒混——两者性质不同
  //     （每日提醒回答"今天要干什么"，核对卡回答"你的账可能记错了"）。混在一起会让
  //     "今天没事"的日子看不出异常，也会让异常被日常事项淹没。
  //     台账保证只有**新出现或证据变化**才推，同一件事不会天天刷。
  const patrol = await runPatrolPass(dirs.litigation)

  if (fresh.length === 0) {
    return { due: due.length, pushed: 0, attempted: false, patrol }
  }

  // 4. Format the FIXED template as a structured Feishu card (the only delivery path).
  // 5. Send the Feishu card (direct Feishu open API — no dsh-im dependency).
  try {
    await sendDeadlineCard(fresh, cfg.titlePrefix)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { due: due.length, pushed: 0, attempted: true, error: message, patrol }
  }

  // 6. Record the ledger (only on success — a failure retries next run).
  if (fresh.length > 0) {
    await store.recordPushed(fresh.map((item) => ledgerKey(item.caseId, item.date, item.label)))
  }
  return { due: due.length, pushed: fresh.length, attempted: true, patrol }
}

/**
 * 案件账实核对（0.2.12）—— 独立一条消息 + 去重台账。
 *
 * 与每日到期提醒彻底分开：这里回答「你的账是不是记错了」，不是「今天要干什么」。
 * 台账（patrol-ledger.json）保证只有**新出现或证据变化**的发现才推；已确认无需处理
 * 的（mute_patrol_finding）不再提醒。
 */
async function runPatrolPass(litigationDir: string): Promise<{ total: number; pushed: number; summary: string }> {
  try {
    const itemsDir = join(litigationDir, '..', 'items')
    const itemStore = createItemStore(itemsDir)
    const caseStore = createCaseStore(litigationDir, undefined, itemStore)
    const ledger = createPatrolLedgerStore(litigationDir)
    const ruleStore = createPeriodRuleStore(litigationDir)
    const [registry, items, rules] = await Promise.all([
      caseStore.readRegistry(),
      itemStore.listItems(),
      ruleStore.effectiveRules(),
    ])
    const result = runPatrol(Object.values(registry.cases), groupItemsByCase(items), rules)

    // 已确认无需处理的先剔掉，再按台账挑「没推过的」。
    const active: PatrolFinding[] = []
    for (const f of result.findings) {
      if (await ledger.isMuted(f.caseId, f.ruleId)) continue
      active.push(f)
    }
    const valid = active.map((f) => f.fingerprint)
    const fresh = await ledger.filterNew(valid, valid)
    if (fresh.length === 0) {
      if (active.length > 0) console.warn(`[agentlex-patrol] ${result.summary}（均为已推送过的，不重复打扰）`)
      return { total: active.length, pushed: 0, summary: result.summary }
    }
    const freshFindings = active.filter((f) => fresh.includes(f.fingerprint))
    await sendPatrolCard(freshFindings)
    await ledger.markPushed(fresh)
    console.warn(`[agentlex-patrol] ${result.summary}；本次推送 ${freshFindings.length} 项新发现`)
    return { total: active.length, pushed: freshFindings.length, summary: result.summary }
  } catch (error) {
    console.warn('[agentlex-patrol] 账实核对失败:', error instanceof Error ? error.message : String(error))
    return { total: 0, pushed: 0, summary: '案件账实核对：执行失败' }
  }
}
