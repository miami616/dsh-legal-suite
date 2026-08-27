import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { JsonFileStore } from './file-store.ts'
import { childId, nowIso } from './id.ts'
import type { ServiceRecord, ServiceRegistry } from './types.ts'

export interface ServiceStore {
  readRegistry(): Promise<ServiceRegistry>
  listServices(): Promise<ServiceRecord[]>
  upsertService(input: Record<string, unknown>): Promise<ServiceRecord>
  deleteService(id: string): Promise<{ deleted: boolean }>
}

export function createServiceStore(dataDir: string, ctx: Context): ServiceStore {
  const store = new JsonFileStore<ServiceRegistry>(
    join(dataDir, 'services', 'registry.json'),
    () => ({ registryVersion: '1.0', services: {} }),
    ctx,
  )
  const s = (v: unknown): string | undefined => (v === undefined || v === null) ? undefined : String(v)

  return {
    async readRegistry() { return store.read() },
    async listServices() {
      const reg = await store.read()
      return Object.values(reg.services)
    },
    async upsertService(input) {
      const now = nowIso()
      const id = s(input.id) ?? childId('svc')
      let result: ServiceRecord | undefined
      await store.mutate((reg) => {
        const existing = reg.services[id] ?? { id, createdAt: now }
        const next: ServiceRecord = {
          ...existing,
          id,
          name: s(input.name) ?? existing.name ?? '未命名服务',
          kind: s(input.kind) ?? existing.kind,
          client: s(input.client) ?? existing.client,
          status: s(input.status) ?? existing.status ?? 'active',
          date: s(input.date) ?? existing.date,
          note: s(input.note) ?? existing.note,
          updatedAt: now,
        }
        reg.services[id] = next
        reg.lastUpdated = now
        result = next
        return reg
      }, 'services', undefined, 'upsert-service')
      return result!
    },
    async deleteService(id) {
      await store.mutate((reg) => {
        if (reg.services[id] === undefined) throw new Error(`service not found: ${id}`)
        delete reg.services[id]
        reg.lastUpdated = nowIso()
        return reg
      }, 'services', undefined, 'delete-service')
      return { deleted: true }
    },
  }
}
