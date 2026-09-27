/**
 * 验收 7/8：劳动仲裁 —— 调解为必走阶段 + 45 日时限口径。
 *
 * 断言：庭审记录里出现「调解」阶段（仲裁庭必须先调解），且报告程序性提示含
 * 45 日审限与终局裁决口径。
 */
import {
  assertHealthy, buildDossier, createSession, control, getReport, getTranscript,
  ok, pickCase, runCase, waitFor,
} from './moot-verify-lib.mjs'

runCase('verify-moot-labor', async (track) => {
  await assertHealthy()
  const target = await pickCase(['2026-057'])
  const dossier = await buildDossier(target.caseId, 'labor_arb')
  const created = await createSession({
    procedure: 'labor_arb', mode: 'auto', dossier, caseId: target.caseId, tribunal: 'arb_solo',
    config: { maxRounds: 1, tokenBudget: 160000, maxTokensPerTurn: 1000 },
  })
  const id = track(created.sessionId)
  await control(id, 'start')
  const session = await waitFor(id)
  ok(session.status === 'done', `劳动仲裁庭审跑完（status=${session.status}）`)

  const entries = await getTranscript(id)
  const phases = [...new Set(entries.map((e) => e.phaseTitle))]
  console.log(`    阶段序列：${phases.join(' → ')}`)
  ok(phases.includes('调解'), '庭审含「调解」阶段（仲裁庭裁决前先行调解）')
  ok(phases.includes('裁决'), '庭审含「裁决」阶段')
  const mediationIdx = entries.findIndex((e) => e.phaseTitle === '调解')
  const debateIdx = entries.findIndex((e) => e.phaseTitle === '仲裁庭辩论')
  const firstMediation = entries.findIndex((e) => e.phaseTitle === '调解')
  ok(debateIdx >= 0 && firstMediation > debateIdx, '调解发生在辩论之后（程序顺序正确）')
  ok(mediationIdx >= 0, '调解阶段有发言记录')

  const report = await getReport(id)
  const notes = (report.proceduralNotes ?? []).join(' ')
  ok(/45\s*日/.test(notes), '程序性提示含 45 日审限')
  ok(/终局/.test(notes), '程序性提示含终局裁决口径')
})
