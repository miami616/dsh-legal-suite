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
 * 取「缺失的最小可用编号」字符串，用于备忘的 `ref`（如 1、2、3…）。
 * 规则：编号从 1 开始递增，空缺号优先复用（删除中间一条后新建会补齐空缺，
 * 不因删除漂移）。`taken` 为已占用的数字号集合。
 */
export function nextMemoNumber(taken: Set<number>): string {
  let n = 1
  while (taken.has(n)) n += 1
  return String(n)
}

/** true 当 ref 是纯正整数（可作为编号）。 */
export function isNumericRef(ref: string): boolean {
  return /^\d+$/.test(ref) && String(Number(ref)) === ref
}

/**
 * 把所有备忘规范化为「数字编号 ref」（1、2、3…，稳定不复用删除后的空缺，
 * 按 createdAt 顺序分配）。返回是否发生了改动。
 *
 * 兼容迁移：早期版本的 ref 是正文 slug（如“移动端…”），这里统一重排为编号，
 * 使会话输入框 `#N` 即可引用任意一条备忘。
 */
export function normalizeNumericRefs(
  memos: Record<string, MemoItem>,
): { next: string; changed: boolean } {
  // 先把「编号唯一性」约束建立起来：收集已占用编号。
  const taken = new Set<number>()
  for (const m of Object.values(memos)) {
    if (isNumericRef(m.ref)) taken.add(Number(m.ref))
  }
  // 给所有非数字 ref 的备忘按其创建顺序分配缺失编号。
  let changed = false
  const items = Object.values(memos).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  for (const m of items) {
    if (isNumericRef(m.ref)) continue
    const num = nextMemoNumber(taken)
    m.ref = String(num)
    taken.add(Number(num))
    memos[m.id] = m
    changed = true
  }
  return { next: nextMemoNumber(taken), changed }
}

export function createMemoStore(dataDir: string, ctx: Context): MemoStore {
  const store = new JsonFileStore<MemoRegistry>(
    join(dataDir, 'memos.json'),
    () => ({ registryVersion: MEMO_REGISTRY_VERSION, memos: {} }),
    ctx,
  )
  const s = (v: unknown): string | undefined => (v === undefined || v === null) ? undefined : String(v)

  return {
    async readRegistry() {
      let reg = await store.read()
      // 规范化：确保所有备忘为数字编号 ref（兼容旧版 slug ref 迁移）。
      if (normalizeNumericRefs(reg.memos).changed) {
        reg = await store.mutate((r) => {
          normalizeNumericRefs(r.memos)
          r.lastUpdated = nowIso()
          return r
        }, 'memos', undefined, 'normalize-refs')
      }
      return reg
    },
    async listMemos() {
      const reg = await this.readRegistry()
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
        // 先规范化已有备忘的编号 ref（兼容旧 slug ref）。
        const { next } = normalizeNumericRefs(reg.memos)
        const existing = reg.memos[id]
        const rawContent = s(input.content)
        const tags = normalizeTags(input.tags)
        // 新备忘 → 取下一个编号；编辑已有 → 保留其编号。
        const ref = existing !== undefined && existing.ref !== ''
          ? existing.ref
          : next
        const nextItem: MemoItem = {
          ...(existing ?? { id, createdAt: now, ref: '', status: ('active' as MemoItem['status']) }),
          id,
          content: rawContent !== undefined ? rawContent : existing?.content ?? '',
          tags: input.tags !== undefined ? tags : existing?.tags ?? [],
          ref,
          status: (s(input.status) as MemoItem['status']) ?? existing?.status ?? 'active',
          updatedAt: now,
        }
        reg.memos[id] = nextItem
        reg.lastUpdated = now
        result = nextItem
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
