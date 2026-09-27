/**
 * dsh-legal-suite/moot-court — host 路由族：/api/agentlex-moot/*。
 *
 * 与其它域同构：同源 POST/GET + JSON 包络 `{success:true,data} | {success:false,error,hint?}`；
 * 所有 id 参数都做路径安全校验；body 当不可信输入克隆处理。
 *
 * 路由清单（与 client/api.ts 一一对应）：
 *   GET  /health                          健康检查
 *   GET  /sessions                        会话列表
 *   GET  /session                         单会话
 *   GET  /session/transcript              庭审记录（?since= 增量）
 *   GET  /session/issues                  争点
 *   GET  /session/report                  报告
 *   GET  /session/judgment                判决书 markdown
 *   GET  /models                          可选模型路由（向导）
 *   GET  /cases                           案件列表（向导）
 *   POST /session/create                  建会话（含快照）
 *   POST /session/delete                  删除会话
 *   POST /session/control                 开始/暂停/继续/中止/快进
 *   POST /session/intervene               单方预演：我方发言
 *   POST /session/writeback               改进建议 → 诉讼任务树（只写任务，不产文件）
 *   POST /session/prepare                 材料就绪度 dry-run
 *   POST /dossier                         构建案件快照（向导预览）
 *   GET  /events-stream                   SSE 变更流
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context, Events } from '@deepseek-ai/cordis'
import { assertSafePathSegment } from '../task/store/file-store.ts'
import type { MootStore } from './store/session-store.ts'
import type { Orchestrator } from './engine/orchestrator.ts'
import type { LlmGateway, ModelRoute } from './engine/llm.ts'
import { buildDossier, checkReadiness, emptyDossier, listCases, type DossierOverrides } from './engine/dossier.ts'
import { getPlaybook } from './playbook/index.ts'
import { readLitigationCase, upsertLitigationGroup, upsertLitigationTask } from './engine/host-api.ts'
import { findCaseTools, findLawTools } from './engine/retrieval.ts'
import { listToolNames } from './engine/tool-call.ts'
import { executeMootAction, type ToolDeps } from './tools.ts'
import {
  PROCEDURE_LABEL,
  type ApiResponse,
  type Dossier,
  type Mode,
  type MootRunConfig,
  type Procedure,
  type Tribunal,
} from './store/types.ts'

/** 变更事件名（客户端 SSE 监听）。 */
export const MOOT_CHANGED_EVENT = 'agentlex:moot-changed'

/** 路由依赖。 */
export interface RouteDeps {
  ctx: Context
  store: MootStore
  orchestrator: Orchestrator
  gateway: LlmGateway
  /** 诉讼域数据目录（读案件登记构建快照）。 */
  litigationDir: string
  /** 默认运行配置（来自插件配置）。 */
  defaults: {
    judgeModel?: string
    opponentModel?: string
    retrievalEnabled: boolean
    maxRounds: number
    tokenBudget: number
    maxTokensPerTurn: number
  }
}

/* ─────────────────────────── HTTP 工具 ─────────────────────────── */

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (raw.length === 0) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? { ...(parsed as Record<string, unknown>) }
      : {}
  } catch {
    return {}
  }
}

function sendJson(res: ServerResponse, status: number, body: ApiResponse): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function ok<T>(res: ServerResponse, data: T): void {
  sendJson(res, 200, { success: true, data })
}

function fail(res: ServerResponse, error: unknown, status = 400, hint?: string): void {
  const message = error instanceof Error ? error.message : String(error)
  sendJson(res, status, hint === undefined ? { success: false, error: message } : { success: false, error: message, hint })
}

/** 安全的字符串取值。 */
function str(value: unknown, fallback = ''): string {
  return value === undefined || value === null ? fallback : String(value)
}

/** 归一程序 id。 */
function asProcedure(value: unknown): Procedure {
  const raw = str(value)
  if (raw === 'civil_first' || raw === 'civil_second' || raw === 'labor_arb' || raw === 'commercial_arb') return raw
  throw new Error(`unknown procedure: ${raw}`)
}

/** 归一模式 id。 */
function asMode(value: unknown): Mode {
  const raw = str(value, 'auto')
  if (raw === 'stress' || raw === 'auto' || raw === 'rehearsal') return raw
  throw new Error(`unknown mode: ${raw}`)
}

/** 归一法庭组成，缺省取程序默认。 */
function asTribunal(value: unknown, procedure: Procedure): Tribunal {
  const raw = str(value)
  const playbook = getPlaybook(procedure)
  const allowed = playbook.tribunals
  if (raw === '') return playbook.defaultTribunal
  if ((allowed as string[]).includes(raw)) return raw as Tribunal
  return playbook.defaultTribunal
}

/** 归一运行配置（缺项落默认）。 */
function asConfig(value: unknown, defaults: RouteDeps['defaults']): MootRunConfig {
  const raw = value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
  const maxRounds = Number(raw['maxRounds'] ?? defaults.maxRounds)
  const tokenBudget = Number(raw['tokenBudget'] ?? defaults.tokenBudget)
  const maxTokensPerTurn = Number(raw['maxTokensPerTurn'] ?? defaults.maxTokensPerTurn)
  const temperature = Number(raw['opponentTemperature'] ?? 0.9)
  const judgeModel = str(raw['judgeModel'], defaults.judgeModel ?? '')
  const opponentModel = str(raw['opponentModel'], defaults.opponentModel ?? '')
  const province = str(raw['retrievalProvince'])
  return {
    ...(judgeModel === '' ? {} : { judgeModel }),
    ...(opponentModel === '' ? {} : { opponentModel }),
    retrievalEnabled: raw['retrievalEnabled'] === undefined ? defaults.retrievalEnabled : raw['retrievalEnabled'] === true,
    ...(province === '' ? {} : { retrievalProvince: province }),
    maxRounds: Number.isFinite(maxRounds) ? Math.max(1, Math.min(6, Math.round(maxRounds))) : defaults.maxRounds,
    tokenBudget: Number.isFinite(tokenBudget) ? Math.max(20_000, Math.min(2_000_000, Math.round(tokenBudget))) : defaults.tokenBudget,
    maxTokensPerTurn: Number.isFinite(maxTokensPerTurn) ? Math.max(600, Math.min(8000, Math.round(maxTokensPerTurn))) : defaults.maxTokensPerTurn,
    opponentTemperature: Number.isFinite(temperature) ? Math.max(0, Math.min(1.5, temperature)) : 0.9,
  }
}

/** 归一快照（来自向导）。 */
function asDossier(value: unknown): Dossier {
  const raw = value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()) : []
  const base = emptyDossier({
    claims: strings(raw['claims']),
    ...(str(raw['facts']) === '' ? {} : { facts: str(raw['facts']) }),
    ...(str(raw['brief']) === '' ? {} : { brief: str(raw['brief']) }),
    ...(str(raw['priorJudgment']) === '' ? {} : { priorJudgment: str(raw['priorJudgment']) }),
    ...(strings(raw['appealGrounds']).length === 0 ? {} : { appealGrounds: strings(raw['appealGrounds']) }),
    ...(Array.isArray(raw['evidence'])
      ? {
        evidence: (raw['evidence'] as unknown[]).flatMap((entry) => {
          if (entry === null || typeof entry !== 'object') return []
          const item = entry as Record<string, unknown>
          const name = str(item['name']).trim()
          if (name === '') return []
          const no = str(item['no']).trim()
          const purpose = str(item['purpose']).trim()
          return [{ no: no === '' ? '证据' : no, name, ...(purpose === '' ? {} : { purpose }) }]
        }),
      }
      : {}),
  })
  // 补充来自客户端快照的其余字段（案件信息、当事人等），保持原样。
  const merged: Dossier = {
    ...base,
    ...(str(raw['caseId']) === '' ? {} : { caseId: str(raw['caseId']) }),
    ...(str(raw['caseName']) === '' ? {} : { caseName: str(raw['caseName']) }),
    ...(str(raw['cause']) === '' ? {} : { cause: str(raw['cause']) }),
    ...(str(raw['court']) === '' ? {} : { court: str(raw['court']) }),
    ...(str(raw['caseNumber']) === '' ? {} : { caseNumber: str(raw['caseNumber']) }),
    ...(str(raw['level']) === '' ? {} : { level: str(raw['level']) }),
    ...(str(raw['ourRole']) === '' ? {} : { ourRole: str(raw['ourRole']) }),
    ...(str(raw['theirRole']) === '' ? {} : { theirRole: str(raw['theirRole']) }),
    parties: Array.isArray(raw['parties'])
      ? (raw['parties'] as unknown[]).flatMap((entry) => {
        if (entry === null || typeof entry !== 'object') return []
        const item = entry as Record<string, unknown>
        const name = str(item['name']).trim()
        if (name === '') return []
        return [{ name, role: str(item['role']).trim(), ourClient: item['ourClient'] === true }]
      })
      : [],
    materials: Array.isArray(raw['materials'])
      ? (raw['materials'] as unknown[]).flatMap((entry) => {
        if (entry === null || typeof entry !== 'object') return []
        const item = entry as Record<string, unknown>
        const name = str(item['name']).trim()
        if (name === '') return []
        const note = str(item['note']).trim()
        return [{ name, ...(note === '' ? {} : { note }) }]
      })
      : [],
    sources: strings(raw['sources']).length === 0 ? ['向导提供'] : strings(raw['sources']),
  }
  return merged
}

/* ─────────────────────────── 路由注册 ─────────────────────────── */

/**
 * 注册全部 moot-court 路由。
 * @returns disposer 移除路由与 SSE 连接。
 */
export function makeRoutes(deps: RouteDeps): () => void {
  const { ctx, store, orchestrator, gateway, litigationDir, defaults } = deps
  const disposers: Array<() => void> = []
  // 工具面与路由面共用同一份依赖（同一 store / orchestrator 实例）。
  const toolDeps: ToolDeps = { store, orchestrator, litigationDir, defaults }

  // ── SSE：变更广播 ──────────────────────────────────────────
  const sseClients = new Set<ServerResponse>()
  const broadcast = (payload: unknown): void => {
    const data = `data: ${JSON.stringify(payload)}\n\n`
    for (const res of sseClients) {
      try { res.write(data) } catch { /* 客户端已断开 */ }
    }
  }
  const disposeListener = ctx.on(MOOT_CHANGED_EVENT as keyof Events, (payload: unknown) => broadcast(payload))
  disposers.push(() => {
    disposeListener()
    for (const res of sseClients) { try { res.end() } catch { /* noop */ } }
    sseClients.clear()
  })

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/api/agentlex-moot/events-stream',
    handler: (req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      res.write('retry: 3000\n\n')
      sseClients.add(res)
      req.on('close', () => { sseClients.delete(res) })
    },
  }))

  // ── 健康检查 ──────────────────────────────────────────────
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/api/agentlex-moot/health',
    handler: async (_req: IncomingMessage, res: ServerResponse) => {
      ok(res, {
        ok: true,
        plugin: 'dsh-legal-suite/moot-court',
        status: 'ready',
        llmAvailable: gateway.available(),
        dataDir: store.dataDir,
        // 能力诊断：host 域能看到哪些工具。检索锚定依赖元典 MCP 工具在
        // host 平面的可见性——为空时判决会走「未锚定」降级路径。
        capabilities: {
          toolsVisible: listToolNames(ctx).length,
          mcpTools: listToolNames(ctx, 'mcp__').slice(0, 12),
          mootToolRegistered: listToolNames(ctx).includes('moot_court'),
          lawTools: findLawTools(ctx),
          caseTools: findCaseTools(ctx),
        },
      })
    },
  }))

  // ── 模型连通性自检（运维/排障） ────────────────────────────
  // 庭审引擎依赖 ctx.llm 直连部署模型路由；health 只能说「服务在」，说不了
  // 「调用能出字」。这里真发一次极短请求，回报路由、正文、token 与终止原因——
  // 排障时一眼能看出是路由解析、上游还是适配器的问题。
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/api/agentlex-moot/llm-selftest',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      try {
        // ?model=provider/model 可指定路由，便于逐模型探活（模型下线时排障用）。
        const url = new URL(req.url ?? '/', 'http://localhost')
        const override = url.searchParams.get('model') ?? ''
        const route = await gateway.resolve(override !== '' ? override : defaults.judgeModel)
        const started = Date.now()
        const result = await gateway.generate({
          messages: [{ role: 'user', content: '只回复两个字：正常' }],
          route,
          maxTokens: 32,
          temperature: 0,
        })
        ok(res, {
          route,
          text: result.text,
          tokens: result.tokens,
          finish: result.finish,
          // 原始 reason（结构化失败时最有价值）：排障时看它，不看渲染后的文本。
          ...(result.rawFinish === undefined ? {} : { rawFinish: JSON.parse(JSON.stringify(result.rawFinish)) as unknown }),
          elapsedMs: Date.now() - started,
          empty: result.text === '',
        })
      } catch (error) {
        fail(res, error, 502)
      }
    },
  }))

  // ── 会话列表 ──────────────────────────────────────────────
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/api/agentlex-moot/sessions',
    handler: async (_req: IncomingMessage, res: ServerResponse) => {
      try {
        ok(res, await store.listSessions())
      } catch (error) {
        fail(res, error)
      }
    },
  }))

  // ── 单会话 ────────────────────────────────────────────────
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/api/agentlex-moot/session',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const id = url.searchParams.get('id') ?? ''
        assertSafePathSegment(id, 'sessionId')
        const session = await store.getSession(id)
        if (session === undefined) return fail(res, `会话不存在：${id}`, 404)
        ok(res, session)
      } catch (error) {
        fail(res, error)
      }
    },
  }))

  // ── 庭审记录（增量） ───────────────────────────────────────
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/api/agentlex-moot/session/transcript',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const id = url.searchParams.get('id') ?? ''
        assertSafePathSegment(id, 'sessionId')
        const since = Number(url.searchParams.get('since') ?? '0')
        ok(res, await store.readTranscript(id, Number.isFinite(since) ? since : 0))
      } catch (error) {
        fail(res, error)
      }
    },
  }))

  // ── 争点 ──────────────────────────────────────────────────
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/api/agentlex-moot/session/issues',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const id = url.searchParams.get('id') ?? ''
        assertSafePathSegment(id, 'sessionId')
        ok(res, await store.readIssues(id))
      } catch (error) {
        fail(res, error)
      }
    },
  }))

  // ── 报告 ──────────────────────────────────────────────────
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/api/agentlex-moot/session/report',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const id = url.searchParams.get('id') ?? ''
        assertSafePathSegment(id, 'sessionId')
        ok(res, (await store.readReport(id)) ?? null)
      } catch (error) {
        fail(res, error)
      }
    },
  }))

  // ── 判决书 ────────────────────────────────────────────────
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/api/agentlex-moot/session/judgment',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const id = url.searchParams.get('id') ?? ''
        assertSafePathSegment(id, 'sessionId')
        ok(res, { markdown: await store.readJudgment(id) })
      } catch (error) {
        fail(res, error)
      }
    },
  }))

  // ── 模型路由（向导） ───────────────────────────────────────
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/api/agentlex-moot/models',
    handler: async (_req: IncomingMessage, res: ServerResponse) => {
      try {
        ok(res, await gateway.listAvailable())
      } catch (error) {
        fail(res, error)
      }
    },
  }))

  // ── 案件列表（向导） ───────────────────────────────────────
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/api/agentlex-moot/cases',
    handler: async (_req: IncomingMessage, res: ServerResponse) => {
      try {
        ok(res, { cases: await listCases(litigationDir) })
      } catch (error) {
        fail(res, error)
      }
    },
  }))

  // ── 构建快照（向导预览） ───────────────────────────────────
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/api/agentlex-moot/dossier',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const body = await readBody(req)
        const caseId = str(body['caseId'])
        const procedure = asProcedure(body['procedure'])
        const overridesRaw = body['overrides'] !== null && typeof body['overrides'] === 'object'
          ? body['overrides'] as Record<string, unknown>
          : {}
        const overrides: DossierOverrides = {
          ...(Array.isArray(overridesRaw['claims'])
            ? { claims: (overridesRaw['claims'] as unknown[]).filter((x): x is string => typeof x === 'string') }
            : {}),
          ...(str(overridesRaw['facts']) === '' ? {} : { facts: str(overridesRaw['facts']) }),
          ...(str(overridesRaw['brief']) === '' ? {} : { brief: str(overridesRaw['brief']) }),
          ...(str(overridesRaw['priorJudgment']) === '' ? {} : { priorJudgment: str(overridesRaw['priorJudgment']) }),
          ...(Array.isArray(overridesRaw['appealGrounds'])
            ? { appealGrounds: (overridesRaw['appealGrounds'] as unknown[]).filter((x): x is string => typeof x === 'string') }
            : {}),
          ...(Array.isArray(overridesRaw['materials'])
            ? {
              materials: (overridesRaw['materials'] as unknown[]).flatMap((entry) => {
                if (entry === null || typeof entry !== 'object') return []
                const item = entry as Record<string, unknown>
                const name = str(item['name']).trim()
                if (name === '') return []
                const note = str(item['note']).trim()
                return [{ name, ...(note === '' ? {} : { note }) }]
              }),
            }
            : {}),
        }
        const dossier = caseId === ''
          ? emptyDossier(overrides)
          : await buildDossier(litigationDir, caseId, procedure, overrides)
        ok(res, dossier)
      } catch (error) {
        fail(res, error)
      }
    },
  }))

  // ── 材料就绪度 dry-run ─────────────────────────────────────
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/api/agentlex-moot/session/prepare',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const body = await readBody(req)
        const procedure = asProcedure(body['procedure'])
        const dossier = asDossier(body['dossier'])
        const playbook = getPlaybook(procedure)
        ok(res, checkReadiness(dossier, playbook.requiredInputs))
      } catch (error) {
        fail(res, error)
      }
    },
  }))

  // ── 建会话 ────────────────────────────────────────────────
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/api/agentlex-moot/session/create',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const body = await readBody(req)
        const procedure = asProcedure(body['procedure'])
        const mode = asMode(body['mode'])
        const playbook = getPlaybook(procedure)
        const tribunal = asTribunal(body['tribunal'], procedure)
        const dossier = asDossier(body['dossier'])
        const readiness = checkReadiness(dossier, playbook.requiredInputs)

        // 手工建会话时也允许先落库，但把阻断项写进 hint，由向导决定是否继续。
        const title = str(body['title'], '') !== ''
          ? str(body['title'])
          : `${dossier.caseName ?? dossier.caseId ?? '未命名'} · ${PROCEDURE_LABEL[procedure]}`
        const rules = str(body['arbitrationRules'])
        const session = await store.createSession({
          title,
          procedure,
          mode,
          tribunal,
          ...(procedure === 'commercial_arb' && rules !== ''
            ? { arbitrationRules: (['cietac', 'bac', 'shiac', 'generic'].includes(rules) ? rules : 'generic') as 'cietac' | 'bac' | 'shiac' | 'generic' }
            : {}),
          config: asConfig(body['config'], defaults),
          dossier,
        })
        // 材料齐备即置 ready，否则留 draft 让向导补料。
        if (readiness.ready) {
          await store.updateSession(session.id, (s) => ({ ...s, status: 'ready' }))
        }
        ok(res, { ...(await store.getSession(session.id))!, readiness })
      } catch (error) {
        fail(res, error)
      }
    },
  }))

  // ── 删除会话 ──────────────────────────────────────────────
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/api/agentlex-moot/session/delete',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const body = await readBody(req)
        const id = str(body['id'])
        assertSafePathSegment(id, 'sessionId')
        ok(res, await store.deleteSession(id))
      } catch (error) {
        fail(res, error)
      }
    },
  }))

  // ── 控制 ──────────────────────────────────────────────────
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/api/agentlex-moot/session/control',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const body = await readBody(req)
        const id = str(body['id'])
        assertSafePathSegment(id, 'sessionId')
        const action = str(body['action'])
        if (!['start', 'pause', 'resume', 'abort', 'fastforward'].includes(action)) {
          return fail(res, `未知控制动作：${action}`)
        }
        const session = await orchestrator.control(id, action as 'start' | 'pause' | 'resume' | 'abort' | 'fastforward')
        ok(res, session)
      } catch (error) {
        fail(res, error)
      }
    },
  }))

  // ── 单方预演：我方发言 ─────────────────────────────────────
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/api/agentlex-moot/session/intervene',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const body = await readBody(req)
        const id = str(body['id'])
        assertSafePathSegment(id, 'sessionId')
        const text = str(body['text'])
        const result = await orchestrator.intervene(id, text)
        if (!result.accepted) {
          return fail(res, '当前不在等待我方发言状态，或发言内容为空', 409)
        }
        ok(res, result)
      } catch (error) {
        fail(res, error)
      }
    },
  }))

  // ── 改进建议 → 诉讼任务树（只写任务记录，不产生文件） ───────
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/api/agentlex-moot/session/writeback',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const body = await readBody(req)
        const id = str(body['id'])
        assertSafePathSegment(id, 'sessionId')
        const session = await store.getSession(id)
        if (session === undefined) return fail(res, `会话不存在：${id}`, 404)
        const dossier = await store.readDossier(id)
        const report = await store.readReport(id)
        const caseId = str(body['caseId'], dossier?.caseId ?? '')
        if (caseId === '') {
          return fail(res, '本会话未绑定案件，无法回写任务树', 400, '可在新建时选择案件，或手工指定 caseId')
        }
        if (report === undefined || report.suggestions.length === 0) {
          return fail(res, '本会话没有可回写的改进建议（报告尚未生成或建议为空）', 400)
        }

        const GROUP_NAME = '模拟法庭改进建议'
        const signal = AbortSignal.timeout ? AbortSignal.timeout(60_000) : new AbortController().signal

        // ① 读取案件，找同名任务组（避免重复建组）。
        // 走同源 HTTP（诉讼域写入口径）；`litigation` 工具只在 agent-preset 平面
        // 注册、作用域绑定会话，host 域不应依赖它。
        let groupId = ''
        const existingTitles = new Set<string>()
        try {
          const { taskGroups } = await readLitigationCase(ctx, caseId, signal)
          const found = taskGroups.find((g) => (g.name ?? '') === GROUP_NAME)
          if (found?.id !== undefined) {
            groupId = found.id
            for (const task of found.tasks ?? []) {
              if (task.title !== undefined) existingTitles.add(task.title)
            }
          }
        } catch (error) {
          return fail(res, `读取案件任务树失败：${error instanceof Error ? error.message : String(error)}`, 502)
        }

        // ② 没有同名组则新建。
        if (groupId === '') {
          try {
            groupId = await upsertLitigationGroup(ctx, caseId, GROUP_NAME, signal)
          } catch (error) {
            return fail(res, `创建任务组失败：${error instanceof Error ? error.message : String(error)}`, 500)
          }
        }

        // ③ 逐条建议建任务（已存在的标题跳过 → 幂等）。
        const createdTasks: Array<{ title: string }> = []
        for (const suggestion of report.suggestions) {
          const title = suggestion.title.trim()
          if (title === '' || existingTitles.has(title)) continue
          const priority = suggestion.priority === 'high' ? 'high' : suggestion.priority === 'low' ? 'low' : 'medium'
          try {
            await upsertLitigationTask(ctx, {
              caseId,
              groupId,
              taskTitle: title,
              priority,
              note: `[模拟法庭 ${session.id}] ${suggestion.detail}`,
            }, signal)
            createdTasks.push({ title })
            existingTitles.add(title)
          } catch {
            // 单条失败不中断其余建议。
          }
        }

        ok(res, {
          created: createdTasks.length,
          tasks: createdTasks,
          note: `已写入案件 ${caseId} 的任务组「${GROUP_NAME}」：${createdTasks.length} 条新任务（只写任务记录，不产生任何卷宗文件）。`,
        })
      } catch (error) {
        fail(res, error)
      }
    },
  }))

  // ── 内部执行面：以 host 身份执行 moot_court 动作 ────────────
  // 与 agent 调用**同一实现**（executeMootAction），供面板与其它插件在无 agent
  // 会话时复用，也让工具路径可被验收脚本覆盖。参数即为工具参数。
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/api/agentlex-moot/tool',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const body = await readBody(req)
        const value = await executeMootAction(toolDeps, body)
        // 工具侧会 clean 成纯 JSON；这里同样处理，保证两条入口返回值一致。
        ok(res, JSON.parse(JSON.stringify(value ?? null)) as unknown)
      } catch (error) {
        fail(res, error)
      }
    },
  }))

  return () => {
    for (const dispose of disposers.splice(0)) dispose()
  }
}
