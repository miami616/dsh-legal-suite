/**
 * dsh-legal-suite/moot-court — host 侧同源 HTTP 客户端。
 *
 * 用于「回写改进建议到诉讼任务树」：诉讼域的写入口径是 HTTP 路由族
 * `/api/agentlex-case/*`（与浏览器面板走同一条路），而 `litigation` 工具**只在
 * agent-preset 平面注册**（作用域绑定某个会话），host 域既看不到也不该依赖它。
 * 因此这里直接走本机 HTTP，与诉讼域 `registerLitigationHttpTool` 的做法一致。
 *
 * 基址解析沿用其口径：优先取 webServer 服务的实际端口（DSH_WEB_URL 可能指向
 * 另一个实例，例如 3080，而当前 web shell 实际在 3081）。
 */
import type { Context } from '@deepseek-ai/cordis'

/** 解析本机 host 基址（不带尾斜杠）。 */
export function resolveHostBaseUrl(ctx: Context): string {
  const server = ctx.get('webServer') as { port?: number } | undefined
  if (server !== undefined && server.port !== undefined) {
    return `http://127.0.0.1:${String(server.port)}`
  }
  const fromEnv = process.env.DSH_WEB_URL
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv.replace(/\/+$/, '')
  throw new Error('moot-court: 无法解析本机 host 基址（webServer 服务不可用）')
}

/** 调用同源 API 并拆包络。 */
export async function hostApi<T = unknown>(
  ctx: Context,
  path: string,
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const base = resolveHostBaseUrl(ctx)
  let response: Response
  try {
    response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
      ...(signal === undefined ? {} : { signal }),
    })
  } catch (error) {
    throw new Error(`本机 API 不可达（${path}）：${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`本机 API ${path} HTTP ${response.status}：${text.slice(0, 300)}`)
  }
  const envelope = await response.json() as { success?: boolean; data?: T; error?: string }
  if (envelope.success !== true) throw new Error(envelope.error ?? `${path} 调用失败`)
  return envelope.data as T
}

/** 诉讼域任务组（回写用到的字段）。 */
export interface LitigationTaskGroup {
  id?: string
  name?: string
  tasks?: Array<{ id?: string; title?: string }>
}

/** 读案件（含 hydrate 后的任务组）。 */
export async function readLitigationCase(
  ctx: Context,
  caseId: string,
  signal?: AbortSignal,
): Promise<{ taskGroups: LitigationTaskGroup[] }> {
  const data = await hostApi<{ taskGroups?: LitigationTaskGroup[] }>(
    ctx, '/api/agentlex-case/read-case', { caseId }, signal,
  )
  return { taskGroups: data?.taskGroups ?? [] }
}

/** 建/改任务组，返回 groupId。 */
export async function upsertLitigationGroup(
  ctx: Context,
  caseId: string,
  name: string,
  signal?: AbortSignal,
): Promise<string> {
  const data = await hostApi<{ groupId?: string; id?: string }>(
    ctx, '/api/agentlex-case/group', { caseId, name }, signal,
  )
  const groupId = data?.groupId ?? data?.id ?? ''
  if (groupId === '') throw new Error('创建任务组未返回 groupId')
  return groupId
}

/** 建任务。 */
export async function upsertLitigationTask(
  ctx: Context,
  input: { caseId: string; groupId: string; taskTitle: string; priority?: string; note?: string },
  signal?: AbortSignal,
): Promise<void> {
  await hostApi(ctx, '/api/agentlex-case/task', {
    caseId: input.caseId,
    groupId: input.groupId,
    taskTitle: input.taskTitle,
    ...(input.priority === undefined ? {} : { priority: input.priority }),
    ...(input.note === undefined ? {} : { note: input.note }),
  }, signal)
}
