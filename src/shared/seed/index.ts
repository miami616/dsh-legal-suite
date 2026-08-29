/**
 * Built-in reference data seeding.
 *
 * On a fresh install (empty data dir) the plugin ships a rich sample case
 * (litigation) and sample project (non-litigation) so a new user immediately
 * sees a fully-populated demo instead of an empty board. Seeding is strictly
 * first-boot-only: it runs only when the target registry is empty and never
 * overwrites existing user data. Deleting the sample rows and re-booting does
 * NOT re-seed (the registry is no longer empty) — that is intentional: the
 * samples are a one-time onboarding aid, not a persistent fixture.
 *
 * All writes go through the same store methods the tools/UI use, so the seeded
 * data is structurally identical to user-created data (keydate sync, task
 * status recompute, change broadcasts all apply).
 */

import type { CaseStore } from '../../domains/litigation/store/case-store.ts'
import type { TimelineStore } from '../../domains/litigation/store/timeline-store.ts'
import type { ScheduleStore } from '../../domains/litigation/store/schedule-store.ts'
import type { ProjectStore } from '../../domains/nonlitigation/store/project-store.ts'
import type { ServiceStore } from '../../domains/nonlitigation/store/service-store.ts'

/** A stable, human-readable marker so users can identify the sample rows. */
export const SEED_TAG = '参考用例'

/**
 * Process-level guard: the plugin's apply/sync runs multiple times during boot
 * (cordis fiber reloads), and each run would otherwise see the registry as
 * still-empty before the previous seed's write lands, seeding duplicates.
 * This flag makes seeding run at most once per process.
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

/**
 * Seed one reference litigation case. Returns the created caseId, or undefined
 * when the registry was not empty (nothing seeded).
 */
export async function seedLitigationSample(
  caseStore: CaseStore,
  timelineStore: TimelineStore,
  scheduleStore: ScheduleStore,
): Promise<string | undefined> {
  if (seededOnce.has('litigation')) return undefined
  const registry = await caseStore.readRegistry()
  if (!isLitigationEmpty(registry)) return undefined
  seededOnce.add('litigation')
  const caseId = await seedLitigationCase(caseStore, timelineStore, scheduleStore)
  return caseId
}

/** Build the reference litigation case through the store methods. */
async function seedLitigationCase(
  caseStore: CaseStore,
  timelineStore: TimelineStore,
  scheduleStore: ScheduleStore,
): Promise<string> {
  const now = new Date()
  const y = now.getFullYear()
  const m = (n: number) => String(n).padStart(2, '0')
  const d = (offset: number) => {
    const t = new Date(now.getTime() + offset * 86400000)
    return `${t.getFullYear()}-${m(t.getMonth() + 1)}-${m(t.getDate())}`
  }

  // ── 案件登记（含当事人、标的、法院、审级、进度）──
  const record = await caseStore.registerCase({
    name: '某科技公司与某贸易公司买卖合同纠纷',
    type: '民事',
    cause: '买卖合同纠纷',
    status: '审理中',
    court: '北京市海淀区人民法院',
    judge: '王法官',
    level: '一审',
    caseNumber: `（${y}）京0108民初${String(1000 + (y % 100)).padStart(4, '0')}号`,
    claimAmount: '840000',
    filingDate: d(-30),
    ourSide: 'plaintiff',
    summary: '原告某科技公司向被告某贸易公司供应电子元器件，被告拖欠货款 84 万元。双方签订《购销合同》约定付款期限，被告逾期未付。原告已多次催告无果，遂诉至法院要求支付货款及逾期利息。',
    tags: [SEED_TAG, '货款纠纷', '合同'],
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

  // ── 任务树：一审阶段 → 任务 → 子任务 → 检查项 ──
  const g1 = await caseStore.upsertTaskGroup(caseId, { name: '一审阶段' })
  const groupId = g1.taskGroups![0].id

  // 任务1：准备起诉材料
  const t1 = await caseStore.upsertTask(caseId, groupId, {
    title: '准备起诉材料',
    status: 'done',
    priority: 'high',
    deadline: d(-25),
    detail: '收集合同、送货单、对账单、催款函等证据，起草起诉状',
  })
  const t1id = t1.taskGroups![0].tasks.find((t) => t.title === '准备起诉材料')!.id
  await caseStore.upsertSubtask(caseId, groupId, t1id, { title: '收集购销合同原件', done: true })
  await caseStore.upsertSubtask(caseId, groupId, t1id, { title: '整理送货单与签收记录', done: true })
  await caseStore.upsertSubtask(caseId, groupId, t1id, { title: '起草起诉状', done: true })
  await caseStore.upsertChecklist(caseId, groupId, t1id, { text: '核对合同金额与欠款一致', done: true })
  await caseStore.upsertChecklist(caseId, groupId, t1id, { text: '准备证据清单', done: true })

  // 任务2：立案
  const t2 = await caseStore.upsertTask(caseId, groupId, {
    title: '立案',
    status: 'done',
    priority: 'high',
    deadline: d(-20),
    detail: '向法院提交起诉状与证据，办理立案手续',
  })
  const t2id = t2.taskGroups![0].tasks.find((t) => t.title === '立案')!.id
  await caseStore.upsertSubtask(caseId, groupId, t2id, { title: '提交立案材料', done: true })
  await caseStore.upsertSubtask(caseId, groupId, t2id, { title: '缴纳诉讼费', done: true })
  await caseStore.upsertChecklist(caseId, groupId, t2id, { text: '确认立案通知书', done: true })

  // 任务3：开庭准备
  const t3 = await caseStore.upsertTask(caseId, groupId, {
    title: '开庭准备',
    status: 'doing',
    priority: 'high',
    deadline: d(7),
    detail: '准备庭审提纲、质证意见、代理意见',
  })
  const t3id = t3.taskGroups![0].tasks.find((t) => t.title === '开庭准备')!.id
  await caseStore.upsertSubtask(caseId, groupId, t3id, { title: '梳理争议焦点', done: true })
  await caseStore.upsertSubtask(caseId, groupId, t3id, { title: '准备质证意见', done: false })
  await caseStore.upsertSubtask(caseId, groupId, t3id, { title: '起草代理意见', done: false })
  await caseStore.upsertChecklist(caseId, groupId, t3id, { text: '核对证据原件', done: true })
  await caseStore.upsertChecklist(caseId, groupId, t3id, { text: '准备庭审提纲', done: false })

  // 任务4：举证
  const t4 = await caseStore.upsertTask(caseId, groupId, {
    title: '举证',
    status: 'todo',
    priority: 'medium',
    deadline: d(14),
    detail: '在举证期限内提交补充证据',
  })
  const t4id = t4.taskGroups![0].tasks.find((t) => t.title === '举证')!.id
  await caseStore.upsertSubtask(caseId, groupId, t4id, { title: '补充送货单原件', done: false })
  await caseStore.upsertChecklist(caseId, groupId, t4id, { text: '确认举证期限', done: false })

  // ── 关键日期（时间轴联动）──
  await caseStore.addKeyDate(caseId, '举证期限', d(14))
  await caseStore.addKeyDate(caseId, '开庭', d(7))

  // ── 时间轴事件 ──
  await timelineStore.upsertEvent({
    caseId,
    caseName: record.name,
    type: 'filing',
    title: '立案',
    date: d(-20),
    status: 'done',
    detail: '法院受理并立案',
  })
  await timelineStore.upsertEvent({
    caseId,
    caseName: record.name,
    type: 'evidence_deadline',
    title: '举证期限届满',
    date: d(14),
    status: 'pending',
    detail: '举证期限届满，需在此之前提交全部证据',
  })
  await timelineStore.upsertEvent({
    caseId,
    caseName: record.name,
    type: 'hearing',
    title: '第一次开庭',
    date: d(7),
    status: 'pending',
    detail: '北京市海淀区人民法院第3法庭',
  })

  // ── 日程 ──
  await scheduleStore.upsertItem({
    caseId,
    title: '开庭提醒',
    date: d(7),
    time: '09:30',
    kind: 'hearing',
  })

  return caseId
}

/**
 * Seed one reference non-litigation project. Returns the created projectId,
 * or undefined when the registry was not empty (nothing seeded).
 */
export async function seedNonLitigationSample(
  projectStore: ProjectStore,
  serviceStore: ServiceStore,
): Promise<string | undefined> {
  if (seededOnce.has('nonlitigation')) return undefined
  const registry = await projectStore.readRegistry()
  if (!isNonLitigationEmpty(registry)) return undefined
  seededOnce.add('nonlitigation')
  const projectId = await seedNonLitigationProject(projectStore, serviceStore)
  return projectId
}

/** Build the reference non-litigation project through the store methods. */
async function seedNonLitigationProject(
  projectStore: ProjectStore,
  serviceStore: ServiceStore,
): Promise<string> {
  const now = new Date()
  const y = now.getFullYear()
  const m = (n: number) => String(n).padStart(2, '0')
  const d = (offset: number) => {
    const t = new Date(now.getTime() + offset * 86400000)
    return `${t.getFullYear()}-${m(t.getMonth() + 1)}-${m(t.getDate())}`
  }

  // ── 项目登记 ──
  const project = await projectStore.registerProject({
    name: '某制造公司常年法律顾问',
    projectType: '常法',
    status: 'active',
    leadLawyer: '张律师',
    contractAmount: '120000',
    servicePeriod: { start: d(-60), end: d(305) },
    serviceScope: ['合同审查', '法律咨询', '合规审查', '劳动用工'],
    summary: '为某制造公司提供常年法律顾问服务，涵盖合同审查、日常法律咨询、合规审查与劳动用工管理。',
  })
  const projectId = project.projectId

  // ── 任务树 ──
  const g1 = await projectStore.upsertTaskGroup(projectId, { name: '合同审查' })
  const g1id = g1.taskGroups![0].id
  const pt1 = await projectStore.upsertTask(projectId, g1id, {
    title: '审查采购合同',
    status: 'doing',
    priority: 'high',
    deadline: d(3),
    detail: '审查供应商采购合同，重点核对付款条款与违约责任',
  })
  const pt1id = pt1.taskGroups![0].tasks.find((t) => t.title === '审查采购合同')!.id
  await projectStore.upsertSubtask(projectId, g1id, pt1id, { title: '核对付款条款', done: true })
  await projectStore.upsertSubtask(projectId, g1id, pt1id, { title: '审查违约责任', done: false })
  await projectStore.upsertSubtask(projectId, g1id, pt1id, { title: '出具审查意见', done: false })

  const pt2 = await projectStore.upsertTask(projectId, g1id, {
    title: '审查劳动合同',
    status: 'todo',
    priority: 'medium',
    deadline: d(10),
    detail: '审查新版劳动合同模板，确保符合劳动法规',
  })
  const pt2id = pt2.taskGroups![0].tasks.find((t) => t.title === '审查劳动合同')!.id
  await projectStore.upsertSubtask(projectId, g1id, pt2id, { title: '核对试用期条款', done: false })
  await projectStore.upsertSubtask(projectId, g1id, pt2id, { title: '审查竞业限制条款', done: false })

  const g2 = await projectStore.upsertTaskGroup(projectId, { name: '合规审查' })
  const g2id = g2.taskGroups![0].id
  await projectStore.upsertTask(projectId, g2id, {
    title: '数据合规审查',
    status: 'todo',
    priority: 'medium',
    deadline: d(20),
    detail: '审查公司数据收集与处理流程是否符合《个人信息保护法》',
  })

  const g3 = await projectStore.upsertTaskGroup(projectId, { name: '法律咨询' })
  const g3id = g3.taskGroups![0].id
  await projectStore.upsertTask(projectId, g3id, {
    title: '处理劳动仲裁咨询',
    status: 'done',
    priority: 'high',
    deadline: d(-5),
    detail: '就员工离职纠纷提供法律意见',
  })

  // ── 关键日期 ──
  await projectStore.upsertKeyDate(projectId, { label: '合同到期日', date: d(305) })
  await projectStore.upsertKeyDate(projectId, { label: '年度服务费到期', date: d(305) })

  // ── 服务记录 ──
  await serviceStore.upsertService({
    name: '采购合同审查',
    kind: '合同审查',
    client: '某制造公司',
    status: 'done',
    date: d(-10),
    note: '完成供应商采购合同审查，出具审查意见',
  })
  await serviceStore.upsertService({
    name: '劳动仲裁咨询',
    kind: '法律咨询',
    client: '某制造公司',
    status: 'done',
    date: d(-5),
    note: '就员工离职纠纷提供法律意见',
  })

  return projectId
}
