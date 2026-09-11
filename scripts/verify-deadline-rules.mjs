/**
 * Standalone verification of the 法定期限规则表 (0.2.11).
 *
 * 覆盖：
 *  1. 规则匹配：劳动仲裁非终局裁决 → 起诉期（15 日）；终局裁决未定性 → 歧义；
 *     终局 + 用人单位 → 30 日申请撤裁。
 *  2. 派生计算：起算日 + 期间 + 末日顺延（民诉法 §85），trace 可读。
 *  3. 登记三件套：关键日程（带 ruleId/cite/computeTrace）+ 触发事由日程 +
 *     提前量任务链（T-10/T-7/T-5/T-3，动作截止日避周末），且幂等。
 *  4. 体检：术语按程序轨（劳动仲裁不再误判）+ 同时检查时间轴日程。
 *  5. 接口修复：eventKind 归类；推送窗口纳入逾期任务、排除过期日程。
 *
 * Run: node scripts/verify-deadline-rules.mjs
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCaseStore } from '../lib/domains/litigation/store/index.js'
import { createItemStore } from '../lib/domains/item/store/item-store.js'
import { applyPeriodRegistration, planPeriodRegistration } from '../lib/domains/litigation/period-service.js'
import {
  PERIOD_RULES, derivePeriod, matchPeriodRules, previousWorkday,
} from '../lib/shared/playbook/period-rules.js'
import { computeCaseHealth } from '../lib/domains/litigation/health.js'
import { eventKind } from '../lib/domains/litigation/deadlines.js'
import { selectPushRows } from '../lib/domains/push/push.js'
import { LEAD_TIME_RULES } from '../lib/shared/playbook/litigation.js'

let failures = 0
function check(name, cond, extra = '') {
  const ok = Boolean(cond)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
  if (!ok) failures++
}

const dataDir = await mkdtemp(join(tmpdir(), 'ls-periods-'))
try {
  const caseStore = createCaseStore(dataDir)
  const itemStore = createItemStore(dataDir, undefined)

  /* ══════════════ 1. 规则匹配 ══════════════ */
  console.log('\n-- 规则匹配 --')
  const labor = matchPeriodRules({
    procedure: '劳动仲裁', doc: '仲裁裁决书', fact: '送达', date: '2026-09-11',
    docKind: '非终局裁决', caseType: '劳动争议',
  })
  check('劳动仲裁·非终局裁决 → 唯一命中起诉期规则',
    labor.length === 1 && labor[0].rule.id === 'labor_arbitration.claim_against_award',
    labor.map((c) => c.rule.id).join(','))

  const ambiguous = matchPeriodRules({
    procedure: '劳动仲裁', doc: '仲裁裁决书', fact: '送达', date: '2026-09-11',
    docKind: '终局裁决', caseType: '劳动争议',
  })
  const topSpec = ambiguous.length > 0 ? ambiguous[0].specificity : 0
  check('终局裁决未定性 → 出现并列候选（不得擅自择一）',
    ambiguous.filter((c) => c.specificity === topSpec).length === 2,
    ambiguous.map((c) => c.rule.id).join(','))

  const revoke = matchPeriodRules({
    procedure: '劳动仲裁', doc: '仲裁裁决书', fact: '送达', date: '2026-09-11',
    docKind: '终局裁决', clientRole: '用人单位', caseType: '劳动争议',
  })
  check('终局裁决 + 用人单位 → 30 日申请撤裁（§49）',
    revoke.length === 1 && revoke[0].rule.id === 'labor_arbitration.revoke_final_award_employer',
    revoke.map((c) => c.rule.id).join(','))

  /* ══════════════ 2. 派生计算 ══════════════ */
  console.log('\n-- 派生计算（2026-002 案：送达 2026-09-11）--')
  const rule15 = PERIOD_RULES.find((r) => r.id === 'labor_arbitration.claim_against_award')
  const d15 = derivePeriod(rule15, '2026-09-11')
  check('15 日起诉期：自然届满 2026-09-26（周六）', d15.naturalDueDate === '2026-09-26', d15.naturalDueDate)
  check('末日顺延 → 2026-09-28（周一）', d15.dueDate === '2026-09-28', d15.dueDate)
  check('术语 = 起诉期届满（非「上诉期」）', d15.term === '起诉期届满', d15.term)
  check('法律依据 = 劳动争议调解仲裁法 §50', d15.cite.includes('§50'), d15.cite)
  check('computeTrace 说明顺延原因', d15.computeTrace.includes('顺延') && d15.computeTrace.includes('2026-09-26'), d15.computeTrace)

  const ruleRevoke = PERIOD_RULES.find((r) => r.id === 'labor_arbitration.revoke_final_award_employer')
  check('30 日撤裁期：2026-10-11（周日）→ 顺延 2026-10-12',
    derivePeriod(ruleRevoke, '2026-09-11').dueDate === '2026-10-12',
    derivePeriod(ruleRevoke, '2026-09-11').dueDate)

  const ruleJudgment = PERIOD_RULES.find((r) => r.id === 'civil_first_instance.appeal_judgment')
  check('一审判决上诉期 = 15 日（§171）',
    derivePeriod(ruleJudgment, '2026-09-11').dueDate === '2026-09-28' && ruleJudgment.cite.includes('§171'),
    derivePeriod(ruleJudgment, '2026-09-11').dueDate)

  const ruleRuling = PERIOD_RULES.find((r) => r.id === 'civil_first_instance.appeal_ruling')
  check('一审裁定上诉期 = 10 日 → 2026-09-21',
    derivePeriod(ruleRuling, '2026-09-11').dueDate === '2026-09-21',
    derivePeriod(ruleRuling, '2026-09-11').dueDate)

  const ruleEnforce = PERIOD_RULES.find((r) => r.id === 'enforcement.apply')
  check('申请执行期间 = 2 年（§250）',
    ruleEnforce.period.years === 2 && ruleEnforce.cite.includes('§250'),
    `${JSON.stringify(ruleEnforce.period)} ${ruleEnforce.cite}`)

  check('提前量动作日避周末（09-26 周六 → 09-25）',
    previousWorkday('2026-09-26').date === '2026-09-25',
    previousWorkday('2026-09-26').date)

  /* ══════════════ 3. 登记三件套 + 幂等 ══════════════ */
  console.log('\n-- 登记三件套（applyPeriodRegistration）--')
  const c1 = await caseStore.registerCase({
    name: '高歌与龙视天下传媒劳动仲裁', type: '劳动争议', cause: '劳动争议',
    level: '劳动仲裁', status: 'post_trial', ourSide: 'respondent',
  })
  const caseId = c1.caseId

  const preview = await planPeriodRegistration(caseStore, caseId, { doc: '仲裁裁决书', date: '2026-09-11', docKind: '非终局裁决' })
  const keyBefore = (await caseStore.readCase(caseId)).keyDates ?? []
  check('derive 只读预览不落库', preview.matched.dueDate === '2026-09-28' && keyBefore.length === 0, `keyDates=${keyBefore.length}`)

  const applied = await applyPeriodRegistration(caseStore, caseId, { doc: '仲裁裁决书', date: '2026-09-11', docKind: '非终局裁决' }, itemStore)
  const rec = await caseStore.readCase(caseId)
  const kd = (rec.keyDates ?? []).find((k) => k.ruleId === 'labor_arbitration.claim_against_award')
  check('关键日程：起诉期届满 2026-09-28', kd !== undefined && kd.label === '起诉期届满' && kd.date === '2026-09-28', JSON.stringify(kd))
  check('关键日程带审计字段 ruleId/baseDate/cite/computeTrace',
    kd.ruleId === 'labor_arbitration.claim_against_award' && kd.baseDate === '2026-09-11' &&
    kd.cite.includes('§50') && typeof kd.computeTrace === 'string' && kd.computeTrace.length > 0,
    `${kd.cite} | ${kd.computeTrace}`)

  const items = await itemStore.listItems(caseId)
  const serviceEvent = items.find((it) => it.title === '裁判文书送达')
  check('时间轴日程：裁判文书送达 2026-09-11（done）',
    serviceEvent !== undefined && serviceEvent.date === '2026-09-11' && serviceEvent.status === 'done' && serviceEvent.kind === 'service',
    JSON.stringify(serviceEvent && { date: serviceEvent.date, status: serviceEvent.status, kind: serviceEvent.kind }))

  const chain = items.filter((it) => it.type === 'task').sort((a, b) => String(a.date).localeCompare(String(b.date)))
  const expectedChain = [
    ['领取并研读仲裁裁决书，评估起诉可行性', '2026-09-18'],
    ['取得当事人书面起诉确认', '2026-09-21'],
    ['完成起诉状起草与内部复核', '2026-09-23'],
    ['递交起诉状并办理立案', '2026-09-25'],
  ]
  check('提前量任务链 4 条，deadline 按 T-10/T-7/T-5/T-3 且避周末',
    chain.length === 4 && expectedChain.every(([t, d], i) => chain[i].title === t && chain[i].date === d),
    chain.map((t) => `${t.date} ${t.title}`).join(' | '))
  check('任务链挂在以规范术语命名的任务组下',
    chain.length > 0 && chain[0].groupName === '起诉期届满', chain[0] && chain[0].groupName)

  // 幂等：再跑一次不应新增任何东西。
  const applied2 = await applyPeriodRegistration(caseStore, caseId, { doc: '仲裁裁决书', date: '2026-09-11', docKind: '非终局裁决' }, itemStore)
  const rec2 = await caseStore.readCase(caseId)
  const items2 = await itemStore.listItems(caseId)
  check('幂等：关键日程不重复（ruleId+baseDate 更新）',
    (rec2.keyDates ?? []).filter((k) => k.ruleId === 'labor_arbitration.claim_against_award').length === 1,
    `keyDates=${(rec2.keyDates ?? []).length}`)
  check('幂等：事件与任务不重复',
    items2.filter((it) => it.title === '裁判文书送达').length === 1 &&
    items2.filter((it) => it.type === 'task').length === 4,
    `events=${items2.filter((it) => it.title === '裁判文书送达').length} tasks=${items2.filter((it) => it.type === 'task').length}`)
  check('幂等：第二次运行 taskIds 为空', applied2.applied.taskIds.length === 0, JSON.stringify(applied2.applied))

  // 歧义不落库
  const c2 = await caseStore.registerCase({ name: '终局裁决测试案', type: '劳动争议', level: '劳动仲裁', status: 'post_trial' })
  const ambiguousApply = await applyPeriodRegistration(caseStore, c2.caseId, { doc: '仲裁裁决书', date: '2026-09-11', docKind: '终局裁决' }, itemStore)
  const rec3 = await caseStore.readCase(c2.caseId)
  check('歧义（终局未定性）→ 不落库', ambiguousApply.ambiguous === true && (rec3.keyDates ?? []).length === 0, JSON.stringify(ambiguousApply.applied))

  // 规则未命中 → 不落库
  const unmatched = await applyPeriodRegistration(caseStore, c2.caseId, { doc: '外星文书', date: '2026-09-11' }, itemStore)
  check('规则未命中 → 不落库且给出「勿自行推算」提示',
    unmatched.matched === undefined && unmatched.skipped.some((n) => n.includes('未命中')),
    unmatched.skipped.join(' / '))

  /* ══════════════ 4. 体检（缺陷 A / B） ══════════════ */
  console.log('\n-- 体检口径 --')
  const c3 = await caseStore.registerCase({
    name: '仅登送达日的劳动仲裁案', type: '劳动争议', level: '劳动仲裁', status: 'post_trial',
  })
  await caseStore.addKeyDate(c3.caseId, '裁判文书送达', '2026-09-11')
  const recOnlyServed = await caseStore.readCase(c3.caseId)
  const healthIncomplete = await computeCaseHealth(recOnlyServed, { events: [] })
  check('只登「裁判文书送达」→ 扣分并给出期限缺口（旧版给满分）',
    healthIncomplete.completeness.score < 100 &&
    healthIncomplete.completeness.gaps.some((g) => g.field === 'keyDate:裁判文书送达'),
    `score=${healthIncomplete.completeness.score} gaps=${healthIncomplete.completeness.gaps.map((g) => g.field).join(',')}`)

  // 劳动仲裁案登记正确术语 → 不缺；体检术语按程序轨（不再要求「上诉期届满」）
  await caseStore.addKeyDate(c3.caseId, '起诉期届满', '2026-09-28', {
    ruleId: 'labor_arbitration.claim_against_award', baseDate: '2026-09-11', cite: '劳动争议调解仲裁法 §50',
  })
  const recFull = await caseStore.readCase(c3.caseId)
  const healthFull = await computeCaseHealth(recFull, { events: [] })
  check('登记规范术语「起诉期届满」→ 该项不缺（诉讼中心词表已修）',
    !healthFull.completeness.gaps.some((g) => g.field === 'keyDate:裁判文书送达'),
    `gaps=${healthFull.completeness.gaps.map((g) => g.field).join(',')}`)

  // 期限只登在时间轴上（未登关键日期）也算登记 —— 工具描述要求的做法
  const c4 = await caseStore.registerCase({
    name: '期限只登时间轴的案', type: '民商', level: '一审', status: 'appeal_window',
  })
  const recC4 = await caseStore.readCase(c4.caseId)
  const healthByEvent = await computeCaseHealth(recC4, {
    events: [
      { ownerId: c4.caseId, type: 'event', title: '裁判文书送达', date: '2026-09-11' },
      { ownerId: c4.caseId, type: 'event', title: '上诉期届满', date: '2026-09-28' },
    ],
  })
  check('期限登记在时间轴日程上同样算数（只查关键日期的旧缺陷已修）',
    !healthByEvent.completeness.gaps.some((g) => g.field === 'keyDate:裁判文书送达'),
    `gaps=${healthByEvent.completeness.gaps.map((g) => g.field).join(',')}`)

  // 届满日推算不符 → 报缺口
  const c5 = await caseStore.registerCase({ name: '届满日写错的案', type: '劳动争议', level: '劳动仲裁', status: 'post_trial' })
  await caseStore.addKeyDate(c5.caseId, '裁判文书送达', '2026-09-11')
  await caseStore.addKeyDate(c5.caseId, '起诉期届满', '2026-10-20', {
    ruleId: 'labor_arbitration.claim_against_award', baseDate: '2026-09-11', cite: '劳动争议调解仲裁法 §50',
  })
  const recC5 = await caseStore.readCase(c5.caseId)
  const healthWrongDate = await computeCaseHealth(recC5, { events: [] })
  check('届满日与「送达日+期间+顺延」不符 → 报缺口',
    healthWrongDate.completeness.gaps.some((g) => g.field === 'keyDate:裁判文书送达'),
    `gaps=${healthWrongDate.completeness.gaps.map((g) => g.field).join(',')}`)

  /* ══════════════ 5. 接口修复（Bug 2 / 推送窗口） ══════════════ */
  console.log('\n-- 接口与推送 --')
  check("eventKind('appeal_deadline') = deadline（不再落成 hearing）", eventKind('appeal_deadline') === 'deadline', eventKind('appeal_deadline'))
  check("eventKind('service') = hearing（送达是程序节点）", eventKind('service') === 'hearing', eventKind('service'))

  const today = (off) => {
    const d = new Date(); d.setDate(d.getDate() + off)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  const rows = [
    { caseId: 'a', caseName: 'a', date: today(-3), label: '逾期任务', kind: 'task', daysLeft: -3, urgent: false, overdue: true, source: 'task' },
    { caseId: 'b', caseName: 'b', date: today(-3), label: '过期日程', kind: 'hearing', daysLeft: -3, urgent: false, overdue: true, source: 'event' },
    { caseId: 'c', caseName: 'c', date: today(1), label: '明日开庭', kind: 'hearing', daysLeft: 1, urgent: true, overdue: false, source: 'event' },
    { caseId: 'd', caseName: 'd', date: today(9), label: '远期任务', kind: 'task', daysLeft: 9, urgent: false, overdue: false, source: 'task' },
  ]
  const selected = selectPushRows(rows).map((r) => r.label)
  check('推送窗口纳入逾期任务', selected.includes('逾期任务'), selected.join(','))
  check('推送窗口排除过期日程（日程不搞逾期）', !selected.includes('过期日程'), selected.join(','))
  check('推送窗口维持今日/明日', selected.includes('明日开庭') && !selected.includes('远期任务'), selected.join(','))

  /* ══════════════ 6. 锚点链完整性 ══════════════ */
  console.log('\n-- 提前量锚点链 --')
  const anchors = new Set(LEAD_TIME_RULES.map((r) => r.anchor))
  check('新增「起诉期届满」锚点链（2026-002 暴露的缺口）', anchors.has('起诉期届满'))
  check('新增「答辩期届满」锚点链', anchors.has('答辩期届满'))
  const ruleAnchors = PERIOD_RULES.filter((r) => r.anchor !== undefined).map((r) => r.anchor)
  check('规则引用的锚点在 LEAD_TIME_RULES 中都有实现',
    ruleAnchors.every((a) => anchors.has(a)),
    ruleAnchors.filter((a) => !anchors.has(a)).join(',') || 'all ok')
} finally {
  await rm(dataDir, { recursive: true, force: true })
}

console.log(`\n${failures === 0 ? '✅ ALL PASS' : `❌ ${failures} FAILED`}`)
process.exit(failures === 0 ? 0 : 1)
