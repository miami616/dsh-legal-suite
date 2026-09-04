/**
 * 统一事项 → legacy 形状的转换（timeline 事件 / task 行 / taskGroups 聚合）。
 *
 * 旧渲染层与部分读路径仍消费 legacy 形状（TimelineEvent / taskGroups[].tasks），
 * 这里集中定义「items.json → legacy」的映射，供 /api/agentlex-item/legacy、
 * suite /api/agentlex/read 聚合、litigation /read-case·/read·get_case、health 与
 * stage 检测共用——单一事实源 = items.json（任务组壳也在同一文件 0.2.2）。
 *
 * 兼容双写约定：
 *  - 组行同时带 name（health/stage 按名称匹配阶段）与 title（旧 GUI 渲染）；
 *  - 任务行 status 用 legacy 三态 todo/in_progress/done（旧渲染层与 stage 检测
 *    都按字符串比较），同时 deadline 取自 item.date（任务截止=统一事项日期）。
 *
 * 2026-09-04：ownerType（litigation/nonlitigation/standalone）随行透出，聚合
 * 据此把同号案件/项目（如诉讼 2026-001 与非诉 2026-001）的事项正确归属。
 */
import type { Item, TaskGroup } from './store/types.ts'

/** 把一条 item（event/both）映射成 legacy TimelineEvent 形状。 */
export function itemToTimelineEvent(it: Item): Record<string, unknown> {
  return {
    id: it.id,
    caseId: it.ownerId,
    caseName: it.ownerName,
    ownerType: it.ownerType ?? '',
    type: it.type === 'both' ? 'hearing' : 'case_event',
    title: it.title,
    label: it.title,
    detail: it.detail,
    date: it.date ?? '',
    time: it.time,
    status: it.status === 'done' ? 'completed' : it.status === 'cancelled' ? 'cancelled' : 'pending',
    remindRules: it.remindRules ?? [],
    createdAt: it.createdAt,
    updatedAt: it.updatedAt,
  }
}

/** 旧 task 状态 → 统一事项状态。 */
export function legacyStatusToItem(status: unknown): 'pending' | 'doing' | 'done' {
  if (status === 'in_progress' || status === 'doing') return 'doing'
  if (status === 'done') return 'done'
  return 'pending'
}

/** 统一事项状态 → 旧 task 状态。 */
export function itemStatusToLegacy(status: unknown): 'todo' | 'in_progress' | 'done' {
  if (status === 'doing') return 'in_progress'
  if (status === 'done') return 'done'
  return 'todo'
}

/**
 * 把一条 item（task/both）映射成 legacy taskGroups[].tasks 行。
 * status 双写（done/in_progress/todo + 保留原始值），subtask/checklist 也补
 * status 派生，兼容所有旧读侧。
 */
export function itemToLegacyTask(it: Item): Record<string, unknown> {
  const status = itemStatusToLegacy(it.status)
  const mapSub = (sub: { id: string; title: string; done?: boolean; deadline?: string }) => ({
    id: sub.id,
    title: sub.title,
    done: sub.done === true,
    status: sub.done === true ? 'done' : 'todo',
    deadline: sub.deadline,
  })
  return {
    id: it.id,
    ownerId: it.ownerId,
    ownerType: it.ownerType ?? '',
    caseId: it.ownerId,
    title: it.title,
    detail: it.detail,
    deadline: it.date,
    time: it.time,
    priority: it.priority ?? 'medium',
    status,
    // 原始统一状态也透出（health/tools 读到的可能是 doing/pending/done）。
    rawStatus: it.status,
    subtasks: (it.subtasks ?? []).map(mapSub),
    checklist: (it.checklist ?? []).map((c) => ({ id: c.id, text: c.text, done: c.done === true })),
    templateTitle: it.templateTitle,
    groupId: it.groupId,
    groupName: it.groupName,
    createdAt: it.createdAt,
    updatedAt: it.updatedAt,
  }
}

/** item legacy 任务组（带 ownerType 供聚合归属）。 */
export interface LegacyGroup {
  ownerId: string
  ownerType?: string
  id: string
  /** GUI 渲染标题（旧版 read title）。 */
  title: string
  /** 阶段匹配名（health/stage 按 name 比较；与 title 同值）。 */
  name: string
  order: number
  tasks: Record<string, unknown>[]
}

/** 任务组壳（读侧入参，兼容 name 或 title 字段）。 */
export interface GroupShell {
  id: string
  ownerId: string
  ownerType?: string
  name?: string
  title?: string
  order?: number
}

/**
 * 从统一事项（items + 组壳）构建 legacy taskGroups 视图。
 * 组壳决定分组标题/顺序；未分组任务（无 groupId 或组壳缺失）归入 owner 级
 * 「未分组」。只包含 type 为 task/both 的事项。
 * 组行同时带 name 与 title（值相同），health/stage 与旧 GUI 都能命中。
 */
export function buildLegacyTaskGroups(
  groups: GroupShell[],
  items: Item[],
): LegacyGroup[] {
  const groupMap = new Map<string, LegacyGroup>()
  for (const g of groups) {
    if (g === undefined || g === null || g.id === undefined || g.id === '') continue
    const title = String(g.name ?? g.title ?? '新阶段')
    groupMap.set(`${g.ownerId}|${g.id}`, {
      ownerId: g.ownerId,
      ownerType: g.ownerType,
      id: g.id,
      title,
      name: title,
      order: typeof g.order === 'number' ? g.order : groupMap.size,
      tasks: [],
    })
  }
  for (const it of items) {
    if (it.type === 'event') continue
    const ownerId = it.ownerId ?? ''
    const gid = it.groupId ?? '__ungrouped'
    const key = `${ownerId}|${gid}`
    if (!groupMap.has(key)) {
      const title = it.groupName ?? '未分组'
      groupMap.set(key, {
        ownerId,
        ownerType: it.ownerType,
        id: gid,
        title,
        name: title,
        order: groupMap.size,
        tasks: [],
      })
    }
    groupMap.get(key)!.tasks.push(itemToLegacyTask(it))
  }
  const out = [...groupMap.values()]
  out.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.title).localeCompare(String(b.title)))
  return out
}

/** 便捷版：直接吃 store 返回值（TaskGroup 已带 name）。 */
export function buildLegacyTaskGroupsFromStore(groups: TaskGroup[], items: Item[]): LegacyGroup[] {
  return buildLegacyTaskGroups(groups as unknown as GroupShell[], items)
}

/** 单归属过滤 + 聚合：某案件/项目的 taskGroups（只吃 ownerType 匹配的事项）。 */
export function buildOwnerTaskGroups(
  ownerId: string,
  ownerType: 'litigation' | 'nonlitigation',
  groups: TaskGroup[],
  items: Item[],
): LegacyGroup[] {
  const ownGroups = groups.filter((g) => g.ownerId === ownerId && (g.ownerType ?? ownerType) === ownerType)
  const ownItems = items.filter((i) => i.ownerId === ownerId && (i.ownerType ?? ownerType) === ownerType)
  return buildLegacyTaskGroupsFromStore(ownGroups, ownItems)
}
