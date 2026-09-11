/**
 * 0.2.13 验证：数据模型收敛（keydate 退役）+ 日历同步规则。
 *
 * A. 读时归一 + 落盘迁移：盘上 `type:'keydate'` → `'event'`（带备份 + 幂等标记）；
 * B. 同步门禁：过去的日程不同步；答辩期/举证期/送达不同步；任务开关关着不同步；
 * C. 标题格式：【事项标题】案件名（案件名缺失退编号）；
 * D. 去重：同一「归属+日期+标题」只出一条（0.2.12 的重复问题）；
 * E. 真实数据副本干跑：统计会同步哪些、跳过原因分布、抽查标题。
 *
 * 全程临时目录 / 只读数据副本，不触碰 live 数据，也不调用 Apple 日历。
 *
 * 用法：node scripts/verify-calendar-sync-0213.mjs [items.json 路径]
 */
import { mkdtemp, rm, mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { createItemStore } from '../lib/domains/item/store/item-store.js'
import { normalizeItemType } from '../lib/domains/item/store/types.js'
import {
  shouldSyncToCalendar, calendarEventTitle, pickSyncableItems, localToday,
} from '../lib/domains/calendar-sync/rules.js'

let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name} ${extra}`) }
}

const TODAY = '2026-09-11'
const EVENTS_ON = { syncEvents: true, syncTasks: false, today: TODAY }
const gate = (it, opts = EVENTS_ON) => shouldSyncToCalendar(it, opts).sync

/* ─────────── A. 读时归一 + 落盘迁移 ─────────── */
console.log('\nA. keydate 退役：读时归一 + 落盘迁移')
ok("normalizeItemType('keydate') === 'event'", normalizeItemType('keydate') === 'event')
ok("normalizeItemType('task') === 'task'（both 保留）",
  normalizeItemType('task') === 'task' && normalizeItemType('both') === 'both')

{
  const dir = await mkdtemp(join(tmpdir(), 'lex-0213-'))
  try {
    const doc = {
      registryVersion: '1.0',
      groups: [],
      items: [
        { id: 'kd-1', ownerId: '2026-002', ownerType: 'litigation', type: 'keydate', title: '裁判文书送达', date: '2026-09-11' },
        { id: 'ev-1', ownerId: '2026-002', ownerType: 'litigation', type: 'event', title: '开庭', date: '2026-09-14', time: '14:45' },
        { id: 'tk-1', ownerId: '2026-002', ownerType: 'litigation', type: 'task', title: '整理证据', date: '2026-09-12' },
      ],
    }
    await writeFile(join(dir, 'items.json'), JSON.stringify(doc, null, 2), 'utf8')
    const store = createItemStore(dir)
    const items = await store.listItems()
    const kd = items.find((i) => i.id === 'kd-1')
    ok('读时归一：keydate 事项读出来就是 event', kd?.type === 'event', `实际 ${kd?.type}`)
    const onDisk = JSON.parse(await readFile(join(dir, 'items.json'), 'utf8'))
    ok('落盘迁移：盘上不再有 keydate',
      onDisk.items.every((i) => i.type !== 'keydate'),
      JSON.stringify(onDisk.items.map((i) => i.type)))
    ok('迁移备份存在', existsSync(join(dir, 'items.json.bak-keydate-merge-0.2.13')))
    ok('幂等标记存在', existsSync(join(dir, '.agentlex-keydate-merged-0.2.13')))
    const backup = JSON.parse(await readFile(join(dir, 'items.json.bak-keydate-merge-0.2.13'), 'utf8'))
    ok('备份里保留原 keydate（可回滚）', backup.items.some((i) => i.type === 'keydate'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

/* ─────────── B. 同步门禁 ─────────── */
console.log('\nB. 同步门禁（什么该进日历）')
ok('未来的日程 → 同步', gate({ type: 'event', title: '开庭', date: '2026-09-14', time: '14:45' }))
ok('过去的日程 → 不同步（历史时间轴，不是逾期）',
  !gate({ type: 'event', title: '开庭', date: '2026-09-01' }))
ok('无日期的日程 → 不同步', !gate({ type: 'event', title: '梳理争议焦点', date: '' }))
ok('举证期届满 → 不同步', !gate({ type: 'event', title: '举证期限届满', date: '2026-09-20' }))
ok('答辩期届满 → 不同步', !gate({ type: 'event', title: '答辩期届满', date: '2026-09-20' }))
ok('裁判文书送达 → 不同步', !gate({ type: 'event', title: '裁判文书送达', date: '2026-09-20' }))
ok('开庭传票送达 → 不同步（送达类）', !gate({ type: 'event', title: '开庭传票送达', date: '2026-09-20' }))
ok('上诉期届满 → 同步（不在跳过词里）',
  gate({ type: 'event', title: '上诉期届满', date: '2026-09-19' }))
ok('纯任务 + 任务开关关 → 不同步',
  !gate({ type: 'task', title: '整理证据', date: '2026-09-20' }))
ok('纯任务 + 任务开关开 → 同步',
  gate({ type: 'task', title: '整理证据', date: '2026-09-20' }, { syncEvents: true, syncTasks: true, today: TODAY }))
ok('both 有日期 → 按日程同步（保留 both）',
  gate({ type: 'both', title: '开庭', date: '2026-09-20' }))
ok('日程开关关 → 不同步',
  !gate({ type: 'event', title: '开庭', date: '2026-09-20' }, { syncEvents: false, syncTasks: false, today: TODAY }))

/* ─────────── C. 标题格式 ─────────── */
console.log('\nC. 日历标题格式')
ok('【开庭】+ 案件名', calendarEventTitle('开庭', '高歌与龙视天下传媒劳动仲裁') === '【开庭】高歌与龙视天下传媒劳动仲裁')
ok('【裁判文书送达】+ 案件名', calendarEventTitle('裁判文书送达', '某案') === '【裁判文书送达】某案')
ok('案件名缺失 → 只有方括号', calendarEventTitle('开庭', '') === '【开庭】')
ok('标题里的方括号不是「 - 」格式（与旧格式区分）',
  !calendarEventTitle('开庭', '某案').includes(' - '))

/* ─────────── D. 去重 ─────────── */
console.log('\nD. 同名同日去重（0.2.12 的重复问题）')
{
  const dupes = [
    { id: 'item-a', ownerId: '2026-002', type: 'event', title: '起诉期届满', date: '2026-09-28', time: undefined },
    { id: 'kd-b', ownerId: '2026-002', type: 'event', title: '起诉期届满', date: '2026-09-28', time: undefined },
    { id: 'item-c', ownerId: '2026-002', type: 'event', title: '裁判文书送达', date: '2026-09-11', time: undefined },
  ]
  const picked = pickSyncableItems(dupes, EVENTS_ON)
  ok('同名同日两条 → 只出一条', picked.length === 1, `实际 ${picked.length}`)
  ok('去重优先保留带时间的那条（修全天化 bug）',
    pickSyncableItems([
      { id: 'no-time', ownerId: 'c1', type: 'event', title: '开庭', date: '2026-09-14', time: undefined },
      { id: 'with-time', ownerId: 'c1', type: 'event', title: '开庭', date: '2026-09-14', time: '14:45' },
    ], EVENTS_ON)[0]?.id === 'with-time')
  ok('不同标题分别保留', pickSyncableItems([
    { id: 'x', ownerId: 'c1', type: 'event', title: '开庭', date: '2026-09-20' },
    { id: 'y', ownerId: 'c1', type: 'event', title: '询问', date: '2026-09-20' },
  ], EVENTS_ON).length === 2)
}

/* ─────────── E. 真实数据副本干跑 ─────────── */
console.log('\nE. 真实数据副本干跑（只读，不写日历）')
const itemsPath = process.argv[2] ?? join(process.env.HOME ?? '', '.dsh/agentlex/items/items.json')
if (!existsSync(itemsPath)) {
  console.log(`  ⚠️ 找不到 ${itemsPath}，跳过干跑`)
} else {
  const raw = JSON.parse(await readFile(itemsPath, 'utf8'))
  const all = (Array.isArray(raw) ? raw : (raw.items ?? [])).map((i) => ({ ...i, type: normalizeItemType(i.type) }))
  // 归属显示名：与 host 的 resolveOwnerLabel 同口径（案件名 → 项目名 → 编号兜底）。
  const ownerNameById = new Map()
  const itemsDir = itemsPath.replace(/\/items\.json$/, '')
  try {
    const reg = JSON.parse(await readFile(join(itemsDir, '..', 'litigation', 'case-registry.json'), 'utf8'))
    for (const [id, c] of Object.entries(reg.cases ?? {})) if (c?.name) ownerNameById.set(id, c.name)
  } catch { /* 无案件档案则退回编号 */ }
  try {
    const pr = JSON.parse(await readFile(join(itemsDir, '..', 'nonlitigation', 'project-registry.json'), 'utf8'))
    for (const [id, p] of Object.entries(pr.projects ?? {})) if (p?.name) ownerNameById.set(id, p.name)
  } catch { /* 无项目档案则退回编号 */ }
  const labelOf = (it) => (it.ownerName || '') !== '' ? it.ownerName : (ownerNameById.get(it.ownerId) ?? it.ownerId ?? '')
  const reasons = {}
  for (const it of all) {
    const r = shouldSyncToCalendar(it, EVENTS_ON)
    const k = r.sync ? 'sync' : r.reason
    reasons[k] = (reasons[k] ?? 0) + 1
  }
  const picked = pickSyncableItems(all, EVENTS_ON)
  console.log(`  事项总数 ${all.length}｜跳过原因分布：`, JSON.stringify(reasons))
  console.log(`  去重后应同步 ${picked.length} 条：`)
  for (const it of picked) {
    console.log(`    · ${calendarEventTitle(it.title ?? '', labelOf(it))}  @ ${it.date}${it.time ? ' ' + it.time : '（全天）'}`)
  }
  const badPast = picked.filter((i) => (i.date ?? '') < TODAY)
  ok('干跑结果里没有过去的日程', badPast.length === 0, `${badPast.length} 条`)
  const badWord = picked.filter((i) => /答辩期|举证期|送达|履行期限/.test(i.title ?? ''))
  ok('干跑结果里没有答辩期/举证期/送达/履行期限', badWord.length === 0, badWord.map((i) => i.title).join(','))
  const badTask = picked.filter((i) => i.type === 'task')
  ok('干跑结果里没有任务（任务开关未开）', badTask.length === 0, `${badTask.length} 条`)
  const noBracket = picked.filter((i) => !calendarEventTitle(i.title ?? '', 'x').startsWith('【'))
  ok('标题都以【开头', noBracket.length === 0)
}

console.log(`\n${fail === 0 ? '✅ 全部通过' : '❌ 有失败'}：${pass} 通过 / ${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)
