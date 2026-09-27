/**
 * dsh-legal-suite/moot-court — 浏览器端 API 客户端。
 *
 * 与 host 的 /api/agentlex-moot/* 路由一一对应：GET 查询、POST 写入，全部同源
 * JSON 包络 { success, data | error, hint? }（见 store/types.ts 的 ApiResponse）。
 * 失败时抛 Error（带 host 的 error/hint），由 React 调用方渲染。
 *
 * 另暴露 subscribeMootEvents()：订阅 /events-stream SSE，把 host 的
 * `agentlex:registry-changed` 广播转成页面 CustomEvent `agentlex:moot-changed`，
 * 供面板与列表联动刷新。
 */
import type {
  ArbitrationRules, Dossier, DossierEvidence, Issue, Mode, MootReport, MootRunConfig,
  Procedure, TranscriptEntry, TrialSession, Tribunal,
} from '../store/types.ts'

/** 服务端响应包络。 */
interface Envelope<T> {
  success: boolean
  data?: T
  error?: string
  hint?: string
}

const BASE = '/api/agentlex-moot'

/** 发起一次请求并拆包；非 2xx 或 success=false 一律抛 Error。 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE}/${path}`, init)
  } catch (error) {
    throw new Error(`host unreachable: ${error instanceof Error ? error.message : String(error)}`)
  }
  let envelope: Envelope<T>
  try {
    envelope = await response.json() as Envelope<T>
  } catch {
    throw new Error(`host returned non-JSON (${response.status})`)
  }
  if (!envelope.success) {
    const err = new Error(envelope.error ?? `request failed (${response.status})`)
    ;(err as Error & { hint?: string }).hint = envelope.hint
    throw err
  }
  return envelope.data as T
}

/** GET，参数自动拼 query。 */
function get<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  let suffix = ''
  if (params !== undefined) {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) search.set(key, String(value))
    const encoded = search.toString()
    if (encoded !== '') suffix = `?${encoded}`
  }
  return request<T>(`${path}${suffix}`)
}

/** POST JSON。 */
function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  })
}

/* ─────────────────────────────── 视图类型 ─────────────────────────────── */

/** 会话控制动作。 */
export type MootControlAction = 'start' | 'pause' | 'resume' | 'abort' | 'fastforward'

/** 案件候选（向导步骤 1）。 */
export interface MootCaseOption {
  caseId: string
  name: string
  cause?: string
  level?: string
  status?: string
  court?: string
  ourSide?: string
  ourRole?: string
  theirRole?: string
  folder?: string
  hasCaseInfo: boolean
}

/** 模型候选（向导步骤 4）。 */
export interface MootModelOption {
  id: string
  name: string
}

export interface MootProviderGroup {
  id: string
  name: string
  models: MootModelOption[]
}

export interface MootModelsResult {
  providers: MootProviderGroup[]
  default: string
}

/** 材料校验缺口。 */
export interface PrepareMissing {
  key: string
  label: string
  code: string
  blocking: boolean
}

/** 材料校验结果（向导步骤 3）。 */
export interface PrepareResult {
  ready: boolean
  missing: PrepareMissing[]
  warnings: string[]
}

/** 建会话入参。 */
export interface CreateSessionInput {
  caseId?: string
  title?: string
  procedure: Procedure
  mode: Mode
  tribunal: Tribunal
  arbitrationRules?: ArbitrationRules
  config: MootRunConfig
  dossier: Dossier
}

/** 快照构建的可选覆盖项（用户编辑后的值回传）。 */
export interface DossierOverrides {
  claims?: string[]
  facts?: string
  brief?: string
  evidence?: DossierEvidence[]
  priorJudgment?: string
  appealGrounds?: string[]
  materials?: Array<{ name: string; note?: string }>
}

/** 回写案件任务的结果。 */
export interface WritebackResult {
  created: number
  tasks: Array<{ title: string }>
  note: string
}

/* ──────────────────────────────── 接口 ──────────────────────────────── */

/** 插件健康检查。 */
export function health(): Promise<{ ok: boolean; plugin: string; status: string }> {
  return get('health')
}

/** 全部模拟会话。 */
export function listSessions(): Promise<TrialSession[]> {
  return get('sessions')
}

/** 单个会话。 */
export function getSession(id: string): Promise<TrialSession> {
  return get('session', { id })
}

/** 增量庭审记录（since 之后的条目）。 */
export function getTranscript(id: string, since = 0): Promise<TranscriptEntry[]> {
  return get('session/transcript', { id, since })
}

/** 争点列表。 */
export function getIssues(id: string): Promise<Issue[]> {
  return get('session/issues', { id })
}

/** 报告（未生成时为 null）。 */
export function getReport(id: string): Promise<MootReport | null> {
  return get('session/report', { id })
}

/** 判决书 markdown 全文。 */
export async function getJudgment(id: string): Promise<string> {
  const data = await get<{ markdown: string }>('session/judgment', { id })
  return data.markdown ?? ''
}

/** 新建模拟会话。 */
export function createSession(input: CreateSessionInput): Promise<TrialSession> {
  return post('session/create', { ...input })
}

/** 删除会话。 */
export function deleteSession(id: string): Promise<{ deleted: boolean }> {
  return post('session/delete', { id })
}

/** 会话控制（开始/暂停/继续/中止/快进）。 */
export function controlSession(id: string, action: MootControlAction): Promise<TrialSession> {
  return post('session/control', { id, action })
}

/** 单方预演：提交我方发言。 */
export function intervene(id: string, text: string): Promise<{ accepted: boolean }> {
  return post('session/intervene', { id, text })
}

/** 报告回写为案件任务。 */
export function writeback(id: string): Promise<WritebackResult> {
  return post('session/writeback', { id })
}

/** 材料就绪校验。 */
export function prepare(procedure: Procedure, dossier: Dossier): Promise<PrepareResult> {
  return post('session/prepare', { procedure, dossier })
}

/** 可用 provider / model 列表。 */
export function listModels(): Promise<MootModelsResult> {
  return get('models')
}

/** 可选的案件清单。 */
export function listCases(): Promise<{ cases: MootCaseOption[] }> {
  return get('cases')
}

/** 从案件生成一次性快照（可带用户覆盖项）。 */
export function buildDossier(
  caseId: string,
  procedure: Procedure,
  overrides?: DossierOverrides,
): Promise<Dossier> {
  return post('dossier', overrides === undefined ? { caseId, procedure } : { caseId, procedure, overrides })
}

/**
 * 订阅模拟法庭变更推送；返回取消订阅函数。
 * host 在会话/记录写入后经 SSE 推 `agentlex:registry-changed`，这里统一转成页面
 * 事件 `agentlex:moot-changed`（列表、直播视图、报告视图都监听它）。
 */
export function subscribeMootEvents(): () => void {
  if (typeof window === 'undefined') return () => {}
  let source: EventSource | null = null
  try {
    source = new EventSource(`${BASE}/events-stream`)
    source.onmessage = (): void => {
      window.dispatchEvent(new CustomEvent('agentlex:moot-changed'))
    }
    source.onerror = (): void => {
      // 浏览器自动重连；面板另有轮询兜底，这里不打扰用户。
    }
  } catch (error) {
    console.warn('[agentlex-moot-court] EventSource unavailable:', error)
  }
  return () => { source?.close() }
}
