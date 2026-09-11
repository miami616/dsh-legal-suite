/**
 * 任务域 0.2.12 一次性统一迁移 —— 旧 standalone-tasks.json 并入 items.json 并退役。
 *
 * 独立任务（不归案/项目的临时安排）原本存在 `tasks/standalone-tasks.json`，
 * 而 0.2.x 起新建的独立任务已写 items.json（ownerType='standalone'）——同一类
 * 数据两处存储。本迁移把旧文件里的任务并入 items（按 id 去重、只补不覆盖），
 * 成功后把旧文件改名 .legacy 退役。带备份，失败只告警。
 */
import { copyFile, rename, stat } from 'node:fs/promises'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ItemStore } from '../item/store/item-store.ts'
import type { StandaloneTasksRegistry, TaskItem } from './store/types.ts'

export const UNIFY_VERSION = '0.2.12'

export function unifyMarkPath(dataDir: string): string {
  return join(dataDir, `.agentlex-unified-standalone-${UNIFY_VERSION}`)
}

export interface UnifyTaskSummary {
  mergedTasks: number
  retiredStandalone: boolean
}

/** 进程内并发闸：cordis fiber reload 会重复 apply，迁移只允许跑一次。 */
let inFlight: Promise<UnifyTaskSummary> | null = null

export function unifyTaskStore(itemStore: ItemStore, dataDir: string): Promise<UnifyTaskSummary> {
  if (inFlight === null) inFlight = runUnify(itemStore, dataDir)
  return inFlight
}

async function runUnify(itemStore: ItemStore, dataDir: string): Promise<UnifyTaskSummary> {
  const summary: UnifyTaskSummary = { mergedTasks: 0, retiredStandalone: false }
  if (existsSync(unifyMarkPath(dataDir))) return summary

  const legacyFile = join(dataDir, 'standalone-tasks.json')
  try {
    if (existsSync(legacyFile)) {
      try {
        const info = await stat(legacyFile)
        if (info.size > 2) await copyFile(legacyFile, `${legacyFile}.bak-unify-${UNIFY_VERSION}`)
      } catch { /* best-effort */ }

      let legacy: StandaloneTasksRegistry | undefined
      try {
        legacy = JSON.parse(readFileSync(legacyFile, 'utf8')) as StandaloneTasksRegistry
      } catch {
        console.warn('[agentlex-task] standalone-tasks.json 解析失败，跳过并库（原文件保留）')
      }
      const tasks = Object.values(legacy?.tasks ?? {}) as TaskItem[]
      const existing = new Set((await itemStore.listItems()).map((i) => i.id))
      for (const t of tasks) {
        if (t.id === undefined || t.id === '' || existing.has(String(t.id))) continue
        await itemStore.upsertItem({
          id: String(t.id),
          ownerId: '',
          ownerType: 'standalone',
          type: 'task',
          title: String(t.title ?? '未命名任务'),
          detail: t.detail === undefined ? undefined : String(t.detail),
          date: t.deadline === undefined ? undefined : String(t.deadline),
          time: t.time === undefined ? undefined : String(t.time),
          priority: (t.priority as never) ?? 'medium',
          status: (t.status === 'done' ? 'done' : t.status === 'doing' ? 'doing' : 'pending') as never,
          source: 'standalone',
        })
        existing.add(String(t.id))
        summary.mergedTasks++
      }
      try {
        await rename(legacyFile, `${legacyFile}.legacy`)
        summary.retiredStandalone = true
      } catch (error) {
        // 并发/已退役：ENOENT 视为已完成，不当失败（否则标记文件不落，下轮重跑）。
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        summary.retiredStandalone = true
      }
    }

    try {
      mkdirSync(dataDir, { recursive: true })
      writeFileSync(unifyMarkPath(dataDir), new Date().toISOString(), 'utf8')
    } catch { /* best-effort */ }
  } catch (error) {
    console.warn('[agentlex-task] 0.2.12 统一迁移失败（原文件保留，可重试）:', error)
  }
  return summary
}
