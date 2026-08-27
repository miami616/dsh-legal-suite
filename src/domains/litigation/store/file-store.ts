/**
 * Single-writer JSON file store (AgentLex Rust core "Pattern 5" semantics).
 *
 * Concurrency model: a process-local queue serializes all mutations (one
 * writer per store), and each write is protected by an on-disk lock — an
 * atomic `mkdir <file>.lock` — so two dsh host processes (or a stale crash)
 * cannot interleave. Lock acquisition retries with backoff and recovers a
 * stale lock (older than STALE_LOCK_MS) by removal.
 *
 * Write protocol: read current doc → apply mutation in memory → write a temp
 * file in the same directory → atomic rename over the target → release lock.
 * The rename is atomic on the same filesystem, so readers never observe a
 * half-written file.
 *
 * Every mutation broadcasts a change so clients (and the browser half) can
 * refresh: the store emits `agentlex:registry-changed` with the affected
 * domain on the owning cordis ctx.
 */

import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'

/** Locks older than this are considered abandoned and removed. */
const STALE_LOCK_MS = 30_000
/** Lock acquisition retry: attempts x interval. */
const LOCK_RETRIES = 40
const LOCK_RETRY_MS = 250

/** The change event name emitted on the host ctx after a successful write. */
export const REGISTRY_CHANGED_EVENT = 'agentlex:registry-changed'

/** Which domain a change touched (clients refresh the relevant surface). */
export type ChangeDomain =
  | 'cases' | 'case' | 'tasks' | 'timeline' | 'schedules' | 'import'

export interface RegistryChangedPayload {
  domain: ChangeDomain
  caseId?: string
  reason?: string
}

/** Reject path traversal in any id used to build a file path. */
export function assertSafePathSegment(segment: string, label = 'id'): void {
  if (segment.length === 0 || segment === '.' || segment === '..' || segment.includes('/') || segment.includes('\\') || segment.includes(sep)) {
    throw new Error(`invalid ${label}: ${JSON.stringify(segment)}`)
  }
}

/**
 * A document-oriented JSON store backed by one file.
 * @template T - the document shape (must be a JSON-serializable object).
 */
export class JsonFileStore<T extends object> {
  readonly file: string
  private queue: Promise<void> = Promise.resolve()
  private readonly ctx?: Context

  constructor(file: string, defaults: () => T, ctx?: Context) {
    this.file = resolve(file)
    this.defaults = defaults
    this.ctx = ctx
  }

  private readonly defaults: () => T

  /** Chain a mutation behind the process-local queue (single writer). */
  private enqueue<U>(task: () => Promise<U>): Promise<U> {
    const run = this.queue.then(task, task)
    this.queue = run.then(() => undefined, () => undefined)
    return run
  }

  /** Read the current document (no lock: reads are single-threaded here). */
  async read(): Promise<T> {
    return this.enqueue(async () => {
      try {
        const raw = await readFile(this.file, 'utf8')
        return JSON.parse(raw) as T
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return this.defaults()
        throw error
      }
    })
  }

  /**
   * Mutate the document under the on-disk lock and persist it.
   * @param mutate - apply the change to a shallow copy; return the copy.
   * @param domain - change domain for the broadcast ('' suppresses).
   * @param caseId - optional case id for the broadcast payload.
   */
  async mutate(mutate: (doc: T) => T, domain: ChangeDomain | '', caseId?: string, reason?: string): Promise<T> {
    return this.enqueue(async () => {
      await mkdir(dirname(this.file), { recursive: true })
      await this.acquireLock()
      try {
        let doc: T
        try {
          const raw = await readFile(this.file, 'utf8')
          doc = JSON.parse(raw) as T
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') doc = this.defaults()
          else throw error
        }
        const next = mutate(doc)
        const serialized = JSON.stringify(next, null, 2)
        const tmp = `${this.file}.tmp-${process.pid}-${Date.now().toString(36)}`
        await writeFile(tmp, serialized, 'utf8')
        await rename(tmp, this.file)
        if (domain !== '' && this.ctx !== undefined) {
          // Untyped runtime fan-out (cordis `events.dispatch`), the same path
          // dsh-settings uses for custom events (settings/document-updated).
          // dispatch() only RESOLVES the listeners — the callers must run them
          // (a bare dispatch() call silently dropped every change broadcast).
          const payload: RegistryChangedPayload = { domain, caseId, reason }
          for (const listener of this.ctx.events.dispatch('emit', [REGISTRY_CHANGED_EVENT, payload])) {
            try {
              const returned = listener(payload)
              if (returned != null && typeof returned.then === 'function') {
                Promise.resolve(returned).then(void 0, (error: unknown) => console.warn('[file-store] change listener failed:', error))
              }
            } catch (error) {
              console.warn('[file-store] change listener failed:', error)
            }
          }
        }
        return next
      } finally {
        await this.releaseLock()
      }
    })
  }

  /** Acquire the on-disk lock (atomic mkdir), recovering stale locks. */
  private async acquireLock(): Promise<void> {
    const lock = this.lockPath()
    for (let attempt = 0; attempt < LOCK_RETRIES; attempt++) {
      try {
        await mkdir(lock)
        return
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'EEXIST') throw error
        // Lock held — recover if stale.
        try {
          const info = await stat(lock)
          if (Date.now() - info.mtimeMs > STALE_LOCK_MS) {
            await rm(lock, { recursive: true, force: true })
            continue
          }
        } catch (statError) {
          if ((statError as NodeJS.ErrnoException).code === 'ENOENT') continue
        }
        if (attempt === LOCK_RETRIES - 1) {
          throw new Error(`file store: lock held too long on ${this.file}`)
        }
        await new Promise((r) => setTimeout(r, LOCK_RETRY_MS))
      }
    }
  }

  private async releaseLock(): Promise<void> {
    await rm(this.lockPath(), { recursive: true, force: true })
  }

  private lockPath(): string {
    return join(dirname(this.file), `${this.file.split(sep).pop()}.lock`)
  }
}

/** Deep-clone helper (structuredClone is fine for JSON data). */
export function clone<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T
}
