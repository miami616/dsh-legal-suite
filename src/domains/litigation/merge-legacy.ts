/**
 * 0.2.2 一次性并库迁移 —— 旧任务/事件并入统一事项 items.json，随后退役旧源。
 *
 * 背景：0.2.0/0.2.1 统一事项迁移只切了写路径，case-registry.json 里残留任务
 * 镜像、case-timeline.json 残留旧事件，读改路径分叉。本模块在启动时执行一次：
 *  1. registry 每案的 taskGroups（含组与任务正文）→ items.json（groups 并入
 *     组壳；任务并入 items，按 id 去重、只补不覆盖，零丢失）；
 *  2. case-timeline.json 旧事件 → items.json（type=event，按 id 去重）；
 *  3. 迁移成功后剥离 registry 里每案的 taskGroups（registry 只留案件元信息 +
 *     keyDates），并把 case-timeline.json 改名 .legacy 退役；
 *  4. 磁盘标记 .agentlex-merged-<version>，跨进程只跑一次。
 *
 * 失败策略：任何一步失败都只告警不致命（数据仍在原文件，可重试）。
 */
import { rename, writeFile } from 'node:fs/promises'
import { mkdirSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CaseStore } from './store/case-store.ts'
import type { TimelineStore } from './store/timeline-store.ts'
import type { ItemStore } from '../item/store/item-store.ts'
import type { CaseRecord, TimelineEvent } from './store/types.ts'

/** 本次迁移版本标记（改了迁移逻辑就递增，保证旧标记不会跳过新迁移）。 */
const MERGE_VERSION = '0.2.2'

/** 迁移标记文件（与 seed 标记同目录：$DSH_HOME/agentlex/litigation）。 */
function markPath(dataDir: string): string {
  return join(dataDir, `.agentlex-merged-${MERGE_VERSION}`)
}

/**
 * 执行一次性并库迁移。幂等（标记存在则跳过）。串行于 seed 前调用。
 * @returns 迁移摘要（无旧数据时为空对象）。
 */
export async function mergeLegacyIntoItems(
  caseStore: CaseStore,
  timelineStore: TimelineStore,
  itemStore: ItemStore,
  dataDir: string,
): Promise<{ mergedTasks: number; mergedEvents: number; strippedCases: number; renamedTimeline: boolean }> {
  const summary = { mergedTasks: 0, mergedEvents: 0, strippedCases: 0, renamedTimeline: false }
  if (existsSync(markPath(dataDir))) return summary

  try {
    const [registry, timelineEvents, itemItems, itemGroups] = await Promise.all([
      caseStore.readRegistry(),
      timelineStore.listEvents(),
      itemStore.listItems(),
      itemStore.listGroups(),
    ])
    const itemIds = new Set(itemItems.map((i) => i.id))
    const groupIds = new Set(itemGroups.map((g) => g.id))
    const caseIds = Object.keys(registry.cases)
    if (caseIds.length === 0 && timelineEvents.length === 0) {
      // 全新安装/无旧数据：直接落标记，跳过。
      try { mkdirSync(dataDir, { recursive: true }); writeFileSync(markPath(dataDir), new Date().toISOString(), 'utf8') } catch { /* best-effort */ }
      return summary
    }

    // ── 1) 任务：registry 每案 taskGroups → items（组壳 + 任务正文）──
    const stripCases: string[] = []
    for (const rec of Object.values(registry.cases) as CaseRecord[]) {
      const groups = Array.isArray(rec.taskGroups) ? rec.taskGroups : []
      if (groups.length === 0) continue
      // 组壳并入 items.groups（按 id 去重；旧镜像组名可能在 title，兼容）。
      for (const g of groups) {
        const gid = g.id
        if (gid === undefined || gid === '') continue
        if (!groupIds.has(gid)) {
          await itemStore.upsertGroup({
            id: gid,
            ownerId: rec.caseId,
            ownerType: 'litigation',
            name: String((g as unknown as { name?: string; title?: string }).name ?? (g as unknown as { title?: string }).title ?? '新阶段'),
            order: typeof g.order === 'number' ? g.order : undefined,
          })
          groupIds.add(gid)
        }
      }
      // 任务正文并入 items（按 id 去重；缺失才补，不覆盖既有）。
      for (const g of groups) {
        const groupName = String((g as unknown as { name?: string; title?: string }).name ?? (g as unknown as { title?: string }).title ?? '新阶段')
        const tasks = Array.isArray(g.tasks) ? g.tasks : []
        for (const t of tasks) {
          if (t.id === undefined || itemIds.has(t.id)) continue
          const legacyStatus = String(t.status ?? 'todo')
          await itemStore.upsertItem({
            id: String(t.id),
            ownerId: rec.caseId,
            ownerType: 'litigation',
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
            keyDateId: t.keyDateId === undefined ? undefined : String(t.keyDateId),
            remindKeyDate: t.remindKeyDate === true,
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
      // 该案镜像已并入 → 登记待剥离。
      stripCases.push(rec.caseId)
    }
    // 剥离 registry 任务镜像（任务已归 items，registry 只留案件元信息）。
    for (const cid of stripCases) {
      try {
        await caseStore.stripTaskGroups(cid)
        summary.strippedCases++
      } catch (error) {
        console.warn(`[agentlex-litigation] 剥离 registry taskGroups 失败 ${cid}:`, error)
      }
    }

    // ── 2) 旧 case-timeline.json 事件 → items（type=event，按 id 去重）──
    for (const e of timelineEvents as TimelineEvent[]) {
      if (e.id === undefined || itemIds.has(e.id)) continue
      if (!(registry.cases as Record<string, unknown>)[e.caseId]) {
        // 孤儿事件（案件已删）不再搬入（配合 cascade delete 的清理）。
        continue
      }
      const status = String(e.status ?? 'pending')
      await itemStore.upsertItem({
        id: String(e.id),
        ownerId: String(e.caseId ?? ''),
        ownerType: 'litigation',
        ownerName: (registry.cases as Record<string, CaseRecord>)[e.caseId]?.name,
        type: 'event',
        title: String(e.title ?? ''),
        detail: e.detail === undefined ? undefined : String(e.detail),
        date: e.date === undefined ? undefined : String(e.date),
        time: e.time === undefined ? undefined : String(e.time),
        status: (status === 'done' || status === 'completed' ? 'done' : status === 'cancelled' ? 'cancelled' : 'pending') as never,
        remindRules: Array.isArray(e.remindRules) ? e.remindRules : undefined,
      })
      itemIds.add(String(e.id))
      summary.mergedEvents++
    }
    // 旧事件文件退役（改名保留现场，但不再被任何读路径使用）。
    try {
      await rename(join(dataDir, 'case-timeline.json'), join(dataDir, 'case-timeline.json.legacy'))
      summary.renamedTimeline = true
    } catch { /* best-effort */ }

    try {
      mkdirSync(dataDir, { recursive: true })
      writeFileSync(markPath(dataDir), new Date().toISOString(), 'utf8')
    } catch { /* best-effort */ }
  } catch (error) {
    console.warn('[agentlex-litigation] 0.2.2 一次性并库迁移失败（原文件保留，可重试）:', error)
  }
  return summary
}
