/**
 * Standalone verification of the built-in reference seeding + task write-through.
 *
 * Exercises:
 *  1. seedLitigationSample / seedNonLitigationSample create two reference
 *     cases and two reference projects covering DIFFERENT stages, and are
 *     no-ops on a non-empty registry.
 *  2. Seeded rows are **terminologically canonical**: every case status, task
 *     title and key-date label must come from the shared playbook. This is the
 *     machine-enforced half of the "same thing must always read the same way"
 *     rule — the persona prompt is the other half, but prompts drift and
 *     assertions do not.
 *  3. The task module's write-through path (upsertTask with source/sourceId/
 *     groupId) updates the source litigation / non-litigation store.
 *
 * Run: node scripts/verify-seed-sync.mjs
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCaseStore } from '../lib/domains/litigation/store/index.js'
import { createTimelineStore } from '../lib/domains/litigation/store/index.js'
import { createScheduleStore } from '../lib/domains/litigation/store/index.js'
import { createProjectStore } from '../lib/domains/nonlitigation/store/project-store.js'
import { createServiceStore } from '../lib/domains/nonlitigation/store/service-store.js'
import { seedLitigationSample, seedNonLitigationSample } from '../lib/shared/seed/index.js'
import {
  LITIGATION_STATUSES,
  STATUS_LADDERS,
  getStatusLadder,
  KEYDATE_LABELS,
  isCanonicalTaskTitle,
} from '../lib/shared/playbook/litigation.js'
import {
  PROJECT_STATUSES,
  PROJECT_KEYDATE_LABELS,
  isCanonicalProjectTaskTitle,
} from '../lib/shared/playbook/nonlitigation.js'

let failures = 0
function check(name, cond, extra = '') {
  const ok = Boolean(cond)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
  if (!ok) failures++
}

/** Collect every task title across all groups of a case/project. */
function allTaskTitles(record) {
  return (record?.taskGroups ?? []).flatMap((g) => g.tasks.map((t) => t.title))
}

const dataDir = await mkdtemp(join(tmpdir(), 'ls-seed-'))
try {
  const caseStore = createCaseStore(dataDir)
  const timelineStore = createTimelineStore(dataDir)
  const scheduleStore = createScheduleStore(dataDir)
  const projectStore = createProjectStore(dataDir)
  const serviceStore = createServiceStore(dataDir)

  // ============ 1. seed litigation ============
  const caseId = await seedLitigationSample(caseStore, timelineStore, scheduleStore, undefined, dataDir)
  check('seedLitigationSample returns caseId', caseId !== undefined, String(caseId))
  const caseRec = await caseStore.readCase(caseId)
  check('primary case name', caseRec?.name === '某科技公司与某贸易公司买卖合同纠纷', caseRec?.name)
  check('primary case has parties', caseRec?.parties?.plaintiff === '某科技公司', JSON.stringify(caseRec?.parties))

  // ---- 两组案例，两种不同状态 ----
  const registry = await caseStore.readRegistry()
  const cases = Object.values(registry.cases)
  check('seeded 2 litigation cases', cases.length === 2, `count=${cases.length}`)
  const statuses = cases.map((c) => c.status)
  check('2 distinct case statuses', new Set(statuses).size === 2, statuses.join(','))
  check(
    'statuses cover 庭前准备/执行中 (docx 档位)',
    ['pretrial', 'executing'].every((s) => statuses.includes(s)),
    statuses.join(','),
  )

  // ---- 状态必须在「按审级」的规范阶梯内（一审/二审/执行各有阶梯） ----
  const badStatus = cases
    .filter((c) => !getStatusLadder(c.level).some((s) => s.id === c.status))
    .map((c) => `${c.name}[${c.level}]:${c.status}`)
  check('all case statuses canonical (per-level ladder)', badStatus.length === 0, badStatus.join(' | '))

  // ---- 任务名必须「写动作不写状态」 ----
  const badTitles = cases.flatMap((c) => allTaskTitles(c).filter((t) => !isCanonicalTaskTitle(t)))
  check('all case task titles canonical', badTitles.length === 0, badTitles.join(' | '))

  // ---- 关键日期标签必须取自规范词表 ----
  const validKeyDates = new Set(KEYDATE_LABELS)
  // 任务派生的关键日期以任务标题为标签（set_task_keydate 的行为），因此标签
  // 合法的判定是：在规范词表内，**或**等于本案某个规范任务名。
  const badKeyDates = cases.flatMap((c) => {
    const ownTitles = new Set(allTaskTitles(c))
    return (c.keyDates ?? [])
      .map((k) => k.label)
      .filter((l) => !validKeyDates.has(l) && !ownTitles.has(l))
  })
  check('all case keydate labels canonical', badKeyDates.length === 0, badKeyDates.join(' | '))

  // ---- 主案例结构完整性（docx：庭前准备含开庭动作） ----
  check('primary case has >= 2 task groups', (caseRec?.taskGroups?.length ?? 0) >= 2, `groups=${caseRec?.taskGroups?.length}`)
  const trialGroup = caseRec?.taskGroups?.find((g) => g.name === '一审 · 庭前准备')
  const trialTask = trialGroup?.tasks.find((t) => t.title === '制作庭审提纲')
  check('庭前准备组含 制作庭审提纲（docx 庭前含开庭）', trialTask !== undefined, JSON.stringify(trialGroup?.tasks.map((t) => t.title)))
  check('trial task has subtasks', (trialTask?.subtasks?.length ?? 0) >= 2, `subtasks=${trialTask?.subtasks?.length}`)
  check('trial task has checklist', (trialTask?.checklist?.length ?? 0) >= 1, `checklist=${trialTask?.checklist?.length}`)
  check('primary case has keydates', (caseRec?.keyDates?.length ?? 0) >= 2, `keyDates=${caseRec?.keyDates?.length}`)
  const events = await timelineStore.listEvents(caseId)
  check('primary case timeline events', events.length >= 4, `events=${events.length}`)
  const schedules = await scheduleStore.listItems(caseId)
  check('primary case schedules', schedules.length >= 1, `schedules=${schedules.length}`)

  // 执行案例应有自己独有的任务（与诉讼阶段不重叠）
  const execCase = cases.find((c) => c.status === 'executing')
  const execTitles = allTaskTitles(execCase)
  check('execution case has stage-unique tasks', execTitles.includes('提供被执行人财产线索'), execTitles.join(','))

  // seeding is idempotent (no-op on non-empty registry)
  const again = await seedLitigationSample(caseStore, timelineStore, scheduleStore, undefined, dataDir)
  check('seedLitigationSample no-op on non-empty', again === undefined, String(again))

  // ============ 2. seed non-litigation ============
  const projectId = await seedNonLitigationSample(projectStore, serviceStore, undefined, dataDir)
  check('seedNonLitigationSample returns projectId', projectId !== undefined, String(projectId))
  check('projectId is numeric YYYY-NNN', /^\d{4}-\d{3}$/.test(projectId ?? ''), String(projectId))
  const proj = await projectStore.readProject(projectId)
  check('retainer project name', proj?.name === '某制造公司常年法律顾问', proj?.name)

  const pRegistry = await projectStore.readRegistry()
  const projects = Object.values(pRegistry.projects)
  check('seeded 2 projects', projects.length === 2, `count=${projects.length}`)
  const pStatuses = projects.map((p) => p.status)
  check('2 distinct project statuses', new Set(pStatuses).size === 2, pStatuses.join(','))
  check(
    'project statuses cover 进行中常法/已完成专项',
    ['active', 'completed'].every((s) => pStatuses.includes(s)),
    pStatuses.join(','),
  )

  const validPStatusIds = new Set(PROJECT_STATUSES.map((s) => s.id))
  const badPStatus = projects.filter((p) => !validPStatusIds.has(p.status)).map((p) => `${p.name}:${p.status}`)
  check('all project statuses canonical', badPStatus.length === 0, badPStatus.join(' | '))

  const badPTitles = projects.flatMap((p) => allTaskTitles(p).filter((t) => !isCanonicalProjectTaskTitle(t)))
  check('all project task titles canonical', badPTitles.length === 0, badPTitles.join(' | '))

  const validPKeyDates = new Set(PROJECT_KEYDATE_LABELS)
  const badPKeyDates = projects
    .flatMap((p) => (p.keyDates ?? []).map((k) => k.label))
    .filter((l) => !validPKeyDates.has(l))
  check('all project keydate labels canonical', badPKeyDates.length === 0, badPKeyDates.join(' | '))

  check('retainer project has >= 3 task groups', (proj?.taskGroups?.length ?? 0) >= 3, `groups=${proj?.taskGroups?.length}`)
  check('retainer project has keydates', (proj?.keyDates?.length ?? 0) >= 1, `keyDates=${proj?.keyDates?.length}`)
  const services = await serviceStore.listServices()
  check('seeded service records', services.length >= 6, `services=${services.length}`)

  const again2 = await seedNonLitigationSample(projectStore, serviceStore, undefined, dataDir)
  check('seedNonLitigationSample no-op on non-empty', again2 === undefined, String(again2))

  // ============ 3. task write-through (litigation) ============
  const litGroup = caseRec.taskGroups[0]
  const litTask = litGroup.tasks[0]
  const updated = await caseStore.upsertTask(caseId, litGroup.id, { id: litTask.id, status: 'done' })
  const updatedTask = updated.taskGroups[0].tasks.find((t) => t.id === litTask.id)
  check('litigation write-through updates status', updatedTask?.status === 'done', updatedTask?.status)

  // ============ 4. task write-through (non-litigation) ============
  const nlGroup = proj.taskGroups[0]
  const nlTask = nlGroup.tasks.find((t) => t.title === '审查采购合同')
  const nlUpdated = await projectStore.upsertTask(projectId, nlGroup.id, { id: nlTask.id, status: 'done' })
  const nlUpdatedTask = nlUpdated.taskGroups[0].tasks.find((t) => t.id === nlTask.id)
  check('non-litigation write-through updates status', nlUpdatedTask?.status === 'done', nlUpdatedTask?.status)

  // ============ 5. 磁盘标记：删光演示后重启不复活（备忘录 #3 深层修复） ============
  // 已写 .agentlex-seeded-litigation 标记；清空 registry 模拟「用户删光演示」。
  const emptied = await mkdtemp(join(tmpdir(), 'ls-seed-empty-'))
  try {
    const cs2 = createCaseStore(emptied)
    const tl2 = createTimelineStore(emptied)
    const sch2 = createScheduleStore(emptied)
    // 把播种标记复制到"新"目录 → 模拟同一数据目录曾播过、现用户清空
    const { copyFileSync } = await import('node:fs')
    copyFileSync(join(dataDir, '.agentlex-seeded-litigation'), join(emptied, '.agentlex-seeded-litigation'))
    const respawn = await seedLitigationSample(cs2, tl2, sch2, undefined, emptied)
    check('删光演示 + 有标记 → 不复活（不重新播种）', respawn === undefined, String(respawn))
    const respawnReg = await cs2.readRegistry()
    check('删光演示后 registry 保持空', Object.keys(respawnReg.cases).length === 0, String(Object.keys(respawnReg.cases).length))
  } finally {
    await rm(emptied, { recursive: true, force: true })
  }

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`)
  process.exit(failures === 0 ? 0 : 1)
} finally {
  await rm(dataDir, { recursive: true, force: true })
}
