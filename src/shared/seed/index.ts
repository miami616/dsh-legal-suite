/**
 * Built-in reference data seeding.
 *
 * On a fresh install (empty data dir) the plugin ships three litigation cases
 * and three non-litigation projects covering **different stages**, so a new
 * user immediately sees what the same product looks like at different points
 * in a matter's life — rather than three rows that all look the same.
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
import type { ProjectStore } from '../../domains/nonlitigation/store/project-store.ts'
import type { ServiceStore } from '../../domains/nonlitigation/store/service-store.ts'
import { daysBefore } from '../playbook/litigation.ts'

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

/* --------------------------------------------------------------- 播种入口 */

/**
 * Seed the reference litigation cases. Returns the id of the primary case
 * (the 待开庭 one), or undefined when the registry was not empty.
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
  const D = dateFn()
  // 三组案例覆盖三种截然不同的状态：诉前 / 待开庭 / 执行。
  await seedPrefilingCase(caseStore, timelineStore, scheduleStore, D)
  const primaryId = await seedAwaitingTrialCase(caseStore, timelineStore, scheduleStore, D)
  await seedExecutionCase(caseStore, timelineStore, scheduleStore, D)
  return primaryId
}

/** Seed the reference non-litigation projects. Returns the retainer project id. */
export async function seedNonLitigationSample(
  projectStore: ProjectStore,
  serviceStore: ServiceStore,
): Promise<string | undefined> {
  if (seededOnce.has('nonlitigation')) return undefined
  const registry = await projectStore.readRegistry()
  if (!isNonLitigationEmpty(registry)) return undefined
  seededOnce.add('nonlitigation')
  const D = dateFn()
  // 三组项目覆盖三种状态与两类业务：已签约专项 / 进行中常法 / 已完成专项。
  await seedRetainedSpecialProject(projectStore, serviceStore, D)
  const retainerId = await seedActiveRetainerProject(projectStore, serviceStore, D)
  await seedCompletedDueDiligenceProject(projectStore, serviceStore, D)
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

/** Materialize one task group (stage) with its tasks, subtasks and checks. */
async function buildCaseGroup(
  caseStore: CaseStore,
  caseId: string,
  groupName: string,
  tasks: SeedTask[],
): Promise<void> {
  const g = await caseStore.upsertTaskGroup(caseId, { name: groupName })
  const groupId = g.taskGroups!.at(-1)!.id
  for (const t of tasks) {
    const record = await caseStore.upsertTask(caseId, groupId, {
      title: t.title,
      status: t.status,
      priority: t.priority ?? 'medium',
      deadline: t.deadline,
      detail: t.detail,
    })
    const created = record.taskGroups!.find((x) => x.id === groupId)!.tasks
      .find((x) => x.title === t.title)
    if (created === undefined) continue
    for (const st of t.subtasks ?? []) {
      await caseStore.upsertSubtask(caseId, groupId, created.id, st)
    }
    for (const c of t.checklist ?? []) {
      await caseStore.upsertChecklist(caseId, groupId, created.id, c)
    }
    if (t.keydate === true && t.deadline !== undefined) {
      await caseStore.setTaskKeyDate(caseId, groupId, created.id, true)
    }
  }
}

/** Materialize one non-litigation task group (checklist items are add+toggle). */
async function buildProjectGroup(
  projectStore: ProjectStore,
  projectId: string,
  groupName: string,
  tasks: SeedTask[],
): Promise<void> {
  const g = await projectStore.upsertTaskGroup(projectId, { name: groupName })
  const groupId = g.taskGroups!.at(-1)!.id
  for (const t of tasks) {
    const record = await projectStore.upsertTask(projectId, groupId, {
      title: t.title,
      status: t.status,
      priority: t.priority ?? 'medium',
      deadline: t.deadline,
      detail: t.detail,
    })
    const created = record.taskGroups!.find((x) => x.id === groupId)!.tasks
      .find((x) => x.title === t.title)
    if (created === undefined) continue
    for (const st of t.subtasks ?? []) {
      // 展开成对象字面量：project-store 的入参类型是 Record<string, unknown>，
      // 直接传带具体字段类型的接口会因缺少索引签名被拒。
      await projectStore.upsertSubtask(projectId, groupId, created.id, { ...st })
    }
    for (const c of t.checklist ?? []) {
      const added = await projectStore.addChecklistItem(projectId, groupId, created.id, c.text)
      const item = added.taskGroups!.find((x) => x.id === groupId)!.tasks
        .find((x) => x.id === created.id)!.checklist?.at(-1)
      if (c.done && item !== undefined) {
        await projectStore.toggleChecklist(projectId, groupId, created.id, item.id)
      }
    }
  }
}

/* ============================================================ 诉讼 · 案例一 */

/**
 * 案例一：诉前阶段（pre_filing）。
 * 特点：**未立案**，因此法院、案号、立案日期全部留空——这是刻意的，用来示范
 * 「信息随案件推进逐步补全」而不是一上来把字段填满。
 */
async function seedPrefilingCase(
  caseStore: CaseStore,
  timelineStore: TimelineStore,
  scheduleStore: ScheduleStore,
  d: DateFn,
): Promise<string> {
  const record = await caseStore.registerCase({
    name: '某建筑公司与某地产公司建设工程施工合同纠纷',
    type: '民商',
    cause: '建设工程',
    status: 'pre_filing',
    level: '一审',
    claimAmount: '2360000',
    ourSide: 'plaintiff',
    summary: '某建筑公司承建某地产公司开发的住宅项目，工程已竣工验收并完成结算，地产公司尚欠工程尾款 236 万元未付，其以部分工程质量瑕疵与工期延误为由拒付。现处于诉前阶段：正在梳理施工与结算证据、核查诉讼时效与管辖，并评估是否存在转移财产迹象，以决定是否申请诉前财产保全。',
    tags: [SEED_TAG, '建设工程', '诉前'],
    parties: {
      plaintiff: '某建筑公司',
      defendant: '某地产公司',
      ourSide: 'plaintiff',
      details: [
        { name: '某建筑公司', role: '原告', address: '北京市丰台区南三环西路16号', legalRep: '孙总', creditCode: '91110106MA01XXXXX3', phone: '13800000011', ourClient: true },
        { name: '某地产公司', role: '被告', address: '北京市通州区运河东大街58号', legalRep: '周总', creditCode: '91110112MA01XXXXX4', phone: '13800000012' },
      ],
    },
  })
  const caseId = record.caseId

  await buildCaseGroup(caseStore, caseId, '诉前 · 诉前准备', [
    {
      title: '核查利益冲突', status: 'done', priority: 'high', deadline: d(-10),
      detail: '检索本所已办/在办案件，确认无利益冲突后方可收案',
      subtasks: [{ title: '检索本所案件库', done: true }, { title: '填写利益冲突核查表', done: true }],
    },
    {
      title: '签订委托代理合同', status: 'done', priority: 'high', deadline: d(-9),
      detail: '明确代理权限、收费方式与收费金额',
      checklist: [{ text: '确认授权委托书签署', done: true }, { text: '确认收费到账', done: true }],
    },
    {
      title: '梳理案情并编制证据清单', status: 'doing', priority: 'high', deadline: d(3),
      detail: '施工合同、竣工验收资料、结算书与签证单是本案的核心证据链',
      subtasks: [
        { title: '调取竣工验收资料', done: true },
        { title: '整理结算书与现场签证单', done: false },
        { title: '编制证据目录', done: false },
      ],
      checklist: [
        { text: '核对合同金额与结算金额一致', done: true },
        { text: '标注每份证据的原件存放位置', done: false },
      ],
    },
    {
      title: '核查诉讼时效与管辖', status: 'doing', priority: 'high', deadline: d(5),
      detail: '竣工验收日与结算日决定诉讼时效起算点；建设工程施工合同纠纷由工程所在地法院专属管辖',
    },
    {
      title: '发送律师函', status: 'done', priority: 'medium', deadline: d(-4),
      detail: '留痕催告，同时为后续主张利息固定证据',
    },
    {
      title: '评估诉前财产保全可行性', status: 'doing', priority: 'medium', deadline: d(6),
      detail: '若存在转移财产迹象应申请诉前保全，注意保全后 30 日内须提起诉讼',
    },
    {
      title: '开展诉前调解', status: 'todo', priority: 'low', deadline: d(18),
      detail: '争议金额较大但双方仍有合作基础，可先试探调解空间',
    },
  ])

  // 「下一阶段预告」：只占位两条关键任务，不铺满立案阶段。
  await buildCaseGroup(caseStore, caseId, '一审 · 立案（预排）', [
    { title: '起草起诉状', status: 'todo', priority: 'high', deadline: d(20), detail: '待诉前证据梳理完成后启动' },
    { title: '整理证据材料并编制证据清单', status: 'todo', priority: 'high', deadline: d(22) },
  ])

  await caseStore.addKeyDate(caseId, '诉讼时效届满', d(150))

  await timelineStore.upsertEvent({
    caseId, caseName: record.name, type: 'case_event', title: '收案',
    date: d(-10), status: 'done', detail: '签订委托代理合同，案件进入诉前阶段',
  })
  await timelineStore.upsertEvent({
    caseId, caseName: record.name, type: 'mediation', title: '诉前调解',
    date: d(18), status: 'pending', detail: '与对方代理人在律所进行首轮调解',
  })

  await scheduleStore.upsertItem({
    caseId, title: '参加诉前调解', date: d(18), time: '14:00', kind: 'mediation',
  })

  return caseId
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

  await buildCaseGroup(caseStore, caseId, '一审 · 立案', [
    { title: '起草起诉状', status: 'done', priority: 'high', deadline: d(-32), detail: '诉请本金、逾期利息与诉讼费承担' },
    { title: '整理证据材料并编制证据清单', status: 'done', priority: 'high', deadline: d(-31) },
    { title: '计算并缴纳诉讼费', status: 'done', priority: 'medium', deadline: d(-30) },
    { title: '递交立案材料', status: 'done', priority: 'high', deadline: d(-30) },
    {
      title: '领取受理通知书与举证通知书', status: 'done', priority: 'high', deadline: d(-28),
      detail: '举证通知书载明的举证期限是后续全部排期的锚点',
    },
  ])

  await buildCaseGroup(caseStore, caseId, '一审 · 庭前准备', [
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

  await buildCaseGroup(caseStore, caseId, '一审 · 开庭审理', [
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

  await timelineStore.upsertEvent({
    caseId, caseName: record.name, type: 'filing', title: '立案',
    date: d(-30), status: 'done', detail: '法院受理并立案',
  })
  await timelineStore.upsertEvent({
    caseId, caseName: record.name, type: 'defense_deadline', title: '答辩期届满',
    date: d(-15), status: 'done', detail: '被告已提交答辩状',
  })
  await timelineStore.upsertEvent({
    caseId, caseName: record.name, type: 'evidence_deadline', title: '举证期限届满',
    date: evidenceDeadline, status: 'pending', detail: '需在此之前提交全部证据',
  })
  await timelineStore.upsertEvent({
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

  await buildCaseGroup(caseStore, caseId, '执行 · 强制执行', [
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

  await buildCaseGroup(caseStore, caseId, '执行 · 结案归档', [
    { title: '结案归档', status: 'todo', priority: 'low', detail: '卷宗归档、费用结算与未结事项交接' },
  ])

  await caseStore.addKeyDate(caseId, '执行立案', d(-25))
  await caseStore.addKeyDate(caseId, '执行款项到账', d(45))

  await timelineStore.upsertEvent({
    caseId, caseName: record.name, type: 'judgment', title: '一审判决',
    date: d(-70), status: 'done', detail: '判令偿还本金 56 万元及利息',
  })
  await timelineStore.upsertEvent({
    caseId, caseName: record.name, type: 'service', title: '判决书送达',
    date: d(-65), status: 'done', detail: '双方均未上诉，判决生效',
  })
  await timelineStore.upsertEvent({
    caseId, caseName: record.name, type: 'deadline', title: '判决履行期限届满',
    date: d(-35), status: 'done', detail: '被执行人未按期履行',
  })
  await timelineStore.upsertEvent({
    caseId, caseName: record.name, type: 'execution', title: '执行立案',
    date: d(-25), status: 'done', detail: '法院立案并启动网络查控',
  })
  await timelineStore.upsertEvent({
    caseId, caseName: record.name, type: 'case_event', title: '参加执行谈话',
    date: d(12), status: 'pending', detail: '北京市朝阳区人民法院执行局',
  })

  await scheduleStore.upsertItem({
    caseId, title: '参加执行谈话', date: d(12), time: '10:00', kind: 'execution',
  })

  return caseId
}

/* ============================================================ 非诉 · 项目一 */

/**
 * 项目一：专项 · 已签约（retained）。
 * 特点：刚签约，处于服务启动期——尚未产生交付物，任务集中在启动准备。
 */
async function seedRetainedSpecialProject(
  projectStore: ProjectStore,
  serviceStore: ServiceStore,
  d: DateFn,
): Promise<string> {
  const project = await projectStore.registerProject({
    name: '某新能源公司股权激励专项法律服务',
    projectType: 'special',
    status: 'retained',
    leadLawyer: '李律师',
    contractAmount: '380000',
    servicePeriod: { start: d(-5), end: d(85) },
    serviceScope: ['激励方案设计', '持股平台搭建', '授予协议起草', '员工沟通'],
    summary: '为某新能源公司设计并落地核心员工股权激励计划，覆盖持股平台搭建、激励方案设计、授予协议起草与员工沟通。服务期三个月，目前处于服务启动阶段。',
  })
  const projectId = project.projectId

  await buildProjectGroup(projectStore, projectId, '服务启动', [
    { title: '签订法律服务合同', status: 'done', priority: 'high', deadline: d(-5), detail: '明确服务范围、服务期限与收费方式' },
    { title: '组建服务团队', status: 'done', priority: 'high', deadline: d(-4), detail: '主办李律师，协办陈律师；联系方式已书面备案' },
    {
      title: '召开服务启动会', status: 'doing', priority: 'high', deadline: d(2),
      detail: '对齐激励范围、授予节奏与税务口径',
      subtasks: [
        { title: '拟定启动会议程', done: true },
        { title: '准备股权结构现状说明', done: false },
      ],
      checklist: [{ text: '会后形成纪要并发送客户确认', done: false }],
    },
    { title: '盘点存量法律风险', status: 'todo', priority: 'medium', deadline: d(8), detail: '梳理现有股权结构与历史授予记录' },
  ])

  await buildProjectGroup(projectStore, projectId, '专项 · 交易文件', [
    { title: '起草交易文件', status: 'todo', priority: 'high', deadline: d(30), detail: '授予协议、持股平台合伙协议' },
  ])

  await projectStore.upsertKeyDate(projectId, { label: '交易文件定稿', date: d(45) })
  await projectStore.upsertKeyDate(projectId, { label: '服务期届满', date: d(85) })

  await serviceStore.upsertService({
    name: '参加股权激励项目启动会', kind: '法律咨询', client: '某新能源公司',
    status: 'done', date: d(-4), note: '明确激励范围与项目时间表，1.5 小时',
  })

  return projectId
}

/* ============================================================ 非诉 · 项目二 */

/**
 * 项目二：常法 · 进行中（active）。
 * 特点：服务期 60 天后届满，演示常法的日常履约节奏 + 续约提醒这条主线。
 */
async function seedActiveRetainerProject(
  projectStore: ProjectStore,
  serviceStore: ServiceStore,
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

  await buildProjectGroup(projectStore, projectId, '日常履约 · 合同审查', [
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

  await buildProjectGroup(projectStore, projectId, '日常履约 · 法律咨询', [
    { title: '答复日常法律咨询', status: 'doing', priority: 'high', deadline: d(1), detail: '口头咨询当日回复，书面咨询按约定时效回复' },
    { title: '出具法律意见书', status: 'todo', priority: 'high', deadline: d(10), detail: '重大事项须书面意见，明确结论、依据与风险提示' },
    { title: '更新咨询台账', status: 'doing', priority: 'medium', deadline: d(1), detail: '登记时间、事项、答复要点与耗时，是年度服务报告的数据来源' },
  ])

  await buildProjectGroup(projectStore, projectId, '日常履约 · 合规审查', [
    { title: '开展数据合规审查', status: 'todo', priority: 'medium', deadline: d(20), detail: '核查个人信息收集、处理与跨境传输的合规性' },
    { title: '开展劳动用工合规审查', status: 'todo', priority: 'medium', deadline: d(45), detail: '核查劳动合同、工时、社保与竞业限制' },
    { title: '跟进整改落实', status: 'todo', priority: 'medium', detail: '整改事项闭环，留存整改证据' },
  ])

  await buildProjectGroup(projectStore, projectId, '服务报告与续约', [
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

  await buildProjectGroup(projectStore, projectId, '专项 · 尽职调查', [
    { title: '发送尽职调查清单', status: 'done', priority: 'high', deadline: d(-115), detail: '按主体资格、资产、业务、债权债务、劳动、争议分模块列清单' },
    { title: '收集并审阅尽调资料', status: 'done', priority: 'high', deadline: d(-100), detail: '资料编号归档，缺口逐项催补' },
    { title: '开展访谈与现场核查', status: 'done', priority: 'high', deadline: d(-85), detail: '访谈记录须受访人签字确认' },
    { title: '出具尽职调查报告', status: 'done', priority: 'high', deadline: d(-70), detail: '问题分级：重大 3 项、一般 5 项、提示 4 项' },
  ])

  await buildProjectGroup(projectStore, projectId, '专项 · 交易文件', [
    { title: '起草交易文件', status: 'done', priority: 'high', deadline: d(-55), detail: '增资协议、股东协议与配套文件' },
    { title: '参与谈判并修订交易文件', status: 'done', priority: 'high', deadline: d(-35), detail: '共四轮修订，逐轮留痕并标注让步' },
    { title: '定稿并协助签署交易文件', status: 'done', priority: 'high', deadline: d(-25), detail: '核对签署主体、授权文件与签署页' },
  ])

  await buildProjectGroup(projectStore, projectId, '专项 · 交割', [
    { title: '核查交割先决条件', status: 'done', priority: 'high', deadline: d(-20), detail: '逐项确认先决条件已满足或获豁免' },
    { title: '协助交割并签署交割确认', status: 'done', priority: 'high', deadline: d(-18) },
    { title: '跟进工商变更完成', status: 'done', priority: 'medium', deadline: d(-16), detail: '已取得变更后的营业执照' },
  ])

  await buildProjectGroup(projectStore, projectId, '结项归档', [
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
