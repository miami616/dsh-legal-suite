/**
 * redact/client/api.ts — 脱敏域浏览器端接口（打宿主 /api/agentlex-redact/*）。
 *
 * 前端只做展示与操作；识别/替换/映射全部在 host 侧本地完成，这里只是取数据。
 */

export type RedactMode = 'reversible' | 'masked'

export interface KindStat { kind: string; label: string; count: number; samples: string[] }
export interface Candidate {
  display: string
  anchor: string
  count: number
  /** 候选原文：仅本机界面拿得到（agent 工具响应里无此字段）。 */
  value?: string
}
export interface RedactReport {
  mode: RedactMode
  scope: string
  totalHits: number
  byKind: KindStat[]
  candidates: Candidate[]
  newAliases: Array<{ original: string; alias: string; kind: string }>
  warnings: string[]
  restorable: boolean
}
export interface ScanResult { scope: string; lexiconCount: number; report: RedactReport }
export interface RedactResult {
  scope: string
  mode: RedactMode
  text?: string
  outPath?: string
  outPaths: string[]
  mappingPath: string
  restorable: boolean
  report: RedactReport
  notes: string[]
}
export interface RestoreResult {
  scope: string
  text?: string
  outPath?: string
  outPaths: string[]
  restored: number
  missing: Array<{ alias: string; count: number }>
  ambiguous: string[]
  notes: string[]
}
export interface RedactConfigView {
  version: string
  maskAmounts: boolean
  heuristic: boolean
  crossScope: boolean
  lastUpdated?: string
}
export interface TermEntryView { value: string; kind: string; note?: string }
export interface TermsView {
  terms: { global: TermEntryView[]; caseTerms: TermEntryView[] }
  mappingScopes: string[]
}
export interface MappingEntityView { alias: string; kind: string; source?: string; note?: string; createdAt: string }
export interface MappingDocView {
  version: string
  scope: string
  mode: RedactMode
  restorable: boolean
  entities: Record<string, MappingEntityView>
  createdAt: string
  lastUpdated?: string
}

/** 类别下拉（值 + 中文标签；custom 之外都列，方便手工指定）。 */
export const TERM_KINDS: Array<{ value: string; label: string }> = [
  { value: '', label: '自动判断' },
  { value: 'person', label: '自然人' },
  { value: 'org', label: '机构 / 公司' },
  { value: 'caseNumber', label: '案号' },
  { value: 'caseName', label: '案件名' },
  { value: 'project', label: '项目名' },
  { value: 'address', label: '地址' },
  { value: 'phone', label: '电话号码' },
  { value: 'idCard', label: '身份证号' },
  { value: 'creditCode', label: '统一社会信用代码' },
  { value: 'bankAccount', label: '银行账号' },
  { value: 'email', label: '邮箱' },
  { value: 'custom', label: '其它' },
]

const BASE = '/api/agentlex-redact'

/** 一次请求并把 {success,data} 信封拆开（失败抛错，调用方 toast）。 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}/${path}`, {
    headers: { accept: 'application/json', ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...init,
  })
  let payload: { success?: boolean; data?: T; error?: string }
  try {
    payload = await response.json() as { success?: boolean; data?: T; error?: string }
  } catch {
    throw new Error(`服务无响应（HTTP ${response.status}）：确认 dsh-legal-suite 已加载`)
  }
  if (payload.success !== true) throw new Error(payload.error ?? `HTTP ${response.status}`)
  return payload.data as T
}

const post = <T>(path: string, body: unknown): Promise<T> =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body) })

export interface RedactInput {
  text?: string
  path?: string
  scope?: string
  mode?: RedactMode
  outPath?: string
  crossScope?: boolean
  maskAmounts?: boolean
  heuristic?: boolean
  /** 界面用：让候选带上原文（agent 工具不传）。 */
  reveal?: boolean
  /** 界面用：让响应回吐脱敏文本（文件模式展示结果用）。 */
  includeText?: boolean
}

export const redactApi = {
  config: (): Promise<RedactConfigView> => request<RedactConfigView>('config'),
  saveConfig: (patch: Partial<Pick<RedactConfigView, 'maskAmounts' | 'heuristic' | 'crossScope'>>): Promise<RedactConfigView> =>
    request<RedactConfigView>('config', { method: 'PUT', body: JSON.stringify(patch) }),
  scan: (input: RedactInput): Promise<ScanResult> => post<ScanResult>('scan', input),
  redact: (input: RedactInput): Promise<RedactResult> => post<RedactResult>('redact', input),
  restore: (input: RedactInput): Promise<RestoreResult> => post<RestoreResult>('restore', input),
  terms: (scope?: string): Promise<TermsView> =>
    request<TermsView>(`terms${scope === undefined || scope === '' ? '' : `?scope=${encodeURIComponent(scope)}`}`),
  addTerms: (scope: string, terms: Array<{ value: string; kind?: string; note?: string }>): Promise<{ added: TermEntryView[] }> =>
    post<{ added: TermEntryView[] }>('terms', { scope, terms }),
  removeTerms: (scope: string, values: string[]): Promise<{ removed: number }> =>
    post<{ removed: number }>('terms', { scope, action: 'remove', values }),
  mappings: (): Promise<{ scopes: string[] }> => request<{ scopes: string[] }>('mappings'),
  mapping: (scope: string): Promise<MappingDocView> =>
    request<MappingDocView>(`mappings?scope=${encodeURIComponent(scope)}`),
  batch: (dir: string, input: Omit<RedactInput, 'text' | 'path'>): Promise<{ results: Array<{ file: string; outPaths: string[]; hits: number; error?: string }>; notes: string[] }> =>
    post<{ results: Array<{ file: string; outPaths: string[]; hits: number; error?: string }>; notes: string[] }>('batch', { ...input, dir }),
}
