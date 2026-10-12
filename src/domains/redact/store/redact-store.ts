/**
 * 脱敏域持久化：映射表（按 scope 一文件）/ 自定义词条 / 配置。
 *
 * 写路径复用 JsonFileStore（单写队列 + 磁盘锁 + 原子 rename）；映射表写入后
 * 补一次 0600 权限——它含原文，是本地机密级数据。
 */
import { chmod, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { JsonFileStore, assertSafePathSegment } from '../../task/store/file-store.ts'
import { nowIso } from '../../task/store/id.ts'
import type { EntityKind, RedactMode } from '../engine/types.ts'
import { inferKind } from '../lexicon-source.ts'
import type { CustomTermsDoc, MappingDoc, MappingEntity, RedactConfigDoc, TermEntry } from './types.ts'

export interface TermInput {
  value: string
  kind?: EntityKind
  note?: string
}

export interface RedactStore {
  readConfig(): Promise<RedactConfigDoc>
  saveConfig(patch: Partial<Pick<RedactConfigDoc, 'maskAmounts' | 'heuristic' | 'crossScope'>>): Promise<RedactConfigDoc>
  listMappingScopes(): Promise<string[]>
  readMapping(scope: string): Promise<MappingDoc | undefined>
  writeMapping(input: {
    scope: string
    mode: RedactMode
    restorable: boolean
    /** 本次新增实体（与既有合并；既有假名绝不覆盖）。 */
    entities: Record<string, MappingEntity>
  }): Promise<MappingDoc>
  /** 词条两段读取：全局词条 + 该 scope 的个案词条（互不混用）。 */
  listTerms(scope?: string): Promise<{ global: TermEntry[]; caseTerms: TermEntry[] }>
  addTerms(scope: string, terms: readonly TermInput[]): Promise<TermEntry[]>
  removeTerms(scope: string, values: readonly string[]): Promise<{ removed: number }>
}

/** scope 合法性（防路径穿越）。 */
export function assertScope(scope: string): string {
  const value = scope.trim() === '' ? 'global' : scope.trim()
  assertSafePathSegment(value, 'scope')
  return value
}

function emptyMapping(scope: string): MappingDoc {
  return {
    version: '1.0', scope, mode: 'reversible', restorable: true,
    entities: {}, createdAt: '',
  }
}

export function createRedactStore(dataDir: string, ctx?: Context): RedactStore {
  const configStore = new JsonFileStore<RedactConfigDoc>(
    join(dataDir, 'redact-config.json'),
    () => ({ version: '1.0', maskAmounts: false, heuristic: true, crossScope: false }),
    ctx,
  )
  const termsStore = new JsonFileStore<CustomTermsDoc>(
    join(dataDir, 'custom-terms.json'),
    () => ({ version: '1.0', global: [], byCase: {} }),
    ctx,
  )
  const mappingFile = (scope: string): string => join(dataDir, 'mappings', `${assertScope(scope)}.json`)
  const mappingStore = (scope: string): JsonFileStore<MappingDoc> =>
    new JsonFileStore<MappingDoc>(mappingFile(scope), () => emptyMapping(scope), ctx)

  return {
    async readConfig() {
      return await configStore.read()
    },
    async saveConfig(patch) {
      return await configStore.mutate((doc) => ({
        ...doc,
        ...(patch.maskAmounts === undefined ? {} : { maskAmounts: patch.maskAmounts }),
        ...(patch.heuristic === undefined ? {} : { heuristic: patch.heuristic }),
        ...(patch.crossScope === undefined ? {} : { crossScope: patch.crossScope }),
        lastUpdated: nowIso(),
      }), '', undefined, 'redact-config')
    },

    async listMappingScopes() {
      try {
        const files = await readdir(join(dataDir, 'mappings'))
        return files.filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -'.json'.length)).sort()
      } catch {
        return []
      }
    },

    async readMapping(scope) {
      try {
        const raw = await readFile(mappingFile(scope), 'utf8')
        return JSON.parse(raw) as MappingDoc
      } catch {
        return undefined
      }
    },

    async writeMapping(input) {
      const scope = assertScope(input.scope)
      const doc = await mappingStore(scope).mutate((prev) => {
        const created = prev.createdAt === '' ? nowIso() : prev.createdAt
        const entities: Record<string, MappingEntity> = { ...prev.entities }
        for (const [value, entity] of Object.entries(input.entities)) {
          if (entities[value] === undefined) entities[value] = entity
        }
        const mode: RedactMode = prev.mode === 'masked' ? 'masked' : input.mode
        return {
          version: '1.0', scope, mode,
          // 单调收缩：任一次 masked 之后永久不可还原。
          restorable: prev.restorable && input.restorable,
          entities,
          createdAt: created,
          lastUpdated: nowIso(),
        }
      }, '', undefined, 'redact-mapping')
      try { await chmod(mappingFile(scope), 0o600) } catch { /* 权限设置失败不阻断脱敏 */ }
      return doc
    },

    async listTerms(scope) {
      const doc = await termsStore.read()
      const key = scope === undefined ? '' : scope.trim()
      const caseTerms = key === '' || key === 'global' ? [] : (doc.byCase[assertScope(key)] ?? [])
      return { global: doc.global, caseTerms }
    },

    async addTerms(scope, terms) {
      const key = scope.trim() === '' ? 'global' : assertScope(scope)
      let added: TermEntry[] = []
      await termsStore.mutate((doc) => {
        const list = key === 'global' ? doc.global : (doc.byCase[key] ?? [])
        const seen = new Set(list.map((item) => item.value))
        for (const term of terms) {
          const value = term.value.trim()
          if (value === '' || seen.has(value)) continue
          const entry: TermEntry = {
            value,
            kind: term.kind ?? inferKind(value),
            ...(term.note === undefined || term.note === '' ? {} : { note: term.note }),
            createdAt: nowIso(),
          }
          list.push(entry)
          seen.add(value)
          added.push(entry)
        }
        if (key === 'global') doc.global = list
        else doc.byCase[key] = list
        doc.lastUpdated = nowIso()
        return doc
      }, '', undefined, 'redact-terms-add')
      return added
    },

    async removeTerms(scope, values) {
      const key = scope.trim() === '' ? 'global' : assertScope(scope)
      const targets = new Set(values.map((value) => value.trim()))
      let removed = 0
      await termsStore.mutate((doc) => {
        const list = key === 'global' ? doc.global : doc.byCase[key] ?? []
        const kept = list.filter((item) => {
          if (!targets.has(item.value)) return true
          removed += 1
          return false
        })
        if (key === 'global') doc.global = kept
        else doc.byCase[key] = kept
        doc.lastUpdated = nowIso()
        return doc
      }, '', undefined, 'redact-terms-remove')
      return { removed }
    },
  }
}
