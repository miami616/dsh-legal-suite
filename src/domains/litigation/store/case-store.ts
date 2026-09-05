/**
 * Case store: the case registry (CaseRegistry document) plus all
 * case-scoped task operations. Single-writer via JsonFileStore.
 *
 * Business rules preserved from AgentLex:
 *   - caseId YYYY-NNN system-assigned (nextCaseId, retried on collision).
 *   - parent task "done" requires all subtasks done (or cascadeSubtasks:true).
 *   - tasks live under named groups (taskGroups[]), ordered by `order`.
 */

import type { Context } from '@deepseek-ai/cordis'
import { assertSafePathSegment, JsonFileStore, clone } from './file-store.ts'
import { childId, keyDateId, nextCaseId, nowIso, taskGroupId, taskId } from './id.ts'
import { normalizePartiesBlock, normalizeOurSide, OUR_SIDE_PRIMARY_ROLE, canonicalRoleOf } from '../party-vocab.ts'
import type {
  CaseRecord, CaseRegistry, CaseTask, ChecklistItem, KeyDate, Parties, Subtask, TaskGroup,
} from './types.ts'

export type { CaseRecord, CaseRegistry, TaskGroup, CaseTask }

/** Default registry document (empty, v1.0). */
function caseRegistryDefault(): CaseRegistry {
  return { registryVersion: '1.0', cases: {} }
}

/**
 * parties 写盘归一化：工具链路可能把 json 参数以 JSON 字符串传入（issue:
 * 当事人信息不显示——字符串形态落盘导致界面无法渲染）。合法 JSON 字符串 →
 * 解析为对象；解析失败或非字符串 → 原样 clone。写路径还做主体去重合并与
 * ourSide 中文化归一（见 party-vocab.ts）——同一主体不重复列当事人。
 */
function normalizePartiesInput(value: unknown, ourSideValue?: unknown): Parties | undefined {
  const raw = typeof value === 'string'
    ? (() => {
      const trimmed = value.trim()
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try { return JSON.parse(trimmed) as Parties } catch { /* 非 JSON 字符串：保留原值 */ }
      }
      return value
    })()
    : value
  const sideKey = normalizeOurSide(ourSideValue ?? (raw as { ourSide?: unknown } | null)?.ourSide)
  const normalized = normalizePartiesBlock(raw)
  if (normalized === undefined) return clone(raw as Parties)
  return normalized as unknown as Parties
}

/** Find a case's task group by id (mutating helper — assumes group exists). */
function findGroup(record: CaseRecord, groupId: string): TaskGroup {
  const group = (record.taskGroups ?? []).find((g) => g.id === groupId)
  if (group === undefined) throw new Error(`task group not found: ${groupId}`)
  return group
}

/** Find a task by id inside a group. */
function findTask(group: TaskGroup, taskIdToFind: string): CaseTask {
  const task = group.tasks.find((t) => t.id === taskIdToFind)
  if (task === undefined) throw new Error(`task not found: ${taskIdToFind}`)
  return task
}

/** Recompute a task's status from its subtasks (parent done ⇒ all subtasks done). */
function syncTaskStatus(task: CaseTask, cascade: boolean): void {
  const subtasks = task.subtasks ?? []
  if (cascade && subtasks.length > 0 && subtasks.every((s) => s.done)) {
    task.status = 'done'
  } else if (task.status === 'done' && subtasks.length > 0 && !subtasks.every((s) => s.done)) {
    task.status = 'doing'
  }
}

/**
 * Normalize one case's keyDates in place:
 *  - backfill a stable `id` for legacy entries that lack one (so toggle_keydate
 *    works on imported data — Issue 附);
 *  - fold legacy AgentLex `completed` boolean into `done` and strip it.
 * Returns true when anything changed (caller decides whether to persist).
 */
function normalizeKeyDates(record: CaseRecord): boolean {
  let changed = false
  for (const kd of record.keyDates ?? []) {
    const legacy = kd as unknown as { id?: string; completed?: unknown; done?: boolean }
    if (legacy.id === undefined || legacy.id === '') {
      legacy.id = keyDateId()
      changed = true
    }
    if (legacy.completed !== undefined) {
      legacy.done = legacy.completed === true
      delete legacy.completed
      changed = true
    }
  }
  return changed
}

/** Whether a case's keyDates need normalization before use. */
function needsKeyDateNormalization(record: CaseRecord): boolean {
  return (record.keyDates ?? []).some((kd) => {
    const legacy = kd as unknown as { id?: string; completed?: unknown }
    return legacy.id === undefined || legacy.id === '' || legacy.completed !== undefined
  })
}

/** Collect key-date ids linked by the tasks of one group. */
function linkedKeyDateIds(group: TaskGroup): string[] {
  const ids: string[] = []
  for (const task of group.tasks) {
    if (task.keyDateId !== undefined) ids.push(task.keyDateId)
  }
  return ids
}

/**
 * The case store surface: registry reads + mutations, each mutation chaining
 * through the single-writer file store and broadcasting a change event.
 */
export interface CaseStore {
  /** Full registry document. */
  readRegistry(): Promise<CaseRegistry>
  /** One case by id. */
  readCase(caseId: string): Promise<CaseRecord | undefined>
  /** Register a new case (caseId assigned; throws on collision). */
  registerCase(input: Record<string, unknown>): Promise<CaseRecord>
  /** Update case fields in place (merge). */
  updateCase(caseId: string, patch: Record<string, unknown>): Promise<CaseRecord>
  /** Delete a case. */
  deleteCase(caseId: string): Promise<{ deleted: boolean }>
  /** Key dates. */
  addKeyDate(caseId: string, label: string, date: string): Promise<CaseRecord>
  toggleKeyDate(caseId: string, keyDateIdToToggle: string): Promise<CaseRecord>
  /** Task groups. */
  upsertTaskGroup(caseId: string, group: Partial<TaskGroup>): Promise<CaseRecord>
  deleteTaskGroup(caseId: string, groupId: string): Promise<CaseRecord>
  reorderTaskGroups(caseId: string, orderedIds: string[]): Promise<CaseRecord>
  /**
   * 0.2.2：从 registry 案件记录剥离 taskGroups 镜像（任务已并入库统一事项）。
   * 一次性并库迁移后调用——registry 从此只存案件元信息/keyDates，不含任务正文。
   * 幂等：无 taskGroups 时直接返回。
   */
  stripTaskGroups(caseId: string): Promise<CaseRecord>
  /** Tasks. */
  upsertTask(caseId: string, groupId: string, task: Partial<CaseTask>): Promise<CaseRecord>
  deleteTask(caseId: string, groupId: string, taskIdToDelete: string): Promise<CaseRecord>
  moveTask(caseId: string, taskIdToMove: string, toGroupId: string, index?: number): Promise<CaseRecord>
  /**
   * Link/unlink a task to a case key-date reminder (task ↔ keydate):
   * enabled creates/syncs a keydate (label=task.title, date=task.deadline) and
   * records its id on the task; disabled removes the linked keydate and clears
   * the link. The linked keydate surfaces in the deadline engine.
   */
  setTaskKeyDate(caseId: string, groupId: string, taskIdToEdit: string, enabled: boolean): Promise<CaseRecord>
  /** Subtasks. */
  upsertSubtask(caseId: string, groupId: string, taskIdToEdit: string, subtask: Partial<Subtask>): Promise<CaseRecord>
  deleteSubtask(caseId: string, groupId: string, taskIdToEdit: string, subtaskId: string): Promise<CaseRecord>
  /** Checklist. */
  upsertChecklist(caseId: string, groupId: string, taskIdToEdit: string, item: Partial<ChecklistItem>): Promise<CaseRecord>
  toggleChecklist(caseId: string, groupId: string, taskIdToEdit: string, checklistId: string): Promise<CaseRecord>
}

/**
 * Create the case store over a data directory.
 * @param dataDir - where case-registry.json lives.
 * @param ctx - host ctx for change broadcasts (optional in tests).
 */
export function createCaseStore(dataDir: string, ctx?: Context): CaseStore {
  const store = new JsonFileStore<CaseRegistry>(
    `${dataDir}/case-registry.json`,
    caseRegistryDefault,
    ctx,
  )

  /** Read a case or throw if missing (normalizes legacy keyDates on read). */
  async function requireCase(caseId: string): Promise<CaseRecord> {
    const reg = await store.read()
    const record = reg.cases[caseId]
    if (record === undefined) throw new Error(`case not found: ${caseId}`)
    if (needsKeyDateNormalization(record)) {
      await persistKeyDateNormalization(caseId)
    }
    const reg2 = await store.read()
    const out = clone(reg2.cases[caseId])
    // 存量/工具链路字符串形态 parties → 解析为对象（issue：当事人信息不显示）。
    // 读路径兜底让历史数据无需手工迁移即可在界面正常渲染。
    const rawParties = (out.parties as unknown) as string | undefined
    if (typeof rawParties === 'string') {
      const trimmed = rawParties.trim()
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          out.parties = JSON.parse(trimmed) as Parties
        } catch {
          /* 非 JSON 字符串：保留原值 */
        }
      }
    }
    return out
  }

  /** Persist id/`completed` backfill for one case's keyDates (Issue 附). */
  async function persistKeyDateNormalization(caseId: string): Promise<void> {
    await store.mutate((reg) => {
      const current = reg.cases[caseId]
      if (current === undefined) return reg
      const next = clone(reg)
      const record = next.cases[caseId]
      const changed = normalizeKeyDates(record)
      if (!changed) return reg
      record.updatedAt = record.updatedAt ?? nowIso()
      next.lastUpdated = record.updatedAt
      return next
    }, 'case', caseId, 'keydate-normalize')
  }

  /** Keep a linked keydate in step with its task (title / deadline edits). */
  function syncLinkedKeyDate(record: CaseRecord, task: CaseTask): void {
    if (task.remindKeyDate !== true || task.keyDateId === undefined) return
    const kd = (record.keyDates ?? []).find((k) => k.id === task.keyDateId)
    if (kd === undefined) return
    kd.label = task.title
    if (task.deadline !== undefined && task.deadline !== '') kd.date = task.deadline
    kd.updatedAt = nowIso()
  }

  return {
    async readRegistry(): Promise<CaseRegistry> {
      const reg = await store.read()
      const anyLegacy = Object.values(reg.cases).some((c) => needsKeyDateNormalization(c))
      if (!anyLegacy) return reg
      await store.mutate((doc) => {
        const next = clone(doc)
        let changed = false
        for (const rec of Object.values(next.cases)) {
          if (normalizeKeyDates(rec)) changed = true
        }
        if (!changed) return doc
        next.lastUpdated = nowIso()
        return next
      }, 'cases', undefined, 'keydate-normalize-all')
      return store.read()
    },

    async readCase(caseId: string): Promise<CaseRecord | undefined> {
      assertSafePathSegment(caseId, 'caseId')
      const reg = await store.read()
      const record = reg.cases[caseId]
      if (record === undefined) return undefined
      if (needsKeyDateNormalization(record)) {
        await persistKeyDateNormalization(caseId)
      }
      const reg2 = await store.read()
      return clone(reg2.cases[caseId])
    },

    async registerCase(input: Record<string, unknown>): Promise<CaseRecord> {
      const now = nowIso()
      // Respect an explicit caseId from the caller (AgentLex import carries
      // its own YYYY-NNN ids); otherwise assign the next per-year number.
      const explicitId = input.caseId === undefined ? undefined : String(input.caseId)
      let record: CaseRecord | undefined
      await store.mutate((reg) => {
        const next = clone(reg)
        const caseId = explicitId !== undefined && explicitId !== ''
          ? (next.cases[explicitId] !== undefined
            ? (() => { throw new Error(`case id collision: ${explicitId}`) })()
            : explicitId)
          : nextCaseId(next.cases)
        if (next.cases[caseId] !== undefined) {
          throw new Error(`case id collision: ${caseId}`)
        }
        const created: CaseRecord = {
          caseId,
          name: String(input.name ?? '未命名案件'),
          type: String(input.type ?? '其他'),
          cause: input.cause === undefined ? undefined : String(input.cause),
          status: input.status === undefined ? undefined : String(input.status),
          court: input.court === undefined ? undefined : String(input.court),
          judge: input.judge === undefined ? undefined : String(input.judge),
          level: input.level === undefined ? undefined : String(input.level),
          caseNumber: input.caseNumber === undefined ? undefined : String(input.caseNumber),
          claimAmount: input.claimAmount === undefined ? undefined : String(input.claimAmount),
          filingDate: input.filingDate === undefined ? undefined : String(input.filingDate),
          ourSide: input.ourSide === undefined ? undefined : String(input.ourSide),
          summary: input.summary === undefined ? undefined : String(input.summary),
          folder: input.folder === undefined ? undefined : String(input.folder),
          alias: input.alias === undefined ? undefined : clone(input.alias as string[] | undefined),
          parties: input.parties === undefined ? undefined : normalizePartiesInput(input.parties, input.ourSide),
          instances: input.instances === undefined ? undefined : clone(input.instances as Array<Record<string, unknown>> | undefined),
          fee: input.fee === undefined ? undefined : String(input.fee),
          retainerUnit: input.retainerUnit === undefined ? undefined : String(input.retainerUnit),
          tags: input.tags === undefined ? undefined : clone(input.tags as string[] | undefined),
          archived: input.archived === undefined ? undefined : Boolean(input.archived),
          keyDates: input.keyDates === undefined ? [] : clone(input.keyDates as KeyDate[] | undefined) ?? [],
          taskGroups: input.taskGroups === undefined ? [] : clone(input.taskGroups as TaskGroup[] | undefined) ?? [],
          boundSessions: input.boundSessions === undefined ? [] : clone(input.boundSessions as string[] | undefined) ?? [],
          linkedContracts: input.linkedContracts === undefined ? [] : clone(input.linkedContracts as string[] | undefined) ?? [],
          linkedResearch: input.linkedResearch === undefined ? [] : clone(input.linkedResearch as string[] | undefined) ?? [],
          createdAt: now,
          updatedAt: now,
        }
        normalizeKeyDates(created)
        // 建案即建首个审级节点：level 已定且未显式传 instances 时自动生成，
        // 回填案号/法院/承办法官/立案日期/双方当事人（备忘录 #14 审级历程缺信息——
        // 新建案件信息齐全却审级面板缺数据，根因之一就是 register 不建首节点）。
        const regLevel = String(input.level ?? '').trim()
        const hasExplicitInstances = Array.isArray(input.instances) && input.instances.length > 0
        if (regLevel !== '' && !hasExplicitInstances) {
          const node = buildInstanceNodeFromRecord(created, regLevel, input.status === undefined ? undefined : String(input.status))
          if (Object.keys(node).length > 1) created.instances = [node] // 至少含 level+1 字段才有意义
        }
        next.cases[caseId] = created
        next.lastUpdated = now
        record = clone(created)
        return next
      }, 'cases', undefined, 'register')
      return record!
    },

    async updateCase(caseId: string, patch: Record<string, unknown>): Promise<CaseRecord> {
      assertSafePathSegment(caseId, 'caseId')
      let record: CaseRecord | undefined
      await store.mutate((reg) => {
        const current = reg.cases[caseId]
        if (current === undefined) throw new Error(`case not found: ${caseId}`)
        const next = clone(reg)
        // parties 写路径归一：先归一 patch 里的 parties（主体去重、ourSide 中文化），
        // 再与现案合并——避免合并后才去重造成多次往返或对存量重复行无感知。
        const normalizedPatch = { ...patch }
        if (patch.parties !== undefined) {
          const partiesSide = patch.ourSide ?? (patch.parties as { ourSide?: unknown } | null)?.ourSide
          normalizedPatch.parties = normalizePartiesInput(patch.parties, partiesSide)
        }
        const merged = { ...clone(current), ...clone(normalizedPatch), caseId, updatedAt: nowIso() }
        normalizeKeyDates(merged)
        // 审级历程自动同步：patch 携带 level 时，若该审级不在 instances 历程里，
        // 自动追加节点。让管家只需设 level（如 一审→二审），审级历程面板自动补全。
        // 新节点回填当前案件已知信息（案号/法院/承办法官/立案日期/我方当事人），
        // 管家无需在每级重复登记这些跨审级不变的信息（备忘录：#1 审级面板相关
        // 信息缺失）。
        const levelValue = patch.level === undefined ? undefined : String(patch.level).trim()
        if (levelValue !== undefined && levelValue !== '') {
          const instances = merged.instances ?? []
          const has = instances.some((inst) => String(inst.level ?? '').trim() === levelValue)
          if (!has) {
            const node = buildInstanceNodeFromRecord(merged, levelValue, patch.status === undefined ? undefined : String(patch.status))
            merged.instances = [...instances, node]
          }
        }
        next.cases[caseId] = merged
        next.lastUpdated = merged.updatedAt
        record = clone(merged)
        return next
      }, 'case', caseId, 'update')
      return record!
    },

    async deleteCase(caseId: string): Promise<{ deleted: boolean }> {
      assertSafePathSegment(caseId, 'caseId')
      let deleted = false
      await store.mutate((reg) => {
        if (reg.cases[caseId] === undefined) return reg
        const next = clone(reg)
        delete next.cases[caseId]
        next.lastUpdated = nowIso()
        deleted = true
        return next
      }, 'cases', caseId, 'delete')
      return { deleted }
    },

    async addKeyDate(caseId: string, label: string, date: string): Promise<CaseRecord> {
      const now = nowIso()
      await store.mutate((reg) => {
        const current = reg.cases[caseId]
        if (current === undefined) throw new Error(`case not found: ${caseId}`)
        const next = clone(reg)
        const record = next.cases[caseId]
        record.keyDates = [...(record.keyDates ?? []), { id: keyDateId(), label, date, done: false, createdAt: now, updatedAt: now } satisfies KeyDate]
        record.updatedAt = now
        next.lastUpdated = now
        return next
      }, 'case', caseId, 'keydate-add')
      return requireCase(caseId)
    },

    async toggleKeyDate(caseId: string, keyDateIdToToggle: string): Promise<CaseRecord> {
      await store.mutate((reg) => {
        const current = reg.cases[caseId]
        if (current === undefined) throw new Error(`case not found: ${caseId}`)
        const next = clone(reg)
        const record = next.cases[caseId]
        const kd = (record.keyDates ?? []).find((k) => k.id === keyDateIdToToggle)
        if (kd !== undefined) kd.done = !kd.done
        record.updatedAt = nowIso()
        next.lastUpdated = record.updatedAt
        return next
      }, 'case', caseId, 'keydate-toggle')
      return requireCase(caseId)
    },

    async upsertTaskGroup(caseId: string, group: Partial<TaskGroup>): Promise<CaseRecord> {
      const now = nowIso()
      await store.mutate((reg) => {
        const current = reg.cases[caseId]
        if (current === undefined) throw new Error(`case not found: ${caseId}`)
        const next = clone(reg)
        const record = next.cases[caseId]
        const groups = record.taskGroups ?? []
        // upsert 契约：id 存在则更新，不存在（或未提供）则新建。
        const gid = group.id === undefined ? taskGroupId() : String(group.id)
        const existing = groups.find((g) => g.id === gid)
        if (existing !== undefined) {
          Object.assign(existing, { ...clone(group), id: gid, updatedAt: now })
        } else {
          groups.push({
            id: gid,
            name: String(group.name ?? '新阶段'),
            order: groups.length,
            tasks: [],
            createdAt: now,
            updatedAt: now,
          })
        }
        record.taskGroups = groups
        record.updatedAt = now
        next.lastUpdated = now
        return next
      }, 'tasks', caseId, 'group-upsert')
      return requireCase(caseId)
    },

    async deleteTaskGroup(caseId: string, groupId: string): Promise<CaseRecord> {
      await store.mutate((reg) => {
        const current = reg.cases[caseId]
        if (current === undefined) throw new Error(`case not found: ${caseId}`)
        const next = clone(reg)
        const record = next.cases[caseId]
        const group = (record.taskGroups ?? []).find((g) => g.id === groupId)
        // Remove key dates that were derived from tasks of the deleted group
        // (task ↔ keydate 解除不彻底 — deleting the carrier must not orphan its reminder).
        const linkedIds = group === undefined ? [] : linkedKeyDateIds(group)
        record.taskGroups = (record.taskGroups ?? []).filter((g) => g.id !== groupId)
        if (linkedIds.length > 0) {
          record.keyDates = (record.keyDates ?? []).filter((k) => !linkedIds.includes(k.id))
        }
        record.updatedAt = nowIso()
        next.lastUpdated = record.updatedAt
        return next
      }, 'tasks', caseId, 'group-delete')
      return requireCase(caseId)
    },

    async stripTaskGroups(caseId: string): Promise<CaseRecord> {
      await store.mutate((reg) => {
        const current = reg.cases[caseId]
        if (current === undefined) throw new Error(`case not found: ${caseId}`)
        const next = clone(reg)
        const record = next.cases[caseId]
        if (record.taskGroups === undefined || record.taskGroups.length === 0) return reg
        record.taskGroups = []
        record.updatedAt = nowIso()
        next.lastUpdated = record.updatedAt
        return next
      }, 'cases', caseId, 'strip-registry-taskgroups')
      return requireCase(caseId)
    },

    async reorderTaskGroups(caseId: string, orderedIds: string[]): Promise<CaseRecord> {
      await store.mutate((reg) => {
        const current = reg.cases[caseId]
        if (current === undefined) throw new Error(`case not found: ${caseId}`)
        const next = clone(reg)
        const record = next.cases[caseId]
        const byId = new Map((record.taskGroups ?? []).map((g) => [g.id, g]))
        record.taskGroups = orderedIds
          .map((id, index) => { const g = byId.get(id); if (g !== undefined) g.order = index; return g })
          .filter((g): g is TaskGroup => g !== undefined)
        record.updatedAt = nowIso()
        next.lastUpdated = record.updatedAt
        return next
      }, 'tasks', caseId, 'groups-reorder')
      return requireCase(caseId)
    },

    async upsertTask(caseId: string, groupId: string, task: Partial<CaseTask>): Promise<CaseRecord> {
      const now = nowIso()
      await store.mutate((reg) => {
        const current = reg.cases[caseId]
        if (current === undefined) throw new Error(`case not found: ${caseId}`)
        const next = clone(reg)
        const record = next.cases[caseId]
        const group = findGroup(record, groupId)
        // upsert 契约：id 存在则更新，不存在（或未提供）则新建。
        const tid = task.id === undefined ? taskId() : String(task.id)
        const existing = group.tasks.find((t) => t.id === tid)
        if (existing !== undefined) {
          Object.assign(existing, { ...clone(task), id: tid, updatedAt: now })
          syncLinkedKeyDate(record, existing)
        } else {
          group.tasks.push({
            id: tid,
            title: String(task.title ?? '新任务'),
            // BUG-2: persist an explicit deadline and a caller-supplied status
            // instead of silently dropping them / forcing 'todo'.
            deadline: task.deadline === undefined ? undefined : String(task.deadline),
            time: task.time === undefined ? undefined : String(task.time),
            status: (task.status as CaseTask['status']) ?? 'todo',
            priority: (task.priority as CaseTask['priority']) ?? 'medium',
            // 新建分支此前未透传 detail —— 建案时写的任务说明被静默丢弃
            // （内置参考案例的任务详情因此全为空）。一并透传 templateTitle，
            // 让阶段模板展开的任务可被追溯（管家改名后不会被重复创建）。
            detail: task.detail === undefined ? undefined : String(task.detail),
            templateTitle: task.templateTitle === undefined ? undefined : String(task.templateTitle),
            remindKeyDate: task.remindKeyDate === undefined ? undefined : Boolean(task.remindKeyDate),
            keyDateId: task.keyDateId === undefined ? undefined : String(task.keyDateId),
            subtasks: [],
            checklist: [],
            createdAt: now,
            updatedAt: now,
          })
          syncLinkedKeyDate(record, group.tasks[group.tasks.length - 1]!)
        }
        record.updatedAt = now
        next.lastUpdated = now
        return next
      }, 'tasks', caseId, 'task-upsert')
      return requireCase(caseId)
    },

    async deleteTask(caseId: string, groupId: string, taskIdToDelete: string): Promise<CaseRecord> {
      await store.mutate((reg) => {
        const current = reg.cases[caseId]
        if (current === undefined) throw new Error(`case not found: ${caseId}`)
        const next = clone(reg)
        const record = next.cases[caseId]
        const group = findGroup(record, groupId)
        const task = group.tasks.find((t) => t.id === taskIdToDelete)
        // Remove the key date derived from the deleted task (task ↔ keydate
        // 解除不彻底 — deleting the carrier must not orphan its reminder).
        if (task?.keyDateId !== undefined) {
          record.keyDates = (record.keyDates ?? []).filter((k) => k.id !== task.keyDateId)
        }
        group.tasks = group.tasks.filter((t) => t.id !== taskIdToDelete)
        record.updatedAt = nowIso()
        next.lastUpdated = record.updatedAt
        return next
      }, 'tasks', caseId, 'task-delete')
      return requireCase(caseId)
    },

    async moveTask(caseId: string, taskIdToMove: string, toGroupId: string, index?: number): Promise<CaseRecord> {
      await store.mutate((reg) => {
        const current = reg.cases[caseId]
        if (current === undefined) throw new Error(`case not found: ${caseId}`)
        const next = clone(reg)
        const record = next.cases[caseId]
        const fromGroup = (record.taskGroups ?? []).find((g) => g.tasks.some((t) => t.id === taskIdToMove))
        if (fromGroup === undefined) throw new Error(`task not found: ${taskIdToMove}`)
        const task = findTask(fromGroup, taskIdToMove)
        fromGroup.tasks = fromGroup.tasks.filter((t) => t.id !== taskIdToMove)
        const toGroup = findGroup(record, toGroupId)
        const at = index === undefined ? toGroup.tasks.length : Math.max(0, Math.min(index, toGroup.tasks.length))
        toGroup.tasks.splice(at, 0, task)
        record.updatedAt = nowIso()
        next.lastUpdated = record.updatedAt
        return next
      }, 'tasks', caseId, 'task-move')
      return requireCase(caseId)
    },

    async setTaskKeyDate(caseId: string, groupId: string, taskIdToEdit: string, enabled: boolean): Promise<CaseRecord> {
      await store.mutate((reg) => {
        const current = reg.cases[caseId]
        if (current === undefined) throw new Error(`case not found: ${caseId}`)
        const next = clone(reg)
        const record = next.cases[caseId]
        const group = findGroup(record, groupId)
        const task = findTask(group, taskIdToEdit)
        if (enabled) {
          if (task.deadline === undefined || task.deadline === '') {
            throw new Error('task has no deadline: set a deadline before enabling a key-date reminder')
          }
          const existing = (record.keyDates ?? []).find((k) => k.id === task.keyDateId)
          if (existing !== undefined) {
            // Already linked — keep the same id, sync label/date from the task.
            existing.label = task.title
            existing.date = task.deadline
            existing.updatedAt = nowIso()
          } else {
            const kd: KeyDate = {
              id: keyDateId(), label: task.title, date: task.deadline, done: false, createdAt: nowIso(), updatedAt: nowIso(),
            }
            record.keyDates = [...(record.keyDates ?? []), kd]
            task.keyDateId = kd.id
          }
          task.remindKeyDate = true
        } else {
          if (task.keyDateId !== undefined) {
            record.keyDates = (record.keyDates ?? []).filter((k) => k.id !== task.keyDateId)
          } else if (task.remindKeyDate === true && task.deadline !== undefined && task.deadline !== '') {
            // Orphan sweep (Issue 4 hardening): a derived keydate whose link was
            // lost (created by an older build / imported data). Remove a same
            // label+date keydate that no other task still references.
            const referenced = new Set<string>()
            for (const g of record.taskGroups ?? []) {
              for (const t of g.tasks) {
                if (t.id !== task.id && t.keyDateId !== undefined) referenced.add(t.keyDateId)
              }
            }
            record.keyDates = (record.keyDates ?? []).filter((k) => {
              if (referenced.has(k.id)) return true
              return !(k.label === task.title && k.date === task.deadline)
            })
          }
          task.keyDateId = undefined
          task.remindKeyDate = false
        }
        task.updatedAt = nowIso()
        record.updatedAt = nowIso()
        next.lastUpdated = record.updatedAt
        return next
      }, 'tasks', caseId, 'task-keydate')
      return requireCase(caseId)
    },

    async upsertSubtask(caseId: string, groupId: string, taskIdToEdit: string, subtask: Partial<Subtask>): Promise<CaseRecord> {
      const now = nowIso()
      await store.mutate((reg) => {
        const current = reg.cases[caseId]
        if (current === undefined) throw new Error(`case not found: ${caseId}`)
        const next = clone(reg)
        const record = next.cases[caseId]
        const group = findGroup(record, groupId)
        const task = findTask(group, taskIdToEdit)
        const subtasks = task.subtasks ?? []
        // upsert 契约：id 存在则更新，不存在（或未提供）则新建。
        const sid = subtask.id === undefined ? childId('sub') : String(subtask.id)
        const existing = subtasks.find((s) => s.id === sid)
        if (existing !== undefined) {
          Object.assign(existing, { ...clone(subtask), id: sid, updatedAt: now })
        } else {
          subtasks.push({
            id: sid,
            title: String(subtask.title ?? '子任务'),
            detail: subtask.detail === undefined ? undefined : String(subtask.detail),
            deadline: subtask.deadline === undefined ? undefined : String(subtask.deadline),
            done: subtask.done === undefined ? false : Boolean(subtask.done),
            createdAt: now,
            updatedAt: now,
          })
        }
        task.subtasks = subtasks
        syncTaskStatus(task, false)
        record.updatedAt = now
        next.lastUpdated = now
        return next
      }, 'tasks', caseId, 'subtask-upsert')
      return requireCase(caseId)
    },

    async deleteSubtask(caseId: string, groupId: string, taskIdToEdit: string, subtaskId: string): Promise<CaseRecord> {
      await store.mutate((reg) => {
        const current = reg.cases[caseId]
        if (current === undefined) throw new Error(`case not found: ${caseId}`)
        const next = clone(reg)
        const record = next.cases[caseId]
        const group = findGroup(record, groupId)
        const task = findTask(group, taskIdToEdit)
        task.subtasks = (task.subtasks ?? []).filter((s) => s.id !== subtaskId)
        syncTaskStatus(task, false)
        record.updatedAt = nowIso()
        next.lastUpdated = record.updatedAt
        return next
      }, 'tasks', caseId, 'subtask-delete')
      return requireCase(caseId)
    },

    async upsertChecklist(caseId: string, groupId: string, taskIdToEdit: string, item: Partial<ChecklistItem>): Promise<CaseRecord> {
      const now = nowIso()
      await store.mutate((reg) => {
        const current = reg.cases[caseId]
        if (current === undefined) throw new Error(`case not found: ${caseId}`)
        const next = clone(reg)
        const record = next.cases[caseId]
        const group = findGroup(record, groupId)
        const task = findTask(group, taskIdToEdit)
        const checklist = task.checklist ?? []
        // upsert 契约：id 存在则更新，不存在（或未提供）则新建。
        const cid = item.id === undefined ? childId('chk') : String(item.id)
        const existing = checklist.find((c: ChecklistItem) => c.id === cid)
        if (existing !== undefined) {
          Object.assign(existing, { ...clone(item), id: cid, updatedAt: now })
        } else {
          checklist.push({
            id: cid,
            text: String(item.text ?? '检查项'),
            done: item.done === undefined ? false : Boolean(item.done),
            createdAt: now,
            updatedAt: now,
          })
        }
        task.checklist = checklist
        record.updatedAt = now
        next.lastUpdated = now
        return next
      }, 'tasks', caseId, 'checklist-upsert')
      return requireCase(caseId)
    },

    async toggleChecklist(caseId: string, groupId: string, taskIdToEdit: string, checklistIdToToggle: string): Promise<CaseRecord> {
      await store.mutate((reg) => {
        const current = reg.cases[caseId]
        if (current === undefined) throw new Error(`case not found: ${caseId}`)
        const next = clone(reg)
        const record = next.cases[caseId]
        const group = findGroup(record, groupId)
        const task = findTask(group, taskIdToEdit)
        const item = (task.checklist ?? []).find((c: ChecklistItem) => c.id === checklistIdToToggle)
        if (item !== undefined) item.done = !item.done
        record.updatedAt = nowIso()
        next.lastUpdated = record.updatedAt
        return next
      }, 'tasks', caseId, 'checklist-toggle')
      return requireCase(caseId)
    },
  }
}

/**
 * 从案件记录里解析「我方」当事人（party-vocab 的读侧辅助，case-store 内联版，
 * 避免环形 import）。ourClient 标记优先，其次按 ourSide 主角色命中角色列。
 */
function findOurPartyRowFromRecord(record: { parties?: Parties | null; ourSide?: string }): { name: string; role: string } | undefined {
  const details = Array.isArray(record.parties?.details) ? record.parties!.details! : []
  if (details.length === 0) return undefined
  const marked = details.find((p) => p.ourClient === true)
  if (marked !== undefined && String(marked.name ?? '').trim() !== '') {
    return { name: String(marked.name), role: String(marked.role ?? '') }
  }
  const sideKey = normalizeOurSide(record.ourSide ?? record.parties?.ourSide)
  const primary = OUR_SIDE_PRIMARY_ROLE[sideKey] ?? ''
  if (primary === '') {
    const first = details[0]!
    return { name: String(first.name ?? ''), role: String(first.role ?? '') }
  }
  for (const p of details) {
    const roles = Array.isArray(p.roles) ? (p.roles as unknown[]).map(String) : [p.role]
    const hit = roles.some((role) => canonicalRoleOf(String(role)) === primary)
    if (hit) return { name: String(p.name ?? ''), role: String(p.role ?? '') }
  }
  return undefined
}

/**
 * 从案件记录构建一个审级历程节点（备忘录 #14：审级历程缺信息）。
 * 回填：案号/法院/承办法官/立案日期 + **双方**当事人姓名。
 * 双方抽取不依赖「我方」判断：从 parties.details 按角色侧分别取原告与被告；
 * 某侧缺失且无法判定时留空（不臆断），由 InstanceForm/管家后续补全。
 */
function buildInstanceNodeFromRecord(record: CaseRecord, level: string, status?: string): Record<string, unknown> {
  const node: Record<string, unknown> = { level }
  if (status !== undefined && status !== '') node.status = status
  if (record.caseNumber !== undefined && String(record.caseNumber).trim() !== '') node.caseNo = String(record.caseNumber).trim()
  if (record.court !== undefined && String(record.court).trim() !== '') node.court = String(record.court).trim()
  if (record.judge !== undefined && String(record.judge).trim() !== '') node.judge = String(record.judge).trim()
  if (record.filingDate !== undefined && String(record.filingDate).trim() !== '') node.filedAt = String(record.filingDate).trim()
  const details = Array.isArray(record.parties?.details) ? record.parties!.details! : []
  const partyOfSide = (sideRoles: string[]): { name?: unknown; role?: unknown } | undefined =>
    details.find((p) => {
      const roles = Array.isArray(p.roles) ? (p.roles as unknown[]).map(String) : [p.role]
      return roles.some((r) => sideRoles.includes(canonicalRoleOf(String(r))))
    })
  const plaintiffRow = partyOfSide(['原告', '申请人', '申请执行人', '上诉人'])
  const defendantRow = partyOfSide(['被告', '被申请人', '被执行人', '被上诉人'])
  if (plaintiffRow !== undefined && String(plaintiffRow.name ?? '').trim() !== '') node.plaintiff = String(plaintiffRow.name).trim()
  if (defendantRow !== undefined && String(defendantRow.name ?? '').trim() !== '') node.defendant = String(defendantRow.name).trim()
  return node
}
