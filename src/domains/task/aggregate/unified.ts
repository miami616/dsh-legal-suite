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
  ownerType?: string
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
  // 0.2.12：standalone 任务也在 items.json（ownerType='standalone'），本函数
  // 直接读 items 即可覆盖三类归属；standalone 参数仅为旧调用签名兼容，按 id 去重。
  const itemsDir = join(litigationDir, '..', 'items')
  const reg = await readJson<ItemRegistryLike>(join(itemsDir, 'items.json'))
  const out: TaskItem[] = []
  const seen = new Set<string>()
  for (const t of standalone) {
    if (seen.has(t.id)) continue
    seen.add(t.id)
    out.push(t)
  }

  for (const it of (reg?.items ?? [])) {
    if (seen.has(it.id)) continue
    seen.add(it.id)
    // 只取任务侧（task/both）；事件与关键日期不进任务台账。
    if (it.type !== 'task' && it.type !== 'both') continue
    const ownerId = it.ownerId ?? ''
    // ownerType 区分同号案件/项目/独立（2026-09-04）；缺省按历史（案件/独立）。
    const ownerType = it.ownerType ?? (ownerId === '' ? 'standalone' : 'litigation')
    const source = ownerType === 'nonlitigation' ? 'nonlitigation' : ownerType === 'standalone' ? 'standalone' : 'litigation'
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
