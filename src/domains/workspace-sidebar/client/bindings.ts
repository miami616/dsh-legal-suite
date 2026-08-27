/**
 * Session → case/project binding lookup for
 * dsh-legal-suite/workspace-sidebar.
 *
 * The litigation / nonlitigation plugins own the registries; this module
 * queries their host APIs (JSON envelope) at runtime and resolves the current
 * DSH session to a bound case/project folder — the「案件/项目文件夹联动」root
 * source for DirectoryPanel. Tolerant field access: registry shapes may drift
 * between plugin versions, so lookups never throw.
 */

export interface WorkspaceBinding {
  kind: 'case' | 'project'
  id: string
  name: string
  folder: string | null
}

interface Envelope<T> {
  success: boolean
  data?: T
  error?: string
}

async function post<T>(path: string, body: Record<string, unknown>): Promise<T | undefined> {
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    })
    const envelope = await response.json() as Envelope<T>
    if (!envelope.success) return undefined
    return envelope.data
  } catch {
    return undefined
  }
}

/** Normalize a boundSessions entry (string id or { sessionId } object). */
function sessionIdOf(bound: unknown): string | null {
  if (typeof bound === 'string') return bound
  if (bound !== null && typeof bound === 'object') {
    const value = (bound as { sessionId?: unknown }).sessionId
    return typeof value === 'string' ? value : null
  }
  return null
}

function pickCase(registry: unknown, sessionId: string): WorkspaceBinding | null {
  // The litigation registry stores cases as an OBJECT keyed by caseId
  // ({ "2025-003": {...} }), not an array — normalize both shapes.
  const raw = (registry as { cases?: unknown })?.cases
  const list = Array.isArray(raw) ? raw : Object.values((raw ?? {}) as Record<string, unknown>)
  for (const rawRecord of list) {
    const record = rawRecord as {
      caseId?: string
      id?: string
      caseName?: string
      name?: string
      folder?: string | null
      boundSessions?: unknown[]
      sessions?: unknown[]
    }
    const sessions = (record.boundSessions ?? record.sessions ?? [])
      .map(sessionIdOf)
      .filter((id): id is string => id !== null)
    if (sessions.includes(sessionId)) {
      return {
        kind: 'case',
        id: record.caseId ?? record.id ?? sessionId,
        name: record.caseName ?? record.name ?? '',
        folder: record.folder ?? null,
      }
    }
  }
  return null
}

function pickProject(registry: unknown, sessionId: string): WorkspaceBinding | null {
  const raw = (registry as { projects?: unknown })?.projects
  const list = Array.isArray(raw) ? raw : Object.values((raw ?? {}) as Record<string, unknown>)
  for (const rawRecord of list) {
    const record = rawRecord as {
      projectId?: string
      id?: string
      projectName?: string
      name?: string
      folder?: string | null
      boundSessions?: unknown[]
      sessions?: unknown[]
    }
    const sessions = (record.boundSessions ?? record.sessions ?? [])
      .map(sessionIdOf)
      .filter((id): id is string => id !== null)
    if (sessions.includes(sessionId)) {
      return {
        kind: 'project',
        id: record.projectId ?? record.id ?? sessionId,
        name: record.projectName ?? record.name ?? '',
        folder: record.folder ?? null,
      }
    }
  }
  return null
}

/** Resolve the current session to a bound case/project (folder for tree root). */
export async function queryBinding(sessionId: string | undefined): Promise<WorkspaceBinding | null> {
  if (!sessionId) return null
  const caseRegistry = await post<unknown>('/api/agentlex-case/read', {})
  if (caseRegistry !== undefined) {
    const bound = pickCase(caseRegistry, sessionId)
    if (bound !== null) return bound
  }
  const projectRegistry = await post<unknown>('/api/agentlex-nonlitigation/projects', {})
  if (projectRegistry !== undefined) {
    const bound = pickProject(projectRegistry, sessionId)
    if (bound !== null) return bound
  }
  return null
}