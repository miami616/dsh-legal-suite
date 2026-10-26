/**
 * Feishu card sender — renders deadline reminders as a structured Feishu
 * interactive card (分区卡片), mirroring the proven feishu_push.py logic.
 *
 * Two entry points:
 *  - sendDeadlineCard(rows, titlePrefix): the deadline-reminder card. Each
 *    deadline is a structured block: a bold title row (事项 + 时间) with a
 *    colored 「今天/明天」text_tag, then the case name, then a meta line
 *    (案号 · 法院 · 法庭). A date subtitle sits under the header and a
 *    source note at the bottom.
 *  - sendFeishuCard(markdown): generic markdown-section card (used by the
 *    settings test button).
 *
 * Credentials are read from the dsh-im feishu integration config
 * ($DSH_HOME/integrations/dsh-feishu/config.json) and the credential store
 * ($DSH_HOME/.credentials.yaml) — the same sources feishu_push.py uses.
 */

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { DeadlineItem } from '../litigation/deadlines.ts'
import { loadFeishuConfig, loadSecret } from './feishu-config.ts'
import { groupEntries, SEVERITY_RANK, type ReminderDensity, type ReminderEntry, type Severity, type SuppressedSummary } from './reminder-plan.ts'
import type { WeeklyPayload } from './weekly.ts'

const FEISHU_BASE = 'https://open.feishu.cn'

/** One JSON request to the Feishu open API. */
async function httpJson(url: string, payload?: unknown, token?: string): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { 'content-type': 'application/json; charset=utf-8' }
  if (token) headers.authorization = `Bearer ${token}`
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const body = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok || body.code !== 0) {
    throw new Error(`feishu api ${res.status}: ${JSON.stringify(body)}`)
  }
  return body
}

/** Get a tenant access token. */
async function getToken(appId: string, appSecret: string): Promise<string> {
  const res = await httpJson(`${FEISHU_BASE}/open-apis/auth/v3/tenant_access_token/internal`, {
    app_id: appId,
    app_secret: appSecret,
  })
  return String(res.tenant_access_token)
}

/** 案号/法院占位值（不展示）。 */
const PLACEHOLDER_NUMBER = '【尚未立案】'
const PLACEHOLDER_COURT = '【尚未分配】'

/** 一行期限的元信息（案号 · 法院），无则 undefined。detail 单独一行完整展示。 */
function metaLine(row: DeadlineItem): string | undefined {
  const parts: string[] = []
  if (row.caseNumber !== undefined && row.caseNumber !== '' && row.caseNumber !== PLACEHOLDER_NUMBER) {
    parts.push(`案号：${row.caseNumber}`)
  }
  if (row.court !== undefined && row.court !== '' && row.court !== PLACEHOLDER_COURT) {
    parts.push(`法院：${row.court}`)
  }
  return parts.length > 0 ? parts.join(' · ') : undefined
}

/**
 * Send a structured deadline-reminder card to the bot owner.
 *
 * Layout:
 *   header (blue)  「{prefix}重要日程提醒」
 *   subtitle       「M月D日 · 今日与明日到期的关键日程」
 *   ── per deadline ──
 *     title row    **{事项}** · {时间}   [今天|明天] (colored text_tag)
 *     case name    （案件名，与事项同名时省略）
 *     meta line    案号：… · 法院：… · 法庭：…
 *   ──
 *   note           「由 AgentLex 自动推送 · 每天早上 8:30」
 *
 * @param rows - the deadline rows to render (today/tomorrow).
 * @param titlePrefix - optional prefix for the header title.
 * @returns the Feishu API response.
 */
export async function sendDeadlineCard(
  rows: DeadlineItem[],
  titlePrefix?: string,
  /** 法定期限巡检告警（0.2.12）：非空时在卡片尾部附一行，提醒去补登记。 */
  periodWarning?: string,
): Promise<Record<string, unknown>> {
  const bot = await loadFeishuConfig()
  const secret = await loadSecret(bot.secretRef)
  const token = await getToken(bot.appId, secret)
  const owner = bot.ownerOpenIds[0]

  const prefix = titlePrefix !== undefined && titlePrefix.trim() !== '' ? `${titlePrefix.trim()} ` : ''
  const now = new Date()
  const dateLine = `${now.getMonth() + 1}月${now.getDate()}日`

  const elements: Array<Record<string, unknown>> = []
  // 副标题：日期 + 说明（日程与任务都覆盖）。
  elements.push({ tag: 'div', text: { tag: 'lark_md', content: `**${dateLine}** · 今日与明日到期，及逾期未完成的任务` } })
  elements.push({ tag: 'hr' })

  if (rows.length === 0) {
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: '今日与明日暂无到期日程 🎉' } })
  }

  rows.forEach((row, i) => {
    if (i > 0) elements.push({ tag: 'hr' })
    const time = row.time !== undefined && row.time !== '' ? ` · ${row.time}` : ''
    // 逾期任务 → 醒目标签（任务才有逾期语义）；今天 → 红；明天 → 橙。
    const tagHtml = row.daysLeft < 0
      ? `<text_tag color='red'>已逾期 ${-row.daysLeft} 天</text_tag>`
      : row.daysLeft === 0
        ? `<text_tag color='red'>今天</text_tag>`
        : `<text_tag color='orange'>明天</text_tag>`
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: `**${row.label}**${time} ${tagHtml}` } })
    // 案件名（与事项同名或为空时省略，如独立任务/无归属事项）。
    if (row.caseName !== undefined && row.caseName !== '' && row.caseName !== row.label) {
      elements.push({ tag: 'div', text: { tag: 'lark_md', content: row.caseName } })
    }
    const meta = metaLine(row)
    if (meta !== undefined) {
      elements.push({ tag: 'div', text: { tag: 'lark_md', content: meta } })
    }
    // 完整详情（时间/地点/要求等）单独一行展示。
    if (row.detail !== undefined && row.detail !== '') {
      elements.push({ tag: 'div', text: { tag: 'lark_md', content: row.detail } })
    }
  })

  // 法定期限巡检告警（0.2.12）：有案子进了上诉期却没登期限，必须在提醒里出现，
  // 否则「期限保护」就只保护了记得登记的那些。
  if (periodWarning !== undefined && periodWarning.trim() !== '') {
    elements.push({ tag: 'hr' })
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: `⚠️ **法定期限待登记**\n${periodWarning.trim()}` } })
  }

  elements.push({ tag: 'hr' })
  elements.push({ tag: 'note', elements: [{ tag: 'plain_text', content: '由 AgentLex 自动推送 · 每天早上 8:30' }] })

  const card = {
    config: { wide_screen_mode: true },
    header: { template: 'blue', title: { tag: 'plain_text', content: `${prefix}重要日程与任务提醒` } },
    elements,
  }
  const url = `${FEISHU_BASE}/open-apis/im/v1/messages?receive_id_type=open_id`
  return httpJson(url, {
    receive_id: owner,
    msg_type: 'interactive',
    content: JSON.stringify(card),
  }, token)
}

/** 摘要卡可选参数。 */
export interface ReminderCardOptions {
  titlePrefix?: string
  /** 每日推送时间（页脚说明用）。 */
  pushTime?: string
  /** 上次推送失败的提示（成功补发时展示一次）。 */
  failureNote?: string
  /** 是否补发/延迟发送。 */
  late?: boolean
  /** 当日摘要后新增事项的「补充提醒」。 */
  supplement?: boolean
  /** 案件进展检查的新发现（附在卡尾「需要核对」；同一天不再单独发一张卡）。 */
  progressCheck?: string
  /** 卡片类型：digest（每日摘要）/ intraday（即将开始）。 */
  kind?: 'digest' | 'intraday'
  /** 单卡最多展开条数（默认精简 8 / 标准 15）；超出只给计数。 */
  maxRows?: number
  /** 提醒密度：精简模式按分区限额，避免逾期任务挤占今日事项。 */
  density?: ReminderDensity
  /** 被折叠的逾期/远期提醒统计。 */
  suppressed?: SuppressedSummary
}

/** 严重度 → 飞书 text_tag 颜色。 */
function tagColor(entry: ReminderEntry): string {
  // 今天/逾期一律红色（不管性质）；明天或高危橙色；提前提醒灰色。
  if (entry.section === 'overdue' || entry.section === 'today_critical' || entry.section === 'today') return 'red'
  if (entry.severity === 'critical' || entry.severity === 'high' || entry.section === 'tomorrow') return 'orange'
  return 'grey'
}

/** 卡片头部颜色：有 critical 用红，有 high 用橙，否则蓝。 */
function headerTemplate(entries: ReminderEntry[]): string {
  const worst = entries.reduce<Severity>((acc, entry) => (
    SEVERITY_RANK[entry.severity] < SEVERITY_RANK[acc] ? entry.severity : acc
  ), 'low')
  return worst === 'critical' ? 'red' : worst === 'high' ? 'orange' : 'blue'
}

/**
 * 发送「智能分级」摘要卡（v0.2.25 起的唯一摘要卡入口）。
 *
 * 与旧卡的区别：
 *  - 分区（逾期任务 / 今日必办 / 今日安排 / 明日安排 / 提前提醒），先看最要紧的；
 *  - 每条带档位标签（今天/明天/还剩 N 天/已逾期 N 天），补发标明「（补）」；
 *  - 法定期限与程序期限带一行「逾期后果」，不用再去翻法条；
 *  - 卡片颜色随最高严重度变化（红/橙/蓝），扫一眼就知道今天有没有硬期限。
 *
 * @param entries - 已去重的提醒条目（reminder-plan 输出）。
 * @param opts - 前缀、推送时间、失败提示等。
 */
export async function sendReminderCard(entries: ReminderEntry[], opts: ReminderCardOptions = {}): Promise<Record<string, unknown>> {
  const bot = await loadFeishuConfig()
  const secret = await loadSecret(bot.secretRef)
  const token = await getToken(bot.appId, secret)
  const owner = bot.ownerOpenIds[0]

  const prefix = opts.titlePrefix !== undefined && opts.titlePrefix.trim() !== '' ? `${opts.titlePrefix.trim()} ` : ''
  const now = new Date()
  const dateLine = `${now.getMonth() + 1}月${now.getDate()}日`
  const concise = opts.density !== 'standard'
  const groups = groupEntries(entries)
  // 精简模式不按总条数截断：今天/明天不设上限，只有 overdue/ahead 有分区限额。
  const maxRows = concise ? Number.MAX_SAFE_INTEGER : Math.max(1, opts.maxRows ?? 15)
  // 精简模式的分区限额：今日必办不能被 66 个逾期任务挤掉。
  const sectionCaps: Partial<Record<ReminderEntry['section'], number>> | undefined = concise
    ? { overdue: 3, today_critical: 5, today: Number.POSITIVE_INFINITY, tomorrow: 6, ahead: 3 }
    : undefined
  const total = entries.length
  const criticalCount = entries.filter((e) => e.severity === 'critical').length
  const overdueCount = entries.filter((e) => e.section === 'overdue').length

  const elements: Array<Record<string, unknown>> = []
  const summary: string[] = [`**${dateLine}**`]
  if (criticalCount > 0) summary.push(`<text_tag color='red'>硬期限 ${criticalCount} 项</text_tag>`)
  if (overdueCount > 0) summary.push(`<text_tag color='red'>逾期任务 ${overdueCount} 项</text_tag>`)
  summary.push(`共 ${total} 项`)
  const suffix = opts.supplement === true ? ' · 补充' : opts.late === true ? ' · 补发' : ''
  elements.push({ tag: 'div', text: { tag: 'lark_md', content: `${summary.join(' · ')}${suffix}` } })

  let shown = 0
  let hidden = 0
  for (const group of groups) {
    const cap = sectionCaps?.[group.section] ?? Number.POSITIVE_INFINITY
    const budget = maxRows - shown
    const take = Math.max(0, Math.min(group.entries.length, cap, budget))
    hidden += group.entries.length - take
    if (take === 0) continue
    elements.push({ tag: 'hr' })
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: `**${group.title}**` } })
    for (const entry of group.entries.slice(0, take)) {
      const row = entry.item
      const time = row.time !== undefined && row.time !== '' ? ` · ${row.time}` : ''
      // 精简模式：除「今日必办」外，一条一行（事项 · 案件 · 标签），
      // 避免 14 条明日事项把卡片拉成十几屏；今日必办保留案号/法庭/后果。
      const compact = concise && group.section !== 'today_critical'
      if (compact) {
        const casePart = row.caseName !== undefined && row.caseName !== '' && row.caseName !== row.label ? ` · ${row.caseName}` : ''
        const detailPart = row.detail !== undefined && row.detail !== '' && (entry.cls === 'hearing' || entry.cls === 'preservation') ? ` · ${row.detail}` : ''
        elements.push({
          tag: 'div',
          text: { tag: 'lark_md', content: `**${row.label}**${time}${casePart}${detailPart} <text_tag color='${tagColor(entry)}'>${entry.phaseLabel}</text_tag>` },
        })
        if (entry.consequence !== undefined && entry.consequence !== '') {
          elements.push({ tag: 'div', text: { tag: 'lark_md', content: `⚠ ${entry.consequence}` } })
        }
      } else {
        elements.push({
          tag: 'div',
          text: { tag: 'lark_md', content: `**${row.label}**${time} <text_tag color='${tagColor(entry)}'>${entry.phaseLabel}</text_tag>` },
        })
        if (row.caseName !== undefined && row.caseName !== '' && row.caseName !== row.label) {
          elements.push({ tag: 'div', text: { tag: 'lark_md', content: row.caseName } })
        }
        const meta = metaLine(row)
        if (meta !== undefined) elements.push({ tag: 'div', text: { tag: 'lark_md', content: meta } })
        if (row.detail !== undefined && row.detail !== '') {
          elements.push({ tag: 'div', text: { tag: 'lark_md', content: row.detail } })
        }
        if (entry.consequence !== undefined && entry.consequence !== '') {
          elements.push({ tag: 'div', text: { tag: 'lark_md', content: `⚠ ${entry.consequence}` } })
        }
      }
      shown++
    }
  }
  // 折叠信息：逾期积压/远期提醒只给数量，不逐条刷屏。
  const folded: string[] = []
  const suppressed = opts.suppressed
  if (suppressed !== undefined && suppressed.overdue > 0 && suppressed.showBacklog !== false) {
    const oldest = suppressed.oldestOverdueAge !== undefined ? `，最久 ${suppressed.oldestOverdueAge} 天` : ''
    folded.push(`逾期任务 ${suppressed.overdue} 项${oldest}`)
  }
  if (suppressed !== undefined && suppressed.ahead > 0) folded.push(`远期提醒 ${suppressed.ahead} 项（周一汇总）`)
  if (suppressed !== undefined && (suppressed.capped ?? 0) > 0) folded.push(`本次未展开 ${suppressed.capped} 项`)
  if (hidden > 0) folded.push(`本次未展开 ${hidden} 项`)
  if (folded.length > 0) {
    elements.push({ tag: 'hr' })
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: `另有：${folded.join(' · ')}。完整清单见 AgentLex 任务面板。` } })
  }

  if (opts.failureNote !== undefined && opts.failureNote.trim() !== '') {
    elements.push({ tag: 'hr' })
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: `⚠ **上次推送失败**：${opts.failureNote.trim()}` } })
  }
  if (opts.progressCheck !== undefined && opts.progressCheck.trim() !== '') {
    elements.push({ tag: 'hr' })
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: `⚠️ **需要核对**\n${opts.progressCheck.trim()}` } })
  }

  elements.push({ tag: 'hr' })
  elements.push({ tag: 'note', elements: [{ tag: 'plain_text', content: `由 AgentLex 自动推送 · 每日 ${opts.pushTime ?? '08:30'} · 智能分级提醒` }] })

  const card = {
    config: { wide_screen_mode: true },
    header: {
      template: headerTemplate(entries),
      title: {
        tag: 'plain_text',
        content: `${prefix}${opts.supplement === true ? '日程提醒（补充）' : opts.late === true ? '日程提醒（补发）' : '日程提醒'}`,
      },
    },
    elements,
  }
  const url = `${FEISHU_BASE}/open-apis/im/v1/messages?receive_id_type=open_id`
  return httpJson(url, {
    receive_id: owner,
    msg_type: 'interactive',
    content: JSON.stringify(card),
  }, token)
}

/** 周报卡可选参数。 */
export interface WeeklyCardOptions {
  /** 标题前缀（与日报共用 titlePrefix）。 */
  titlePrefix?: string
  /** 页脚说明，默认按周报类型给「每周一 08:30 / 每周五 16:30」。 */
  note?: string
}

/**
 * 发送周报卡（周一「本周重点工作」/ 周五「本周总结与下周重点」）。
 *
 * 与日报卡共用同一条飞书通道与视觉口径（分区 + 分区标题 + 每事一行），
 * 但周报按「周」聚合，所以固定用文字卡：分区多、需要一眼扫完，
 * 图片版在手机上要来回缩放反而更慢。
 *
 * @param payload - weekly.ts 装配好的内容。
 * @param opts - 标题前缀与页脚。
 * @returns 飞书 API 响应。
 */
export async function sendWeeklyCard(payload: WeeklyPayload, opts: WeeklyCardOptions = {}): Promise<Record<string, unknown>> {
  const bot = await loadFeishuConfig()
  const secret = await loadSecret(bot.secretRef)
  const token = await getToken(bot.appId, secret)
  const owner = bot.ownerOpenIds[0]

  const prefix = opts.titlePrefix !== undefined && opts.titlePrefix.trim() !== '' ? `${opts.titlePrefix.trim()} ` : ''
  const plan = payload.kind === 'plan'
  const title = plan ? '本周重点工作' : '本周总结与下周重点'
  const template = plan
    ? (payload.worst === 'critical' ? 'red' : payload.worst === 'high' ? 'orange' : 'blue')
    : 'green'

  const elements: Array<Record<string, unknown>> = []
  const summary: string[] = [`**${payload.rangeLabel}**`, payload.weekLabel]
  if (!plan) {
    const done = payload.sections.find((section) => section.title === '本周完成')
    const deferred = payload.sections.find((section) => section.title === '本周顺延')
    const next = payload.sections.find((section) => section.title === '下周重点')
    if (done !== undefined) summary.push(`完成 ${done.rows.length} 项`)
    if (deferred !== undefined) summary.push(`顺延 ${deferred.rows.length} 项`)
    if (next !== undefined) summary.push(`下周 ${next.rows.length} 项`)
  } else {
    summary.push(`共 ${payload.total} 项`)
  }
  elements.push({ tag: 'div', text: { tag: 'lark_md', content: summary.join(' · ') } })

  for (const section of payload.sections) {
    elements.push({ tag: 'hr' })
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: `**${section.title}**` } })
    for (const row of section.rows) {
      const time = row.when !== '' ? `${row.when}` : ''
      const casePart = row.caseName !== undefined && row.caseName !== '' && row.caseName !== row.label ? ` · ${row.caseName}` : ''
      const detailPart = row.detail !== undefined && row.detail !== '' ? ` · ${row.detail}` : ''
      const tagPart = row.tag !== undefined && row.tag !== ''
        ? ` <text_tag color='${row.tagColor ?? 'grey'}'>${row.tag}</text_tag>`
        : ''
      const head = time !== '' ? `${time} ` : ''
      elements.push({
        tag: 'div',
        text: { tag: 'lark_md', content: `${head}**${row.label}**${casePart}${detailPart}${tagPart}` },
      })
    }
    if (section.note !== undefined && section.note !== '') {
      elements.push({ tag: 'div', text: { tag: 'lark_md', content: `<font color='grey'>${section.note}</font>` } })
    }
  }

  elements.push({ tag: 'hr' })
  elements.push({
    tag: 'note',
    elements: [{
      tag: 'plain_text',
      content: opts.note ?? (plan
        ? '由 AgentLex 自动推送 · 每周一早上 · 与当日早报合并为一张'
        : '由 AgentLex 自动推送 · 每周五下午'),
    }],
  })

  const card = {
    config: { wide_screen_mode: true },
    header: {
      template,
      title: { tag: 'plain_text', content: `${prefix}${title}` },
    },
    elements,
  }
  const url = `${FEISHU_BASE}/open-apis/im/v1/messages?receive_id_type=open_id`
  return httpJson(url, {
    receive_id: owner,
    msg_type: 'interactive',
    content: JSON.stringify(card),
  }, token)
}

/**
 * 发送图片版提醒卡：把渲染好的 PNG 上传到飞书，再作为图片卡发出。
 *
 * 与文字卡并存，由 `imageMode` 决定用哪个；图片失败时调用方会回退文字卡。
 */
export async function sendReminderImageCard(
  pngPath: string,
  entries: ReminderEntry[],
  opts: ReminderCardOptions = {},
): Promise<Record<string, unknown>> {
  const bot = await loadFeishuConfig()
  const secret = await loadSecret(bot.secretRef)
  const token = await getToken(bot.appId, secret)
  const owner = bot.ownerOpenIds[0]

  const imageKey = await uploadImage(token, pngPath, 'reminder.png')

  const prefix = opts.titlePrefix !== undefined && opts.titlePrefix.trim() !== '' ? `${opts.titlePrefix.trim()} ` : ''
  const critical = entries.filter((entry) => entry.severity === 'critical').length
  const overdue = entries.filter((entry) => entry.section === 'overdue').length
  const summary: string[] = [`共 ${entries.length} 项`]
  if (critical > 0) summary.push(`硬期限 ${critical} 项`)
  if (overdue > 0) summary.push(`逾期 ${overdue} 项`)

  const card = {
    config: { wide_screen_mode: true },
    header: {
      template: headerTemplate(entries),
      title: { tag: 'plain_text', content: `${prefix}${opts.kind === 'intraday' ? '即将开始' : opts.supplement === true ? '日程提醒（补充）' : opts.late === true ? '日程提醒（补发）' : '日程提醒'}` },
    },
    elements: [
      { tag: 'img', img_key: imageKey, alt: { tag: 'plain_text', content: '今日日程提醒' } },
      { tag: 'hr' },
      { tag: 'div', text: { tag: 'lark_md', content: summary.join(' · ') } },
      ...(opts.progressCheck !== undefined && opts.progressCheck.trim() !== ''
        ? [{ tag: 'div', text: { tag: 'lark_md', content: `⚠️ **需要核对**\n${opts.progressCheck.trim()}` } }]
        : []),
      ...(opts.failureNote !== undefined && opts.failureNote.trim() !== ''
        ? [{ tag: 'div', text: { tag: 'lark_md', content: `⚠ **上次推送失败**：${opts.failureNote.trim()}` } }]
        : []),
      { tag: 'note', elements: [{ tag: 'plain_text', content: opts.kind === 'intraday' ? '图片版 · 临近开始提醒 · 点开图片可放大' : `图片版 · 每日 ${opts.pushTime ?? '08:30'} · 点开图片可放大` }] },
    ],
  }
  const url = `${FEISHU_BASE}/open-apis/im/v1/messages?receive_id_type=open_id`
  return httpJson(url, {
    receive_id: owner,
    msg_type: 'interactive',
    content: JSON.stringify(card),
  }, token)
}

/**
 * 把本地 PNG 上传到飞书，返回 `image_key`（图片卡复用）。
 *
 * 上传失败一律抛错：调用方据此回退文字卡，不会出现「图片发不出、提醒也没了」。
 */
async function uploadImage(token: string, pngPath: string, filename: string): Promise<string> {
  const png = await readFile(pngPath)
  const form = new FormData()
  form.append('image_type', 'message')
  form.append('image', new Blob([png], { type: 'image/png' }), filename)
  const uploadRes = await fetch(`${FEISHU_BASE}/open-apis/im/v1/images`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  })
  const uploaded = await uploadRes.json().catch(() => ({})) as Record<string, unknown>
  if (!uploadRes.ok || uploaded.code !== 0) {
    throw new Error(`feishu image upload ${uploadRes.status}: ${JSON.stringify(uploaded)}`)
  }
  const imageKey = (uploaded.data as { image_key?: string } | undefined)?.image_key
  if (imageKey === undefined) throw new Error('feishu image upload returned no image_key')
  return imageKey
}

/**
 * 发送图片版周报卡（周一「本周重点工作」/ 周五「本周总结与下周重点」）。
 *
 * 与文字版 `sendWeeklyCard` 并存，由 `imageMode` 决定用哪个；图片失败时
 * 调用方回退文字版。周报只发一条消息，不会出现「图片 + 文字」两张。
 */
export async function sendWeeklyImageCard(
  pngPath: string,
  payload: WeeklyPayload,
  opts: WeeklyCardOptions = {},
): Promise<Record<string, unknown>> {
  const bot = await loadFeishuConfig()
  const secret = await loadSecret(bot.secretRef)
  const token = await getToken(bot.appId, secret)
  const owner = bot.ownerOpenIds[0]

  const imageKey = await uploadImage(token, pngPath, 'weekly.png')

  const prefix = opts.titlePrefix !== undefined && opts.titlePrefix.trim() !== '' ? `${opts.titlePrefix.trim()} ` : ''
  const plan = payload.kind === 'plan'
  const title = plan ? '本周重点工作' : '本周总结与下周重点'
  const template = plan
    ? (payload.worst === 'critical' ? 'red' : payload.worst === 'high' ? 'orange' : 'blue')
    : 'green'

  const summary: string[] = [`**${payload.rangeLabel}**`, payload.weekLabel]
  if (plan) {
    summary.push(`共 ${payload.total} 项`)
  } else {
    const done = payload.sections.find((section) => section.title === '本周完成')
    const deferred = payload.sections.find((section) => section.title === '本周顺延')
    const next = payload.sections.find((section) => section.title === '下周重点')
    if (done !== undefined) summary.push(`完成 ${done.rows.length} 项`)
    if (deferred !== undefined) summary.push(`顺延 ${deferred.rows.length} 项`)
    if (next !== undefined) summary.push(`下周 ${next.rows.length} 项`)
  }

  const card = {
    config: { wide_screen_mode: true },
    header: {
      template,
      title: { tag: 'plain_text', content: `${prefix}${title}` },
    },
    elements: [
      { tag: 'img', img_key: imageKey, alt: { tag: 'plain_text', content: title } },
      { tag: 'hr' },
      { tag: 'div', text: { tag: 'lark_md', content: summary.join(' · ') } },
      { tag: 'note', elements: [{ tag: 'plain_text', content: opts.note ?? (plan ? '图片版 · 每周一早上 · 点开图片可放大' : '图片版 · 每周五下午 · 点开图片可放大') }] },
    ],
  }
  const url = `${FEISHU_BASE}/open-apis/im/v1/messages?receive_id_type=open_id`
  return httpJson(url, {
    receive_id: owner,
    msg_type: 'interactive',
    content: JSON.stringify(card),
  }, token)
}

/**
 * Parse markdown into (headerTitle, sections) — same grammar as feishu_push.py:
 * `# ` header, `## ` section titles, `---`/blank lines ignored.
 */
export function parseSections(markdown: string): { header: string; sections: Array<{ title: string | null; body: string }> } {
  let header = '重要日程提醒'
  const sections: Array<{ title: string | null; body: string }> = []
  let curTitle: string | null = null
  let curLines: string[] = []
  const flush = (): void => {
    const body = curLines.join('\n').trim()
    if (body !== '') sections.push({ title: curTitle, body })
    curLines = []
  }
  for (const raw of markdown.split('\n')) {
    const line = raw.trimEnd()
    if (line.startsWith('# ') && !line.startsWith('## ')) {
      header = line.slice(2).trim() || header
      continue
    }
    if (line.startsWith('## ')) {
      flush()
      curTitle = line.slice(3).trim()
      continue
    }
    if (line.trim() === '---' || line.trim() === '') continue
    curLines.push(line)
  }
  flush()
  if (sections.length === 0 && markdown.trim() !== '') {
    sections.push({ title: null, body: markdown.trim() })
  }
  return { header, sections }
}

/**
 * Send a markdown reminder as a Feishu interactive card to the bot owner.
 * @param markdown - the markdown reminder text.
 * @returns the Feishu API response.
 */
export async function sendFeishuCard(markdown: string, opts: { template?: string } = {}): Promise<Record<string, unknown>> {
  const bot = await loadFeishuConfig()
  const secret = await loadSecret(bot.secretRef)
  const token = await getToken(bot.appId, secret)
  const owner = bot.ownerOpenIds[0]

  const { header, sections } = parseSections(markdown)
  const elements: Array<Record<string, unknown>> = []
  let first = true
  for (const section of sections) {
    if (section.body === '') continue
    if (!first) elements.push({ tag: 'hr' })
    if (section.title !== null && section.title !== '') {
      elements.push({ tag: 'markdown', content: `**${section.title}**`, text_size: 'heading' })
    }
    elements.push({ tag: 'markdown', content: section.body, text_size: 'heading' })
    first = false
  }
  if (elements.length === 0) {
    elements.push({ tag: 'markdown', content: '（暂无日程提醒）' })
  }

  const card = {
    config: { wide_screen_mode: true },
    header: { template: opts.template ?? 'blue', title: { tag: 'plain_text', content: header } },
    elements,
  }
  const url = `${FEISHU_BASE}/open-apis/im/v1/messages?receive_id_type=open_id`
  return httpJson(url, {
    receive_id: owner,
    msg_type: 'interactive',
    content: JSON.stringify(card),
  }, token)
}

/**
 * 案件进展检查提醒（0.2.12）—— **独立一张卡**，不与每日到期提醒混。
 *
 * 两者性质不同：每日提醒回答「今天要干什么」，检查卡回答「登记和实际进展对不上」。
 * 混在一起会让"今天没事"的日子看不出异常，也会让异常被日常事项淹没。
 * 每条给「证据 → 期望 → 动作」，律师照做即可，不用再回来问为什么。
 */
/** 把发现渲染成检查卡的 markdown（纯函数，便于单测）。 */
export function patrolCardMarkdown(findings: Array<{
  caseId: string
  caseName: string
  ruleName: string
  severity: string
  evidence: string[]
  expectation: string
  action: string
}>): string {
  const SEV: Record<string, string> = { high: '⚠ 高', medium: '· 中', low: '· 低' }
  const lines: string[] = ['# 案件进展检查']
  for (const f of findings) {
    lines.push('')
    lines.push(`## ${SEV[f.severity] ?? ''} ${f.caseId} ${f.caseName}`)
    lines.push(`**${f.ruleName}**`)
    for (const e of f.evidence) lines.push(`- ${e}`)
    lines.push(`期望：${f.expectation}`)
    lines.push(`动作：${f.action}`)
  }
  lines.push('')
  lines.push(`（${findings.length} 项 · 由 AgentLex 每日检查；新出现或证据变化才提醒；确认无需处理的可用 mute_patrol_finding 归档）`)
  return lines.join('\n')
}

/** 发送案件进展检查卡（独立消息，橙色标题区别于蓝色到期提醒）。 */
export async function sendPatrolCard(findings: Parameters<typeof patrolCardMarkdown>[0]): Promise<Record<string, unknown>> {
  return sendFeishuCard(patrolCardMarkdown(findings), { template: 'orange' })
}
