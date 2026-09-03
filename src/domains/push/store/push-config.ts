/**
 * Push domain store: push-config.json + push-ledger.json.
 *
 * - push-config.json: the user's IM push configuration (enabled, dsh-im
 *   botId/targetId, title prefix). Credentials are NOT stored here — the
 *   dsh-im plugin owns all channel credentials; this module only keeps the
 *   two opaque identifiers {botId, targetId}.
 * - push-ledger.json: dedupe ledger. Key = `caseId|date|label`; a key present
 *   means that deadline was already pushed within its reminder window, so the
 *   next tick skips it (no duplicate bombardment).
 *
 * Both ride the shared JsonFileStore (single-writer, on-disk lock, atomic
 * rename) so the host half and the command-job script can share them safely.
 */

import { JsonFileStore } from '../../litigation/store/file-store.ts'

/** Push configuration document. */
export interface PushConfig {
  /** Master switch. */
  enabled: boolean
  /** dsh-im bot call identifier (copied from the dsh-im settings page). */
  botId: string
  /** dsh-im delivery target (copied/selected from the dsh-im settings page). */
  targetId: string
  /** Delivery channel (e.g. 'feishu', 'weixin') — feishu renders a card. */
  channel?: string
  /** Optional title prefix prepended to the fixed template. */
  titlePrefix?: string
  /** Send a test message on save. */
  testOnSave?: boolean
  updatedAt?: string
}

/** Default push config (disabled, no target). */
export function pushConfigDefault(): PushConfig {
  return { enabled: false, botId: '', targetId: '' }
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
  /** Whether a deadline key was already pushed. */
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
      return ledger.entries.some((entry) => entry.key === key)
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
