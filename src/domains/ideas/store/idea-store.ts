/**
 * Ideas store — single-writer JSON file persistence.
 *
 * 复用与 task/litigation 相同的单写者语义（进程内队列串行化 + on-disk 锁 +
 * 原子 rename），但独立广播 `ideas` 变更事件（client 经 SSE 转发到浏览器）。
 */

import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { ideaId, nowIso } from './id.ts'
import type { IdeasRegistry, IdeaItem, IdeaStatus } from './types.ts'

/** 想法域变更事件名（client 经 /api/agentlex-ideas/events-stream 转发）。 */
export const IDEAS_CHANGED_EVENT = 'agentlex:ideas-changed'

/** Locks older than this are considered abandoned and removed. */
const STALE_LOCK_MS = 30_000
const LOCK_RETRIES = 40
const LOCK_RETRY_MS = 250

/** Reject path traversal in any id used to build a file path. */
function assertSafePathSegment(segment: string, label = 'id'): void {
  if (segment.length === 0 || segment === '.' || segment === '..' || segment.includes('/') || segment.includes('\\') || segment.includes(sep)) {
    throw new Error(`invalid ${label}: ${JSON.stringify(segment)}`)
  }
}

/** Validate a status value, falling back to 'active'. */
function normalizeStatus(value: unknown): IdeaStatus {
  if (value === 'done' || value === 'archived' || value === 'active') return value
  return 'active'
}

export interface IdeaStore {
  readRegistry(): Promise<IdeasRegistry>
  listIdeas(): Promise<IdeaItem[]>
  getIdea(id: string): Promise<IdeaItem | undefined>
  /** Upsert: 接受 id（更新）或无 id（创建）。status 缺省 active。 */
  upsertIdea(input: Record<string, unknown>): Promise<IdeaItem>
  /** 仅更新状态（active/done/archived）。 */
  setStatus(id: string, status: IdeaStatus): Promise<IdeaItem>
  deleteIdea(id: string): Promise<{ deleted: boolean }>
}

export function createIdeaStore(dataDir: string, ctx: Context): IdeaStore {
  const file = resolve(join(dataDir, 'ideas.json'))
  const queue: Promise<void> = Promise.resolve()

  function enqueue<U>(task: () => Promise<U>): Promise<U> {
    const run = queue.then(task, task)
    return run
  }

  async function acquireLock(): Promise<void> {
    const lock = join(dirname(file), `${file.split(sep).pop()}.lock`)
    for (let attempt = 0; attempt < LOCK_RETRIES; attempt++) {
      try {
        await mkdir(lock)
        return
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'EEXIST') throw error
        try {
          const info = await stat(lock)
          if (Date.now() - info.mtimeMs > STALE_LOCK_MS) {
            await rm(lock, { recursive: true, force: true })
            continue
          }
        } catch (statError) {
          if ((statError as NodeJS.ErrnoException).code === 'ENOENT') continue
        }
        if (attempt === LOCK_RETRIES - 1) throw new Error(`ideas store: lock held too long on ${file}`)
        await new Promise((r) => setTimeout(r, LOCK_RETRY_MS))
      }
    }
  }

  async function releaseLock(): Promise<void> {
    const lock = join(dirname(file), `${file.split(sep).pop()}.lock`)
    await rm(lock, { recursive: true, force: true })
  }

  async function read(): Promise<IdeasRegistry> {
    return enqueue(async () => {
      try {
        const raw = await readFile(file, 'utf8')
        return JSON.parse(raw) as IdeasRegistry
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return { registryVersion: '1.0', ideas: {} }
        }
        throw error
      }
    })
  }

  /** Mutate under lock, persist atomically, then broadcast on the host ctx. */
  async function mutate(fn: (doc: IdeasRegistry) => IdeasRegistry, reason?: string): Promise<IdeasRegistry> {
    return enqueue(async () => {
      await mkdir(dirname(file), { recursive: true })
      await acquireLock()
      try {
        let doc: IdeasRegistry
        try {
          const raw = await readFile(file, 'utf8')
          doc = JSON.parse(raw) as IdeasRegistry
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') doc = { registryVersion: '1.0', ideas: {} }
          else throw error
        }
        const next = fn(doc)
        const serialized = JSON.stringify(next, null, 2)
        const tmp = `${file}.tmp-${process.pid}-${Date.now().toString(36)}`
        await writeFile(tmp, serialized, 'utf8')
        await rename(tmp, file)
        // Broadcast (untyped runtime fan-out, same as task file-store).
        for (const listener of ctx.events.dispatch('emit', [IDEAS_CHANGED_EVENT, { domain: 'ideas', reason }])) {
          try {
            const returned = listener({ domain: 'ideas', reason })
            if (returned != null && typeof returned.then === 'function') {
              Promise.resolve(returned).then(void 0, (error: unknown) => console.warn('[ideas] change listener failed:', error))
            }
          } catch (error) {
            console.warn('[ideas] change listener failed:', error)
          }
        }
        return next
      } finally {
        await releaseLock()
      }
    })
  }

  const s = (v: unknown): string | undefined => (v === undefined || v === null) ? undefined : String(v)

  return {
    async readRegistry() { return read() },

    async listIdeas() {
      const reg = await read()
      return Object.values(reg.ideas).sort((a, b) => {
        const at = a.updatedAt ?? a.createdAt ?? ''
        const bt = b.updatedAt ?? b.createdAt ?? ''
        return bt.localeCompare(at)
      })
    },

    async getIdea(id) {
      assertSafePathSegment(id)
      const reg = await read()
      return reg.ideas[id]
    },

    async upsertIdea(input) {
      const now = nowIso()
      const id = s(input.id) ?? ideaId()
      assertSafePathSegment(id)
      let result: IdeaItem | undefined
      await mutate((reg) => {
        const existing = reg.ideas[id] ?? { id, createdAt: now, status: 'active' as IdeaStatus }
        const next: IdeaItem = {
          ...existing,
          id,
          title: s(input.title) ?? existing.title ?? '未命名想法',
          content: s(input.content) ?? existing.content,
          caseId: s(input.caseId) ?? existing.caseId,
          caseName: s(input.caseName) ?? existing.caseName,
          tags: Array.isArray(input.tags)
            ? input.tags.map((t) => String(t)).filter(Boolean)
            : existing.tags,
          status: normalizeStatus(input.status) ?? existing.status,
          updatedAt: now,
        }
        reg.ideas[id] = next
        reg.lastUpdated = now
        result = next
        return reg
      }, 'upsert-idea')
      return result!
    },

    async setStatus(id, status) {
      assertSafePathSegment(id)
      let result: IdeaItem | undefined
      await mutate((reg) => {
        const existing = reg.ideas[id]
        if (existing === undefined) throw new Error(`idea not found: ${id}`)
        const next: IdeaItem = { ...existing, status, updatedAt: nowIso() }
        reg.ideas[id] = next
        reg.lastUpdated = next.updatedAt
        result = next
        return reg
      }, 'set-status')
      return result!
    },

    async deleteIdea(id) {
      assertSafePathSegment(id)
      await mutate((reg) => {
        if (reg.ideas[id] === undefined) throw new Error(`idea not found: ${id}`)
        delete reg.ideas[id]
        reg.lastUpdated = nowIso()
        return reg
      }, 'delete-idea')
      return { deleted: true }
    },
  }
}
