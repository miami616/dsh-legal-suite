/**
 * MootPanel.tsx — 模拟法庭主面板（四个视图）。
 *
 * 视图由 MootPanelController 驱动：list（会话列表）/ wizard（四步新建向导）/
 * live（庭审直播 + 控制条）/ report（模拟报告 + 判决书）。
 *
 * 数据面：列表用 GET sessions；直播视图轮询 GET session + session/transcript
 * 增量（since=seq），并在 `agentlex:moot-changed`（SSE 桥）到达时立即补拉；
 * 向导按 案件 → dossier 快照 → prepare 校验 → create 的次序调后端。
 * 所有模拟产物区域都展示 MOOT_DISCLAIMER 免责口径（面板顶部常驻横幅 + 报告内）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as api from './api.ts'
import type {
  CreateSessionInput, MootCaseOption, MootControlAction, MootModelsResult, PrepareResult,
  WritebackResult,
} from './api.ts'
import type { MootPanelController, MootView } from './controller.ts'
import { errorMessage, tt } from './i18n.ts'
import css from './panel.module.css'
import {
  MODE_LABEL, MOOT_DISCLAIMER, PROCEDURE_LABEL, STATUS_LABEL, TRIBUNAL_LABEL,
} from '../store/types.ts'
import type {
  ArbitrationRules, AttackVector, Citation, Dossier, DossierEvidence, Issue, Mode,
  MootReport, MootSuggestion, Procedure, SessionStatus, TranscriptEntry, TrialSession, Tribunal,
} from '../store/types.ts'

/* ─────────────────────────────── 常量与小工具 ─────────────────────────────── */

const PROCEDURE_OPTIONS: Procedure[] = ['civil_first', 'civil_second', 'labor_arb', 'commercial_arb']
const MODE_OPTIONS: Mode[] = ['stress', 'auto', 'rehearsal']
const ARB_RULE_OPTIONS: ArbitrationRules[] = ['cietac', 'bac', 'shiac', 'generic']

/** 每种程序允许的法庭组成（顺序即默认值）。 */
const TRIBUNAL_OPTIONS: Record<Procedure, Tribunal[]> = {
  civil_first: ['collegial', 'single'],
  civil_second: ['collegial'],
  labor_arb: ['arb_solo', 'arb_panel'],
  commercial_arb: ['arb_panel', 'arb_solo'],
}

const ARB_RULE_LABEL_KEY: Record<ArbitrationRules, string> = {
  cietac: 'arb.cietac',
  bac: 'arb.bac',
  shiac: 'arb.shiac',
  generic: 'arb.generic',
}

const MODE_HINT_KEY: Record<Mode, string> = {
  stress: 'wizard.modeStressHint',
  auto: 'wizard.modeAutoHint',
  rehearsal: 'wizard.modeRehearsalHint',
}

const SEVERITY_RANK: Record<AttackVector['severity'], number> = { high: 0, medium: 1, low: 2 }
const PRIORITY_RANK: Record<MootSuggestion['priority'], number> = { high: 0, medium: 1, low: 2 }

/** 时间展示；非法值原样返回。 */
function formatTime(iso: string | undefined): string {
  if (iso === undefined || iso === '') return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString()
}

/** 文本域 ↔ 字符串数组（每行一条，去空行）。 */
function splitLines(value: string): string[] {
  return value.split('\n').map((line) => line.trim()).filter((line) => line !== '')
}

/** 数字输入解析，非法时回退默认值。 */
function toInt(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toFloat(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** 手工填写模式下的空快照。 */
function emptyDossier(): Dossier {
  return {
    claims: [],
    parties: [],
    evidence: [],
    materials: [],
    builtAt: new Date().toISOString(),
    sources: [tt('wizard.manual')],
  }
}

function leaningText(leaning: MootReport['verdict']['leaning']): string {
  switch (leaning) {
    case 'us': return tt('report.leaningUs')
    case 'them': return tt('report.leaningThem')
    case 'partial': return tt('report.leaningPartial')
    default: return tt('report.leaningUnclear')
  }
}

function confidenceText(confidence: 'high' | 'medium' | 'low'): string {
  switch (confidence) {
    case 'high': return tt('report.confidenceHigh')
    case 'medium': return tt('report.confidenceMedium')
    default: return tt('report.confidenceLow')
  }
}

function severityText(severity: AttackVector['severity']): string {
  switch (severity) {
    case 'high': return tt('report.severityHigh')
    case 'medium': return tt('report.severityMedium')
    default: return tt('report.severityLow')
  }
}

function severityClass(severity: AttackVector['severity']): string {
  switch (severity) {
    case 'high': return css.severityHigh
    case 'medium': return css.severityMedium
    default: return css.severityLow
  }
}

function priorityText(priority: MootSuggestion['priority']): string {
  switch (priority) {
    case 'high': return tt('report.priorityHigh')
    case 'medium': return tt('report.priorityMedium')
    default: return tt('report.priorityLow')
  }
}

function priorityClass(priority: MootSuggestion['priority']): string {
  switch (priority) {
    case 'high': return css.priorityHigh
    case 'medium': return css.priorityMedium
    default: return css.priorityLow
  }
}

function kindText(kind: MootSuggestion['kind']): string {
  switch (kind) {
    case 'evidence': return tt('report.kindEvidence')
    case 'document': return tt('report.kindDocument')
    default: return tt('report.kindStrategy')
  }
}

/** 发言主体 → 左侧色条 class（clerk 灰 / judge 蓝 / opponent 红 / self|user 绿）。 */
function actorClass(actor: TranscriptEntry['actor']): string {
  switch (actor) {
    case 'clerk': return css.actorClerk
    case 'opponent': return css.actorOpponent
    case 'self':
    case 'user': return css.actorSelf
    default: return css.actorJudge
  }
}

/** 发言主体兜底标签（transcript 自带 roleLabel，缺失时用）。 */
function actorLabel(actor: TranscriptEntry['actor']): string {
  switch (actor) {
    case 'clerk': return tt('actor.clerk')
    case 'judge': return tt('actor.judge')
    case 'opponent': return tt('actor.opponent')
    case 'self': return tt('actor.self')
    case 'user': return tt('actor.user')
    default: return tt('actor.panel')
  }
}

/** 会话状态 → 徽标配色。 */
function statusTone(status: SessionStatus): string {
  switch (status) {
    case 'done': return css.badgeOk
    case 'running':
    case 'adjudicating': return css.badgeAccent
    case 'waiting':
    case 'paused':
    case 'ready': return css.badgeWarn
    case 'failed':
    case 'aborted': return css.badgeErr
    default: return css.badgeInfo
  }
}

/* ─────────────────────────────── 小组件 ─────────────────────────────── */

/** 引证折叠块：法条 / 类案，点开后列 kind / ref / title / summary。 */
function Citations({ items }: { items: Citation[] }) {
  if (items.length === 0) return null
  return (
    <details className={css.citations}>
      <summary>{tt('live.citations', { n: items.length })}</summary>
      <ul className={css.citationList}>
        {items.map((item, index) => (
          <li key={`${item.kind}-${item.ref}-${index}`} className={css.citationItem}>
            <span className={css.citationKind}>
              {item.kind === 'article' ? tt('live.citationArticle') : tt('live.citationCase')}
            </span>
            <span className={css.citationRef}>{item.ref}</span>
            {item.title !== undefined && item.title !== '' ? <span>{item.title}</span> : null}
            {item.source !== undefined && item.source !== '' ? <span className={css.hint}> · {item.source}</span> : null}
            {item.summary !== undefined && item.summary !== ''
              ? <p className={css.citationSummary}>{item.summary}</p>
              : null}
          </li>
        ))}
      </ul>
    </details>
  )
}

/* ─────────────────────────────── 主面板 ─────────────────────────────── */

export interface MootPanelProps {
  controller: MootPanelController
  onClose: () => void
}

export function MootPanel({ controller, onClose }: MootPanelProps) {
  const [snapshot, setSnapshot] = useState(() => controller.getSnapshot())
  const [sessions, setSessions] = useState<TrialSession[]>([])
  const [loading, setLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)

  useEffect(() => controller.subscribe(() => { setSnapshot(controller.getSnapshot()) }), [controller])

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const list = await api.listSessions()
      setSessions([...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)))
      setListError(null)
    } catch (error) {
      setListError(errorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  // 列表视图下，SSE 变更事件到达即刷新列表。
  useEffect(() => {
    if (snapshot.view !== 'list') return
    const onChanged = (): void => { void reload() }
    window.addEventListener('agentlex:moot-changed', onChanged)
    return () => window.removeEventListener('agentlex:moot-changed', onChanged)
  }, [snapshot.view, reload])

  const current = useMemo(
    () => sessions.find((session) => session.id === snapshot.sessionId) ?? null,
    [sessions, snapshot.sessionId],
  )

  // 会话被删除等情况下，live/report 无目标时回落到列表。
  const view: MootView = (snapshot.view === 'live' || snapshot.view === 'report') && current === null
    ? 'list'
    : snapshot.view

  const handleCreated = useCallback((created: TrialSession): void => {
    setSessions((prev) => [created, ...prev.filter((session) => session.id !== created.id)])
    controller.openSession(created.id, 'live')
  }, [controller])

  const handleDelete = useCallback(async (session: TrialSession): Promise<void> => {
    if (!window.confirm(tt('list.deleteConfirm', { title: session.title }))) return
    try {
      await api.deleteSession(session.id)
      if (controller.getSnapshot().sessionId === session.id) controller.clearSession()
      await reload()
    } catch (error) {
      setListError(errorMessage(error))
    }
  }, [controller, reload])

  const handleResume = useCallback(async (session: TrialSession): Promise<void> => {
    const action: MootControlAction = session.status === 'paused' || session.status === 'waiting' ? 'resume' : 'start'
    try {
      await api.controlSession(session.id, action)
      controller.openSession(session.id, 'live')
      await reload()
    } catch (error) {
      setListError(errorMessage(error))
    }
  }, [controller, reload])

  const tabs: Array<{ view: MootView; label: string; disabled: boolean }> = [
    { view: 'list', label: tt('tab.list'), disabled: false },
    { view: 'wizard', label: tt('tab.wizard'), disabled: false },
    { view: 'live', label: tt('tab.live'), disabled: current === null },
    { view: 'report', label: tt('tab.report'), disabled: current === null || current.status !== 'done' },
  ]

  const selectTab = (next: MootView): void => {
    if (next === 'wizard') controller.startWizard()
    else controller.setView(next)
  }

  return (
    <div className={css.panel}>
      <header className={css.header}>
        <div className={css.headerMain}>
          <h2 className={css.headerTitle}>
            {tt('panel.title')}
            <span className={`${css.badge} ${css.badgeWarn} ${css.experimentalBadge}`}>{tt('panel.experimental')}</span>
          </h2>
          <p className={css.headerSub}>{current === null ? tt('panel.subtitle') : current.title}</p>
        </div>
        <div className={css.headerActions}>
          <button type="button" className={`${css.btn} ${css.btnSm}`} onClick={() => { void reload() }}>
            {tt('panel.refresh')}
          </button>
          <button type="button" className={`${css.btn} ${css.btnSm}`} onClick={onClose}>
            {tt('panel.close')}
          </button>
        </div>
      </header>

      <nav className={css.tabs}>
        {tabs.map((tab) => (
          <button
            key={tab.view}
            type="button"
            className={`${css.tab} ${view === tab.view ? css.tabActive : ''}`}
            disabled={tab.disabled}
            onClick={() => { selectTab(tab.view) }}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* 免责口径常驻横幅：模拟产物区域一律可见。 */}
      <div className={css.disclaimer}>
        <span className={css.disclaimerLabel}>{tt('panel.disclaimerLabel')}</span>
        <span>{MOOT_DISCLAIMER}</span>
      </div>

      {/* 实验性提示：告知这是实验性功能，以及在哪里关掉。 */}
      <div className={css.experimentalNotice}>
        <span className={`${css.badge} ${css.badgeWarn}`}>{tt('panel.experimental')}</span>
        <span>{tt('panel.experimentalNotice')}</span>
      </div>

      <div className={css.body}>
        {view === 'list' ? (
          <ListView
            sessions={sessions}
            loading={loading}
            error={listError}
            onRefresh={() => { void reload() }}
            onNew={() => controller.startWizard()}
            onOpen={(session) => controller.openSession(session.id, 'live')}
            onReport={(session) => controller.openSession(session.id, 'report')}
            onResume={(session) => { void handleResume(session) }}
            onDelete={(session) => { void handleDelete(session) }}
          />
        ) : null}

        {view === 'wizard' ? (
          <WizardView
            onCreated={handleCreated}
            onCancel={() => controller.setView('list')}
          />
        ) : null}

        {view === 'live' && current !== null ? (
          <LiveView
            key={current.id}
            session={current}
            onOpenReport={() => controller.setView('report')}
          />
        ) : null}

        {view === 'report' && current !== null ? (
          <ReportView key={current.id} session={current} />
        ) : null}
      </div>
    </div>
  )
}

/* ─────────────────────────────── 列表视图 ─────────────────────────────── */

interface ListViewProps {
  sessions: TrialSession[]
  loading: boolean
  error: string | null
  onRefresh(): void
  onNew(): void
  onOpen(session: TrialSession): void
  onReport(session: TrialSession): void
  onResume(session: TrialSession): void
  onDelete(session: TrialSession): void
}

function ListView(props: ListViewProps) {
  const { sessions, loading, error } = props
  return (
    <div>
      {error !== null ? <div className={css.errorBox}>{tt('list.loadFailed', { error })}</div> : null}

      {sessions.length === 0 ? (
        <div className={css.empty}>
          <div className={css.emptyTitle}>{loading ? tt('common.loading') : tt('list.empty')}</div>
          <p className={css.hint}>{tt('list.emptyHint')}</p>
          <button type="button" className={`${css.btn} ${css.btnPrimary}`} onClick={props.onNew}>
            {tt('list.new')}
          </button>
        </div>
      ) : (
        <div className={css.list}>
          {sessions.map((session) => {
            const resumable = session.status === 'paused' || session.status === 'waiting' || session.status === 'ready'
            const resumableLabel = session.status === 'ready' ? tt('list.start') : tt('list.resume')
            return (
              <div key={session.id} className={css.row}>
                <div className={css.rowMain}>
                  <div className={css.rowTitle}>{session.title}</div>
                  <div className={css.rowMeta}>
                    <span className={css.badge}>{PROCEDURE_LABEL[session.procedure]}</span>
                    <span className={css.badge}>{MODE_LABEL[session.mode]}</span>
                    <span className={`${css.badge} ${statusTone(session.status)}`}>{STATUS_LABEL[session.status]}</span>
                    <span className={css.badge}>{TRIBUNAL_LABEL[session.tribunal]}</span>
                  </div>
                  <div className={css.rowSub}>
                    {tt('list.updated', { time: formatTime(session.updatedAt) })}
                    {' · '}
                    {tt('list.round', { n: session.round })}
                    {' · '}
                    {tt('list.tokens', { n: session.stats.tokensUsed })}
                    {session.error !== undefined && session.error !== '' ? ` · ${session.error}` : ''}
                  </div>
                </div>
                <div className={css.rowActions}>
                  <button type="button" className={`${css.btn} ${css.btnSm}`} onClick={() => props.onOpen(session)}>
                    {tt('list.open')}
                  </button>
                  {session.status === 'done' ? (
                    <button type="button" className={`${css.btn} ${css.btnSm}`} onClick={() => props.onReport(session)}>
                      {tt('list.report')}
                    </button>
                  ) : null}
                  {resumable ? (
                    <button type="button" className={`${css.btn} ${css.btnSm}`} onClick={() => props.onResume(session)}>
                      {resumableLabel}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={`${css.btn} ${css.btnSm} ${css.btnDanger}`}
                    onClick={() => props.onDelete(session)}
                  >
                    {tt('list.delete')}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────────── 新建向导 ─────────────────────────────── */

interface WizardViewProps {
  onCreated(created: TrialSession): void
  onCancel(): void
}

function WizardView({ onCreated, onCancel }: WizardViewProps) {
  const [step, setStep] = useState(1)
  const [stepError, setStepError] = useState<string | null>(null)

  // 步骤 1：案件选择
  const [cases, setCases] = useState<MootCaseOption[]>([])
  const [casesError, setCasesError] = useState<string | null>(null)
  const [caseFilter, setCaseFilter] = useState('')
  const [manual, setManual] = useState(false)
  const [caseId, setCaseId] = useState<string | null>(null)

  // 步骤 2：程序 / 模式 / 法庭组成
  const [procedure, setProcedure] = useState<Procedure>('civil_first')
  const [runMode, setRunMode] = useState<Mode>('stress')
  const [tribunal, setTribunal] = useState<Tribunal>('collegial')
  const [arbRules, setArbRules] = useState<ArbitrationRules>('cietac')

  // 步骤 3：材料快照与校验
  const [dossier, setDossier] = useState<Dossier | null>(null)
  const [excludedMaterials, setExcludedMaterials] = useState<Set<string>>(() => new Set<string>())
  const [dossierLoading, setDossierLoading] = useState(false)
  const [dossierError, setDossierError] = useState<string | null>(null)
  const [prepareResult, setPrepareResult] = useState<PrepareResult | null>(null)
  const [prepareError, setPrepareError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  // 步骤 4：模型与预算
  const [models, setModels] = useState<MootModelsResult | null>(null)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [judgeModel, setJudgeModel] = useState('')
  const [opponentModel, setOpponentModel] = useState('')
  const [retrievalEnabled, setRetrievalEnabled] = useState(true)
  const [retrievalProvince, setRetrievalProvince] = useState('')
  const [maxRounds, setMaxRounds] = useState(2)
  const [tokenBudget, setTokenBudget] = useState(120000)
  const [maxTokensPerTurn, setMaxTokensPerTurn] = useState(2400)
  const [opponentTemperature, setOpponentTemperature] = useState(0.9)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // 案件清单
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const result = await api.listCases()
        if (!alive) return
        setCases(result.cases)
        setCasesError(null)
      } catch (error) {
        if (alive) setCasesError(errorMessage(error))
      }
    })()
    return () => { alive = false }
  }, [])

  // 进入步骤 3：构建材料快照并校验（选定案件则从卷宗复制，否则用空快照手工填写）。
  // 已为同一「案件 + 程序」构建过快照时不再重建，避免 4→3 回退时丢失手工编辑。
  const buildKeyRef = useRef<string | null>(null)
  useEffect(() => {
    if (step !== 3) return
    const buildKey = `${manual ? 'manual' : caseId ?? 'none'}|${procedure}`
    if (buildKeyRef.current === buildKey && dossier !== null) return
    buildKeyRef.current = buildKey
    let alive = true
    setDossierLoading(true)
    setDossierError(null)
    setPrepareResult(null)
    setPrepareError(null)
    setExcludedMaterials(new Set<string>())
    void (async () => {
      try {
        const next: Dossier = manual || caseId === null
          ? emptyDossier()
          : await api.buildDossier(caseId, procedure)
        if (!alive) return
        setDossier(next)
        const prepared = await api.prepare(procedure, next)
        if (!alive) return
        setPrepareResult(prepared)
      } catch (error) {
        if (alive) {
          setDossierError(errorMessage(error))
          buildKeyRef.current = null
        }
      } finally {
        if (alive) setDossierLoading(false)
      }
    })()
    return () => { alive = false }
  }, [step, manual, caseId, procedure, dossier])

  // 进入步骤 4：模型清单
  useEffect(() => {
    if (step !== 4) return
    let alive = true
    void (async () => {
      try {
        const result = await api.listModels()
        if (!alive) return
        setModels(result)
        setModelsError(null)
        setJudgeModel((prev) => (prev === '' ? result.default : prev))
      } catch (error) {
        if (alive) setModelsError(errorMessage(error))
      }
    })()
    return () => { alive = false }
  }, [step])

  const filteredCases = useMemo(() => {
    const query = caseFilter.trim().toLowerCase()
    if (query === '') return cases
    return cases.filter((item) =>
      item.name.toLowerCase().includes(query) || (item.cause ?? '').toLowerCase().includes(query))
  }, [cases, caseFilter])

  const blocking = useMemo(() => (prepareResult?.missing ?? []).filter((item) => item.blocking), [prepareResult])
  const nonBlocking = useMemo(() => (prepareResult?.missing ?? []).filter((item) => !item.blocking), [prepareResult])
  const canLeaveStep3 = prepareResult !== null && blocking.length === 0

  const chooseProcedure = (next: Procedure): void => {
    setProcedure(next)
    const options = TRIBUNAL_OPTIONS[next]
    setTribunal((prev) => (options.includes(prev) ? prev : options[0]))
  }

  const updateDossier = (patch: Partial<Dossier>): void => {
    setDossier((prev) => (prev === null ? prev : { ...prev, ...patch }))
  }

  const updateEvidence = (index: number, patch: Partial<DossierEvidence>): void => {
    if (dossier === null) return
    updateDossier({ evidence: dossier.evidence.map((item, i) => (i === index ? { ...item, ...patch } : item)) })
  }

  const addEvidence = (): void => {
    if (dossier === null) return
    updateDossier({ evidence: [...dossier.evidence, { no: String(dossier.evidence.length + 1), name: '', purpose: '' }] })
  }

  const removeEvidence = (index: number): void => {
    if (dossier === null) return
    updateDossier({ evidence: dossier.evidence.filter((_, i) => i !== index) })
  }

  /** 应用「材料勾选」后的快照（未勾选的条目在提交时剔除）。 */
  const effectiveDossier = useCallback((): Dossier | null => {
    if (dossier === null) return null
    return { ...dossier, materials: dossier.materials.filter((item) => !excludedMaterials.has(item.name)) }
  }, [dossier, excludedMaterials])

  const recheck = useCallback(async (): Promise<void> => {
    const payload = effectiveDossier()
    if (payload === null) return
    setChecking(true)
    setPrepareError(null)
    try {
      setPrepareResult(await api.prepare(procedure, payload))
    } catch (error) {
      setPrepareError(errorMessage(error))
    } finally {
      setChecking(false)
    }
  }, [effectiveDossier, procedure])

  const goNext = (): void => {
    setStepError(null)
    if (step === 1 && !manual && caseId === null) {
      setStepError(tt('wizard.needCase'))
      return
    }
    if (step === 3) {
      if (dossier === null) {
        setStepError(tt('wizard.needDossier'))
        return
      }
      if (prepareResult === null) {
        // 校验尚未完成或失败：明确回显原因，而不是报「0 项缺失」。
        setStepError(prepareError ?? dossierError ?? tt('wizard.needDossier'))
        return
      }
      if (!canLeaveStep3) {
        setStepError(tt('wizard.notReady', { n: blocking.length }))
        return
      }
    }
    setStep((prev) => Math.min(4, prev + 1))
  }

  const create = async (): Promise<void> => {
    const payload = effectiveDossier()
    if (payload === null) {
      setCreateError(tt('wizard.needDossier'))
      return
    }
    setCreating(true)
    setCreateError(null)
    try {
      const input: CreateSessionInput = {
        procedure,
        mode: runMode,
        tribunal,
        config: {
          judgeModel: judgeModel === '' ? undefined : judgeModel,
          opponentModel: opponentModel === '' ? undefined : opponentModel,
          retrievalEnabled,
          retrievalProvince: retrievalProvince.trim() === '' ? undefined : retrievalProvince.trim(),
          maxRounds,
          tokenBudget,
          maxTokensPerTurn,
          opponentTemperature,
        },
        dossier: payload,
      }
      if (!manual && caseId !== null) input.caseId = caseId
      if (title.trim() !== '') input.title = title.trim()
      if (procedure === 'commercial_arb') input.arbitrationRules = arbRules
      onCreated(await api.createSession(input))
    } catch (error) {
      setCreateError(errorMessage(error))
    } finally {
      setCreating(false)
    }
  }

  const stepLabels = [tt('wizard.step1'), tt('wizard.step2'), tt('wizard.step3'), tt('wizard.step4')]
  const selectedCase = cases.find((item) => item.caseId === caseId) ?? null

  return (
    <div className={css.wizard}>
      <div className={css.steps}>
        {stepLabels.map((label, index) => {
          const number = index + 1
          const state = number === step ? css.stepActive : number < step ? css.stepDone : ''
          return (
            <span key={label} className={`${css.step} ${state}`}>
              <span className={css.stepDot}>{number}</span>
              {label}
            </span>
          )
        })}
        <span className={css.hint}>{tt('wizard.stepOf', { step })}</span>
      </div>

      {stepError !== null ? <div className={css.errorBox}>{stepError}</div> : null}

      {/* ── 步骤 1：选案件 ─────────────────────────────────────────── */}
      {step === 1 ? (
        <div className={css.section}>
          <h3 className={css.sectionTitle}>{tt('wizard.step1')}</h3>
          {casesError !== null ? <div className={css.errorBox}>{tt('wizard.loadCasesFailed', { error: casesError })}</div> : null}
          <div className={css.field}>
            <input
              className={css.input}
              value={caseFilter}
              placeholder={tt('wizard.filterCases')}
              onChange={(event) => setCaseFilter(event.target.value)}
            />
          </div>
          <p className={css.hint}>{tt('wizard.caseCount', { n: filteredCases.length })}</p>
          <div className={css.cases}>
            {filteredCases.length === 0 ? <p className={css.hint}>{tt('wizard.noCases')}</p> : null}
            {filteredCases.map((item) => (
              <button
                key={item.caseId}
                type="button"
                className={`${css.caseItem} ${!manual && caseId === item.caseId ? css.caseItemActive : ''}`}
                onClick={() => { setManual(false); setCaseId(item.caseId); setStepError(null) }}
              >
                <span className={css.choiceBody}>
                  <span className={css.caseName}>{item.name}</span>
                  <span className={css.caseMeta}>
                    {[item.cause, item.court, item.level].filter((part) => part !== undefined && part !== '').join(' · ')}
                  </span>
                  {item.ourRole !== undefined || item.theirRole !== undefined ? (
                    <span className={css.caseMeta}>
                      {[item.ourRole, item.theirRole].filter((part) => part !== undefined && part !== '').join(' ↔ ')}
                    </span>
                  ) : null}
                </span>
                <span className={`${css.badge} ${item.hasCaseInfo ? css.badgeOk : css.badgeWarn}`}>
                  {item.hasCaseInfo ? tt('wizard.hasCaseInfo') : tt('wizard.noCaseInfo')}
                </span>
              </button>
            ))}
          </div>
          <button
            type="button"
            className={`${css.caseItem} ${manual ? css.caseItemActive : ''}`}
            onClick={() => { setManual(true); setStepError(null) }}
          >
            <span className={css.choiceBody}>
              <span className={css.caseName}>{tt('wizard.manual')}</span>
              <span className={css.caseMeta}>{tt('wizard.manualHint')}</span>
            </span>
          </button>
          {!manual && selectedCase !== null ? (
            <p className={css.hint}>{tt('wizard.selectedCase', { name: selectedCase.name })}</p>
          ) : null}
        </div>
      ) : null}

      {/* ── 步骤 2：程序 / 模式 / 法庭组成 ─────────────────────────── */}
      {step === 2 ? (
        <div>
          <div className={css.section}>
            <h3 className={css.sectionTitle}>{tt('wizard.procedure')}</h3>
            <div className={css.choiceList}>
              {PROCEDURE_OPTIONS.map((option) => (
                <label key={option} className={`${css.choice} ${procedure === option ? css.choiceActive : ''}`}>
                  <input
                    type="radio"
                    name="moot-procedure"
                    checked={procedure === option}
                    onChange={() => chooseProcedure(option)}
                  />
                  <span className={css.choiceBody}>{PROCEDURE_LABEL[option]}</span>
                </label>
              ))}
            </div>
          </div>

          <div className={css.section}>
            <h3 className={css.sectionTitle}>{tt('wizard.mode')}</h3>
            <div className={css.choiceList}>
              {MODE_OPTIONS.map((option) => (
                <label key={option} className={`${css.choice} ${runMode === option ? css.choiceActive : ''}`}>
                  <input
                    type="radio"
                    name="moot-mode"
                    checked={runMode === option}
                    onChange={() => setRunMode(option)}
                  />
                  <span className={css.choiceBody}>
                    <span className={css.caseName}>{MODE_LABEL[option]}</span>
                    <span className={css.choiceHint}>{tt(MODE_HINT_KEY[option])}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className={css.section}>
            <h3 className={css.sectionTitle}>{tt('wizard.tribunal')}</h3>
            <div className={css.choiceList}>
              {TRIBUNAL_OPTIONS[procedure].map((option) => (
                <label key={option} className={`${css.choice} ${tribunal === option ? css.choiceActive : ''}`}>
                  <input
                    type="radio"
                    name="moot-tribunal"
                    checked={tribunal === option}
                    onChange={() => setTribunal(option)}
                  />
                  <span className={css.choiceBody}>{TRIBUNAL_LABEL[option]}</span>
                </label>
              ))}
            </div>
          </div>

          {procedure === 'commercial_arb' ? (
            <div className={css.section}>
              <h3 className={css.sectionTitle}>{tt('wizard.arbRules')}</h3>
              <select
                className={css.select}
                value={arbRules}
                onChange={(event) => setArbRules(event.target.value as ArbitrationRules)}
              >
                {ARB_RULE_OPTIONS.map((option) => (
                  <option key={option} value={option}>{tt(ARB_RULE_LABEL_KEY[option])}</option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── 步骤 3：材料确认 ───────────────────────────────────────── */}
      {step === 3 ? (
        <div>
          {dossierLoading ? <div className={css.loading}>{tt('wizard.dossierLoading')}</div> : null}
          {dossierError !== null ? <div className={css.errorBox}>{tt('wizard.dossierFailed', { error: dossierError })}</div> : null}

          {dossier !== null ? (
            <div>
              <div className={css.field}>
                <label className={css.label}>{tt('wizard.claims')}</label>
                <textarea
                  className={css.textarea}
                  value={dossier.claims.join('\n')}
                  onChange={(event) => updateDossier({ claims: splitLines(event.target.value) })}
                />
                <p className={css.hint}>{tt('wizard.claimsHint')}</p>
              </div>

              <div className={css.field}>
                <label className={css.label}>{tt('wizard.facts')}</label>
                <textarea
                  className={css.textarea}
                  value={dossier.facts ?? ''}
                  onChange={(event) => updateDossier({ facts: event.target.value })}
                />
              </div>

              <div className={css.field}>
                <label className={css.label}>{tt('wizard.brief')}</label>
                <textarea
                  className={css.textarea}
                  value={dossier.brief ?? ''}
                  onChange={(event) => updateDossier({ brief: event.target.value })}
                />
              </div>

              {procedure === 'civil_second' ? (
                <div>
                  <div className={css.field}>
                    <label className={css.label}>{tt('wizard.priorJudgment')}</label>
                    <textarea
                      className={css.textarea}
                      value={dossier.priorJudgment ?? ''}
                      onChange={(event) => updateDossier({ priorJudgment: event.target.value })}
                    />
                  </div>
                  <div className={css.field}>
                    <label className={css.label}>{tt('wizard.appealGrounds')}</label>
                    <textarea
                      className={css.textarea}
                      value={(dossier.appealGrounds ?? []).join('\n')}
                      onChange={(event) => updateDossier({ appealGrounds: splitLines(event.target.value) })}
                    />
                    <p className={css.hint}>{tt('wizard.appealGroundsHint')}</p>
                  </div>
                </div>
              ) : null}

              <div className={css.section}>
                <h3 className={css.sectionTitle}>{tt('wizard.evidence')}</h3>
                {dossier.evidence.length === 0 ? <p className={css.hint}>{tt('wizard.noEvidence')}</p> : null}
                {dossier.evidence.map((item, index) => (
                  <div key={`evidence-${index}`} className={css.evidenceRow}>
                    <input
                      className={css.input}
                      value={item.no}
                      aria-label={tt('wizard.evidenceNo')}
                      placeholder={tt('wizard.evidenceNo')}
                      onChange={(event) => updateEvidence(index, { no: event.target.value })}
                    />
                    <input
                      className={css.input}
                      value={item.name}
                      aria-label={tt('wizard.evidenceName')}
                      placeholder={tt('wizard.evidenceName')}
                      onChange={(event) => updateEvidence(index, { name: event.target.value })}
                    />
                    <input
                      className={css.input}
                      value={item.purpose ?? ''}
                      aria-label={tt('wizard.evidencePurpose')}
                      placeholder={tt('wizard.evidencePurpose')}
                      onChange={(event) => updateEvidence(index, { purpose: event.target.value })}
                    />
                    <button
                      type="button"
                      className={`${css.btn} ${css.btnSm} ${css.btnDanger}`}
                      onClick={() => removeEvidence(index)}
                    >
                      {tt('common.remove')}
                    </button>
                  </div>
                ))}
                <button type="button" className={`${css.btn} ${css.btnSm}`} onClick={addEvidence}>
                  {tt('wizard.addEvidence')}
                </button>
              </div>

              <div className={css.section}>
                <h3 className={css.sectionTitle}>{tt('wizard.caseMaterials')}</h3>
                <p className={css.hint}>{tt('wizard.caseMaterialsHint')}</p>
                {dossier.materials.length === 0 ? <p className={css.hint}>{tt('wizard.noMaterials')}</p> : null}
                <div className={css.materialList}>
                  {dossier.materials.map((item) => (
                    <label key={item.name} className={css.choice}>
                      <input
                        type="checkbox"
                        checked={!excludedMaterials.has(item.name)}
                        onChange={(event) => {
                          setExcludedMaterials((prev) => {
                            const next = new Set(prev)
                            if (event.target.checked) next.delete(item.name)
                            else next.add(item.name)
                            return next
                          })
                        }}
                      />
                      <span className={css.choiceBody}>
                        <span className={css.caseName}>{item.name}</span>
                        {item.note !== undefined && item.note !== '' ? (
                          <span className={css.choiceHint}>{item.note}</span>
                        ) : null}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className={css.section}>
                <div className={css.btnRow}>
                  <button
                    type="button"
                    className={`${css.btn} ${css.btnSm}`}
                    disabled={checking || dossierLoading}
                    onClick={() => { void recheck() }}
                  >
                    {checking ? tt('wizard.checking') : tt('wizard.check')}
                  </button>
                </div>
                {prepareError !== null ? <div className={css.errorBox}>{tt('wizard.prepareFailed', { error: prepareError })}</div> : null}
                {prepareResult !== null ? (
                  prepareResult.ready
                    ? <div className={css.okBox}>{tt('wizard.ready')}</div>
                    : <div className={css.warnBox}>{tt('wizard.notReady', { n: blocking.length })}</div>
                ) : null}
                {blocking.length > 0 ? (
                  <ul className={css.missingList}>
                    {blocking.map((item) => (
                      <li key={`block-${item.key}`} className={`${css.missingItem} ${css.missingBlocking}`}>
                        <strong>{tt('wizard.blocking')}</strong>：{item.label}
                        {item.code !== '' ? `（${item.code}）` : ''}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {nonBlocking.length > 0 ? (
                  <ul className={css.missingList}>
                    {nonBlocking.map((item) => (
                      <li key={`warn-${item.key}`} className={`${css.missingItem} ${css.missingWarn}`}>
                        <strong>{tt('wizard.nonBlocking')}</strong>：{item.label}
                        {item.code !== '' ? `（${item.code}）` : ''}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {prepareResult !== null && prepareResult.warnings.length > 0 ? (
                  <ul className={css.missingList}>
                    {prepareResult.warnings.map((warning, index) => (
                      <li key={`warning-${index}`} className={`${css.missingItem} ${css.missingWarn}`}>
                        <strong>{tt('wizard.warnings')}</strong>：{warning}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── 步骤 4：模型与预算 ─────────────────────────────────────── */}
      {step === 4 ? (
        <div>
          {modelsError !== null ? <div className={css.errorBox}>{tt('wizard.modelsFailed', { error: modelsError })}</div> : null}

          <div className={css.field}>
            <label className={css.label}>{tt('wizard.sessionTitle')}</label>
            <input
              className={css.input}
              value={title}
              placeholder={tt('wizard.sessionTitlePlaceholder')}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>

          <div className={css.grid2}>
            <div className={css.field}>
              <label className={css.label}>{tt('wizard.judgeModel')}</label>
              <select
                className={css.select}
                value={judgeModel}
                onChange={(event) => setJudgeModel(event.target.value)}
              >
                <option value="">{tt('wizard.defaultModel')}</option>
                {(models?.providers ?? []).map((provider) => (
                  <optgroup key={provider.id} label={provider.name}>
                    {provider.models.map((model) => (
                      <option key={model.id} value={model.id}>{model.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {models !== null && models.default !== '' ? (
                <p className={css.hint}>{tt('wizard.defaultModel')}：{models.default}</p>
              ) : null}
            </div>

            <div className={css.field}>
              <label className={css.label}>{tt('wizard.opponentModel')}</label>
              <select
                className={css.select}
                value={opponentModel}
                onChange={(event) => setOpponentModel(event.target.value)}
              >
                <option value="">{tt('wizard.sameAsJudge')}</option>
                {(models?.providers ?? []).map((provider) => (
                  <optgroup key={provider.id} label={provider.name}>
                    {provider.models.map((model) => (
                      <option key={model.id} value={model.id}>{model.name}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>

          <div className={css.section}>
            <label className={css.choice}>
              <input
                type="checkbox"
                checked={retrievalEnabled}
                onChange={(event) => setRetrievalEnabled(event.target.checked)}
              />
              <span className={css.choiceBody}>
                <span className={css.caseName}>{tt('wizard.retrieval')}</span>
                <span className={css.choiceHint}>{tt('wizard.retrievalHint')}</span>
              </span>
            </label>
            {retrievalEnabled ? (
              <div className={css.field}>
                <label className={css.label}>{tt('wizard.retrievalProvince')}</label>
                <input
                  className={css.input}
                  value={retrievalProvince}
                  placeholder={tt('wizard.retrievalProvincePlaceholder')}
                  onChange={(event) => setRetrievalProvince(event.target.value)}
                />
              </div>
            ) : null}
          </div>

          <div className={css.grid2}>
            <div className={css.field}>
              <label className={css.label}>{tt('wizard.maxRounds')}</label>
              <input
                className={css.input}
                type="number"
                min={1}
                value={maxRounds}
                onChange={(event) => setMaxRounds(toInt(event.target.value, maxRounds))}
              />
            </div>
            <div className={css.field}>
              <label className={css.label}>{tt('wizard.tokenBudget')}</label>
              <input
                className={css.input}
                type="number"
                min={1000}
                step={1000}
                value={tokenBudget}
                onChange={(event) => setTokenBudget(toInt(event.target.value, tokenBudget))}
              />
            </div>
            <div className={css.field}>
              <label className={css.label}>{tt('wizard.maxTokensPerTurn')}</label>
              <input
                className={css.input}
                type="number"
                min={256}
                step={128}
                value={maxTokensPerTurn}
                onChange={(event) => setMaxTokensPerTurn(toInt(event.target.value, maxTokensPerTurn))}
              />
            </div>
          </div>

          <div className={css.field}>
            <label className={css.label}>{tt('wizard.opponentTemperature', { value: opponentTemperature.toFixed(2) })}</label>
            <input
              className={css.slider}
              type="range"
              min={0}
              max={1.5}
              step={0.05}
              value={opponentTemperature}
              onChange={(event) => setOpponentTemperature(toFloat(event.target.value, opponentTemperature))}
            />
          </div>

          {createError !== null ? <div className={css.errorBox}>{tt('wizard.createFailed', { error: createError })}</div> : null}
        </div>
      ) : null}

      <div className={css.actions}>
        <div className={css.btnRow}>
          <button type="button" className={`${css.btn} ${css.btnSm}`} onClick={onCancel}>
            {tt('common.cancel')}
          </button>
          {step > 1 ? (
            <button
              type="button"
              className={`${css.btn} ${css.btnSm}`}
              disabled={creating}
              onClick={() => { setStepError(null); setStep((prev) => Math.max(1, prev - 1)) }}
            >
              {tt('common.back')}
            </button>
          ) : null}
        </div>
        <div className={css.actionsRight}>
          {step < 4 ? (
            <button type="button" className={`${css.btn} ${css.btnPrimary}`} onClick={goNext}>
              {tt('common.next')}
            </button>
          ) : (
            <button
              type="button"
              className={`${css.btn} ${css.btnPrimary}`}
              disabled={creating}
              onClick={() => { void create() }}
            >
              {creating ? tt('wizard.creating') : tt('wizard.create')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/* ─────────────────────────────── 直播视图 ─────────────────────────────── */

interface LiveViewProps {
  session: TrialSession
  onOpenReport(): void
}

function LiveView({ session, onOpenReport }: LiveViewProps) {
  const sessionId = session.id
  const [current, setCurrent] = useState<TrialSession>(session)
  const [entries, setEntries] = useState<TranscriptEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const sinceRef = useRef(0)
  const streamRef = useRef<HTMLDivElement | null>(null)
  const lastCount = useRef(0)

  /** 拉取会话状态 + 增量庭审记录。 */
  const pull = useCallback(async (): Promise<void> => {
    try {
      const [fresh, added] = await Promise.all([
        api.getSession(sessionId),
        api.getTranscript(sessionId, sinceRef.current),
      ])
      setCurrent(fresh)
      if (added.length > 0) {
        const last = added[added.length - 1]
        if (last !== undefined) sinceRef.current = last.seq
        setEntries((prev) => {
          const seen = new Set(prev.map((entry) => entry.seq))
          const merged = [...prev, ...added.filter((entry) => !seen.has(entry.seq))]
          merged.sort((a, b) => a.seq - b.seq)
          return merged
        })
      }
      setError(null)
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [sessionId])

  // 轮询（1200ms）+ SSE 事件立即补拉。
  useEffect(() => {
    void pull()
    const timer = window.setInterval(() => { void pull() }, 1200)
    const onChanged = (): void => { void pull() }
    window.addEventListener('agentlex:moot-changed', onChanged)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('agentlex:moot-changed', onChanged)
    }
  }, [pull])

  // 新增记录时把发言流底部滚入视野。
  useEffect(() => {
    const grew = entries.length > lastCount.current
    lastCount.current = entries.length
    if (!grew) return
    streamRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [entries.length])

  const phases = useMemo(() => {
    const out: Array<{ id: string; title: string }> = []
    for (const entry of entries) {
      if (!out.some((phase) => phase.id === entry.phase)) out.push({ id: entry.phase, title: entry.phaseTitle })
    }
    return out
  }, [entries])
  const currentPhaseIndex = phases.findIndex((phase) => phase.id === current.phase)

  const control = async (action: MootControlAction): Promise<void> => {
    if (action === 'abort' && !window.confirm(tt('live.abortConfirm'))) return
    setBusy(true)
    try {
      setCurrent(await api.controlSession(sessionId, action))
      await pull()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const submit = async (): Promise<void> => {
    const text = draft.trim()
    if (text === '') return
    setSubmitting(true)
    setSubmitError(null)
    try {
      await api.intervene(sessionId, text)
      setDraft('')
      await pull()
    } catch (err) {
      setSubmitError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  const status = current.status
  const canStart = status === 'draft' || status === 'ready'
  const canPause = status === 'running'
  const canResume = status === 'paused'
  const canAbort = status === 'running' || status === 'paused' || status === 'waiting' || status === 'adjudicating'
  const canFastForward = status === 'running'
  const canReport = status === 'done'
  const awaiting = current.mode === 'rehearsal' && status === 'waiting'

  return (
    <div className={css.live}>
      {error !== null ? <div className={css.errorBox}>{tt('live.controlFailed', { error })}</div> : null}

      <div className={css.phaseBar}>
        <span className={css.hint}>{tt('live.phase')}</span>
        {phases.length === 0 ? <span className={css.hint}>{tt('live.noEntries')}</span> : null}
        {phases.map((phase, index) => (
          <span
            key={phase.id}
            className={`${css.phaseItem} ${index === currentPhaseIndex ? css.phaseActive : index < currentPhaseIndex ? css.phaseItemDone : ''}`}
          >
            {phase.title}
          </span>
        ))}
        <span className={`${css.badge} ${statusTone(status)}`}>{STATUS_LABEL[status]}</span>
        <span className={css.badge}>{MODE_LABEL[current.mode]}</span>
        <span className={css.badge}>{tt('live.round', { n: current.round })}</span>
        <span className={css.badge}>{PROCEDURE_LABEL[current.procedure]}</span>
      </div>

      <div className={css.stream} ref={streamRef}>
        {entries.length === 0 ? <div className={css.loading}>{tt('live.noEntries')}</div> : null}
        {entries.map((entry) => (
          <article key={entry.seq} className={`${css.entryItem} ${actorClass(entry.actor)}`}>
            <div className={css.entryHead}>
              <span className={css.roleLabel}>
                {entry.roleLabel !== '' ? entry.roleLabel : actorLabel(entry.actor)}
              </span>
              <span className={css.entryPhase}>{entry.phaseTitle}</span>
            </div>
            <p className={css.entryText}>{entry.text !== '' ? entry.text : tt('live.emptyText')}</p>
            <Citations items={entry.citations ?? []} />
          </article>
        ))}
      </div>

      <div className={css.controlBar}>
        <button type="button" className={`${css.btn} ${css.btnPrimary}`} disabled={busy || !canStart} onClick={() => { void control('start') }}>
          {tt('live.start')}
        </button>
        <button type="button" className={css.btn} disabled={busy || !canPause} onClick={() => { void control('pause') }}>
          {tt('live.pause')}
        </button>
        <button type="button" className={css.btn} disabled={busy || !canResume} onClick={() => { void control('resume') }}>
          {tt('live.resume')}
        </button>
        <button type="button" className={`${css.btn} ${css.btnDanger}`} disabled={busy || !canAbort} onClick={() => { void control('abort') }}>
          {tt('live.abort')}
        </button>
        <button type="button" className={css.btn} disabled={busy || !canFastForward} onClick={() => { void control('fastforward') }}>
          {tt('live.fastforward')}
        </button>
        <span className={css.controlSpacer} />
        <button type="button" className={css.btn} disabled={!canReport} onClick={onOpenReport}>
          {tt('live.viewReport')}
        </button>
      </div>

      <div className={css.metaLine}>
        <span>{tt('live.tokensUsed', { used: current.stats.tokensUsed, budget: current.config.tokenBudget })}</span>
        <span>{current.config.retrievalEnabled ? tt('live.retrievalOn') : tt('report.retrievalOff')}</span>
        {current.stats.retrievalDegraded !== undefined && current.stats.retrievalDegraded !== '' ? (
          <span>{tt('live.retrievalDegraded', { reason: current.stats.retrievalDegraded })}</span>
        ) : null}
        <span>⚠ {MOOT_DISCLAIMER}</span>
      </div>

      {awaiting ? (
        <div className={css.intervene}>
          <p className={css.interveneHint}>{tt('live.rehearsalHint')}</p>
          <textarea
            className={css.textarea}
            value={draft}
            placeholder={tt('live.intervenePlaceholder')}
            onChange={(event) => setDraft(event.target.value)}
          />
          {submitError !== null ? <div className={css.errorBox}>{tt('live.submitFailed', { error: submitError })}</div> : null}
          <div className={css.btnRow}>
            <button
              type="button"
              className={`${css.btn} ${css.btnPrimary}`}
              disabled={submitting || draft.trim() === ''}
              onClick={() => { void submit() }}
            >
              {submitting ? tt('live.submitting') : tt('live.submit')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/* ─────────────────────────────── 报告视图 ─────────────────────────────── */

interface ReportViewProps {
  session: TrialSession
}

function ReportView({ session }: ReportViewProps) {
  const [report, setReport] = useState<MootReport | null>(null)
  const [judgment, setJudgment] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [writing, setWriting] = useState(false)
  const [writeError, setWriteError] = useState<string | null>(null)
  const [writeResult, setWriteResult] = useState<WritebackResult | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const [nextReport, nextJudgment] = await Promise.all([
        api.getReport(session.id),
        api.getJudgment(session.id).catch(() => ''),
      ])
      setReport(nextReport)
      setJudgment(nextJudgment)
      setError(null)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [session.id])

  useEffect(() => { void load() }, [load])

  const attacks = useMemo(
    () => [...(report?.attackVectors ?? [])].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]),
    [report],
  )
  const suggestions = useMemo(
    () => [...(report?.suggestions ?? [])].sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]),
    [report],
  )

  const doWriteback = async (): Promise<void> => {
    setWriting(true)
    setWriteError(null)
    try {
      setWriteResult(await api.writeback(session.id))
    } catch (err) {
      setWriteError(errorMessage(err))
    } finally {
      setWriting(false)
    }
  }

  if (loading && report === null) {
    return <div className={css.loading}>{tt('report.loading')}</div>
  }

  if (report === null) {
    return (
      <div>
        {error !== null ? <div className={css.errorBox}>{tt('report.loadFailed', { error })}</div> : null}
        {error === null ? <div className={css.warnBox}>{tt('report.notFound')}</div> : null}
        <button type="button" className={`${css.btn} ${css.btnSm}`} onClick={() => { void load() }}>
          {tt('report.refresh')}
        </button>
      </div>
    )
  }

  return (
    <div className={css.report}>
      {error !== null ? <div className={css.errorBox}>{tt('report.loadFailed', { error })}</div> : null}

      {/* 倾向性结论 */}
      <section className={css.card}>
        <h3 className={css.cardTitle}>{tt('report.verdict')}</h3>
        <div className={css.verdict}>
          <div className={css.stat}>
            <span className={css.statValue}>{leaningText(report.verdict.leaning)}</span>
            <span className={css.statLabel}>{tt('report.leaning')}</span>
          </div>
          <div className={css.stat}>
            <span className={css.statValue}>{report.verdict.usWinRate}</span>
            <span className={css.statLabel}>{tt('report.usWinRate')}</span>
          </div>
          <div className={css.stat}>
            <span className={css.statValue}>{confidenceText(report.verdict.confidence)}</span>
            <span className={css.statLabel}>{tt('report.confidence')}</span>
          </div>
          <p className={css.verdictSummary}>{report.verdict.summary}</p>
        </div>
        <div className={css.metaLine}>
          <span>{PROCEDURE_LABEL[report.procedure]} · {MODE_LABEL[report.mode]}</span>
          <span>{tt('report.generatedAt', { time: formatTime(report.generatedAt) })}</span>
          <span>
            {tt('report.retrieval')}：
            {report.retrieval.enabled ? tt('report.retrievalOn', { n: report.retrieval.citations }) : tt('report.retrievalOff')}
          </span>
          <span>
            {tt('report.budget')}：{report.budget.tokensUsed}
            {report.budget.truncated ? tt('report.budgetTruncated') : ''}
          </span>
        </div>
        {report.retrieval.degraded !== undefined && report.retrieval.degraded !== '' ? (
          <p className={css.warnBox}>{tt('report.retrievalDegraded', { reason: report.retrieval.degraded })}</p>
        ) : null}
      </section>

      {/* 争点 */}
      <section className={css.card}>
        <h3 className={css.cardTitle}>{tt('report.issues')}（{report.issues.length}）</h3>
        {report.issues.length === 0 ? <p className={css.hint}>{tt('report.noIssues')}</p> : null}
        {report.issues.map((issue) => <IssueCard key={issue.id} issue={issue} />)}
      </section>

      {/* 攻击线路 */}
      <section className={css.card}>
        <h3 className={css.cardTitle}>{tt('report.attacks')}</h3>
        {attacks.length === 0 ? <p className={css.hint}>{tt('report.noAttacks')}</p> : null}
        {attacks.map((attack, index) => (
          <div key={`attack-${index}`} className={css.attackItem}>
            <div className={css.attackHead}>
              <span className={`${css.badge} ${severityClass(attack.severity)}`}>{severityText(attack.severity)}</span>
              <span className={`${css.badge} ${attack.source === 'opponent' ? css.sourceOpponent : css.sourceJudge}`}>
                {attack.source === 'opponent' ? tt('report.attackFromOpponent') : tt('report.attackFromJudge')}
              </span>
            </div>
            <div>{attack.point}</div>
            <Citations items={attack.anchors ?? []} />
          </div>
        ))}
      </section>

      {/* 证据与文书缺口 */}
      <section className={css.card}>
        <h3 className={css.cardTitle}>{tt('report.gaps')}</h3>
        {report.gaps.length === 0 ? <p className={css.hint}>{tt('report.noGaps')}</p> : null}
        {report.gaps.map((gap, index) => (
          <div key={`gap-${index}`} className={css.gapItem}>
            {gap.issue !== undefined && gap.issue !== '' ? <span className={css.badge}>{gap.issue}</span> : null}
            <div className={css.gapMissing}>{gap.missing}</div>
            <p className={css.gapReason}>{tt('report.gapReason')}：{gap.reason}</p>
          </div>
        ))}
      </section>

      {/* 改进建议 */}
      <section className={css.card}>
        <h3 className={css.cardTitle}>{tt('report.suggestions')}</h3>
        {suggestions.length === 0 ? <p className={css.hint}>{tt('report.noSuggestions')}</p> : null}
        {suggestions.map((suggestion, index) => (
          <div key={`suggestion-${index}`} className={css.suggestionItem}>
            <div className={css.attackHead}>
              <span className={`${css.badge} ${priorityClass(suggestion.priority)}`}>{priorityText(suggestion.priority)}</span>
              <span className={css.badge}>{kindText(suggestion.kind)}</span>
              <strong>{suggestion.title}</strong>
            </div>
            <div>{suggestion.detail}</div>
          </div>
        ))}
      </section>

      {/* 程序性提示 */}
      {report.proceduralNotes.length > 0 ? (
        <section className={css.card}>
          <h3 className={css.cardTitle}>{tt('report.proceduralNotes')}</h3>
          <ul className={css.plainList}>
            {report.proceduralNotes.map((note, index) => <li key={`note-${index}`}>{note}</li>)}
          </ul>
        </section>
      ) : null}

      {/* 模拟边界 */}
      {report.boundaries.length > 0 ? (
        <section className={css.card}>
          <h3 className={css.cardTitle}>{tt('report.boundaries')}</h3>
          <ul className={css.plainList}>
            {report.boundaries.map((boundary, index) => <li key={`boundary-${index}`}>{boundary}</li>)}
          </ul>
        </section>
      ) : null}

      {/* 判决书（原样前置换行展示，不引入 markdown 渲染库） */}
      <section className={css.card}>
        <h3 className={css.cardTitle}>{tt('report.judgment')}</h3>
        {judgment.trim() === ''
          ? <p className={css.hint}>{tt('report.judgmentEmpty')}</p>
          : <pre className={css.judgment}>{judgment}</pre>}
      </section>

      {/* 免责声明 */}
      <section className={css.card}>
        <h3 className={css.cardTitle}>{tt('panel.disclaimerLabel')}</h3>
        <p className={css.warnBox}>{MOOT_DISCLAIMER}</p>
        {report.disclaimers.length > 0 ? (
          <ul className={css.plainList}>
            {report.disclaimers.map((item, index) => <li key={`disclaimer-${index}`}>{item}</li>)}
          </ul>
        ) : null}
      </section>

      {/* 回写为案件任务 */}
      <section className={css.card}>
        <div className={css.writeback}>
          <button
            type="button"
            className={`${css.btn} ${css.btnPrimary}`}
            disabled={writing}
            onClick={() => { void doWriteback() }}
          >
            {writing ? tt('report.writebacking') : tt('report.writeback')}
          </button>
          <span className={css.writebackHint}>{tt('report.writebackHint')}</span>
        </div>
        {writeError !== null ? <div className={css.errorBox}>{tt('report.writebackFailed', { error: writeError })}</div> : null}
        {writeResult !== null ? (
          <div>
            <p className={css.okBox}>{tt('report.writebackDone', { n: writeResult.created })} {writeResult.note}</p>
            {writeResult.tasks.length > 0 ? (
              <div>
                <strong>{tt('report.tasks')}</strong>
                <ul className={css.taskList}>
                  {writeResult.tasks.map((task, index) => <li key={`task-${index}`}>{task.title}</li>)}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  )
}

/* ─────────────────────────────── 争点卡片 ─────────────────────────────── */

function IssueCard({ issue }: { issue: Issue }) {
  return (
    <div className={css.issueCard}>
      <div className={css.issueHead}>
        <span className={css.issueTitle}>{issue.title}</span>
        {issue.score !== undefined ? (
          <>
            <span className={`${css.badge} ${css.badgeAccent}`}>
              {tt('report.score')} {issue.score.usWinRate}
            </span>
            <span className={css.badge}>{confidenceText(issue.score.confidence)}</span>
          </>
        ) : null}
      </div>

      <div className={css.proCon}>
        <div className={css.sideBox}>
          <p className={`${css.sideTitle} ${css.sideUs}`}>{tt('report.ourClaims')}</p>
          <ul className={css.bullets}>
            {issue.proCon.us.map((line, index) => <li key={`us-${index}`}>{line}</li>)}
          </ul>
        </div>
        <div className={css.sideBox}>
          <p className={`${css.sideTitle} ${css.sideThem}`}>{tt('report.theirClaims')}</p>
          <ul className={css.bullets}>
            {issue.proCon.them.map((line, index) => <li key={`them-${index}`}>{line}</li>)}
          </ul>
        </div>
      </div>

      {issue.score !== undefined && issue.score.weakPoints.length > 0 ? (
        <div className={css.weakList}>
          <strong>{tt('report.weakPoints')}</strong>
          <ul className={css.bullets}>
            {issue.score.weakPoints.map((point, index) => <li key={`weak-${index}`}>{point}</li>)}
          </ul>
        </div>
      ) : null}

      {issue.evidenceRefs.length > 0 ? (
        <p className={css.hint}>{tt('report.evidenceRefs')}：{issue.evidenceRefs.join('、')}</p>
      ) : null}

      <IssueAnchors anchors={issue.anchors} />
    </div>
  )
}

function IssueAnchors({ anchors }: { anchors: Issue['anchors'] }) {
  const hasArticles = anchors.articles.length > 0
  const hasCases = anchors.cases.length > 0
  if (!hasArticles && !hasCases) return null
  return (
    <div className={css.anchorGroup}>
      <strong className={css.anchorTitle}>{tt('report.anchors')}</strong>
      {hasArticles ? (
        <span className={`${css.badge} ${css.badgeInfo}`}>{tt('report.articles')} {anchors.articles.length}</span>
      ) : null}
      {hasCases ? (
        <span className={`${css.badge} ${css.badgeInfo}`}>{tt('report.cases')} {anchors.cases.length}</span>
      ) : null}
      <Citations items={[...anchors.articles, ...anchors.cases]} />
    </div>
  )
}
