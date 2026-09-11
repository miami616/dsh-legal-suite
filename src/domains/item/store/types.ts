/**
 * 统一事项模型 — 数据模型。
 *
 * 只有两类数据：**任务**与**日程**，有些二者关联。一个事项一次登记，多视图自动分流：
 *   - event → 日程（尚未发生 → 关键日程 + 日历同步；已经过去 → 历史时间轴）
 *   - task  → 任务（任务树 / 任务台账；只有任务才有"逾期"）
 *   - both  → 日程 + 任务（双重）
 *
 * 日程一律带日期；带不带具体时间点是同一种数据的两种形态（全天 / 定时），
 * 不构成类型差异。法定期限（举证期/上诉期/时效届满…）就是日程，其来源与
 * 计算依据作为普通字段留在事项上（ruleId/baseDate/cite/computeTrace）。
 *
 * 存储：<dataDir>/items.json（扁平列表），唯一真相源——替代 case-timeline.json
 * + taskGroups + schedules.json + standalone-tasks.json + registry.keyDates。
 */

/** 事项归属类型：诉讼案件 / 非诉项目 / 独立（不归案）。 */
export type ItemOwnerType = 'litigation' | 'nonlitigation' | 'standalone'

/**
 * 事项类型：日程 / 任务 / 二者兼有。
 *
 * 0.2.13：删掉 0.2.12 引入的 `'keydate'`——关键日期不是第三种数据，它就是日程。
 * 盘上存量可能还有 `type:'keydate'`（迁移前），读时由 normalizeItemType 归一为
 * `'event'`，迁移后落盘统一。`both` 保留（用户明确要求先留着）。
 */
export type ItemType = 'event' | 'task' | 'both'

/** 盘上可能出现的历史 type 值（迁移前），只用于读时归一。 */
export type LegacyItemType = 'keydate'

/**
 * 读时归一：历史 `'keydate'` → `'event'`。
 *
 * 关键日期本来就是日程，只是 0.2.12 搬家时多开了一个 type。所有读路径先过这里，
 * 于是下游（时间轴/期限汇总/日历同步/任务树）只需要认三种 type。
 */
export function normalizeItemType(t: string | undefined | null): ItemType {
  if (t === 'task' || t === 'both') return t
  return 'event'
}

/** 日程类事项（进关键日程/时间轴/日历同步）：event / both。 */
export function isEventItem(it: Pick<Item, 'type'>): boolean {
  return it.type === 'event' || it.type === 'both'
}

/** 任务类事项（进任务树/任务台账）：task / both。 */
export function isTaskItem(it: Pick<Item, 'type'>): boolean {
  return it.type === 'task' || it.type === 'both'
}

/**
 * 法定期限来源的日程（由期限规则算出：带 ruleId/baseDate/cite）。
 *
 * 这是**字段判断**，不是类型判断——期限就是日程，只是它记得自己从哪条规则算出来。
 * 需要区分「规则生成的期限」与「手工登记日程」的地方（期限汇总、闸门、巡检）用它。
 */
export function isRuleDerivedItem(it: Pick<Item, 'ruleId' | 'baseDate'>): boolean {
  return (it.ruleId ?? '') !== '' || (it.baseDate ?? '') !== ''
}

/**
 * @deprecated 0.2.13 起没有 `keydate` 类型——关键日期就是日程。
 *
 * 保留此判定**只为旧读接口的兼容投影**（`case.keyDates`）：投影 = 该案的日程。
 * 语义上它不再是「第三种数据」，只是一个兼容壳（0.2.14 计划拆除）。
 * 新代码不要用它做业务分派——问「是不是日程」用 isEventItem，问「是不是规则生成的
 * 期限」用 isRuleDerivedItem，问「是不是手工登记的期限」用 source==='keydate'。
 */
export function isKeyDateItem(it: Pick<Item, 'type'>): boolean {
  return isEventItem(it)
}

/** 事项状态。 */
export type ItemStatus = 'pending' | 'doing' | 'done' | 'cancelled'

/** 事项优先级（task/both 才有）。 */
export type ItemPriority = 'low' | 'medium' | 'high'

/** 子任务。 */
export interface ItemSubtask {
  id: string
  title: string
  detail?: string
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
  /** 事项类型：event / task / both / keydate。 */
  type: ItemType
  /** 事项名（开庭 / 立案 / 起草起诉状）。 */
  title: string
  /**
   * 事件类型标识（event/both 才有；legacy TimelineEvent.type 的语义，
   * 0.2.x 统一模型补回：hearing/evidence_deadline/…/engagement/close/archive）。
   * 开放词表——规范枚举只作标签与期限归类，个案可自由使用任意字符串。
   */
  kind?: string
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
  /** 任务 ↔ 关键日期联动：指向 type='keydate' 事项的 id。 */
  keyDateId?: string
  /** 任务是否带派生的关键日期提醒（true 时 keyDateId 指向 keydate 事项）。 */
  remindKeyDate?: boolean
  /* ------------------ 法定期限审计字段（type='keydate' 才有） ------------------ */
  /**
   * 期限规则 id（src/shared/playbook/period-rules.ts 的 PeriodRule.id）。
   * 与 baseDate 组成幂等键：同案同规则同起算日只登记一条，不新增重复行。
   */
  ruleId?: string
  /** 期限起算日（触发事由发生日，YYYY-MM-DD）。 */
  baseDate?: string
  /** 期限依据（法条/规则原文）。 */
  cite?: string
  /** 派生过程留痕（人可读，便于复核届满日怎么算出来的）。 */
  computeTrace?: string
  /** 数据来源标记（agent-computed / manual / import / migration…）。 */
  source?: string
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
