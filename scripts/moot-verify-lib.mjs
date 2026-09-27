/**
 * 模拟法庭验收脚本共用库。
 *
 * 约定：
 *   • 只打测试实例（DSH_TEST_PORT，默认 3081），**绝不碰 live 3080**；
 *   • 所有断言失败即抛错并以非零码退出，便于 CI 与人工核对；
 *   • 会话用完即删（`--keep` 可保留以便人工查看面板）。
 *
 * 用法：node scripts/verify-moot-basics.mjs [--keep]
 */
const PORT = process.env.DSH_TEST_PORT ?? '3081'

/** 测试实例基址。 */
export const BASE = `http://127.0.0.1:${PORT}`

if (PORT === '3080') {
  console.error('拒绝在 live 3080 上运行验收脚本（硬性规则：只在测试实例验证）。')
  process.exit(2)
}

/** 是否保留会话（人工查看用）。 */
export const KEEP = process.argv.includes('--keep')

/** 断言。 */
export function ok(cond, message) {
  if (!cond) throw new Error(`断言失败：${message}`)
  console.log(`  ✓ ${message}`)
}

/** 调用 API 并拆包络。 */
export async function api(path, options = {}) {
  const { method = 'GET', body } = options
  const res = await fetch(BASE + path, {
    method,
    ...(body === undefined ? {} : {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`${path} 返回非 JSON（HTTP ${res.status}）：${text.slice(0, 200)}`)
  }
  if (json.success !== true) {
    throw new Error(`${path} 失败：${json.error ?? '未知错误'}${json.hint === undefined ? '' : ` / ${json.hint}`}`)
  }
  return json.data
}

/** 健康检查（脚本都先跑这一步，确保实例与插件在线）。 */
export async function assertHealthy() {
  const health = await api('/api/agentlex-moot/health')
  ok(health.ok === true, `插件在线（llmAvailable=${health.llmAvailable}）`)
  ok(health.llmAvailable === true, 'llm 服务可用（引擎可发起模型调用）')
  return health
}

/** 构建案件快照。 */
export async function buildDossier(caseId, procedure, overrides) {
  return api('/api/agentlex-moot/dossier', {
    method: 'POST',
    body: { caseId, procedure, ...(overrides === undefined ? {} : { overrides }) },
  })
}

/** 材料就绪度检查。 */
export async function prepare(procedure, dossier) {
  return api('/api/agentlex-moot/session/prepare', { method: 'POST', body: { procedure, dossier } })
}

/** 建会话（返回归一化结果：sessionId 与 id 等价，便于脚本统一使用）。 */
export async function createSession({ procedure, mode, dossier, caseId, tribunal, config, title }) {
  const payload = {
    procedure,
    mode,
    dossier,
    ...(caseId === undefined ? {} : { caseId }),
    ...(tribunal === undefined ? {} : { tribunal }),
    ...(title === undefined ? {} : { title }),
    config: {
      retrievalEnabled: true,
      maxRounds: 1,
      tokenBudget: 60000,
      maxTokensPerTurn: 1200,
      opponentTemperature: 0.9,
      ...(config ?? {}),
    },
  }
  // 路由返回 TrialSession（标识字段为 id）；这里补一个 sessionId 别名，
  // 与 moot_court 工具的返回值口径对齐。
  const created = await api('/api/agentlex-moot/session/create', { method: 'POST', body: payload })
  return { ...created, sessionId: created.id }
}

/** 列出全部会话（清理孤儿用）。 */
export async function listSessions() {
  return api('/api/agentlex-moot/sessions')
}

/** 控制。 */
export async function control(sessionId, action) {
  return api('/api/agentlex-moot/session/control', { method: 'POST', body: { id: sessionId, action } })
}

/** 单方预演发言。 */
export async function intervene(sessionId, text) {
  return api('/api/agentlex-moot/session/intervene', { method: 'POST', body: { id: sessionId, text } })
}

/** 读会话。 */
export async function getSession(sessionId) {
  return api(`/api/agentlex-moot/session?id=${encodeURIComponent(sessionId)}`)
}

/** 读庭审记录（增量）。 */
export async function getTranscript(sessionId, since = 0) {
  return api(`/api/agentlex-moot/session/transcript?id=${encodeURIComponent(sessionId)}&since=${since}`)
}

/** 读争点。 */
export async function getIssues(sessionId) {
  return api(`/api/agentlex-moot/session/issues?id=${encodeURIComponent(sessionId)}`)
}

/** 读报告（未生成返回 null）。 */
export async function getReport(sessionId) {
  return api(`/api/agentlex-moot/session/report?id=${encodeURIComponent(sessionId)}`)
}

/** 读判决书。 */
export async function getJudgment(sessionId) {
  return api(`/api/agentlex-moot/session/judgment?id=${encodeURIComponent(sessionId)}`)
}

/** 删除会话。 */
export async function removeSession(sessionId) {
  return api('/api/agentlex-moot/session/delete', { method: 'POST', body: { id: sessionId } })
}

/** 轮询直到终态。 */
export async function waitFor(sessionId, options = {}) {
  const timeoutMs = options.timeoutMs ?? 900_000
  const intervalMs = options.intervalMs ?? 2000
  const terminal = options.terminal ?? ['done', 'failed', 'aborted']
  const started = Date.now()
  let last = ''
  for (;;) {
    const session = await getSession(sessionId)
    if (session.status !== last) {
      last = session.status
      console.log(`    · 状态 ${session.status}（阶段 ${session.phase || '-'}，tokens ${session.stats.tokensUsed}）`)
    }
    if (terminal.includes(session.status)) return session
    if (Date.now() - started > timeoutMs) {
      throw new Error(`等待超时（${timeoutMs}ms）：会话停留在 ${session.status}`)
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}

/** 用例骨架：捕获异常、输出结果、按需清理。 */
export async function runCase(name, fn) {
  console.log(`\n=== ${name} ===`)
  const started = Date.now()
  const created = []
  const track = (id) => { created.push(id); return id }
  try {
    await fn(track)
    console.log(`\nPASS ${name}（${((Date.now() - started) / 1000).toFixed(1)}s）`)
    for (const id of created) {
      if (!KEEP) {
        try { await removeSession(id) } catch { /* 清理失败不影响结论 */ }
      } else {
        console.log(`  （保留会话 ${id}）`)
      }
    }
    process.exit(0)
  } catch (error) {
    console.error(`\nFAIL ${name}：${error instanceof Error ? error.message : String(error)}`)
    for (const id of created) console.error(`  出错会话 id=${id}（未删除，便于排查）`)
    process.exit(1)
  }
}

/** 取一个带《案件信息.md》的案件（验收脚本优先用它，材料最全）。 */
export async function pickCase(prefer = []) {
  const data = await api('/api/agentlex-moot/cases')
  const cases = data.cases ?? []
  for (const id of prefer) {
    const hit = cases.find((c) => c.caseId === id)
    if (hit !== undefined) return hit
  }
  const withInfo = cases.find((c) => c.hasCaseInfo === true)
  if (withInfo !== undefined) return withInfo
  if (cases.length === 0) throw new Error('测试实例里没有可用的案件（请先在诉讼面板登记一个案件）')
  return cases[0]
}

/** 极简断言集合：报告结构完整性。 */
export function assertReportShape(report) {
  ok(report !== null && typeof report === 'object', '报告已生成')
  ok(typeof report.verdict?.summary === 'string' && report.verdict.summary !== '', '报告含倾向性结论')
  ok(typeof report.verdict?.usWinRate === 'number', '报告含倾向性胜算')
  ok(Array.isArray(report.disclaimers) && report.disclaimers.length > 0, '报告含免责声明')
  ok(Array.isArray(report.boundaries) && report.boundaries.length > 0, '报告含模拟边界')
  ok(Array.isArray(report.proceduralNotes) && report.proceduralNotes.length > 0, '报告含程序性提示')
  ok(typeof report.retrieval === 'object', '报告含检索锚定状态')
  ok(typeof report.budget === 'object', '报告含预算状态')
}
