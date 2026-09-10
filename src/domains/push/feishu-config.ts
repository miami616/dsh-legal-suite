/**
 * Feishu credential config for the push domain — fully self-contained.
 *
 * The deadline reminder sends Feishu cards via the direct Feishu open API.
 * Its credentials (appId / appSecret / owner openId) are configured HERE, in
 * the「期限提醒」settings block — no dsh-im dependency. They are persisted to
 * the same files feishu_push.py reads:
 *   - $DSH_HOME/integrations/dsh-feishu/config.json  ({ bots: [...] })
 *   - $DSH_HOME/.credentials.yaml                    (refs: { <secretRef>: secret })
 *
 * The secret is write-only: the API never returns it to the browser.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'

/** 固定 secretRef（写入 .credentials.yaml 的 refs 键）。 */
export const FEISHU_SECRET_REF = 'DSH_FEISHU_APP_SECRET'

/** Feishu bot config document (config.json). */
export interface FeishuBotConfig {
  appId: string
  secretRef: string
  ownerOpenIds: string[]
}

/** Resolve $DSH_HOME (env or ~/.dsh). */
function dshHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

/** config.json path. */
export function feishuConfigPath(): string {
  return join(dshHome(), 'integrations', 'dsh-feishu', 'config.json')
}

/** .credentials.yaml path. */
export function credentialsPath(): string {
  return join(dshHome(), '.credentials.yaml')
}

/** Read the feishu bot config (first bot). Throws when missing/invalid. */
export async function loadFeishuConfig(): Promise<FeishuBotConfig> {
  const raw = await readFile(feishuConfigPath(), 'utf8')
  const cfg = JSON.parse(raw) as { bots?: FeishuBotConfig[] }
  const bot = cfg.bots?.[0]
  if (bot === undefined) throw new Error('feishu bot not configured')
  return bot
}

/** Read the secret for a ref from .credentials.yaml (YAML refs or fallback regex). */
export async function loadSecret(ref: string): Promise<string> {
  const raw = await readFile(credentialsPath(), 'utf8')
  try {
    const yaml = await import('js-yaml')
    const d = yaml.load(raw) as { refs?: Record<string, string> } | null
    const val = d?.refs?.[ref]
    if (val) return val
  } catch { /* fall through */ }
  const m = new RegExp(`^\\s{2}${ref}:\\s*(.+?)\\s*$`, 'm').exec(raw)
  if (m !== null) return m[1]
  const env = process.env[ref]
  if (env) return env
  throw new Error(`feishu secret not found: ${ref}`)
}

/** 当前是否已配置飞书凭据（config.json 存在且含有效 bot）。 */
export async function isFeishuConfigured(): Promise<boolean> {
  try {
    await loadFeishuConfig()
    return true
  } catch {
    return false
  }
}

/**
 * 保存飞书凭据（appId / appSecret / 接收人 openId）到本地文件。
 * 幂等：config.json 的 bots 数组只保留一个 bot（本配置）；.credentials.yaml
 * 保留既有 refs，仅新增/更新 FEISHU_SECRET_REF。
 */
export async function saveFeishuConfig(appId: string, appSecret: string, ownerOpenId: string): Promise<void> {
  const appIdTrim = appId.trim()
  const secretTrim = appSecret.trim()
  const ownerTrim = ownerOpenId.trim()
  if (appIdTrim === '' || secretTrim === '' || ownerTrim === '') {
    throw new Error('appId / appSecret / 接收人 openId 均不能为空')
  }

  // 1. config.json
  const cfgPath = feishuConfigPath()
  await mkdir(dirname(cfgPath), { recursive: true })
  const bot: FeishuBotConfig = { appId: appIdTrim, secretRef: FEISHU_SECRET_REF, ownerOpenIds: [ownerTrim] }
  await writeFile(cfgPath, JSON.stringify({ bots: [bot] }, null, 2), 'utf8')

  // 2. .credentials.yaml（保留既有 refs，更新/新增本 ref）
  const credsPath = credentialsPath()
  let raw = ''
  try {
    raw = await readFile(credsPath, 'utf8')
  } catch { /* 文件不存在则新建 */ }
  let refs: Record<string, string> = {}
  try {
    const yaml = await import('js-yaml')
    const d = yaml.load(raw) as { refs?: Record<string, string> } | null
    if (d !== null && typeof d === 'object') refs = { ...(d.refs ?? {}) }
  } catch { /* 解析失败则按空处理 */ }
  refs[FEISHU_SECRET_REF] = secretTrim
  const next = `refs:\n${Object.entries(refs)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n')}\n`
  await writeFile(credsPath, next, 'utf8')
}
