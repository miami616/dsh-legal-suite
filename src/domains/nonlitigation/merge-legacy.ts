/**
 * 非诉域 0.2.2 一次性并库迁移 —— project-registry.json 的任务镜像并入统一事项。
 *
 * 与诉讼域 merge-legacy.ts 对称：项目任务原本残留在 project-registry.json 的
 * taskGroups（0.2.0/0.2.1 只切写路径的历史残留），这里一次性并入 items.json
 * （ownerType=nonlitigation，按 id 去重、只补不覆盖），成功后剥离 registry
 * 镜像（project-registry 只留项目元信息 + keyDates），磁盘标记只跑一次。
 */
import { writeFile } from 'node:fs/promises'
import { mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ProjectStore } from './store/project-store.ts'
import type { ItemStore } from '../item/store/item-store.ts'
import type { ProjectRecord } from './store/types.ts'

const MERGE_VERSION = '0.2.2'

function markPath(dataDir: string): string {
  return join(dataDir, `.agentlex-merged-projects-${MERGE_VERSION}`)
}

export async function mergeProjectLegacyIntoItems(
  projectStore: ProjectStore,
  itemStore: ItemStore,
  dataDir: string,
): Promise<{ mergedTasks: number; strippedProjects: number }> {
  const summary = { mergedTasks: 0, strippedProjects: 0 }
  if (existsSync(markPath(dataDir))) return summary
  try {
    const [registry, itemItems, itemGroups] = await Promise.all([
      projectStore.readRegistry(),
      itemStore.listItems(),
      itemStore.listGroups(),
    ])
    const itemIds = new Set(itemItems.map((i) => i.id))
    const groupIds = new Set(itemGroups.map((g) => g.id))
    const projectIds = Object.keys(registry.projects)
    if (projectIds.length === 0) {
      try { mkdirSync(dataDir, { recursive: true }); writeFileSync(markPath(dataDir), new Date().toISOString(), 'utf8') } catch { /* best-effort */ }
      return summary
    }
    const stripProjects: string[] = []
    for (const rec of Object.values(registry.projects) as ProjectRecord[]) {
      const groups = Array.isArray(rec.taskGroups) ? rec.taskGroups : []
      if (groups.length === 0) continue
      for (const g of groups) {
        const gid = g.id
        if (gid === undefined || gid === '') continue
        if (!groupIds.has(gid)) {
          await itemStore.upsertGroup({
            id: gid,
            ownerId: rec.projectId,
            ownerType: 'nonlitigation',
            name: String(g.name ?? '新阶段'),
            order: typeof g.order === 'number' ? g.order : undefined,
          })
          groupIds.add(gid)
        }
      }
      for (const g of groups) {
        const groupName = String(g.name ?? '新阶段')
        const tasks = Array.isArray(g.tasks) ? g.tasks : []
        for (const t of tasks) {
          if (t.id === undefined || itemIds.has(t.id)) continue
          const legacyStatus = String(t.status ?? 'todo')
          await itemStore.upsertItem({
            id: String(t.id),
            ownerId: rec.projectId,
            ownerType: 'nonlitigation',
            ownerName: rec.name,
            type: 'task',
            title: String(t.title ?? '新任务'),
            detail: t.detail === undefined ? undefined : String(t.detail),
            date: t.deadline === undefined ? undefined : String(t.deadline),
            time: t.time === undefined ? undefined : String(t.time),
            priority: (t.priority as never) ?? 'medium',
            status: (legacyStatus === 'done' ? 'done' : legacyStatus === 'doing' || legacyStatus === 'in_progress' ? 'doing' : 'pending') as never,
            groupId: g.id,
            groupName,
            templateTitle: t.templateTitle === undefined ? undefined : String(t.templateTitle),
            subtasks: (t.subtasks ?? []).map((st) => ({
              id: String(st.id ?? `sub-${t.id}-${Math.random().toString(36).slice(2, 8)}`),
              title: String(st.title ?? '子任务'),
              done: st.done === true,
              deadline: st.deadline === undefined ? undefined : String(st.deadline),
            })),
            checklist: (t.checklist ?? []).map((c) => ({
              id: String(c.id ?? `chk-${t.id}-${Math.random().toString(36).slice(2, 8)}`),
              text: String(c.text ?? ''),
              done: c.done === true,
            })),
          })
          itemIds.add(String(t.id))
          summary.mergedTasks++
        }
      }
      stripProjects.push(rec.projectId)
    }
    for (const pid of stripProjects) {
      try {
        await projectStore.stripTaskGroups(pid)
        summary.strippedProjects++
      } catch (error) {
        console.warn(`[agentlex-nonlitigation] 剥离 registry taskGroups 失败 ${pid}:`, error)
      }
    }
    try {
      mkdirSync(dataDir, { recursive: true })
      writeFileSync(markPath(dataDir), new Date().toISOString(), 'utf8')
    } catch { /* best-effort */ }
  } catch (error) {
    console.warn('[agentlex-nonlitigation] 0.2.2 一次性并库迁移失败（原文件保留，可重试）:', error)
  }
  return summary
}
