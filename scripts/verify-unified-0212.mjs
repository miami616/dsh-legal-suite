/**
 * 0.2.12「全面完整统一」验证 —— items.json 是唯一真相源，旧存储全部并入并退役。
 *
 * 覆盖：
 *  1. registry 残留 taskGroups + keyDates → items（只补不覆盖，缺的补上不丢数据）；
 *  2. 剥离 registry 的 taskGroups/keyDates 字段（盘上不再有第二份）；
 *  3. keyDates → items type='keydate'（保留 id / ruleId / baseDate 审计字段）；
 *  4. readCase / readRegistry 从 items 实时装配 keyDates + taskGroups（形状不变）；
 *  5. schedules.json → items(event) 并退役；standalone-tasks.json → items(task) 并退役；
 *  6. 写路径收口：addKeyDate / upsertTask / toggleKeyDate 只写 items，registry 无字段；
 *  7. 非诉项目 keyDates → items 并装配回来；
 *  8. 期限引擎：keydate 事项出现在 computeDeadlines（kind=keydate）；
 *  9. 幂等：迁移跑两遍结果一致（标记文件生效）。
 *
 * 全程临时目录，不触碰 live 数据。
 */
import { mkdtemp, rm, writeFile, readFile, mkdir, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCaseStore } from '../lib/domains/litigation/store/case-store.js'
import { createScheduleStore } from '../lib/domains/litigation/store/schedule-store.js'
import { createItemStore } from '../lib/domains/item/store/item-store.js'
import { createProjectStore } from '../lib/domains/nonlitigation/store/project-store.js'
import { createTaskStore } from '../lib/domains/task/store/task-store.js'
import { unifyLitigationStore } from '../lib/domains/litigation/unify-store.js'
import { unifyProjectStore } from '../lib/domains/nonlitigation/unify-store.js'
import { unifyTaskStore } from '../lib/domains/task/unify-store.js'
import { computeDeadlines } from '../lib/domains/litigation/deadlines.js'

let failures = 0
const check = (name, cond, extra = '') => {
  const ok = Boolean(cond)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
  if (!ok) failures++
}
const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'))

const root = await mkdtemp(join(tmpdir(), 'ls-0212-'))
const litDir = join(root, 'litigation')
const itemsDir = join(root, 'items')
const projDir = join(root, 'nonlitigation')
const tasksDir = join(root, 'tasks')
for (const d of [litDir, itemsDir, projDir, tasksDir]) await mkdir(d, { recursive: true })

try {
  // ── 预置 0.2.11 现场：registry 残留 taskGroups + keyDates ──
  await writeFile(join(litDir, 'case-registry.json'), JSON.stringify({
    registryVersion: '1.0',
    cases: {
      '2026-900': {
        caseId: '2026-900', name: '统一迁移测试案', type: '民商', status: 'post_trial',
        court: '测试法院', level: '一审', caseNumber: '(2026)测民初1号',
        keyDates: [
          { id: 'kd-1', label: '上诉期届满', date: '2026-09-19', done: false, ruleId: 'appeal-window', baseDate: '2026-09-04', cite: '民诉法第171条', computeTrace: '送达+15日' },
          { id: 'kd-2', label: '裁判文书送达', date: '2026-09-04', done: true },
        ],
        taskGroups: [
          {
            id: 'tg-1', name: '一审 · 庭后管理', order: 0,
            tasks: [
              // 与 items 重复（items 里是 done，镜像是旧的 todo）→ 不得覆盖 items
              { id: 'task-dup', title: '分析上诉可行性', deadline: '2026-09-10', status: 'todo' },
              // 只在镜像里 → 必须补进 items（否则丢数据）
              { id: 'task-only', title: '镜像独有任务', deadline: '2026-09-12', status: 'todo', detail: '只在 registry 里' },
            ],
          },
        ],
      },
    },
  }, null, 2))

  // items 里已有 task-dup（已 done）——镜像里的旧状态不得覆盖
  await writeFile(join(itemsDir, 'items.json'), JSON.stringify({
    registryVersion: '1.0', groups: [], items: [
      { id: 'task-dup', ownerId: '2026-900', ownerType: 'litigation', type: 'task', title: '分析上诉可行性', date: '2026-09-10', status: 'done' },
    ],
  }, null, 2))

  // 旧 schedules.json + standalone-tasks.json
  await writeFile(join(litDir, 'schedules.json'), JSON.stringify({
    registryVersion: '1.0', items: [
      { id: 'sch-1', caseId: '2026-900', title: '参加执行谈话', date: '2026-09-16', time: '10:00', kind: 'execution', done: false },
    ],
  }, null, 2))
  await writeFile(join(tasksDir, 'standalone-tasks.json'), JSON.stringify({
    registryVersion: '1.0', tasks: {
      'task-sa-1': { id: 'task-sa-1', title: '清算组会议', status: 'todo', deadline: '2026-09-20', time: '09:30' },
    },
  }, null, 2))

  // 非诉：project-registry 带 keyDates + taskGroups 残留
  await writeFile(join(projDir, 'project-registry.json'), JSON.stringify({
    registryVersion: '1.0', projects: {
      'CF-2026-900': {
        projectId: 'CF-2026-900', name: '测试顾问单位', projectType: 'retainer', status: 'active',
        keyDates: [{ id: 'pkd-1', label: '服务期届满', date: '2026-12-31', done: false }],
        taskGroups: [{ id: 'ptg-1', name: '月度服务', order: 0, tasks: [] }],
      },
    },
  }, null, 2))

  const itemStore = createItemStore(itemsDir)
  const caseStore = createCaseStore(litDir, undefined, itemStore)
  const scheduleStore = createScheduleStore(litDir)
  const projectStore = createProjectStore(projDir, undefined, itemStore)
  const taskStore = createTaskStore(tasksDir, undefined, itemStore)

  // ── 1) 迁移 ──
  const s1 = await unifyLitigationStore(caseStore, scheduleStore, itemStore, litDir)
  const s2 = await unifyProjectStore(projectStore, itemStore, projDir)
  const s3 = await unifyTaskStore(itemStore, tasksDir)
  check('迁移：镜像任务并入', s1.mergedTasks === 1, JSON.stringify(s1))
  check('迁移：关键日期并入', s1.mergedKeyDates === 2, JSON.stringify(s1))
  check('迁移：旧日程并入', s1.mergedSchedules === 1, JSON.stringify(s1))
  check('迁移：项目关键日期并入', s2.mergedKeyDates === 1, JSON.stringify(s2))
  check('迁移：独立任务并入', s3.mergedTasks === 1, JSON.stringify(s3))

  const items = await itemStore.listItems()
  const byId = new Map(items.map((i) => [i.id, i]))

  // ── 2) 不丢数据 / 不覆盖既有 ──
  check('镜像独有任务已补入 items', byId.get('task-only')?.title === '镜像独有任务')
  check('镜像旧状态未覆盖 items 既有值', byId.get('task-dup')?.status === 'done', byId.get('task-dup')?.status)
  check('关键日期落 items（0.2.13 起类型并入日程 event）', byId.get('kd-1')?.type === 'event')
  check('keydate 保留审计字段', byId.get('kd-1')?.ruleId === 'appeal-window' && byId.get('kd-1')?.baseDate === '2026-09-04' && byId.get('kd-1')?.cite === '民诉法第171条')
  check('已完成 keydate 状态保留', byId.get('kd-2')?.status === 'done')
  check('旧日程落 items（type=event）', byId.get('sch-1')?.type === 'event' && byId.get('sch-1')?.kind === 'execution')
  check('独立任务落 items（ownerType=standalone）', byId.get('task-sa-1')?.ownerType === 'standalone' && byId.get('task-sa-1')?.type === 'task')
  check('项目关键日期落 items', byId.get('pkd-1')?.type === 'event' && byId.get('pkd-1')?.ownerType === 'nonlitigation')

  // ── 3) 盘上不再有第二份存储 ──
  const rawReg = await readJson(join(litDir, 'case-registry.json'))
  const rec = rawReg.cases['2026-900']
  check('registry 已剥离 taskGroups 字段', rec.taskGroups === undefined)
  check('registry 已剥离 keyDates 字段', rec.keyDates === undefined)
  check('registry 保留案件元信息', rec.name === '统一迁移测试案' && rec.court === '测试法院')
  const rawProj = await readJson(join(projDir, 'project-registry.json'))
  check('project-registry 已剥离 keyDates/taskGroups', rawProj.projects['CF-2026-900'].keyDates === undefined && rawProj.projects['CF-2026-900'].taskGroups === undefined)
  check('schedules.json 已退役', !existsSync(join(litDir, 'schedules.json')) && existsSync(join(litDir, 'schedules.json.legacy')))
  check('standalone-tasks.json 已退役', !existsSync(join(tasksDir, 'standalone-tasks.json')) && existsSync(join(tasksDir, 'standalone-tasks.json.legacy')))

  // ── 4) 读侧装配（形状不变）──
  const hydrated = await caseStore.readCase('2026-900')
  // 0.2.13：keydate 类型退役，case.keyDates 退化为兼容投影（= 该案全部日程），
  // 因此不再断言条数，改为断言两条迁移来的期限仍在（按 id 找）。
  check('readCase 装配 keyDates（兼容投影含迁移来的期限）', Array.isArray(hydrated.keyDates) && hydrated.keyDates.some((k) => k.id === 'kd-1') && hydrated.keyDates.some((k) => k.id === 'kd-2'))
  check('readCase keyDates 带 done 语义', hydrated.keyDates.find((k) => k.id === 'kd-2')?.done === true)
  const hydratedReg = await caseStore.readRegistry()
  check('readRegistry 装配 taskGroups', (hydratedReg.cases['2026-900'].taskGroups ?? []).some((g) => g.tasks.some((t) => t.id === 'task-only')))
  const proj = await projectStore.readProject('CF-2026-900')
  check('readProject 装配 keyDates', (proj.keyDates ?? []).some((k) => k.id === 'pkd-1'))

  // ── 5) 写路径收口：只写 items，registry 无字段 ──
  await caseStore.addKeyDate('2026-900', '举证期限届满', '2026-10-01', { ruleId: 'evidence', baseDate: '2026-09-16' })
  const rawReg2 = await readJson(join(litDir, 'case-registry.json'))
  check('addKeyDate 不写 registry 字段', rawReg2.cases['2026-900'].keyDates === undefined)
  const after = await itemStore.listItems('2026-900')
  check('addKeyDate 写 items', after.some((i) => i.type === 'event' && i.title === '举证期限届满' && i.ruleId === 'evidence'))
  // 幂等：同 ruleId+baseDate 再登记一次不新增
  await caseStore.addKeyDate('2026-900', '举证期限届满', '2026-10-01', { ruleId: 'evidence', baseDate: '2026-09-16' })
  const after2 = await itemStore.listItems('2026-900')
  check('addKeyDate 幂等（同 ruleId+baseDate 不重复）', after2.filter((i) => i.ruleId === 'evidence').length === 1)

  await caseStore.upsertTaskGroup('2026-900', { id: 'tg-w', name: '新阶段' })
  await caseStore.upsertTask('2026-900', 'tg-w', { id: 'task-w', title: '写路径任务', deadline: '2026-10-05' })
  const rawReg3 = await readJson(join(litDir, 'case-registry.json'))
  check('upsertTask 不写 registry 字段', rawReg3.cases['2026-900'].taskGroups === undefined)
  check('upsertTask 写 items', (await itemStore.listItems('2026-900')).some((i) => i.id === 'task-w' && i.groupId === 'tg-w'))

  // ── 6) 期限引擎：keydate 进汇总 ──
  const events = (await itemStore.listItems()).filter((i) => i.type === 'event' || i.type === 'both')
    .map((i) => ({ id: i.id, caseId: i.ownerId, caseName: i.ownerName, type: i.kind ?? 'case_event', title: i.title, date: i.date, status: i.status === 'done' ? 'done' : 'pending', remindRules: [] }))
  const dl = computeDeadlines(await caseStore.readRegistry(), events, '2026-900', { includeOverdue: true })
  check('期限汇总含 keydate（上诉期届满）', dl.some((d) => d.kind === 'keydate' && d.label === '上诉期届满'))
  check('期限汇总含任务期限', dl.some((d) => d.kind === 'task'))

  // ── 7) 幂等：迁移再跑一遍不产生新数据 ──
  // 进程内并发闸 + 磁盘标记：重复调用复用同一结果，items 不得再变化。
  const idsBefore = (await itemStore.listItems()).map((i) => i.id).sort().join(',')
  await unifyLitigationStore(caseStore, scheduleStore, itemStore, litDir)
  await unifyProjectStore(projectStore, itemStore, projDir)
  await unifyTaskStore(itemStore, tasksDir)
  const idsAfter = (await itemStore.listItems()).map((i) => i.id).sort().join(',')
  check('迁移幂等（重复调用不新增数据）', idsBefore === idsAfter)
  const rawAfter = await readJson(join(litDir, 'case-registry.json'))
  check('迁移幂等（registry 字段保持剥离）', rawAfter.cases['2026-900'].taskGroups === undefined && rawAfter.cases['2026-900'].keyDates === undefined)

  // ── 8) 独立任务读侧 ──
  const saTasks = await taskStore.listTasks()
  check('独立任务列表从 items 读', saTasks.some((t) => t.id === 'task-sa-1' && t.title === '清算组会议'))
} catch (error) {
  failures++
  console.error('EXCEPTION', error)
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log(`\n${failures === 0 ? '✅ 全部通过' : `❌ ${failures} 项失败`}`)
process.exit(failures === 0 ? 0 : 1)
