/**
 * Verify the 条件任务 (optional) semantics introduced for 备忘录 #10,
 * updated for v0.3.0 (多轨模板 + 管家自动登记 + 二审轨承接上诉动作):
 *  1. 默认展开（不传 only）不创建 optional 任务（缴纳诉讼费 / 上诉评估 / 督促履行等）。
 *  2. 传 only 点名时 optional 任务被纳入。
 *  3. expand_next 预览不包含 optional 任务标题。
 *  4. filing 模板不含登记/提醒噪音任务（登记举证期限与开庭安排等管家动作已移除），
 *     立案通知事项改由管家 add_keydate / upsert_event 处理，不再作为律师任务。
 *  5. 「提交上诉状」从一审 post_trial 移入二审轨（上诉动作在二审模板展开）。
 *
 * Run: node scripts/verify-optional-tasks.mjs
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCaseStore } from '../lib/domains/litigation/store/index.js'
import { createItemStore } from '../lib/domains/item/store/item-store.js'
import {
  applyStageExpansion,
  detectStageSuggestions,
  planStageExpansion,
} from '../lib/domains/litigation/stage-expansion.js'
import { LITIGATION_STAGES, STAGE_TRACKS } from '../lib/shared/playbook/litigation.js'

let failures = 0
function check(name, cond, extra = '') {
  const ok = Boolean(cond)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
  if (!ok) failures++
}

const dataDir = await mkdtemp(join(tmpdir(), 'ls-optional-'))
try {
  // 0.2.12：任务/关键日期只存 items.json（唯一真相源）。
  const itemStore = createItemStore(join(dataDir, 'items'))
  const caseStore = createCaseStore(dataDir, undefined, itemStore)

  /* ── filing 阶段模板本身（v0.3.0：登记类管家动作已移除） ── */
  const filing = LITIGATION_STAGES.find((s) => s.id === 'filing')
  check('filing 模板不含 计算并缴纳诉讼费', filing?.tasks.some((t) => t.title === '计算并缴纳诉讼费') === false, '')
  check('filing 模板不含 登记举证期限与开庭安排', filing?.tasks.some((t) => t.title === '登记举证期限与开庭安排') === false, '')
  check('filing 模板不含 领取受理通知书与举证通知书', filing?.tasks.some((t) => t.title === '领取受理通知书与举证通知书') === false, '')
  const feeTask = filing?.tasks.find((t) => t.title === '缴纳诉讼费')
  check('缴纳诉讼费 是 optional 条件任务', feeTask?.optional === true, String(feeTask?.optional))

  /* ── post_trial 庭后管理：上诉研判已移入独立上诉期阶段，庭后只留庭后事务 ── */
  const post = LITIGATION_STAGES.find((s) => s.id === 'post_trial')
  check('一审 post_trial 不再含 分析上诉可行性（移入上诉期）', post?.tasks.some((t) => t.title === '分析上诉可行性') === false, '')
  check('一审 post_trial 不含 提交上诉状（移入二审轨）', post?.tasks.some((t) => t.title === '提交上诉状') === false, '')
  const appealStage = STAGE_TRACKS['一审']?.find((s) => s.id === 'appeal_window')
  check('上诉期含 分析判决并出具上诉研判意见（必需）', appealStage?.tasks.some((t) => t.title === '分析判决并出具上诉研判意见' && t.optional !== true) === true, '')
  const secondFiling = STAGE_TRACKS['二审']?.find((s) => s.id === 'appeal_filed')
  check('二审轨 上诉立案 含 提交上诉状', secondFiling?.tasks.some((t) => t.title === '提交上诉状') === true, '')

  /* ── 默认展开不建 optional ── */
  const c1 = await caseStore.registerCase({
    name: '甲诉乙纠纷', type: '民商', cause: '合同纠纷', status: 'post_trial', ourSide: 'plaintiff',
  })
  const preview = await planStageExpansion(caseStore, c1.caseId, 'post_trial', { dryRun: true }, itemStore)
  check('post_trial 默认不含 optional 督促履行', preview.tasks.some((t) => t.title === '督促对方履行生效裁判') === false, '')
  check('post_trial 默认含基础任务(确认裁判文书)', preview.tasks.some((t) => t.title === '确认裁判文书') === true,
    preview.tasks.map((t) => t.title).join(','))

  const applied = await applyStageExpansion(caseStore, c1.caseId, 'post_trial', {}, itemStore)
  const afterApply = await caseStore.readCase(c1.caseId)
  const group = afterApply.taskGroups.find((g) => g.name === '一审 · 庭后管理')
  check('实际落库不含上诉任务', group?.tasks.some((t) => t.title === '提交上诉状') === false,
    (group?.tasks ?? []).map((t) => t.title).join(','))

  /* ── only 点名时纳入 optional ── */
  const planned = await planStageExpansion(caseStore, c1.caseId, 'post_trial', {
    only: ['确认裁判文书', '督促对方履行生效裁判'], dryRun: true,
  })
  check('only 点名含 optional 督促履行', planned.tasks.some((t) => t.title === '督促对方履行生效裁判') === true,
    planned.tasks.map((t) => t.title).join(','))

  /* ── filing 默认展开同样不含 缴纳诉讼费 ── */
  const c2 = await caseStore.registerCase({
    name: '乙诉丙纠纷', type: '民商', cause: '借款', status: 'filing', ourSide: 'plaintiff',
  })
  const filingPreview = await planStageExpansion(caseStore, c2.caseId, 'filing', { dryRun: true })
  check('filing 默认不含 缴纳诉讼费', filingPreview.tasks.some((t) => t.title === '缴纳诉讼费') === false,
    filingPreview.tasks.map((t) => t.title).join(','))

  /* ── expand_next 预览不含 optional ── */
  // 一审：庭前准备全部完成后建议推进庭后管理。
  const c3 = await caseStore.registerCase({
    name: '丙诉丁纠纷', type: '民商', cause: '合同', status: 'pretrial', ourSide: 'plaintiff',
  })
  const trialApplied = await applyStageExpansion(caseStore, c3.caseId, 'pretrial')
  const rec = await caseStore.readCase(c3.caseId)
  const trialGroup = rec.taskGroups.find((g) => g.name === '一审 · 庭前准备')
  check('pretrial 展开含 制作庭审提纲（起草/梳理证据已在诉前准备）', (trialGroup?.tasks ?? []).some((t) => t.title === '制作庭审提纲') === true,
    (trialGroup?.tasks ?? []).map((t) => t.title).join(','))
  for (const t of (trialGroup?.tasks ?? [])) {
    await caseStore.upsertTask(c3.caseId, trialGroup.id, { id: t.id, status: 'done' })
  }
  const s = detectStageSuggestions(await caseStore.readRegistry(), c3.caseId)
  const expandNext = s[0]?.suggestions.find((x) => x.type === 'expand_next')
  check('expand_next 预览不含 optional 任务', (expandNext?.preview ?? []).includes('督促对方履行生效裁判') === false,
    JSON.stringify(expandNext?.preview ?? []))
  check('expand_next 指向 一审 · 庭后管理', expandNext?.stageId === 'post_trial', expandNext?.stageName ?? '')

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`)
  process.exit(failures === 0 ? 0 : 1)
} finally {
  await rm(dataDir, { recursive: true, force: true })
}
