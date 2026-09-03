/**
 * Feishu card sender — renders a markdown reminder as a structured Feishu
 * interactive card (分区卡片), mirroring the proven feishu_push.py logic.
 *
 * Feishu text messages do NOT render markdown (bold/headings/separators), so
 * the push domain uses this card path for the feishu channel to get a clean,
 * scannable, sectioned card (bold section titles, hr separators, large text).
 * Other channels (weixin etc.) keep the plain-text path.
 *
 * Credentials are read from the dsh-im feishu integration config
 * ($DSH_HOME/integrations/dsh-feishu/config.json) and the credential store
 * ($DSH_HOME/.credentials.yaml) — the same sources feishu_push.py uses.
 */

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const FEISHU_BASE = 'https://open.feishu.cn'

/** Feishu integration config (dsh-im). */
interface FeishuBotConfig {
  appId: string
  secretRef: string
  ownerOpenIds: string[]
}

/** Parse the credential store (YAML refs or fallback regex). */
async function loadSecret(ref: string): Promise<string> {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const credsPath = join(home, '.credentials.yaml')
  const raw = await readFile(credsPath, 'utf8')
  // Try YAML refs first.
  try {
    const yaml = await import('js-yaml')
    const d = yaml.load(raw) as { refs?: Record<string, string> } | null
    const val = d?.refs?.[ref]
    if (val) return val
  } catch { /* fall through */ }
  // Fallback: regex refs.
  const m = new RegExp(`^\\s{2}${ref}:\\s*(.+?)\\s*$`, 'm').exec(raw)
  if (m !== null) return m[1]
  const env = process.env[ref]
  if (env) return env
  throw new Error(`feishu secret not found: ${ref}`)
}

/** Read the feishu bot config (first bot). */
async function loadFeishuConfig(): Promise<FeishuBotConfig> {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const cfgPath = join(home, 'integrations', 'dsh-feishu', 'config.json')
  const raw = await readFile(cfgPath, 'utf8')
  const cfg = JSON.parse(raw) as { bots?: FeishuBotConfig[] }
  const bot = cfg.bots?.[0]
  if (bot === undefined) throw new Error('feishu bot not configured')
  return bot
}

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
