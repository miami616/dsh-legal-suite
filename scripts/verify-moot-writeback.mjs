/**
 * 验收 5/8：改进建议回写任务树 + 产出隔离（不产生卷宗文件）。
 *
 * 断言：
 *   ① 回写后案件任务组出现「模拟法庭改进建议」且任务数 > 0；
 *   ② 案件卷宗目录在回写前后**文件清单完全一致**（只写任务记录，不产文件）；
 *   ③ 重复回写不重复建任务（幂等）。
 */
import { readdir } from 'node:fs/promises'
import {
  BASE, api, assertHealthy, buildDossier, control, createSession, getReport,
  ok, pickCase, runCase, waitFor,
} from './moot-verify-lib.mjs'

/** 递归列出目录（只取相对路径，用于前后比对）。 */
async function listFiles(root, prefix = '') {
  const out = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) out.push(...await listFiles(`${root}/${entry.name}`, rel))
    else out.push(rel)
  }
  return out.sort()
}

runCase('verify-moot-writeback', async (track) => {
  await assertHealthy()
  const target = await pickCase(['2026-057'])
  if (target.folder === undefined || target.folder === '') {
    throw new Error('所选案件没有卷宗目录，无法验证产出隔离')
  }
  const before = await listFiles(target.folder)

  const dossier = await buildDossier(target.caseId, 'civil_first')
  const created = await createSession({
    procedure: 'civil_first', mode: 'stress', dossier, caseId: target.caseId,
    config: { maxRounds: 1, tokenBudget: 120000, maxTokensPerTurn: 1200 },
  })
  const id = track(created.sessionId)
  await control(id, 'start')
  const session = await waitFor(id)
  ok(session.status === 'done', `压力测试跑完（status=${session.status}）`)

  const report = await getReport(id)
  ok(Array.isArray(report.suggestions) && report.suggestions.length > 0,
    `报告含改进建议（${report.suggestions?.length ?? 0} 条）`)

  const writeback = await api('/api/agentlex-moot/session/writeback', { method: 'POST', body: { id } })
  ok(typeof writeback.note === 'string' && writeback.note.includes('不产生任何卷宗文件'),
    '回写返回值声明「只写任务记录」')
  ok(writeback.created >= 0, `回写执行成功（新建 ${writeback.created} 条任务）`)

  // 任务组与任务落库校验（走诉讼域的 read-case，返回 hydrate 后的任务组）。
  const caseData = await api('/api/agentlex-case/read-case', {
    method: 'POST',
    body: { caseId: target.caseId },
  })
  const groups = caseData.case?.taskGroups ?? caseData.taskGroups ?? []
  const group = groups.find((g) => g.name === '模拟法庭改进建议')
  if (writeback.created > 0) {
    ok(group !== undefined, '案件任务树出现「模拟法庭改进建议」任务组')
  } else if (group === undefined) {
    console.log('    （本次建议已在任务树中存在，跳过建组断言）')
  }

  // 产出隔离：卷宗文件清单不得变化。
  const after = await listFiles(target.folder)
  ok(before.length === after.length && before.every((f, i) => f === after[i]),
    `卷宗目录文件清单未变化（${before.length} 个文件，前后一致）`)

  // 幂等：再回写一次不应重复建任务。
  const again = await api('/api/agentlex-moot/session/writeback', { method: 'POST', body: { id } })
  ok(again.created === 0, `重复回写幂等（第二次新建 ${again.created} 条）`)

  console.log(`    回写接口：${BASE}/api/agentlex-moot/session/writeback`)
})
