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
  taskGroups?: unknown[]
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
): Promise<ImportResult> {
  const dir = sourceDir !== undefined && sourceDir !== '' ? sourceDir : join(homedir(), '.myagents', 'agentlex')

  const projReg = await readJson<SourceProjectRegistry>(join(dir, 'project-registry.json'))
  let projectsAdded = 0
  let projectsUpdated = 0
  for (const p of Object.values(projReg?.projects ?? {})) {
    const existing = await projectStore.readProject(p.projectId)
    if (existing === undefined) {
      await projectStore.registerProject({
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
        taskGroups: p.taskGroups,
      })
      projectsAdded++
    } else {
      await projectStore.updateProject(p.projectId, {
        name: p.name,
        projectType: p.projectType,
        status: p.status,
        leadLawyer: p.leadLawyer,
        contractAmount: p.contractAmount,
        servicePeriod: p.servicePeriod,
        serviceScope: p.serviceScope,
        folder: p.folder,
        summary: p.summary,
        taskGroups: p.taskGroups,
      })
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
