#!/usr/bin/env node
/**
 * Logic test for the push core (runDeadlinePush) against a temp data dir.
 *
 * Safe: uses a temp litigation data dir + a mock dshIm — no dsh instance,
 * no live data, no network. Validates:
 *  1. window filter (today / tomorrow only)
 *  2. fixed template formatting
 *  3. dedupe ledger (no double push)
 *  4. disabled config → no push
 */
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPushStore } from '../lib/domains/push/store/push-config.js'
import { runDeadlinePush, formatPush, remainingLabel, reminderTimeMs, DEFAULT_REMIND_HOUR } from '../lib/domains/push/push.js'

const today = new Date().toISOString().slice(0, 10)
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)
const in3days = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)

// Temp data dir with a sample case registry + timeline.
const dir = mkdtempSync(join(tmpdir(), 'push-test-'))
mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, 'case-registry.json'), JSON.stringify({
  registryVersion: '1.0',
  cases: {
    c1: {
      caseId: 'c1', name: '张三诉李四合同纠纷', type: 'civil',
      keyDates: [
        { id: 'kd1', label: '开庭', date: tomorrow },
        { id: 'kd2', label: '举证期限', date: today },
        { id: 'kd3', label: '远期节点', date: in3days },
      ],
    },
  },
}))
writeFileSync(join(dir, 'case-timeline.json'), JSON.stringify({ registryVersion: '1.0', events: [] }))

const store = createPushStore(dir)
const sent = []
const mockDshIm = {
  send: async (botId, targetId, text) => { sent.push({ botId, targetId, text }); return { sent: true } },
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

console.log('== reminderTimeMs (precise 24h lead) ==')
// 明天 09:00 开庭 → 提醒 = 今天 09:00
const hearing = { caseId: 'c1', caseName: 'x', date: tomorrow, label: '开庭', kind: 'hearing', daysLeft: 1, urgent: true, overdue: false, source: 'keydate', time: '09:00' }
const hearingRemind = reminderTimeMs(hearing)
const expectedHearing = new Date(`${tomorrow}T09:00:00`).getTime() - 24 * 3600_000
check('有 time 09:00 → 提前 24h 精确到分钟', hearingRemind === expectedHearing, `got ${hearingRemind} expected ${expectedHearing}`)
// 无 time → 提前 1 天早上 8 点
const noTime = { caseId: 'c1', caseName: 'x', date: tomorrow, label: '举证期限', kind: 'deadline', daysLeft: 1, urgent: true, overdue: false, source: 'keydate' }
const noTimeRemind = reminderTimeMs(noTime)
const expectedNoTime = new Date(`${tomorrow}T00:00:00`)
expectedNoTime.setHours(DEFAULT_REMIND_HOUR, 0, 0, 0)
check('无 time → 提前 1 天早上 8 点', noTimeRemind === expectedNoTime.getTime() - 24 * 3600_000, `got ${noTimeRemind} expected ${expectedNoTime.getTime() - 24 * 3600_000}`)

console.log('== formatPush (fixed template) ==')
const text = formatPush([
  { caseId: 'c1', caseName: '张三诉李四合同纠纷', caseNumber: '(2026)鲁0102民初10195号', court: '济南市历下区人民法院', time: '14:45', detail: '速裁审判法庭第一庭', date: tomorrow, label: '开庭', kind: 'hearing', daysLeft: 1, urgent: true, overdue: false, source: 'keydate' },
  { caseId: 'c1', caseName: '张三诉李四合同纠纷', date: today, label: '举证期限', kind: 'deadline', daysLeft: 0, urgent: true, overdue: false, source: 'keydate' },
])
check('has header', text.startsWith('重要日程提醒'))
check('has 明天 row with time', text.includes('开庭 · 明天 14:45'))
check('has 今天 row', text.includes('举证期限 · 今天'))
check('has 案号', text.includes('(2026)鲁0102民初10195号'))
check('has 法院', text.includes('济南市历下区人民法院'))
check('has 法庭', text.includes('速裁审判法庭第一庭'))
check('no 时间： label', !text.includes('时间：'))
check('no 案件： label', !text.includes('案件：'))
check('no 3-day row', !text.includes('远期节点'))

console.log('== runDeadlinePush (reminder-time filter + dedupe) ==')
const cfg = { enabled: true, botId: 'bot_test', targetId: 'tgt_test' }
// now = 今天 12:00（已过无 time 期限的早上 8 点提醒，且未到 3 天后的提醒）
const now = new Date(`${today}T12:00:00`).getTime()
// 用临时目录隔离三个数据源（避免读到真实非诉/任务数据）。
const dirs = { litigation: dir, nonlitigation: dir, tasks: dir }
const r1 = await runDeadlinePush(dirs, cfg, store, mockDshIm, now)
check('pushed 2 (today+tomorrow, not 3-day)', r1.pushed === 2, `got ${r1.pushed}`)
check('due = 2', r1.due === 2)
check('sent 1 message', sent.length === 1)
check('message has both rows', sent[0].text.includes('开庭') && sent[0].text.includes('举证期限'))

// Second run: dedupe should skip both.
const r2 = await runDeadlinePush(dirs, cfg, store, mockDshIm, now)
check('second run pushes 0 (dedupe)', r2.pushed === 0, `got ${r2.pushed}`)
check('still 1 message total', sent.length === 1)

// Disabled config → no push.
const r3 = await runDeadlinePush(dirs, { ...cfg, enabled: false }, store, mockDshIm, now)
check('disabled → no push', r3.pushed === 0 && r3.attempted === false)

// Empty botId/targetId → no push.
const r4 = await runDeadlinePush(dirs, { ...cfg, targetId: '' }, store, mockDshIm, now)
check('empty target → no push', r4.pushed === 0 && r4.attempted === false)

rmSync(dir, { recursive: true, force: true })
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
