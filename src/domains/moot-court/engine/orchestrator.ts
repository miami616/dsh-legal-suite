/**
 * dsh-legal-suite/moot-court — 庭审引擎（确定性状态机）。
 *
 * 方案 §4/§8 的宿主侧主循环。设计取舍：
 *   • 不用 session/subagent 编排——引擎是 host 侧状态机，可持久化、可中断续跑、
 *     可单测，且与 agent 会话解耦（关掉对话庭审照跑）。
 *   • 程序性话术不进模型；实体发言才调模型。
 *   • 每条发言落盘即断点；暂停/中止在发言边界生效，不打断已发出的调用。
 *   • 预算硬控：超出 tokenBudget 立即收束进评议并在会话与报告中标注「预算截断」。
 *
 * 一次运行的完整流程：
 *   phases（playbook 或 stress 精简集）
 *     → 逐 turn：检索锚定 / 金额测算 / 程序话术 / 我方等待 / 模型发言
 *     → 争点阶段：解析结构化 JSON 落盘 issues.json
 *   → 评议报告调用（结构化 JSON）→ 判决书分段生成（非 stress）→ buildReport 落盘
 */
import type { Context } from '@deepseek-ai/cordis'
import type { MootStore } from '../store/session-store.ts'
import type {
  Dossier,
  Issue,
  MootReport,
  TranscriptEntry,
  TrialSession,
} from '../store/types.ts'
import { getPlaybook, phasesFor, producesJudgment } from '../playbook/index.ts'
import type { Phase, Turn } from '../playbook/types.ts'
import type { LlmGateway } from './llm.ts'
import { buildTurnPrompt, extractJsonBlock, stripJsonBlock } from './roles.ts'
import { anchorCases, anchorIssues, buildQueryText, partyNamesOf, renderCitationPool, type IssueAnchors } from './retrieval.ts'
import { buildCalcBlock, type CalcBlock } from './calc.ts'
import { buildReport, parseIssues, parseReportFields, type ParsedReportFields } from './scoring.ts'
import { generateJudgment } from './judgment.ts'
import { REPORT_JSON_CONTRACT } from '../prompts/roles.ts'

/** 控制动作。 */
export type ControlAction = 'start' | 'pause' | 'resume' | 'abort' | 'fastforward'

/** 编排器依赖。 */
export interface OrchestratorDeps {
  ctx: Context
  store: MootStore
  gateway: LlmGateway
  /** 变更通知（SSE / 面板刷新）。 */
  onChange: (sessionId: string, reason: string) => void
}

/** 编排器。 */
export interface Orchestrator {
  /** 启动（或续跑）一场庭审；已在运行时为幂等 no-op。 */
  start(sessionId: string): Promise<void>
  /** 控制动作。 */
  control(sessionId: string, action: ControlAction): Promise<TrialSession>
  /** 单方预演：提交我方发言。 */
  intervene(sessionId: string, text: string): Promise<{ accepted: boolean }>
  /** 是否正在运行。 */
  isRunning(sessionId: string): boolean
  /** 插件卸载时终止全部运行。 */
  stopAll(): void
}

/** 单次运行的进程内状态（不落盘；落盘的是每一条发言与状态机断点）。 */
interface RunState {
  sessionId: string
  abort: AbortController
  paused: boolean
  fastForward: boolean
  running: boolean
  /** 等待我方发言时的唤醒器。 */
  waiting?: (text: string) => void
}

/** 单次模型调用的超时（毫秒）。 */
const CALL_TIMEOUT_MS = 180_000

/** 把可选的超时信号与主信号合并。 */
function withTimeout(signal: AbortSignal): AbortSignal {
  const timeoutFactory = (AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal }).timeout
  if (typeof timeoutFactory !== 'function') return signal
  const anyFactory = (AbortSignal as unknown as { any?: (signals: AbortSignal[]) => AbortSignal }).any
  const timeout = timeoutFactory(CALL_TIMEOUT_MS)
  if (typeof anyFactory === 'function') return anyFactory([signal, timeout])
  return signal
}

/** 睡眠一小段（用于暂停轮询与限流）。 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 创建庭审编排器。
 * @param deps - store / gateway / 通知回调。
 */
export function createOrchestrator(deps: OrchestratorDeps): Orchestrator {
  const { ctx, store, gateway, onChange } = deps
  const runs = new Map<string, RunState>()

  /** 当前会话是否已超出预算。 */
  function overBudget(session: TrialSession): boolean {
    return session.stats.tokensUsed >= session.config.tokenBudget
  }

  /** 暂停等待：直到 paused 被清除或中止。 */
  async function waitWhilePaused(state: RunState): Promise<void> {
    while (state.paused && !state.abort.signal.aborted) {
      await sleep(400)
    }
  }

  /** 更新会话状态并把断点写盘。 */
  async function patch(
    sessionId: string,
    mutate: (s: TrialSession) => TrialSession,
    reason: string,
  ): Promise<TrialSession> {
    const next = await store.updateSession(sessionId, mutate)
    onChange(sessionId, reason)
    return next
  }

  /** 追加一条庭审记录并通知前端。 */
  async function append(
    sessionId: string,
    entry: Omit<TranscriptEntry, 'seq' | 'createdAt'>,
  ): Promise<TranscriptEntry> {
    const saved = await store.appendTranscript(sessionId, entry)
    onChange(sessionId, 'transcript')
    return saved
  }

  /** 执行一个发言节点。返回本节点消耗的 token。 */
  async function runTurn(
    state: RunState,
    session: TrialSession,
    playbook: ReturnType<typeof getPlaybook>,
    dossier: Dossier,
    phase: Phase,
    turn: Turn,
    context: {
      getEntries: () => Promise<TranscriptEntry[]>
      getIssues: () => Issue[]
      setIssues: (issues: Issue[]) => Promise<void>
      getAnchors: () => IssueAnchors
      setAnchors: (anchors: IssueAnchors) => void
      ensureOpponentRetrieval: () => Promise<void>
      ensureIssueAnchors: () => Promise<void>
      getCalc: () => CalcBlock | undefined
    },
  ): Promise<number> {
    // ① 程序话术：硬编码，不调模型。
    if (turn.kind === 'procedure' || turn.actor === 'clerk') {
      await append(state.sessionId, {
        phase: phase.id,
        phaseTitle: phase.title,
        actor: turn.actor,
        roleLabel: turn.roleLabel,
        text: turn.procedureText ?? turn.instruction ?? '',
        kind: 'procedure',
      })
      return 0
    }

    // ② 检索锚定（节点要求时）。
    if (turn.needsRetrieval === true && session.config.retrievalEnabled) {
      if (turn.actor === 'opponent') {
        await context.ensureOpponentRetrieval()
      } else if (turn.actor === 'judge') {
        await context.ensureIssueAnchors()
      }
    }

    // ③ 单方预演：我方发言由律师给出，引擎挂起等待。
    if (turn.actor === 'self' && session.mode === 'rehearsal') {
      await patch(state.sessionId, (s) => ({ ...s, status: 'waiting', awaitingPhase: phase.id }), 'waiting')
      const text = await new Promise<string>((resolve) => { state.waiting = resolve })
      state.waiting = undefined
      await append(state.sessionId, {
        phase: phase.id,
        phaseTitle: phase.title,
        actor: 'user',
        roleLabel: `${turn.roleLabel}（律师本人）`,
        text,
        kind: 'speech',
      })
      await patch(state.sessionId, (s) => {
        const { awaitingPhase: _drop, ...rest } = s
        return { ...rest, status: 'running' }
      }, 'resumed-after-input')
      return 0
    }

    // ④ 模型发言。
    const entries = await context.getEntries()
    const prompt = buildTurnPrompt({
      session,
      playbook,
      dossier,
      turn,
      entries,
      issues: context.getIssues(),
      pool: context.getAnchors().pool,
      ...(context.getCalc() === undefined ? {} : { calcText: context.getCalc()!.text }),
    })
    const route = turn.actor === 'opponent' && session.config.opponentModel !== undefined
      ? await gateway.resolve(session.config.opponentModel)
      : await gateway.resolve(session.config.judgeModel)
    const fast = state.fastForward
    const result = await gateway.generate({
      system: prompt.system,
      messages: prompt.messages,
      route,
      maxTokens: fast ? Math.min(800, prompt.maxTokens) : prompt.maxTokens,
      // 快速推进时提高温度以外不做特殊处理；对方温度来自配置。
      temperature: prompt.temperature,
      signal: withTimeout(state.abort.signal),
    })

    const speech = stripJsonBlock(result.text)
    const pool = context.getAnchors().pool
    const citations = turn.actor === 'opponent'
      ? pool.filter((c) => c.kind === 'case').slice(0, 4)
      : turn.actor === 'judge' ? pool.slice(0, 6) : []

    await append(state.sessionId, {
      phase: phase.id,
      phaseTitle: phase.title,
      actor: turn.actor,
      roleLabel: turn.roleLabel,
      text: speech === '' ? result.text : speech,
      ...(citations.length === 0 ? {} : { citations }),
      tokens: result.tokens,
      kind: 'speech',
    })

    // ⑤ 争点阶段：解析结构化 JSON。
    if (phase.produces === 'issues') {
      const parsed = parseIssues(extractJsonBlock(result.text))
      if (parsed.length > 0) await context.setIssues(parsed)
    }

    return result.tokens
  }

  /** 主运行循环。 */
  async function run(state: RunState): Promise<void> {
    const sessionId = state.sessionId
    try {
      const loaded = await store.getSession(sessionId)
      if (loaded === undefined) return
      // 显式非空标注：session 会在闭包（context 的各步骤）里被重新赋值，
      // TS 的控制流窄化在闭包赋值后会失效。
      let session: TrialSession = loaded
      const dossier = await store.readDossier(sessionId)
      if (dossier === undefined) throw new Error('缺少案件快照（dossier.json），请重新创建会话')
      const playbook = getPlaybook(session.procedure)
      const phases = phasesFor(playbook, session.mode)
      // 断点续跑：已完成阶段不重放（abort 后 resume、或进程重启后续跑）。
      const done = new Set(session.stats.phasesDone)
      const pendingCount = phases.filter((p) => !done.has(p.id)).length
      if (pendingCount < phases.length) {
        await append(sessionId, {
          phase: 'resume',
          phaseTitle: '续跑',
          actor: 'clerk',
          roleLabel: '系统',
          text: `从断点续跑：跳过已完成阶段 ${phases.length - pendingCount} 个，剩余 ${pendingCount} 个阶段。`,
          kind: 'system',
        })
      }

      let issues = await store.readIssues(sessionId)
      let anchors: IssueAnchors = { byIssue: {}, pool: [] }
      let calc: CalcBlock | undefined
      let opponentRetrieved = false
      let issueAnchored = false
      let entriesCache = await store.readTranscript(sessionId)

      const context = {
        getEntries: async () => entriesCache,
        getIssues: () => issues,
        setIssues: async (next: Issue[]) => {
          issues = next
          await store.writeIssues(sessionId, next)
          onChange(sessionId, 'issues')
        },
        getAnchors: () => anchors,
        setAnchors: (next: IssueAnchors) => { anchors = next },
        ensureOpponentRetrieval: async () => {
          if (opponentRetrieved || !session.config.retrievalEnabled) return
          opponentRetrieved = true
          const query = {
            cause: dossier.cause,
            keywords: buildQueryText(dossier, issues.map((i) => i.title)),
            province: session.config.retrievalProvince,
            partyNames: partyNamesOf(dossier),
            signal: state.abort.signal,
          }
          const found = await anchorCases(ctx, query, 'them')
          if (found.citations.length > 0) {
            anchors = { ...anchors, pool: [...anchors.pool, ...found.citations] }
            await append(sessionId, {
              phase: 'retrieval',
              phaseTitle: '检索锚定',
              actor: 'clerk',
              roleLabel: '系统',
              text: `已为对方代理人检索到 ${found.citations.length} 条支持性类案：\n${renderCitationPool(found.citations, 6)}`,
              citations: found.citations,
              kind: 'system',
            })
          } else if (found.degraded !== undefined) {
            session = await patch(sessionId, (s) => ({
              ...s,
              stats: { ...s.stats, retrievalDegraded: found.degraded },
            }), 'retrieval-degraded')
          }
          entriesCache = await store.readTranscript(sessionId)
        },
        ensureIssueAnchors: async () => {
          if (issueAnchored || !session.config.retrievalEnabled) return
          issueAnchored = true
          const result = await anchorIssues(ctx, dossier, issues, {
            province: session.config.retrievalProvince,
            signal: state.abort.signal,
          })
          anchors = { ...result, pool: [...anchors.pool, ...result.pool] }
          if (result.pool.length > 0) {
            await append(sessionId, {
              phase: 'retrieval',
              phaseTitle: '检索锚定',
              actor: 'clerk',
              roleLabel: '系统',
              text: `已完成争点锚定：取得 ${result.pool.length} 条法条/类案引用。`,
              citations: result.pool.slice(0, 8),
              kind: 'system',
            })
          } else if (result.degraded !== undefined) {
            session = await patch(sessionId, (s) => ({
              ...s,
              stats: { ...s.stats, retrievalDegraded: result.degraded },
            }), 'retrieval-degraded')
          }
          entriesCache = await store.readTranscript(sessionId)
        },
        getCalc: () => calc,
      }

      // ── 阶段推进 ──────────────────────────────────────────────
      for (let phaseIndex = 0; phaseIndex < phases.length; phaseIndex += 1) {
        const phase = phases[phaseIndex]!
        if (state.abort.signal.aborted) break
        // 断点续跑：已完成的阶段整体跳过。
        if (done.has(phase.id)) continue
        // 宣判/裁决阶段推迟到评议之后执行：顺序必须是「评议 → 宣布判决/裁决 → 文书
        // 段落」，否则评议记录会插在宣布与文书之间（阅读顺序错乱）。
        if (phase.kind === 'judgment') continue
        // 预算截断：只跳过**需要花钱的**阶段；纯程序话术的阶段（如「宣布裁决」）
        // 不调模型，仍然要执行，否则文书产出了却没走完宣布程序。
        if (overBudget(session) && phase.turns.some((t) => t.kind === 'speech')) {
          session = await patch(sessionId, (s) => ({ ...s, stats: { ...s.stats, truncated: true } }), 'budget-stop')
          break
        }
        if (state.fastForward && phase.kind === 'debate') {
          // 快进：跳过辩论阶段。
          continue
        }

        session = await patch(sessionId, (s) => ({
          ...s,
          status: 'running',
          phase: phase.id,
          phaseIndex,
        }), 'phase')

        // 非重复节点先跑。
        const oneShot = phase.turns.filter((t) => t.repeat !== -1)
        for (const turn of oneShot) {
          if (state.abort.signal.aborted) break
          await waitWhilePaused(state)
          if (turn.optional === true && (state.fastForward || overBudget(session))) continue
          const used = await runTurn(state, session, playbook, dossier, phase, turn, context)
          if (used > 0) {
            session = await patch(sessionId, (s) => ({
              ...s,
              stats: { ...s.stats, tokensUsed: s.stats.tokensUsed + used, calls: s.stats.calls + 1 },
            }), 'stats')
            entriesCache = await store.readTranscript(sessionId)
          }
        }

        // 辩论阶段：可重复节点按 maxRounds 轮次。
        const repeatable = phase.turns.filter((t) => t.repeat === -1)
        if (repeatable.length > 0) {
          const rounds = Math.max(1, state.fastForward ? 1 : session.config.maxRounds)
          for (let round = 1; round <= rounds; round += 1) {
            if (state.abort.signal.aborted) break
            session = await patch(sessionId, (s) => ({ ...s, round }), 'round')
            for (const turn of repeatable) {
              if (state.abort.signal.aborted) break
              await waitWhilePaused(state)
              if (overBudget(session)) break
              const used = await runTurn(state, session, playbook, dossier, phase, turn, context)
              if (used > 0) {
                session = await patch(sessionId, (s) => ({
                  ...s,
                  stats: { ...s.stats, tokensUsed: s.stats.tokensUsed + used, calls: s.stats.calls + 1 },
                }), 'stats')
                entriesCache = await store.readTranscript(sessionId)
              }
            }
            if (overBudget(session)) break
          }
        }

        // 阶段收尾：记录已完成（预算截断标记由循环顶部的检查写入）。
        session = await patch(sessionId, (s) => ({
          ...s,
          stats: {
            ...s.stats,
            phasesDone: s.stats.phasesDone.includes(phase.id) ? s.stats.phasesDone : [...s.stats.phasesDone, phase.id],
          },
        }), 'phase-done')
      }

      if (state.abort.signal.aborted) {
        await patch(sessionId, (s) => ({ ...s, status: 'aborted' }), 'aborted')
        return
      }

      // ── 评议：金额测算 + 结构化报告 ────────────────────────────
      session = await patch(sessionId, (s) => ({ ...s, status: 'adjudicating' }), 'adjudicating')
      entriesCache = await store.readTranscript(sessionId)

      calc = await buildCalcBlock(ctx, dossier, state.abort.signal)

      const fields = await buildVerdictFields(state, session, playbook, dossier, issues, entriesCache, anchors, calc)

      // ── 宣布判决/裁决（程序话术，评议之后、文书之前）──────────────
      const judgmentPhase = phases.find((p) => p.kind === 'judgment')
      if (judgmentPhase !== undefined) {
        for (const turn of judgmentPhase.turns) {
          if (state.abort.signal.aborted) break
          await runTurn(state, session, playbook, dossier, judgmentPhase, turn, context)
        }
        session = await patch(sessionId, (s) => ({
          ...s,
          phase: judgmentPhase.id,
          stats: {
            ...s.stats,
            phasesDone: s.stats.phasesDone.includes(judgmentPhase.id)
              ? s.stats.phasesDone
              : [...s.stats.phasesDone, judgmentPhase.id],
          },
        }), 'judgment-declared')
        entriesCache = await store.readTranscript(sessionId)
      }

      // ── 判决书（非压力测试）────────────────────────────────────
      if (producesJudgment(session.mode)) {
        const currentSession = (await store.getSession(sessionId)) ?? session
        const judgment = await generateJudgment({
          gateway,
          session: currentSession,
          playbook,
          dossier,
          issues,
          entries: entriesCache,
          pool: anchors.pool,
          ...(calc === undefined || calc.text === '' ? {} : { calcText: calc.text }),
          ...(calc?.feeAmount === undefined ? {} : { feeAmount: calc.feeAmount }),
          ...(currentSession.stats.retrievalDegraded === undefined
            ? {}
            : { retrievalNote: currentSession.stats.retrievalDegraded }),
          signal: state.abort.signal,
          onSegment: async (name, text) => {
            await append(sessionId, {
              phase: 'judgment',
              phaseTitle: playbook.judgmentTitle,
              actor: 'judge',
              roleLabel: playbook.judgeLabel,
              text: `（${name}）${text}`,
              kind: 'speech',
            })
            onChange(sessionId, 'judgment-segment')
          },
        })
        if (judgment.markdown !== '') {
          await store.writeJudgment(sessionId, judgment.markdown)
          if (judgment.foreignCitations.length > 0) {
            await append(sessionId, {
              phase: 'judgment',
              phaseTitle: playbook.judgmentTitle,
              actor: 'clerk',
              roleLabel: '系统',
              text: `引用合规提示：判决书中出现 ${judgment.foreignCitations.length} 处未在检索清单中的引用，请复核：${judgment.foreignCitations.slice(0, 5).join('、')}`,
              kind: 'system',
            })
          }
        }
        session = await patch(sessionId, (s) => ({
          ...s,
          stats: { ...s.stats, calls: s.stats.calls + judgment.calls, tokensUsed: s.stats.tokensUsed + judgment.tokens },
        }), 'judgment-stats')
      }

      // ── 报告落盘 ──────────────────────────────────────────────
      const latest = (await store.getSession(sessionId)) ?? session
      const report = buildReport({
        session: latest,
        playbook,
        dossier,
        issues,
        entries: await store.readTranscript(sessionId),
        fields,
        anchors: { ...anchors, ...(latest.stats.retrievalDegraded === undefined ? {} : { degraded: latest.stats.retrievalDegraded }) },
        retrievalEnabled: latest.config.retrievalEnabled,
        ...(calc === undefined || calc.items.length === 0
          ? {}
          : {
            calculations: calc.items.map((item) => ({
              action: item.action,
              input: item.input,
              summary: item.summary,
              ...(item.detail === undefined ? {} : { detail: item.detail }),
            })),
          }),
        ...(calc?.skipped === undefined ? {} : { calcSkipped: calc.skipped }),
      })
      await store.writeReport(sessionId, report)
      await patch(sessionId, (s) => ({
        ...s,
        status: 'done',
        stats: { ...s.stats, finishedAt: new Date().toISOString() },
      }), 'done')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      try {
        await patch(sessionId, (s) => ({ ...s, status: 'failed', error: message }), 'failed')
      } catch {
        // 落盘失败时至少留下日志。
      }
      console.warn(`[agentlex-moot] session ${sessionId} failed:`, message)
    } finally {
      const current = runs.get(sessionId)
      if (current !== undefined) {
        current.running = false
        current.waiting = undefined
      }
    }
  }

  /** 评议：产出结构化报告字段（一次模型调用）。 */
  async function buildVerdictFields(
    state: RunState,
    session: TrialSession,
    playbook: ReturnType<typeof getPlaybook>,
    dossier: Dossier,
    issues: Issue[],
    entries: TranscriptEntry[],
    anchors: IssueAnchors,
    calc: CalcBlock | undefined,
  ): Promise<ParsedReportFields> {
    const system = [
      '你是本次模拟庭审的评议人（由裁判者视角退后一步做诚实的自评）。',
      '任务：基于全部庭审记录，对案件作出倾向性判断，并列出攻击线路、材料缺口与改进建议。',
      '硬要求：结论仅供参考；不得迎合我方；我方薄弱点必须直说。',
      REPORT_JSON_CONTRACT,
    ].join('\n')
    const user = [
      `# 案件\n${dossier.caseName ?? dossier.caseId ?? session.id}（${playbook.title}）`,
      dossier.cause === undefined ? '' : `案由：${dossier.cause}`,
      `# 我方角色\n${dossier.ourRole ?? playbook.selfLabel}`,
      '# 争议焦点',
      issues.length === 0 ? '（无结构化争点）' : issues.map((i, idx) => `${idx + 1}. ${i.title}`).join('\n'),
      '# 检索清单（引用只能来自此清单）',
      renderCitationPool(anchors.pool),
      calc === undefined || calc.text === '' ? '' : `# 金额测算\n${calc.text}`,
      '# 庭审记录（最近部分）',
      entries.slice(-10).map((e) => `【${e.phaseTitle}】${e.roleLabel}：${e.text.slice(0, 700)}`).join('\n\n'),
      '# 输出',
      '先给出 3-6 句评议意见，然后按要求输出 JSON 代码块。',
    ].filter((s) => s !== '').join('\n\n')

    try {
      const result = await gateway.generate({
        system,
        messages: [{ role: 'user', content: user }],
        route: await gateway.resolve(session.config.judgeModel),
        maxTokens: 3000,
        temperature: 0.2,
        signal: withTimeout(state.abort.signal),
      })
      const parsed = parseReportFields(extractJsonBlock(result.text))
      const speech = stripJsonBlock(result.text)
      if (speech !== '') {
        await append(session.id, {
          phase: 'deliberation',
          phaseTitle: '评议',
          actor: 'judge',
          roleLabel: '评议人',
          text: speech,
          kind: 'speech',
        })
      }
      await patch(session.id, (s) => ({
        ...s,
        stats: { ...s.stats, calls: s.stats.calls + 1, tokensUsed: s.stats.tokensUsed + result.tokens },
      }), 'verdict-stats')
      return parsed
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await append(session.id, {
        phase: 'deliberation',
        phaseTitle: '评议',
        actor: 'clerk',
        roleLabel: '系统',
        text: `评议阶段模型调用失败：${message}。报告将基于已有庭审记录生成（无结构化评议字段）。`,
        kind: 'system',
      })
      return {}
    }
  }

  return {
    async start(sessionId) {
      const existing = runs.get(sessionId)
      if (existing !== undefined && existing.running) return
      const session = await store.getSession(sessionId)
      if (session === undefined) throw new Error(`moot session not found: ${sessionId}`)
      // 已完成的会话不重跑（重跑会重复生成判决书与评议记录）；需要对比就建新会话。
      if (session.status === 'done') return
      const state: RunState = {
        sessionId,
        abort: new AbortController(),
        paused: false,
        fastForward: false,
        running: true,
      }
      runs.set(sessionId, state)
      // 后台推进：HTTP 请求立即返回，面板轮询进度。
      void run(state)
    },

    async control(sessionId, action) {
      const session = await store.getSession(sessionId)
      if (session === undefined) throw new Error(`moot session not found: ${sessionId}`)
      switch (action) {
        case 'start': {
          await this.start(sessionId)
          return (await store.getSession(sessionId))!
        }
        case 'pause': {
          const state = runs.get(sessionId)
          if (state !== undefined) state.paused = true
          return patch(sessionId, (s) => ({ ...s, status: 'paused' }), 'paused')
        }
        case 'resume': {
          // 已完成的会话不重跑：重跑会重复生成判决书与评议记录。
          if (session.status === 'done') return session
          const state = runs.get(sessionId)
          if (state === undefined || !state.running) {
            // 已停止的运行：按已完成阶段断点续跑。
            await this.start(sessionId)
            return (await store.getSession(sessionId))!
          }
          state.paused = false
          state.fastForward = false
          // 若正在等待我方发言，先不动；律师提交发言后自然继续。
          if (session.status === 'waiting') return session
          return patch(sessionId, (s) => ({ ...s, status: 'running' }), 'resumed')
        }
        case 'fastforward': {
          const state = runs.get(sessionId)
          if (state !== undefined) state.fastForward = true
          return patch(sessionId, (s) => ({ ...s, stats: { ...s.stats, truncated: true } }), 'fastforward')
        }
        case 'abort': {
          const state = runs.get(sessionId)
          if (state !== undefined) {
            state.abort.abort()
            state.paused = false
            state.waiting?.('（律师中止了本次庭审）')
          }
          return patch(sessionId, (s) => ({ ...s, status: 'aborted' }), 'aborted')
        }
        default:
          throw new Error(`unknown control action: ${String(action)}`)
      }
    },

    async intervene(sessionId, text) {
      const state = runs.get(sessionId)
      if (state === undefined || state.waiting === undefined) {
        return { accepted: false }
      }
      const trimmed = text.trim()
      if (trimmed === '') return { accepted: false }
      const resolve = state.waiting
      state.waiting = undefined
      resolve(trimmed)
      return { accepted: true }
    },

    isRunning(sessionId) {
      return runs.get(sessionId)?.running === true
    },

    stopAll() {
      for (const state of runs.values()) {
        state.abort.abort()
        state.waiting?.('（插件卸载）')
      }
      runs.clear()
    },
  }
}
