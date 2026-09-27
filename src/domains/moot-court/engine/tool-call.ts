/**
 * dsh-legal-suite/moot-court — host 侧的工具调用桥。
 *
 * 庭审引擎需要在不经过 agent 会话的前提下调用已注册工具：
 *   • 元典 MCP 工具（`mcp__yuandian-law__*` / `mcp__yuandian-case__*`）—— 法条与类案锚定；
 *   • `legal_calc` —— 涉金钱争点的金额测算。
 *
 * dsh 的 `tools` 服务提供 `execute(exec)`（host 可直接调用），本模块把它包成
 * 「按名称列表探测 + 调用 + 归一化结果」的最小面，并统一处理两种失败：
 *   • 工具未注册（部署未接元典 / 工具被裁剪）→ `unavailable`
 *   • 调用被策略拒绝或执行报错 → `error`
 * 引擎据此降级，而不是让整场庭审崩掉。
 */
import type { Context } from '@deepseek-ai/cordis'

/** 工具调用结果。 */
export interface ToolCallResult {
  ok: boolean
  /** 成功时的规范值（通常是 MCP 结果对象或 legal_calc 的测算结果）。 */
  value?: unknown
  /** 失败原因。 */
  error?: string
  /** 工具根本不在注册表中（与「调用失败」区分，用于降级文案）。 */
  unavailable?: boolean
}

/** 一个可见工具的摘要（名称 + 参数 schema）。 */
export interface VisibleTool {
  name: string
  description: string
  /** 模型面 JSON Schema（用于按真实字段构造参数，避免猜字段名）。 */
  parameters: Record<string, unknown>
}

/** tools 服务的鸭子类型面。 */
interface ToolsLike {
  schemas?: (scope?: unknown) => Array<{ name: string; description?: string; parameters?: Record<string, unknown> }>
  execute?: (exec: Record<string, unknown>) => Promise<unknown>
}

function toolsService(ctx: Context): ToolsLike | undefined {
  try {
    const viaGet = (ctx as unknown as { get?: (name: string) => unknown }).get?.('tools')
    if (viaGet !== undefined && viaGet !== null) return viaGet as ToolsLike
  } catch {
    // 继续走属性访问。
  }
  const direct = (ctx as unknown as { tools?: unknown }).tools
  return direct === undefined || direct === null ? undefined : (direct as ToolsLike)
}

/** 调用序号（callId 只需在会话内唯一）。 */
let callSeq = 0

/**
 * 列出当前注册的工具名（可选过滤）。
 * @param ctx - host 上下文。
 * @param prefix - 只保留该前缀的工具名。
 */
export function listToolNames(ctx: Context, prefix?: string): string[] {
  return listTools(ctx, prefix).map((tool) => tool.name)
}

/**
 * 列出当前注册的工具（含参数 schema，可选前缀过滤）。
 * 检索锚定据此按**真实字段名**构造参数——不同部署/版本的元典 MCP 工具
 * 字段名并不一致（例如 semantic_search 系列 vs vector_search 系列）。
 */
export function listTools(ctx: Context, prefix?: string): VisibleTool[] {
  try {
    const schemas = toolsService(ctx)?.schemas?.() ?? []
    return schemas
      .filter((s): s is { name: string; description?: string; parameters?: Record<string, unknown> } =>
        typeof s?.name === 'string' && (prefix === undefined || s.name.startsWith(prefix)))
      .map((s) => ({
        name: s.name,
        description: s.description ?? '',
        parameters: s.parameters ?? {},
      }))
  } catch {
    return []
  }
}

/** 取一个工具的 schema（找不到返回 undefined）。 */
export function toolSchemaOf(ctx: Context, name: string): VisibleTool | undefined {
  return listTools(ctx).find((tool) => tool.name === name)
}

/**
 * 调用一个已注册工具。
 * @param ctx - host 上下文。
 * @param name - 注册名（如 `mcp__yuandian-law__yuandian_law_vector_search__v2`）。
 * @param args - 解析后的参数（lossless JSON）。
 * @param signal - 取消信号（随庭审中止传播）。
 */
export async function callTool(
  ctx: Context,
  name: string,
  args: unknown,
  signal: AbortSignal,
): Promise<ToolCallResult> {
  const tools = toolsService(ctx)
  if (tools === undefined || typeof tools.execute !== 'function') {
    return { ok: false, unavailable: true, error: 'tools 服务不可用' }
  }
  const known = listToolNames(ctx, name.slice(0, Math.min(name.length, 18)))
  if (!known.includes(name)) {
    return { ok: false, unavailable: true, error: `工具未注册：${name}` }
  }
  callSeq += 1
  try {
    const raw = await tools.execute({
      callId: `moot-${Date.now().toString(36)}-${callSeq}`,
      name,
      arguments: args,
      signal,
    })
    const result = raw as {
      isError?: boolean
      value?: unknown
      error?: { message?: string; reason?: string; code?: string }
      content?: Array<{ type?: string; text?: string }>
    }
    if (result?.isError === true) {
      const message = result.error?.message ?? result.error?.reason ?? result.error?.code
        ?? result.content?.map((c) => c.text ?? '').join(' ') ?? '工具执行失败'
      return { ok: false, error: message }
    }
    return { ok: true, value: result?.value }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // 「未找到工具 / 策略拒绝」视为不可用，与真正的执行错误区分开。
    const unavailable = /UNKNOWN_TOOL|not found|denied|不可用/i.test(message)
    return { ok: false, unavailable, error: message }
  }
}
