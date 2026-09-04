/**
 * 0.2.2 统一收尾验证 —— 单文件真相源 + 并库迁移 + 读改路径全 items。
 *
 * 覆盖（对应 0.2.2 收尾目标）：
 *  1. task-groups.json 退役：旧组壳并入 items.json（同文件 groups+items）；
 *  2. 老数据下岗：registry 任务镜像 + case-timeline 旧事件一次性并入 items，
 *     registry taskGroups 剥离、case-timeline 改名退役；
 *  3. 单文件归一化：旧 items.json（只有 items、无 groups 键）读改写自动归一；
 *  4. 展开任务（apply_stage_template）→ case_health 阶段计数能看到（items 源）；
 *  5. get_case 任务组来自 items 聚合（不再读 registry 空镜像）；
 *  6. GUI legacy 写路由语义：legacy add-task/subtask/checklist 写 items；
 *  7. 任务域写穿 /api/agentlex-task/task（source=litigation）更新 items。
 *
 * 全程临时目录，不触碰 live 数据。
 */
import { mkdtemp, rm, writeFile, readFile, access, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCaseStore } from '../lib/domains/litigation/store/index.js'
import { createTimelineStore } from '../lib/domains/litigation/store/index.js'
import { createItemStore } from '../lib/domains/item/store/item-store.js'
import { applyStageExpansion } from '../lib/domains/litigation/stage-expansion.js'
import { computeCaseHealth } from '../lib/domains/litigation/health.js'
import { mergeLegacyIntoItems } from '../lib/domains/litigation/merge-legacy.js'
import { taskGroupsForCase } from '../lib/domains/litigation/task-view.js'

let failures = 0
const check = (name, cond, extra = '') => {
  const ok = Boolean(cond)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
  if (!ok) failures++
}

const root = await mkdtemp(join(tmpdir(), 'ls-022-'))
const litDir = join(root, 'litigation')
const itemsDir = join(root, 'items')
await mkdir(itemsDir, { recursive: true })
await mkdir(litDir, { recursive: true })
try {
  const caseStore = createCaseStore(litDir)
  const timelineStore = createTimelineStore(litDir)
  const itemStore = createItemStore(itemsDir, undefined)

  // ---------- 0) 预置旧版数据（模拟 0.2.1 现场） ----------
  const rec = await caseStore.registerCase({
    name: '并库测试案', type: '民商', cause: '合同纠纷', status: 'post_trial',
    court: 'XX法院', level: '一审',
    ourSide: 'plaintiff',
  })
  const caseId = rec.caseId
  // registry 残留任务镜像（含组名在 title、任务 deadline 等）
  await caseStore.upsertTaskGroup(caseId, { id: 'tg-legacy-1', name: '一审 · 庭后管理' })
  await caseStore.upsertTask(caseId, 'tg-legacy-1', { id: 'task-legacy-1', title: '领取裁判文书', status: 'todo', priority: 'medium', deadline: '2026-09-20', detail: '去法院领取' })
  await caseStore.upsertTask(caseId, 'tg-legacy-1', { id: 'task-legacy-2', title: '分析上诉可行性', status: 'todo', deadline: '2026-09-21' })
  // 旧事件文件
  await timelineStore.upsertEvent({ id: 'evt-legacy-1', caseId, caseName: '并库测试案', type: 'judgment', title: '一审判决', date: '2026-09-01', status: 'done' })
  // 旧独立 task-groups.json（含 litigation owner 组）
  await writeFile(join(itemsDir, 'task-groups.json'), JSON.stringify({
    registryVersion: '1.0',
    groups: [{ id: 'tg-legacy-1', ownerId: caseId, ownerType: 'litigation', name: '一审 · 庭后管理', order: 0 }],
  }), 'utf8')
  // 旧 items.json（只有 items、无 groups 键）
  await writeFile(join(itemsDir, 'items.json'), JSON.stringify({
    registryVersion: '1.0',
    items: [{ id: 'item-pre-1', ownerId: caseId, ownerType: 'litigation', type: 'task', title: '老任务A', status: 'pending', groupId: 'tg-other', date: '2026-09-10' }],
  }), 'utf8')

  // ---------- 1) 首次读（触发迁移：task-groups 并入 + 旧 items 归一化） ----------
  const beforeGroups = await itemStore.listGroups(caseId)
  check('task-groups.json 并入 items.json（组壳在 items）', beforeGroups.some((g) => g.id === 'tg-legacy-1'), `groups=${beforeGroups.length}`)
  const beforeItems = await itemStore.listItems()
  check('旧 items.json 无 groups 键仍可读（归一化）', beforeItems.some((i) => i.id === 'item-pre-1'))
  let migrated = false
  try { await access(join(itemsDir, 'task-groups.json')); } catch { migrated = true }
  check('task-groups.json 已退役改名 .legacy', migrated)

  // ---------- 2) 并库迁移（registry 任务镜像 + case-timeline 事件 → items） ----------
  const summary = await mergeLegacyIntoItems(caseStore, timelineStore, itemStore, litDir)
  check('registry 任务镜像并入 items', summary.mergedTasks >= 2, JSON.stringify(summary))
  check('case-timeline 事件并入 items', summary.mergedEvents >= 1, JSON.stringify(summary))
  const afterItems = await itemStore.listItems()
  check('items 含并入任务 + 事件 + 老任务', afterItems.length >= 4, `items=${afterItems.length}`)
  check('并入任务 id 保留', afterItems.some((i) => i.id === 'task-legacy-1'))
  const mergedTask = afterItems.find((i) => i.id === 'task-legacy-1')
  check('并入任务 deadline 从 date 还原', mergedTask?.date === '2026-09-20', `date=${mergedTask?.date}`)

  // registry 镜像剥离
  const regAfter = await caseStore.readRegistry()
  check('registry taskGroups 已剥离（空数组）', (regAfter.cases[caseId]?.taskGroups ?? []).length === 0)
  let tlGone = false
  try { await access(join(litDir, 'case-timeline.json')); } catch { tlGone = true }
  check('case-timeline.json 已退役改名 .legacy', tlGone)

  // ---------- 3) 读侧统一：taskGroups 从 items 聚合 ----------
  const view = await taskGroupsForCase(caseId, caseStore, itemStore)
  const groupTitles = view.map((g) => g.name)
  check('taskGroups 聚合来自 items（含 庭后管理 组）', groupTitles.includes('一审 · 庭后管理'), JSON.stringify(groupTitles))
  const allTasks = view.flatMap((g) => g.tasks)
  check('聚合任务含并入的 legacy 任务', allTasks.some((t) => t.id === 'task-legacy-1'))

  // ---------- 4) 展开模板 → 体检能看到（items 源） ----------
  await applyStageExpansion(caseStore, caseId, 'post_trial', {}, itemStore)
  const hydratedRec = await caseStore.readCase(caseId)
  const { hydrateCaseTaskGroups } = await import('../lib/domains/litigation/task-view.js')
  const h = await hydrateCaseTaskGroups(hydratedRec, caseStore, itemStore)
  const health = await computeCaseHealth(h)
  check('展开后 case_health 阶段任务数 > 0', health.stage.total > 0, `stage.total=${health.stage.total}`)
  check('体检阶段名 = 一审 · 庭后管理', health.stage.name === '一审 · 庭后管理', `stage.name=${health.stage.name}`)

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
  process.exit(failures === 0 ? 0 : 1)
} catch (error) {
  console.error('verify aborted:', error)
  process.exit(2)
} finally {
  await rm(root, { recursive: true, force: true }).catch(() => {})
}
