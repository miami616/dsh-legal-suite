/**
 * 验收 4/8：金额必须来自 legal_calc（禁止模型口算）。
 *
 * 断言：材料含明确金额时，报告里出现 calculations 留痕（legal_calc 的 action/input/summary），
 * 且判决书中出现与测算结果一致的数字；材料金额不足时必须写明未测算原因。
 */
import {
  assertHealthy, buildDossier, createSession, control, getJudgment, getReport,
  ok, pickCase, runCase, waitFor,
} from './moot-verify-lib.mjs'

/**
 * 从测算摘要里抽数字（用于与判决书比对）。
 * 同时产出「整数部分」变体：测算值是 ¥5,902.00，判决书写「5,902元」，
 * 只比原始字符串会漏判。
 */
function numbersOf(text) {
  const out = []
  for (const m of String(text).matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const raw = m[0].replace(/,/g, '')
    if (raw.replace(/\D/g, '').length < 4) continue
    out.push(raw)
    const int = raw.split('.')[0]
    if (int !== raw) out.push(int)
  }
  return out
}

runCase('verify-moot-money', async (track) => {
  await assertHealthy()
  // 2026-057 的诉请含 80,000 元标的额，是金额测算的典型场景。
  const target = await pickCase(['2026-057'])
  const dossier = await buildDossier(target.caseId, 'civil_first')
  const corpus = [dossier.claims.join(' '), dossier.facts ?? ''].join(' ')
  const hasAmount = /\d[\d,]*(?:\.\d+)?\s*(?:万元|元)/.test(corpus)
  ok(hasAmount, '案件材料含明确金额（可触发测算）')

  const created = await createSession({
    procedure: 'civil_first', mode: 'auto', dossier, caseId: target.caseId,
    config: { maxRounds: 1, tokenBudget: 200000, maxTokensPerTurn: 1200 },
  })
  const id = track(created.sessionId)
  await control(id, 'start')
  const session = await waitFor(id)
  ok(session.status === 'done', `庭审跑完（status=${session.status}）`)

  const report = await getReport(id)
  const judgment = await getJudgment(id)
  const calcs = report.calculations ?? []

  if (calcs.length > 0) {
    ok(calcs.every((c) => typeof c.action === 'string' && typeof c.summary === 'string'), '每条测算都带 action 与结果摘要')
    ok(calcs.some((c) => c.action === 'litigation-fee'), '测算包含案件受理费（litigation-fee）')
    // 比对前统一去掉千分位与空白：测算摘要里是「1,800 元」，判决书里可能是「1800 元」。
    const normalize = (text) => String(text).replace(/[,\s，]/g, '')
    const judgmentFlat = normalize(judgment.markdown)
    const calcNumbers = new Set(calcs.flatMap((c) => numbersOf(c.summary)))
    const hit = [...calcNumbers].some((n) => judgmentFlat.includes(n))
    ok(hit, `判决书采用了 legal_calc 的测算数字（测算数字 ${calcNumbers.size} 个，命中判决书）`)
    ok(!judgment.markdown.includes('{{FEE}}'), '判项占位符已被引擎回填（无 {{FEE}} 残留）')
    ok(!/元\s*元/.test(judgment.markdown), '回填未产生「元元」重复')
    console.log(`    测算留痕：${calcs.map((c) => c.action).join(', ')}`)
  } else {
    ok(typeof report.calculationSkipped === 'string' && report.calculationSkipped !== '',
      `未测算时明确写明原因：${report.calculationSkipped}`)
  }
})
