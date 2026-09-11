/**
 * 0.2.12「全面完整统一」一次性迁移 —— 把剩余的第二份存储并入 items.json 并退役。
 *
 * 背景：0.2.2 只把「任务 + 时间轴事件」切到 items.json，关键日期仍是
 * case-registry 的字段、旧 schedules.json / standalone-tasks.json 仍在服役，
 * 且 registry 里还能残留 taskGroups 镜像。结果同一件事在多处各存一份，
 * 读时靠合并层掩盖、写时靠纪律避免——漏一处就出现「这里漏一点那里漏一点」。
 *
 * 本模块在启动时执行一次（版本标记），把下列来源全部并入 items.json：
 *   1. registry 每案残留的 taskGroups 镜像 → items（按 id 去重，只补不覆盖）；
 *   2. registry 每案的 keyDates → items（type='keydate'，保留 ruleId/baseDate/
 *      cite/computeTrace 审计字段与 id，保证 task↔keydate 链接不断）；
 *   3. litigation/schedules.json 旧日程 → items（type='event'）；
 * 随后剥离 registry 的 taskGroups/keyDates 字段，并把 schedules.json 改名
 * .legacy 退役。全程带备份，失败只告警不致命（原文件保留可重试）。
 *
 * 幂等：标记文件 .agentlex-unified-0.2.12 存在即跳过。
 */
import { copyFile, rename, stat } from 'node:fs/promises'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CaseStore } from './store/case-store.ts'
import type { ScheduleStore } from './store/schedule-store.ts'
import type { ItemStore } from '../item/store/item-store.ts'
import type { CaseRecord, KeyDate, TaskGroup } from './store/types.ts'

/** 本次统一迁移的版本标记（改迁移逻辑就递增）。 */
export const UNIFY_VERSION = '0.2.12'

/** 迁移标记文件路径。 */
export function unifyMarkPath(dataDir: string): string {
  return join(dataDir, `.agentlex-unified-${UNIFY_VERSION}`)
}

export interface UnifySummary {
  mergedTasks: number
  mergedKeyDates: number
  mergedSchedules: number
  strippedCases: number
  retiredSchedules: boolean
}

/** 进程内并发闸：cordis fiber reload 会重复 apply，迁移只允许跑一次。 */
let inFlight: Promise<UnifySummary> | null = null

/**
 * 执行诉讼域统一迁移。幂等（标记存在即跳过）。串行于 seed 前调用。
 * 并发安全：同一进程内重复调用复用同一个 promise（fiber reload 常见）。
 */
export function unifyLitigationStore(
  caseStore: CaseStore,
  scheduleStore: ScheduleStore,
  itemStore: ItemStore,
  dataDir: string,
): Promise<UnifySummary> {
  if (inFlight === null) inFlight = runUnify(caseStore, scheduleStore, itemStore, dataDir)
  return inFlight
}

async function runUnify(
  caseStore: CaseStore,
  scheduleStore: ScheduleStore,
  itemStore: ItemStore,
  dataDir: string,
): Promise<UnifySummary> {
  const summary: UnifySummary = {
    mergedTasks: 0, mergedKeyDates: 0, mergedSchedules: 0, strippedCases: 0, retiredSchedules: false,
  }
  if (existsSync(unifyMarkPath(dataDir))) return summary

  try {
    // 迁移前留一份原样备份（字段剥离是破坏性的，出问题要能翻回去）。
    try {
      const registryFile = join(dataDir, 'case-registry.json')
      if (existsSync(registryFile)) {
        const info = await stat(registryFile)
        if (info.size > 2) await copyFile(registryFile, `${registryFile}.bak-unify-${UNIFY_VERSION}`)
      }
    } catch { /* best-effort */ }

    const [registry, existingItems, existingGroups] = await Promise.all([
      caseStore.readRegistryRaw(),
      itemStore.listItems(),
      itemStore.listGroups(),
    ])
    const itemIds = new Set(existingItems.map((i) => i.id))
    const groupIds = new Set(existingGroups.map((g) => g.id))

    for (const rec of Object.values(registry.cases) as CaseRecord[]) {
      const groups: TaskGroup[] = Array.isArray(rec.taskGroups) ? rec.taskGroups : []
      const keyDates: KeyDate[] = Array.isArray(rec.keyDates) ? rec.keyDates : []

      // ── 1) 残留任务镜像（组壳 + 任务正文）→ items ──
      for (const g of groups) {
        const gid = String(g.id ?? '')
        if (gid === '') continue
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
      for (const g of groups) {
        const groupName = String((g as unknown as { name?: string; title?: string }).name ?? (g as unknown as { title?: string }).title ?? '新阶段')
        for (const t of Array.isArray(g.tasks) ? g.tasks : []) {
          if (t.id === undefined || itemIds.has(String(t.id))) continue
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
              detail: st.detail === undefined ? undefined : String(st.detail),
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

      // ── 2) 关键日期 → items（type='keydate'，保留 id 与审计字段）──
      for (const kd of keyDates) {
        if (kd.id === undefined || kd.id === '' || itemIds.has(String(kd.id))) continue
        await itemStore.upsertItem({
          id: String(kd.id),
          ownerId: rec.caseId,
          ownerType: 'litigation',
          ownerName: rec.name,
          type: 'event',
          title: String(kd.label ?? '关键日期'),
          date: kd.date === undefined ? undefined : String(kd.date),
          status: kd.done === true ? 'done' : 'pending',
          ruleId: kd.ruleId,
          baseDate: kd.baseDate,
          cite: kd.cite,
          computeTrace: kd.computeTrace,
          source: (kd as unknown as { source?: string }).source ?? 'migration',
        })
        itemIds.add(String(kd.id))
        summary.mergedKeyDates++
      }

      // ── 3) 剥离 registry 的第二份存储（taskGroups + keyDates 字段）──
      // 无条件调用：连 `keyDates: []` 空壳也要删（stripLegacyFields 内部按「键存在」
      // 判定，无字段时是 no-op）。
      try {
        await caseStore.stripLegacyFields(rec.caseId)
        if (groups.length > 0 || keyDates.length > 0) summary.strippedCases++
      } catch (error) {
        console.warn(`[agentlex-litigation] 剥离 registry 残留字段失败 ${rec.caseId}:`, error)
      }
    }

    // ── 4) 旧 schedules.json → items（type='event'），文件退役 ──
    try {
      const schedules = await scheduleStore.listItems()
      for (const s of schedules) {
        if (s.id === undefined || s.id === '' || itemIds.has(String(s.id))) continue
        if (!(registry.cases as Record<string, unknown>)[String(s.caseId ?? '')]) continue
        await itemStore.upsertItem({
          id: String(s.id),
          ownerId: String(s.caseId ?? ''),
          ownerType: 'litigation',
          ownerName: (registry.cases as Record<string, CaseRecord>)[String(s.caseId ?? '')]?.name,
          type: 'event',
          title: String(s.title ?? '日程'),
          kind: s.kind === undefined ? 'case_event' : String(s.kind),
          date: s.date === undefined ? undefined : String(s.date),
          time: s.time === undefined ? undefined : String(s.time),
          status: s.done === true ? 'done' : 'pending',
          source: 'schedules.json',
        })
        itemIds.add(String(s.id))
        summary.mergedSchedules++
      }
      const schedulesFile = join(dataDir, 'schedules.json')
      if (existsSync(schedulesFile)) {
        try {
          await rename(schedulesFile, `${schedulesFile}.legacy`)
          summary.retiredSchedules = true
        } catch (error) {
          // 并发/已退役：ENOENT 视为已完成，不当失败。
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }
    } catch (error) {
      console.warn('[agentlex-litigation] schedules.json 并库失败（原文件保留）:', error)
    }

    try {
      mkdirSync(dataDir, { recursive: true })
      writeFileSync(unifyMarkPath(dataDir), new Date().toISOString(), 'utf8')
    } catch { /* best-effort */ }
  } catch (error) {
    console.warn('[agentlex-litigation] 0.2.12 统一迁移失败（原文件保留，可重试）:', error)
  }
  return summary
}
