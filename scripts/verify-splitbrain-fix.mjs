/**
 * 0.2.1 修复集成验证 —— split-brain 收尾 + 级联删除 + 统一事项 deadline。
 * 在临时目录跑真实 store 链路，不触碰任何 live 数据。
 *
 * 覆盖（对应备忘录 + split-brain 文档）：
 *  1. upsert_task(→items) 后 upsert_check 不再报 task not found（检查项写 items）；
 *  2. upsert_event 后 list_events 能查到（读路径合并 items + legacy）；
 *  3. delete_event 对 items 事件生效、对 legacy 孤儿事件也生效；
 *  4. 级联删除案件：case-registry/items/task-groups/timeline/schedules 全清；
 *  5. 统一事项 deadline：事件与任务都在期限里，不含孤儿 caseId；
 *  6. parties 归一：同主体多行去重合并 + roles 数组 + ourSide 中文化。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCaseStore } from '../lib/domains/litigation/store/index.js'
import { createTimelineStore } from '../lib/domains/litigation/store/index.js'
import { createScheduleStore } from '../lib/domains/litigation/store/index.js'
import { createItemStore } from '../lib/domains/item/store/item-store.js'
import { cascadeDeleteCase } from '../lib/domains/litigation/cascade-delete.js'
import { computeDeadlinesV2 } from '../lib/domains/litigation/deadlines.js'

let failures = 0
const check = (name, cond, extra = '') => {
  const ok = Boolean(cond)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
  if (!ok) failures++
}

const root = await mkdtemp(join(tmpdir(), 'ls-integ-'))
const litDir = join(root, 'litigation')
const itemsDir = join(root, 'items')
try {
  const caseStore = createCaseStore(litDir)
  const timelineStore = createTimelineStore(litDir)
  const scheduleStore = createScheduleStore(litDir)
  const itemStore = createItemStore(itemsDir)

  // ---------- 建案 ----------
  const rec = await caseStore.registerCase({
    name: '集成测试案', type: '民商', cause: '合同纠纷', status: 'awaiting_trial',
    court: 'XX法院', judge: '某法官', level: '一审',
    caseNumber: '（2026）X民初1号',
    ourSide: 'plaintiff',
    parties: {
      ourSide: 'plaintiff',
      details: [
        { name: '我方公司', role: '原告', ourClient: true },
        { name: '对方公司', role: '被告' },
        { name: '我方公司', role: '申请人', ourClient: true },  // 重复主体
        { name: '对方公司', role: '第一被申请人' },  // 重复主体+序数
      ],
    },
  })
  const caseId = rec.caseId

  // ---------- 1. parties 归一：去重 + roles ----------
  const detailNames = (rec.parties?.details ?? []).map(d => `${d.name}:${Array.isArray(d.role) ? d.role.join('/') : d.role}`)
  check('parties 同主体去重为两行', (rec.parties?.details ?? []).length === 2, JSON.stringify(detailNames))
  const ourRow = (rec.parties?.details ?? []).find(d => d.ourClient === true)
  check('我方行 roles 含 原告+申请人', Array.isArray(ourRow?.roles) && ourRow.roles.includes('原告') && ourRow.roles.includes('申请人'),
    JSON.stringify(ourRow?.roles))
  const theirRow = (rec.parties?.details ?? []).find(d => !d.ourClient)
  check('对方行 role 归一为 被告(含第一被申请人 roles)', theirRow?.role === '被告' && Array.isArray(theirRow.roles) && theirRow.roles.includes('第一被申请人'),
    JSON.stringify(theirRow))

  // ---------- 2. 任务组 + 任务（写 items） ----------
  const g = await itemStore.upsertGroup({ ownerId: caseId, name: '一审 · 庭前准备' })
  const task = await itemStore.upsertItem({
    ownerId: caseId, type: 'task', groupId: g.id, title: '提交证据',
    date: '2026-12-01', status: 'pending', priority: 'high',
  })
  check('upsert_task 生成 item', task.id.startsWith('item-') || task.id.startsWith('task-'), task.id)

  // ---------- 3. upsert_check 走 items（不再 task not found） ----------
  await itemStore.addChecklist(task.id, { text: '核对证据原件' })
  const taskAfter = await itemStore.readItem(task.id)
  check('upsert_check 命中任务并写入检查项', (taskAfter?.checklist ?? []).length === 1, JSON.stringify(taskAfter?.checklist))
  await itemStore.toggleChecklist(task.id, taskAfter.checklist[0].id, true)
  const taskToggled = await itemStore.readItem(task.id)
  check('toggle_check 生效', taskToggled?.checklist?.[0]?.done === true)

  // ---------- 4. 事件写 items + list 可读 ----------
  const evt = await itemStore.upsertItem({
    ownerId: caseId, ownerName: rec.name, type: 'event', title: '第一次开庭',
    date: '2026-12-10', status: 'pending', detail: '第3法庭',
  })
  const legacyOrphan = await timelineStore.upsertEvent({
    caseId, caseName: rec.name, type: 'case_event', title: '旧孤儿事件', date: '2026-11-01', status: 'done',
  })
  check('旧孤儿事件写入 legacy', legacyOrphan.id !== undefined)
  const itemsList = await itemStore.listItems(caseId)
  check('items 含事件+任务', itemsList.filter(i => i.type === 'event').length === 1 && itemsList.filter(i => i.type === 'task').length === 1)

  // ---------- 5. 级联删除（案件 + items + groups + legacy timeline/schedules） ----------
  await scheduleStore.upsertItem({ caseId, title: '开庭', date: '2026-12-10', time: '09:30', kind: 'hearing' })
  // 构造另一个无关 case 验证不误删
  const other = await caseStore.registerCase({ name: '无关案', type: '民商', status: 'pre_filing', level: '一审' })
  await itemStore.upsertItem({ ownerId: other.caseId, type: 'task', title: '无关任务', groupId: g.id })

  const del = await cascadeDeleteCase({
    caseStore, timelineStore, scheduleStore, itemStore,
  }, caseId)
  check('cascade 删除案件', del.deleted === true, JSON.stringify(del.removed))
  check('case-registry 无该案件', (await caseStore.readCase(caseId)) === undefined)
  check('items 无该案事项', (await itemStore.listItems(caseId)).length === 0, String((await itemStore.listItems(caseId)).length))
  check('groups 无该案任务组', (await itemStore.listGroups(caseId)).length === 0)
  check('legacy timeline 孤儿已清', (await timelineStore.listEvents(caseId)).length === 0, String((await timelineStore.listEvents(caseId)).length))
  check('legacy schedules 已清', (await scheduleStore.listItems(caseId)).length === 0)
  check('无关案仍在', (await caseStore.readCase(other.caseId)) !== undefined)

  // ---------- 6. 统一事项 deadline（事件+任务入期限，孤儿不含） ----------
  const c2 = await caseStore.registerCase({
    name: '期限案', type: '民商', status: 'awaiting_trial', level: '一审', court: 'X法院', caseNumber: '（2026）X民初2号',
  })
  const g2 = await itemStore.upsertGroup({ ownerId: c2.caseId, name: '一审 · 开庭审理' })
  await itemStore.upsertItem({ ownerId: c2.caseId, type: 'both', groupId: g2.id, title: '开庭', date: '2026-12-20', status: 'pending' })
  await itemStore.upsertItem({ ownerId: c2.caseId, type: 'task', groupId: g2.id, title: '提交代理词', date: '2026-12-21', status: 'pending' })
  const reg = await caseStore.readRegistry()
  const taskMap = new Map()
  for (const it of await itemStore.listItems(c2.caseId)) {
    if (it.type !== 'event') taskMap.set(it.id, { caseId: c2.caseId, title: it.title, date: it.date, time: it.time, status: it.status })
  }
  const deadlines = computeDeadlinesV2(reg, [], taskMap, c2.caseId, {})
  check('deadline 含开庭事件', deadlines.some(d => d.label === '开庭'), JSON.stringify(deadlines.map(d => d.label)))
  check('deadline 含任务期限', deadlines.some(d => d.label === '提交代理词' && d.kind === 'task'), JSON.stringify(deadlines.map(d => `${d.label}:${d.kind}`)))

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`)
  process.exit(failures === 0 ? 0 : 1)
} finally {
  await rm(root, { recursive: true, force: true })
}
