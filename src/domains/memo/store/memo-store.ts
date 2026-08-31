import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { JsonFileStore } from '../../task/store/file-store.ts'
import { childId, nowIso } from '../../task/store/id.ts'
import type { MemoItem, MemoRegistry } from './types.ts'
import { MEMO_REGISTRY_VERSION } from './types.ts'

export interface MemoStore {
  readRegistry(): Promise<MemoRegistry>
  listMemos(): Promise<MemoItem[]>
  getMemo(id: string): Promise<MemoItem | undefined>
  upsertMemo(input: Record<string, unknown>): Promise<MemoItem>
  archiveMemo(id: string, archived: boolean): Promise<MemoItem>
  setStatus(id: string, status: MemoItem['status']): Promise<MemoItem>
  deleteMemo(id: string): Promise<{ deleted: boolean }>
}

/**
 * 规范化标签数组：trim → 去空 → lower → 去重 → 保序。
 */
export function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of tags) {
    if (typeof raw !== 'string') continue
    const t = raw.trim().toLowerCase()
    if (t === '' || seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

/**
 * 从正文生成引用码：优先匹配 `#[A-Za-z0-9_-]+` 中用户主动写的 token；
 * 否则取正文前几个中文字/词作 slug；为空则用 id 尾段。唯一性由调用方保证。
 */
export function deriveRef(content: string, tags: string[], id: string): string {
  const explicit = /#([A-Za-z0-9_-]+)/.exec(content)
  if (explicit !== null && explicit[1] !== '') return explicit[1].toLowerCase()
  const base = content.trim().replace(/\s+/g, ' ').slice(0, 16)
  if (base !== '') return base.toLowerCase()
  return id.slice(-8)
}

export function createMemoStore(dataDir: string, ctx: Context): MemoStore {
  const store = new JsonFileStore<MemoRegistry>(
    join(dataDir, 'memos.json'),
    () => ({ registryVersion: MEMO_REGISTRY_VERSION, memos: {} }),
    ctx,
  )
  const s = (v: unknown): string | undefined => (v === undefined || v === null) ? undefined : String(v)

  return {
    async readRegistry() { return store.read() },
    async listMemos() {
      const reg = await store.read()
      return Object.values(reg.memos)
    },
    async getMemo(id) {
      const reg = await store.read()
      return reg.memos[id]
    },
    async upsertMemo(input) {
      const now = nowIso()
      const id = s(input.id) ?? childId('memo')
      let result: MemoItem | undefined
      await store.mutate((reg) => {
        const existing = reg.memos[id] ?? { id, createdAt: now, ref: '', status: ('active' as MemoItem['status']) }
        const rawContent = s(input.content)
        const tags = normalizeTags(input.tags)
        const explicitRef = s(input.ref)?.toLowerCase()
        const derivedRef = deriveRef(rawContent ?? '', tags, id)
        // 新备忘（无 ref）→ 从正文推导引用码；已有 ref 保留（除非显式更新）。
        let ref = explicitRef ?? (existing.ref !== '' ? existing.ref : derivedRef)
        // 引用码唯一性：与其他备忘撞号时追加短序号。
        if (explicitRef === undefined) {
          const others = Object.values(reg.memos).filter((m) => m.id !== id && m.ref === ref)
          if (others.length > 0) {
            ref = `${ref}-${others.length + 1}`
            // 极端：再撞则用 id 尾段。
            if (Object.values(reg.memos).some((m) => m.id !== id && m.ref === ref)) ref = id.slice(-8)
          }
        }
        const next: MemoItem = {
          ...existing,
          id,
          content: rawContent !== undefined ? rawContent : existing.content ?? '',
          tags: input.tags !== undefined ? tags : existing.tags ?? [],
          ref,
          status: (s(input.status) as MemoItem['status']) ?? existing.status ?? 'active',
          updatedAt: now,
        }
        reg.memos[id] = next
        reg.lastUpdated = now
        result = next
        return reg
      }, 'memos', undefined, 'upsert-memo')
      return result!
    },
    async archiveMemo(id, archived) {
      const status: MemoItem['status'] = archived ? 'archived' : 'active'
      let result: MemoItem | undefined
      await store.mutate((reg) => {
        const existing = reg.memos[id]
        if (existing === undefined) throw new Error(`memo not found: ${id}`)
        const next: MemoItem = { ...existing, status, updatedAt: nowIso() }
        reg.memos[id] = next
        reg.lastUpdated = next.updatedAt
        result = next
        return reg
      }, 'memos', undefined, 'toggle-memo-status')
      return result!
    },
    async setStatus(id, status) {
      return this.archiveMemo(id, status === 'archived')
    },
    async deleteMemo(id) {
      await store.mutate((reg) => {
        if (reg.memos[id] === undefined) throw new Error(`memo not found: ${id}`)
        delete reg.memos[id]
        reg.lastUpdated = nowIso()
        return reg
      }, 'memos', undefined, 'delete-memo')
      return { deleted: true }
    },
  }
}
