/**
 * Verify the 条件任务 (optional) semantics introduced for 备忘录 #10:
 *  1. 默认展开（不传 only）不创建 optional 任务（缴纳诉讼费 / 上诉三件套）。
 *  2. 传 only 点名时 optional 任务被纳入。
 *  3. expand_next 预览不包含 optional 任务标题。
 *  4. filing 模板不再含旧的两条噪音任务（计算并缴纳诉讼费 / 领取受理通知书与举证通知书），
 *     立案通知事项以「登记举证期限与开庭安排」承接。
 *
 * Run: node scripts/verify-optional-tasks.mjs
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCaseStore } from '../lib/domains/litigation/store/index.js'
import {
  applyStageExpansion,
  detectStageSuggestions,
  planStageExpansion,
} from '../lib/domains/litigation/stage-expansion.js'
import { LITIGATION_STAGES } from '../lib/shared/playbook/litigation.js'

let failures = 0
function check(name, cond, extra = '') {
  const ok = Boolean(cond)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
  if (!ok) failures++
}

const dataDir = await mkdtemp(join(tmpdir(), 'ls-optional-'))
try {
  const caseStore = createCaseStore(dataDir)

  /* ── filing 阶段模板本身 ── */
  const filing = LITIGATION_STAGES.find((s) => s.id === 'filing')
  check('filing 模板不含 计算并缴纳诉讼费', filing?.tasks.some((t) => t.title === '计算并缴纳诉讼费') === false, '')
  check('filing 模板不含 领取受理通知书与举证通知书', filing?.tasks.some((t) => t.title === '领取受理通知书与举证通知书') === false, '')
  check('filing 含 登记举证期限与开庭安排', filing?.tasks.some((t) => t.title === '登记举证期限与开庭安排') === true, '')
  const feeTask = filing?.tasks.find((t) => t.title === '缴纳诉讼费')
  check('缴纳诉讼费 是 optional 条件任务', feeTask?.optional === true, String(feeTask?.optional))

  /* ── post_trial 上诉类均为 optional ── */
  const post = LITIGATION_STAGES.find((s) => s.id === 'post_trial')
  for (const title of ['分析上诉可行性', '确认当事人上诉意向', '提交上诉状']) {
    const t = post?.tasks.find((x) => x.title === title)
    check(`${title} 是 optional`, t?.optional === true, String(t?.optional))
  }

  /* ── 默认展开不建 optional ── */
  const c1 = await caseStore.registerCase({
    name: '甲诉乙纠纷', type: '民商', cause: '合同纠纷', status: 'post_trial', ourSide: 'plaintiff',
  })
  const preview = await planStageExpansion(caseStore, c1.caseId, 'post_trial', { dryRun: true })
  check('post_trial 默认预览不含上诉三件套', preview.tasks.some((t) => t.title === '分析上诉可行性') === false,
    preview.tasks.map((t) => t.title).join(','))
  check('post_trial 默认仍含基础任务(督促履行)', preview.tasks.some((t) => t.title === '督促对方履行生效裁判') === true, '')

  const applied = await applyStageExpansion(caseStore, c1.caseId, 'post_trial')
  const afterApply = await caseStore.readCase(c1.caseId)
  const group = afterApply.taskGroups.find((g) => g.name === '一审 · 庭后管理')
  check('实际落库同样不含上诉任务', group?.tasks.some((t) => t.title === '提交上诉状') === false,
    (group?.tasks ?? []).map((t) => t.title).join(','))

  /* ── only 点名时纳入 optional ── */
  const planned = await planStageExpansion(caseStore, c1.caseId, 'post_trial', {
    only: ['领取裁判文书', '提交上诉状'], dryRun: true,
  })
  check('only 点名含 提交上诉状', planned.tasks.some((t) => t.title === '提交上诉状') === true,
    planned.tasks.map((t) => t.title).join(','))

  /* ── filing 默认展开同样不含 缴纳诉讼费 ── */
  const c2 = await caseStore.registerCase({
    name: '乙诉丙纠纷', type: '民商', cause: '借款', status: 'filing', ourSide: 'plaintiff',
  })
  const filingPreview = await planStageExpansion(caseStore, c2.caseId, 'filing', { dryRun: true })
  check('filing 默认不含 缴纳诉讼费', filingPreview.tasks.some((t) => t.title === '缴纳诉讼费') === false,
    filingPreview.tasks.map((t) => t.title).join(','))

  /* ── expand_next 预览不含 optional ── */
  const c3 = await caseStore.registerCase({
    name: '丙诉丁纠纷', type: '民商', cause: '合同', status: 'awaiting_trial', ourSide: 'plaintiff',
  })
  const trialApplied = await applyStageExpansion(caseStore, c3.caseId, 'trial')
  const rec = await caseStore.readCase(c3.caseId)
  const trialGroup = rec.taskGroups.find((g) => g.name === '一审 · 开庭审理')
  for (const t of (trialGroup?.tasks ?? [])) {
    await caseStore.upsertTask(c3.caseId, trialGroup.id, { id: t.id, status: 'done' })
  }
  const s = detectStageSuggestions(await caseStore.readRegistry(), c3.caseId)
  const expandNext = s[0]?.suggestions.find((x) => x.type === 'expand_next')
  check('expand_next 预览不含 optional 任务', (expandNext?.preview ?? []).includes('分析上诉可行性') === false,
    JSON.stringify(expandNext?.preview ?? []))

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`)
  process.exit(failures === 0 ? 0 : 1)
} finally {
  await rm(dataDir, { recursive: true, force: true })
}
