/**
 * Standalone verification of the P1 stage-template machinery.
 *
 * Exercises:
 *  1. planStageExpansion (dryRun) produces a plan WITHOUT writing anything.
 *  2. applyStageExpansion materializes tasks + subtasks + checklists, and is
 *     idempotent (a second run creates nothing because titles already exist).
 *  3. anchorDate + leadDays produce correct deadlines (T-N scheduling).
 *  4. only / skip let the 管家 trim the template — the template is a skeleton,
 *     not a straitjacket.
 *  5. detectStageSuggestions fires the right suggestion at the right moment:
 *     current stage empty → expand_current; all done → expand_next +
 *     advance_status; 立案后缺法院/案号 → fill_fields.
 *  6. Non-litigation: special project walks the sequence (启动→尽调→交易文件),
 *     retainer project surfaces renewal + stale service log.
 *
 * Run: node scripts/verify-stage-expansion.mjs
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
import { createProjectStore } from '../lib/domains/nonlitigation/store/project-store.js'
import { createServiceStore } from '../lib/domains/nonlitigation/store/service-store.js'
import {
  applyStageExpansion as applyProjectStage,
  detectStageSuggestions as detectProjectSuggestions,
  planStageExpansion as planProjectStage,
} from '../lib/domains/nonlitigation/stage-expansion.js'
import { daysBefore } from '../lib/shared/playbook/litigation.js'

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
const HEARING = iso(10)

const dataDir = await mkdtemp(join(tmpdir(), 'ls-stage-'))
try {
  const caseStore = createCaseStore(dataDir)
  const projectStore = createProjectStore(dataDir)
  const serviceStore = createServiceStore(dataDir)

  /* ══════════════ 1. dryRun 不落库 ══════════════ */
  const c1 = await caseStore.registerCase({
    name: '甲与乙买卖合同纠纷', type: '民商', cause: '合同纠纷',
    status: 'awaiting_trial', ourSide: 'plaintiff',
  })
  const caseId = c1.caseId

  const preview = await planStageExpansion(caseStore, caseId, 'trial', {
    anchorDate: HEARING, dryRun: true,
  })
  check('preview 返回计划', preview.tasks.length > 0, `tasks=${preview.tasks.length}`)
  check('preview 标记 dryRun', preview.dryRun === true)
  const afterPreview = await caseStore.readCase(caseId)
  check('dryRun 未创建任务组', (afterPreview.taskGroups ?? []).length === 0, `groups=${afterPreview.taskGroups?.length}`)

  // 锚点推算：模板里「出庭参加庭审」leadDays=0 → deadline 就是开庭日；
  // 「制作庭审提纲」leadDays=3 → 开庭前 3 天。
  // 注意：JS 允许 CJK 作标识符字符，`const提纲` 会被当成一个标识符，
  // 因此变量名统一用 ASCII。
  const outlineTask = preview.tasks.find((t) => t.title === '制作庭审提纲')
  const attendTask = preview.tasks.find((t) => t.title === '出庭参加庭审')
  check('T-3 任务 deadline 正确', outlineTask?.deadline === daysBefore(HEARING, 3), String(outlineTask?.deadline))
  check('T-0 任务 deadline 即开庭日', attendTask?.deadline === HEARING, String(attendTask?.deadline))

  /* ══════════════ 2. 应用展开 ══════════════ */
  const applied = await applyStageExpansion(caseStore, caseId, 'trial', { anchorDate: HEARING })
  check('apply 返回 groupId', applied.groupId !== undefined, String(applied.groupId))
  const afterApply = await caseStore.readCase(caseId)
  const trialGroup = afterApply.taskGroups.find((g) => g.name === '一审 · 开庭审理')
  check('创建阶段任务组', trialGroup !== undefined)
  check('任务全部落地', trialGroup?.tasks.length === applied.tasks.length, `tasks=${trialGroup?.tasks.length}`)
  const withSub = trialGroup?.tasks.find((t) => t.title === '制作庭审提纲')
  check('子任务一并创建', (withSub?.subtasks?.length ?? 0) >= 3, `subtasks=${withSub?.subtasks?.length}`)
  const withChk = trialGroup?.tasks.find((t) => t.title === '出庭参加庭审')
  check('检查项一并创建', (withChk?.checklist?.length ?? 0) >= 3, `checklist=${withChk?.checklist?.length}`)

  /* ══════════════ 3. 幂等 ══════════════ */
  const again = await applyStageExpansion(caseStore, caseId, 'trial', { anchorDate: HEARING })
  check('重复展开不新建任务', again.tasks.length === 0, `created=${again.tasks.length}`)
  const afterTwice = await caseStore.readCase(caseId)
  const g2 = afterTwice.taskGroups.find((g) => g.name === '一审 · 开庭审理')
  check('任务数未翻倍', g2?.tasks.length === trialGroup?.tasks.length, `tasks=${g2?.tasks.length}`)

  /* ══════════════ 4. 管家改名后不会被重复创建 ══════════════ */
  await caseStore.upsertTask(caseId, trialGroup.id, { id: withChk.id, title: '出庭参加第二次庭审' })
  const third = await applyStageExpansion(caseStore, caseId, 'trial', { anchorDate: HEARING })
  const recreated = third.tasks.some((t) => t.title === '出庭参加庭审')
  check('已改名的任务不被重新创建', recreated === false, third.tasks.map((t) => t.title).join(','))

  /* ══════════════ 5. only / skip 裁剪 ══════════════ */
  const c2 = await caseStore.registerCase({
    name: '丙与丁借款合同纠纷', type: '民商', cause: '合同纠纷',
    status: 'pretrial', ourSide: 'defendant',
  })
  const trimmed = await planStageExpansion(caseStore, c2.caseId, 'pretrial', {
    only: ['提交答辩状', '提交证据'], dryRun: true,
  })
  check('only 只保留指定任务', trimmed.tasks.length === 2, trimmed.tasks.map((t) => t.title).join(','))
  check('only 之外的进入 skippedByFilter', trimmed.skippedByFilter.length > 0, `${trimmed.skippedByFilter.length}`)

  const skipped = await planStageExpansion(caseStore, c2.caseId, 'pretrial', {
    skip: ['申请司法鉴定'], dryRun: true,
  })
  check('skip 排除指定任务', !skipped.tasks.some((t) => t.title === '申请司法鉴定'))
  check('skip 的任务进入 skippedByFilter', skipped.skippedByFilter.includes('申请司法鉴定'))

  /* ══════════════ 6. 未给锚点日期时给出提示 ══════════════ */
  const noAnchor = await planStageExpansion(caseStore, c2.caseId, 'pretrial', { dryRun: true })
  check('缺 anchorDate 时告警', noAnchor.warnings.length > 0, noAnchor.warnings[0])

  /* ══════════════ 7. 阶段推进检测（诉讼）══════════════ */
  const reg1 = await caseStore.readRegistry()
  // 待开庭案件已有开庭阶段任务且未完成 → 不应反复建议展开当前阶段
  const s1 = detectStageSuggestions(reg1, caseId)
  const types1 = (s1[0]?.suggestions ?? []).map((x) => x.type)
  check('进行中的阶段不重复建议展开', !types1.includes('expand_current'), types1.join(','))
  // 立案后缺法院/案号/立案日期 → fill_fields
  check('缺登记字段时提示 fill_fields', types1.includes('fill_fields'), types1.join(','))

  // 标记该阶段全部完成 → 应建议推进到下一阶段（庭后管理）并给出目标状态
  for (const t of trialGroup.tasks) {
    await caseStore.upsertTask(caseId, trialGroup.id, { id: t.id, status: 'done' })
  }
  const s2 = detectStageSuggestions(await caseStore.readRegistry(), caseId)
  const next = s2[0]?.suggestions.find((x) => x.type === 'expand_next')
  check('阶段完成后建议展开下一阶段', next !== undefined, JSON.stringify(s2[0]?.suggestions.map((x) => x.type)))
  check('下一阶段为一审 · 庭后管理', next?.stageName === '一审 · 庭后管理', String(next?.stageName))
  check('同时给出目标状态', next?.suggestStatus === 'post_trial', String(next?.suggestStatus))

  // 空阶段 → expand_current
  const c3 = await caseStore.registerCase({
    name: '戊与己劳动争议', type: '劳动争议', cause: '劳动报酬',
    status: 'pre_filing', ourSide: 'applicant',
  })
  const s3 = detectStageSuggestions(await caseStore.readRegistry(), c3.caseId)
  check('空阶段建议展开当前阶段', s3[0]?.suggestions.some((x) => x.type === 'expand_current') === true,
    JSON.stringify(s3[0]?.suggestions.map((x) => x.type)))

  // 已结案不再给建议
  await caseStore.updateCase(caseId, { status: 'closed' })
  const s4 = detectStageSuggestions(await caseStore.readRegistry(), caseId)
  check('已结案案件无建议', s4.length === 0, `count=${s4.length}`)

  /* ══════════════ 8. 非诉：专项顺序推进 ═══════════════ */
  const p1 = await projectStore.registerProject({
    name: '某科技公司A轮融资法律尽职调查', projectType: 'special', status: 'retained',
  })
  const s5 = detectProjectSuggestions(await projectStore.readRegistry(), await serviceStore.listServices(), p1.projectId)
  check('专项已签约建议展开服务启动', s5[0]?.suggestions.some((x) => x.stageId === 'kickoff') === true,
    JSON.stringify(s5[0]?.suggestions.map((x) => x.stageId ?? x.type)))

  await applyProjectStage(projectStore, p1.projectId, 'kickoff')
  const pRec = await projectStore.readProject(p1.projectId)
  const kickoffGroup = pRec.taskGroups.find((g) => g.name === '服务启动')
  for (const t of kickoffGroup.tasks) {
    await projectStore.upsertTask(p1.projectId, kickoffGroup.id, { id: t.id, status: 'done' })
  }
  const s6 = detectProjectSuggestions(await projectStore.readRegistry(), await serviceStore.listServices(), p1.projectId)
  const nxt = s6[0]?.suggestions.find((x) => x.stageId === 'due_diligence')
  check('启动完成后建议展开尽调', nxt !== undefined, JSON.stringify(s6[0]?.suggestions.map((x) => x.stageId ?? x.type)))
  check('并建议状态推进到进行中', nxt?.suggestStatus === 'active', String(nxt?.suggestStatus))

  /* ══════════════ 9. 非诉：常法续约与台账 ═══════════════ */
  const p2 = await projectStore.registerProject({
    name: '某制造公司常年法律顾问', projectType: 'retainer', status: 'active',
    servicePeriod: { start: iso(-300), end: iso(40) },
    serviceScope: ['合同审查', '法律咨询'],
  })
  await applyProjectStage(projectStore, p2.projectId, 'kickoff')
  const p2Rec = await projectStore.readProject(p2.projectId)
  const p2Kickoff = p2Rec.taskGroups.find((g) => g.name === '服务启动')
  for (const t of p2Kickoff.tasks) {
    await projectStore.upsertTask(p2.projectId, p2Kickoff.id, { id: t.id, status: 'done' })
  }
  const s7 = detectProjectSuggestions(await projectStore.readRegistry(), await serviceStore.listServices(), p2.projectId)
  const kinds = (s7[0]?.suggestions ?? []).map((x) => x.type)
  check('常法提示续约临近', kinds.includes('renewal_due'), kinds.join(','))
  check('常法提示台账断更', kinds.includes('service_log_stale'), kinds.join(','))

  // 补一条近期服务记录 → 台账断更提示消失
  await serviceStore.upsertService({
    name: '审查采购合同', kind: '合同审查', client: '某制造公司', status: 'done', date: iso(-2), note: '出具审查意见，2 小时',
  })
  const s8 = detectProjectSuggestions(await projectStore.readRegistry(), await serviceStore.listServices(), p2.projectId)
  check('补登台账后断更提示消失',
    (s8[0]?.suggestions ?? []).map((x) => x.type).includes('service_log_stale') === false,
    (s8[0]?.suggestions ?? []).map((x) => x.type).join(','))

  /* ══════════════ 10. 非诉 dryRun 同样不落库 ═══════════════ */
  const before = (await projectStore.readProject(p2.projectId)).taskGroups.length
  await planProjectStage(projectStore, p2.projectId, 'service_report', { dryRun: true })
  const after = (await projectStore.readProject(p2.projectId)).taskGroups.length
  check('非诉 dryRun 不落库', before === after, `${before} → ${after}`)

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`)
  process.exit(failures === 0 ? 0 : 1)
} finally {
  await rm(dataDir, { recursive: true, force: true })
}
