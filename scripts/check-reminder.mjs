#!/usr/bin/env node
/**
 * 提醒计划引擎自测（纯函数，无网络、无文件写入）。
 *
 * 覆盖 0.2.25 智能提醒的核心口径：
 *  1. 期限性质分类（法定/保全/开庭/举证缴费/任务/普通日程）
 *  2. 提醒阶梯与补发窗口（T-30/15/7/3/2/1/0）
 *  3. 逾期只属于任务，日程过期即历史
 *  4. 分区、排序、逾期后果文案
 *  5. 精确到点提醒（开庭 2h/30m，其他 30m）
 *  6. 本地日期不受 UTC 影响（凌晨 0–8 点）
 */

import {
  classifyDeadline,
  consequenceOf,
  dateDiffDays,
  applyDigestCaps,
  groupEntries,
  intradayCandidates,
  ladderOf,
  localDate,
  overdueSlot,
  phaseLabelOf,
  reminderCandidates,
  selectDigestEntries,
  thresholdFor,
} from '../lib/domains/push/reminder-plan.js'

let pass = 0
let fail = 0
function check(name, cond, extra = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✗ ${name}${extra !== '' ? `  (${extra})` : ''}`)
  }
}

/** 固定「今天」= 2026-10-18 10:00（本地），保证日期断言可重复。 */
const NOW = new Date(2026, 9, 18, 10, 0, 0).getTime()

/** 相对今天的日期 YYYY-MM-DD。 */
function dayOffset(offset) {
  const d = new Date(2026, 9, 18)
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 构造 DeadlineItem。 */
function item(overrides = {}) {
  const date = overrides.date ?? dayOffset(overrides.daysLeft ?? 0)
  const daysLeft = dateDiffDays(localDate(NOW), date)
  return {
    caseId: '2026-099',
    caseName: '甲方与乙方买卖合同纠纷',
    date,
    label: '开庭',
    kind: 'hearing',
    time: undefined,
    detail: undefined,
    daysLeft,
    urgent: daysLeft >= 0 && daysLeft <= 7,
    overdue: daysLeft < 0,
    source: 'hearing',
    ...overrides,
  }
}

console.log('== 1. 期限性质分类 ==')
check('上诉期届满 → 法定不变期间', classifyDeadline(item({ label: '上诉期届满', kind: 'keydate' })) === 'statutory')
check('起诉期届满 → 法定不变期间', classifyDeadline(item({ label: '起诉期届满', kind: 'keydate' })) === 'statutory')
check('答辩期届满 → 法定不变期间', classifyDeadline(item({ label: '答辩期届满', kind: 'keydate' })) === 'statutory')
check('申请执行期限届满 → 长期间', classifyDeadline(item({ label: '申请执行期限届满', kind: 'keydate' })) === 'statutory_long')
check('再审申请期限届满 → 长期间', classifyDeadline(item({ label: '再审申请期限届满', kind: 'keydate' })) === 'statutory_long')
check('保全到期 → 保全', classifyDeadline(item({ label: '保全到期', kind: 'keydate' })) === 'preservation')
check('续封 → 保全', classifyDeadline(item({ label: '续封房产', kind: 'keydate' })) === 'preservation')
check('开庭 → 开庭', classifyDeadline(item({ label: '开庭' })) === 'hearing')
check('第一次开庭 → 开庭', classifyDeadline(item({ label: '第一次开庭' })) === 'hearing')
check('举证期限届满 → 程序期限', classifyDeadline(item({ label: '举证期限届满', kind: 'keydate' })) === 'procedural')
check('预交上诉费期限 → 程序期限', classifyDeadline(item({ label: '预交上诉费期限', kind: 'keydate' })) === 'procedural')
check('普通任务 → 任务', classifyDeadline(item({ label: '起草代理词', kind: 'task', source: 'task' })) === 'task')
check('「制作庭审提纲」任务不被当成开庭', classifyDeadline(item({ label: '制作庭审提纲', kind: 'task', source: 'task' })) === 'task')
check('「催问第二次开庭排期」任务不被当成开庭', classifyDeadline(item({ label: '催问第二次开庭排期', kind: 'task', source: 'task' })) === 'task')
check('任务「缴纳上诉费」按程序期限', classifyDeadline(item({ label: '缴纳上诉费', kind: 'task', source: 'task' })) === 'procedural')
check('普通会议（engine 桶为 hearing）→ 事实日程', classifyDeadline(item({ label: '普通会议', kind: 'hearing', source: 'case_event' })) === 'event')
check('裁判文书送达 → 事实日程', classifyDeadline(item({ label: '裁判文书送达', kind: 'hearing', source: 'service' })) === 'event')
check('ruleId 优先（claim_against）', classifyDeadline(item({ label: '自定义标题', kind: 'keydate', ruleId: 'labor_arbitration.claim_against_award' })) === 'statutory')
check('ruleId 优先（enforcement.apply）', classifyDeadline(item({ label: '自定义标题', kind: 'keydate', ruleId: 'enforcement.apply' })) === 'statutory_long')
check('「递交财产保全申请」是任务，不是保全到期', classifyDeadline(item({ label: '递交财产保全申请', kind: 'task', source: 'task' })) === 'task')
check('「申请强制执行」是任务，不是 2 年期间', classifyDeadline(item({ label: '申请强制执行', kind: 'keydate', source: 'keydate' })) === 'task')
check('「保全到期」仍是保全', classifyDeadline(item({ label: '保全到期', kind: 'keydate' })) === 'preservation')

console.log('== 2. 提醒阶梯与补发 ==')
const statutoryLadder = ladderOf('statutory', true)
check('法定阶梯含 T-30/T-15/T-7/T-3/T-2/T-1/D0', [30, 15, 7, 3, 2, 1, 0].every((n) => statutoryLadder.includes(n)))
check('关闭智能分级 → 仅 T-1/D0', ladderOf('statutory', false).join(',') === '1,0')
check('正好 T-15 → 命中且非补发', JSON.stringify(thresholdFor(15, statutoryLadder, 7)) === JSON.stringify({ threshold: 15, catchUp: false }))
check('T-14 → 补发 T-15', JSON.stringify(thresholdFor(14, statutoryLadder, 7)) === JSON.stringify({ threshold: 15, catchUp: true }))
check('T-7 → 命中 T-7', thresholdFor(7, statutoryLadder, 7)?.threshold === 7)
check('T-2 → 命中 T-2', thresholdFor(2, statutoryLadder, 7)?.threshold === 2)
check('T-0 → 命中 D0', thresholdFor(0, statutoryLadder, 7)?.threshold === 0)
check('T-40 超过最长档 → 不提醒', thresholdFor(40, statutoryLadder, 7) === undefined)
check('T-3 已错过 T-7 4 天 → 普通事项不补发', thresholdFor(3, [7, 3, 1, 0], 1)?.threshold === 3)
check('T-5 错过 T-7 2 天 → 普通事项不补发', thresholdFor(5, [7, 3, 1, 0], 1) === undefined)
check('T-6 错过 T-7 1 天 → 补发', thresholdFor(6, [7, 3, 1, 0], 1)?.catchUp === true)

console.log('== 3. 候选生成：日程不逾期、任务才逾期 ==')
const items = [
  item({ label: '上诉期届满', kind: 'keydate', daysLeft: 3 }),
  item({ label: '开庭', daysLeft: 1, time: '09:00' }),
  item({ label: '举证期限届满', kind: 'keydate', daysLeft: 0 }),
  item({ label: '起草代理词', kind: 'task', daysLeft: 7 }),
  item({ label: '普通会议', kind: 'hearing', source: 'case_event', daysLeft: 3 }),
  item({ label: '过期日程', daysLeft: -3 }),
  item({ label: '逾期任务', kind: 'task', daysLeft: -3 }),
]
const candidates = reminderCandidates(items, { smartLead: true, includeConsequence: true }, NOW)
const labels = candidates.map((entry) => entry.item.label)
check('上诉期（T-3）进入提醒', labels.includes('上诉期届满'))
check('明日开庭进入提醒', labels.includes('开庭'))
check('今日举证期限进入提醒', labels.includes('举证期限届满'))
check('T-7 任务进入提醒', labels.includes('起草代理词'))
check('普通日程 T-3 不进入提醒（阶梯 1/0）', !labels.includes('普通会议'))
check('过期日程不进入提醒（日程不搞逾期）', !labels.includes('过期日程'))
check('逾期任务进入提醒', labels.includes('逾期任务'))
const overdue = candidates.find((entry) => entry.item.label === '逾期任务')
check('逾期任务分区=overdue', overdue?.section === 'overdue')
check('逾期任务文案=已逾期 3 天', overdue?.phaseLabel === '已逾期 3 天')
check('逾期任务按升级档位去重', overdue?.key.endsWith('|OD|3') === true, overdue?.key)

console.log('== 3b. 逾期升级与精简密度 ==')
check('逾期档位：1/2/3 天逐日', overdueSlot(1) === 1 && overdueSlot(2) === 2 && overdueSlot(3) === 3)
check('逾期档位：4 天并入 7 天档', overdueSlot(4) === 7 && overdueSlot(7) === 7)
check('逾期档位：10 天并入 14 天档', overdueSlot(10) === 14)
check('逾期档位：20 天并入 30 天档', overdueSlot(20) === 30)
check('逾期档位：31 天进入 60 天档', overdueSlot(31) === 60)
const manyOverdue = [1, 2, 4, 5, 8].map((age, i) => item({ label: `旧任务${i}`, kind: 'task', source: 'task', daysLeft: -age }))
const densityEntries = reminderCandidates([
  ...manyOverdue,
  item({ label: '上诉期届满', kind: 'keydate', daysLeft: 15 }),
  item({ label: '开庭', daysLeft: 1, time: '09:00' }),
], { smartLead: true }, NOW)
const concise = selectDigestEntries(densityEntries, { density: 'concise', now: NOW })
check('精简：逾期只留前 3 天', concise.entries.filter((e) => e.section === 'overdue').length === 2, String(concise.entries.filter((e) => e.section === 'overdue').length))
check('精简：积压逾期计数', concise.suppressed.overdue === 3, String(concise.suppressed.overdue))
check('精简：T-15 非周一折叠', concise.entries.every((e) => e.item.label !== '上诉期届满') && concise.suppressed.ahead >= 1)
const mondayNow = new Date(2026, 9, 19, 10, 0).getTime() // 2026-10-19 是周一
const monday = selectDigestEntries(reminderCandidates([
  item({ label: '上诉期届满', kind: 'keydate', daysLeft: 15 }),
], { smartLead: true }, mondayNow), { density: 'concise', now: mondayNow })
check('精简：周一纳入 T-15 周计划', monday.entries.some((e) => e.item.label === '上诉期届满'))
const standard = selectDigestEntries(densityEntries, { density: 'standard', now: NOW })
check('标准：保留全部档位', standard.entries.length === densityEntries.length && standard.suppressed.overdue === 0)
const capped = applyDigestCaps(densityEntries.filter((e) => e.section === 'overdue'), { density: 'concise', maxRows: 8 })
check('展示限额：逾期分区最多 3 条', capped.entries.filter((e) => e.section === 'overdue').length === 3, String(capped.entries.length))
check('展示限额：其余计入折叠', capped.hidden === 2, String(capped.hidden))
const tenTomorrow = Array.from({ length: 10 }, (_, i) => item({ label: `明日事项${i}`, daysLeft: 1 }))
const tomorrowCap = applyDigestCaps(reminderCandidates(tenTomorrow, { smartLead: true }, NOW), { density: 'concise' })
check('精简：明日最多 6 条（未展示的次日会再出现）', tomorrowCap.entries.length === 6 && tomorrowCap.hidden === 4, `${tomorrowCap.entries.length}/${tomorrowCap.hidden}`)
const tenToday = Array.from({ length: 10 }, (_, i) => item({ label: `今日事项${i}`, kind: 'task', source: 'task', daysLeft: 0 }))
const todayCap = applyDigestCaps(reminderCandidates(tenToday, { smartLead: true }, NOW), { density: 'concise' })
check('精简：今日事项全部展示（不藏今天的事）', todayCap.entries.length === 10 && todayCap.hidden === 0, `${todayCap.entries.length}/${todayCap.hidden}`)

console.log('== 4. 分区、排序与后果 ==')
const groups = groupEntries(candidates)
const order = groups.map((g) => g.section)
check('分区顺序：逾期 → 今日必办 → 明日 → 提前', JSON.stringify(order) === JSON.stringify(['overdue', 'today_critical', 'tomorrow', 'ahead']), order.join(','))
const firstNonOverdue = candidates.find((entry) => entry.section !== 'overdue')
check('逾期之后第一条是硬期限（critical 优先于 high）', firstNonOverdue?.item.label === '上诉期届满', firstNonOverdue?.item.label)
check('法定期间后果文案', consequenceOf(item({ label: '上诉期届满' }), 'statutory')?.includes('丧失上诉权') === true)
check('举证期限后果文案', consequenceOf(item({ label: '举证期限届满' }), 'procedural')?.includes('不被采纳') === true)
check('保全后果文案', consequenceOf(item({ label: '保全到期' }), 'preservation')?.includes('解除') === true)
check('普通任务无后果文案', consequenceOf(item({ label: '起草代理词', kind: 'task' }), 'task') === undefined)
check('剩余标签：0/1/3/逾期', phaseLabelOf(0) === '今天' && phaseLabelOf(1) === '明天' && phaseLabelOf(3) === '还剩 3 天' && phaseLabelOf(-2) === '已逾期 2 天')
check('补发标签带（补）', phaseLabelOf(6, true) === '还剩 6 天（补）')

console.log('== 5. 精确到点提醒 ==')
const hearingAt = new Date(2026, 9, 18, 9, 0, 0).getTime()
const at = (h, m) => new Date(2026, 9, 18, h, m, 0).getTime()
const hearingItem = item({ label: '开庭', date: '2026-10-18', time: '09:00', daysLeft: 0 })
const leadAt = (ms) => intradayCandidates([hearingItem], { preciseReminder: true }, ms)[0]?.leadMinutes
check('07:00 → 命中 2 小时档', leadAt(at(7, 0)) === 120)
check('08:00 → 仍命中 2 小时档（补发）', leadAt(at(8, 0)) === 120)
check('08:35 → 命中 30 分钟档', leadAt(at(8, 35)) === 30)
check('09:01 → 不再提醒', leadAt(at(9, 1)) === undefined)
check('关闭精确提醒 → 空', intradayCandidates([hearingItem], { preciseReminder: false }, at(7, 0)).length === 0)
const taskAt = item({ label: '案件沟通会', kind: 'task', date: '2026-10-18', time: '15:00', daysLeft: 0 })
const taskLead = intradayCandidates([taskAt], { preciseReminder: true }, at(14, 40))[0]
check('普通带时间事项只提前 30 分钟', taskLead?.leadMinutes === 30)
check('精确提醒台账键含 IN', taskLead?.key.includes('|IN|30') === true)
check('精确提醒显示剩余分钟', taskLead?.phaseLabel === '还有 20 分钟')
check('开庭时间戳解析正确', hearingAt === at(9, 0))

console.log('== 6. 本地日期（UTC 陷阱） ==')
const earlyMorning = new Date(2026, 9, 18, 1, 30, 0).getTime()
check('凌晨 01:30 仍为当天（不因 UTC 退一天）', localDate(earlyMorning) === '2026-10-18')
check('日期差：今天→明天 = 1', dateDiffDays('2026-10-18', '2026-10-19') === 1)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
