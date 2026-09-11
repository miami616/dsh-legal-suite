/**
 * 0.2.13 数据清理：合并「同一件事被登记两次」+ 动作类事项改回任务 + 删除残留过期条目。
 *
 * 背景：0.2.12 把关键日期搬进 items 时，同一件事常常留下两条——一条带时间/详情的
 * 日程（item-*），一条只有案件名的关键日期（kd-*）。类型收敛后它们变成同名同日
 * 的重复行，界面和日历都会重复。另有少量早期测试数据（旧 schedules.json）残留。
 *
 * 幂等，可重复执行。做四件事：
 *   1. 同一「归属 + 日期 + 标题」合并为一条：保留信息最全的那条（有时间 > 有详情 >
 *      已完成 > 有案件名），缺失字段从被合并项补齐（含 ruleId/baseDate/cite/
 *      computeTrace 审计字段、remindRules、subtasks/checklist），状态取「已完成」优先；
 *   2. 指向被合并 id 的 keyDateId 引用改指保留项；日历台账里被删 id 的条目清掉；
 *   3. 动作类事项改回任务（默认「调解协议修订」→ task + 已完成）；
 *   4. --drop-ids 显式删除残留/过期条目（同时清掉指向它的悬垂引用）。
 *
 * 用法：
 *   node scripts/cleanup-items-0213.mjs                              # 干跑（数据根 $DSH_HOME/agentlex）
 *   node scripts/cleanup-items-0213.mjs --apply                      # 落盘（先写备份）
 *   node scripts/cleanup-items-0213.mjs --data-dir /tmp/x/agentlex --apply
 *   node scripts/cleanup-items-0213.mjs --drop-ids id1,id2 --apply   # 删除指定条目
 */
import { readFile, writeFile, rename, copyFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const APPLY = args.includes('--apply')
const DATA_DIR = args.includes('--data-dir')
  ? args[args.indexOf('--data-dir') + 1]
  : join(process.env.DSH_HOME ?? join(process.env.HOME ?? '', '.dsh'), 'agentlex')
/** 显式删除的事项 id（逗号分隔）——清理残留测试数据/过期条目。 */
const DROP_IDS = (args.includes('--drop-ids') ? args[args.indexOf('--drop-ids') + 1] : '')
  .split(',').map((x) => x.trim()).filter((x) => x !== '' && !x.startsWith('--'))

const ITEMS_FILE = join(DATA_DIR, 'items', 'items.json')
const MAP_FILE = join(DATA_DIR, 'calendar-sync-map.json')

/** 动作类事项改回任务（标题精确匹配 → 目标类型/状态）。 */
const RECLASSIFY = [
  { title: '调解协议修订', type: 'task', status: 'done' },
]

/** 合并时从被合并项补齐的字段（base 缺失才补）。 */
const FILL_FIELDS = [
  'time', 'detail', 'ownerName', 'kind', 'groupId', 'groupName', 'priority',
  'ruleId', 'baseDate', 'cite', 'computeTrace', 'source', 'templateTitle',
  'remindRules', 'remindKeyDate', 'keyDateId', 'subtasks', 'checklist', 'completedAt',
]

const isFilled = (v) => {
  if (v === undefined || v === null) return false
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'string') return v.trim() !== ''
  return true
}

/** 信息量打分：决定同名同日保留哪条。 */
function richness(it) {
  let n = 0
  if (isFilled(it.time)) n += 8
  if (isFilled(it.detail)) n += 4
  if (it.status === 'done' || isFilled(it.completedAt)) n += 2
  if (isFilled(it.ownerName)) n += 1
  if (it.type === 'event' || it.type === 'both') n += 1
  if (isFilled(it.kind)) n += 1
  if (isFilled(it.groupId)) n += 1
  if (isFilled(it.priority)) n += 1
  return n
}

const RANK = { done: 3, doing: 2, pending: 1, cancelled: 0 }
const mergeStatus = (a, b) => ((RANK[a] ?? 1) >= (RANK[b] ?? 1) ? a : b)

const raw = JSON.parse(await readFile(ITEMS_FILE, 'utf8'))
const doc = Array.isArray(raw) ? { registryVersion: '1.0', groups: [], items: raw } : raw
const items = doc.items ?? []

const now = new Date().toISOString()
const deletedIds = new Set()
const remap = new Map()
const report = { merged: [], dropped: [], reclassified: [], remappedRefs: 0 }

/* ── 1. 同名同日合并 ── */
const groups = new Map()
for (const it of items) {
  if (!isFilled(it.date)) continue
  const key = `${it.ownerId}|${it.date}|${String(it.title).trim()}`
  const list = groups.get(key) ?? []
  list.push(it)
  groups.set(key, list)
}
for (const [key, list] of groups) {
  if (list.length < 2) continue
  const sorted = [...list].sort((a, b) => richness(b) - richness(a))
  const base = sorted[0]
  for (const o of sorted.slice(1)) {
    for (const f of FILL_FIELDS) {
      if (!isFilled(base[f]) && isFilled(o[f])) base[f] = o[f]
    }
    base.status = mergeStatus(base.status, o.status)
    if (isFilled(o.completedAt) && !isFilled(base.completedAt)) base.completedAt = o.completedAt
    base.updatedAt = now
    deletedIds.add(o.id)
    remap.set(o.id, base.id)
    report.merged.push({
      key, keepId: base.id, dropId: o.id,
      kept: `time=${base.time ?? '—'} detail=${(base.detail ?? '—').slice(0, 16)} ownerName=${base.ownerName ?? '—'} status=${base.status}`,
    })
  }
}

/* ── 2. 显式删除指定 id ── */
for (const id of DROP_IDS) {
  if (deletedIds.has(id)) continue
  const hit = items.find((it) => it.id === id)
  if (hit !== undefined) {
    deletedIds.add(id)
    report.dropped.push({ id, title: hit.title, date: hit.date ?? '' })
  }
}
const kept = items.filter((it) => !deletedIds.has(it.id))

/* ── 3. 引用改指 + 动作类改回任务 ── */
for (const it of kept) {
  if (isFilled(it.keyDateId) && remap.has(it.keyDateId)) {
    it.keyDateId = remap.get(it.keyDateId)
    report.remappedRefs++
  }
  if (isFilled(it.keyDateId) && deletedIds.has(it.keyDateId)) {
    delete it.keyDateId
    delete it.remindKeyDate
  }
  const rule = RECLASSIFY.find((r) => String(it.title).trim() === r.title)
  if (rule !== undefined && (it.type !== rule.type || it.status !== rule.status)) {
    report.reclassified.push({ id: it.id, title: it.title, from: it.type, to: rule.type, status: rule.status })
    it.type = rule.type
    it.status = rule.status
    it.completedAt = it.completedAt ?? now
    it.updatedAt = now
  }
}

/* ── 4. 报告 ── */
console.log(`数据根：${DATA_DIR}`)
console.log(`事项：${items.length} → ${kept.length}（合并 ${report.merged.length} 条 / 删除 ${report.dropped.length} 条）`)
if (report.merged.length > 0) {
  console.log('\n合并明细：')
  for (const m of report.merged) console.log(`  ▸ ${m.key}\n      保留 ${m.keepId}（${m.kept}）\n      删除 ${m.dropId}`)
}
if (report.dropped.length > 0) {
  console.log('\n显式删除：')
  for (const d of report.dropped) console.log(`  ▸ ${d.title}（${d.id}）${d.date}`)
}
if (report.reclassified.length > 0) {
  console.log('\n动作类改回任务：')
  for (const r of report.reclassified) console.log(`  ▸ ${r.title}（${r.id}）：${r.from} → ${r.to}，状态 ${r.status}`)
}
if (report.remappedRefs > 0) console.log(`\nkeyDateId 引用改指：${report.remappedRefs} 处`)

if (!APPLY) {
  console.log('\n（干跑，未落盘。加 --apply 执行）')
  process.exit(0)
}

/* ── 5. 落盘（备份 + 原子写） ── */
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
await copyFile(ITEMS_FILE, `${ITEMS_FILE}.bak-cleanup-0.2.13-${stamp}`)
doc.items = kept
doc.lastUpdated = now
const tmp = `${ITEMS_FILE}.tmp-cleanup`
await writeFile(tmp, JSON.stringify(doc, null, 2), 'utf8')
await rename(tmp, ITEMS_FILE)
console.log(`\n✅ 已写回 ${ITEMS_FILE}\n   备份：${ITEMS_FILE}.bak-cleanup-0.2.13-${stamp}`)

/* ── 6. 日历台账清理被删 id ── */
if (existsSync(MAP_FILE)) {
  try {
    const map = JSON.parse(await readFile(MAP_FILE, 'utf8'))
    let pruned = 0
    for (const id of deletedIds) if (id in map) { delete map[id]; pruned++ }
    if (pruned > 0) {
      await copyFile(MAP_FILE, `${MAP_FILE}.bak-cleanup-0.2.13-${stamp}`)
      await writeFile(MAP_FILE, JSON.stringify(map, null, 2), 'utf8')
      console.log(`   日历台账清理 ${pruned} 条指向已删事项的条目`)
    }
  } catch (e) {
    console.warn('   日历台账清理失败（不影响数据）:', e instanceof Error ? e.message : String(e))
  }
}
