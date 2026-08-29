import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { TaskItem } from '../store/types.ts'

/** Read a JSON file, returning undefined when missing/corrupt. */
async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T
  } catch {
    return undefined
  }
}

interface LitigationRegistryLike {
  cases?: Record<string, {
    caseId: string
    name: string
    taskGroups?: Array<{
      id: string
      name: string
      tasks?: Array<{
        id: string
        title: string
        status?: string
        priority?: string
        deadline?: string
        detail?: string
      }>
    }>
  }>
}

interface NonLitigationRegistryLike {
  projects?: Record<string, {
    projectId: string
    name: string
    taskGroups?: Array<{
      id: string
      name: string
      tasks?: Array<{
        id: string
        title: string
        status?: string
        priority?: string
        deadline?: string
        detail?: string
      }>
    }>
  }>
}

/**
 * Read the litigation + non-litigation registries directly from disk (read-only)
 * and merge their task trees with standalone tasks into one unified list.
 */
export async function aggregateUnifiedTasks(
  litigationDir: string,
  nonlitigationDir: string,
  standalone: TaskItem[],
): Promise<TaskItem[]> {
  const out: TaskItem[] = [...standalone]

  const cases = await readJson<LitigationRegistryLike>(join(litigationDir, 'case-registry.json'))
  for (const c of Object.values(cases?.cases ?? {})) {
    for (const g of c.taskGroups ?? []) {
      for (const t of g.tasks ?? []) {
        out.push({
          id: `lit-${c.caseId}-${t.id}`,
          title: t.title,
          detail: t.detail,
          status: (t.status as TaskItem['status']) ?? 'todo',
          priority: (t.priority as TaskItem['priority']) ?? 'medium',
          deadline: t.deadline,
          source: 'litigation',
          sourceId: c.caseId,
          sourceName: c.name,
          groupId: g.id,
        })
      }
    }
  }

  const projects = await readJson<NonLitigationRegistryLike>(join(nonlitigationDir, 'project-registry.json'))
  for (const p of Object.values(projects?.projects ?? {})) {
    for (const g of p.taskGroups ?? []) {
      for (const t of g.tasks ?? []) {
        out.push({
          id: `nl-${p.projectId}-${t.id}`,
          title: t.title,
          detail: t.detail,
          status: (t.status as TaskItem['status']) ?? 'todo',
          priority: (t.priority as TaskItem['priority']) ?? 'medium',
          deadline: t.deadline,
          source: 'nonlitigation',
          sourceId: p.projectId,
          sourceName: p.name,
          groupId: g.id,
        })
      }
    }
  }

  return out
}
