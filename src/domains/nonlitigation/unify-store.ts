/**
 * 非诉域 0.2.12 一次性统一迁移 —— 项目关键日期并入 items.json 并剥离残留字段。
 *
 * 0.2.2 已把 project-registry 的任务镜像并入 items 并剥离；本迁移补上剩余的
 * 第二份存储：
 *   1. project-registry 每项目残留的 keyDates → items（type='keydate'，保留 id）；
 *   2. 残留的 taskGroups 字段（若还有）一并剥离。
 * 随后 project-registry.json 只剩项目元信息。带备份，失败只告警。
 */
import { copyFile, stat } from 'node:fs/promises'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ProjectStore } from './store/project-store.ts'
import type { ItemStore } from '../item/store/item-store.ts'
import type { ProjectRecord } from './store/types.ts'

export const UNIFY_VERSION = '0.2.12'

export function unifyMarkPath(dataDir: string): string {
  return join(dataDir, `.agentlex-unified-projects-${UNIFY_VERSION}`)
}

export interface UnifyProjectSummary {
  mergedKeyDates: number
  strippedProjects: number
}

/** 进程内并发闸：cordis fiber reload 会重复 apply，迁移只允许跑一次。 */
let inFlight: Promise<UnifyProjectSummary> | null = null

export function unifyProjectStore(
  projectStore: ProjectStore,
  itemStore: ItemStore,
  dataDir: string,
): Promise<UnifyProjectSummary> {
  if (inFlight === null) inFlight = runUnify(projectStore, itemStore, dataDir)
  return inFlight
}

async function runUnify(
  projectStore: ProjectStore,
  itemStore: ItemStore,
  dataDir: string,
): Promise<UnifyProjectSummary> {
  const summary: UnifyProjectSummary = { mergedKeyDates: 0, strippedProjects: 0 }
  if (existsSync(unifyMarkPath(dataDir))) return summary

  try {
    try {
      const registryFile = join(dataDir, 'project-registry.json')
      if (existsSync(registryFile)) {
        const info = await stat(registryFile)
        if (info.size > 2) await copyFile(registryFile, `${registryFile}.bak-unify-${UNIFY_VERSION}`)
      }
    } catch { /* best-effort */ }

    const [registry, existingItems] = await Promise.all([
      projectStore.readRegistryRaw(),
      itemStore.listItems(),
    ])
    const itemIds = new Set(existingItems.map((i) => i.id))

    for (const rec of Object.values(registry.projects) as ProjectRecord[]) {
      const keyDates = Array.isArray(rec.keyDates) ? rec.keyDates : []
      for (const kd of keyDates) {
        if (kd.id === undefined || kd.id === '' || itemIds.has(String(kd.id))) continue
        await itemStore.upsertItem({
          id: String(kd.id),
          ownerId: rec.projectId,
          ownerType: 'nonlitigation',
          ownerName: rec.name,
          type: 'keydate',
          title: String(kd.label ?? '关键日期'),
          date: kd.date === undefined ? undefined : String(kd.date),
          status: kd.done === true ? 'done' : 'pending',
          source: 'migration',
        })
        itemIds.add(String(kd.id))
        summary.mergedKeyDates++
      }
      // 无条件剥离（连空壳也删）；stripLegacyFields 内部按「键存在」判定，无字段即 no-op。
      try {
        await projectStore.stripLegacyFields(rec.projectId)
        if (keyDates.length > 0 || Array.isArray(rec.taskGroups)) summary.strippedProjects++
      } catch (error) {
        console.warn(`[agentlex-nonlitigation] 剥离残留字段失败 ${rec.projectId}:`, error)
      }
    }

    try {
      mkdirSync(dataDir, { recursive: true })
      writeFileSync(unifyMarkPath(dataDir), new Date().toISOString(), 'utf8')
    } catch { /* best-effort */ }
  } catch (error) {
    console.warn('[agentlex-nonlitigation] 0.2.12 统一迁移失败（原文件保留，可重试）:', error)
  }
  return summary
}
