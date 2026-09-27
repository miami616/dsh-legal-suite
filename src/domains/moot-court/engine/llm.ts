/**
 * dsh-legal-suite/moot-court — 模型网关。
 *
 * 庭审引擎需要直接发起模型调用（不经过 agent 会话），dsh 为此提供了 `llm`
 * 服务：`ctx.llm.stream(options)` 是 adapter 无关的流式调用入口，provider/model
 * 由调用方给出。本模块把它包成「解析路由 + 流式收集文本 + token 计数」的
 * 最小面，引擎其余部分只依赖这个面。
 *
 * 兼容策略：**不把 `llm` 放进 inject**（老版 harness 或裁剪过的部署可能没有
 * 该服务，注入不存在的服务会让整域挂起）。改在调用时经 ctx.get('llm') 惰性
 * 解析，缺席时抛出可读错误，由引擎降级为「本次庭审失败」而不是插件加载失败。
 */
import type { Context } from '@deepseek-ai/cordis'

/** 一条模型路由。 */
export interface ModelRoute {
  provider: string
  model: string
}

/** 可选路由（向导用）。 */
export interface AvailableModels {
  providers: Array<{ id: string; name: string; models: Array<{ id: string; name: string }> }>
  /** 默认路由 "provider/model"；无法解析时为空串。 */
  default: string
}

/** 一次生成请求。 */
export interface GenerateRequest {
  /** 系统提示（人格卡 + 规则）。 */
  system?: string
  /** 对话消息（引擎自建，无会话身份）。 */
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  /** 路由覆盖（缺省用引擎默认）。 */
  route?: ModelRoute
  maxTokens?: number
  temperature?: number
  signal?: AbortSignal
}

/** 一次生成结果。 */
export interface GenerateResult {
  text: string
  /** 本调用消耗的 token（input+output）；无 usage 时为 0。 */
  tokens: number
  /** 终止原因的可读文本（结构化原因会渲染成 `type: message`）。 */
  finish: string
  /** 原始终止原因（可能是字符串或结构化对象，供排障）。 */
  rawFinish?: unknown
  /** 实际使用的路由。 */
  route: ModelRoute
}

/**
 * 判断终止原因是否表示失败，并渲染成人类可读文本。
 *
 * 实测形状（2026-09-24，ollama 路由上游返回 410 模型下线）：
 *   失败：`{ kind: 'error', failure: { message: '410: …', code: 'PI_AI_ERROR' } }`
 *   成功：`{ kind: 'stop' }`
 * 也就是说 reason 是**结构化对象**（不是字符串），且失败信息在 `failure`／`error`
 * 字段下、失败标识在 `kind`／`type` 字段上。早期实现用 `finish === 'error'` 判断、
 * 只认 `type`/`error`，于是「调用失败」被当成「成功但空回复」——整场庭审静默产出
 * 空发言与空判决，会话状态却还是 done。这里把四种形态（string / kind / type /
 * error|failure）全部认下。
 * @param reason - 原始 reason。
 * @returns 失败描述；正常终止返回 undefined。
 */
export function describeFinishFailure(reason: unknown): string | undefined {
  if (typeof reason === 'string') {
    return /^(error|aborted|failed|cancelled|canceled)$/i.test(reason) ? reason : undefined
  }
  if (reason === null || typeof reason !== 'object') return undefined
  const obj = reason as Record<string, unknown>
  const flags = [obj['kind'], obj['type'], obj['status'], obj['reason']]
    .filter((v): v is string => typeof v === 'string')
  const looksFailed = flags.some((f) => /error|abort|fail|cancel|reject/i.test(f))
    || obj['failure'] !== undefined
    || obj['error'] !== undefined
  if (!looksFailed) return undefined

  const nestedRaw = obj['failure'] ?? obj['error'] ?? obj['cause']
  const nested = nestedRaw !== null && typeof nestedRaw === 'object'
    ? nestedRaw as Record<string, unknown>
    : undefined
  const message = [
    nested?.['message'],
    typeof nestedRaw === 'string' ? nestedRaw : undefined,
    obj['message'],
    nested?.['code'],
    obj['code'],
    ...flags,
  ].find((v): v is string => typeof v === 'string' && v.trim() !== '')
  return message ?? JSON.stringify(reason).slice(0, 300)
}

/** 终止原因 → 可读文本（成功时给出 kind/type，如 'stop'）。 */
function describeFinish(reason: unknown): string {
  if (typeof reason === 'string') return reason
  if (reason === null || reason === undefined) return 'unknown'
  const failure = describeFinishFailure(reason)
  if (failure !== undefined) return failure
  const obj = reason as Record<string, unknown>
  const label = [obj['kind'], obj['type']].find((v): v is string => typeof v === 'string' && v !== '')
  return label ?? JSON.stringify(reason).slice(0, 120)
}

/** 模型网关。 */
export interface LlmGateway {
  /** 探测服务是否可用（不可用时引擎给出明确提示）。 */
  available(): boolean
  /** 列出可选路由（向导 + 默认解析）。 */
  listAvailable(): Promise<AvailableModels>
  /** 解析 "provider/model" 或自动选择部署默认路由。 */
  resolve(preference?: string): Promise<ModelRoute>
  /** 流式生成并收集全文。 */
  generate(request: GenerateRequest): Promise<GenerateResult>
}

/** llm 服务的鸭子类型面（避免在编译期依赖 @deepseek-ai/dsh-llm）。 */
interface LlmLike {
  listProviders?: () => Array<{ id: string; name?: string }>
  listModels?: (provider: string) => Promise<Array<{ id: string; name?: string }>>
  stream?: (options: Record<string, unknown>) => AsyncIterable<unknown>
}

/** 取 llm 服务（ctx.get 优先，其次直接属性）。 */
function llmService(ctx: Context): LlmLike | undefined {
  try {
    const viaGet = (ctx as unknown as { get?: (name: string) => unknown }).get?.('llm')
    if (viaGet !== undefined && viaGet !== null) return viaGet as LlmLike
  } catch {
    // ctx.get 在某些代次不存在或抛错：继续走属性访问。
  }
  const direct = (ctx as unknown as { llm?: unknown }).llm
  return direct === undefined || direct === null ? undefined : (direct as LlmLike)
}

/** 解析 "provider/model"（亦接受 provider:model 与仅 model）。 */
function parsePreference(preference: string): { provider?: string; model?: string } {
  const trimmed = preference.trim()
  if (trimmed === '') return {}
  const slash = trimmed.indexOf('/')
  if (slash > 0) return { provider: trimmed.slice(0, slash), model: trimmed.slice(slash + 1) }
  const colon = trimmed.indexOf(':')
  if (colon > 0) return { provider: trimmed.slice(0, colon), model: trimmed.slice(colon + 1) }
  return { model: trimmed }
}

/** 从流式 chunk 里读 token 用量（不同 adapter 字段可能不同，保守求和）。 */
function tokensOf(usage: Record<string, unknown>): number {
  const input = Number(usage['inputTokens'] ?? 0)
  const output = Number(usage['outputTokens'] ?? 0)
  const total = Number(usage['totalTokens'] ?? 0)
  if (Number.isFinite(total) && total > 0) return total
  return (Number.isFinite(input) ? input : 0) + (Number.isFinite(output) ? output : 0)
}

/**
 * 创建模型网关。
 * @param ctx - host 插件上下文（惰性解析 llm 服务）。
 */
export function createLlmGateway(ctx: Context): LlmGateway {
  /** 缓存已解析的默认路由，避免每次发言都枚举模型。 */
  let cachedDefault: ModelRoute | undefined
  let cachedCatalog: AvailableModels | undefined

  const catalog = async (): Promise<AvailableModels> => {
    if (cachedCatalog !== undefined) return cachedCatalog
    const llm = llmService(ctx)
    const providers: AvailableModels['providers'] = []
    let fallback = ''
    if (llm?.listProviders !== undefined) {
      try {
        const list = llm.listProviders() ?? []
        for (const provider of list) {
          const id = String(provider.id ?? '')
          if (id === '') continue
          let models: Array<{ id: string; name: string }> = []
          if (llm.listModels !== undefined) {
            try {
              const resolved = await llm.listModels(id)
              models = (resolved ?? [])
                .map((m) => ({ id: String(m.id ?? ''), name: String(m.name ?? m.id ?? '') }))
                .filter((m) => m.id !== '')
            } catch {
              models = []
            }
          }
          providers.push({ id, name: String(provider.name ?? id), models })
          if (fallback === '' && models.length > 0) fallback = `${id}/${models[0]!.id}`
        }
      } catch {
        // listProviders 失败：保持空目录，由调用方给出可读错误。
      }
    }
    cachedCatalog = { providers, default: fallback }
    return cachedCatalog
  }

  return {
    available() {
      const llm = llmService(ctx)
      return llm !== undefined && typeof llm.stream === 'function'
    },

    async listAvailable() {
      return catalog()
    },

    async resolve(preference) {
      if (preference !== undefined && preference.trim() !== '') {
        const parsed = parsePreference(preference)
        if (parsed.provider !== undefined && parsed.model !== undefined) {
          return { provider: parsed.provider, model: parsed.model }
        }
        // 只给了模型名：在第一处匹配的 provider 下找，找不到则用首个 provider。
        const { providers } = await catalog()
        for (const provider of providers) {
          if (provider.models.some((m) => m.id === parsed.model)) {
            return { provider: provider.id, model: parsed.model! }
          }
        }
        if (providers.length > 0) return { provider: providers[0]!.id, model: parsed.model! }
        throw new Error('无法解析模型路由：部署未注册任何 llm provider')
      }
      if (cachedDefault !== undefined) return cachedDefault
      const resolved = await catalog()
      if (resolved.default === '') {
        throw new Error('部署未配置可用的模型路由，无法进行模拟庭审')
      }
      const parsed = parsePreference(resolved.default)
      cachedDefault = { provider: parsed.provider!, model: parsed.model! }
      return cachedDefault
    },

    async generate(request) {
      const llm = llmService(ctx)
      if (llm === undefined || typeof llm.stream !== 'function') {
        throw new Error('llm 服务不可用：当前部署未挂载模型运行时，无法进行模拟庭审')
      }
      const route = request.route ?? (await this.resolve())
      cachedDefault = route
      const messages: Array<Record<string, unknown>> = request.messages.map((m) => ({
        role: m.role,
        content: [{ type: 'text', text: m.content }],
      }))
      const options: Record<string, unknown> = {
        provider: route.provider,
        model: route.model,
        messages,
        ...(request.system === undefined || request.system === '' ? {} : { system: request.system }),
        ...(request.maxTokens === undefined ? {} : { maxTokens: request.maxTokens }),
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      }

      let text = ''
      let tokens = 0
      let rawFinish: unknown
      const stream = llm.stream(options)
      for await (const raw of stream) {
        const chunk = raw as { type?: string; text?: string; usage?: Record<string, unknown>; reason?: unknown }
        switch (chunk.type) {
          case 'text-delta':
            if (typeof chunk.text === 'string') text += chunk.text
            break
          case 'usage':
            if (chunk.usage !== undefined) tokens += tokensOf(chunk.usage)
            break
          case 'finish':
            rawFinish = chunk.reason ?? 'stop'
            break
          default:
            break
        }
      }
      // 失败必须**响亮**：否则会静默产出空发言、空判决，而会话状态还是 done。
      const failure = describeFinishFailure(rawFinish)
      if (failure !== undefined) {
        throw new Error(`模型调用失败（${route.provider}/${route.model}）：${failure}`)
      }
      return {
        text: text.trim(),
        tokens,
        finish: describeFinish(rawFinish),
        ...(rawFinish === undefined ? {} : { rawFinish }),
        route,
      }
    },
  }
}
