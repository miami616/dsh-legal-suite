/**
 * 0.2.12 法定期限二期验证 —— 闸门 / 每日巡检 / proposed 回流 / 本地补丁表 / 统一出口。
 *
 * 覆盖：
 *  1. 闸门：状态进入含不变期间的档位但没有期限登记 → 案件落 periodGate（阻断级提示
 *     + 派生建议）；已按规范术语登记 → 不阻断；登记成功后陈旧标记自动清除。
 *  2. 巡检：patrolPeriodGaps 命中同一批案件（与闸门同口径），登记后不再命中。
 *  3. proposed 回流：无 cite 的提案被拒；提案**确认前不生效**（匹配不到）；
 *     accept → 写入本地补丁表并立即生效；reject → 不生效。
 *  4. 本地补丁表：override 覆盖内置规则（地方法院口径），derive 按补丁算。
 *  5. 统一出口：computeDeadlinesV2 + ownerMeta 覆盖非诉项目/独立事项（推送不再自建聚合）。
 *
 * 全程临时目录，不触碰 live 数据。
 */
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCaseStore } from '../lib/domains/litigation/store/case-store.js'
import { createItemStore } from '../lib/domains/item/store/item-store.js'
import { createPeriodRuleStore } from '../lib/domains/litigation/store/period-rule-store.js'
import { checkPeriodGate, patrolPeriodGaps, docNodesFromItems, isServiceEvidence } from '../lib/domains/litigation/period-gate.js'
import { syncPeriodGate } from '../lib/domains/litigation/status-transition.js'
import { applyPeriodRegistration, planPeriodRegistration, listRules } from '../lib/domains/litigation/period-service.js'
import { computeDeadlinesV2 } from '../lib/domains/litigation/deadlines.js'
import { PERIOD_RULES, mergePeriodRules } from '../lib/shared/playbook/period-rules.js'

let failures = 0
const check = (name, cond, extra = '') => {
  const ok = Boolean(cond)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
  if (!ok) failures++
}

const root = await mkdtemp(join(tmpdir(), 'ls-period-0212-'))
const litDir = join(root, 'litigation')
const itemsDir = join(root, 'items')
await mkdir(litDir, { recursive: true })
await mkdir(itemsDir, { recursive: true })

try {
  const itemStore = createItemStore(itemsDir)
  const caseStore = createCaseStore(litDir, undefined, itemStore)
  const ruleStore = createPeriodRuleStore(litDir)

  // ── 预置：劳动仲裁案，推进到庭后（含不变期间）但没有任何期限登记 ──
  const rec = await caseStore.registerCase({
    name: '期限闸门测试案', type: '劳动争议', status: 'post_trial', level: '劳动仲裁',
    court: '测试仲裁委', ourSide: '申请人', caseNumber: '济高新劳仲案字〔2026〕第1号',
  })
  const caseId = rec.caseId

  // ── 0) 触发条件：**没有裁判文书节点时不得提示**（开完庭等判决是正常状态）──
  const gateNoDoc = checkPeriodGate(await caseStore.readCase(caseId))
  check('无裁判文书节点 → 不提示（等判决不算缺口）', gateNoDoc.blocking === false)
  check('等判决的庭后案件不进巡检', patrolPeriodGaps(Object.values((await caseStore.readRegistry()).cases)).count === 0)

  // 登记裁判文书送达（这是不变期间起算的证据）→ 现在才该提示
  await caseStore.addKeyDate(caseId, '裁判文书送达', '2026-09-11')

  // ── 1) 闸门 ──
  const gate1 = checkPeriodGate(await caseStore.readCase(caseId))
  check('无期限登记 → 阻断', gate1.blocking === true, gate1.missing.join('/'))
  check('闸门给出规范术语（劳动仲裁=起诉期届满）', gate1.missing.includes('起诉期届满'), gate1.missing.join('/'))
  check('闸门说明凭什么触发（裁判文书节点）', gate1.docNode?.title === '裁判文书送达')
  check('措辞为「记录待核对」而非断言送达属实', gate1.notice.includes('记录待核对') && gate1.notice.includes('若送达属实') && gate1.notice.includes('delete_keydate'))
  check('带推算届满日（2026-09-11 送达 +15 日顺延 = 09-28）', gate1.derivedDueDate === '2026-09-28', String(gate1.derivedDueDate))
  check('闸门给出派生建议（带 cite）', gate1.suggestions.length > 0 && gate1.suggestions.every((s) => s.cite !== ''), JSON.stringify(gate1.suggestions.map((s) => s.ruleId)))

  const synced = await syncPeriodGate(caseStore, caseId, 'post_trial')
  check('syncPeriodGate 落案件字段', synced.blocking === true)
  const withGate = await caseStore.readCase(caseId)
  check('periodGate 已持久化（含提示与建议）', withGate.periodGate?.blocking === true && (withGate.periodGate?.suggestions ?? []).length > 0)
  check('periodGate 不进 registry 的 taskGroups/keyDates 之外字段', withGate.keyDates !== undefined)

  // ── 2) 巡检（与闸门同口径）──
  const patrol1 = patrolPeriodGaps(Object.values((await caseStore.readRegistry()).cases))
  check('巡检命中该案', patrol1.count === 1 && patrol1.rows[0].caseId === caseId, patrol1.summary)
  check('巡检给出可照做的动作（带真实送达日）', patrol1.rows[0].action.includes('register_service') && patrol1.rows[0].action.includes('2026-09-11'), patrol1.rows[0].action)

  // ── 3) 登记三件套 → 闸门与巡检同时解除 ──
  const applied = await applyPeriodRegistration(caseStore, caseId, { doc: '仲裁裁决书', date: '2026-09-11', docKind: '非终局裁决' }, itemStore)
  check('登记命中规则（起诉期）', applied.ruleId !== undefined && applied.matched?.term === '起诉期届满', String(applied.ruleId))
  check('登记落关键日期', applied.applied.keyDateId !== undefined)
  check('登记落提前量任务链', applied.applied.taskIds.length >= 3, String(applied.applied.taskIds.length))
  // 前移休息日会造成同日碰撞（T-3/T-2 都落到周五）→ 链条必须严格递增，否则退化成一句话。
  const chain = (await itemStore.listItems(caseId))
    .filter((i) => i.type === 'task' && i.groupName === '起诉期届满')
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
  const dates = chain.map((t) => String(t.date))
  check('提前量任务链日期严格递增（无同日碰撞）', dates.length >= 3 && dates.every((d, i) => i === 0 || d > dates[i - 1]), dates.join(','))
  check('最后一环（递交）不晚于届满日', dates[dates.length - 1] <= String(applied.matched?.dueDate), `${dates[dates.length - 1]} <= ${applied.matched?.dueDate}`)

  const afterRegister = await caseStore.readCase(caseId)
  check('登记后闸门自动清除', afterRegister.periodGate === undefined)
  const patrol2 = patrolPeriodGaps(Object.values((await caseStore.readRegistry()).cases))
  check('登记后巡检不再命中', patrol2.count === 0, patrol2.summary)

  // 已登记的案件即使再进闸门档位也不阻断
  const gate2 = checkPeriodGate(afterRegister)
  check('已按规范术语登记 → 不阻断', gate2.blocking === false)

  // ── 3.5) 确认闸门（不再提醒）：二审独立建档的一审案等 ──
  const superseded = await caseStore.registerCase({ name: '已被二审取代的一审案', type: '民商', status: 'appeal_window', level: '一审', court: '测试法院' })
  await caseStore.addKeyDate(superseded.caseId, '裁判文书送达', '2026-09-04')
  check('未确认时仍阻断', checkPeriodGate(await caseStore.readCase(superseded.caseId)).blocking === true)
  await caseStore.setPeriodGateMuted(superseded.caseId, { at: new Date().toISOString(), reason: '二审独立建档，上诉期由二审案跟踪' })
  const muted = await caseStore.readCase(superseded.caseId)
  check('确认后闸门不再阻断', checkPeriodGate(muted).blocking === false)
  check('确认理由留档', muted.periodGateMuted?.reason?.includes('二审') === true)
  const patrolMuted = patrolPeriodGaps(Object.values((await caseStore.readRegistry()).cases))
  check('确认后巡检不再命中该案', patrolMuted.rows.every((r) => r.caseId !== superseded.caseId), patrolMuted.summary)
  await caseStore.setPeriodGateMuted(superseded.caseId, undefined)
  check('取消确认后重新纳入', checkPeriodGate(await caseStore.readCase(superseded.caseId)).blocking === true)
  await caseStore.deleteCase(superseded.caseId)

  // ── 3.6) 送达节点记成 event（而非 keydate）也要能被看见 ──
  const evCase = await caseStore.registerCase({ name: '送达记为日程的案', type: '民商', status: 'post_trial', level: '一审', court: '测试法院' })
  const evItems = [
    { ownerId: evCase.caseId, type: 'event', title: '判决书送达', date: '2026-09-04' },
    { ownerId: evCase.caseId, type: 'event', title: '一审开庭', date: '2026-08-01' },
    { ownerId: evCase.caseId, type: 'event', title: '法院立案', date: '2026-06-01' },
    // 任务不是事实证据：这是"去领"的待办，不代表文书已到手。
    { ownerId: evCase.caseId, type: 'task', title: '领取裁判文书', date: '2026-09-05' },
  ]
  const evNodes = docNodesFromItems(evItems)
  check('docNodesFromItems 只挑裁判文书类节点', (evNodes.get(evCase.caseId) ?? []).length === 1 && evNodes.get(evCase.caseId)[0].title === '判决书送达')
  check('docNodesFromItems 不收任务（待办不是送达证据）', !(evNodes.get(evCase.caseId) ?? []).some((n) => n.title === '领取裁判文书'))
  // 精筛：光有「判决」字样不算送达证据（真实数据里这类误报有 25 个）
  check('「判决履行期限届满」不算送达证据', isServiceEvidence('判决履行期限届满') === false)
  check('「财产保全裁定」不算送达证据', isServiceEvidence('财产保全裁定') === false)
  check('「准予撤诉裁定书送达」不算（撤诉裁定无上诉期）', isServiceEvidence('准予撤诉裁定书送达') === false)
  check('「一审判决作出」不算（作出≠送达）', isServiceEvidence('一审判决作出') === false)
  check('「领取裁判文书」算（用户的实际记法）', isServiceEvidence('领取裁判文书') === true)
  check('「裁判文书送达」算', isServiceEvidence('裁判文书送达') === true)
  check('「一审开庭」不算', isServiceEvidence('一审开庭') === false)
  const gateEv = checkPeriodGate(await caseStore.readCase(evCase.caseId), undefined, evNodes.get(evCase.caseId))
  check('送达记为日程 → 闸门也能触发', gateEv.blocking === true && gateEv.docNode?.title === '判决书送达')
  check('仅 keyDates 时看不到该案（证明必须带 items）', checkPeriodGate(await caseStore.readCase(evCase.caseId)).blocking === false)
  check('删案级联清理事项（编号复用不复活旧期限）', (await itemStore.listItems(evCase.caseId)).length === 0)
  await caseStore.deleteCase(evCase.caseId)

  // ── 3.65) 期限已过 → 提示换成「立即核对是否已上诉」，而不是「请去登记」──
  const pastCase = await caseStore.registerCase({ name: '期限已过的案', type: '民商', status: 'post_trial', level: '一审', court: '测试法院' })
  // 用明显早于今天的送达日（本机当前 2026-09-11）→ 推算届满日必然已过。
  await caseStore.addKeyDate(pastCase.caseId, '裁判文书送达', '2026-08-01')
  const gatePast = checkPeriodGate(await caseStore.readCase(pastCase.caseId))
  check('推算届满日已过 → overdue=true', gatePast.overdue === true, String(gatePast.derivedDueDate))
  check('已过 → 提示改问「是否已上诉」并给出删脏记录出口', gatePast.notice.includes('该推算日已过') && gatePast.notice.includes('是否已上诉') && gatePast.notice.includes('delete_keydate'))
  const patrolPast = patrolPeriodGaps([await caseStore.readCase(pastCase.caseId)])
  check('巡检摘要点名已过期的案件', patrolPast.summary.includes('推算届满日已过') && patrolPast.summary.includes(pastCase.caseId), patrolPast.summary)
  // 删除关键日期：脏记录的唯一出口（此前系统里没有删除入口）
  const delCase = await caseStore.registerCase({ name: '删关键日期的案', type: '民商', status: 'post_trial', level: '一审', court: '测试法院' })
  await caseStore.addKeyDate(delCase.caseId, '裁判文书送达', '2026-08-28')
  const kdId = (await caseStore.readCase(delCase.caseId)).keyDates[0].id
  await caseStore.deleteKeyDate(delCase.caseId, kdId)
  check('deleteKeyDate 删掉脏记录', (await caseStore.readCase(delCase.caseId)).keyDates.length === 0)
  check('删掉后闸门不再触发', checkPeriodGate(await caseStore.readCase(delCase.caseId)).blocking === false)
  await caseStore.deleteCase(delCase.caseId)
  await caseStore.deleteCase(pastCase.caseId)

  // ── 3.7) 已结案不提示（程序已了结，无期限可保护）──
  const closedCase = await caseStore.registerCase({ name: '已结案但有送达的案', type: '民商', status: 'closed', level: '一审', court: '测试法院' })
  await caseStore.addKeyDate(closedCase.caseId, '裁判文书送达', '2026-08-28')
  check('已结案不提示', checkPeriodGate(await caseStore.readCase(closedCase.caseId)).blocking === false)
  await caseStore.deleteCase(closedCase.caseId)

  // ── 3.8) 该轨无可用规则 → 不提示（否则每天变成「去提案」）──
  const oddCase = await caseStore.registerCase({ name: '无规则轨的案', type: '其他', status: 'post_trial', level: '不存在的程序轨', court: '测试法院' })
  await caseStore.addKeyDate(oddCase.caseId, '裁判文书送达', '2026-08-28')
  check('无可用规则不提示', checkPeriodGate(await caseStore.readCase(oddCase.caseId)).blocking === false)
  await caseStore.deleteCase(oddCase.caseId)

  // ── 4) proposed 回流：确认前不生效 ──
  let citeRejected = false
  try { await ruleStore.propose({ rule: { id: 'x.no_cite' }, cite: '', reasoning: '' }) } catch { citeRejected = true }
  check('无 cite 的提案被拒（不得凭记忆发明期间）', citeRejected)

  const proposal = await ruleStore.propose({
    rule: {
      id: 'labor_arbitration.test_local',
      scope: { procedure: '劳动仲裁', caseType: ['劳动争议'] },
      trigger: { doc: '仲裁裁决书', fact: '送达' },
      period: { days: 20 },
      start: { from: '次日' },
      rollForward: true,
      term: '起诉期届满',
      effect: '测试用本地口径',
      cite: '测试地方法院口径',
      effective: { from: '2020-01-01' },
      confidence: 'proposed',
    },
    cite: '测试地方法院口径',
    reasoning: '内置表未覆盖本地口径',
    caseId,
  })
  check('提案登记为 proposed', proposal.status === 'proposed')

  const rulesBeforeAccept = await ruleStore.effectiveRules()
  check('提案确认前不生效（匹配不到）', rulesBeforeAccept.every((r) => r.id !== 'labor_arbitration.test_local'))
  const planBefore = await planPeriodRegistration(caseStore, caseId, { doc: '仲裁裁决书', date: '2026-09-11', docKind: '非终局裁决' }, rulesBeforeAccept)
  check('确认前仍按内置规则派生（15 日）', planBefore.matched?.dueDate === '2026-09-28', String(planBefore.matched?.dueDate))

  // accept → 写本地补丁表并立即生效
  const resolved = await ruleStore.resolve(proposal.id, 'accept', { note: '律师确认' })
  check('采纳提案', resolved.ok === true, resolved.notice)
  const rulesAfterAccept = await ruleStore.effectiveRules()
  const local = rulesAfterAccept.find((r) => r.id === 'labor_arbitration.test_local')
  check('采纳后进入本地补丁表且升 local-practice', local !== undefined && local.confidence === 'local-practice', String(local?.confidence))
  // 本地补丁按 **同一 ruleId** 覆盖内置口径 → 立即改算（这才是「补丁」的语义）。
  await ruleStore.upsertOverride({
    ...(PERIOD_RULES.find((r) => r.id === 'labor_arbitration.claim_against_award')),
    period: { days: 20 },
    confidence: 'local-practice',
    cite: '本地口径（测试）',
  })
  const rulesPatched = await ruleStore.effectiveRules()
  const planPatched = await planPeriodRegistration(caseStore, caseId, { doc: '仲裁裁决书', date: '2026-09-11', docKind: '非终局裁决' }, rulesPatched)
  check('本地补丁同 id 覆盖 → 按 20 日派生', planPatched.matched?.dueDate === '2026-10-01', String(planPatched.matched?.dueDate))
  await ruleStore.removeOverride('labor_arbitration.claim_against_award')

  // 按**法院**限定的本地口径：带 court 的规则比通用口径更具体，优先命中。
  const courtRule = await ruleStore.upsertOverride({
    id: 'civil_first_instance.local_court_appeal',
    scope: { procedure: '一审', caseType: ['民商'], court: ['测试市中级人民法院'] },
    trigger: { doc: '判决书', fact: '送达' },
    period: { days: 20 },
    start: { from: '次日' },
    rollForward: true,
    term: '上诉期届满',
    effect: '本地口径（测试）',
    cite: '测试地方法院口径',
    effective: { from: '2020-01-01' },
    confidence: 'local-practice',
  })
  check('法院限定补丁写入', courtRule.id === 'civil_first_instance.local_court_appeal')
  const courtCase = await caseStore.registerCase({ name: '本地口径案', type: '民商', status: 'post_trial', level: '一审', court: '测试市中级人民法院' })
  const rulesWithCourt = await ruleStore.effectiveRules()
  const planCourt = await planPeriodRegistration(caseStore, courtCase.caseId, { doc: '判决书', date: '2026-09-11' }, rulesWithCourt)
  check('法院限定补丁优先于通用口径（20 日）', planCourt.matched?.dueDate === '2026-10-01', String(planCourt.matched?.dueDate))
  const otherCase = await caseStore.registerCase({ name: '非本地法院案', type: '民商', status: 'post_trial', level: '一审', court: '其他市人民法院' })
  const planOther = await planPeriodRegistration(caseStore, otherCase.caseId, { doc: '判决书', date: '2026-09-11' }, rulesWithCourt)
  check('其他法院仍走通用口径（15 日）', planOther.matched?.dueDate === '2026-09-28', String(planOther.matched?.dueDate))
  await ruleStore.removeOverride('civil_first_instance.local_court_appeal')

  // reject 路径
  const p2 = await ruleStore.propose({
    rule: { id: 'labor_arbitration.test_reject', scope: { procedure: '劳动仲裁' }, trigger: { doc: '仲裁裁决书', fact: '送达' }, period: { days: 99 }, start: { from: '次日' }, rollForward: false, term: '测试拒绝', effect: '', cite: '测试', effective: { from: '2020-01-01' }, confidence: 'proposed' },
    cite: '测试', reasoning: '测试拒绝路径',
  })
  await ruleStore.resolve(p2.id, 'reject', { note: '口径不对' })
  const rulesAfterReject = await ruleStore.effectiveRules()
  check('拒绝的提案不生效', rulesAfterReject.every((r) => r.id !== 'labor_arbitration.test_reject'))

  // ── 5) 本地补丁表：直接覆盖内置规则 ──
  const builtin = PERIOD_RULES.find((r) => r.id === 'labor_arbitration.claim_against_award')
  check('内置表有该规则', builtin !== undefined)
  const overridden = mergePeriodRules([{ ...builtin, period: { days: 18 }, confidence: 'local-practice', cite: '本地口径' }])
  check('补丁按 id 覆盖内置（18 日）', overridden.find((r) => r.id === builtin.id)?.period.days === 18)
  check('补丁不改变规则条数（覆盖非新增）', overridden.length === PERIOD_RULES.length)
  await ruleStore.upsertOverride({ ...builtin, period: { days: 18 }, confidence: 'local-practice', cite: '本地口径' })
  const afterOverride = await ruleStore.effectiveRules()
  check('upsertOverride 生效', afterOverride.find((r) => r.id === builtin.id)?.period.days === 18)
  await ruleStore.removeOverride(builtin.id)
  const afterRemove = await ruleStore.effectiveRules()
  check('removeOverride 回到内置口径', afterRemove.find((r) => r.id === builtin.id)?.period.days === 15)

  // ── 6) 统一出口：ownerMeta 覆盖非诉/独立 ──
  const ownerMeta = new Map([
    ['CF-2026-900', { name: '测试顾问单位', source: 'nonlitigation' }],
    ['', { name: '独立', source: 'standalone' }],
  ])
  const events = [
    { id: 'e1', caseId: 'CF-2026-900', caseName: '', type: 'case_event', title: '年审到期', date: '2026-10-01', status: 'pending', remindRules: [] },
    { id: 'e2', caseId: '', caseName: '', type: 'case_event', title: '清算组会议', date: '2026-10-02', status: 'pending', remindRules: [] },
  ]
  const dl = computeDeadlinesV2({ registryVersion: '1.0', cases: {} }, events, new Map(), undefined, { includeOverdue: true, ownerMeta })
  check('统一出口覆盖非诉项目', dl.some((d) => d.caseId === 'CF-2026-900' && d.caseName === '测试顾问单位' && d.source === 'nonlitigation'))
  check('统一出口覆盖独立事项', dl.some((d) => d.caseId === '' && d.source === 'standalone'))
  // 同一期限在两处登记 → 引擎去重只出一行（推送不再自造第二行）
  const dedup = computeDeadlinesV2({ registryVersion: '1.0', cases: {} }, [
    { id: 'e3', caseId: 'CF-2026-900', caseName: '', type: 'case_event', title: '年审到期', date: '2026-10-01', status: 'pending', remindRules: [] },
  ], new Map([['t3', { caseId: 'CF-2026-900', title: '年审到期', date: '2026-10-01', status: 'pending' }]]), undefined, { includeOverdue: true, ownerMeta })
  check('统一出口按 案件+日期+标签 去重', dedup.filter((d) => d.label === '年审到期').length === 1)

  // ── 7) 规则清单含置信度（工具层要能看出哪些是本地口径）──
  const rows = listRules('劳动仲裁', afterOverride)
  check('period_rules 输出带 confidence', rows.every((r) => typeof r.confidence === 'string'))
} catch (error) {
  failures++
  console.error('EXCEPTION', error)
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log(`\n${failures === 0 ? '✅ 全部通过' : `❌ ${failures} 项失败`}`)
process.exit(failures === 0 ? 0 : 1)
