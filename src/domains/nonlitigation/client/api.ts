import type { ProjectRecord, ProjectRegistry, ServiceRecord } from '../store/types.ts'

interface Envelope<T> {
  success: boolean
  data?: T
  error?: string
}

async function call<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(`/api/agentlex-nonlitigation/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  })
  const envelope = await response.json() as Envelope<T>
  if (!envelope.success) throw new Error(envelope.error ?? `request failed (${response.status})`)
  return envelope.data as T
}

export function readProjects(): Promise<ProjectRegistry> {
  return call('projects')
}

export function readProject(projectId: string): Promise<ProjectRecord> {
  return call('project', { projectId })
}

export function registerProject(input: Record<string, unknown>): Promise<ProjectRecord> {
  return call('register-project', input)
}

export function updateProject(projectId: string, patch: Record<string, unknown>): Promise<ProjectRecord> {
  return call('update-project', { projectId, ...patch })
}

export function deleteProject(projectId: string): Promise<{ deleted: boolean }> {
  return call('delete-project', { projectId })
}

export function upsertTaskGroup(projectId: string, group: Record<string, unknown>): Promise<ProjectRecord> {
  return call('group', { projectId, ...group })
}

export function upsertTask(projectId: string, groupId: string, task: Record<string, unknown>): Promise<ProjectRecord> {
  return call('task', { projectId, groupId, ...task })
}

export function listServices(): Promise<ServiceRecord[]> {
  return call('services')
}

export function upsertService(input: Record<string, unknown>): Promise<ServiceRecord> {
  return call('service', input)
}

export function deleteService(id: string): Promise<{ deleted: boolean }> {
  return call('delete-service', { id })
}

export interface ImportResult {
  projectsAdded: number
  projectsUpdated: number
  servicesImported: number
}

export function importAgentLex(sourceDir?: string): Promise<ImportResult> {
  return call('import', sourceDir === undefined ? {} : { sourceDir })
}
