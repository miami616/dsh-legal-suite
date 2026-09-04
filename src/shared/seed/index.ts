/**
 * Built-in reference data seeding.
 *
 * On a fresh install (empty data dir) the plugin ships two litigation cases
 * and two non-litigation projects covering **different stages / types**, so a
 * new user immediately sees what the same product looks like at different
 * points in a matter's life — rather than rows that all look the same.
 *（诉讼各阶段齐全的两条主线：待开庭 / 执行中；非诉两类业务：常法 / 专项。）
 *
 * Seeding is strictly first-boot-only: it runs only when the target registry
 * is empty and never overwrites existing user data. Deleting the sample rows
 * and re-booting does NOT re-seed (the registry is no longer empty) — that is
 * intentional: the samples are a one-time onboarding aid, not a fixture.
 *
 * All writes go through the same store methods the tools/UI use, so the seeded
 * data is structurally identical to user-created data (keydate sync, task
 * status recompute, change broadcasts all apply).
 *
 * Every status id, task title and key-date label here comes from the shared
 * playbook (`src/shared/playbook/*`), so the seeded rows are meant to be read
 * as the **canonical worked example** of how the 管家 should name things.
 * `scripts/verify-seed-sync.mjs` enforces that mechanically.
 */

import type { CaseStore } from '../../domains/litigation/store/case-store.ts'
import type { TimelineStore } from '../../domains/litigation/store/timeline-store.ts'
import type { ScheduleStore } from '../../domains/litigation/store/schedule-store.ts'
import type { ItemStore } from '../../domains/item/store/item-store.ts'
import type { ProjectStore } from '../../domains/nonlitigation/store/project-store.ts'
import type { ServiceStore } from '../../domains/nonlitigation/store/service-store.ts'
import { daysBefore } from '../playbook/litigation.ts'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** A stable, human-readable marker so users can identify the sample rows. */
export const SEED_TAG = '参考用例'

/**
 * Process-level guard: the plugin's apply/sync runs multiple times during boot
 * (cordis fiber reloads), and each run would otherwise see the registry as
 * still-empty before the previous seed's write lands, seeding duplicates.
 * This flag makes seeding run at most once per process.
 *
 * 2026-09-04 修复：add 必须在任何 await 之前同步执行（此前 add 在 readRegistry
 * 的 await 之后，两次并发 apply 会在 await 间隙双双通过空检查 → 双播演示）。
 * 同进程模块 reload 时 seededOnce 会重置，但此时首次播种已完成（registry
 * 非空），reload 后的 apply 会在空检查处短路——不再双播。
 */
const seededOnce = new Set<string>()

/** Whether a litigation registry is empty (no cases). */
export function isLitigationEmpty(registry: { cases?: Record<string, unknown> }): boolean {
  return registry.cases === undefined || Object.keys(registry.cases).length === 0
}

/** Whether a non-litigation registry is empty (no projects). */
export function isNonLitigationEmpty(registry: { projects?: Record<string, unknown> }): boolean {
  return registry.projects === undefined || Object.keys(registry.projects).length === 0
}

/* ---------------------------------------------------------- 磁盘播种标记 */

/**
 * 播种磁盘标记（修复 2026-09-04 深层 bug：seed 仅凭 registry 空判定 + 进程级
 * seededOnce，导致「用户删光演示 → dsh 重启 → 演示又复活」，与文件头注释宣称的
 * 'Deleting the sample rows and re-booting does NOT re-seed' 矛盾——这正是
 * 备忘录 #3『删除后怎么还有存留』的跨进程根因之一）。
 *
 * 规则：dataDir 传了时，第一次播种成功会写 `.agentlex-seeded-<module>` 标记；
 * 之后无论 registry 是否为空都不再播（用户删光演示也不会复活）。dataDir 缺省
 * （verify 脚本等用临时目录的调用）维持旧行为：仅进程内一次 + registry 空判定。
 */

function seedMarkPath(dataDir: string, module: string): string {
  return join(dataDir, `.agentlex-seeded-${module}`)
}

/** 标记已存在？(dataDir 缺省 → false，维持旧行为) */
function hasSeedMark(dataDir: string | undefined, module: string): boolean {
  if (dataDir === undefined || dataDir === '') return false
  try {
    return existsSync(seedMarkPath(dataDir, module))
  } catch {
    return false
  }
}

/** 写播种标记（best-effort，失败仅告警不致命）。 */
function writeSeedMark(dataDir: string | undefined, module: string): void {
  if (dataDir === undefined || dataDir === '') return
  try {
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(seedMarkPath(dataDir, module), new Date().toISOString(), 'utf8')
  } catch (error) {
    console.warn(`[agentlex-seed] 写播种标记失败(${module}):`, error)
  }
}

/* --------------------------------------------------------------- 播种入口 */

/**
 * Seed the reference litigation cases. Returns the id of the primary case
 * (the 待开庭 one), or undefined when the registry was not empty.
 *
 * @param dataDir - 诉讼数据目录（写磁盘播种标记用；缺省时维持旧行为）。
 */
export async function seedLitigationSample(
  caseStore: CaseStore,
  timelineStore: TimelineStore,
  scheduleStore: ScheduleStore,
  itemStore?: ItemStore,
  dataDir?: string,
): Promise<string | undefined> {
  // 进程级守卫：add 必须在任何 await 之前同步执行——否则两次并发 apply
  // （cordis fiber reload 会重复调用）都在 await 间隙通过空检查，双播演示。
  if (seededOnce.has('litigation')) return undefined
  seededOnce.add('litigation')
  // 磁盘标记优先：播过就不再播（删光演示重启也不复活）。
  if (hasSeedMark(dataDir, 'litigation')) return undefined
  const registry = await caseStore.readRegistry()
  if (!isLitigationEmpty(registry)) return undefined
  const D = dateFn()
  // 统一事项：有 itemStore 时任务/事件写 items.json（与运行时一致，播种后界面即可见）。
  const taskWriter = itemStore !== undefined ? itemSeedWriter(itemStore, 'litigation') : caseSeedWriter(caseStore)
  const eventWriter = itemStore !== undefined ? itemEventWriter(itemStore, 'litigation') : timelineEventWriter(timelineStore)
  // 两组案例覆盖两种截然不同的阶段：待开庭（主干，功能演示最全）与执行中
  // （展示执行阶段独有的任务类型）。不再铺 3 个（备忘录 #3：演示太多）。
  const primaryId = await seedAwaitingTrialCase(caseStore, timelineStore, scheduleStore, taskWriter, eventWriter, D)
  await seedExecutionCase(caseStore, timelineStore, scheduleStore, taskWriter, eventWriter, D)
  writeSeedMark(dataDir, 'litigation')
  return primaryId
}

/**
 * Seed the reference non-litigation projects. Returns the retainer project id.
 *
 * @param dataDir - 非诉数据目录（写磁盘播种标记用；缺省时维持旧行为）。
 */
export async function seedNonLitigationSample(
  projectStore: ProjectStore,
  serviceStore: ServiceStore,
  itemStore?: ItemStore,
  dataDir?: string,
): Promise<string | undefined> {
  if (seededOnce.has('nonlitigation')) return undefined
  seededOnce.add('nonlitigation')
  if (hasSeedMark(dataDir, 'nonlitigation')) return undefined
  const registry = await projectStore.readRegistry()
  if (!isNonLitigationEmpty(registry)) return undefined
  const D = dateFn()
  const taskWriter = itemStore !== undefined ? itemSeedWriter(itemStore, 'nonlitigation') : projectSeedWriter(projectStore)
  // 两组项目覆盖两类业务与两种状态：进行中常法（日常履约节奏 + 续约提醒）
  // 与已完成专项（交付物归档/结算/结项）。不再铺 3 个（备忘录 #3）。
  const retainerId = await seedActiveRetainerProject(projectStore, serviceStore, taskWriter, D)
  await seedCompletedDueDiligenceProject(projectStore, serviceStore, taskWriter, D)
  writeSeedMark(dataDir, 'nonlitigation')
  return retainerId
}

/* ------------------------------------------------------------------ 工具 */

/** Relative-day date helper anchored at seed time. */
type DateFn = (offset: number) => string

function dateFn(): DateFn {
  const now = new Date()
  const m = (n: number) => String(n).padStart(2, '0')
  return (offset: number) => {
    const t = new Date(now.getTime() + offset * 86400000)
    return `${t.getFullYear()}-${m(t.getMonth() + 1)}-${m(t.getDate())}`
  }
}

interface SeedSubtask { title: string; done: boolean }
interface SeedCheck { text: string; done: boolean }

interface SeedTask {
  title: string
  status: 'todo' | 'doing' | 'done'
  priority?: 'low' | 'medium' | 'high'
  deadline?: string
  detail?: string
  subtasks?: SeedSubtask[]
  checklist?: SeedCheck[]
  /** 同步生成任务关键日期提醒（仅诉讼侧，需有 deadline）。 */
  keydate?: boolean
}

/**
 * 任务写入口：统一事项模型（有 itemStore 时）任务落在 items.json（type=task，
 * groupId 引用 task-groups.json）；否则回落 case/project store 的 taskGroups
 * （旧版调用方 / 测试）。seed 与运行时写路径保持一致，避免播种后界面读不到。
 */
interface SeedWriter {
  upsertGroup(ownerId: string, name: string): Promise<{ id: string }>
  upsertTask(ownerId: string, groupId: string, task: SeedTask): Promise<{ id: string }>
  upsertSubtask(taskId: string, input: { title: string; done: boolean }): Promise<unknown>
  upsertChecklist(taskId: string, input: { text: string; done: boolean }): Promise<unknown>
}

/** caseStore 版 SeedWriter（旧路径 / 无 itemStore 的测试）。 */
function caseSeedWriter(caseStore: CaseStore): SeedWriter {
  return {
    async upsertGroup(caseId, name) {
      const g = await caseStore.upsertTaskGroup(caseId, { name })
      const gid = g.taskGroups!.at(-1)!.id
      return { id: gid }
    },
    async upsertTask(caseId, groupId, task) {
      const record = await caseStore.upsertTask(caseId, groupId, {
        title: task.title,
        status: task.status,
        priority: task.priority ?? 'medium',
        deadline: task.deadline,
        detail: task.detail,
      })
      const created = record.taskGroups!.find((x) => x.id === groupId)!.tasks
        .find((x) => x.title === task.title)
      if (created === undefined) throw new Error(`seed task missing: ${task.title}`)
      for (const st of task.subtasks ?? []) {
        await caseStore.upsertSubtask(caseId, groupId, created.id, st)
      }
      for (const c of task.checklist ?? []) {
        await caseStore.upsertChecklist(caseId, groupId, created.id, c)
      }
      if (task.keydate === true && task.deadline !== undefined) {
        await caseStore.setTaskKeyDate(caseId, groupId, created.id, true)
      }
      return { id: created.id }
    },
    async upsertSubtask(_taskId, _input) { return undefined },
    async upsertChecklist(_taskId, _input) { return undefined },
  }
}

/** projectStore 版 SeedWriter（旧路径 / 测试）。 */
function projectSeedWriter(projectStore: ProjectStore): SeedWriter {
  return {
    async upsertGroup(projectId, name) {
      const g = await projectStore.upsertTaskGroup(projectId, { name })
      const gid = g.taskGroups!.at(-1)!.id
      return { id: gid }
    },
    async upsertTask(projectId, groupId, task) {
      const record = await projectStore.upsertTask(projectId, groupId, {
        title: task.title,
        status: task.status,
        priority: task.priority ?? 'medium',
        deadline: task.deadline,
        detail: task.detail,
      })
      const created = record.taskGroups!.find((x) => x.id === groupId)!.tasks
        .find((x) => x.title === task.title)
      if (created === undefined) throw new Error(`seed task missing: ${task.title}`)
      for (const st of task.subtasks ?? []) {
        await projectStore.upsertSubtask(projectId, groupId, created.id, { ...st })
      }
      for (const c of task.checklist ?? []) {
        const added = await projectStore.addChecklistItem(projectId, groupId, created.id, c.text)
        const item = added.taskGroups!.find((x) => x.id === groupId)!.tasks
          .find((x) => x.id === created.id)!.checklist?.at(-1)
        if (c.done && item !== undefined) {
          await projectStore.toggleChecklist(projectId, groupId, created.id, item.id)
        }
      }
      return { id: created.id }
    },
    async upsertSubtask(_taskId, _input) { return undefined },
    async upsertChecklist(_taskId, _input) { return undefined },
  }
}

/** itemStore 版 SeedWriter（统一事项：组 + 任务都存 items 体系，带归属类型防撞号）。 */
function itemSeedWriter(itemStore: ItemStore, ownerType: 'litigation' | 'nonlitigation'): SeedWriter {
  return {
    async upsertGroup(ownerId, name) {
      const g = await itemStore.upsertGroup({ ownerId, ownerType, name })
      return { id: g.id }
    },
    async upsertTask(ownerId, groupId, task) {
      const item = await itemStore.upsertItem({
        ownerId,
        ownerType,
        type: 'task',
        groupId,
        title: task.title,
        date: task.deadline,
        detail: task.detail,
        priority: task.priority ?? 'medium',
        status: (task.status === 'done' ? 'done' : task.status === 'doing' ? 'doing' : 'pending') as never,
        subtasks: (task.subtasks ?? []).map((st) => ({ title: st.title, done: st.done, id: `sub-seed-${st.title}` })),
        checklist: (task.checklist ?? []).map((c) => ({ text: c.text, done: c.done, id: `chk-seed-${c.text}` })),
      })
      return { id: item.id }
    },
    async upsertSubtask(_taskId, _input) { return undefined },
    async upsertChecklist(_taskId, _input) { return undefined },
  }
}

/** 事件写入口（诉讼侧时间轴事件）。 */
type EventWriter = (input: {
  caseId: string
  caseName: string
  type: string
  title: string
  date: string
  status: 'pending' | 'done'
  detail?: string
  time?: string
}) => Promise<void>

/** timelineStore 版事件写入（旧路径）。 */
function timelineEventWriter(timelineStore: TimelineStore): EventWriter {
  return async (input) => {
    await timelineStore.upsertEvent({ ...input, type: input.type as never })
  }
}

/** itemStore 版事件写入（统一事项：type=event，带归属类型）。 */
function itemEventWriter(itemStore: ItemStore, ownerType: 'litigation' | 'nonlitigation'): EventWriter {
  return async (input) => {
    await itemStore.upsertItem({
      ownerId: input.caseId,
      ownerType,
      ownerName: input.caseName,
      type: 'event',
      title: input.title,
      date: input.date,
      time: input.time,
      detail: input.detail,
      status: (input.status === 'done' ? 'done' : 'pending') as never,
    })
  }
}

/** Materialize one task group (stage) with its tasks, subtasks and checks. */
async function buildCaseGroup(
  writer: SeedWriter,
  caseId: string,
  groupName: string,
  tasks: SeedTask[],
): Promise<void> {
  const { id: groupId } = await writer.upsertGroup(caseId, groupName)
  for (const t of tasks) {
    await writer.upsertTask(caseId, groupId, t)
  }
}

/** Materialize one non-litigation task group (checklist items are add+toggle). */
async function buildProjectGroup(
  writer: SeedWriter,
  projectId: string,
  groupName: string,
  tasks: SeedTask[],
): Promise<void> {
  const { id: groupId } = await writer.upsertGroup(projectId, groupName)
  for (const t of tasks) {
    await writer.upsertTask(projectId, groupId, t)
  }
}

/* ============================================================ 诉讼 · 案例二 */

/**
 * 案例二：待开庭（awaiting_trial）。
 * 主干案例：已立案、开庭日期已定，演示「以开庭日为锚点倒排任务」的排期方式。
 */
async function seedAwaitingTrialCase(
  caseStore: CaseStore,
  timelineStore: TimelineStore,
  scheduleStore: ScheduleStore,
  writer: SeedWriter,
  eventWriter: EventWriter,
  d: DateFn,
): Promise<string> {
  const now = new Date()
  const y = now.getFullYear()
  // 开庭日与举证期限届满日：这两个日期是本案所有排期的锚点。
  const hearingDate = d(9)
  const evidenceDeadline = d(6)

  const record = await caseStore.registerCase({
    name: '某科技公司与某贸易公司买卖合同纠纷',
    type: '民商',
    cause: '合同纠纷',
    status: 'awaiting_trial',
    court: '北京市海淀区人民法院',
    judge: '王法官',
    level: '一审',
    caseNumber: `（${y}）京0108民初${String(1000 + (y % 100)).padStart(4, '0')}号`,
    claimAmount: '840000',
    filingDate: d(-30),
    ourSide: 'plaintiff',
    summary: '某科技公司向某贸易公司供应电子元器件，对方拖欠货款 84 万元。法院已立案并确定开庭时间，现处于举证期限届满前的庭前准备阶段：需完成补充证据提交、争议焦点梳理与庭审提纲，庭后按法庭指定期限提交书面代理词。',
    tags: [SEED_TAG, '货款纠纷', '买卖合同'],
    parties: {
      plaintiff: '某科技公司',
      defendant: '某贸易公司',
      ourSide: 'plaintiff',
      details: [
        { name: '某科技公司', role: '原告', address: '北京市海淀区中关村大街1号', legalRep: '李总', creditCode: '91110108MA01XXXXX1', phone: '13800000001', ourClient: true },
        { name: '某贸易公司', role: '被告', address: '北京市朝阳区建国路88号', legalRep: '赵总', creditCode: '91110105MA01XXXXX2', phone: '13800000002' },
      ],
    },
  })
  const caseId = record.caseId

  await buildCaseGroup(writer, caseId, '一审 · 立案', [
    { title: '起草起诉状', status: 'done', priority: 'high', deadline: d(-32), detail: '诉请本金、逾期利息与诉讼费承担' },
    { title: '整理证据材料并编制证据清单', status: 'done', priority: 'high', deadline: d(-31) },
    { title: '递交立案材料', status: 'done', priority: 'high', deadline: d(-30) },
    {
      title: '缴纳诉讼费', status: 'done', priority: 'medium', deadline: d(-29),
      detail: '收到缴费通知后缴纳',
    },
    {
      title: '登记举证期限与开庭安排', status: 'done', priority: 'high', deadline: d(-28),
      detail: '电子送达受理/举证通知书后登记举证期限与开庭',
    },
  ])

  await buildCaseGroup(writer, caseId, '一审 · 庭前准备', [
    {
      title: '查阅对方答辩状', status: 'done', priority: 'medium', deadline: d(-20),
      detail: '对方抗辩焦点为货物质量瑕疵与逾期交货',
    },
    {
      title: '提交证据', status: 'doing', priority: 'high',
      deadline: daysBefore(evidenceDeadline, 2),
      detail: '在举证期限内提交补充证据；任务截止日已按举证期限届满前 2 日的余量设置',
      subtasks: [
        { title: '核对证据原件', done: true },
        { title: '编制证据目录', done: false },
        { title: '制作证据副本', done: false },
      ],
      checklist: [{ text: '确认法院收到回执', done: false }],
    },
    { title: '梳理争议焦点', status: 'done', priority: 'high', deadline: d(-5), detail: '货物质量、逾期交货与欠款金额三项' },
    { title: '参加庭前会议', status: 'done', priority: 'medium', deadline: d(-8) },
    {
      title: '申请财产保全', status: 'todo', priority: 'medium', deadline: d(2),
      detail: '对方存在多起被执行记录，需评估保全必要性与担保成本',
    },
    {
      title: '申请调查令', status: 'todo', priority: 'low', deadline: d(3),
      detail: '申请调取对方收货后的销售记录，佐证货物无质量问题',
    },
  ])

  await buildCaseGroup(writer, caseId, '一审 · 开庭审理', [
    {
      title: '核对证据原件', status: 'doing', priority: 'high',
      deadline: daysBefore(hearingDate, 7),
      detail: '开庭须携带全部证据原件备查',
    },
    {
      title: '制作庭审提纲', status: 'doing', priority: 'high',
      deadline: daysBefore(hearingDate, 3),
      subtasks: [
        { title: '拟定法庭调查发问提纲', done: true },
        { title: '拟定质证意见', done: false },
        { title: '拟定辩论意见', done: false },
      ],
      checklist: [{ text: '与当事人复核提纲', done: false }],
    },
    {
      title: '出庭参加庭审', status: 'todo', priority: 'high', deadline: hearingDate,
      checklist: [
        { text: '确认开庭时间与法庭', done: true },
        { text: '确认出庭人员与授权手续', done: true },
        { text: '携带证据原件与代理手续', done: false },
      ],
    },
    { title: '提交书面代理词', status: 'todo', priority: 'high', deadline: d(19), detail: '庭后按法庭指定期限提交' },
    { title: '校对并签署庭审笔录', status: 'todo', priority: 'medium', deadline: hearingDate },
  ])

  await caseStore.addKeyDate(caseId, '举证期限届满', evidenceDeadline)
  await caseStore.addKeyDate(caseId, '开庭', hearingDate)

  await eventWriter({
    caseId, caseName: record.name, type: 'filing', title: '立案',
    date: d(-30), status: 'done', detail: '法院受理并立案',
})
  await eventWriter({
    caseId, caseName: record.name, type: 'defense_deadline', title: '答辩期届满',
    date: d(-15), status: 'done', detail: '被告已提交答辩状',
})
  await eventWriter({
    caseId, caseName: record.name, type: 'evidence_deadline', title: '举证期限届满',
    date: evidenceDeadline, status: 'pending', detail: '需在此之前提交全部证据',
})
  await eventWriter({
    caseId, caseName: record.name, type: 'hearing', title: '第一次开庭',
    date: hearingDate, status: 'pending', detail: '北京市海淀区人民法院第3法庭',
})

  await scheduleStore.upsertItem({
    caseId, title: '开庭', date: hearingDate, time: '09:30', kind: 'hearing',
  })

  return caseId
}

/* ============================================================ 诉讼 · 案例三 */

/**
 * 案例三：执行中（execution）。
 * 特点：任务类型与诉讼阶段**完全不同**——财产线索、查控、执行谈话、回款，
 * 用来体现「不同阶段有各自独有的安排」。
 */
async function seedExecutionCase(
  caseStore: CaseStore,
  timelineStore: TimelineStore,
  scheduleStore: ScheduleStore,
  writer: SeedWriter,
  eventWriter: EventWriter,
  d: DateFn,
): Promise<string> {
  const now = new Date()
  const y = now.getFullYear()

  const record = await caseStore.registerCase({
    name: '某贸易公司与陈某民间借贷纠纷执行案',
    type: '执行',
    cause: '金钱给付',
    status: 'investigation',
    court: '北京市朝阳区人民法院',
    judge: '刘执行员',
    level: '首次执行',
    caseNumber: `（${y}）京0105执${String(2000 + (y % 100)).padStart(4, '0')}号`,
    claimAmount: '560000',
    filingDate: d(-25),
    ourSide: 'executionApplicant',
    summary: '生效判决判令陈某偿还借款本金 56 万元及利息，陈某未在判决确定的履行期限内履行。我方已代理申请强制执行，法院已立案并启动网络查控，现阶段重点为梳理被执行人财产线索、跟进查控结果并推进执行回款。',
    tags: [SEED_TAG, '执行', '财产线索'],
    parties: {
      plaintiff: '某贸易公司',
      defendant: '陈某',
      ourSide: 'executionApplicant',
      details: [
        { name: '某贸易公司', role: '申请执行人', address: '北京市朝阳区建国路88号', legalRep: '赵总', creditCode: '91110105MA01XXXXX2', phone: '13800000002', ourClient: true },
        { name: '陈某', role: '被执行人', address: '河北省廊坊市固安县新源街22号', phone: '13800000021' },
      ],
    },
  })
  const caseId = record.caseId

  await buildCaseGroup(writer, caseId, '执行 · 强制执行', [
    {
      title: '申请强制执行', status: 'done', priority: 'high', deadline: d(-25),
      detail: '提交执行申请书、生效裁判文书、送达证明与财产线索',
      subtasks: [{ title: '起草执行申请书', done: true }, { title: '准备生效证明与送达回证', done: true }],
    },
    {
      title: '提供被执行人财产线索', status: 'doing', priority: 'high', deadline: d(3),
      detail: '线索质量直接决定执行到位率：银行账户、不动产、车辆、股权、应收账款',
      subtasks: [
        { title: '调取被执行人名下不动产信息', done: true },
        { title: '梳理被执行人名下股权', done: false },
        { title: '核查对外应收账款', done: false },
      ],
      checklist: [{ text: '线索清单已核对并编号', done: false }],
    },
    {
      title: '配合法院财产查控', status: 'doing', priority: 'medium', deadline: d(10),
      detail: '跟进网络查控反馈结果，及时申请续查封、续冻结，避免期限届满脱保',
    },
    {
      title: '参加执行谈话', status: 'todo', priority: 'medium', deadline: d(12),
      detail: '与执行法官沟通履行方案与执行和解可能',
    },
    {
      title: '跟进执行回款', status: 'todo', priority: 'high', deadline: d(45),
      detail: '核对执行款到账金额，办理领款手续',
      keydate: true,
    },
    {
      title: '申请恢复执行', status: 'todo', priority: 'low',
      detail: '若终结本次执行程序后发现新的财产线索，可随时申请恢复执行',
    },
  ])

  await buildCaseGroup(writer, caseId, '执行 · 结案归档', [
    { title: '结案归档', status: 'todo', priority: 'low', detail: '卷宗归档、费用结算与未结事项交接' },
  ])

  await caseStore.addKeyDate(caseId, '执行立案', d(-25))
  await caseStore.addKeyDate(caseId, '执行款项到账', d(45))

  await eventWriter({
    caseId, caseName: record.name, type: 'judgment', title: '一审判决',
    date: d(-70), status: 'done', detail: '判令偿还本金 56 万元及利息',
})
  await eventWriter({
    caseId, caseName: record.name, type: 'service', title: '判决书送达',
    date: d(-65), status: 'done', detail: '双方均未上诉，判决生效',
})
  await eventWriter({
    caseId, caseName: record.name, type: 'deadline', title: '判决履行期限届满',
    date: d(-35), status: 'done', detail: '被执行人未按期履行',
})
  await eventWriter({
    caseId, caseName: record.name, type: 'execution', title: '执行立案',
    date: d(-25), status: 'done', detail: '法院立案并启动网络查控',
})
  await eventWriter({
    caseId, caseName: record.name, type: 'case_event', title: '参加执行谈话',
    date: d(12), status: 'pending', detail: '北京市朝阳区人民法院执行局',
})

  await scheduleStore.upsertItem({
    caseId, title: '参加执行谈话', date: d(12), time: '10:00', kind: 'execution',
  })

  return caseId
}

/* ============================================================ 非诉 · 项目二 */

/**
 * 项目二：常法 · 进行中（active）。
 * 特点：服务期 60 天后届满，演示常法的日常履约节奏 + 续约提醒这条主线。
 */
async function seedActiveRetainerProject(
  projectStore: ProjectStore,
  serviceStore: ServiceStore,
  writer: SeedWriter,
  d: DateFn,
): Promise<string> {
  const project = await projectStore.registerProject({
    name: '某制造公司常年法律顾问',
    projectType: 'retainer',
    status: 'active',
    leadLawyer: '张律师',
    contractAmount: '120000',
    servicePeriod: { start: d(-305), end: d(60) },
    serviceScope: ['合同审查', '法律咨询', '合规审查', '劳动用工'],
    summary: '为某制造公司提供常年法律顾问服务（第二年），涵盖合同审查、日常法律咨询、合规审查与劳动用工管理。服务期将于 60 天后届满，续约洽谈已启动。',
  })
  const projectId = project.projectId

  await buildProjectGroup(writer, projectId, '日常履约 · 合同审查', [
    {
      title: '审查采购合同', status: 'doing', priority: 'high', deadline: d(3),
      detail: '重点核对付款节点、验收条款与违约责任',
      subtasks: [
        { title: '核对付款节点', done: true },
        { title: '审查违约责任', done: false },
        { title: '审查争议解决条款', done: false },
      ],
      checklist: [{ text: '标注风险等级', done: true }, { text: '给出修改建议', done: false }],
    },
    { title: '审查销售合同', status: 'todo', priority: 'high', deadline: d(14), detail: '重点核对回款保障、所有权保留与质保责任' },
    { title: '修订合同模板', status: 'todo', priority: 'medium', deadline: d(40), detail: '把审查意见沉淀为模板，减少重复审查成本' },
  ])

  await buildProjectGroup(writer, projectId, '日常履约 · 法律咨询', [
    { title: '答复日常法律咨询', status: 'doing', priority: 'high', deadline: d(1), detail: '口头咨询当日回复，书面咨询按约定时效回复' },
    { title: '出具法律意见书', status: 'todo', priority: 'high', deadline: d(10), detail: '重大事项须书面意见，明确结论、依据与风险提示' },
    { title: '更新咨询台账', status: 'doing', priority: 'medium', deadline: d(1), detail: '登记时间、事项、答复要点与耗时，是年度服务报告的数据来源' },
  ])

  await buildProjectGroup(writer, projectId, '日常履约 · 合规审查', [
    { title: '开展数据合规审查', status: 'todo', priority: 'medium', deadline: d(20), detail: '核查个人信息收集、处理与跨境传输的合规性' },
    { title: '开展劳动用工合规审查', status: 'todo', priority: 'medium', deadline: d(45), detail: '核查劳动合同、工时、社保与竞业限制' },
    { title: '跟进整改落实', status: 'todo', priority: 'medium', detail: '整改事项闭环，留存整改证据' },
  ])

  await buildProjectGroup(writer, projectId, '服务报告与续约', [
    { title: '编制年度服务报告', status: 'todo', priority: 'high', deadline: d(30), detail: '汇总年度服务量、重大事项、遗留问题与改进建议' },
    { title: '洽谈续约', status: 'todo', priority: 'high', deadline: d(5), detail: '服务期届满前 60 日启动，避免服务断档' },
  ])

  await projectStore.upsertKeyDate(projectId, { label: '服务期届满', date: d(60) })
  await projectStore.upsertKeyDate(projectId, { label: '续约洽谈启动', date: d(5) })
  await projectStore.upsertKeyDate(projectId, { label: '服务费到期', date: d(60) })

  await serviceStore.upsertService({
    name: '审查供应商采购合同', kind: '合同审查', client: '某制造公司',
    status: 'done', date: d(-10), note: '出具审查意见，2.5 小时',
  })
  await serviceStore.upsertService({
    name: '答复员工离职纠纷咨询', kind: '法律咨询', client: '某制造公司',
    status: 'done', date: d(-5), note: '口头答复并出具书面意见，1 小时',
  })
  await serviceStore.upsertService({
    name: '开展数据合规培训', kind: '培训', client: '某制造公司',
    status: 'done', date: d(-18), note: '面向管理层与数据岗位，2 小时',
  })
  await serviceStore.upsertService({
    name: '修订劳动合同模板', kind: '文书起草', client: '某制造公司',
    status: 'done', date: d(-2), note: '完成模板修订并交付，3 小时',
  })

  return projectId
}

/* ============================================================ 非诉 · 项目三 */

/**
 * 项目三：专项 · 已完成（completed）。
 * 特点：交付物已验收、交割完成，但结项归档尚未收尾——用来体现
 * 「已完成」与「已归档」是两件事，中间还有结算与结项报告。
 */
async function seedCompletedDueDiligenceProject(
  projectStore: ProjectStore,
  serviceStore: ServiceStore,
  writer: SeedWriter,
  d: DateFn,
): Promise<string> {
  const project = await projectStore.registerProject({
    name: '某科技公司A轮融资法律尽职调查',
    projectType: 'special',
    status: 'completed',
    leadLawyer: '王律师',
    contractAmount: '260000',
    servicePeriod: { start: d(-120), end: d(-15) },
    serviceScope: ['尽职调查', '交易文件', '交割协助'],
    summary: '就某科技公司 A 轮融资开展法律尽职调查并协助交易文件定稿，尽调报告已交付、交易文件已签署并完成交割。目前处于结项阶段：交付物归档、工时结算与结项报告编制。',
  })
  const projectId = project.projectId

  await buildProjectGroup(writer, projectId, '专项 · 尽职调查', [
    { title: '发送尽职调查清单', status: 'done', priority: 'high', deadline: d(-115), detail: '按主体资格、资产、业务、债权债务、劳动、争议分模块列清单' },
    { title: '收集并审阅尽调资料', status: 'done', priority: 'high', deadline: d(-100), detail: '资料编号归档，缺口逐项催补' },
    { title: '开展访谈与现场核查', status: 'done', priority: 'high', deadline: d(-85), detail: '访谈记录须受访人签字确认' },
    { title: '出具尽职调查报告', status: 'done', priority: 'high', deadline: d(-70), detail: '问题分级：重大 3 项、一般 5 项、提示 4 项' },
  ])

  await buildProjectGroup(writer, projectId, '专项 · 交易文件', [
    { title: '起草交易文件', status: 'done', priority: 'high', deadline: d(-55), detail: '增资协议、股东协议与配套文件' },
    { title: '参与谈判并修订交易文件', status: 'done', priority: 'high', deadline: d(-35), detail: '共四轮修订，逐轮留痕并标注让步' },
    { title: '定稿并协助签署交易文件', status: 'done', priority: 'high', deadline: d(-25), detail: '核对签署主体、授权文件与签署页' },
  ])

  await buildProjectGroup(writer, projectId, '专项 · 交割', [
    { title: '核查交割先决条件', status: 'done', priority: 'high', deadline: d(-20), detail: '逐项确认先决条件已满足或获豁免' },
    { title: '协助交割并签署交割确认', status: 'done', priority: 'high', deadline: d(-18) },
    { title: '跟进工商变更完成', status: 'done', priority: 'medium', deadline: d(-16), detail: '已取得变更后的营业执照' },
  ])

  await buildProjectGroup(writer, projectId, '结项归档', [
    { title: '归档交付物', status: 'doing', priority: 'medium', deadline: d(5), detail: '交付物、过程稿与往来邮件统一归档' },
    { title: '结算工时与费用', status: 'doing', priority: 'high', deadline: d(8), detail: '核对服务记录与实际工时，完成开票与回款' },
    { title: '编制结项报告', status: 'todo', priority: 'medium', deadline: d(12), detail: '经验沉淀与风险提示，为后续专项铺垫' },
  ])

  await projectStore.upsertKeyDate(projectId, { label: '尽职调查报告交付', date: d(-70) })
  await projectStore.upsertKeyDate(projectId, { label: '交割日', date: d(-18) })
  await projectStore.upsertKeyDate(projectId, { label: '项目结项', date: d(12) })

  await serviceStore.upsertService({
    name: '开展法律尽职调查', kind: '尽职调查', client: '某科技公司',
    status: 'done', date: d(-70), note: '出具尽调报告，问题分级 12 项，48 小时',
  })
  await serviceStore.upsertService({
    name: '起草并修订增资协议', kind: '文书起草', client: '某科技公司',
    status: 'done', date: d(-25), note: '完成四轮修订并定稿，36 小时',
  })
  await serviceStore.upsertService({
    name: '协助办理工商变更', kind: '其他', client: '某科技公司',
    status: 'done', date: d(-16), note: '完成变更登记，6 小时',
  })

  return projectId
}
