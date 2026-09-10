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
export async function sendDeadlineCard(rows: DeadlineItem[], titlePrefix?: string): Promise<Record<string, unknown>> {
  const bot = await loadFeishuConfig()
  const secret = await loadSecret(bot.secretRef)
  const token = await getToken(bot.appId, secret)
  const owner = bot.ownerOpenIds[0]

  const prefix = titlePrefix !== undefined && titlePrefix.trim() !== '' ? `${titlePrefix.trim()} ` : ''
  const now = new Date()
  const dateLine = `${now.getMonth() + 1}月${now.getDate()}日`

  const elements: Array<Record<string, unknown>> = []
  // 副标题：日期 + 说明（日程与任务都覆盖）。
  elements.push({ tag: 'div', text: { tag: 'lark_md', content: `**${dateLine}** · 今日与明日到期的日程与任务` } })
  elements.push({ tag: 'hr' })

  if (rows.length === 0) {
    elements.push({ tag: 'div', text: { tag: 'lark_md', content: '今日与明日暂无到期日程 🎉' } })
  }

  rows.forEach((row, i) => {
    if (i > 0) elements.push({ tag: 'hr' })
    const time = row.time !== undefined && row.time !== '' ? ` · ${row.time}` : ''
    // 今天 → 红色标签；明天 → 橙色标签（lark_md 内联 text_tag 语法）。
    const tagHtml = row.daysLeft === 0
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
export async function sendFeishuCard(markdown: string): Promise<Record<string, unknown>> {
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
    header: { template: 'blue', title: { tag: 'plain_text', content: header } },
    elements,
  }
  const url = `${FEISHU_BASE}/open-apis/im/v1/messages?receive_id_type=open_id`
  return httpJson(url, {
    receive_id: owner,
    msg_type: 'interactive',
    content: JSON.stringify(card),
  }, token)
}
