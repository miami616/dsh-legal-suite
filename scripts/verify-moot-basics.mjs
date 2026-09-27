/**
 * 验收 1/8：全链路基本可用（民事一审 · 全自动演练）。
 *
 * 断言：建会话 → 开庭 → 跑完（status=done）→ 四件产物齐全且内容非空。
 * 这是唯一跑完整「三段判决书」的用例，其余用例走更省的模式。
 */
import {
  assertHealthy, assertReportShape, buildDossier, createSession, control,
  getIssues, getJudgment, getReport, getTranscript, ok, pickCase, prepare, runCase, waitFor,
} from './moot-verify-lib.mjs'

runCase('verify-moot-basics', async (track) => {
  await assertHealthy()

  const target = await pickCase(['2026-057'])
  console.log(`    使用案件：${target.caseId} ${target.name}`)
  const dossier = await buildDossier(target.caseId, 'civil_first')
  ok((dossier.claims ?? []).length > 0, '快照抽取到诉讼请求')
  ok((dossier.parties ?? []).length > 0, '快照抽取到当事人')
  ok((dossier.cause ?? '') !== '', '快照抽取到案由')

  const readiness = await prepare('civil_first', dossier)
  ok(readiness.ready === true, '材料就绪检查通过（无阻断项）')

  const created = await createSession({
    procedure: 'civil_first',
    mode: 'auto',
    dossier,
    caseId: target.caseId,
    config: { maxRounds: 1, tokenBudget: 200000, maxTokensPerTurn: 1200 },
  })
  const id = track(created.sessionId)
  ok(typeof id === 'string' && id.startsWith('mt-'), `建会话成功：${id}`)

  await control(id, 'start')
  const session = await waitFor(id)
  ok(session.status === 'done', `庭审跑完（status=${session.status}${session.error === undefined ? '' : ' error=' + session.error}）`)

  const entries = await getTranscript(id)
  ok(entries.length >= 8, `庭审记录非空（${entries.length} 条）`)
  ok(entries.some((e) => e.kind === 'procedure'), '记录含程序性话术（硬编码，不耗模型）')

  const issues = await getIssues(id)
  ok(issues.length > 0, `归纳出争议焦点（${issues.length} 个）`)

  const report = await getReport(id)
  assertReportShape(report)

  const judgment = await getJudgment(id)
  ok(judgment.markdown.length > 500, `判决书已生成（${judgment.markdown.length} 字符）`)
  ok(judgment.markdown.includes('本院查明') && judgment.markdown.includes('本院认为'), '判决书含「本院查明」「本院认为」')
  ok(judgment.markdown.includes(report.disclaimers[0]), '判决书含免责声明原文')
})
