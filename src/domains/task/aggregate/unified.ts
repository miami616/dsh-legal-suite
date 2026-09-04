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

interface ItemLike {
  id: string
  ownerId?: string
  ownerName?: string
  type?: string
  title: string
  status?: string
  priority?: string
  date?: string
  time?: string
  detail?: string
  groupId?: string
  groupName?: string
}

interface ItemRegistryLike {
  items?: ItemLike[]
}

/**
 * 统一事项模型：从 items.json（$DSH_HOME/agentlex/items）读所有 type 为
 * task/both 的事项，作为统一任务视图。替代从 case-registry/project-registry
 * 读 taskGroups + standalone-tasks。一个事项一次登记，这里只取任务侧。
 */
export async function aggregateUnifiedTasks(
  litigationDir: string,
  nonlitigationDir: string,
  standalone: TaskItem[],
): Promise<TaskItem[]> {
  // standalone 参数兼容旧调用；新逻辑从 items 读。
  const itemsDir = join(litigationDir, '..', 'items')
  const reg = await readJson<ItemRegistryLike>(join(itemsDir, 'items.json'))
  const out: TaskItem[] = [...standalone]

  for (const it of (reg?.items ?? [])) {
    // 只取任务侧（task/both）。
    if (it.type === 'event') continue
    const ownerId = it.ownerId ?? ''
    const source = ownerId === '' ? 'standalone' : 'litigation'
    out.push({
      id: it.id,
      title: it.title,
      detail: it.detail,
      status: (it.status === 'doing' ? 'doing' : it.status === 'done' ? 'done' : 'todo') as TaskItem['status'],
      priority: (it.priority as TaskItem['priority']) ?? 'medium',
      deadline: it.date,
      time: it.time,
      source,
      sourceId: ownerId || undefined,
      sourceName: it.ownerName,
      groupId: it.groupId,
    })
  }

  return out
}
