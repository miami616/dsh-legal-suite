/**
 * 统一存储收尾验证（0.2.12 版，取代 0.2.2 版）——旧存储并入 items 后：
 *  1. 旧 task-groups.json（组壳）并入 items.json.groups 并退役改名；
 *  2. registry 残留任务镜像 / 旧 case-timeline 事件并入 items，registry 字段剥离；
 *  3. keyDates 并入 items（type='keydate'），registry 不再有该字段；
 *  4. 读侧 taskGroups / keyDates 一律从 items 聚合（形状不变）；
 *  5. apply_stage_template 展开 → 体检能看到阶段任务（items 源）；
 *  6. 写路径收口：case-store 的 task/keyDate 方法只写 items，registry 不留字段。
 *
 * 全程临时目录，不触碰 live 数据。
 */
import { mkdtemp, rm, writeFile, readFile, access, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCaseStore } from '../lib/domains/litigation/store/index.js'
import { createTimelineStore } from '../lib/domains/litigation/store/index.js'
import { createScheduleStore } from '../lib/domains/litigation/store/index.js'
import { createItemStore } from '../lib/domains/item/store/item-store.js'
import { applyStageExpansion } from '../lib/domains/litigation/stage-expansion.js'
import { computeCaseHealth } from '../lib/domains/litigation/health.js'
import { mergeLegacyIntoItems } from '../lib/domains/litigation/merge-legacy.js'
import { unifyLitigationStore } from '../lib/domains/litigation/unify-store.js'
import { taskGroupsForCase } from '../lib/domains/litigation/task-view.js'

let failures = 0
const check = (name, cond, extra = '') => {
  const ok = Boolean(cond)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
  if (!ok) failures++
}

const root = await mkdtemp(join(tmpdir(), 'ls-unify-'))
const litDir = join(root, 'litigation')
const itemsDir = join(root, 'items')
await mkdir(itemsDir, { recursive: true })
await mkdir(litDir, { recursive: true })
try {
  // ---------- 0) 先铺旧版数据（必须在 store 首次读之前，迁移是一次性的） ----------
  const caseId = '2026-001'
  await writeFile(join(litDir, 'case-registry.json'), JSON.stringify({
    registryVersion: '1.0',
    cases: {
      [caseId]: {
        caseId, name: '并库测试案', type: '民商', cause: '合同纠纷', status: 'post_trial',
        court: 'XX法院', level: '一审', ourSide: 'plaintiff',
        keyDates: [{ id: 'kd-legacy-1', label: '上诉期届满', date: '2026-09-19', done: false, ruleId: 'appeal-window', baseDate: '2026-09-04' }],
        taskGroups: [{
          id: 'tg-legacy-1', name: '一审 · 庭后管理', order: 0,
          tasks: [
            { id: 'task-legacy-1', title: '领取裁判文书', deadline: '2026-09-20', status: 'todo', priority: 'medium', detail: '去法院领取' },
            { id: 'task-legacy-2', title: '分析上诉可行性', deadline: '2026-09-21', status: 'todo' },
          ],
        }],
      },
    },
  }, null, 2))
  await writeFile(join(litDir, 'case-timeline.json'), JSON.stringify({
    registryVersion: '1.0',
    events: [{ id: 'evt-legacy-1', caseId, caseName: '并库测试案', type: 'judgment', title: '一审判决', date: '2026-09-01', status: 'done' }],
  }, null, 2))
  await writeFile(join(itemsDir, 'task-groups.json'), JSON.stringify({
    registryVersion: '1.0',
    groups: [{ id: 'tg-legacy-1', ownerId: caseId, ownerType: 'litigation', name: '一审 · 庭后管理', order: 0 }],
  }), 'utf8')
  // 旧 items.json（只有 items、无 groups 键）→ 读侧必须归一化
  await writeFile(join(itemsDir, 'items.json'), JSON.stringify({
    registryVersion: '1.0',
    items: [{ id: 'item-pre-1', ownerId: caseId, ownerType: 'litigation', type: 'task', title: '老任务A', status: 'pending', groupId: 'tg-other', date: '2026-09-10' }],
  }), 'utf8')

  const itemStore = createItemStore(itemsDir, undefined)
  const caseStore = createCaseStore(litDir, undefined, itemStore)
  const timelineStore = createTimelineStore(litDir)

  // ---------- 1) 首次读触发旧文件迁移 + 形状归一化 ----------
  const beforeGroups = await itemStore.listGroups(caseId)
  check('task-groups.json 并入 items.json（组壳在 items）', beforeGroups.some((g) => g.id === 'tg-legacy-1'), `groups=${beforeGroups.length}`)
  const beforeItems = await itemStore.listItems()
  check('旧 items.json 无 groups 键仍可读（归一化）', beforeItems.some((i) => i.id === 'item-pre-1'))
  let groupsFileGone = false
  try { await access(join(itemsDir, 'task-groups.json')) } catch { groupsFileGone = true }
  check('task-groups.json 已退役改名 .legacy', groupsFileGone)

  // ---------- 2) 0.2.2 并库：registry 任务镜像 + case-timeline 事件 → items ----------
  const summary = await mergeLegacyIntoItems(caseStore, timelineStore, itemStore, litDir)
  check('registry 任务镜像并入 items', summary.mergedTasks >= 2, JSON.stringify(summary))
  check('case-timeline 事件并入 items', summary.mergedEvents >= 1, JSON.stringify(summary))
  const afterItems = await itemStore.listItems()
  check('items 含并入任务 + 事件 + 老任务', afterItems.length >= 4, `items=${afterItems.length}`)
  const mergedTask = afterItems.find((i) => i.id === 'task-legacy-1')
  check('并入任务 id 保留', mergedTask !== undefined)
  check('并入任务 deadline 从 date 还原', mergedTask?.date === '2026-09-20', `date=${mergedTask?.date}`)
  let tlGone = false
  try { await access(join(litDir, 'case-timeline.json')) } catch { tlGone = true }
  check('case-timeline.json 已退役改名 .legacy', tlGone)

  // ---------- 3) 0.2.12 统一：keyDates 并入 + registry 字段剥离 ----------
  const unified = await unifyLitigationStore(caseStore, createScheduleStore(litDir), itemStore, litDir)
  check('keyDates 并入 items', unified.mergedKeyDates >= 1, JSON.stringify(unified))
  const rawReg = JSON.parse(await readFile(join(litDir, 'case-registry.json'), 'utf8'))
  check('registry taskGroups 已剥离', rawReg.cases[caseId].taskGroups === undefined)
  check('registry keyDates 已剥离', rawReg.cases[caseId].keyDates === undefined)

  // ---------- 4) 读侧统一：taskGroups / keyDates 从 items 聚合 ----------
  const view = await taskGroupsForCase(caseId, caseStore, itemStore)
  check('taskGroups 聚合来自 items（含 庭后管理 组）', view.map((g) => g.name).includes('一审 · 庭后管理'), JSON.stringify(view.map((g) => g.name)))
  check('聚合任务含并入的 legacy 任务', view.flatMap((g) => g.tasks).some((t) => t.id === 'task-legacy-1'))
  const hydrated = await caseStore.readCase(caseId)
  check('readCase 装配 keyDates（上诉期届满）', (hydrated.keyDates ?? []).some((k) => k.label === '上诉期届满'))

  // ---------- 5) 展开模板 → 体检能看到（items 源） ----------
  await applyStageExpansion(caseStore, caseId, 'post_trial', {}, itemStore)
  const h = await computeCaseHealth(await caseStore.readCase(caseId))
  check('展开后 case_health 阶段任务数 > 0', h.stage.total > 0, `stage.total=${h.stage.total}`)
  check('体检阶段名 = 一审 · 庭后管理', h.stage.name === '一审 · 庭后管理', `stage.name=${h.stage.name}`)

  // ---------- 6) 写路径收口：只写 items ----------
  await caseStore.upsertTask(caseId, 'tg-legacy-1', { id: 'task-write-1', title: '写路径任务' })
  await caseStore.addKeyDate(caseId, '举证期限届满', '2026-10-01')
  const rawReg2 = JSON.parse(await readFile(join(litDir, 'case-registry.json'), 'utf8'))
  check('写后 registry 仍无 taskGroups/keyDates 字段', rawReg2.cases[caseId].taskGroups === undefined && rawReg2.cases[caseId].keyDates === undefined)
  const items2 = await itemStore.listItems(caseId)
  check('写后 items 含新任务与新关键日期', items2.some((i) => i.id === 'task-write-1') && items2.some((i) => i.type === 'keydate' && i.title === '举证期限届满'))

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`)
} catch (error) {
  failures++
  console.error('EXCEPTION', error)
} finally {
  await rm(root, { recursive: true, force: true })
}
process.exit(failures === 0 ? 0 : 1)
