/**
 * 巡检台账（0.2.12）—— 去重推送 + 确认留档。
 *
 * 巡检每天跑，但**绝不能每天把同一件事重推一遍**（那是骚扰，不是提醒）。台账记两样：
 *   - `pushed`：已推送过的 finding 指纹（`caseId|ruleId|证据`）。**只有新出现或证据
 *     变化才重推**——修好了（finding 消失）就把指纹清掉，将来复发能再次提醒。
 *   - `muted`：已确认无需处理的（caseId + ruleId），留 reason 备查。
 *     典型：二审独立建档后，一审案的上诉期由二审案跟踪。
 *
 * 存储：`<dataDir>/patrol-ledger.json`（$DSH_HOME/agentlex/litigation/）。
 */
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { JsonFileStore, clone } from './file-store.ts'
import { nowIso } from './id.ts'

export interface PatrolMute {
  caseId: string
  ruleId: string
  reason?: string
  at: string
}

export interface PatrolLedgerDoc {
  registryVersion: string
  lastUpdated?: string
  pushed: Array<{ fingerprint: string; at: string }>
  muted: PatrolMute[]
}

export interface PatrolLedgerStore {
  read(): Promise<PatrolLedgerDoc>
  /** 是否已确认无需处理。 */
  isMuted(caseId: string, ruleId: string): Promise<boolean>
  mute(caseId: string, ruleId: string, reason?: string): Promise<PatrolMute>
  unmute(caseId: string, ruleId: string): Promise<{ removed: boolean }>
  listMuted(): Promise<PatrolMute[]>
  /**
   * 从给定指纹里挑出**没推送过**的。
   * @param valid - 本轮全部指纹；台账会顺手清掉已不存在的历史指纹（修好后复发能再报）。
   */
  filterNew(fingerprints: string[], valid: string[]): Promise<string[]>
  markPushed(fingerprints: string[]): Promise<void>
  /** 清空推送台账（调试/重置用）。 */
  resetPushed(): Promise<void>
}

function docDefault(): PatrolLedgerDoc {
  return { registryVersion: '1.0', pushed: [], muted: [] }
}

export function createPatrolLedgerStore(dataDir: string, ctx?: Context): PatrolLedgerStore {
  const store = new JsonFileStore<PatrolLedgerDoc>(join(dataDir, 'patrol-ledger.json'), docDefault, ctx)

  const normalize = (doc: PatrolLedgerDoc): PatrolLedgerDoc => ({
    registryVersion: doc.registryVersion ?? '1.0',
    lastUpdated: doc.lastUpdated,
    pushed: Array.isArray(doc.pushed) ? doc.pushed : [],
    muted: Array.isArray(doc.muted) ? doc.muted : [],
  })

  return {
    async read(): Promise<PatrolLedgerDoc> {
      return clone(normalize(await store.read()))
    },

    async isMuted(caseId, ruleId): Promise<boolean> {
      const doc = normalize(await store.read())
      return doc.muted.some((m) => m.caseId === caseId && m.ruleId === ruleId)
    },

    async mute(caseId, ruleId, reason): Promise<PatrolMute> {
      const row: PatrolMute = { caseId, ruleId, reason, at: nowIso() }
      await store.mutate((raw) => {
        const doc = normalize(raw)
        const next = clone(doc)
        const idx = next.muted.findIndex((m) => m.caseId === caseId && m.ruleId === ruleId)
        if (idx >= 0) next.muted[idx] = row
        else next.muted.push(row)
        next.lastUpdated = row.at
        return next
      }, 'cases', caseId, 'patrol-mute')
      return row
    },

    async unmute(caseId, ruleId): Promise<{ removed: boolean }> {
      let removed = false
      await store.mutate((raw) => {
        const doc = normalize(raw)
        if (!doc.muted.some((m) => m.caseId === caseId && m.ruleId === ruleId)) return raw
        const next = clone(doc)
        next.muted = next.muted.filter((m) => !(m.caseId === caseId && m.ruleId === ruleId))
        next.lastUpdated = nowIso()
        removed = true
        return next
      }, 'cases', caseId, 'patrol-unmute')
      return { removed }
    },

    async listMuted(): Promise<PatrolMute[]> {
      const doc = normalize(await store.read())
      return clone(doc.muted)
    },

    async filterNew(fingerprints, valid): Promise<string[]> {
      const doc = normalize(await store.read())
      const pushed = new Set(doc.pushed.map((p) => p.fingerprint))
      const validSet = new Set(valid)
      // 顺手清理：已不存在的指纹从台账移除（问题修好 → 将来复发能再报一次）。
      const stale = doc.pushed.filter((p) => !validSet.has(p.fingerprint))
      if (stale.length > 0) {
        await store.mutate((raw) => {
          const d = normalize(raw)
          const next = clone(d)
          next.pushed = next.pushed.filter((p) => validSet.has(p.fingerprint))
          next.lastUpdated = nowIso()
          return next
        }, '', undefined, 'patrol-prune')
      }
      return fingerprints.filter((f) => !pushed.has(f))
    },

    async markPushed(fingerprints): Promise<void> {
      if (fingerprints.length === 0) return
      const now = nowIso()
      await store.mutate((raw) => {
        const doc = normalize(raw)
        const next = clone(doc)
        const seen = new Set(next.pushed.map((p) => p.fingerprint))
        for (const fingerprint of fingerprints) {
          if (seen.has(fingerprint)) continue
          next.pushed.push({ fingerprint, at: now })
          seen.add(fingerprint)
        }
        next.lastUpdated = now
        return next
      }, '', undefined, 'patrol-mark-pushed')
    },

    async resetPushed(): Promise<void> {
      await store.mutate((raw) => {
        const next = clone(normalize(raw))
        next.pushed = []
        next.lastUpdated = nowIso()
        return next
      }, '', undefined, 'patrol-reset-pushed')
    },
  }
}
