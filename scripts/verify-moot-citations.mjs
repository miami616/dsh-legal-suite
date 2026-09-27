/**
 * 验收 3/8：判决引用合规（锚定或明确降级）。
 *
 * 断言（二者必居其一，且必须写明其一）：
 *   A. 有检索结果 → 判决书中出现的法条/案号引用全部落在 citation pool 内；
 *   B. 无检索结果（元典欠费/未接）→ 报告的 retrieval.degraded 有值，判决书含「锚定说明」。
 */
import {
  assertHealthy, buildDossier, createSession, control, getJudgment, getReport,
  ok, pickCase, runCase, waitFor,
} from './moot-verify-lib.mjs'

const LAW_REF = /《[^》]{2,40}》\s*第[一二三四五六七八九十百千零〇\d]+条/g
const CASE_REF = /[（(]\s*\d{4}\s*[)）][^，。；\s]{4,30}号/g

runCase('verify-moot-citations', async (track) => {
  await assertHealthy()
  const target = await pickCase(['2026-057'])
  const dossier = await buildDossier(target.caseId, 'civil_first')
  const created = await createSession({
    procedure: 'civil_first', mode: 'auto', dossier, caseId: target.caseId,
    config: { retrievalEnabled: true, maxRounds: 1, tokenBudget: 200000, maxTokensPerTurn: 1200 },
  })
  const id = track(created.sessionId)

  await control(id, 'start')
  const session = await waitFor(id)
  ok(session.status === 'done', `庭审跑完（status=${session.status}）`)

  const report = await getReport(id)
  const judgment = await getJudgment(id)
  ok(judgment.markdown.length > 0, '判决书已生成')

  const pool = new Set()
  for (const issue of report.issues ?? []) {
    for (const a of issue.anchors?.articles ?? []) pool.add(String(a.ref).replace(/\s+/g, ''))
    for (const c of issue.anchors?.cases ?? []) pool.add(String(c.ref).replace(/\s+/g, ''))
  }

  const refs = [...(judgment.markdown.match(LAW_REF) ?? []), ...(judgment.markdown.match(CASE_REF) ?? [])]
  const degraded = report.retrieval?.degraded

  if (pool.size > 0) {
    const foreign = refs.filter((ref) => {
      const normalized = ref.replace(/\s+/g, '')
      return ![...pool].some((p) => normalized.includes(p) || p.includes(normalized.slice(0, 12)))
    })
    ok(foreign.length === 0, `判决引用全部落在 citation pool 内（pool=${pool.size}，判决引用=${refs.length}）`)
    ok(Number(report.retrieval?.citations) > 0, `报告记录了锚定引用数（${report.retrieval?.citations}）`)
  } else {
    ok(typeof degraded === 'string' && degraded !== '', `无检索结果时明确记录了降级原因：${String(degraded).slice(0, 80)}`)
    ok(judgment.markdown.includes('锚定说明'), '判决书含「锚定说明」段落（提示可检验性下降）')
  }
})
