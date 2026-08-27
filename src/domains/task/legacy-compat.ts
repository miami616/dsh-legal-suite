/**
 * Legacy AgentLex renderer compatibility routes — task domain.
 *
 * 适配器消化：独立任务（standalone-task）的旧 `/api/agentlex/*` 兼容面按域归位
 * 到本插件，直接调用 taskStore。语义与旧 dsh-adapter 一致。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { RouteDeps } from './routes.ts'

/* ------------------------- response helpers ------------------------- */

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (raw.length === 0) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function sendJson(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function ok(res: ServerResponse, data: unknown): void {
  sendJson(res, 200, { success: true, data })
}

function fail(res: ServerResponse, error: unknown, status = 400): void {
  const message = error instanceof Error ? error.message : String(error)
  sendJson(res, status, { success: false, error: message })
}

/* ---------------------- legacy shape translation --------------------- */

/** Normalize a DSH standalone task to the legacy renderer shape. */
function toLegacyStandaloneTask(task: Record<string, unknown>): Record<string, unknown> {
  return {
    ...task,
    id: String(task.id ?? ''),
    title: String(task.title ?? ''),
    status: task.status === undefined ? 'todo' : String(task.status),
    priority: task.priority === undefined ? 'medium' : String(task.priority),
    subtasks: Array.isArray(task.subtasks) ? task.subtasks : [],
    checklist: Array.isArray(task.checklist) ? task.checklist : [],
  }
}

/* --------------------------- route family --------------------------- */

/** Register the task-domain legacy `/api/agentlex/*` routes. */
export function registerLegacyCompatRoutes(ctx: Context, deps: RouteDeps): () => void {
  const disposers: Array<() => void> = []

  function route(
    path: string,
    handler: (body: Record<string, unknown>, res: ServerResponse) => Promise<void> | void,
  ): void {
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        try {
          const body = await readBody(req)
          await handler(body, res)
        } catch (error) {
          fail(res, error)
        }
      },
    }))
  }

  route('/api/agentlex/add-standalone-task', async (body, res) => {
    // 与原生 /task 一致：接受 id（规范）或 taskId（传输）作为 upsert 键。
    const { taskId, ...input } = body
    if (taskId !== undefined) input.id = String(taskId)
    ok(res, toLegacyStandaloneTask(await deps.taskStore.upsertTask(input) as unknown as Record<string, unknown>))
  })

  route('/api/agentlex/update-standalone-task', async (body, res) => {
    const taskId = String(body.taskId ?? '')
    const patch = (body.patch ?? {}) as Record<string, unknown>
    const tasks = await deps.taskStore.listTasks()
    const existing = tasks.find((t) => t.id === taskId)
    if (existing === undefined) throw new Error(`standalone task not found: ${taskId}`)
    const merged = { ...existing, ...patch, id: taskId }
    ok(res, toLegacyStandaloneTask(await deps.taskStore.upsertTask(merged) as unknown as Record<string, unknown>))
  })

  route('/api/agentlex/delete-standalone-task', async (body, res) => {
    ok(res, await deps.taskStore.deleteTask(String(body.taskId ?? '')))
  })

  return () => {
    for (const dispose of disposers.splice(0)) dispose()
  }
}
