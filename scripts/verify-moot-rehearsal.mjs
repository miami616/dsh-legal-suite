/**
 * 验收 9/10：单方预演模式（rehearsal）—— 律师本人参与发言。
 *
 * 这是三种模式里唯一由人驱动的一环，断言：
 *   ① 引擎在我方发言节点挂起（status=waiting），不自行代替我方说话；
 *   ② intervene 提交的发言进入庭审记录（actor=user，带律师本人标注）；
 *   ③ 每提交一次引擎继续推进，直到跑完并产出判决书；
 *   ④ 全程至少发生 3 次真实交互（说明我方发言确实由人提供，而非模型代打）。
 */
import {
  assertHealthy, buildDossier, control, createSession, getJudgment, getSession,
  getTranscript, intervene, ok, pickCase, runCase, waitFor,
} from './moot-verify-lib.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 我方发言内容（模拟律师在不同阶段的真实发言）。 */
const SPEECHES = [
  '我方对原告主张的债权到期性不予认可：代销合同2.3.1条约定的返还前提是清场、保修期届满与结算完成，三项条件均未成就，原告未举证证明条件已具备。',
  '我方补充举证：2020年3月3日质保金收据（编号0202380）载明收取4万元，2021年7月3日收据载明收取部分，均未结算；请求法庭责令原告就结算完成举证。',
  '原告主张第三人怠于行使权利，但未证明第三人客观上不能行使；我方认为代位权构成要件不成立。',
  '我方最后陈述：请求驳回原告的全部诉讼请求，诉讼费由原告负担。',
]

runCase('verify-moot-rehearsal', async (track) => {
  await assertHealthy()
  const target = await pickCase(['2026-057'])
  const dossier = await buildDossier(target.caseId, 'civil_first')

  const created = await createSession({
    procedure: 'civil_first', mode: 'rehearsal', dossier, caseId: target.caseId,
    config: { maxRounds: 1, tokenBudget: 200000, maxTokensPerTurn: 1200 },
  })
  const id = track(created.sessionId)
  await control(id, 'start')

  // ① 引擎必须在我方节点挂起等待。
  let sawWaiting = false
  const waitDeadline = Date.now() + 240_000
  while (Date.now() < waitDeadline) {
    const s = await getSession(id)
    if (s.status === 'waiting') { sawWaiting = true; break }
    if (['done', 'failed', 'aborted'].includes(s.status)) break
    await sleep(1500)
  }
  ok(sawWaiting, '我方发言节点挂起等待（status=waiting，引擎不代我方说话）')

  // ②/③ 逐个提交我方发言，直到庭审结束。
  let submitted = 0
  const deadline = Date.now() + 900_000
  while (Date.now() < deadline) {
    const s = await getSession(id)
    if (['done', 'failed', 'aborted'].includes(s.status)) break
    if (s.status === 'waiting') {
      const text = SPEECHES[Math.min(submitted, SPEECHES.length - 1)]
      try {
        await intervene(id, text)
        submitted += 1
        console.log(`    · 提交我方发言 #${submitted}（${text.slice(0, 24)}…）`)
      } catch (error) {
        // 竞态：引擎可能刚好离开 waiting；忽略并继续轮询。
        if (submitted === 0) console.log(`    （首次提交被拒：${error.message}）`)
      }
    }
    await sleep(1500)
  }

  const session = await getSession(id)
  ok(session.status === 'done', `预演庭审跑完（status=${session.status}${session.error === undefined ? '' : ' error=' + session.error}）`)
  ok(submitted >= 3, `律师实际参与发言 ${submitted} 次（≥3 次说明我方发言由人提供）`)

  const entries = await getTranscript(id)
  const userEntries = entries.filter((e) => e.actor === 'user')
  ok(userEntries.length >= 3, `庭审记录含 ${userEntries.length} 条我方本人发言（actor=user）`)
  ok(userEntries.some((e) => e.roleLabel.includes('律师本人')), '我方发言带「律师本人」标注（与模型扮演区分）')
  ok(userEntries.some((e) => SPEECHES.some((sp) => e.text.includes(sp.slice(0, 20)))), '提交的原话原样进入庭审记录')

  const judgment = await getJudgment(id)
  ok(judgment.markdown.length > 500, `预演后仍产出判决书（${judgment.markdown.length} 字符）`)
})
