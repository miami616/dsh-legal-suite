#!/usr/bin/env node
/**
 * 周报自测：周历口径 + 巡检接入（周一只发一张、周五下午总结、空周不发、失败退化日报）。
 *
 * 全程临时目录 + 拦截 fetch，不真的发飞书。
 *
 * 固定时间：2026-10-19（周一）— 2026-10-25（周日），ISO 第 43 周。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPushStore, createRunStateStore } from '../lib/domains/push/store/push-config.js'
import { runReminderTick } from '../lib/domains/push/push.js'
import {
  buildWeeklyPlan,
  buildWeeklyReview,
  firstWorkdayDate,
  isFirstWorkdayOfWeek,
  isLastWorkdayOfWeek,
  isoWeekKey,
  lastWorkdayDate,
  mondayOf,
  nextPlanDate,
  nextReviewDate,
  weekBounds,
  weekLabelOf,
} from '../lib/domains/push/weekly.js'

let pass = 0
let fail = 0
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}${extra !== '' ? `  (${extra})` : ''}`) }
}

/** 2026-10-19 周一 10:00 的本地时间戳。 */
const NOW = new Date(2026, 9, 19, 10, 0, 0).getTime()
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const day = (offset) => ymd(new Date(2026, 9, 19 + offset))
const at = (d, h, m) => new Date(2026, 9, d, h, m, 0).getTime()

/** 构造 DeadlineItem。 */
function item(overrides = {}) {
  return {
    caseId: '2026-001',
    caseName: '甲方与乙方买卖合同纠纷',
    date: day(1),
    label: '开庭',
    kind: 'hearing',
    time: '09:00',
    daysLeft: 1,
    urgent: true,
    overdue: false,
    source: 'hearing',
    ...overrides,
  }
}

console.log('== 1. 周历口径 ==')
check('周一为一周第一天', mondayOf('2026-10-21') === '2026-10-19', mondayOf('2026-10-21'))
check('周六归属本周一', mondayOf('2026-10-24') === '2026-10-19', mondayOf('2026-10-24'))
check('周日本身返回当周周一', mondayOf('2026-10-25') === '2026-10-19', mondayOf('2026-10-25'))
check('ISO 周次 2026-W43', isoWeekKey('2026-10-19') === '2026-W43', isoWeekKey('2026-10-19'))
check('跨年周次正确（2027-01-01 → 2026-W53）', isoWeekKey('2027-01-01') === '2026-W53', isoWeekKey('2027-01-01'))
check('周范围 10-19 → 10-25', weekBounds('2026-10-21').monday === '2026-10-19' && weekBounds('2026-10-21').sunday === '2026-10-25')
check('周展示文案', weekLabelOf('2026-10-19') === '2026 年第 43 周', weekLabelOf('2026-10-19'))
check('普通周一 = 本周首个工作日', isFirstWorkdayOfWeek('2026-10-19') === true)
check('周二不是首个工作日', isFirstWorkdayOfWeek('2026-10-20') === false)
check('普通周五 = 本周末个工作日', isLastWorkdayOfWeek('2026-10-23') === true)
check('周四不是末个工作日', isLastWorkdayOfWeek('2026-10-22') === false)
// 国庆：10/1-10/7 放假，10/8（周四）是节后第一个工作日；10/10（周六）调休上班，是本周最后一个工作日。
check('假日周首个工作日顺延到 10/8', firstWorkdayDate(new Date(2026, 9, 8, 10).getTime()) === '2026-10-08', String(firstWorkdayDate(new Date(2026, 9, 8, 10).getTime())))
check('假日周 10/8 判定为首个工作日', isFirstWorkdayOfWeek('2026-10-08') === true)
check('假日周末个工作日是调休的 10/10', lastWorkdayDate(new Date(2026, 9, 10, 10).getTime()) === '2026-10-10', String(lastWorkdayDate(new Date(2026, 9, 10, 10).getTime())))
check('假日周 10/10 判定为末个工作日', isLastWorkdayOfWeek('2026-10-10') === true)

check('周六算出下周一档期', nextPlanDate(new Date(2026, 9, 24, 10, 0).getTime(), 8, 30) === '2026-10-26', nextPlanDate(new Date(2026, 9, 24, 10, 0).getTime(), 8, 30))
check('周一早上 7 点档期是当天', nextPlanDate(new Date(2026, 9, 19, 7, 0).getTime(), 8, 30) === '2026-10-19', nextPlanDate(new Date(2026, 9, 19, 7, 0).getTime(), 8, 30))
check('周一早上 9 点档期顺延下周一', nextPlanDate(new Date(2026, 9, 19, 9, 0).getTime(), 8, 30) === '2026-10-26', nextPlanDate(new Date(2026, 9, 19, 9, 0).getTime(), 8, 30))
check('周六算出下周五总结档期', nextReviewDate(new Date(2026, 9, 24, 10, 0).getTime(), 16, 30) === '2026-10-30', nextReviewDate(new Date(2026, 9, 24, 10, 0).getTime(), 16, 30))
check('周五 15 点档期是当天', nextReviewDate(new Date(2026, 9, 23, 15, 0).getTime(), 16, 30) === '2026-10-23', nextReviewDate(new Date(2026, 9, 23, 15, 0).getTime(), 16, 30))
check('周五 17 点档期顺延下周五', nextReviewDate(new Date(2026, 9, 23, 17, 0).getTime(), 16, 30) === '2026-10-30', nextReviewDate(new Date(2026, 9, 23, 17, 0).getTime(), 16, 30))

console.log('== 2. 本周重点工作（内容装配）==')
const planItems = [
  item({ date: day(1), label: '开庭', kind: 'hearing', time: '09:00' }),
  item({ date: day(4), label: '上诉期届满', kind: 'keydate', time: undefined, daysLeft: 4 }),
  item({ date: day(2), label: '提交证据', kind: 'task', time: undefined, daysLeft: 2, source: 'task' }),
  item({ date: day(-4), label: '逾期任务', kind: 'task', daysLeft: -4, source: 'task' }),
  item({ date: day(8), label: '下周开庭', kind: 'hearing', daysLeft: 8 }),
]
const plan = buildWeeklyPlan({ items: planItems, done: [] }, NOW)
check('非空周产出计划卡', plan !== null && plan.kind === 'plan')
check('周次 2026-W43', plan?.weekKey === '2026-W43', plan?.weekKey)
check('硬节点只收本周（不含下周）', plan?.sections.find(s => s.title === '本周硬节点')?.rows.length === 2, JSON.stringify(plan?.sections.map(s => [s.title, s.rows.length])))
check('任务进「本周要推进」', plan?.sections.some(s => s.title === '本周要推进' && s.rows.some(r => r.label === '提交证据')))
check('逾期分区只给数量', plan?.sections.some(s => s.title === '逾期未办' && (s.note ?? '').includes('共 1 项')))
check('硬节点排序：开庭在前', plan?.sections.find(s => s.title === '本周硬节点')?.rows[0]?.label === '开庭')
check('今天/明天标签', plan?.sections.find(s => s.title === '本周硬节点')?.rows.some(r => r.tag === '明天'))
const emptyPlan = buildWeeklyPlan({ items: [], done: [] }, NOW)
check('空周返回 null（不发空卡）', emptyPlan === null)
const planWithAhead = buildWeeklyPlan({
  items: [],
  done: [],
  ahead: [{ label: '再审申请期限届满', date: day(30), caseName: '甲方与乙方买卖合同纠纷', phaseLabel: '还剩 30 天', severity: 'critical' }],
}, NOW)
check('周一计划补「提前提醒」一节', planWithAhead?.sections.some(s => s.title === '提前提醒' && s.rows.length === 1) === true, JSON.stringify(planWithAhead?.sections.map(s => s.title)))

console.log('== 3. 本周总结与下周重点（内容装配）==')
const reviewItems = [
  item({ date: day(1), label: '开庭', kind: 'hearing', daysLeft: -1 }),
  item({ date: day(2), label: '提交证据', kind: 'task', daysLeft: -1, source: 'task' }),
  item({ date: day(4), label: '今天的事', kind: 'task', daysLeft: 0, source: 'task' }),
  item({ date: day(8), label: '下周开庭', kind: 'hearing', daysLeft: 8 }),
  item({ date: day(-10), label: '更早积压', kind: 'task', daysLeft: -10, source: 'task' }),
]
const review = buildWeeklyReview({
  items: reviewItems,
  done: [
    { title: '整理证据材料', ownerName: '甲方与乙方买卖合同纠纷', updatedAt: '2026-10-21T09:00:00' },
    { title: '联系法院', ownerName: '甲方与乙方买卖合同纠纷', updatedAt: '2026-10-22T15:00:00' },
  ],
}, at(23, 16, 35))
check('周五产出总结卡', review !== null && review.kind === 'review')
check('本周完成 2 项', review?.sections.find(s => s.title === '本周完成')?.rows.length === 2)
check('顺延不含今天在办的事项', !review?.sections.find(s => s.title === '本周顺延')?.rows.some(r => r.label === '今天的事'))
check('顺延含本周已过期事项', review?.sections.find(s => s.title === '本周顺延')?.rows.some(r => r.label === '开庭'))
check('下周重点只收下周', review?.sections.find(s => s.title === '下周重点')?.rows.some(r => r.label === '下周开庭'))
check('更早积压只给数量', review?.sections.some(s => s.title === '更早积压' && (s.note ?? '').includes('1 项')))
const emptyReview = buildWeeklyReview({ items: [], done: [] }, at(23, 16, 35))
check('周总结无内容返回 null', emptyReview === null)

console.log('== 4. 巡检接入：周一只发一张、周五下午总结 ==')
const base = mkdtempSync(join(tmpdir(), 'weekly-tick-'))
const dir = join(base, 'litigation')
mkdirSync(dir, { recursive: true })
mkdirSync(join(base, 'items'), { recursive: true })
writeFileSync(join(dir, 'case-registry.json'), JSON.stringify({ registryVersion: '1.0', cases: {} }))
writeFileSync(join(base, 'items', 'items.json'), JSON.stringify({
  registryVersion: '1.0',
  items: [
    { id: 'h1', ownerId: '', type: 'event', title: '开庭', date: day(1), time: '09:00', status: 'pending' },
    { id: 'k1', ownerId: '', type: 'event', title: '上诉期届满', date: day(4), kind: 'deadline', status: 'pending' },
    { id: 't1', ownerId: '', type: 'task', title: '提交证据', date: day(2), status: 'pending' },
    { id: 't2', ownerId: '', type: 'task', title: '逾期任务', date: day(-4), status: 'pending' },
    { id: 'd1', ownerId: '', type: 'task', title: '整理证据材料', date: day(2), status: 'done', updatedAt: '2026-10-21T09:00:00' },
    { id: 'n1', ownerId: '', type: 'event', title: '下周开庭', date: day(8), time: '09:00', status: 'pending' },
    { id: 'k2', ownerId: '', type: 'event', title: '再审申请期限届满', date: day(30), kind: 'deadline', status: 'pending' },
  ],
}))
mkdirSync(join(base, 'integrations', 'dsh-feishu'), { recursive: true })
writeFileSync(join(base, 'integrations', 'dsh-feishu', 'config.json'), JSON.stringify({
  bots: [{ appId: 'cli_test', secretRef: 'feishu_test_secret', ownerOpenIds: ['ou_test_owner'] }],
}))
writeFileSync(join(base, '.credentials.yaml'), 'refs:\n  feishu_test_secret: test-secret-value\n')
process.env.DSH_HOME = base

let failNext = false
const cards = []
const originalFetch = globalThis.fetch
globalThis.fetch = async (url, options) => {
  if (String(url).includes('/auth/v3/tenant_access_token/internal')) {
    return new Response(JSON.stringify({ code: 0, tenant_access_token: 't' }), { status: 200 })
  }
  if (String(url).includes('/im/v1/messages')) {
    if (failNext) { failNext = false; throw new Error('network down') }
    cards.push(JSON.parse(String(options?.body ?? '{}')).content)
    return new Response(JSON.stringify({ code: 0, msg_id: `m${cards.length}` }), { status: 200 })
  }
  return originalFetch(url, options)
}

const store = createPushStore(dir)
const stateStore = createRunStateStore(dir)
const cfg = { enabled: true, pushTime: '08:30', smartLead: true, preciseReminder: true, includeConsequence: true }

const m1 = await runReminderTick({ litigation: dir, nonlitigation: dir, tasks: dir }, cfg, store, stateStore, { now: at(19, 8, 35) })
check('周一早上发「本周重点工作」而不是日报', m1.kind === 'weekly-plan' && m1.pushed > 0, JSON.stringify(m1))
check('周报卡含「本周硬节点」', (cards[0] ?? '').includes('本周硬节点'))
check('周报卡含「本周要推进」', (cards[0] ?? '').includes('本周要推进'))
check('周报卡含「逾期未办」', (cards[0] ?? '').includes('逾期未办'))
check('周报卡补「提前提醒」（T-30 进阶提醒不因替掉日报而丢）', (cards[0] ?? '').includes('提前提醒') && (cards[0] ?? '').includes('再审申请期限届满'))
let st = await stateStore.read()
check('周一卡替代当天日报（lastDigestDate=today）', st.lastDigestDate === '2026-10-19', String(st.lastDigestDate))
check('记录本周计划周次', st.lastWeeklyPlanWeek === '2026-W43', String(st.lastWeeklyPlanWeek))
const countAfterMonday = cards.length
const m2 = await runReminderTick({ litigation: dir, nonlitigation: dir, tasks: dir }, cfg, store, stateStore, { now: at(19, 9, 30) })
check('周一当天不再补发日报', m2.kind !== 'digest' && cards.length === countAfterMonday, JSON.stringify(m2))

const f1 = await runReminderTick({ litigation: dir, nonlitigation: dir, tasks: dir }, cfg, store, stateStore, { now: at(23, 15, 0) })
check('周五 15:00 不到点不发总结', f1.kind !== 'weekly-review', JSON.stringify(f1))
const f2 = await runReminderTick({ litigation: dir, nonlitigation: dir, tasks: dir }, cfg, store, stateStore, { now: at(23, 16, 35) })
check('周五 16:35 发「本周总结与下周重点」', f2.kind === 'weekly-review' && f2.pushed > 0, JSON.stringify(f2))
const reviewCard = cards[cards.length - 1] ?? ''
check('总结卡含「本周完成」', reviewCard.includes('本周完成'))
check('总结卡含「本周顺延」', reviewCard.includes('本周顺延'))
check('总结卡含「下周重点」', reviewCard.includes('下周重点'))
check('总结卡含本周已完成事项', reviewCard.includes('整理证据材料'))
st = await stateStore.read()
check('记录本周总结周次', st.lastWeeklyReviewWeek === '2026-W43', String(st.lastWeeklyReviewWeek))
const countAfterReview = cards.length
const f3 = await runReminderTick({ litigation: dir, nonlitigation: dir, tasks: dir }, cfg, store, stateStore, { now: at(23, 17, 10) })
check('周五总结同周不重复', f3.kind !== 'weekly-review' && cards.length === countAfterReview, JSON.stringify(f3))

console.log('== 5. 周报失败退化为日报 / 空周不发卡 ==')
const base2 = mkdtempSync(join(tmpdir(), 'weekly-tick-fail-'))
const dir2 = join(base2, 'litigation')
mkdirSync(dir2, { recursive: true })
mkdirSync(join(base2, 'items'), { recursive: true })
writeFileSync(join(dir2, 'case-registry.json'), JSON.stringify({ registryVersion: '1.0', cases: {} }))
writeFileSync(join(base2, 'items', 'items.json'), JSON.stringify({
  registryVersion: '1.0',
  items: [{ id: 'h1', ownerId: '', type: 'event', title: '开庭', date: day(1), time: '09:00', status: 'pending' }],
}))
mkdirSync(join(base2, 'integrations', 'dsh-feishu'), { recursive: true })
writeFileSync(join(base2, 'integrations', 'dsh-feishu', 'config.json'), JSON.stringify({
  bots: [{ appId: 'cli_test', secretRef: 'feishu_test_secret', ownerOpenIds: ['ou_test_owner'] }],
}))
writeFileSync(join(base2, '.credentials.yaml'), 'refs:\n  feishu_test_secret: test-secret-value\n')
const store2 = createPushStore(dir2)
const state2 = createRunStateStore(dir2)
failNext = true
const failCardsBefore = cards.length
const x1 = await runReminderTick({ litigation: dir2, nonlitigation: dir2, tasks: dir2 }, cfg, store2, state2, { now: at(19, 8, 35) })
check('周报发送失败后同轮退化为日报', x1.kind === 'digest' && x1.pushed > 0, JSON.stringify(x1))
check('退化日报确实发出', cards.length === failCardsBefore + 1)
const st2 = await state2.read()
check('退化后记录本周标记（周报不反复重试）', st2.lastWeeklyPlanWeek === '2026-W43', String(st2.lastWeeklyPlanWeek))
failNext = false

// 空周：没有任何事项 → 不发卡，但标记本周已处理。
const base3 = mkdtempSync(join(tmpdir(), 'weekly-tick-empty-'))
const dir3 = join(base3, 'litigation')
mkdirSync(dir3, { recursive: true })
mkdirSync(join(base3, 'items'), { recursive: true })
writeFileSync(join(dir3, 'case-registry.json'), JSON.stringify({ registryVersion: '1.0', cases: {} }))
writeFileSync(join(base3, 'items', 'items.json'), JSON.stringify({ registryVersion: '1.0', items: [] }))
mkdirSync(join(base3, 'integrations', 'dsh-feishu'), { recursive: true })
writeFileSync(join(base3, 'integrations', 'dsh-feishu', 'config.json'), JSON.stringify({
  bots: [{ appId: 'cli_test', secretRef: 'feishu_test_secret', ownerOpenIds: ['ou_test_owner'] }],
}))
writeFileSync(join(base3, '.credentials.yaml'), 'refs:\n  feishu_test_secret: test-secret-value\n')
const store3 = createPushStore(dir3)
const state3 = createRunStateStore(dir3)
const before = cards.length
const e1 = await runReminderTick({ litigation: dir3, nonlitigation: dir3, tasks: dir3 }, cfg, store3, state3, { now: at(19, 8, 35) })
check('空周不发空卡', cards.length === before && e1.pushed === 0, JSON.stringify(e1))
check('空周仍记录周次（不反复试）', (await state3.read()).lastWeeklyPlanWeek === '2026-W43')

// 手动档：mode=weekly-review 可在任意时间发送。
const manual = await runReminderTick({ litigation: dir, nonlitigation: dir, tasks: dir }, cfg, store, stateStore, { now: at(22, 10, 0), mode: 'weekly-review' })
check('手动模式可立即发周总结（与档期无关）', manual.kind === 'weekly-review' && manual.pushed > 0, JSON.stringify(manual))

globalThis.fetch = originalFetch
rmSync(base, { recursive: true, force: true })
rmSync(base2, { recursive: true, force: true })
rmSync(base3, { recursive: true, force: true })

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
