import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ProjectStore } from '../store/project-store.ts'
import type { ServiceStore } from '../store/service-store.ts'

export interface ImportResult {
  projectsAdded: number
  projectsUpdated: number
  servicesImported: number
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T
  } catch {
    return undefined
  }
}

interface SourceProject {
  projectId: string
  name: string
  projectType?: string
  status?: string
  leadLawyer?: string
  contractAmount?: string
  servicePeriod?: { start?: string; end?: string }
  serviceScope?: string[]
  folder?: string
  summary?: string
  taskGroups?: SourceTaskGroup[]
}

interface SourceTaskGroup {
  id?: string
  name?: string
  title?: string
  order?: number
  tasks?: SourceTask[]
}

interface SourceTask {
  id?: string
  title?: string
  detail?: string
  deadline?: string
  time?: string
  priority?: string
  status?: string
  templateTitle?: string
}

interface SourceProjectRegistry {
  projects?: Record<string, SourceProject>
}

interface SourceService {
  id?: string
  name: string
  kind?: string
  client?: string
  status?: string
  date?: string
  note?: string
}

interface SourceServiceRegistry {
  services?: Record<string, SourceService>
}

export async function importFromAgentLex(
  projectStore: ProjectStore,
  serviceStore: ServiceStore,
  sourceDir?: string,
  itemStore?: import('../../item/store/item-store.ts').ItemStore,
): Promise<ImportResult> {
  const dir = sourceDir !== undefined && sourceDir !== '' ? sourceDir : join(homedir(), '.myagents', 'agentlex')

  const projReg = await readJson<SourceProjectRegistry>(join(dir, 'project-registry.json'))
  let projectsAdded = 0
  let projectsUpdated = 0
  for (const p of Object.values(projReg?.projects ?? {})) {
    const existing = await projectStore.readProject(p.projectId)
    // 0.2.2：任务正文归统一事项 items（不再落 project-registry）。
    const baseFields = {
      projectId: p.projectId,
      name: p.name,
      projectType: p.projectType,
      status: p.status,
      leadLawyer: p.leadLawyer,
      contractAmount: p.contractAmount,
      servicePeriod: p.servicePeriod,
      serviceScope: p.serviceScope,
      folder: p.folder,
      summary: p.summary,
    }
    if (itemStore !== undefined) {
      const sourceGroups = Array.isArray(p.taskGroups) ? p.taskGroups : []
      const existingItems = await itemStore.listItems(p.projectId)
      const existingIds = new Set(existingItems.map((i) => i.id))
      const hasMissing = sourceGroups.some((g) => (Array.isArray(g?.tasks) ? g.tasks : []).some((t) => t.id !== undefined && !existingIds.has(String(t.id))))
      if (hasMissing) {
        for (const g of sourceGroups) {
          if (g === undefined || g.id === undefined || g.id === '') continue
          const groupName = String(g.name ?? '新阶段')
          const haveGroup = (await itemStore.listGroups(p.projectId)).some((eg) => eg.id === g.id)
          if (!haveGroup) {
            await itemStore.upsertGroup({ id: g.id, ownerId: p.projectId, ownerType: 'nonlitigation', name: groupName, order: typeof g.order === 'number' ? g.order : undefined })
          }
          const tasks = Array.isArray(g.tasks) ? g.tasks : []
          for (const t of tasks) {
            if (t === undefined || t.id === undefined || t.id === '') continue
            const status = String(t.status ?? 'todo')
            await itemStore.upsertItem({
              id: String(t.id),
              ownerId: p.projectId,
              ownerType: 'nonlitigation',
              ownerName: p.name,
              type: 'task',
              title: String(t.title ?? '新任务'),
              detail: t.detail === undefined ? undefined : String(t.detail),
              date: t.deadline === undefined ? undefined : String(t.deadline),
              time: t.time === undefined ? undefined : String(t.time),
              priority: (t.priority as never) ?? 'medium',
              status: (status === 'done' ? 'done' : status === 'doing' || status === 'in_progress' ? 'doing' : 'pending') as never,
              groupId: g.id,
              groupName,
              templateTitle: t.templateTitle === undefined ? undefined : String(t.templateTitle),
            })
          }
        }
      }
    }
    if (existing === undefined) {
      await projectStore.registerProject(baseFields)
      projectsAdded++
    } else {
      await projectStore.updateProject(p.projectId, baseFields)
      projectsUpdated++
    }
  }

  const svcReg = await readJson<SourceServiceRegistry>(join(dir, 'services', 'registry.json'))
  let servicesImported = 0
  for (const s of Object.values(svcReg?.services ?? {})) {
    await serviceStore.upsertService({
      id: s.id,
      name: s.name,
      kind: s.kind,
      client: s.client,
      status: s.status,
      date: s.date,
      note: s.note,
    })
    servicesImported++
  }

  return { projectsAdded, projectsUpdated, servicesImported }
}
