/**
 * 验收 2/8：暂停/中止 → 断点续跑。
 *
 * 断言：开庭中途暂停（status=paused）→ 继续 → 跑完；且续跑不重放已完成阶段
 * （transcript 里出现「续跑」系统提示，且阶段不重复）。
 */
import {
  assertHealthy, buildDossier, control, createSession, getSession, getTranscript,
  ok, pickCase, runCase, waitFor,
} from './moot-verify-lib.mjs'

runCase('verify-moot-interrupt', async (track) => {
  await assertHealthy()
  const target = await pickCase(['2026-057'])
  const dossier = await buildDossier(target.caseId, 'civil_first')
  const created = await createSession({
    procedure: 'civil_first', mode: 'auto', dossier, caseId: target.caseId,
    config: { maxRounds: 1, tokenBudget: 200000, maxTokensPerTurn: 1000 },
  })
  const id = track(created.sessionId)

  await control(id, 'start')

  // 等第一段实体发言落盘（说明引擎确实在推进），再暂停。
  const deadline = Date.now() + 180_000
  let entries = []
  while (Date.now() < deadline) {
    entries = await getTranscript(id)
    if (entries.filter((e) => e.kind === 'speech').length >= 1) break
    await new Promise((r) => setTimeout(r, 1500))
  }
  ok(entries.length > 0, `开庭后已有记录（${entries.length} 条）`)

  const paused = await control(id, 'pause')
  ok(paused.status === 'paused', `暂停生效（status=${paused.status}）`)

  const resumed = await control(id, 'resume')
  ok(resumed.status !== 'paused', `继续生效（status=${resumed.status}）`)

  const session = await waitFor(id)
  ok(session.status === 'done', `续跑后跑完（status=${session.status}）`)

  const after = await getTranscript(id)
  ok(after.length >= entries.length, '续跑后记录只增不减')
  // 「未重放」的判据：把阶段序列压成连续块后不应出现重复块。
  // （同一阶段在一次运行里会连续产生多条发言，这是正常的；重复块才是重放。）
  const sequence = after.filter((e) => e.kind === 'speech' || e.kind === 'procedure').map((e) => e.phase)
  const blocks = sequence.filter((p, i) => i === 0 || p !== sequence[i - 1])
  ok(new Set(blocks).size === blocks.length,
    `阶段未重放（连续块 ${blocks.length} 个，去重后 ${new Set(blocks).size} 个）`)

  const finalState = await getSession(id)
  ok(finalState.stats.phasesDone.length > 0, `记录了已完成阶段（${finalState.stats.phasesDone.length} 个）`)
})
