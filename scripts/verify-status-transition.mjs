/**
 * Verify: 事件纪年补齐（建案打点 + 阶段模板事件骨架 + kind 透传）
 *        + 状态变更三态展开（confirm/agent/off + resolve 收尾）。
 *
 * Run: node scripts/verify-status-transition.mjs
 *
 * 覆盖：
 *  A1 建案打点「收案」（kind=engagement, status=done）+ 幂等 + kind→legacy 透传
 *  A2 阶段模板事件骨架：一审·庭前准备按 anchorDate 倒推（开庭=锚、举证=锚-5、答辩=锚-15）
 *  A3 事件落库为 items(type=event) + 重复展开幂等（events 为 0）
 *  B1 confirm：改状态挂 pendingExpand（不自动展开）→ resolve(expand) 落任务+事件并清除
 *  B2 ignore：仅清除标记不展开
 *  B3 agent：挂起 mode=agent，供管家自主处理
 *  B4 off：改状态不挂起
 *  B5 已展开判定：目标阶段已有任务 → 不重复挂起
 *  B6 已结案：清除任何挂起
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCaseStore } from '../lib/domains/litigation/store/index.js'
import { createItemStore } from '../lib/domains/item/store/item-store.js'
import { applyStageExpansion, planStageExpansion } from '../lib/domains/litigation/stage-expansion.js'
import { handleStatusTransition, resolvePendingExpand } from '../lib/domains/litigation/status-transition.js'
import { ensureCaseOpenEvent } from '../lib/domains/litigation/case-open.js'
import { itemToTimelineEvent } from '../lib/domains/item/shape.js'

let failures = 0
function check(name, cond, extra = '') {
  const ok = Boolean(cond)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
  if (!ok) failures++
}

const iso = (offset) => {
  const t = new Date(Date.now() + offset * 86400000)
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}

const dataDir = await mkdtemp(join(tmpdir(), 'ls-transition-'))
const itemsDir = join(dataDir, 'items')
try {
  const caseStore = createCaseStore(dataDir)
  const itemStore = createItemStore(itemsDir, undefined)

  /* ══════════════ A. 事件纪年 ══════════════ */

  // A1 建案打点
  const c1 = await caseStore.registerCase({
    name: '甲与乙买卖合同纠纷', type: '民商', cause: '合同纠纷',
    status: 'intake', level: '一审', ourSide: 'plaintiff',
  })
  const opened = await ensureCaseOpenEvent(itemStore, c1.caseId, { name: c1.name })
  check('A1 建案打点落收案事件', opened === true)
  const openedAgain = await ensureCaseOpenEvent(itemStore, c1.caseId, { name: c1.name })
  check('A1 打点幂等（第二次不重复）', openedAgain === false)
  const c1Events = (await itemStore.listItems(c1.caseId)).filter((i) => i.type === 'event')
  const openEvent = c1Events.find((i) => i.title === '收案')
  check('A1 收案事件 kind=engagement/status=done', openEvent?.kind === 'engagement' && openEvent.status === 'done')
  const legacyEvt = itemToTimelineEvent(openEvent)
  check('A1 kind 透传 legacy type', legacyEvt.type === 'engagement')

  // A2 阶段模板事件骨架（一审·庭前准备，anchor=开庭日）
  // v0.2.6：答辩期届满/举证期限届满/开庭 全部依赖外部信息（送达日/举证通知书/传票），
  // 无法自主确定 → 均不随状态切换自动落盘（auto:false）。只有立案类事件 auto:true。
  const anchor = iso(10)
  const plan = await planStageExpansion(caseStore, c1.caseId, 'pretrial', { dryRun: true, anchorDate: anchor }, itemStore)
  check('A2 庭前准备无 auto 事件', plan.events.length === 0, `events=${plan.events.length}`)
  const evByTitle = Object.fromEntries(plan.events.map((e) => [e.title, e]))
  check('A2 开庭不自动落盘', evByTitle['开庭'] === undefined, '开庭 auto:false 应跳过')
  check('A2 答辩期届满不自动落盘', evByTitle['答辩期届满'] === undefined, '答辩期届满 auto:false 应跳过')
  check('A2 举证期限届满不自动落盘', evByTitle['举证期限届满'] === undefined, '举证期限届满 auto:false 应跳过')

  // A3 落库 + 幂等
  const applied = await applyStageExpansion(caseStore, c1.caseId, 'pretrial', { anchorDate: anchor }, itemStore)
  check('A3 展开返回任务（无事件）', applied.tasks.length > 0 && applied.events.length === 0)
  const eventsAfter = (await itemStore.listItems(c1.caseId)).filter((i) => i.type === 'event')
  const stageEvents = eventsAfter.filter((e) => ['开庭', '举证期限届满', '答辩期届满'].includes(e.title))
  check('A3 庭前事件不落盘', stageEvents.length === 0, `count=${stageEvents.length}`)
  const plan2 = await planStageExpansion(caseStore, c1.caseId, 'pretrial', { dryRun: true, anchorDate: anchor }, itemStore)
  check('A3 重复展开事件为 0（幂等）', plan2.events.length === 0, `events=${plan2.events.length}`)

  /* ══════════════ B. 状态变更三态展开 ══════════════ */

  // B1 confirm：改状态挂起（不自动展开）→ resolve(expand) 落库并清除
  const c2 = await caseStore.registerCase({
    name: '乙与甲借款纠纷', type: '民商', status: 'intake', level: '一审', ourSide: 'defendant',
  })
  await applyStageExpansion(caseStore, c2.caseId, 'pre_filing', {}, itemStore)
  const c2Tasks = (await itemStore.listItems(c2.caseId)).filter((i) => i.type === 'task')
  for (const t of c2Tasks) await itemStore.upsertItem({ id: t.id, status: 'done' })
  await caseStore.updateCase(c2.caseId, { status: 'pretrial' })
  const trans1 = await handleStatusTransition({
    caseStore, itemStore, caseId: c2.caseId,
    prevStatus: 'intake', nextStatus: 'pretrial', level: '一审', mode: 'confirm',
  })
  check('B1 confirm 挂起 pendingExpand', trans1.pendingExpand?.stageId === 'pretrial' && trans1.pendingExpand.mode === 'confirm')
  const c2b = await caseStore.readCase(c2.caseId)
  check('B1 pendingExpand 已持久化', c2b.pendingExpand?.stageId === 'pretrial')
  const pretrialGroup = (await itemStore.listGroups(c2.caseId)).find((g) => g.name === '一审 · 庭前准备')
  const pretrialTasksBefore = (await itemStore.listItems(c2.caseId)).filter((i) => i.type === 'task' && i.groupId === pretrialGroup?.id)
  check('B1 状态变更未自动展开（confirm 不落库）', pretrialTasksBefore.length === 0, `tasks=${pretrialTasksBefore.length}`)
  const resolved = await resolvePendingExpand(caseStore, itemStore, c2.caseId, 'expand')
  check('B1 resolve(expand) 展开庭前准备', resolved.expanded === true && (resolved.preview?.length ?? 0) > 0, resolved.notice)
  const c2c = await caseStore.readCase(c2.caseId)
  check('B1 expand 后 pendingExpand 清除', c2c.pendingExpand === undefined)
  const pretrialGroupAfter = (await itemStore.listGroups(c2.caseId)).find((g) => g.name === '一审 · 庭前准备')
  const pretrialTasksAfter = (await itemStore.listItems(c2.caseId)).filter((i) => i.type === 'task' && i.groupId === pretrialGroupAfter?.id)
  check('B1 庭前任务已落库', pretrialTasksAfter.length > 0, `tasks=${pretrialTasksAfter.length}`)
  const pretrialEventsAfter = (await itemStore.listItems(c2.caseId)).filter((i) => i.type === 'event' && i.title === '开庭')
  check('B1 开庭不随状态切换自动落盘', pretrialEventsAfter.length === 0, `开庭 auto:false 应跳过`)
  // B1.5 立案联动：进入庭前准备 = 已立案，自动落盘立案事件
  const c2Filing = (await itemStore.listItems(c2.caseId)).find((i) => i.type === 'event' && i.title === '立案')
  check('B1.5 进入庭前准备自动落盘立案', c2Filing !== undefined && c2Filing.status === 'done', JSON.stringify(c2Filing?.date))

  // B2 ignore：仅清除标记
  const c3 = await caseStore.registerCase({
    name: '丙与丁运输合同纠纷', type: '民商', status: 'intake', level: '一审', ourSide: 'plaintiff',
  })
  await caseStore.updateCase(c3.caseId, { status: 'pretrial' })
  await handleStatusTransition({ caseStore, itemStore, caseId: c3.caseId, prevStatus: 'intake', nextStatus: 'pretrial', level: '一审', mode: 'confirm' })
  const ignored = await resolvePendingExpand(caseStore, itemStore, c3.caseId, 'ignore')
  check('B2 ignore 清除标记', ignored.ok === true && ignored.expanded !== true)
  const c3b = await caseStore.readCase(c3.caseId)
  check('B2 ignore 后无残留标记', c3b.pendingExpand === undefined)
  const c3Groups = (await itemStore.listGroups(c3.caseId)).map((g) => g.name)
  check('B2 ignore 不展开任何任务', c3Groups.filter((g) => g.includes('庭前')).length === 0, c3Groups.join(','))

  // B3 agent：挂起 mode=agent
  const c4 = await caseStore.registerCase({
    name: '戊与己服务合同纠纷', type: '民商', status: 'intake', level: '一审', ourSide: 'plaintiff',
  })
  await caseStore.updateCase(c4.caseId, { status: 'pretrial' })
  const trans4 = await handleStatusTransition({ caseStore, itemStore, caseId: c4.caseId, prevStatus: 'intake', nextStatus: 'pretrial', level: '一审', mode: 'agent' })
  check('B3 agent 挂起 mode=agent', trans4.pendingExpand?.mode === 'agent')

  // B4 off：不挂起
  const c5 = await caseStore.registerCase({
    name: '庚与辛租赁合同纠纷', type: '民商', status: 'intake', level: '一审', ourSide: 'plaintiff', expandOnStatus: 'off',
  })
  await caseStore.updateCase(c5.caseId, { status: 'pretrial' })
  const trans5 = await handleStatusTransition({ caseStore, itemStore, caseId: c5.caseId, prevStatus: 'intake', nextStatus: 'pretrial', level: '一审', mode: 'off' })
  const c5b = await caseStore.readCase(c5.caseId)
  check('B4 off 不挂起', trans5.pendingExpand === undefined && c5b.pendingExpand === undefined)

  // B5 已展开判定：目标阶段已有任务 → 不重复挂起
  const trans6 = await handleStatusTransition({
    caseStore, itemStore, caseId: c2.caseId,
    prevStatus: 'filing', nextStatus: 'pretrial', level: '一审', mode: 'confirm',
  })
  check('B5 已展开不重复挂起', trans6.pendingExpand === undefined && String(trans6.notice ?? '').includes('已展开'), trans6.notice)

  // B6 已结案：清除任何挂起
  await handleStatusTransition({ caseStore, itemStore, caseId: c4.caseId, prevStatus: 'intake', nextStatus: 'pretrial', level: '一审', mode: 'confirm' })
  const c4b = await caseStore.readCase(c4.caseId)
  check('B6 前置：c4 有挂起', c4b.pendingExpand !== undefined)
  await caseStore.updateCase(c4.caseId, { status: 'closed' })
  await handleStatusTransition({ caseStore, itemStore, caseId: c4.caseId, prevStatus: 'pretrial', nextStatus: 'closed', level: '一审', mode: 'confirm' })
  const c4c = await caseStore.readCase(c4.caseId)
  check('B6 结案清除挂起', c4c.pendingExpand === undefined)

  console.log('\n' + (failures === 0 ? 'ALL PASS' : `${failures} FAILURES`))
  process.exitCode = failures === 0 ? 0 : 1
} finally {
  await rm(dataDir, { recursive: true, force: true })
}
