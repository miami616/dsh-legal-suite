/**
 * Standalone verification of the P2 case/project health machinery.
 *
 * Exercises:
 *  1. 完整度按阶段动态计算——诉前案件不因缺案号/法院扣分，立案之后才扣。
 *  2. 缺口清单给出「缺什么 + 为什么这个阶段需要它」。
 *  3. 阶段进度与建议同源（case_health.suggestions === stage_suggestions）。
 *  4. 扫描全部时跳过已结案、按完整度升序排列。
 *  5. 非诉：常法缺服务范围/服务期届满关键日期会被点名；台账断更标记 stale；
 *     服务期剩余天数正确。
 *  6. 内置参考案例（三组诉讼 + 三组非诉）体检结果合理——诉前案的完整度
 *     不应因为「还没立案」被判成很低分。
 *
 * Run: node scripts/verify-case-health.mjs
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCaseStore } from '../lib/domains/litigation/store/index.js'
import { createTimelineStore } from '../lib/domains/litigation/store/index.js'
import { createScheduleStore } from '../lib/domains/litigation/store/index.js'
import { computeCaseHealth, computeRegistryHealth } from '../lib/domains/litigation/health.js'
import { createProjectStore } from '../lib/domains/nonlitigation/store/project-store.js'
import { createServiceStore } from '../lib/domains/nonlitigation/store/service-store.js'
import { computeProjectHealth, computeRegistryHealth as scanProjects } from '../lib/domains/nonlitigation/health.js'
import { seedLitigationSample, seedNonLitigationSample } from '../lib/shared/seed/index.js'

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
const gapFields = (h) => h.completeness.gaps.map((g) => g.field)

const dataDir = await mkdtemp(join(tmpdir(), 'ls-health-'))
try {
  const caseStore = createCaseStore(dataDir)
  const timelineStore = createTimelineStore(dataDir)
  const scheduleStore = createScheduleStore(dataDir)
  const projectStore = createProjectStore(dataDir)
  const serviceStore = createServiceStore(dataDir)

  // 播种必须在任何手工建案之前：种子只在 registry 为空时写入，
  // 手工登记过就不再播种（这是设计行为，不是 bug）。
  await seedLitigationSample(caseStore, timelineStore, scheduleStore)
  await seedNonLitigationSample(projectStore, serviceStore)

  /* ══════════════ 1. 完整度按阶段动态计算 ══════════════ */
  // 同一个「什么都不填」的案件，诉前 vs 待开��，应填字段数不同
  const bare = await caseStore.registerCase({ name: '甲与乙纠纷', type: '民商' })
  const asPreFiling = await caseStore.updateCase(bare.caseId, { status: 'pre_filing' })
  const h1 = await computeCaseHealth(asPreFiling)
  const asAwaiting = await caseStore.updateCase(bare.caseId, { status: 'awaiting_trial' })
  const h2 = await computeCaseHealth(asAwaiting)

  check('诉前案件的应填字段更少', h1.completeness.total < h2.completeness.total,
    `诉前=${h1.completeness.total} 待开庭=${h2.completeness.total}`)
  check('诉前不罚「缺案号」', !gapFields(h1).includes('caseNumber'), gapFields(h1).join(','))
  check('待开庭才要求案号', gapFields(h2).includes('caseNumber'), gapFields(h2).join(','))
  check('待开庭要求开庭关键日期', gapFields(h2).includes('keyDate:开庭'), gapFields(h2).join(','))
  check('诉前要求标的额', gapFields(h1).includes('claimAmount'), gapFields(h1).join(','))

  /* ══════════════ 2. 补齐后分数上升、缺口消失 ══════════════ */
  await caseStore.updateCase(bare.caseId, {
    ourSide: 'plaintiff', claimAmount: '100000', court: '某人民法院',
    caseNumber: '（2026）某民初1号', filingDate: iso(-20), judge: '张法官',
  })
  await caseStore.addKeyDate(bare.caseId, '开庭', iso(10))
  const h3 = await computeCaseHealth(await caseStore.readCase(bare.caseId))
  check('补齐后完整度显著提升', h3.completeness.score > h2.completeness.score,
    `${h2.completeness.score} → ${h3.completeness.score}`)
  check('补齐后仅剩当事人信息', gapFields(h3).length === 1 && gapFields(h3)[0] === 'parties', gapFields(h3).join(','))

  await caseStore.updateCase(bare.caseId, {
    parties: { plaintiff: '甲', defendant: '乙', ourSide: 'plaintiff', details: [{ name: '甲', role: '原告', ourClient: true }] },
  })
  const h4 = await computeCaseHealth(await caseStore.readCase(bare.caseId))
  check('全部补齐后满分', h4.completeness.score === 100, String(h4.completeness.score))

  /* ══════════════ 3. 缺口说明包含原因 ══════════════ */
  const gapWithWhy = h2.completeness.gaps.find((g) => g.field === 'filingDate')
  check('缺口带 why 说明', typeof gapWithWhy?.why === 'string' && gapWithWhy.why.length > 0, String(gapWithWhy?.why))

  /* ══════════════ 4. 阶段进度 ══════════════ */
  const g = await caseStore.upsertTaskGroup(bare.caseId, { name: '一审 · 开庭审理' })
  const gid = g.taskGroups.at(-1).id
  const t1 = await caseStore.upsertTask(bare.caseId, gid, { title: '核对证据原件', status: 'done' })
  await caseStore.upsertTask(bare.caseId, gid, { title: '制作庭审提纲', status: 'todo' })
  const h5 = await computeCaseHealth(await caseStore.readCase(bare.caseId))
  check('阶段进度统计正确', h5.stage.total === 2 && h5.stage.done === 1 && h5.stage.open === 1,
    JSON.stringify(h5.stage))
  check('阶段名正确', h5.stage.name === '一审 · 开庭审理', String(h5.stage.name))
  void t1

  /* ══════════════ 5. 建议同源 + 扫描排序 + 跳过已结案 ══════════════ */
  check('health 内含阶段建议', Array.isArray(h5.suggestions))

  const closed = await caseStore.registerCase({ name: '已结案案件', type: '民商', status: 'closed' })
  void closed
  const all = await computeRegistryHealth(await caseStore.readRegistry())
  check('扫描跳过已结案', all.every((h) => h.status !== 'closed'), all.map((h) => h.status).join(','))
  const withClosed = await computeRegistryHealth(await caseStore.readRegistry(), { includeClosed: true })
  check('includeClosed 可包含已结案', withClosed.some((h) => h.status === 'closed'))
  const scores = all.map((h) => h.completeness.score)
  check('按完整度升序', scores.every((v, i) => i === 0 || scores[i - 1] <= v), scores.join(','))

  /* ══════════════ 6. 内置参考案例的体检结果合理 ══════════════ */
  // 注：内置参考案例现为 待开庭 + 执行 两条（备忘录 #3 起诉讼/非诉各 2 个）。
  const seededAwaiting = Object.values((await caseStore.readRegistry()).cases)
    .find((c) => c.status === 'awaiting_trial')
  check('内置参考案例含待开庭案', seededAwaiting !== undefined)
  const hSeed = await computeCaseHealth(seededAwaiting)
  check('待开庭参考案例完整度较高', hSeed.completeness.score >= 55,
    `score=${hSeed.completeness.score} gaps=${gapFields(hSeed).join(',')}`)

  const seededExecution = Object.values((await caseStore.readRegistry()).cases)
    .find((c) => c.status === 'investigation')
  const hExec = await computeCaseHealth(seededExecution)
  check('执行参考案例要求执行阶段标识', gapFields(hExec).includes('level') === false,
    gapFields(hExec).join(','))

  /* ══════════════ 7. 非诉：常法体检 ══════════════ */
  const p1 = await projectStore.registerProject({
    name: '某制造公司常年法律顾问', projectType: 'retainer', status: 'active',
    leadLawyer: '张律师',
  })
  const ph1 = computeProjectHealth(await projectStore.readProject(p1.projectId), [])
  check('常法缺服务范围被点名', gapFields(ph1).includes('serviceScope'), gapFields(ph1).join(','))
  check('常法缺服务周期被点名', gapFields(ph1).includes('servicePeriod'), gapFields(ph1).join(','))
  check('无台账时标记 stale', ph1.serviceLog.stale === true && ph1.serviceLog.count === 0)

  await projectStore.updateProject(p1.projectId, {
    servicePeriod: { start: iso(-300), end: iso(45) },
    serviceScope: ['合同审查', '法律咨询'],
    contractAmount: '120000',
  })
  const ph2 = computeProjectHealth(await projectStore.readProject(p1.projectId), [])
  check('补服务范围与周期后缺口减少', ph2.completeness.score > ph1.completeness.score,
    `${ph1.completeness.score} → ${ph2.completeness.score}`)
  check('服务期剩余天数正确', ph2.daysToExpiry === 45, String(ph2.daysToExpiry))
  check('仍缺服务期届满关键日期', gapFields(ph2).includes('keyDate:服务期届满'), gapFields(ph2).join(','))

  await serviceStore.upsertService({
    name: '审查采购合同', kind: '合同审查', client: '某制造公司', status: 'done', date: iso(-3), note: '2 小时',
  })
  const ph3 = computeProjectHealth(
    await projectStore.readProject(p1.projectId),
    await serviceStore.listServices(),
  )
  check('补台账后 stale 解除', ph3.serviceLog.stale === false, JSON.stringify(ph3.serviceLog))

  /* ══════════════ 8. 非诉：专项里程碑 ══════════════ */
  const p2 = await projectStore.registerProject({
    name: '某科技公司A轮融资法律尽职调查', projectType: 'special', status: 'active',
    leadLawyer: '王律师', contractAmount: '260000',
    servicePeriod: { start: iso(-100), end: iso(20) },
  })
  const ph4 = computeProjectHealth(await projectStore.readProject(p2.projectId), [])
  check('专项缺交付物里程碑被点名', gapFields(ph4).includes('deliverable'), gapFields(ph4).join(','))

  /* ══════════════ 9. 非诉扫描排序 ══════════════ */
  const allProjects = scanProjects(await projectStore.readRegistry(), await serviceStore.listServices())
  const pScores = allProjects.map((h) => h.completeness.score)
  check('非诉扫描按完整度升序', pScores.every((v, i) => i === 0 || pScores[i - 1] <= v), pScores.join(','))
  check('非诉扫描返回全部非归档项目', allProjects.length >= 4, `count=${allProjects.length}`)

  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`)
  process.exit(failures === 0 ? 0 : 1)
} finally {
  await rm(dataDir, { recursive: true, force: true })
}
