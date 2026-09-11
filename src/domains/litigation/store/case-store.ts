/**
 * Case store: the case registry (CaseRegistry document) plus all
 * case-scoped task/key-date operations.
 *
 * 0.2.12「全面完整统一」：case-registry.json 只存**案件元信息**（当事人/案号/
 * 法院/审级/卷宗路径…）。任务、事件、关键日期一律存 items.json（唯一真相源）：
 *   - 写：本 store 的 task/keyDate 方法全部委托 itemStore（不再有第二个写入口）；
 *   - 读：readCase / readRegistry 从 items 实时装配 keyDates + taskGroups，
 *     所有既有消费方（期限汇总/健康检查/阶段检测/读接口/GUI）拿到的形状不变，
 *     但盘上只有一处存储。
 *
 * Business rules preserved from AgentLex:
 *   - caseId YYYY-NNN system-assigned (nextCaseId, retried on collision).
 *   - parent task "done" requires all subtasks done (or cascadeSubtasks:true).
 *   - 任务按阶段组（items.groups）分组，组内顺序由 order 决定。
 */

import type { Context } from '@deepseek-ai/cordis'
import { assertSafePathSegment, JsonFileStore, clone } from './file-store.ts'
import { childId, nextCaseId, nowIso } from './id.ts'
import { normalizePartiesBlock, normalizeOurSide, OUR_SIDE_PRIMARY_ROLE, canonicalRoleOf } from '../party-vocab.ts'
import type { ItemStore } from '../../item/store/item-store.ts'
import type { Item } from '../../item/store/types.ts'
import { isKeyDateItem, isTaskItem } from '../../item/store/types.ts'
import { buildOwnerTaskGroups, itemToKeyDate, itemToLegacyTask } from '../../item/shape.ts'
import type {
  CaseRecord, CaseRegistry, CaseTask, ChecklistItem, KeyDate, Parties, PeriodGate, Subtask, TaskGroup,
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

/**
 * Recompute a task's status from its subtasks (parent done ⇒ all subtasks done).
 * 统一存储后子项在 items.json，父任务状态仍按同一条规则回算（保持旧行为）。
 */
function recomputeTaskStatus(subtasks: Array<{ done?: boolean }>, current: string): string {
  if (current === 'done' && subtasks.length > 0 && !subtasks.every((s) => s.done === true)) return 'doing'
  return current
}

/** 旧 task 状态（todo/in_progress/done）→ 统一事项状态。 */
function toItemStatus(status: unknown): 'pending' | 'doing' | 'done' {
  const s = String(status ?? '')
  if (s === 'done') return 'done'
  if (s === 'doing' || s === 'in_progress') return 'doing'
  return 'pending'
}

/** Collect key-date ids linked by the tasks of one group（items 版）。 */
function linkedKeyDateIds(tasks: Item[]): string[] {
  const ids: string[] = []
  for (const task of tasks) {
    if (task.keyDateId !== undefined && task.keyDateId !== '') ids.push(task.keyDateId)
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
  /**
   * 盘上原始 registry（**不**从 items 装配 keyDates/taskGroups）。
   * 仅供一次性迁移读取历史残留字段；业务读路径一律用 readRegistry()。
   */
  readRegistryRaw(): Promise<CaseRegistry>
  /** One case by id. */
  readCase(caseId: string): Promise<CaseRecord | undefined>
  /** Register a new case (caseId assigned; throws on collision). */
  registerCase(input: Record<string, unknown>): Promise<CaseRecord>
  /** Update case fields in place (merge). */
  updateCase(caseId: string, patch: Record<string, unknown>): Promise<CaseRecord>
  /**
   * 清除状态变更挂起的待展开标记（pendingExpand）。
   * 不能用 updateCase({ pendingExpand: undefined })——JSON clone 会丢 undefined
   * 键，字段无法借 merge 删除；此方法显式删除。
   */
  clearPendingExpand(caseId: string): Promise<CaseRecord>
  /** 落法定期限闸门标记（0.2.12）。 */
  setPeriodGate(caseId: string, gate: PeriodGate): Promise<CaseRecord>
  /** 清除法定期限闸门标记（期限登记齐了 / 已结案）。 */
  clearPeriodGate(caseId: string): Promise<CaseRecord>
  /** 确认闸门（不再提醒）：用于确实无需在本案登记期限的情形；传 undefined 取消确认。 */
  setPeriodGateMuted(caseId: string, muted: { at: string; reason?: string } | undefined): Promise<CaseRecord>
  /** Delete a case. */
  deleteCase(caseId: string): Promise<{ deleted: boolean }>
  /** Key dates. */
  /**
   * 登记关键日程。`meta` 供期限规则表派生登记传审计字段（ruleId/baseDate/cite/
   * computeTrace）——带 ruleId+baseDate 时按该组合幂等更新，不新增重复行。
   */
  addKeyDate(caseId: string, label: string, date: string, meta?: Partial<KeyDate>): Promise<CaseRecord>
  toggleKeyDate(caseId: string, keyDateIdToToggle: string): Promise<CaseRecord>
  /**
   * 删除一条关键日期（0.2.12）。
   * 为什么需要：脏记录/录错的关键日期此前**没有任何删除入口**，只能手工改 JSON。
   * 记录不实的关键日期比缺失更有害——它会让「闸门/巡检」基于假事实报警。
   */
  deleteKeyDate(caseId: string, keyDateId: string): Promise<CaseRecord>
  /** Task groups. */
  upsertTaskGroup(caseId: string, group: Partial<TaskGroup>): Promise<CaseRecord>
  deleteTaskGroup(caseId: string, groupId: string): Promise<CaseRecord>
  reorderTaskGroups(caseId: string, orderedIds: string[]): Promise<CaseRecord>
  /**
   * 0.2.2：从 registry 案件记录剥离 taskGroups 镜像（任务已并入库统一事项）。
   * 幂等：无 taskGroups 时直接返回。
   * ⚠ 只剥 taskGroups，**不动 keyDates**——keyDates 由 0.2.12 统一迁移负责并入
   * items，若在此处一并删掉会造成关键日期静默丢失。
   */
  stripTaskGroups(caseId: string): Promise<CaseRecord>
  /**
   * 0.2.12：剥离 registry 里**全部**第二份存储字段（taskGroups + keyDates）。
   * 只在 keyDates 已确认并入 items 之后调用（unify-store 迁移末段）。
   */
  stripLegacyFields(caseId: string): Promise<CaseRecord>
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
 * @param itemStore - 统一事项 store（唯一真相源）。任务/事件/关键日期都在这里，
 *   本 store 只存案件元信息；缺省时任务与关键日期方法会抛错（0.2.12 起必须提供）。
 */
export function createCaseStore(dataDir: string, ctx?: Context, itemStore?: ItemStore): CaseStore {
  const store = new JsonFileStore<CaseRegistry>(
    `${dataDir}/case-registry.json`,
    caseRegistryDefault,
    ctx,
  )

  /** 统一事项 store；缺省即配置错误（0.2.12 起任务/关键日期只有 items 一处）。 */
  function items(): ItemStore {
    if (itemStore === undefined) {
      throw new Error('case-store: itemStore is required (0.2.12 统一存储) — 任务与关键日期只存 items.json')
    }
    return itemStore
  }

  /** 把一条 registry 记录补上从 items 派生的 keyDates / taskGroups（只读装配）。 */
  async function hydrate(record: CaseRecord): Promise<CaseRecord> {
    const out = clone(record)
    if (itemStore === undefined) return out
    const [groups, allItems] = await Promise.all([itemStore.listGroups(), itemStore.listItems()])
    const own = allItems.filter((i) => i.ownerId === record.caseId && (i.ownerType ?? 'litigation') === 'litigation')
    out.keyDates = own.filter(isKeyDateItem).map((i) => itemToKeyDate(i) as unknown as KeyDate)
    out.taskGroups = buildOwnerTaskGroups(record.caseId, 'litigation', groups, allItems) as unknown as TaskGroup[]
    return out
  }

  /** Read a case or throw if missing. */
  async function requireCase(caseId: string): Promise<CaseRecord> {
    const reg = await store.read()
    const record = reg.cases[caseId]
    if (record === undefined) throw new Error(`case not found: ${caseId}`)
    const out = await hydrate(record)
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

  /** 任务 → 统一事项（写路径共用）。 */
  function taskToItem(caseId: string, groupId: string, task: Partial<CaseTask>, groupName?: string): Partial<Item> {
    return {
      ...(task.id === undefined ? {} : { id: String(task.id) }),
      ownerId: caseId,
      ownerType: 'litigation',
      type: 'task',
      title: String(task.title ?? '新任务'),
      date: task.deadline === undefined ? undefined : String(task.deadline),
      time: task.time === undefined ? undefined : String(task.time),
      detail: task.detail === undefined ? undefined : String(task.detail),
      status: toItemStatus(task.status),
      priority: (task.priority as Item['priority']) ?? 'medium',
      groupId: groupId === '' ? undefined : groupId,
      groupName,
      templateTitle: task.templateTitle === undefined ? undefined : String(task.templateTitle),
      remindKeyDate: task.remindKeyDate === true ? true : undefined,
      keyDateId: task.keyDateId === undefined ? undefined : String(task.keyDateId),
      subtasks: Array.isArray(task.subtasks) ? clone(task.subtasks) as unknown as Item['subtasks'] : undefined,
      checklist: Array.isArray(task.checklist) ? clone(task.checklist) as unknown as Item['checklist'] : undefined,
    }
  }

  /** 任务 ↔ 关键日期联动：把任务标题/截止日同步到它派生的 keydate 事项。 */
  async function syncLinkedKeyDate(task: Item): Promise<void> {
    if (task.remindKeyDate !== true || task.keyDateId === undefined || task.keyDateId === '') return
    const kd = await itemStore!.readItem(task.keyDateId)
    if (kd === undefined) return
    await itemStore!.upsertItem({
      id: kd.id,
      title: task.title,
      ...(task.date !== undefined && task.date !== '' ? { date: task.date } : {}),
    })
  }

  /** 子项变更后回算父任务状态（父 done 但仍有未完成子项 → 退回 doing）。 */
  async function resyncTaskStatus(taskIdToEdit: string): Promise<void> {
    const is = items()
    const task = await is.readItem(taskIdToEdit)
    if (task === undefined) return
    const next = recomputeTaskStatus(task.subtasks ?? [], task.status)
    if (next !== task.status) await is.upsertItem({ id: taskIdToEdit, status: next as Item['status'] })
  }

  return {
    async readRegistry(): Promise<CaseRegistry> {
      const reg = await store.read()
      if (itemStore === undefined) return reg
      const [groups, allItems] = await Promise.all([itemStore.listGroups(), itemStore.listItems()])
      const next: CaseRegistry = { ...reg, cases: {} }
      for (const [id, rec] of Object.entries(reg.cases)) {
        const own = allItems.filter((i) => i.ownerId === id && (i.ownerType ?? 'litigation') === 'litigation')
        next.cases[id] = {
          ...clone(rec),
          keyDates: own.filter(isKeyDateItem).map((i) => itemToKeyDate(i) as unknown as KeyDate),
          taskGroups: buildOwnerTaskGroups(id, 'litigation', groups, allItems) as unknown as TaskGroup[],
        }
      }
      return next
    },

    async readCase(caseId: string): Promise<CaseRecord | undefined> {
      assertSafePathSegment(caseId, 'caseId')
      const reg = await store.read()
      const record = reg.cases[caseId]
      if (record === undefined) return undefined
      return requireCase(caseId)
    },

    async readRegistryRaw(): Promise<CaseRegistry> {
      return store.read()
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
          judgePhone: input.judgePhone === undefined ? undefined : String(input.judgePhone),
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
          expandOnStatus: input.expandOnStatus === undefined ? undefined : String(input.expandOnStatus) as CaseRecord['expandOnStatus'],
          // keyDates / taskGroups **不是 registry 字段**（0.2.12 起只存 items.json）。
          // 这里连空数组都不建：留下 `keyDates: []` 空壳会让「盘上只有一处存储」
          // 这句话在字段层面失真（实测 live 有 20 个案件残留空壳）。
          boundSessions: input.boundSessions === undefined ? [] : clone(input.boundSessions as string[] | undefined) ?? [],
          linkedContracts: input.linkedContracts === undefined ? [] : clone(input.linkedContracts as string[] | undefined) ?? [],
          linkedResearch: input.linkedResearch === undefined ? [] : clone(input.linkedResearch as string[] | undefined) ?? [],
          createdAt: now,
          updatedAt: now,
        }
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
        // 0.2.12：keyDates / taskGroups 不是 registry 字段（存 items.json），
        // 任何写路径都不许把它们塞回案件档案——发现即删，杜绝第二份存储复活。
        delete (merged as { keyDates?: unknown }).keyDates
        delete (merged as { taskGroups?: unknown }).taskGroups
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

    async clearPendingExpand(caseId: string): Promise<CaseRecord> {
      assertSafePathSegment(caseId, 'caseId')
      let record: CaseRecord | undefined
      await store.mutate((reg) => {
        const current = reg.cases[caseId]
        if (current === undefined) throw new Error(`case not found: ${caseId}`)
        if (current.pendingExpand === undefined && !Object.prototype.hasOwnProperty.call(current, 'pendingExpand')) {
          return reg
        }
        const next = clone(reg)
        const target = next.cases[caseId]
        delete target.pendingExpand
        target.updatedAt = nowIso()
        next.lastUpdated = target.updatedAt
        record = clone(target)
        return next
      }, 'case', caseId, 'clear-pending-expand')
      return record!
    },

    async setPeriodGate(caseId: string, gate: PeriodGate): Promise<CaseRecord> {
      assertSafePathSegment(caseId, 'caseId')
      let record: CaseRecord | undefined
      await store.mutate((reg) => {
        const current = reg.cases[caseId]
        if (current === undefined) throw new Error(`case not found: ${caseId}`)
        const next = clone(reg)
        const target = next.cases[caseId]
        target.periodGate = clone(gate)
        target.updatedAt = nowIso()
        next.lastUpdated = target.updatedAt
        record = clone(target)
        return next
      }, 'case', caseId, 'period-gate-set')
      return hydrate(record!)
    },

    async clearPeriodGate(caseId: string): Promise<CaseRecord> {
      assertSafePathSegment(caseId, 'caseId')
      let record: CaseRecord | undefined
      await store.mutate((reg) => {
        const current = reg.cases[caseId]
        if (current === undefined) throw new Error(`case not found: ${caseId}`)
        if (current.periodGate === undefined && !Object.prototype.hasOwnProperty.call(current, 'periodGate')) {
          return reg
        }
        const next = clone(reg)
        const target = next.cases[caseId]
        delete target.periodGate
        target.updatedAt = nowIso()
        next.lastUpdated = target.updatedAt
        record = clone(target)
        return next
      }, 'case', caseId, 'period-gate-clear')
      return hydrate(record!)
    },

    async setPeriodGateMuted(caseId: string, muted: { at: string; reason?: string } | undefined): Promise<CaseRecord> {
      assertSafePathSegment(caseId, 'caseId')
      let record: CaseRecord | undefined
      await store.mutate((reg) => {
        const current = reg.cases[caseId]
        if (current === undefined) throw new Error(`case not found: ${caseId}`)
        const next = clone(reg)
        const target = next.cases[caseId]
        if (muted === undefined) {
          if (target.periodGateMuted === undefined) return reg
          delete target.periodGateMuted
        } else {
          target.periodGateMuted = clone(muted)
          // 确认即撤下当前告警（不再提醒）。
          delete target.periodGate
        }
        target.updatedAt = nowIso()
        next.lastUpdated = target.updatedAt
        record = clone(target)
        return next
      }, 'case', caseId, muted === undefined ? 'period-gate-unmute' : 'period-gate-mute')
      return hydrate(record!)
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

      // 级联清理该案的统一事项（任务/日程/关键日期）与阶段组壳（0.2.12）。
      //
      // 为什么必须在 store 层做：编号会被复用（nextCaseId 取 max+1，删掉末尾案件后
      // 新案会拿回同一编号）。事项若留在 items 里，新案一读就"继承"了旧案的关键日期/
      // 任务——实测「删案后重建同号案，旧的上诉期届满复活」。cascadeDeleteCase 也清，
      // 这里再清一次是幂等的（deleteItem 对不存在的 id 返回 deleted:false）。
      if (deleted && itemStore !== undefined) {
        try {
          for (const g of await itemStore.listGroups(caseId)) {
            await itemStore.deleteGroup(g.id).catch(() => undefined)
          }
          for (const it of await itemStore.listItems(caseId)) {
            await itemStore.deleteItem(it.id).catch(() => undefined)
          }
        } catch (error) {
          console.warn(`[case-store] 删除案件 ${caseId} 的关联事项失败:`, error)
        }
      }
      return { deleted }
    },

    /* ------------------------- key dates（items 唯一存储） ------------------------- */
    // 0.2.12：关键日期 = items.json 里 type='keydate' 的一条事项。registry 只存
    // 案件元信息，不再有 keyDates 字段；读侧由 readCase/readRegistry 实时装配。

    async addKeyDate(caseId: string, label: string, date: string, meta?: Partial<KeyDate>): Promise<CaseRecord> {
      const reg = await store.read()
      const current = reg.cases[caseId]
      if (current === undefined) throw new Error(`case not found: ${caseId}`)
      const is = items()
      const ruleId = meta?.ruleId
      const baseDate = meta?.baseDate
      // 派生登记幂等（保留 0.2.11 语义）：同案同 ruleId+baseDate 只更新，不新增行。
      const existing = ruleId !== undefined && baseDate !== undefined
        ? (await is.listItems(caseId)).find((i) => isKeyDateItem(i) && i.ruleId === ruleId && i.baseDate === baseDate)
        : undefined
      await is.upsertItem({
        ...(existing === undefined ? {} : { id: existing.id }),
        ownerId: caseId,
        ownerType: 'litigation',
        ownerName: current.name,
        type: 'keydate',
        title: label,
        date,
        status: existing?.status ?? 'pending',
        ruleId,
        baseDate,
        cite: meta?.cite,
        computeTrace: meta?.computeTrace,
        source: meta?.source ?? existing?.source,
      })
      return requireCase(caseId)
    },

    async toggleKeyDate(caseId: string, keyDateIdToToggle: string): Promise<CaseRecord> {
      const is = items()
      const item = await is.readItem(keyDateIdToToggle)
      if (item === undefined) throw new Error(`key date not found: ${keyDateIdToToggle}`)
      await is.toggleItem(keyDateIdToToggle)
      return requireCase(caseId)
    },

    async deleteKeyDate(caseId: string, keyDateId: string): Promise<CaseRecord> {
      const is = items()
      const item = await is.readItem(keyDateId)
      if (item === undefined || !isKeyDateItem(item)) {
        throw new Error(`key date not found: ${keyDateId}`)
      }
      await is.deleteItem(keyDateId)
      return requireCase(caseId)
    },

    /* ------------------------------- task groups ------------------------------- */

    async upsertTaskGroup(caseId: string, group: Partial<TaskGroup>): Promise<CaseRecord> {
      await items().upsertGroup({
        ...(group.id === undefined || group.id === '' ? {} : { id: String(group.id) }),
        ownerId: caseId,
        ownerType: 'litigation',
        name: String(group.name ?? '新阶段'),
        ...(typeof group.order === 'number' ? { order: group.order } : {}),
      })
      return requireCase(caseId)
    },

    async deleteTaskGroup(caseId: string, groupId: string): Promise<CaseRecord> {
      const is = items()
      // 组内任务随组删除（item-store deleteGroup 已清 groupId 引用）；任务派生的
      // 关键日期一并清掉——删载体不得留孤儿提醒（旧语义保留）。
      const groupTasks = (await is.listItems(caseId)).filter((i) => i.groupId === groupId)
      const linkedIds = linkedKeyDateIds(groupTasks)
      await is.deleteGroup(groupId)
      for (const id of linkedIds) await is.deleteItem(id).catch(() => undefined)
      return requireCase(caseId)
    },

    async stripTaskGroups(caseId: string): Promise<CaseRecord> {
      // 只剥任务镜像；keyDates 留给 0.2.12 统一迁移并入 items（此处删会丢数据）。
      await store.mutate((reg) => {
        const current = reg.cases[caseId]
        if (current === undefined) throw new Error(`case not found: ${caseId}`)
        if (!Array.isArray(current.taskGroups) || current.taskGroups.length === 0) return reg
        const next = clone(reg)
        const record = next.cases[caseId]
        delete (record as { taskGroups?: unknown }).taskGroups
        record.updatedAt = nowIso()
        next.lastUpdated = record.updatedAt
        return next
      }, 'cases', caseId, 'strip-registry-taskgroups')
      return requireCase(caseId)
    },

    async stripLegacyFields(caseId: string): Promise<CaseRecord> {
      // 0.2.12：taskGroups + keyDates 都已在 items → 两个字段一起剥离。
      // 判据是**键是否存在**而不是「内容是否非空」：空数组空壳同样要删，否则
      // 「registry 只有元信息」这句话在字段层面不成立（实测 live 残留 20 个空壳）。
      await store.mutate((reg) => {
        const current = reg.cases[caseId]
        if (current === undefined) throw new Error(`case not found: ${caseId}`)
        const hasField = (key: string): boolean => Object.prototype.hasOwnProperty.call(current, key)
        if (!hasField('taskGroups') && !hasField('keyDates')) return reg
        const next = clone(reg)
        const record = next.cases[caseId]
        delete (record as { taskGroups?: unknown }).taskGroups
        delete (record as { keyDates?: unknown }).keyDates
        record.updatedAt = nowIso()
        next.lastUpdated = record.updatedAt
        return next
      }, 'cases', caseId, 'strip-registry-legacy-fields')
      return requireCase(caseId)
    },

    async reorderTaskGroups(caseId: string, orderedIds: string[]): Promise<CaseRecord> {
      const is = items()
      const byId = new Map((await is.listGroups(caseId)).map((g) => [g.id, g]))
      for (let i = 0; i < orderedIds.length; i++) {
        const g = byId.get(orderedIds[i]!)
        if (g !== undefined && g.order !== i) await is.upsertGroup({ id: g.id, order: i })
      }
      return requireCase(caseId)
    },

    /* ---------------------------------- tasks ---------------------------------- */

    async upsertTask(caseId: string, groupId: string, task: Partial<CaseTask>): Promise<CaseRecord> {
      const is = items()
      const groupName = groupId === '' ? undefined : (await is.listGroups(caseId)).find((g) => g.id === groupId)?.name
      const created = await is.upsertItem(taskToItem(caseId, groupId, task, groupName))
      await syncLinkedKeyDate(created)
      return requireCase(caseId)
    },

    async deleteTask(caseId: string, groupId: string, taskIdToDelete: string): Promise<CaseRecord> {
      const is = items()
      const task = await is.readItem(taskIdToDelete)
      await is.deleteItem(taskIdToDelete)
      // 删载体 → 一并删它派生的关键日期（不留孤儿提醒）。
      if (task?.keyDateId !== undefined && task.keyDateId !== '') {
        await is.deleteItem(task.keyDateId).catch(() => undefined)
      }
      return requireCase(caseId)
    },

    async moveTask(caseId: string, taskIdToMove: string, toGroupId: string, index?: number): Promise<CaseRecord> {
      const is = items()
      const task = await is.readItem(taskIdToMove)
      if (task === undefined) throw new Error(`task not found: ${taskIdToMove}`)
      const groupName = (await is.listGroups(caseId)).find((g) => g.id === toGroupId)?.name
      // 统一事项按 groupId 归组、组内按数组顺序渲染（items 无显式序字段）。
      // index 参数保留兼容旧调用签名，不再影响落库顺序。
      void index
      await is.upsertItem({ id: taskIdToMove, groupId: toGroupId, groupName })
      return requireCase(caseId)
    },

    async setTaskKeyDate(caseId: string, groupId: string, taskIdToEdit: string, enabled: boolean): Promise<CaseRecord> {
      const is = items()
      const task = await is.readItem(taskIdToEdit)
      if (task === undefined) throw new Error(`task not found: ${taskIdToEdit}`)
      if (enabled) {
        if (task.date === undefined || task.date === '') {
          throw new Error('task has no deadline: set a deadline before enabling a key-date reminder')
        }
        const existing = task.keyDateId === undefined || task.keyDateId === ''
          ? undefined
          : await is.readItem(task.keyDateId)
        let linkedId: string
        if (existing !== undefined) {
          // 已链接 → 保持同一 id，把标题/日期同步自任务。
          await is.upsertItem({ id: existing.id, title: task.title, date: task.date })
          linkedId = existing.id
        } else {
          const created = await is.upsertItem({
            ownerId: caseId,
            ownerType: 'litigation',
            ownerName: task.ownerName,
            type: 'keydate',
            title: task.title,
            date: task.date,
            status: 'pending',
            source: 'task-linked',
          })
          linkedId = created.id
        }
        await is.upsertItem({ id: taskIdToEdit, remindKeyDate: true, keyDateId: linkedId })
      } else {
        if (task.keyDateId !== undefined && task.keyDateId !== '') {
          await is.deleteItem(task.keyDateId).catch(() => undefined)
        } else if (task.remindKeyDate === true && task.date !== undefined && task.date !== '') {
          // 孤儿清理（Issue 4 加固）：链接丢失的派生 keydate（旧版本/导入数据），
          // 且没有别的任务仍引用它 → 按同标题+同日期移除。
          const all = await is.listItems(caseId)
          const referenced = new Set(
            all.map((i) => i.keyDateId).filter((v): v is string => v !== undefined && v !== ''),
          )
          for (const kd of all.filter(isKeyDateItem)) {
            if (referenced.has(kd.id)) continue
            if (kd.title === task.title && kd.date === task.date) await is.deleteItem(kd.id).catch(() => undefined)
          }
        }
        await is.upsertItem({ id: taskIdToEdit, remindKeyDate: false, keyDateId: '' })
      }
      return requireCase(caseId)
    },

    /* --------------------------------- subtasks -------------------------------- */

    async upsertSubtask(caseId: string, groupId: string, taskIdToEdit: string, subtask: Partial<Subtask>): Promise<CaseRecord> {
      await items().addSubtask(taskIdToEdit, {
        ...(subtask.id === undefined || subtask.id === '' ? {} : { id: String(subtask.id) }),
        title: String(subtask.title ?? '子任务'),
        deadline: subtask.deadline === undefined ? undefined : String(subtask.deadline),
        done: subtask.done === undefined ? false : Boolean(subtask.done),
      })
      await resyncTaskStatus(taskIdToEdit)
      return requireCase(caseId)
    },

    async deleteSubtask(caseId: string, groupId: string, taskIdToEdit: string, subtaskId: string): Promise<CaseRecord> {
      await items().deleteSubtask(taskIdToEdit, subtaskId)
      await resyncTaskStatus(taskIdToEdit)
      return requireCase(caseId)
    },

    /* --------------------------------- checklist ------------------------------- */

    async upsertChecklist(caseId: string, groupId: string, taskIdToEdit: string, item: Partial<ChecklistItem>): Promise<CaseRecord> {
      await items().addChecklist(taskIdToEdit, {
        ...(item.id === undefined || item.id === '' ? {} : { id: String(item.id) }),
        text: String(item.text ?? '检查项'),
        done: item.done === undefined ? false : Boolean(item.done),
      })
      return requireCase(caseId)
    },

    async toggleChecklist(caseId: string, groupId: string, taskIdToEdit: string, checklistIdToToggle: string): Promise<CaseRecord> {
      await items().toggleChecklist(taskIdToEdit, checklistIdToToggle)
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
