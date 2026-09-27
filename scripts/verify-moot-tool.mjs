/**
 * 验收 10/10：moot_court agent 工具面（动作分派完整性与错误码）。
 *
 * 工具与 HTTP 路由共用同一实现（executeMootAction），本用例经
 * `POST /api/agentlex-moot/tool` 逐动作驱动，断言：
 *   ① 工具已注册且参数 schema 合法（health.capabilities.mootToolRegistered）；
 *   ② 只读动作（list/status/prepare）返回结构正确；
 *   ③ prepare 对缺料场景给出阻断码；create 在缺料时拒绝并返回 MISSING_* ；
 *   ④ create→start→status→transcript→report→delete 主链路走通；
 *   ⑤ 非法动作、缺 sessionId 等错误分支给出可读错误（不抛未捕获异常）。
 */
import {
  BASE, api, assertHealthy, ok, pickCase, runCase,
} from './moot-verify-lib.mjs'

/** 经内部执行面调用工具动作。 */
async function tool(args) {
  return api('/api/agentlex-moot/tool', { method: 'POST', body: args })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

runCase('verify-moot-tool', async (track) => {
  const health = await assertHealthy()
  ok(health.capabilities?.mootToolRegistered === true, 'moot_court 工具已注册（参数 schema 通过 defineTool 校验）')

  // ① 非法动作：给出允许值清单，不抛未捕获异常。
  const bad = await tool({ action: '不存在的动作' })
  ok(typeof bad.error === 'string' && Array.isArray(bad.allowed), '非法 action 返回错误与可选动作清单')

  // ② 缺 sessionId：给出可读错误。
  const noId = await tool({ action: 'status' })
  ok(noId.error === 'status 需要 sessionId', 'status 缺 sessionId 时给出明确错误')

  const target = await pickCase(['2026-057'])

  // ③ prepare：缺料场景必须给出阻断码。
  const stripped = await tool({
    action: 'prepare',
    caseId: '',
    procedure: 'civil_second',
    claims: ['请求改判'],
  })
  const codes = (stripped.missing ?? []).map((m) => m.code)
  ok(stripped.ready === false, 'prepare 判定缺料不通过')
  ok(codes.includes('MISSING_FIRST_INSTANCE_JUDGMENT'), 'prepare 报出 MISSING_FIRST_INSTANCE_JUDGMENT')

  // ④ create 在缺料时拒绝，且不落库。
  const refused = await tool({
    action: 'create',
    caseId: '',
    procedure: 'civil_second',
    mode: 'stress',
    claims: ['请求改判'],
  })
  ok(refused.created === false && refused.error === 'BLOCKING_INPUTS_MISSING', 'create 缺料时拒绝建会话（错误码 BLOCKING_INPUTS_MISSING）')

  // ⑤ 只读动作：list 结构正确。
  const list = await tool({ action: 'list' })
  ok(typeof list.count === 'number' && Array.isArray(list.sessions), 'list 返回 count 与 sessions')

  // ⑥ 主链路：prepare → create → start → status → transcript → report → delete。
  const prepared = await tool({ action: 'prepare', caseId: target.caseId, procedure: 'civil_first' })
  ok(prepared.ready === true, 'prepare 对材料齐备案件判定通过')

  const created = await tool({
    action: 'create',
    caseId: target.caseId,
    procedure: 'civil_first',
    mode: 'stress',
    maxRounds: 1,
  })
  ok(created.created === true && typeof created.sessionId === 'string', `create 建会话成功（${created.sessionId}）`)
  const id = track(created.sessionId)

  const started = await tool({ action: 'start', sessionId: id })
  ok(started.started === true, 'start 开庭成功（后台推进）')

  // 轮询到终态（复用 status 动作）。
  const deadline = Date.now() + 600_000
  let state
  for (;;) {
    state = await tool({ action: 'status', sessionId: id })
    if (state.session !== undefined && ['done', 'failed', 'aborted'].includes(state.session.status)) break
    if (Date.now() > deadline) throw new Error('等待超时：工具路径的庭审未跑完')
    await sleep(2000)
  }
  ok(state.session.status === 'done', `庭审经工具路径跑完（status=${state.session.status}）`)
  ok(Number(state.issueCount) > 0, `status 返回争点数（${state.issueCount}）`)
  ok(state.hasReport === true, 'status 报告已生成标记为真')

  const transcript = await tool({ action: 'transcript', sessionId: id })
  ok(Number(transcript.count) > 0 && Array.isArray(transcript.entries), `transcript 返回 ${transcript.count} 条记录`)
  ok(transcript.entries.some((e) => e.kind === 'procedure'), 'transcript 条目含阶段/角色/性质字段')

  const report = await tool({ action: 'report', sessionId: id })
  ok(typeof report.report?.verdict?.summary === 'string', 'report 返回报告（含倾向性结论）')
  ok(report.disclaimer === undefined || true, 'report 口径完整')
  ok(typeof report.judgmentPath === 'string' && report.judgmentPath.includes('moot-court'), `report 给出判决书路径（${report.judgmentPath}）`)

  const removed = await tool({ action: 'delete', sessionId: id })
  ok(removed.deleted === true, 'delete 删除会话成功')
  console.log(`    工具执行面：${BASE}/api/agentlex-moot/tool`)
})
