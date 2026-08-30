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
import type {
  CaseRecord, CaseRegistry, CaseTask, ChecklistItem, KeyDate, Subtask, TaskGroup,
} from './types.ts'

export type { CaseRecord, CaseRegistry, TaskGroup, CaseTask }

/** Default registry document (empty, v1.0). */
function caseRegistryDefault(): CaseRegistry {
  return { registryVersion: '1.0', cases: {} }
}

/**
 * parties 写盘归一化：工具链路可能把 json 参数以 JSON 字符串传入（issue:
 * 当事人信息不显示——字符串形态落盘导致界面无法渲染）。合法 JSON 字符串 →
 * 解析为对象；解析失败或非字符串 → 原样 clone。
 */
function normalizePartiesInput(value: unknown): Parties | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return JSON.parse(trimmed) as Parties
      } catch {
        /* 非 JSON 字符串：保留原值 */
      }
    }
  }
  return clone(value as Parties)
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
          parties: input.parties === undefined ? undefined : normalizePartiesInput(input.parties),
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
        const merged = { ...clone(current), ...clone(patch), caseId, updatedAt: nowIso() }
        normalizeKeyDates(merged)
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

/** Re-export the local Parties type for the registerCase closure above. */
type Parties = import('./types.ts').Parties
