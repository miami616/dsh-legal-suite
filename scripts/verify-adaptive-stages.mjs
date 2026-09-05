/**
 * v0.3.0 自适应阶段/任务验证脚本：
 *  1. 建案按 type 推断 level（刑事→刑事 / 劳动争议→劳动仲裁 / 民商→一审）。
 *  2. apply_stage_template 按 level 选轨展开：刑事案展开刑事轨、劳动仲裁案展开劳动仲裁轨。
 *  3. 任务按我方身份裁剪：被告案不含 提交答辩状 的 plaintiff-only 冲突项、
 *     原告案不含 查阅对方答辩状（defendant）…… 实际是 side 语义：
 *     side:'defendant' 的任务只在我方为被告时出现；side:'plaintiff' 只在原告时出现。
 *  4. optional 默认不展开；only 点名可展开。
 *  5. 一审 post_trial 不再含 提交上诉状；「二审中」是 level 转换，无过渡任务组。
 *
 * Run: node scripts/verify-adaptive-stages.mjs
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCaseStore } from '../lib/domains/litigation/store/index.js'
import {
  applyStageExpansion,
  planStageExpansion,
  resolveStageForCase,
  stageTasksOf,
} from '../lib/domains/litigation/stage-expansion.js'
import {
  STAGE_TRACKS,
  LITIGATION_STAGES,
  STATUS_LADDERS,
  defaultLevelForType,
} from '../lib/shared/playbook/litigation.js'

let failures = 0
function check(name, cond, extra = '') {
  const ok = Boolean(cond)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
  if (!ok) failures++
}

const dataDir = await mkdtemp(join(tmpdir(), 'ls-adaptive-'))
try {
  const caseStore = createCaseStore(dataDir)

  /* ── 1. level 推断 ── */
  check('刑事→刑事', defaultLevelForType('刑事') === '刑事', defaultLevelForType('刑事'))
  check('劳动争议→劳动仲裁', defaultLevelForType('劳动争议') === '劳动仲裁', defaultLevelForType('劳动争议'))
  check('执行→首次执行', defaultLevelForType('执行') === '首次执行', defaultLevelForType('执行'))
  check('民商→一审', defaultLevelForType('民商') === '一审', defaultLevelForType('民商'))
  check('空→一审', defaultLevelForType('') === '一审', defaultLevelForType(''))

  /* ── 2. 阶梯完整性（新增轨都有，收尾 closed） ── */
  for (const [level, ladder] of Object.entries(STATUS_LADDERS)) {
    check(`阶梯 ${level} 收尾 closed`, ladder.at(-1)?.id === 'closed', ladder.map((s) => s.id).join('/'))
  }
  check('含刑事阶梯', STATUS_LADDERS['刑事']?.some((s) => s.id === 'investigation_c') === true, '')
  check('含劳动仲裁阶梯', STATUS_LADDERS['劳动仲裁']?.some((s) => s.id === 'appeal_window') === true, '')

  /* ── 3. 模板不含被删任务 / 含管家动作排除 ── */
  const allTasks = LITIGATION_STAGES.flatMap((s) => s.tasks.map((t) => ({ ...t, stage: s.id })))
  check('全库不含「发送律师函」', allTasks.some((t) => t.title === '发送律师函') === false, '')
  check('全库不含「登记举证期限与开庭安排」', allTasks.some((t) => t.title === '登记举证期限与开庭安排') === false, '')
  check('全库不含「登记收到的诉讼文书」', allTasks.some((t) => t.title === '登记收到的诉讼文书') === false, '')
  check('全库不含「锁定三大期限并倒排」', allTasks.some((t) => t.title === '锁定三大期限并倒排') === false, '')

  /* ── 4. 按 level 选轨展开：刑事 ── */
  const cr = await caseStore.registerCase({
    name: '某某涉嫌盗窃案', type: '刑事', cause: '盗窃罪', status: 'investigation_c', level: '刑事',
    ourSide: 'defendant',
  })
  const crPreview = await planStageExpansion(caseStore, cr.caseId, 'cr_investigation', { dryRun: true })
  check('刑事轨展开含 会见在押当事人', crPreview.tasks.some((t) => t.title === '会见在押当事人') === true,
    crPreview.tasks.map((t) => t.title).join(','))
  check('刑事轨不含 提交答辩状（民事任务不外溢）', crPreview.tasks.some((t) => t.title === '提交答辩状') === false, '')
  check('刑事侦查展开不含 optional 取保候审', crPreview.tasks.some((t) => t.title === '申请取保候审') === false, '')

  /* ── 5. 我方身份裁剪：一审庭前准备，我方=被告 vs 原告 ── */
  const def = await caseStore.registerCase({
    name: '甲诉乙案(我方被告)', type: '民商', cause: '合同', status: 'pretrial', ourSide: 'defendant',
  })
  const defPreview = await planStageExpansion(caseStore, def.caseId, 'pretrial', { dryRun: true })
  check('被告展开含 提交答辩状', defPreview.tasks.some((t) => t.title === '提交答辩状') === true,
    defPreview.tasks.map((t) => t.title).join(','))
  check('被告展开不含 查阅对方答辩状(原告向)', defPreview.tasks.some((t) => t.title === '查阅对方答辩状') === false,
    defPreview.tasks.map((t) => t.title).join(','))

  const pl = await caseStore.registerCase({
    name: '甲诉乙案(我方原告)', type: '民商', cause: '合同', status: 'pretrial', ourSide: 'plaintiff',
  })
  const plPreview = await planStageExpansion(caseStore, pl.caseId, 'pretrial', { dryRun: true })
  check('原告展开不含 提交答辩状(被告向)', plPreview.tasks.some((t) => t.title === '提交答辩状') === false,
    plPreview.tasks.map((t) => t.title).join(','))
  check('原告展开默认不含 optional 查阅对方答辩状(需 only)', plPreview.tasks.some((t) => t.title === '查阅对方答辩状') === false,
    plPreview.tasks.map((t) => t.title).join(','))

  /* ── 6. 类型任务包裁剪：行政案起诉期限任务只在行政 ── */
  const adm = await caseStore.registerCase({
    name: '某公司诉某局案', type: '行政', cause: '行政处罚纠纷', status: 'pre_filing', ourSide: 'plaintiff',
  })
  const admPreview = await planStageExpansion(caseStore, adm.caseId, 'admin_pre', { dryRun: true })
  check('行政案展开含 核查行政起诉期限', admPreview.tasks.some((t) => t.title === '核查行政起诉期限') === true,
    admPreview.tasks.map((t) => t.title).join(','))
  const civilPre = await planStageExpansion(caseStore, def.caseId, 'pre_filing', { dryRun: true })
  check('民商一审诉前不含 行政起诉期限', civilPre.tasks.some((t) => t.title === '核查行政起诉期限') === false,
    civilPre.tasks.map((t) => t.title).join(','))

  /* ── 7. 劳动仲裁轨 ── */
  const lab = await caseStore.registerCase({
    name: '王五诉某厂劳动争议', type: '劳动争议', cause: '劳动报酬争议', status: 'arb_apply', level: '劳动仲裁',
    ourSide: 'plaintiff',
  })
  const labPreview = await planStageExpansion(caseStore, lab.caseId, 'lab_apply', { dryRun: true })
  check('劳动仲裁展开含 核查劳动仲裁时效', labPreview.tasks.some((t) => t.title === '核查劳动仲裁时效') === true,
    labPreview.tasks.map((t) => t.title).join(','))

  /* ── 8. 二审中只是状态：二审案件 level=二审，任务在二审轨 ── */
  const appealCase = await caseStore.registerCase({
    name: '甲诉乙案二审', type: '民商', cause: '合同', status: 'appeal_filed', level: '二审',
    ourSide: 'appellant',
  })
  const stage = resolveStageForCase(appealCase)
  check('二审案件解析到二审轨模板', stage?.id === 'appeal_filed' && stage?.level === '二审', `${stage?.id}@${stage?.level}`)
  const apPreview = await planStageExpansion(caseStore, appealCase.caseId, 'appeal_filed', { dryRun: true })
  check('二审轨展开含 提交上诉状', apPreview.tasks.some((t) => t.title === '提交上诉状') === true,
    apPreview.tasks.map((t) => t.title).join(','))

  /* ── 9. 一审主轨模板 stage.status 全部能在 一审 阶梯命中 ── */
  for (const st of STAGE_TRACKS['一审']) {
    const inLadder = STATUS_LADDERS['一审'].some((x) => x.id === st.status)
    check(`一审模板 ${st.id} status=${st.status} 命中阶梯`, inLadder, st.status)
  }

  /* ── 10. 执行轨模板能在 首次执行 阶梯命中 ── */
  for (const st of STAGE_TRACKS['首次执行']) {
    const inLadder = STATUS_LADDERS['首次执行'].some((x) => x.id === st.status)
    check(`执行模板 ${st.id} status=${st.status} 命中阶梯`, inLadder, st.status)
  }

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`)
  process.exit(failures === 0 ? 0 : 1)
} finally {
  await rm(dataDir, { recursive: true, force: true })
}
