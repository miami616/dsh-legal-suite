/**
 * Standalone verification of the built-in reference seeding + task write-through.
 *
 * Exercises:
 *  1. seedLitigationSample / seedNonLitigationSample create rich reference data
 *     on an empty registry, and are no-ops on a non-empty registry.
 *  2. The task module's write-through path (upsertTask with source/sourceId/
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

let failures = 0
function check(name, cond, extra = '') {
  const ok = Boolean(cond)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
  if (!ok) failures++
}

const dataDir = await mkdtemp(join(tmpdir(), 'ls-seed-'))
try {
  const caseStore = createCaseStore(dataDir)
  const timelineStore = createTimelineStore(dataDir)
  const scheduleStore = createScheduleStore(dataDir)
  const projectStore = createProjectStore(dataDir)
  const serviceStore = createServiceStore(dataDir)

  // ============ 1. seed litigation ============
  const caseId = await seedLitigationSample(caseStore, timelineStore, scheduleStore)
  check('seedLitigationSample returns caseId', caseId !== undefined, String(caseId))
  const caseRec = await caseStore.readCase(caseId)
  check('seeded case has name', caseRec?.name === '某科技公司与某贸易公司买卖合同纠纷', caseRec?.name)
  check('seeded case has parties', caseRec?.parties?.plaintiff === '某科技公司', JSON.stringify(caseRec?.parties))
  check('seeded case has taskGroups', (caseRec?.taskGroups?.length ?? 0) > 0, `groups=${caseRec?.taskGroups?.length}`)
  const group = caseRec?.taskGroups?.[0]
  check('seeded case has tasks', (group?.tasks?.length ?? 0) >= 3, `tasks=${group?.tasks?.length}`)
  const task = group?.tasks?.find((t) => t.title === '开庭准备')
  check('seeded task has subtasks', (task?.subtasks?.length ?? 0) >= 2, `subtasks=${task?.subtasks?.length}`)
  check('seeded task has checklist', (task?.checklist?.length ?? 0) >= 1, `checklist=${task?.checklist?.length}`)
  check('seeded case has keyDates', (caseRec?.keyDates?.length ?? 0) >= 2, `keyDates=${caseRec?.keyDates?.length}`)
  const events = await timelineStore.listEvents(caseId)
  check('seeded timeline events', events.length >= 3, `events=${events.length}`)
  const schedules = await scheduleStore.listItems(caseId)
  check('seeded schedules', schedules.length >= 1, `schedules=${schedules.length}`)

  // seeding is idempotent (no-op on non-empty registry)
  const again = await seedLitigationSample(caseStore, timelineStore, scheduleStore)
  check('seedLitigationSample no-op on non-empty', again === undefined, String(again))

  // ============ 2. seed non-litigation ============
  const projectId = await seedNonLitigationSample(projectStore, serviceStore)
  check('seedNonLitigationSample returns projectId', projectId !== undefined, String(projectId))
  const proj = await projectStore.readProject(projectId)
  check('seeded project has name', proj?.name === '某制造公司常年法律顾问', proj?.name)
  check('seeded project has taskGroups', (proj?.taskGroups?.length ?? 0) >= 3, `groups=${proj?.taskGroups?.length}`)
  check('seeded project has keyDates', (proj?.keyDates?.length ?? 0) >= 1, `keyDates=${proj?.keyDates?.length}`)
  const services = await serviceStore.listServices()
  check('seeded services', services.length >= 1, `services=${services.length}`)
  const again2 = await seedNonLitigationSample(projectStore, serviceStore)
  check('seedNonLitigationSample no-op on non-empty', again2 === undefined, String(again2))

  // ============ 3. task write-through (litigation) ============
  // Simulate the task module's write-through: update a litigation task's status
  // via the source store's upsertTask (same call the task route makes).
  const litGroup = caseRec.taskGroups[0]
  const litTask = litGroup.tasks.find((t) => t.title === '开庭准备')
  const updated = await caseStore.upsertTask(caseId, litGroup.id, { id: litTask.id, status: 'done' })
  const updatedTask = updated.taskGroups[0].tasks.find((t) => t.id === litTask.id)
  check('litigation write-through updates status', updatedTask?.status === 'done', updatedTask?.status)

  // ============ 4. task write-through (non-litigation) ============
  const nlGroup = proj.taskGroups[0]
  const nlTask = nlGroup.tasks.find((t) => t.title === '审查采购合同')
  const nlUpdated = await projectStore.upsertTask(projectId, nlGroup.id, { id: nlTask.id, status: 'done' })
  const nlUpdatedTask = nlUpdated.taskGroups[0].tasks.find((t) => t.id === nlTask.id)
  check('non-litigation write-through updates status', nlUpdatedTask?.status === 'done', nlUpdatedTask?.status)

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`)
  process.exit(failures === 0 ? 0 : 1)
} finally {
  await rm(dataDir, { recursive: true, force: true })
}
