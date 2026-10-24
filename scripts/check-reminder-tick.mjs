#!/usr/bin/env node
/**
 * 巡检状态机自测（runReminderTick）：摘要、失败重试、精确提醒、去重。
 *
 * 全程使用临时目录 + 拦截后的 fetch（不真的发飞书）。
 */
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acquirePushRunLock, createPushStore, createRunStateStore } from '../lib/domains/push/store/push-config.js'
import { runReminderTick } from '../lib/domains/push/push.js'

const base = mkdtempSync(join(tmpdir(), 'reminder-tick-'))
const dir = join(base, 'litigation')
mkdirSync(dir, { recursive: true })
mkdirSync(join(base, 'items'), { recursive: true })
writeFileSync(join(dir, 'case-registry.json'), JSON.stringify({ registryVersion: '1.0', cases: {} }))

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const day = (offset) => ymd(new Date(2026, 9, 19 + offset))
const at = (h, m) => new Date(2026, 9, 19, h, m, 0).getTime()

const items = [
  { id: 'h1', ownerId: '', type: 'event', title: '开庭', date: day(0), time: '09:00', status: 'pending' },
  { id: 'h2', ownerId: '', type: 'event', title: '开庭', date: day(1), time: '09:00', status: 'pending' },
  { id: 's1', ownerId: '', type: 'event', title: '上诉期届满', date: day(6), status: 'pending' },
  { id: 't1', ownerId: '', type: 'task', title: '逾期任务', date: day(-3), status: 'pending' },
]
writeFileSync(join(base, 'items', 'items.json'), JSON.stringify({ registryVersion: '1.0', items }))

// 飞书凭据
process.env.DSH_HOME = base
mkdirSync(join(base, 'integrations', 'dsh-feishu'), { recursive: true })
writeFileSync(join(base, 'integrations', 'dsh-feishu', 'config.json'), JSON.stringify({
  bots: [{ appId: 'cli_test', secretRef: 'feishu_test_secret', ownerOpenIds: ['ou_test_owner'] }],
}))
writeFileSync(join(base, '.credentials.yaml'), 'refs:\n  feishu_test_secret: test-secret-value\n')

let failNext = false
let cards = []
const originalFetch = globalThis.fetch
globalThis.fetch = async (url, options) => {
  if (String(url).includes('/auth/v3/tenant_access_token/internal')) {
    return new Response(JSON.stringify({ code: 0, tenant_access_token: 't' }), { status: 200 })
  }
  if (String(url).includes('/im/v1/messages')) {
    if (failNext) throw new Error('network down')
    const body = JSON.parse(String(options?.body ?? '{}'))
    cards.push(body.content)
    return new Response(JSON.stringify({ code: 0, msg_id: `m${cards.length}` }), { status: 200 })
  }
  return originalFetch(url, options)
}

let pass = 0
let fail = 0
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}${extra !== '' ? `  (${extra})` : ''}`) }
}

const store = createPushStore(dir)
const stateStore = createRunStateStore(dir)
// 本用例只测日报/精确提醒，关掉周报以免周一档期先发「本周重点工作」。
const cfg = { enabled: true, pushTime: '08:30', smartLead: true, preciseReminder: true, includeConsequence: true, weeklyPlanEnabled: false, weeklyReviewEnabled: false }

console.log('== 摘要 / 精确提醒 ==')
const r1 = await runReminderTick({ litigation: dir, nonlitigation: dir, tasks: dir }, cfg, store, stateStore, { now: at(8, 35) })
check('到点后首次巡检查阅发送摘要', r1.attempted === true && r1.kind === 'digest', JSON.stringify(r1))
check('摘要含 4 项（今日开庭/明日开庭/上诉期补发/逾期任务）', r1.pushed === 4, String(r1.pushed))
const digestCard = cards[0] ?? ''
check('摘要卡含硬期限后果提示', digestCard.includes('丧失上诉权'))
check('摘要卡含逾期任务分区', digestCard.includes('逾期任务'))
check('摘要卡含补发标签', digestCard.includes('（补）'))

const r2 = await runReminderTick({ litigation: dir, nonlitigation: dir, tasks: dir }, cfg, store, stateStore, { now: at(8, 40) })
check('同日摘要不重复，转而发送精确提醒', r2.kind === 'intraday' && r2.pushed === 1, JSON.stringify(r2))
check('精确提醒显示剩余分钟', (cards[1] ?? '').includes('还有 20 分钟'))

const r3 = await runReminderTick({ litigation: dir, nonlitigation: dir, tasks: dir }, cfg, store, stateStore, { now: at(8, 45) })
check('同一提前量档不重复提醒', r3.kind === 'none' && r3.pushed === 0, JSON.stringify(r3))

// 摘要后新增「明天」事项：不应立即补充（等下一日/周一）；新增「今天」事项才补充。
const doc = JSON.parse(readFileSync(join(base, 'items', 'items.json'), 'utf8'))
doc.items.push({ id: 'new-tomorrow', ownerId: '', type: 'event', title: '新增明日事项', date: day(2), status: 'pending' })
writeFileSync(join(base, 'items', 'items.json'), JSON.stringify(doc))
const rTomorrow = await runReminderTick({ litigation: dir, nonlitigation: dir, tasks: dir }, cfg, store, stateStore, { now: at(8, 55) })
check('摘要后新增明日事项不触发补充卡', rTomorrow.kind === 'none', JSON.stringify(rTomorrow))
doc.items.push({ id: 'new-today', ownerId: '', type: 'task', title: '新增今日任务', date: day(0), status: 'pending' })
writeFileSync(join(base, 'items', 'items.json'), JSON.stringify(doc))
const rToday = await runReminderTick({ litigation: dir, nonlitigation: dir, tasks: dir }, cfg, store, stateStore, { now: at(8, 56) })
check('摘要后新增今日事项触发一张补充卡', rToday.kind === 'incremental' && rToday.pushed === 1, JSON.stringify(rToday))

console.log('== 工作日 / 周末 / 假期补位 ==')
const sat = await runReminderTick({ litigation: dir, nonlitigation: dir, tasks: dir }, cfg, store, stateStore, { now: new Date(2026, 9, 24, 9, 5).getTime() })
check('周六不发送每日摘要', sat.kind === 'none' && sat.pushed === 0, JSON.stringify(sat))
const fri = await runReminderTick({ litigation: dir, nonlitigation: dir, tasks: dir }, cfg, store, stateStore, { now: new Date(2026, 9, 23, 9, 5).getTime() })
check('周五把周日开庭/期限补进摘要', fri.kind === 'digest' && fri.pushed >= 1, JSON.stringify(fri))
check('补位摘要包含周日上诉期', cards.some((c) => String(c).includes('上诉期届满')))

console.log('== 摘要后不因限额条目再发补充卡 ==')
const base3 = mkdtempSync(join(tmpdir(), 'reminder-tick-cap-'))
const dir3 = join(base3, 'litigation')
mkdirSync(dir3, { recursive: true })
mkdirSync(join(base3, 'items'), { recursive: true })
writeFileSync(join(dir3, 'case-registry.json'), JSON.stringify({ registryVersion: '1.0', cases: {} }))
writeFileSync(join(base3, 'items', 'items.json'), JSON.stringify({
  registryVersion: '1.0',
  items: Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, ownerId: '', type: 'event', title: `明日事项${i}`, date: day(1), status: 'pending' })),
}))
mkdirSync(join(base3, 'integrations', 'dsh-feishu'), { recursive: true })
writeFileSync(join(base3, 'integrations', 'dsh-feishu', 'config.json'), JSON.stringify({
  bots: [{ appId: 'cli_test', secretRef: 'feishu_test_secret', ownerOpenIds: ['ou_test_owner'] }],
}))
writeFileSync(join(base3, '.credentials.yaml'), 'refs:\n  feishu_test_secret: test-secret-value\n')
const store3 = createPushStore(dir3)
const state3 = createRunStateStore(dir3)
const c1 = await runReminderTick({ litigation: dir3, nonlitigation: dir3, tasks: dir3 }, cfg, store3, state3, { now: at(8, 35) })
check('摘要按明日限额只发 6 条', c1.kind === 'digest' && c1.pushed === 6, JSON.stringify(c1))
const c2 = await runReminderTick({ litigation: dir3, nonlitigation: dir3, tasks: dir3 }, cfg, store3, state3, { now: at(8, 40) })
check('5 分钟后的限额余项不再补发', c2.kind === 'none' && c2.pushed === 0, JSON.stringify(c2))

console.log('== 跨进程推送锁 ==')
const lockDir = mkdtempSync(join(tmpdir(), 'push-lock-'))
const release1 = await acquirePushRunLock(lockDir)
check('首次拿锁成功', release1 !== undefined)
const release2 = await acquirePushRunLock(lockDir)
check('第二次拿锁被拒绝', release2 === undefined)
await release1?.()
const release3 = await acquirePushRunLock(lockDir)
check('释放后可再次拿锁', release3 !== undefined)
await release3?.()
// 数据目录尚不存在时也应能拿锁（首次使用/手动触发周报的场景）。
const freshLockDir = join(mkdtempSync(join(tmpdir(), 'push-lock-fresh-')), 'push')
const releaseFresh = await acquirePushRunLock(freshLockDir)
check('数据目录不存在时首次拿锁成功（自动建目录）', releaseFresh !== undefined)
await releaseFresh?.()
mkdirSync(join(lockDir, 'push-run.lock'))
const old = new Date(Date.now() - 20 * 60_000)
utimesSync(join(lockDir, 'push-run.lock'), old, old)
const release4 = await acquirePushRunLock(lockDir)
check('超过 10 分钟的残留锁自动清理', release4 !== undefined)
await release4?.()

console.log('== 失败重试与状态 ==')
// 新目录：只放明天开庭，避免精确提醒干扰。
const base2 = mkdtempSync(join(tmpdir(), 'reminder-tick-fail-'))
const dir2 = join(base2, 'litigation')
mkdirSync(dir2, { recursive: true })
mkdirSync(join(base2, 'items'), { recursive: true })
writeFileSync(join(dir2, 'case-registry.json'), JSON.stringify({ registryVersion: '1.0', cases: {} }))
writeFileSync(join(base2, 'items', 'items.json'), JSON.stringify({
  registryVersion: '1.0',
  items: [{ id: 'h2', ownerId: '', type: 'event', title: '开庭', date: day(1), time: '09:00', status: 'pending' }],
}))
mkdirSync(join(base2, 'integrations', 'dsh-feishu'), { recursive: true })
writeFileSync(join(base2, 'integrations', 'dsh-feishu', 'config.json'), JSON.stringify({
  bots: [{ appId: 'cli_test', secretRef: 'feishu_test_secret', ownerOpenIds: ['ou_test_owner'] }],
}))
writeFileSync(join(base2, '.credentials.yaml'), 'refs:\n  feishu_test_secret: test-secret-value\n')
const store2 = createPushStore(dir2)
const state2 = createRunStateStore(dir2)

failNext = true
const f1 = await runReminderTick({ litigation: dir2, nonlitigation: dir2, tasks: dir2 }, cfg, store2, state2, { now: at(8, 35) })
check('首次失败：attempted + error', f1.attempted === true && f1.error !== undefined, JSON.stringify(f1))
let st = await state2.read()
check('失败落盘（lastError + 计数）', (st.lastError ?? '') !== '' && st.consecutiveFailures === 1)
check('失败不记 lastDigestDate（下轮可重试）', st.lastDigestDate === undefined)

const f2 = await runReminderTick({ litigation: dir2, nonlitigation: dir2, tasks: dir2 }, cfg, store2, state2, { now: at(8, 40) })
check('10 分钟内不重试（避免打爆飞书）', f2.attempted === false, JSON.stringify(f2))

failNext = false
const f3 = await runReminderTick({ litigation: dir2, nonlitigation: dir2, tasks: dir2 }, cfg, store2, state2, { now: at(8, 50) })
check('10 分钟后重试成功', f3.attempted === true && f3.kind === 'retry', JSON.stringify(f3))
st = await state2.read()
check('成功后清空失败状态', (st.lastError ?? '') === '' && st.consecutiveFailures === 0)
check('成功后记录 lastDigestDate', st.lastDigestDate === '2026-10-19')

globalThis.fetch = originalFetch
rmSync(base, { recursive: true, force: true })
rmSync(base2, { recursive: true, force: true })
rmSync(base3, { recursive: true, force: true })

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
