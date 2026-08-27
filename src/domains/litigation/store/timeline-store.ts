/**
 * Timeline store: the case-timeline.json document (a flat event list).
 * Single-writer via JsonFileStore.
 *
 * Business rules preserved from AgentLex:
 *   - events merge to the calendar by (caseId, date) when a date is present.
 *   - remindRules: [{enabled, minutes, type}] with minutes in 7d/12h/30m
 *     granularity (10080 / 720 / 30).
 */

import type { Context } from '@deepseek-ai/cordis'
import { JsonFileStore, clone } from './file-store.ts'
import { eventId, nowIso } from './id.ts'
import type { TimelineEvent, TimelineRegistry } from './types.ts'

export type { TimelineEvent, TimelineRegistry }

/** Default timeline document (empty, v1.0). */
function timelineRegistryDefault(): TimelineRegistry {
  return { registryVersion: '1.0', events: [] }
}

/** The timeline store surface. */
export interface TimelineStore {
  /** All timeline events (optionally filtered by case). */
  listEvents(caseId?: string): Promise<TimelineEvent[]>
  /** One event by id. */
  readEvent(eventIdToRead: string): Promise<TimelineEvent | undefined>
  /** Create or update an event (upsert by id; create when id absent). */
  upsertEvent(event: Partial<TimelineEvent>): Promise<TimelineEvent>
  /** Delete an event by id. */
  deleteEvent(eventIdToDelete: string): Promise<{ deleted: boolean }>
  /** Toggle an event's done status. */
  toggleEvent(eventIdToToggle: string): Promise<TimelineEvent>
}

/** Parse "7d"/"12h"/"30m" or a bare number-of-days into minutes. */
export function parseReminderMinutes(value: string | number): number {
  if (typeof value === 'number') return value
  const match = /^(\d+)(d|h|m)?$/.exec(String(value).trim())
  if (match === null) throw new Error(`invalid reminder: ${value}`)
  const n = Number(match[1])
  switch (match[2]) {
    case 'h': return n * 60
    case 'm': return n
    case 'd':
    default: return n * 24 * 60
  }
}

/**
 * Create the timeline store over a data directory.
 * @param dataDir - where case-timeline.json lives.
 * @param ctx - host ctx for change broadcasts.
 */
export function createTimelineStore(dataDir: string, ctx?: Context): TimelineStore {
  const store = new JsonFileStore<TimelineRegistry>(
    `${dataDir}/case-timeline.json`,
    timelineRegistryDefault,
    ctx,
  )

  return {
    async listEvents(caseId?: string): Promise<TimelineEvent[]> {
      const reg = await store.read()
      const events = caseId === undefined ? reg.events : reg.events.filter((e) => e.caseId === caseId)
      return clone(events)
    },

    async readEvent(id: string): Promise<TimelineEvent | undefined> {
      const reg = await store.read()
      const event = reg.events.find((e) => e.id === id)
      return event === undefined ? undefined : clone(event)
    },

    async upsertEvent(event: Partial<TimelineEvent>): Promise<TimelineEvent> {
      const now = nowIso()
      let result: TimelineEvent | undefined
      await store.mutate((reg) => {
        const next = clone(reg)
        const index = event.id === undefined || event.id === '' ? -1 : next.events.findIndex((e) => e.id === event.id)
        if (index >= 0) {
          const merged = { ...next.events[index]!, ...clone(event), updatedAt: now }
          next.events[index] = merged
          result = clone(merged)
        } else {
          const created: TimelineEvent = {
            // Respect an explicit id (AgentLex import idempotency); otherwise assign.
            id: event.id !== undefined && event.id !== '' ? String(event.id) : eventId(),
            caseId: String(event.caseId ?? ''),
            caseName: event.caseName,
            type: String(event.type ?? 'case_event'),
            title: String(event.title ?? '新事件'),
            detail: event.detail === undefined ? undefined : String(event.detail),
            date: String(event.date ?? ''),
            status: (event.status as TimelineEvent['status']) ?? 'pending',
            source: event.source === undefined ? undefined : String(event.source),
            createdBy: event.createdBy === undefined ? undefined : String(event.createdBy),
            remindRules: event.remindRules === undefined ? undefined : clone(event.remindRules),
            createdAt: now,
            updatedAt: now,
          }
          next.events.push(created)
          result = clone(created)
        }
        next.lastUpdated = now
        return next
      }, 'timeline', event.caseId === undefined ? undefined : String(event.caseId), 'upsert')
      return result!
    },

    async deleteEvent(id: string): Promise<{ deleted: boolean }> {
      let deleted = false
      let caseId: string | undefined
      await store.mutate((reg) => {
        const index = reg.events.findIndex((e) => e.id === id)
        if (index < 0) return reg
        const next = clone(reg)
        const [removed] = next.events.splice(index, 1)
        next.lastUpdated = nowIso()
        deleted = true
        caseId = removed?.caseId
        return next
      }, 'timeline', caseId, 'delete')
      return { deleted }
    },

    async toggleEvent(id: string): Promise<TimelineEvent> {
      let result: TimelineEvent | undefined
      await store.mutate((reg) => {
        const event = reg.events.find((e) => e.id === id)
        if (event === undefined) throw new Error(`event not found: ${id}`)
        const next = clone(reg)
        const target = next.events.find((e) => e.id === id)!
        target.status = target.status === 'done' ? 'pending' : 'done'
        target.completedAt = target.status === 'done' ? nowIso() : undefined
        target.updatedAt = nowIso()
        next.lastUpdated = target.updatedAt
        result = clone(target)
        return next
      }, 'timeline', result?.caseId, 'toggle')
      return result!
    },
  }
}
