/**
 * 验收 8/8：商事仲裁 —— 管辖确认、不公开审理、一裁终局。
 *
 * 断言：开庭准备阶段确认仲裁协议效力/管辖；记录含不公开审理表述；
 * 报告程序性提示含一裁终局与撤销裁决救济口径；裁决书尾部含终局表述。
 */
import {
  assertHealthy, buildDossier, createSession, control, getJudgment, getReport,
  getSession, getTranscript, ok, pickCase, runCase, waitFor,
} from './moot-verify-lib.mjs'

runCase('verify-moot-arbitration', async (track) => {
  await assertHealthy()
  const target = await pickCase(['2026-057'])
  const dossier = await buildDossier(target.caseId, 'commercial_arb')
  const created = await createSession({
    procedure: 'commercial_arb', mode: 'auto', dossier, caseId: target.caseId, tribunal: 'arb_panel',
    config: { maxRounds: 1, tokenBudget: 200000, maxTokensPerTurn: 1200 },
  })
  const id = track(created.sessionId)
  ok(created.tribunal === 'arb_panel' || created.tribunal === undefined, '三人仲裁庭已生效')
  await control(id, 'start')
  const session = await waitFor(id)
  ok(session.status === 'done', `商事仲裁庭审跑完（status=${session.status}）`)

  const settled = await getSession(id)
  ok(settled.tribunal === 'arb_panel', `法庭组成为三人仲裁庭（${settled.tribunal}）`)

  const entries = await getTranscript(id)
  const text = entries.map((e) => e.text).join('\n')
  ok(/仲裁协议|管辖/.test(text), '开庭准备确认了仲裁协议效力/管辖')
  ok(/不公开/.test(text), '记录含不公开审理表述')

  const report = await getReport(id)
  const notes = (report.proceduralNotes ?? []).join(' ')
  ok(/一裁终局/.test(notes), '程序性提示含一裁终局')
  ok(/撤销/.test(notes), '程序性提示含撤销裁决的救济口径')

  const judgment = await getJudgment(id)
  ok(judgment.markdown.includes('仲裁裁决书'), '产出文书为仲裁裁决书')
  ok(/终局裁决/.test(judgment.markdown), '裁决书尾部含终局裁决表述')
})
