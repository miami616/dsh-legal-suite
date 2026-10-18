#!/usr/bin/env node
/**
 * 巡检状态机自测（runReminderTick）：摘要、失败重试、精确提醒、去重。
 *
 * 全程使用临时目录 + 拦截后的 fetch（不真的发飞书）。
 */
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPushStore, createRunStateStore } from '../lib/domains/push/store/push-config.js'
import { runReminderTick } from '../lib/domains/push/push.js'

const base = mkdtempSync(join(tmpdir(), 'reminder-tick-'))
const dir = join(base, 'litigation')
mkdirSync(dir, { recursive: true })
mkdirSync(join(base, 'items'), { recursive: true })
writeFileSync(join(dir, 'case-registry.json'), JSON.stringify({ registryVersion: '1.0', cases: {} }))

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const day = (offset) => ymd(new Date(2026, 9, 18 + offset))
const at = (h, m) => new Date(2026, 9, 18, h, m, 0).getTime()

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
const cfg = { enabled: true, pushTime: '08:30', smartLead: true, preciseReminder: true, includeConsequence: true }

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
check('成功后记录 lastDigestDate', st.lastDigestDate === '2026-10-18')

globalThis.fetch = originalFetch
rmSync(base, { recursive: true, force: true })
rmSync(base2, { recursive: true, force: true })

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
