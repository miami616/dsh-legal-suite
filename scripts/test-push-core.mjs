#!/usr/bin/env node
/**
 * Logic test for the push core (runDeadlinePush) against a temp data dir.
 *
 * Safe: uses a temp litigation data dir + a mocked global fetch (the Feishu
 * open API calls are intercepted, never hitting the network). Validates:
 *  1. window filter (today / tomorrow only — 3-day-out is excluded)
 *  2. fixed template formatting
 *  3. per-day dedupe ledger (same-day second run skips; next-day re-pushes)
 *  4. disabled config → no push
 */
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPushStore } from '../lib/domains/push/store/push-config.js'
import { runDeadlinePush, formatPush, remainingLabel } from '../lib/domains/push/push.js'

const today = new Date().toISOString().slice(0, 10)
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
const in3days = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)

// Temp data dirs: litigation 数据 + 兄弟目录 items（与生产一致：items 在
// $DSH_HOME/agentlex/items = litigationDir 的父目录 + /items）。
const base = mkdtempSync(join(tmpdir(), 'push-test-'))
const dir = join(base, 'litigation')
mkdirSync(dir, { recursive: true })
mkdirSync(join(base, 'items'), { recursive: true })
writeFileSync(join(dir, 'case-registry.json'), JSON.stringify({
  registryVersion: '1.0',
  cases: {
    c1: { caseId: 'c1', name: '张三诉李四合同纠纷', type: 'civil', caseNumber: '(2026)鲁0102民初10195号', court: '济南市历下区人民法院', status: 'awaiting_trial' },
  },
}))
writeFileSync(join(base, 'items', 'items.json'), JSON.stringify({
  registryVersion: '1.0',
  items: [
    // ownerName 故意缺失（历史数据大量缺失）——验证从 registry 按 ownerId 补全。
    { id: 'kd1', ownerId: 'c1', type: 'both', title: '开庭', date: tomorrow, time: '09:00', status: 'pending', detail: '速裁审判法庭第一庭', subtasks: [], checklist: [] },
    { id: 'kd2', ownerId: 'c1', type: 'both', title: '举证期限', date: today, status: 'pending', subtasks: [], checklist: [] },
    { id: 'kd3', ownerId: 'c1', type: 'event', title: '远期节点', date: in3days, status: 'pending', subtasks: [], checklist: [] },
  ],
}))
writeFileSync(join(dir, 'case-timeline.json'), JSON.stringify({ registryVersion: '1.0', events: [] }))

const store = createPushStore(dir)

// Feishu credentials for the card sender (same layout as production).
process.env.DSH_HOME = base
mkdirSync(join(base, 'integrations', 'dsh-feishu'), { recursive: true })
writeFileSync(join(base, 'integrations', 'dsh-feishu', 'config.json'), JSON.stringify({
  bots: [{ appId: 'cli_test', secretRef: 'feishu_test_secret', ownerOpenIds: ['ou_test_owner'] }],
}))
writeFileSync(join(base, '.credentials.yaml'), 'refs:\n  feishu_test_secret: test-secret-value\n')

// Mock global fetch: intercept the Feishu open API (token + message send).
let sentCards = []
const originalFetch = globalThis.fetch
globalThis.fetch = async (url, options) => {
  const u = String(url)
  if (u.includes('/auth/v3/tenant_access_token/internal')) {
    return new Response(JSON.stringify({ code: 0, tenant_access_token: 't_test' }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (u.includes('/im/v1/messages')) {
    const body = JSON.parse(String(options?.body ?? '{}'))
    sentCards.push(body.content)
    return new Response(JSON.stringify({ code: 0, msg_id: 'm_test' }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return originalFetch(url, options)
}

let pass = 0, fail = 0
function check(name, cond) {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}`) }
}

console.log('== remainingLabel ==')
check('today → 今天', remainingLabel(0) === '今天')
check('tomorrow → 明天', remainingLabel(1) === '明天')
check('overdue → 已逾期 2 天', remainingLabel(-2) === '已逾期 2 天')

console.log('== formatPush ==')
const text = formatPush([
  { caseId: 'c1', caseName: '张三诉李四合同纠纷', caseNumber: '(2026)鲁0102民初10195号', court: '济南市历下区人民法院', time: '09:00', detail: '速裁审判法庭第一庭', date: tomorrow, label: '开庭', kind: 'hearing', daysLeft: 1, urgent: true, overdue: false, source: 'both' },
], '律所')
check('含标题前缀', text.startsWith('律所 重要日程提醒'))
check('含明天', text.includes('开庭 · 明天 09:00'))
check('含案号', text.includes('案号：(2026)鲁0102民初10195号'))
check('含法院', text.includes('法院：济南市历下区人民法院'))
check('含法庭', text.includes('法庭：速裁审判法庭第一庭'))

console.log('== runDeadlinePush: window filter + push ==')
const cfg = { enabled: true, titlePrefix: '律所' }
const r1 = await runDeadlinePush({ litigation: dir, nonlitigation: dir, tasks: dir }, cfg, store)
check('窗口内 2 条（今天+明天）', r1.due === 2)
check('推送 2 条', r1.pushed === 2)
check('attempted', r1.attempted === true)
check('发送了 1 张卡片', sentCards.length === 1)
const card1 = JSON.parse(sentCards[0])
check('卡片 header 含前缀+标题', card1.header?.title?.content === '律所 重要日程与任务提醒')
const cardText = JSON.stringify(card1)
check('卡片含开庭标题', cardText.includes('**开庭**'))
check('卡片含明天标签', cardText.includes("<text_tag color='orange'>明天</text_tag>"))
check('卡片含举证期限', cardText.includes('**举证期限**'))
check('卡片含今天标签', cardText.includes("<text_tag color='red'>今天</text_tag>"))
check('卡片含补全的案件名', cardText.includes('张三诉李四合同纠纷'))
check('卡片含案号', cardText.includes('案号：(2026)鲁0102民初10195号'))
check('卡片含完整 detail', cardText.includes('速裁审判法庭第一庭'))
check('卡片不含远期节点', !cardText.includes('远期节点'))

console.log('== collectAllDeadlines: 排序（今天在前、明天在后） ==')
const { collectAllDeadlines } = await import('../lib/domains/push/push.js')
const all = await collectAllDeadlines(dir, dir, dir)
const dueSorted = all.filter((i) => i.daysLeft === 0 || i.daysLeft === 1)
check('排序后第一条是今天', dueSorted[0]?.daysLeft === 0)
check('排序后第二条是明天', dueSorted[1]?.daysLeft === 1)
check('案件名已从 registry 补全', dueSorted[0]?.caseName === '张三诉李四合同纠纷')

console.log('== runDeadlinePush: same-day dedupe ==')
const r2 = await runDeadlinePush({ litigation: dir, nonlitigation: dir, tasks: dir }, cfg, store)
check('同日第二次不重复推', r2.pushed === 0 && r2.attempted === false)
check('卡片数仍为 1', sentCards.length === 1)

console.log('== runDeadlinePush: force 绕过台账推全部 ==')
const r2f = await runDeadlinePush({ litigation: dir, nonlitigation: dir, tasks: dir }, cfg, store, { force: true })
check('force 推送窗口内全部 2 条', r2f.pushed === 2)
check('卡片数变为 2', sentCards.length === 2)

console.log('== runDeadlinePush: disabled config ==')
const r3 = await runDeadlinePush({ litigation: dir, nonlitigation: dir, tasks: dir }, { enabled: false }, store)
check('disabled 不推', r3.pushed === 0 && r3.attempted === false)

console.log('== runDeadlinePush: next-day re-push (ledger expiry) ==')
// 模拟次日：把台账里今天的记录改成昨天 → 次日 8:30 应重新推送窗口内期限。
const fsPromises = await import('node:fs/promises')
const ledgerPath = join(dir, 'push-ledger.json')
const ledger = JSON.parse(await fsPromises.readFile(ledgerPath, 'utf8'))
const yesterday = new Date(Date.now() - 86400000).toISOString()
ledger.entries = ledger.entries.map((e) => ({ ...e, pushedAt: yesterday }))
await fsPromises.writeFile(ledgerPath, JSON.stringify(ledger))
const r4 = await runDeadlinePush({ litigation: dir, nonlitigation: dir, tasks: dir }, cfg, store)
check('次日重新推送窗口内 2 条', r4.pushed === 2)
check('卡片数变为 3', sentCards.length === 3)

// Restore fetch.
globalThis.fetch = originalFetch
rmSync(base, { recursive: true, force: true })

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
