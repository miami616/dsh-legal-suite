/**
 * Standalone verification of the litigation upsert fix.
 * Exercises create-if-not-found semantics for upsertTaskGroup / upsertTask /
 * upsertSubtask / upsertChecklist against a throwaway data dir.
 *
 * Run: node scripts/verify-upsert-fix.mjs
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCaseStore } from '../lib/domains/litigation/store/index.js'

let failures = 0
function check(name, cond, extra = '') {
  const ok = Boolean(cond)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
  if (!ok) failures++
}

const dataDir = await mkdtemp(join(tmpdir(), 'ls-upsert-'))
try {
  const cs = createCaseStore(dataDir)

  // --- register a case with one group + one task ---
  const reg = await cs.registerCase({ name: '测试案', type: '民事', cause: '合同纠纷' })
  const caseId = reg.caseId
  const g1 = await cs.upsertTaskGroup(caseId, { name: '一审阶段' })
  const groupId = g1.taskGroups[0].id
  const t1 = await cs.upsertTask(caseId, groupId, { title: '准备材料' })
  const taskId = t1.taskGroups[0].tasks[0].id

  // ============ upsertSubtask: create-if-not-found ============
  // 1) no id → auto-generate
  const s1 = await cs.upsertSubtask(caseId, groupId, taskId, { title: '收集证据' })
  const sub1 = s1.taskGroups[0].tasks[0].subtasks[0]
  check('upsertSubtask no-id creates', sub1 !== undefined && sub1.title === '收集证据' && sub1.id.startsWith('sub-'), JSON.stringify(sub1))

  // 2) explicit non-existent id → create with that id (was silent no-op)
  const s2 = await cs.upsertSubtask(caseId, groupId, taskId, { id: 'st-001', title: '起草诉状' })
  const sub2 = s2.taskGroups[0].tasks[0].subtasks.find((x) => x.id === 'st-001')
  check('upsertSubtask explicit-id creates', sub2 !== undefined && sub2.title === '起草诉状', JSON.stringify(sub2))

  // 3) existing id → update
  const s3 = await cs.upsertSubtask(caseId, groupId, taskId, { id: 'st-001', title: '起草诉状v2' })
  const sub3 = s3.taskGroups[0].tasks[0].subtasks.find((x) => x.id === 'st-001')
  check('upsertSubtask existing-id updates', sub3 !== undefined && sub3.title === '起草诉状v2', JSON.stringify(sub3))

  // ============ upsertChecklist: create-if-not-found ============
  // 1) no id → auto-generate
  const c1 = await cs.upsertChecklist(caseId, groupId, taskId, { text: '核对证据清单' })
  const chk1 = c1.taskGroups[0].tasks[0].checklist[0]
  check('upsertChecklist no-id creates', chk1 !== undefined && chk1.text === '核对证据清单' && chk1.id.startsWith('chk-'), JSON.stringify(chk1))

  // 2) explicit non-existent id → create with that id (was silent no-op)
  const c2 = await cs.upsertChecklist(caseId, groupId, taskId, { id: 'chk-001', text: '准备质证意见' })
  const chk2 = c2.taskGroups[0].tasks[0].checklist.find((x) => x.id === 'chk-001')
  check('upsertChecklist explicit-id creates', chk2 !== undefined && chk2.text === '准备质证意见', JSON.stringify(chk2))

  // 3) existing id → update
  const c3 = await cs.upsertChecklist(caseId, groupId, taskId, { id: 'chk-001', text: '准备质证意见v2' })
  const chk3 = c3.taskGroups[0].tasks[0].checklist.find((x) => x.id === 'chk-001')
  check('upsertChecklist existing-id updates', chk3 !== undefined && chk3.text === '准备质证意见v2', JSON.stringify(chk3))

  // ============ upsertTask: create-if-not-found ============
  // 1) explicit non-existent id → create (was TypeError)
  const t2 = await cs.upsertTask(caseId, groupId, { id: 'task-999', title: '提交答辩状', deadline: '2026-01-15', status: 'doing' })
  const task2 = t2.taskGroups[0].tasks.find((x) => x.id === 'task-999')
  check('upsertTask explicit-id creates', task2 !== undefined && task2.title === '提交答辩状' && task2.deadline === '2026-01-15' && task2.status === 'doing', JSON.stringify(task2))

  // 2) existing id → update
  const t3 = await cs.upsertTask(caseId, groupId, { id: 'task-999', title: '提交答辩状v2' })
  const task3 = t3.taskGroups[0].tasks.find((x) => x.id === 'task-999')
  check('upsertTask existing-id updates', task3 !== undefined && task3.title === '提交答辩状v2', JSON.stringify(task3))

  // ============ upsertTaskGroup: create-if-not-found ============
  // 1) explicit non-existent id → create (was throw)
  const g2 = await cs.upsertTaskGroup(caseId, { id: 'tg-999', name: '二审阶段' })
  const grp2 = g2.taskGroups.find((x) => x.id === 'tg-999')
  check('upsertTaskGroup explicit-id creates', grp2 !== undefined && grp2.name === '二审阶段', JSON.stringify(grp2))

  // 2) existing id → update
  const g3 = await cs.upsertTaskGroup(caseId, { id: 'tg-999', name: '二审阶段v2' })
  const grp3 = g3.taskGroups.find((x) => x.id === 'tg-999')
  check('upsertTaskGroup existing-id updates', grp3 !== undefined && grp3.name === '二审阶段v2', JSON.stringify(grp3))

  // ============ persistence: data actually landed on disk ============
  const reread = await cs.readCase(caseId)
  const rt = reread.taskGroups.find((g) => g.id === groupId).tasks.find((t) => t.id === taskId)
  check('persisted subtasks', rt.subtasks.length === 2, `subtasks=${rt.subtasks.length}`)
  check('persisted checklist', rt.checklist.length === 2, `checklist=${rt.checklist.length}`)
  check('persisted explicit-id task', reread.taskGroups.some((g) => g.tasks.some((t) => t.id === 'task-999')))
  check('persisted explicit-id group', reread.taskGroups.some((g) => g.id === 'tg-999'))

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`)
  process.exit(failures === 0 ? 0 : 1)
} finally {
  await rm(dataDir, { recursive: true, force: true })
}
