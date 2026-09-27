/**
 * dsh-legal-suite/moot-court — 检索锚定（法条 + 类案）。
 *
 * 方案 §7：判决不能裸判。引擎在两个时点强制锚定：
 *   1. 对方代理人首轮答辩/质证前 —— 检索支持反方的类案，喂给攻击性人格；
 *   2. 裁判者归纳争点与判决前 —— 逐争点检索现行有效法条与类案，形成 citation pool，
 *      判决书只允许引用 pool 内的条目。
 *
 * 三条硬要求：
 *   • **PII 剥离**：出网的只有案由与争点关键词；当事人姓名一律替换为甲/乙/申请人/被申请人。
 *   • **降级不阻塞**：工具缺席、账号欠费、网络失败都只记录原因，庭审继续，判决/报告标注「未锚定」。
 *   • **多形态解析**：元典返回结构可能随版本变化，解析器按「找到第一个像结果集的数组」的
 *     保守策略工作，字段用同义词表兜底。
 *
 * 工具发现走前缀 + 关键词匹配（`mcp__yuandian-law__*` / `mcp__yuandian-case__*`），
 * 不硬编码完整工具名，避免对方改版本号后整个功能失效。
 */
import type { Context } from '@deepseek-ai/cordis'
import { callTool, listToolNames, toolSchemaOf } from './tool-call.ts'
import type { Citation, Dossier, Issue } from '../store/types.ts'

/** 一次锚定的结果。 */
export interface AnchorResult {
  citations: Citation[]
  /** 失败/降级原因（成功时 undefined）。 */
  degraded?: string
}

/** 检索请求上下文。 */
export interface AnchorQuery {
  /** 案由（用于案由过滤）。 */
  cause?: string
  /** 检索关键词（已 PII 剥离）。 */
  keywords: string[]
  /** 地域（省），可选。 */
  province?: string
  /** 当事人姓名列表（用于 PII 剥离）。 */
  partyNames?: string[]
  signal: AbortSignal
}

/** 结果上限（控制 token 与费用）。 */
const LAW_LIMIT = 6
const CASE_LIMIT = 5
/** 单条引用摘要最大长度（避免污染上下文）。 */
const SUMMARY_MAX = 260

/* ─────────────────────────── PII 剥离 ─────────────────────────── */

/** 姓名占位符（按顺序分配）。 */
const PII_PLACEHOLDERS = ['甲', '乙', '丙', '丁', '戊', '己']

/**
 * 把当事人姓名替换为占位符。只用于**出网检索**的关键词与案由，
 * 不改变落盘的 dossier/transcript。
 * @param text - 原始文本（案由/争点）。
 * @param partyNames - 当事人姓名（长名优先替换，避免子串误伤）。
 */
export function stripPii(text: string, partyNames: string[] = []): string {
  let out = text
  const names = [...partyNames]
    .map((n) => n.trim())
    .filter((n) => n.length >= 2)
    .sort((a, b) => b.length - a.length)
  let index = 0
  for (const name of names) {
    if (!out.includes(name)) continue
    const placeholder = PII_PLACEHOLDERS[index % PII_PLACEHOLDERS.length]!
    out = out.split(name).join(placeholder)
    index += 1
  }
  return out
}

/** 从 dossier 收集当事人姓名。 */
export function partyNamesOf(dossier: Dossier): string[] {
  return dossier.parties.map((p) => p.name).filter((n) => n.trim() !== '')
}

/**
 * 构造出网检索文本：优先用案由，其次用争点标题；不拼入事实全文。
 * @param dossier - 案件快照。
 * @param extra - 附加上下文（通常是争点标题）。
 */
export function buildQueryText(dossier: Dossier, extra: string[] = []): string[] {
  const names = partyNamesOf(dossier)
  const base = [dossier.cause ?? '', ...extra]
    .map((s) => stripPii(s, names).trim())
    .filter((s) => s !== '')
  return [...new Set(base)].slice(0, 4)
}

/* ─────────────────────────── 工具发现 ─────────────────────────── */

/**
 * 工具名匹配评分：**不依赖具体工具名**（不同部署/版本的元典 MCP 工具名不同，
 * 例如 `yuandian_semantic_search_legal_articles` 与
 * `yuandian_law_vector_search__v2` 并存），只按语义关键词排序。
 * @returns 分数越小越优先；undefined 表示不是检索工具。
 */
function searchScore(name: string, domain: 'law' | 'case'): number | undefined {
  const lower = name.toLowerCase()
  // 明细/余额类工具不是检索入口。
  if (/get_(user_)?balance|detail|_info$|^.*__yuandian_get_/.test(lower) && !/search/.test(lower)) return undefined
  if (!/search/.test(lower)) return undefined
  if (/semantic|vector/.test(lower)) return 0
  if (domain === 'law' && /legal_articles?|laws_and_regulations|ft_search|law_vector/.test(lower)) return 1
  if (domain === 'case' && /judicial_cases?|authoritative_cases?|qwal|ptal|case_vector/.test(lower)) return 1
  return 2
}

/** 找到法条检索工具（按优先级）。 */
export function findLawTools(ctx: Context): string[] {
  return listToolNames(ctx, 'mcp__yuandian-law__')
    .map((name) => ({ name, score: searchScore(name, 'law') }))
    .filter((x): x is { name: string; score: number } => x.score !== undefined)
    .sort((a, b) => a.score - b.score)
    .map((x) => x.name)
}

/** 找到类案检索工具（按优先级）。 */
export function findCaseTools(ctx: Context): string[] {
  return listToolNames(ctx, 'mcp__yuandian-case__')
    .map((name) => ({ name, score: searchScore(name, 'case') }))
    .filter((x): x is { name: string; score: number } => x.score !== undefined)
    .sort((a, b) => a.score - b.score)
    .map((x) => x.name)
}

/* ─────────────────── 按真实 schema 构造参数 ─────────────────── */

/** 参数名字段族（用于把我们的检索意图映射到工具的真实字段名）。 */
const QUERY_KEYS = /^(query|q|keyword|keywords|text|search_?text|semantic_?query|qw|input|prompt|question)$/i
const LIMIT_KEYS = /^(limit|top_?k|return_?num|size|count|num|page_?size|max_?results)$/i
const CAUSE_KEYS = /(cause_?of_?action|^cause$|^ay$|案由)/i
const PROVINCE_KEYS = /(province|xzqh|region|地域|省份)/i
const VALIDITY_KEYS = /(validity_?status|^sxx$|时效)/i

/** 检索意图。 */
interface SearchIntent {
  /** 主要检索文本。 */
  query: string
  /** 关键词数组（语义检索工具用）。 */
  keywords: string[]
  topK: number
  cause?: string
  province?: string
  /** 立场：'them' 时偏向检索支持对方的裁判。 */
  side: 'them' | 'neutral'
}

/** 取 schema 的属性表（兼容 JSON Schema 与裸属性表两种形态）。 */
function propertiesOf(schema: Record<string, unknown> | undefined): Record<string, unknown> {
  if (schema === undefined) return {}
  const props = schema['properties']
  if (props !== null && typeof props === 'object') return props as Record<string, unknown>
  return schema
}

/** 该属性声明是否数组类型。 */
function isArrayProp(spec: unknown): boolean {
  return spec !== null && typeof spec === 'object' && (spec as { type?: unknown }).type === 'array'
}

/**
 * 按工具真实 schema 构造参数。
 *
 * 这是本模块的关键容错点：元典 MCP 在不同部署下暴露的工具名与字段名并不一致
 * （`query` / `keywords` / `semantic_query`，`limit` / `top_k` / `return_num`，
 * 过滤条件散在 `law_article_filter` / `case_document_filter` 等嵌套对象里）。
 * 这里递归匹配字段名族，只填工具确实声明的字段，**绝不发送未声明的字段**
 * （严格校验的服务端会因为多余字段直接报错）。
 */
export function buildArgsFromSchema(
  schema: Record<string, unknown> | undefined,
  intent: SearchIntent,
  depth = 0,
): Record<string, unknown> {
  const props = propertiesOf(schema)
  const out: Record<string, unknown> = {}
  for (const [key, spec] of Object.entries(props)) {
    if (key === 'required' || key === 'type' || key === 'description' || key === 'additionalProperties') continue
    // 嵌套过滤对象：递归填它的属性。
    if (spec !== null && typeof spec === 'object' && (spec as { type?: unknown }).type === 'object' && depth < 2) {
      const nested = buildArgsFromSchema(spec as Record<string, unknown>, intent, depth + 1)
      if (Object.keys(nested).length > 0) out[key] = nested
      continue
    }
    if (QUERY_KEYS.test(key)) {
      const text = intent.side === 'them' ? `${intent.query} 抗辩成立 驳回请求` : intent.query
      out[key] = isArrayProp(spec) ? (intent.keywords.length > 0 ? intent.keywords : [text]) : text
      continue
    }
    if (LIMIT_KEYS.test(key)) {
      out[key] = intent.topK
      continue
    }
    if (CAUSE_KEYS.test(key) && intent.cause !== undefined && intent.cause !== '') {
      out[key] = isArrayProp(spec) ? [intent.cause] : intent.cause
      continue
    }
    if (PROVINCE_KEYS.test(key) && intent.province !== undefined && intent.province !== '') {
      out[key] = isArrayProp(spec) ? [intent.province] : intent.province
      continue
    }
    if (VALIDITY_KEYS.test(key)) {
      out[key] = isArrayProp(spec) ? ['现行有效'] : '现行有效'
      continue
    }
  }
  // 兜底：schema 完全没声明可识别字段时，按最常见的两个字段名提交。
  if (Object.keys(out).length === 0) {
    return { query: intent.query, limit: intent.topK }
  }
  return out
}

/* ─────────────────────────── 结果解析 ─────────────────────────── */

/** 把工具返回值展开成文本（MCP 结果形态多样，逐层兜底）。 */
function valueToText(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    // MCP CallToolResult：{ content: [{type:'text', text}] }
    if (Array.isArray(obj['content'])) {
      const joined = (obj['content'] as Array<Record<string, unknown>>)
        .map((c) => (typeof c?.['text'] === 'string' ? c['text'] : ''))
        .filter((t) => t !== '')
        .join('\n')
      if (joined !== '') return joined
    }
    if (obj['structuredContent'] !== undefined) return JSON.stringify(obj['structuredContent'])
    if (obj['results'] !== undefined) return JSON.stringify(obj)
    return JSON.stringify(obj)
  }
  return String(value)
}

/** 解析文本为 JSON（容忍 markdown 代码围栏与前后说明文字）。 */
function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  try {
    return JSON.parse(trimmed)
  } catch {
    // 去掉 ```json 围栏。
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)
    if (fenced?.[1] !== undefined) {
      try {
        return JSON.parse(fenced[1].trim())
      } catch {
        // 继续尝试首个 JSON 片段。
      }
    }
    const start = trimmed.search(/[[{]/)
    if (start >= 0) {
      const candidate = trimmed.slice(start)
      try {
        return JSON.parse(candidate)
      } catch {
        // 无法解析：交给调用方降级。
      }
    }
    return undefined
  }
}

/** 递归找到第一个「看起来是结果集」的数组。 */
function findResultArray(node: unknown, depth = 0): Array<Record<string, unknown>> {
  if (depth > 6 || node === null || typeof node !== 'object') return []
  if (Array.isArray(node)) {
    const objects = node.filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x))
    if (objects.length > 0) return objects
    for (const child of node) {
      const found = findResultArray(child, depth + 1)
      if (found.length > 0) return found
    }
    return []
  }
  const obj = node as Record<string, unknown>
  // 优先看常见的集合键。
  const preferred = ['law_article_list', 'results', 'cases', 'list', 'items', 'data', 'records', 'content']
  for (const key of preferred) {
    const child = obj[key]
    if (child === undefined) continue
    const found = findResultArray(child, depth + 1)
    if (found.length > 0) return found
  }
  for (const child of Object.values(obj)) {
    const found = findResultArray(child, depth + 1)
    if (found.length > 0) return found
  }
  return []
}

/** 按同义词表取第一个非空字符串字段。 */
function pick(item: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = item[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
    if (typeof value === 'number') return String(value)
  }
  return ''
}

/** 截断摘要。 */
function clip(text: string, max = SUMMARY_MAX): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`
}

/**
 * 把工具返回的错误文本转成人类可读的一句话。
 *
 * 元典 MCP 的错误体是 JSON 包络（`{"success":false,"message":"余额不足…"}`），甚至
 * 多段用分号拼接——直接塞进报告/判决书会让律师看到一串噪音。这里逐个包络取出
 * message/error 字段，取不到才退回原文。
 */
export function humanizeToolError(raw: string, max = 160): string {
  const parts = raw.split(/[；;]/).map((p) => p.trim()).filter((p) => p !== '')
  const messages: string[] = []
  let sawEnvelope = false
  for (const part of parts) {
    const parsed = part.startsWith('{') || part.startsWith('[') ? parseJsonLoose(part) : undefined
    if (parsed !== null && typeof parsed === 'object') {
      sawEnvelope = true
      const obj = parsed as Record<string, unknown>
      const message = [obj['message'], obj['error'], obj['msg'], obj['reason']]
        .find((v): v is string => typeof v === 'string' && v.trim() !== '')
      // 没有人类可读字段的包络（如 `{"success":false,"data":null,"timestamp":…}`）
      // 直接丢弃——它只会给报告添噪音。
      if (message !== undefined) messages.push(message.trim())
      continue
    }
    messages.push(part)
  }
  const unique = [...new Set(messages)].join('；')
  if (unique !== '') return clip(unique, max)
  if (sawEnvelope) return '检索服务返回失败'
  return clip(raw, max)
}

/** 把一条法条结果映射为 Citation。 */
function toArticleCitation(item: Record<string, unknown>): Citation | undefined {
  const law = pick(item, ['law_name', 'regulation_name', 'fgmc', 'lawName', 'regulationName', '法规名称', '所属法规'])
  const article = pick(item, ['article_number', 'ftnum', 'article_no', 'articleNumber', '条号', '法条编号'])
  if (law === '' && article === '') return undefined
  const content = pick(item, ['content', 'ftnr', 'article_content', 'text', '内容', '法条内容'])
  const ref = [law, article].filter((s) => s !== '').join(' ')
  return {
    kind: 'article',
    ref: ref === '' ? '未命名法条' : ref,
    ...(law === '' ? {} : { title: law }),
    ...(pick(item, ['validity_status', 'sxx', '时效性']) === '' ? {} : { source: pick(item, ['validity_status', 'sxx', '时效性']) }),
    ...(content === '' ? {} : { summary: clip(content) }),
  }
}

/** 把一条类案结果映射为 Citation。 */
function toCaseCitation(item: Record<string, unknown>): Citation | undefined {
  const caseNumber = pick(item, ['case_number', 'ah', '案号', 'caseNumber'])
  const title = pick(item, ['title', 'case_name', 'name', '标题', '案件名称'])
  if (caseNumber === '' && title === '') return undefined
  const court = pick(item, ['court_name', 'jbdw', 'court', '法院', '经办法院'])
  const gist = pick(item, ['content', 'summary', '裁判要旨', 'abstract', 'gist', 'court_reasoning', '分析过程'])
  const score = Number(item['score'] ?? item['similarity'] ?? 0)
  return {
    kind: 'case',
    ref: caseNumber !== '' ? caseNumber : title,
    ...(title === '' ? {} : { title }),
    ...(court === '' ? {} : { source: court }),
    ...(gist === '' ? {} : { summary: clip(gist) }),
    ...(Number.isFinite(score) && score > 0 ? { score } : {}),
  }
}

/* ─────────────────────────── 对外接口 ─────────────────────────── */

/**
 * 检索现行有效法条。
 * @returns 锚定结果（失败时 citations 为空并带 degraded 说明）。
 */
export async function anchorLaw(ctx: Context, query: AnchorQuery): Promise<AnchorResult> {
  const tools = findLawTools(ctx)
  if (tools.length === 0) {
    return { citations: [], degraded: '未发现元典法条检索工具（mcp__yuandian-law__*），本次未做法条锚定' }
  }
  const errors: string[] = []
  for (const toolName of tools.slice(0, 2)) {
    const schema = toolSchemaOf(ctx, toolName)
    const intent: SearchIntent = {
      query: query.keywords.join(' '),
      keywords: query.keywords,
      topK: LAW_LIMIT,
      ...(query.cause === undefined ? {} : { cause: query.cause }),
      side: 'neutral',
    }
    const result = await callTool(ctx, toolName, buildArgsFromSchema(schema?.parameters, intent), query.signal)
    if (!result.ok) {
      errors.push(humanizeToolError(result.error ?? '未知错误'))
      continue
    }
    const items = findResultArray(parseJsonLoose(valueToText(result.value)))
    const citations = items
      .map(toArticleCitation)
      .filter((c): c is Citation => c !== undefined)
    if (citations.length > 0) return { citations: dedupe(citations) }
    errors.push('检索返回为空')
  }
  return { citations: [], degraded: `法条锚定失败：${errors.join('；')}` }
}

/**
 * 检索类案。
 * @param side - 'them' 时偏向检索支持对方的裁判（攻击面推演）。
 */
export async function anchorCases(ctx: Context, query: AnchorQuery, side: 'them' | 'neutral' = 'neutral'): Promise<AnchorResult> {
  const tools = findCaseTools(ctx)
  if (tools.length === 0) {
    return { citations: [], degraded: '未发现元典类案检索工具（mcp__yuandian-case__*），本次未做类案锚定' }
  }
  const errors: string[] = []
  for (const toolName of tools.slice(0, 2)) {
    const schema = toolSchemaOf(ctx, toolName)
    const intent: SearchIntent = {
      query: query.keywords.join(' '),
      keywords: query.keywords,
      topK: CASE_LIMIT,
      ...(query.cause === undefined ? {} : { cause: query.cause }),
      ...(query.province === undefined ? {} : { province: query.province }),
      side,
    }
    const result = await callTool(ctx, toolName, buildArgsFromSchema(schema?.parameters, intent), query.signal)
    if (!result.ok) {
      errors.push(humanizeToolError(result.error ?? '未知错误'))
      continue
    }
    const items = findResultArray(parseJsonLoose(valueToText(result.value)))
    const citations = items
      .map(toCaseCitation)
      .filter((c): c is Citation => c !== undefined)
    if (citations.length > 0) return { citations: dedupe(citations) }
    errors.push('检索返回为空')
  }
  return { citations: [], degraded: `类案锚定失败：${errors.join('；')}` }
}

/** 去重（同 ref 只保留一条）。 */
function dedupe(citations: Citation[]): Citation[] {
  const seen = new Set<string>()
  const out: Citation[] = []
  for (const c of citations) {
    const key = `${c.kind}:${c.ref}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(c)
  }
  return out
}

/** 争点聚合锚定的结果。 */
export interface IssueAnchors {
  /** 争点 id → 锚定引用。 */
  byIssue: Record<string, { articles: Citation[]; cases: Citation[] }>
  /** 全部引用（判决书只允许引用这里面的条目）。 */
  pool: Citation[]
  /** 降级说明（全部失败时给出；部分失败时合并列出）。 */
  degraded?: string
}

/**
 * 逐争点锚定：每个争点分别检索法条与类案，合并成 citation pool。
 * @param issues - 已归纳的争点（空数组时按案由整体检索一次）。
 */
export async function anchorIssues(
  ctx: Context,
  dossier: Dossier,
  issues: Issue[],
  options: { province?: string; signal: AbortSignal; side?: 'them' | 'neutral' },
): Promise<IssueAnchors> {
  const names = partyNamesOf(dossier)
  const byIssue: IssueAnchors['byIssue'] = {}
  const pool: Citation[] = []
  const problems: string[] = []

  const targets = issues.length > 0
    ? issues.map((issue) => ({ id: issue.id, text: issue.title }))
    : [{ id: '__general__', text: dossier.cause ?? '' }]

  for (const target of targets) {
    const keywords = [dossier.cause ?? '', target.text]
      .map((s) => stripPii(s, names).trim())
      .filter((s) => s !== '')
    const query: AnchorQuery = {
      cause: dossier.cause === undefined ? undefined : stripPii(dossier.cause, names),
      keywords: keywords.length > 0 ? keywords : ['争议焦点'],
      province: options.province,
      partyNames: names,
      signal: options.signal,
    }
    const [law, cases] = await Promise.all([
      anchorLaw(ctx, query),
      anchorCases(ctx, query, options.side ?? 'neutral'),
    ])
    if (law.degraded !== undefined) problems.push(law.degraded)
    if (cases.degraded !== undefined) problems.push(cases.degraded)
    byIssue[target.id] = { articles: law.citations, cases: cases.citations }
    pool.push(...law.citations, ...cases.citations)
    if (options.signal.aborted) break
  }

  const deduped = dedupe(pool)
  return {
    byIssue,
    pool: deduped,
    ...(deduped.length === 0 && problems.length > 0
      ? { degraded: [...new Set(problems)].join('；') }
      : {}),
  }
}

/** 把 citation pool 渲染成给模型看的引用清单文本。 */
export function renderCitationPool(pool: Citation[], max = 24): string {
  if (pool.length === 0) return '（本次未取得检索结果，引用清单为空）'
  const lines: string[] = []
  pool.slice(0, max).forEach((c, index) => {
    const tag = c.kind === 'article' ? '法条' : '类案'
    const parts = [`[${index + 1}] ${tag} ${c.ref}`]
    if (c.title !== undefined && c.title !== c.ref) parts.push(`（${c.title}）`)
    if (c.source !== undefined) parts.push(`出处：${c.source}`)
    if (c.summary !== undefined) parts.push(`摘要：${c.summary}`)
    lines.push(parts.join(' '))
  })
  return lines.join('\n')
}

/** 校验文本中出现的引用是否都能在 pool 里找到（判决引用合规性检查）。 */
export function citationsGrounded(text: string, pool: Citation[]): { ok: boolean; foreign: string[] } {
  const foreign: string[] = []
  // 抓「《法规名》第X条」与「（20XX）…号」两类引用形态。
  const lawRefs = text.match(/《[^》]{2,40}》\s*第[一二三四五六七八九十百千零〇\d]+条/g) ?? []
  const caseRefs = text.match(/[（(]\s*\d{4}\s*[)）][^，。；\s]{4,30}号/g) ?? []
  const known = pool.map((c) => `${c.ref} ${c.title ?? ''}`).join(' ')
  for (const ref of [...lawRefs, ...caseRefs]) {
    const normalized = ref.replace(/\s+/g, '')
    if (!known.replace(/\s+/g, '').includes(normalized.slice(0, Math.min(normalized.length, 12)))) {
      foreign.push(ref.trim())
    }
  }
  return { ok: foreign.length === 0, foreign }
}
