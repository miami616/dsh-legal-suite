/**
 * Push domain store: push-config.json + push-ledger.json.
 *
 * - push-config.json: the user's reminder config (enabled, title prefix).
 *   Delivery is FIXED to the Feishu card channel (direct Feishu open API,
 *   same credentials as feishu_push.py) — no dsh-im dependency, no
 *   botId/targetId/channel to configure.
 * - push-ledger.json: dedupe ledger. Key = `caseId|date|label`; a key present
 *   with a pushedAt of TODAY means that deadline was already pushed in this
 *   day's run, so a second run the same day skips it. Records from previous
 *   days are treated as expired — the next day's 8:30 run re-pushes the
 *   window (today + tomorrow) fresh.
 *
 * Both ride the shared JsonFileStore (single-writer, on-disk lock, atomic
 * rename) so the host half and any manual trigger can share them safely.
 */

import { JsonFileStore } from '../../litigation/store/file-store.ts'

/** Push configuration document. */
export interface PushConfig {
  /** Master switch. */
  enabled: boolean
  /** 每日推送时间（HH:mm，默认 08:30）。 */
  pushTime?: string
  /** Optional title prefix prepended to the fixed template. */
  titlePrefix?: string
  updatedAt?: string
}

/** Default push config (disabled, 08:30). */
export function pushConfigDefault(): PushConfig {
  return { enabled: false, pushTime: '08:30' }
}

/** 解析推送时间（HH:mm）→ [时, 分]；非法值回退默认 08:30。 */
export function parsePushTime(value: string | undefined): [number, number] {
  const m = /^(\d{1,2}):(\d{2})$/.exec((value ?? '').trim())
  if (m !== null) {
    const h = Number(m[1])
    const min = Number(m[2])
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) return [h, min]
  }
  return [8, 30]
}

/** One ledger entry: a deadline key already pushed. */
export interface LedgerEntry {
  key: string
  pushedAt: string
}

/** push-ledger.json document. */
export interface PushLedger {
  registryVersion: string
  entries: LedgerEntry[]
}

/** Default ledger (empty). */
export function pushLedgerDefault(): PushLedger {
  return { registryVersion: '1.0', entries: [] }
}

/** Build the ledger key for a deadline row. */
export function ledgerKey(caseId: string, date: string, label: string): string {
  return `${caseId}|${date}|${label}`
}

/** The push store surface. */
export interface PushStore {
  readConfig(): Promise<PushConfig>
  writeConfig(config: PushConfig): Promise<PushConfig>
  /** Whether a deadline key was already pushed TODAY (yesterday's records are expired). */
  hasPushed(key: string): Promise<boolean>
  /** Record pushed keys (idempotent). */
  recordPushed(keys: string[]): Promise<void>
  /** Prune ledger entries older than `beforeMs` (keeps the file small). */
  pruneLedger(beforeMs: number): Promise<void>
}

/**
 * Create the push store over a data directory.
 * @param dataDir - where push-config.json / push-ledger.json live.
 */
export function createPushStore(dataDir: string): PushStore {
  const configStore = new JsonFileStore<PushConfig>(`${dataDir}/push-config.json`, pushConfigDefault)
  const ledgerStore = new JsonFileStore<PushLedger>(`${dataDir}/push-ledger.json`, pushLedgerDefault)

  return {
    async readConfig(): Promise<PushConfig> {
      return configStore.read()
    },
    async writeConfig(config: PushConfig): Promise<PushConfig> {
      const next = { ...config, updatedAt: new Date().toISOString() }
      await configStore.mutate(() => next, '')
      return next
    },
    async hasPushed(key: string): Promise<boolean> {
      const ledger = await ledgerStore.read()
      // 只认「今天」的记录：昨天的推送记录视为过期，次日 8:30 重新推送窗口内期限。
      const today = new Date().toISOString().slice(0, 10)
      return ledger.entries.some((entry) => entry.key === key && entry.pushedAt.slice(0, 10) === today)
    },
    async recordPushed(keys: string[]): Promise<void> {
      if (keys.length === 0) return
      await ledgerStore.mutate((ledger) => {
        const now = new Date().toISOString()
        const existing = new Set(ledger.entries.map((entry) => entry.key))
        const added: LedgerEntry[] = []
        for (const key of keys) {
          if (!existing.has(key)) {
            existing.add(key)
            added.push({ key, pushedAt: now })
          }
        }
        return { ...ledger, entries: [...ledger.entries, ...added] }
      }, '')
    },
    async pruneLedger(beforeMs: number): Promise<void> {
      await ledgerStore.mutate((ledger) => {
        const cutoff = new Date(beforeMs).toISOString()
        const kept = ledger.entries.filter((entry) => entry.pushedAt >= cutoff)
        if (kept.length === ledger.entries.length) return ledger
        return { ...ledger, entries: kept }
      }, '')
    },
  }
}
