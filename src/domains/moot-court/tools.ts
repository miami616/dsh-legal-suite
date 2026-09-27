/**
 * dsh-legal-suite/moot-court — agent 工具（模型面）。
 *
 * 单个 `moot_court` 工具 + action 联合，与诉讼域 `litigation` 工具同构：
 * schema 扁平、动作语义单一，模型只需选动作填参数。
 *
 * 关键口径写进工具描述与返回值：**模拟结果仅供参考，不得向当事人承诺裁判结果**；
 * **产物只落模拟法庭自己的目录，不写卷宗**。
 *
 * 返回值统一经 `clean()` 收敛为纯 JSON（defineTool 的规范值不接受带 undefined
 * 的接口对象，这也是诉讼域工具的既有做法）。
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { MootStore } from './store/session-store.ts'
import type { Orchestrator } from './engine/orchestrator.ts'
import { buildDossier, checkReadiness, emptyDossier, type DossierOverrides } from './engine/dossier.ts'
import { getPlaybook } from './playbook/index.ts'
import { MOOT_DISCLAIMER, PROCEDURE_LABEL, STATUS_LABEL, type Dossier, type Mode, type Procedure, type Tribunal } from './store/types.ts'

/** 工具依赖。 */
export interface ToolDeps {
  store: MootStore
  orchestrator: Orchestrator
  litigationDir: string
  defaults: {
    judgeModel?: string
    opponentModel?: string
    retrievalEnabled: boolean
    maxRounds: number
    tokenBudget: number
    maxTokensPerTurn: number
  }
}

/** 动作清单。 */
const ACTIONS = [
  'list',          // 列出模拟庭审会话
  'status',        // 读取单个会话状态
  'prepare',       // 材料就绪度检查（dry-run）
  'create',        // 创建会话（可挂案件）
  'start',         // 开始/续跑
  'control',       // 暂停/继续/中止/快进
  'intervene',     // 单方预演：提交我方发言
  'transcript',    // 读取庭审记录
  'report',        // 读取攻击面报告
  'writeback',     // 改进建议写入案件任务树
  'delete',        // 删除会话
] as const

type Action = typeof ACTIONS[number]

/** 参数表（与诉讼域同形：扁平字段 + 描述里写清适用动作）。 */
const PARAMETERS = {
  action: { type: 'string', required: true, description: `要执行的操作：${ACTIONS.join(' / ')}` },
  sessionId: { type: 'string', description: '会话 id（status/start/control/intervene/transcript/report/writeback/delete 必填）' },
  caseId: { type: 'string', description: '案件编号（create/prepare/writeback 用，如 2026-057；create 时留空为手工庭审）' },
  procedure: { type: 'string', description: '程序：civil_first 民事一审 / civil_second 民事二审 / labor_arb 劳动仲裁 / commercial_arb 商事仲裁' },
  mode: { type: 'string', description: '模式：stress 文书压力测试 / auto 全自动演练 / rehearsal 单方预演（默认 auto）' },
  tribunal: { type: 'string', description: '法庭组成：single 独任 / collegial 合议庭 / arb_solo 独任仲裁庭 / arb_panel 三人仲裁庭（默认取程序默认）' },
  title: { type: 'string', description: '会话标题（默认「案件名 · 程序」）' },
  controlAction: { type: 'string', description: 'control 动作：pause / resume / abort / fastforward' },
  text: { type: 'string', description: 'intervene 用：我方（律师本人）的发言内容' },
  since: { type: 'integer', description: 'transcript 用：只取 seq 大于该值的记录' },
  brief: { type: 'string', description: '我方策略简报（create 用，显著提升预演针对性）' },
  claims: { type: 'json', description: '诉讼/仲裁请求数组（create/prepare 覆盖用），如 ["判令被告支付货款8万元","诉讼费由被告承担"]' },
  facts: { type: 'string', description: '事实与理由摘要（create/prepare 覆盖用）' },
  priorJudgment: { type: 'string', description: '二审用：一审裁判文书摘要（缺失会被 create 拒绝）' },
  appealGrounds: { type: 'json', description: '二审用：上诉请求与理由数组（缺失会被 create 拒绝）' },
  maxRounds: { type: 'integer', description: '最大辩论轮次（默认 2）' },
} as const

/** 纯 JSON 收敛（剥离 undefined，把普通对象转为纯结构）。 */
type JsonVal = null | boolean | number | string | JsonVal[] | { [key: string]: JsonVal }

function clean(value: unknown): JsonVal {
  if (value === undefined || value === null) return null
  if (Array.isArray(value)) return value.map((v) => clean(v))
  if (typeof value === 'object') {
    const out: { [key: string]: JsonVal } = {}
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue
      out[key] = clean(v)
    }
    return out
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'boolean' || typeof value === 'string') return value
  return String(value)
}

/** 取字符串（空串视作未提供）。 */
function s(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  const text = String(value).trim()
  return text === '' ? undefined : text
}

/** 归一程序。 */
function asProcedure(value: unknown): Procedure {
  const raw = s(value) ?? 'civil_first'
  if (raw === 'civil_first' || raw === 'civil_second' || raw === 'labor_arb' || raw === 'commercial_arb') return raw
  throw new Error(`procedure 取值不合法：${raw}（应为 civil_first / civil_second / labor_arb / commercial_arb）`)
}

/** 归一模式。 */
function asMode(value: unknown): Mode {
  const raw = s(value) ?? 'auto'
  if (raw === 'stress' || raw === 'auto' || raw === 'rehearsal') return raw
  throw new Error(`mode 取值不合法：${raw}（应为 stress / auto / rehearsal）`)
}

/** 从 args 收集快照覆盖字段。 */
function overridesOf(args: Record<string, unknown>): DossierOverrides {
  const stringsOf = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim())
      : []
  const claims = stringsOf(args['claims'])
  const grounds = stringsOf(args['appealGrounds'])
  return {
    ...(claims.length === 0 ? {} : { claims }),
    ...(s(args['facts']) === undefined ? {} : { facts: s(args['facts'])! }),
    ...(s(args['brief']) === undefined ? {} : { brief: s(args['brief'])! }),
    ...(s(args['priorJudgment']) === undefined ? {} : { priorJudgment: s(args['priorJudgment'])! }),
    ...(grounds.length === 0 ? {} : { appealGrounds: grounds }),
  }
}

/** 组装快照（挂案件或手工）。 */
async function dossierOf(deps: ToolDeps, args: Record<string, unknown>, procedure: Procedure): Promise<Dossier> {
  const caseId = s(args['caseId'])
  const overrides = overridesOf(args)
  return caseId === undefined
    ? emptyDossier(overrides)
    : buildDossier(deps.litigationDir, caseId, procedure, overrides)
}

/**
 * 执行一个 moot_court 动作。
 *
 * 这是**唯一的动作分派实现**：agent 工具（`moot_court`）与 HTTP 内部执行面
 * （`POST /api/agentlex-moot/tool`）都走这里，保证两条入口的行为、错误码、
 * 返回值完全一致——避免「agent 能建会话、面板不能」这类双实现漂移。
 * @param deps - store / orchestrator / 目录与默认配置。
 * @param args - 动作参数（含 action）。
 * @returns 未收敛的原始结果（调用方按需 clean 成纯 JSON）。
 */
export async function executeMootAction(deps: ToolDeps, args: Record<string, unknown>): Promise<unknown> {
  const action = s(args['action']) as Action | undefined
  if (action === undefined || !(ACTIONS as readonly string[]).includes(action)) {
    return { error: `action 取值不合法：${String(args['action'] ?? '')}`, allowed: [...ACTIONS] }
  }

  switch (action) {
    case 'list': {
      const sessions = await deps.store.listSessions()
      return {
        count: sessions.length,
        sessions: sessions.slice(0, 30).map((x) => ({
          sessionId: x.id,
          title: x.title,
          procedure: PROCEDURE_LABEL[x.procedure],
          mode: x.mode,
          status: STATUS_LABEL[x.status],
          phase: x.phase,
          tokensUsed: x.stats.tokensUsed,
          updatedAt: x.updatedAt,
        })),
        dataDir: deps.store.dataDir,
      }
    }

    case 'status': {
      const id = s(args['sessionId'])
      if (id === undefined) return { error: 'status 需要 sessionId' }
      const session = await deps.store.getSession(id)
      if (session === undefined) return { error: `会话不存在：${id}` }
      const issues = await deps.store.readIssues(id)
      const report = await deps.store.readReport(id)
      return {
        session,
        running: deps.orchestrator.isRunning(id),
        issueCount: issues.length,
        hasReport: report !== undefined,
        disclaimer: MOOT_DISCLAIMER,
      }
    }

    case 'prepare': {
      const procedure = asProcedure(args['procedure'])
      const playbook = getPlaybook(procedure)
      const dossier = await dossierOf(deps, args, procedure)
      const readiness = checkReadiness(dossier, playbook.requiredInputs)
      return {
        procedure: playbook.title,
        ready: readiness.ready,
        missing: readiness.missing,
        warnings: readiness.warnings,
        dossierSummary: {
          caseName: dossier.caseName ?? null,
          cause: dossier.cause ?? null,
          claims: dossier.claims.length,
          parties: dossier.parties.length,
          evidence: dossier.evidence.length,
          hasBrief: (dossier.brief ?? '') !== '',
          hasPriorJudgment: (dossier.priorJudgment ?? '') !== '',
          sources: dossier.sources,
        },
      }
    }

    case 'create': {
      const procedure = asProcedure(args['procedure'])
      const mode = asMode(args['mode'])
      const playbook = getPlaybook(procedure)
      const dossier = await dossierOf(deps, args, procedure)
      const readiness = checkReadiness(dossier, playbook.requiredInputs)
      if (!readiness.ready) {
        return {
          created: false,
          error: 'BLOCKING_INPUTS_MISSING',
          reason: '必备材料缺失，未创建会话',
          missing: readiness.missing.filter((m) => m.blocking),
          hint: '补齐材料后重试；民事二审必须提供一审裁判文书与上诉理由（priorJudgment / appealGrounds）。',
        }
      }

      const tribunalRaw = s(args['tribunal'])
      const tribunal: Tribunal = tribunalRaw !== undefined && (playbook.tribunals as string[]).includes(tribunalRaw)
        ? tribunalRaw as Tribunal
        : playbook.defaultTribunal
      const maxRounds = Number(args['maxRounds'] ?? deps.defaults.maxRounds)
      const session = await deps.store.createSession({
        title: s(args['title']) ?? `${dossier.caseName ?? dossier.caseId ?? '未命名'} · ${PROCEDURE_LABEL[procedure]}`,
        procedure,
        mode,
        tribunal,
        config: {
          ...(deps.defaults.judgeModel === undefined ? {} : { judgeModel: deps.defaults.judgeModel }),
          ...(deps.defaults.opponentModel === undefined ? {} : { opponentModel: deps.defaults.opponentModel }),
          retrievalEnabled: deps.defaults.retrievalEnabled,
          maxRounds: Number.isFinite(maxRounds) ? Math.max(1, Math.min(6, Math.round(maxRounds))) : deps.defaults.maxRounds,
          tokenBudget: deps.defaults.tokenBudget,
          maxTokensPerTurn: deps.defaults.maxTokensPerTurn,
          opponentTemperature: 0.9,
        },
        dossier,
      })
      await deps.store.updateSession(session.id, (x) => ({ ...x, status: 'ready' }))
      return {
        created: true,
        sessionId: session.id,
        title: session.title,
        procedure: playbook.title,
        mode,
        tribunal,
        warnings: readiness.warnings,
        next: `调用 moot_court action=start sessionId=${session.id} 开始庭审；面板「模拟法庭」可实时观看。`,
        disclaimer: MOOT_DISCLAIMER,
      }
    }

    case 'start': {
      const id = s(args['sessionId'])
      if (id === undefined) return { error: 'start 需要 sessionId' }
      await deps.orchestrator.start(id)
      return {
        started: true,
        sessionId: id,
        note: '庭审在后台推进（不占用本会话），可在面板「模拟法庭」实时查看，或用 action=status / transcript 轮询。',
      }
    }

    case 'control': {
      const id = s(args['sessionId'])
      const controlAction = s(args['controlAction'])
      if (id === undefined) return { error: 'control 需要 sessionId' }
      if (controlAction === undefined || !['pause', 'resume', 'abort', 'fastforward'].includes(controlAction)) {
        return { error: 'controlAction 取值不合法（pause / resume / abort / fastforward）' }
      }
      const session = await deps.orchestrator.control(id, controlAction as 'pause' | 'resume' | 'abort' | 'fastforward')
      return { session }
    }

    case 'intervene': {
      const id = s(args['sessionId'])
      const text = s(args['text'])
      if (id === undefined || text === undefined) return { error: 'intervene 需要 sessionId 与 text' }
      const result = await deps.orchestrator.intervene(id, text)
      return result.accepted
        ? { accepted: true }
        : { accepted: false, reason: '当前不在等待我方发言状态（仅单方预演模式会等待）' }
    }

    case 'transcript': {
      const id = s(args['sessionId'])
      if (id === undefined) return { error: 'transcript 需要 sessionId' }
      const since = Number(args['since'] ?? 0)
      const entries = await deps.store.readTranscript(id, Number.isFinite(since) ? since : 0)
      return {
        count: entries.length,
        entries: entries.map((e) => ({
          seq: e.seq,
          phase: e.phaseTitle,
          role: e.roleLabel,
          kind: e.kind,
          text: e.text,
          citations: (e.citations ?? []).map((c) => `${c.kind === 'article' ? '法条' : '类案'}：${c.ref}`),
        })),
      }
    }

    case 'report': {
      const id = s(args['sessionId'])
      if (id === undefined) return { error: 'report 需要 sessionId' }
      const report = await deps.store.readReport(id)
      if (report === undefined) return { error: '报告尚未生成（庭审未完成）', sessionId: id }
      const judgment = await deps.store.readJudgment(id)
      return {
        report,
        judgmentMarkdown: judgment === '' ? null : judgment,
        judgmentPath: `${deps.store.sessionDir(id)}/judgment.md`,
        disclaimer: MOOT_DISCLAIMER,
      }
    }

    case 'writeback': {
      const id = s(args['sessionId'])
      if (id === undefined) return { error: 'writeback 需要 sessionId' }
      const session = await deps.store.getSession(id)
      const dossier = await deps.store.readDossier(id)
      const report = await deps.store.readReport(id)
      const caseId = s(args['caseId']) ?? dossier?.caseId ?? ''
      if (caseId === '') return { error: '本会话未绑定案件，无法回写任务树' }
      if (report === undefined || report.suggestions.length === 0) {
        return { error: '没有可回写的改进建议（报告尚未生成或建议为空）' }
      }
      return {
        caseId,
        sessionId: session?.id ?? id,
        suggestions: report.suggestions,
        note: '回写只写任务记录，不产生任何卷宗文件。请在面板点击「回写为案件任务」，' +
          '或用 litigation 工具的 upsert_group / upsert_task 手工落库（参考 POST /api/agentlex-moot/session/writeback 的实现）。',
      }
    }

    case 'delete': {
      const id = s(args['sessionId'])
      if (id === undefined) return { error: 'delete 需要 sessionId' }
      const result = await deps.store.deleteSession(id)
      return { ...result, sessionId: id, note: '会话目录与其全部产物已删除（未触及任何案件文件）。' }
    }

    default:
      return { error: `未实现的动作：${String(action)}` }
  }
}

/**
 * 注册 moot_court 工具。
 * @returns disposer 注销工具。
 */
export function registerMootTool(ctx: Context, deps: ToolDeps): () => void {
  return ctx.tools.register(defineTool({
    name: 'moot_court',
    description:
      '模拟法庭（实验性功能，需在设置中开启）：按现行法律与司法实践推演庭审，产出争点评分、攻击面报告与模拟判决书/裁决书。' +
      '支持民事一审、民事二审、劳动仲裁、商事仲裁；三种模式：文书压力测试（最快）、全自动演练、单方预演（律师本人参与）。' +
      `产物只存放在模拟法庭自己的目录，不会写入案件卷宗。${MOOT_DISCLAIMER}`,
    parameters: PARAMETERS,
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args: Record<string, unknown>): Promise<JsonValue> {
      return clean(await executeMootAction(deps, args)) as JsonValue
    },
  }))
}
