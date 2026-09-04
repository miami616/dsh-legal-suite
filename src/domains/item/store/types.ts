/**
 * 统一事项模型 — 数据模型。
 *
 * 把「事件（timelineEvents）」和「任务（taskGroups[].tasks）」统一为一个
 * 「事项 Item」，用 type 区分。一个事项一次登记，多视图自动分流：
 *   - event → 关键日程/时间轴
 *   - task  → 任务树
 *   - both  → 两者都进
 *
 * 存储：<dataDir>/items.json（扁平列表），替代 case-timeline.json + taskGroups。
 */

/** 事项归属类型：诉讼案件 / 非诉项目 / 独立（不归案）。 */
export type ItemOwnerType = 'litigation' | 'nonlitigation' | 'standalone'

/** 事项类型：纯事件 / 纯任务 / 事件+任务（双重）。 */
export type ItemType = 'event' | 'task' | 'both'

/** 事项状态。 */
export type ItemStatus = 'pending' | 'doing' | 'done' | 'cancelled'

/** 事项优先级（task/both 才有）。 */
export type ItemPriority = 'low' | 'medium' | 'high'

/** 子任务。 */
export interface ItemSubtask {
  id: string
  title: string
  done: boolean
  deadline?: string
  time?: string
  createdAt?: string
  updatedAt?: string
}

/** 检查项。 */
export interface ItemChecklist {
  id: string
  text: string
  done: boolean
  createdAt?: string
  updatedAt?: string
}

/** 提醒规则（event/both 才有）。 */
export interface ItemRemindRule {
  enabled: boolean
  minutes: number
  type: 'before_event' | 'after_event'
}

/** 统一事项。 */
export interface Item {
  id: string
  /** 归属 id：案件 caseId / 项目 projectId（独立事项为 ''）。 */
  ownerId: string
  /** 归属类型：litigation / nonlitigation / standalone——区分诉讼案件与非诉项目
   *  同号（都可能是 YYYY-NNN）的场景，避免跨模块串数据（2026-09-04 发现）。 */
  ownerType?: ItemOwnerType
  /** 归属名（案件名/项目名），冗余便于列表展示。 */
  ownerName?: string
  /** 事项类型：event / task / both。 */
  type: ItemType
  /** 事项名（开庭 / 立案 / 起草起诉状）。 */
  title: string
  /** 日期 YYYY-MM-DD。 */
  date?: string
  /** 具体时间 HH:mm。 */
  time?: string
  /** 法庭、地点、备注。 */
  detail?: string
  status: ItemStatus
  /** 任务组 id（task/both 才有；可选，无则归「未分组」）。 */
  groupId?: string
  /** 任务组名（冗余，便于展示）。 */
  groupName?: string
  /** 优先级（task/both 才有）。 */
  priority?: ItemPriority
  /** 子任务（task/both 才有）。 */
  subtasks?: ItemSubtask[]
  /** 检查项（task/both 才有）。 */
  checklist?: ItemChecklist[]
  /** 提醒规则（event/both 才有）。 */
  remindRules?: ItemRemindRule[]
  /** 该事项由哪个阶段模板任务展开而来（避免重复展开）。 */
  templateTitle?: string
  /** 任务 ↔ 案件关键日期联动：关键日期 id（case-registry keyDates 数组项）。 */
  keyDateId?: string
  /** 任务是否带派生的关键日期提醒（true 时 keyDateId 指向案件 keyDates 项）。 */
  remindKeyDate?: boolean
  createdAt?: string
  updatedAt?: string
  completedAt?: string
}

/** items.json 文档（0.2.2：任务组壳并入同一文件，唯一真相源 = 单个 items.json）。 */
export interface ItemRegistry {
  registryVersion: string
  lastUpdated?: string
  /** 任务组（阶段）壳：组名/归属/顺序，任务正文在 items 用 groupId 引用。 */
  groups: TaskGroup[]
  /** 事项（任务/事件/双重）正文，扁平列表。 */
  items: Item[]
}

/** 任务组（阶段）— 独立概念，事项用 groupId 引用。 */
export interface TaskGroup {
  id: string
  /** 归属：caseId / projectId。 */
  ownerId: string
  /** 归属类型（与 Item.ownerType 同语义）。 */
  ownerType?: ItemOwnerType
  /** 组名（一审 · 庭前准备）。 */
  name: string
  order: number
  createdAt?: string
  updatedAt?: string
}

/** 旧 task-groups.json 文档（0.2.2 起仅迁移读入用，落盘后文件退役）。 */
export interface TaskGroupRegistry {
  registryVersion: string
  lastUpdated?: string
  groups: TaskGroup[]
}

/** 标准 API 响应。 */
export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}
