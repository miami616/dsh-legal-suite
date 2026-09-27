/**
 * 验收 6/8：民事二审 —— 强制输入校验 + 上诉范围锁定。
 *
 * 断言：
 *   ① 缺一审裁判文书时 prepare/create 明确阻断（MISSING_FIRST_INSTANCE_JUDGMENT）；
 *   ② 补齐后开庭，庭审记录含「上诉」相关阶段与上诉请求内容；
 *   ③ 报告的程序性提示含二审特有口径（上诉请求范围/终审）。
 */
import {
  assertHealthy, buildDossier, createSession, control, getIssues, getReport,
  getTranscript, ok, pickCase, prepare, runCase, waitFor,
} from './moot-verify-lib.mjs'

runCase('verify-moot-appellate', async (track) => {
  await assertHealthy()
  const target = await pickCase(['2026-001', '2026-025', '2026-057'])
  const base = await buildDossier(target.caseId, 'civil_second')

  // ① 故意清空一审文书与上诉理由 → 必须阻断。
  const stripped = { ...base, priorJudgment: '', appealGrounds: [], caseName: base.caseName ?? undefined }
  const blocked = await prepare('civil_second', stripped)
  ok(blocked.ready === false, '缺一审文书时就绪检查不通过')
  const codes = (blocked.missing ?? []).map((m) => m.code)
  ok(codes.includes('MISSING_FIRST_INSTANCE_JUDGMENT'), '阻断项含 MISSING_FIRST_INSTANCE_JUDGMENT')
  ok(codes.includes('MISSING_APPEAL_GROUNDS'), '阻断项含 MISSING_APPEAL_GROUNDS')

  // ② 补齐材料（一审文书取卷宗抽取结果，上诉理由手工给）。
  const dossier = {
    ...base,
    priorJudgment: (base.priorJudgment ?? '') !== '' ? base.priorJudgment : (base.facts ?? '一审判决：驳回原告全部诉讼请求。'),
    appealGrounds: ['一审判决认定事实不清：未查明合同履行情况', '一审适用法律错误：违约金标准认定过高'],
  }
  const readiness = await prepare('civil_second', dossier)
  ok(readiness.ready === true, '补齐后材料就绪检查通过')

  const created = await createSession({
    procedure: 'civil_second', mode: 'auto', dossier, caseId: target.caseId, tribunal: 'collegial',
    config: { maxRounds: 1, tokenBudget: 200000, maxTokensPerTurn: 1200 },
  })
  const id = track(created.sessionId)
  await control(id, 'start')
  const session = await waitFor(id)
  ok(session.status === 'done', `二审庭审跑完（status=${session.status}）`)

  const entries = await getTranscript(id)
  const text = entries.map((e) => e.text).join('\n')
  ok(/上诉/.test(text), '庭审记录含上诉请求/理由的内容')
  ok(entries.some((e) => e.text.includes('二审') || e.text.includes('一审判决')), '记录中出现二审审理对象表述')

  const issues = await getIssues(id)
  ok(issues.length > 0, `归纳出二审争议焦点（${issues.length} 个）`)

  const report = await getReport(id)
  const notes = (report.proceduralNotes ?? []).join(' ')
  ok(/终审|上诉请求|二审/.test(notes), '程序性提示含二审特有口径')
})
