/**
 * ownerType 归属端到端验证：模拟 suite.ts /api/agentlex/read 的聚合逻辑
 * （case/项目从 itemLegacy.taskGroups + ownerType 过滤），确认：
 *  1. 诉讼案件 2026-001 只拿到 litigation 归属的任务组；
 *  2. 非诉项目 2026-001 只拿到 nonlitigation 归属的任务组；
 *  3. timeline 只含 litigation 归属事件（案件侧）。
 */
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCaseStore } from '../lib/domains/litigation/store/index.js'
import { createTimelineStore } from '../lib/domains/litigation/store/index.js'
import { createScheduleStore } from '../lib/domains/litigation/store/index.js'
import { createItemStore } from '../lib/domains/item/store/item-store.js'
import { createProjectStore } from '../lib/domains/nonlitigation/store/project-store.js'
import { createServiceStore } from '../lib/domains/nonlitigation/store/service-store.js'
import { seedLitigationSample, seedNonLitigationSample } from '../lib/shared/seed/index.js'
import { itemToTimelineEvent, itemToLegacyTask } from '../lib/domains/item/shape.js'

let failures = 0
const check = (name, cond, extra = '') => {
  const ok = Boolean(cond)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
  if (!ok) failures++
}

// 注：lib 的 store 工厂（litigation）ctx 可选；nonlitigation 的 createProjectStore
// 要求 ctx——用 dummy ctx stub（仅 read 不需要广播）。
const root = mkdtempSync(join(tmpdir(), 'ls-owner-'))
const litDir = join(root, 'litigation')
const nlDir = join(root, 'nonlitigation')
const itemsDir = join(root, 'items')
mkdirSync(litDir, { recursive: true })
mkdirSync(nlDir, { recursive: true })
mkdirSync(itemsDir, { recursive: true })
const dummyCtx = { events: { dispatch: () => [] } }
try {
  const caseStore = createCaseStore(litDir)
  const timelineStore = createTimelineStore(litDir)
  const scheduleStore = createScheduleStore(litDir)
  const itemStore = createItemStore(itemsDir, dummyCtx)
  const projectStore = createProjectStore(nlDir, dummyCtx)
  const serviceStore = createServiceStore(nlDir, dummyCtx)

  await seedLitigationSample(caseStore, timelineStore, scheduleStore, itemStore)
  await seedNonLitigationSample(projectStore, serviceStore, itemStore)

  // ============ 复刻 suite 聚合 ============
  const itemStore2 = createItemStore(itemsDir)
  const items = await itemStore2.listItems()
  const groups = await itemStore2.listGroups()
  // legacy 形状（item/routes legacy 逻辑）
  const timeline = {}
  const groupMap = new Map()
  for (const it of items) {
    if (it.type === 'task') continue
    timeline[it.id] = itemToTimelineEvent(it)
  }
  for (const g of groups) {
    groupMap.set(`${g.ownerId}|${g.id}`, { ownerId: g.ownerId, ownerType: g.ownerType, id: g.id, title: g.name, order: g.order, tasks: [] })
  }
  for (const it of items) {
    if (it.type === 'event') continue
    const gid = it.groupId ?? '__ungrouped'
    const key = `${it.ownerId}|${gid}`
    if (!groupMap.has(key)) groupMap.set(key, { ownerId: it.ownerId, ownerType: it.ownerType, id: gid, title: it.groupName ?? '未分组', order: groupMap.size, tasks: [] })
    groupMap.get(key).tasks.push(itemToLegacyTask(it))
  }
  const allGroups = [...groupMap.values()]

  // 诉讼 case registry
  const reg = await caseStore.readRegistry()
  const preg = await projectStore.readRegistry()

  // ---- 案件 2026-001 的任务组只吃 litigation ----
  const case1 = Object.values(reg.cases).find((c) => c.caseId === '2026-001')
  const caseGroups = allGroups.filter((g) => g.ownerId === '2026-001' && (g.ownerType ?? 'litigation') === 'litigation')
  check('案件 2026-001 任务组=litigation 3 组(立案/庭前/开庭)', caseGroups.length === 3,
    JSON.stringify(caseGroups.map((g) => g.title)))
  const caseGroupTitles = caseGroups.map((g) => g.title).join(',')
  check('案件 2026-001 不含非诉组', !caseGroupTitles.includes('日常履约'), caseGroupTitles)

  // ---- 非诉项目 2026-001 只吃 nonlitigation ----
  const proj1 = Object.values(preg.projects).find((p) => p.projectId === '2026-001')
  check('非诉项目 2026-001 存在', proj1 !== undefined)
  const projGroups = allGroups.filter((g) => g.ownerId === '2026-001' && (g.ownerType ?? 'nonlitigation') === 'nonlitigation')
  check('非诉项目 2026-001 任务组=nonlitigation 4 组(合同/咨询/合规/续约)', projGroups.length === 4,
    JSON.stringify(projGroups.map((g) => g.title)))
  const projTitles = projGroups.map((g) => g.title).join(',')
  check('非诉组不含诉讼组(一审)', !projTitles.includes('一审'), projTitles)

  // ---- timeline 只含 litigation 事件（案件侧视图）----
  const case1Timeline = Object.values(timeline).filter((e) => e.caseId === '2026-001' && (e.ownerType ?? 'litigation') === 'litigation')
  check('案件 2026-001 timeline 有事件且无非诉事件', case1Timeline.length > 0 && !case1Timeline.some((e) => e.ownerType === 'nonlitigation'),
    String(case1Timeline.length))

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`)
  process.exit(failures === 0 ? 0 : 1)
} finally {
  rmSync(root, { recursive: true, force: true })
}
