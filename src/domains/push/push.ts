/**
 * Push core — 把「期限」变成「今天该提醒什么，并且只提醒一次」。
 *
 * v0.2.25 重构要点（对旧版固定窗口的改进）：
 *  1. **按期限性质分级**：法定不变期间/保全/开庭/举证缴费/普通任务各用一条提醒阶梯
 *     （T-90…T-1/D0），见 `reminder-plan.ts`。旧版只有「今天/明天」。
 *  2. **分档去重**：同一事项同一档只提醒一次（台账键含 `|T{n}`），跨天不重发；
 *     错过档位日（休眠/重启）在补发窗口内补一条，并标「（补）」。
 *  3. **精确到点**：开庭提前 2 小时/30 分钟、其他事项提前 30 分钟，单独一张
 *     「即将开始」卡；每 5 分钟巡检一次，休眠恢复后立即补发。
 *  4. **失败可见**：发送失败写入 push-state.json 并每 10 分钟重试；连续失败时弹
 *     macOS 本地通知兜底；下次成功卡上注明「上次推送失败」。
 *  5. **当日补充**：摘要卡之后新增了当天到期事项，15 分钟冷却后发「补充」卡。
 *
 * 数据：$DSH_HOME/agentlex/push/（push-config.json / push-ledger.json / push-state.json）。
 * 依赖：飞书凭据（$DSH_HOME/integrations/dsh-feishu/config.json + .credentials.yaml）。
 */

import { computeDeadlinesV2, eventKind, type DeadlineItem, type OwnerMeta } from '../litigation/deadlines.ts'
import { createCaseStore } from '../litigation/store/case-store.ts'
import { JsonFileStore } from '../litigation/store/file-store.ts'
import { createItemStore } from '../item/store/item-store.ts'
import { isEventItem, isTaskItem } from '../item/store/types.ts'
import { runPatrol, groupItemsByCase, type PatrolFinding } from '../litigation/patrol.ts'
import { createPatrolLedgerStore } from '../litigation/store/patrol-ledger-store.ts'
import { createPeriodRuleStore } from '../litigation/store/period-rule-store.ts'
import { sendPatrolCard, sendReminderCard, sendFeishuCard } from './feishu-card.ts'
import type { CaseRegistry, TimelineEvent } from '../litigation/store/types.ts'
import { ledgerKey, parsePushTime, type PushConfig, type PushStore, type PushRunState, type PushStateStore } from './store/push-config.ts'
import {
  buildPreview,
  formatIntradayMarkdown,
  intradayCandidates,
  localDate,
  applyDigestCaps,
  reminderCandidates,
  selectDigestEntries,
  type IntradayEntry,
  type ReminderEntry,
  type ReminderPlanOptions,
  type ReminderPreview,
  type SuppressedSummary,
} from './reminder-plan.ts'
import { notifyLocal } from './notify-local.ts'
import { join } from 'node:path'

/** 旧版提醒窗口：今天（0）与明天（1）。保留导出供兼容性校验使用。 */
export const WINDOW_DAYS = [0, 1]

/** 失败重试间隔：10 分钟。 */
const RETRY_INTERVAL_MS = 10 * 60_000
/** 当日补充提醒冷却：15 分钟。 */
const INCREMENTAL_INTERVAL_MS = 15 * 60_000
/** 本地兜底通知冷却：6 小时（避免飞书长期故障时反复弹通知）。 */
const FALLBACK_INTERVAL_MS = 6 * 60 * 60_000
/** 台账保留天数（分档键长期去重，但文件不能无限增长）。 */
const LEDGER_RETENTION_DAYS = 180
/** 精确提醒巡检时段（本地时间）。 */
const INTRADAY_START_HOUR = 6
const INTRADAY_END_HOUR = 22

/**
 * 旧版窗口选择（兼容 0.2.11 的行为断言）：
 * 今天/明天到期，外加逾期未完成的任务。新版实际走 `reminderCandidates`。
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

/** Plain-text push body (kept for scripts/tests and non-card consumers). */
export function formatPush(rows: DeadlineItem[], titlePrefix?: string): string {
  const prefix = titlePrefix !== undefined && titlePrefix.trim() !== '' ? `${titlePrefix.trim()} ` : ''
  const header = `${prefix}重要日程提醒`
  const blocks = rows.map((row) => {
    const time = row.time !== undefined && row.time !== '' ? ` ${row.time}` : ''
    const title = `${row.label} · ${remainingLabel(row.daysLeft)}${time}`
    const lines = row.caseName === row.label ? [] : [row.caseName]
    lines.push(...rowMetaLines(row))
    return `${title}\n${lines.join('\n')}`
  })
  return `${header}\n\n${blocks.join('\n\n')}`
}

/** Markdown push body (kept for generic Feishu cards / tests). */
export function formatPushMarkdown(rows: DeadlineItem[], titlePrefix?: string): string {
  const prefix = titlePrefix !== undefined && titlePrefix.trim() !== '' ? `${titlePrefix.trim()} ` : ''
  const header = `${prefix}重要日程提醒`
  const sections = rows.map((row) => {
    const time = row.time !== undefined && row.time !== '' ? ` ${row.time}` : ''
    const title = `${row.label} · ${remainingLabel(row.daysLeft)}${time}`
    const lines = row.caseName === row.label ? [] : [row.caseName]
    lines.push(...rowMetaLines(row))
    return `## ${title}\n${lines.join('\n')}`
  })
  return `# ${header}\n\n${sections.join('\n\n')}`
}

/** Result of one push run. */
export interface PushRunResult {
  /** Number of reminder entries in today's plan (before dedupe). */
  due: number
  /** Number actually pushed (fresh, after dedupe). */
  pushed: number
  /** Whether a push was attempted. */
  attempted: boolean
  /** Error text when the send failed (undefined on success). */
  error?: string
  /** 案件进展检查（0.2.12）：独立消息、独立台账。 */
  patrol?: { total: number; pushed: number; summary: string }
}

/** Result of one tick (digest / incremental / intraday). */
export interface ReminderTickResult extends PushRunResult {
  /** What this tick did. */
  kind: 'digest' | 'incremental' | 'intraday' | 'retry' | 'none'
  /** 精确提醒条数（kind=intraday 时有意义）。 */
  intraday?: number
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
 * 写在 detail 字段（如「9月4日下午3点10分开会」）。
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
      if (/下午|晚上/.test(text) && h < 12) h += 12
      if (/凌晨/.test(text) && h === 12) h = 0
      return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
    }
  }

  return undefined
}

/** 计算 daysLeft（相对本地今天）。 */
function daysLeftOf(date: string): number {
  const today = localDate()
  return Math.round((new Date(`${date}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86_400_000)
}

/** 构造一个 DeadlineItem（兼容旧测试/调用）。 */
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
 * 聚合所有数据源的期限（统一出口）。
 *
 * 事件（items event/both）+ 任务期限（items task/both）+ 关键日期（registry 装配）
 * 由 `computeDeadlinesV2` 按 `caseId|date|label` 去重；非诉项目与独立事项通过
 * `ownerMeta` 补名称/来源。
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
          type: (it.kind ?? 'case_event') as TimelineEvent['type'],
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

/** 从推送配置取出提醒计划选项。 */
function planOptions(cfg: PushConfig): ReminderPlanOptions & { preciseReminder?: boolean } {
  return {
    smartLead: cfg.smartLead !== false,
    includeConsequence: cfg.includeConsequence !== false,
    preciseReminder: cfg.preciseReminder !== false,
    maxDigestRows: cfg.maxDigestRows ?? 15,
    density: cfg.density ?? 'concise',
  }
}

/** 过滤掉已推送过的条目（force 时全部保留）。 */
async function filterFresh(entries: ReminderEntry[], store: PushStore, force: boolean): Promise<ReminderEntry[]> {
  if (force) return entries
  const fresh: ReminderEntry[] = []
  for (const entry of entries) {
    if (await store.hasPushed(entry.key)) continue
    // 升级当天兼容旧台账：旧键按天去重，避免同一事项被新旧两套键各推一次。
    const legacy = ledgerKey(entry.item.caseId, entry.item.date, entry.item.label)
    if (entry.key !== legacy && await store.hasPushed(legacy)) continue
    fresh.push(entry)
  }
  return fresh
}

/** 过滤掉已推送过的精确提醒。 */
async function filterFreshIntraday(entries: IntradayEntry[], store: PushStore, force: boolean): Promise<IntradayEntry[]> {
  if (force) return entries
  const fresh: IntradayEntry[] = []
  for (const entry of entries) {
    if (!(await store.hasPushed(entry.key))) fresh.push(entry)
  }
  return fresh
}

/** 精确提醒卡的头部颜色（有高危用橙，否则蓝）。 */
function intradayTemplate(entries: IntradayEntry[]): string {
  return entries.some((entry) => entry.severity === 'critical') ? 'red' : 'orange'
}

/**
 * 旧版入口：立即做一次「摘要」推送（手动执行/测试用）。
 *
 * @param dirs - 数据目录。
 * @param cfg - 推送配置。
 * @param store - 配置 + 台账。
 * @param opts.force - true 时绕过台账，推送当前计划内全部。
 * @param now - 当前时间（可注入）。
 */
export async function runDeadlinePush(
  dirs: { litigation: string; nonlitigation: string; tasks: string },
  cfg: PushConfig,
  store: PushStore,
  opts: { force?: boolean } = {},
  now: number = Date.now(),
): Promise<PushRunResult> {
  if (!cfg.enabled) return { due: 0, pushed: 0, attempted: false }

  const items = await collectAllDeadlines(dirs.litigation, dirs.nonlitigation, dirs.tasks)
  const selection = selectDigestEntries(reminderCandidates(items, planOptions(cfg), now), {
    density: cfg.density ?? 'concise',
    now,
  })
  const freshAll = await filterFresh(selection.entries, store, opts.force === true)
  const capped = applyDigestCaps(freshAll, { density: cfg.density ?? 'concise', maxRows: cfg.maxDigestRows })
  const fresh = capped.entries
  const suppressed = {
    ...selection.suppressed,
    capped: (selection.suppressed.capped ?? 0) + capped.hidden,
  }
  const patrol = await runPatrolPass(dirs.litigation, { weekly: true })

  if (fresh.length === 0) return { due: selection.entries.length, pushed: 0, attempted: false, patrol }

  try {
    await sendReminderCard(fresh, {
      titlePrefix: cfg.titlePrefix,
      pushTime: cfg.pushTime,
      maxRows: cfg.maxDigestRows,
      density: cfg.density ?? 'concise',
      suppressed,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { due: selection.entries.length, pushed: 0, attempted: true, error: message, patrol }
  }

  await store.recordPushed(fresh.map((entry) => entry.key))
  return { due: selection.entries.length, pushed: fresh.length, attempted: true, patrol }
}

/** 是否到今日摘要档期。 */
function digestSlotReached(cfg: PushConfig, now: number): boolean {
  const [h, m] = parsePushTime(cfg.pushTime)
  const slot = new Date(now)
  slot.setHours(h, m, 0, 0)
  return now >= slot.getTime()
}

/** 摘要档期距现在多久（毫秒，负数=已过）。 */
function msFromDigestSlot(cfg: PushConfig, now: number): number {
  const [h, m] = parsePushTime(cfg.pushTime)
  const slot = new Date(now)
  slot.setHours(h, m, 0, 0)
  return slot.getTime() - now
}

/** 当前是否在精确提醒巡检时段。 */
function inIntradayWindow(now: number): boolean {
  const hour = new Date(now).getHours()
  return hour >= INTRADAY_START_HOUR && hour < INTRADAY_END_HOUR
}

/** 记录一次成功（摘要/补充/精确共用）。 */
function successPatch(now: number, extra: Partial<PushRunState>): (state: PushRunState) => PushRunState {
  const iso = new Date(now).toISOString()
  return (state) => ({
    ...state,
    lastSuccessAt: iso,
    lastAttemptAt: iso,
    lastError: undefined,
    consecutiveFailures: 0,
    ...extra,
  })
}

/**
 * 分钟级巡检入口（host 每 5 分钟调用一次）。
 *
 * 决策顺序：
 *  1. 到点且今天还没发摘要 → 发摘要（成功才记 lastDigestDate；失败下个 tick 重试）；
 *  2. 上次失败且已过 10 分钟 → 重试；
 *  3. 当天摘要后出现新事项 → 冷却 15 分钟后发「补充」；
 *  4. 有事项即将开始 → 发「即将开始」精确卡。
 */
export async function runReminderTick(
  dirs: { litigation: string; nonlitigation: string; tasks: string },
  cfg: PushConfig,
  store: PushStore,
  stateStore: PushStateStore,
  opts: { force?: boolean; mode?: 'auto' | 'manual' | 'digest' | 'intraday'; now?: number } = {},
): Promise<ReminderTickResult> {
  const now = opts.now ?? Date.now()
  if (!cfg.enabled && opts.force !== true) {
    return { due: 0, pushed: 0, attempted: false, kind: 'none' }
  }

  const state = await stateStore.read()
  const today = localDate(now)
  const slotReached = digestSlotReached(cfg, now)
  const manual = opts.force === true || opts.mode === 'manual' || opts.mode === 'digest'
  const lastKind = state.lastKind ?? 'digest'
  const failed = (state.lastError ?? '') !== ''
  const retryWaitOver = state.lastAttemptAt === undefined
    || now - Date.parse(state.lastAttemptAt) >= RETRY_INTERVAL_MS
  // 失败后 10 分钟内不再重试，避免飞书持续故障时每 5 分钟打一次。
  const digestDue = (manual || (slotReached && state.lastDigestDate !== today))
    && !(failed && lastKind === 'digest' && !retryWaitOver)
  const retryDue = failed && lastKind === 'digest' && retryWaitOver
  const intradayWindow = opts.mode === 'intraday' || (cfg.preciseReminder !== false && inIntradayWindow(now))
  const incrementalAllowed = slotReached
    && state.lastDigestDate === today
    && (state.lastIncrementalAt === undefined || now - Date.parse(state.lastIncrementalAt) >= INCREMENTAL_INTERVAL_MS)
    && !(failed && lastKind === 'incremental' && !retryWaitOver)
  const intradayAllowed = intradayWindow && !(failed && lastKind === 'intraday' && !retryWaitOver)

  if (!digestDue && !retryDue && !intradayWindow && !incrementalAllowed) {
    return { due: 0, pushed: 0, attempted: false, kind: 'none' }
  }

  const items = await collectAllDeadlines(dirs.litigation, dirs.nonlitigation, dirs.tasks)
  const options = planOptions(cfg)
  const selection = selectDigestEntries(reminderCandidates(items, options, now), {
    density: cfg.density ?? 'concise',
    now,
  })
  const candidates = selection.entries
  const freshAll = await filterFresh(candidates, store, opts.force === true)
  const capped = applyDigestCaps(freshAll, { density: cfg.density ?? 'concise', maxRows: cfg.maxDigestRows })
  const fresh = capped.entries
  const suppressed = {
    ...selection.suppressed,
    capped: (selection.suppressed.capped ?? 0) + capped.hidden,
  }
  const intraday = await filterFreshIntraday(intradayCandidates(items, options, now), store, opts.force === true)

  // ① 摘要 / ② 失败重试
  if (digestDue || retryDue) {
    // 进展检查分级投递：高优先级新发现当天推；中/低优先级只在周一汇总，
    // 避免「已结案仍有未完成任务」这类清理型问题每天打扰。
    const weekly = new Date(now).getDay() === 1
    const patrol = await runPatrolPass(dirs.litigation, { weekly })
    if (fresh.length === 0) {
      await stateStore.mutate(successPatch(now, {
        lastDigestDate: today,
        lastPushedCount: 0,
        lastKind: 'digest',
      }))
      return { due: candidates.length, pushed: 0, attempted: false, patrol, kind: 'digest' }
    }
    try {
      const late = slotReached && msFromDigestSlot(cfg, now) < -60 * 60_000
      await sendReminderCard(fresh, {
        titlePrefix: cfg.titlePrefix,
        pushTime: cfg.pushTime,
        failureNote: state.lastError,
        late,
        maxRows: cfg.maxDigestRows,
        density: cfg.density ?? 'concise',
        suppressed,
      })
      await store.recordPushed(fresh.map((entry) => entry.key))
      void store.pruneLedger(now - LEDGER_RETENTION_DAYS * 86_400_000).catch(() => { /* best-effort */ })
      const kind: 'digest' | 'retry' = retryDue && !manual ? 'retry' : 'digest'
      await stateStore.mutate(successPatch(now, {
        lastDigestDate: digestDue ? today : state.lastDigestDate,
        lastPushedCount: fresh.length,
        lastKind: kind,
      }))
      return {
        due: candidates.length,
        pushed: fresh.length,
        attempted: true,
        patrol,
        kind,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const failures = (state.consecutiveFailures ?? 0) + 1
      await stateStore.mutate((s) => ({
        ...s,
        lastAttemptAt: new Date(now).toISOString(),
        lastError: message,
        consecutiveFailures: failures,
        lastKind: 'digest',
      }))
      const canFallback = state.lastFallbackAt === undefined
        || now - Date.parse(state.lastFallbackAt) >= FALLBACK_INTERVAL_MS
      if (canFallback) {
        const notified = await notifyLocal(
          'AgentLex 提醒推送失败',
          `飞书推送失败（第 ${failures} 次），${fresh.length} 项提醒未送达。请检查飞书配置。`,
        )
        if (notified) {
          await stateStore.mutate((s) => ({ ...s, lastFallbackAt: new Date(now).toISOString() }))
        }
      }
      console.warn(`[agentlex-push] 推送失败（第 ${failures} 次）: ${message}`)
      return { due: candidates.length, pushed: 0, attempted: true, error: message, patrol, kind: 'digest' }
    }
  }

  // ③ 当日补充
  if (fresh.length > 0 && incrementalAllowed) {
    try {
      await sendReminderCard(fresh, {
        titlePrefix: cfg.titlePrefix,
        pushTime: cfg.pushTime,
        supplement: true,
        maxRows: cfg.maxDigestRows,
        density: cfg.density ?? 'concise',
        suppressed,
      })
      await store.recordPushed(fresh.map((entry) => entry.key))
      await stateStore.mutate(successPatch(now, {
        lastIncrementalAt: new Date(now).toISOString(),
        lastPushedCount: fresh.length,
        lastKind: 'incremental',
      }))
      return { due: candidates.length, pushed: fresh.length, attempted: true, kind: 'incremental' }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await stateStore.mutate((s) => ({
        ...s,
        lastAttemptAt: new Date(now).toISOString(),
        lastError: message,
        consecutiveFailures: (s.consecutiveFailures ?? 0) + 1,
        lastKind: 'incremental',
      }))
      return { due: candidates.length, pushed: 0, attempted: true, error: message, kind: 'incremental' }
    }
  }

  // ④ 即将开始（精确提醒）
  if (intraday.length > 0 && intradayAllowed) {
    try {
      await sendFeishuCard(formatIntradayMarkdown(intraday, cfg.titlePrefix), { template: intradayTemplate(intraday) })
      await store.recordPushed(intraday.map((entry) => entry.key))
      await stateStore.mutate(successPatch(now, {
        lastPushedCount: intraday.length,
        lastKind: 'intraday',
      }))
      return { due: intraday.length, pushed: intraday.length, attempted: true, kind: 'intraday', intraday: intraday.length }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await stateStore.mutate((s) => ({
        ...s,
        lastAttemptAt: new Date(now).toISOString(),
        lastError: message,
        consecutiveFailures: (s.consecutiveFailures ?? 0) + 1,
        lastKind: 'intraday',
      }))
      return { due: intraday.length, pushed: 0, attempted: true, error: message, kind: 'intraday' }
    }
  }

  return { due: candidates.length, pushed: 0, attempted: false, kind: 'none' }
}

/** 预览今日提醒计划（设置页用，不发送、不写台账）。 */
export async function previewReminderPlan(
  dirs: { litigation: string; nonlitigation: string; tasks: string },
  cfg: PushConfig,
  now: number = Date.now(),
): Promise<ReminderPreview & { nextDigestAt: string; suppressed: SuppressedSummary }> {
  const items = await collectAllDeadlines(dirs.litigation, dirs.nonlitigation, dirs.tasks)
  const selection = selectDigestEntries(reminderCandidates(items, planOptions(cfg), now), {
    density: cfg.density ?? 'concise',
    now,
  })
  const capped = applyDigestCaps(selection.entries, { density: cfg.density ?? 'concise', maxRows: cfg.maxDigestRows })
  const entries = capped.entries
  const suppressed = {
    ...selection.suppressed,
    capped: (selection.suppressed.capped ?? 0) + capped.hidden,
  }
  const [h, m] = parsePushTime(cfg.pushTime)
  const slot = new Date(now)
  slot.setHours(h, m, 0, 0)
  if (slot.getTime() <= now) slot.setDate(slot.getDate() + 1)
  const nextDigestAt = `${slot.getFullYear()}-${String(slot.getMonth() + 1).padStart(2, '0')}-${String(slot.getDate()).padStart(2, '0')} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  return { ...buildPreview(entries, 50), nextDigestAt, suppressed }
}

/**
 * 案件进展检查（0.2.12）—— 独立一条消息 + 去重台账。
 *
 * 与每日到期提醒彻底分开：这里回答「你的账是不是记错了」，不是「今天要干什么」。
 */
async function runPatrolPass(
  litigationDir: string,
  opts: { weekly?: boolean } = {},
): Promise<{ total: number; pushed: number; summary: string }> {
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
      // 高优先级（期限漏登/该推进没推进）当天推；中/低优先级（重复登记/结案未清任务）
      // 只在周一汇总，减少日常噪音。
      if (f.severity !== 'high' && opts.weekly !== true) continue
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
    console.warn('[agentlex-patrol] 进展检查失败:', error instanceof Error ? error.message : String(error))
    return { total: 0, pushed: 0, summary: '案件进展检查：执行失败' }
  }
}
