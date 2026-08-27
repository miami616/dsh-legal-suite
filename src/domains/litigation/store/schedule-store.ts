/**
 * Schedule store: the schedules.json document (a flat item list) merged from
 * timeline deadlines and task deadlines.
 *
 * Business rule preserved from AgentLex: timeline events with a date merge
 * into the calendar by (caseId, date); task deadlines enter the calendar too.
 * This store owns the canonical schedules.json — the merge is computed on
 * read by the deadlines route rather than duplicated on write.
 */

import type { Context } from '@deepseek-ai/cordis'
import { JsonFileStore, clone } from './file-store.ts'
import { nowIso, scheduleId } from './id.ts'
import type { ScheduleItem, ScheduleRegistry } from './types.ts'

export type { ScheduleItem, ScheduleRegistry }

/** Default schedule document (empty, v1.0). */
function scheduleRegistryDefault(): ScheduleRegistry {
  return { registryVersion: '1.0', items: [] }
}

/** The schedule store surface. */
export interface ScheduleStore {
  /** All schedule items (optionally filtered by case). */
  listItems(caseId?: string): Promise<ScheduleItem[]>
  /** Create or update an item (upsert by id). */
  upsertItem(item: Partial<ScheduleItem>): Promise<ScheduleItem>
  /** Delete an item. */
  deleteItem(itemId: string): Promise<{ deleted: boolean }>
  /** Toggle done. */
  toggleItem(itemId: string): Promise<ScheduleItem>
}

/** Create the schedule store over a data directory. */
export function createScheduleStore(dataDir: string, ctx?: Context): ScheduleStore {
  const store = new JsonFileStore<ScheduleRegistry>(
    `${dataDir}/schedules.json`,
    scheduleRegistryDefault,
    ctx,
  )

  return {
    async listItems(caseId?: string): Promise<ScheduleItem[]> {
      const reg = await store.read()
      const items = caseId === undefined ? reg.items : reg.items.filter((i) => i.caseId === caseId)
      return clone(items)
    },

    async upsertItem(item: Partial<ScheduleItem>): Promise<ScheduleItem> {
      const now = nowIso()
      let result: ScheduleItem | undefined
      await store.mutate((reg) => {
        const next = clone(reg)
        const index = item.id === undefined || item.id === '' ? -1 : next.items.findIndex((i) => i.id === item.id)
        if (index >= 0) {
          const merged = { ...next.items[index]!, ...clone(item), updatedAt: now }
          next.items[index] = merged
          result = clone(merged)
        } else {
          const created: ScheduleItem = {
            id: item.id !== undefined && item.id !== '' ? String(item.id) : scheduleId(),
            caseId: item.caseId === undefined ? undefined : String(item.caseId),
            title: String(item.title ?? '日程'),
            date: String(item.date ?? ''),
            time: item.time === undefined ? undefined : String(item.time),
            kind: item.kind === undefined ? undefined : String(item.kind),
            done: item.done === undefined ? false : Boolean(item.done),
            createdAt: now,
            updatedAt: now,
          }
          next.items.push(created)
          result = clone(created)
        }
        next.lastUpdated = now
        return next
      }, 'schedules', item.caseId === undefined ? undefined : String(item.caseId), 'upsert')
      return result!
    },

    async deleteItem(id: string): Promise<{ deleted: boolean }> {
      let deleted = false
      await store.mutate((reg) => {
        const index = reg.items.findIndex((i) => i.id === id)
        if (index < 0) return reg
        const next = clone(reg)
        next.items.splice(index, 1)
        next.lastUpdated = nowIso()
        deleted = true
        return next
      }, 'schedules', undefined, 'delete')
      return { deleted }
    },

    async toggleItem(id: string): Promise<ScheduleItem> {
      let result: ScheduleItem | undefined
      await store.mutate((reg) => {
        const item = reg.items.find((i) => i.id === id)
        if (item === undefined) throw new Error(`schedule item not found: ${id}`)
        const next = clone(reg)
        const target = next.items.find((i) => i.id === id)!
        target.done = !target.done
        target.updatedAt = nowIso()
        next.lastUpdated = target.updatedAt
        result = clone(target)
        return next
      }, 'schedules', result?.caseId, 'toggle')
      return result!
    },
  }
}
