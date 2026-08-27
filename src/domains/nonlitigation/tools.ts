/**
 * Agent tool for the non-litigation module — the model-facing "非诉管家"
 * surface.
 *
 * POC scope: project list/get/register/update/delete. Task tree / service
 * actions can be added later by extending ACTIONS and HTTP_ROUTE.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

const ACTIONS = [
  'list_projects',
  'get_project',
  'register_project',
  'update_project',
  'delete_project',
] as const

type Action = typeof ACTIONS[number]

const DESCRIPTION = [
  '非诉项目管理工具（AgentLex 非诉管家）。管理非诉项目：常法/专项项目登记/更新/删除、',
  '服务周期、负责人、合同金额、任务计划等。',
  '当用户提到项目、常法、专项、服务周期、合同金额时调用。',
  'action 必填；各 action 所需字段见 parameters。',
].join('')

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
  return value as JsonVal
}

/** Resolve the host base URL for node-side fetches. */
function resolveHostBaseUrl(ctx: Context): string {
  // Prefer the actual webServer service port; DSH_WEB_URL can be stale/wrong.
  const server = ctx.get('webServer') as { port?: number } | undefined
  if (server !== undefined && server.port !== undefined) {
    return `http://127.0.0.1:${String(server.port)}`
  }
  const fromEnv = process.env.DSH_WEB_URL
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv.replace(/\/+$/, '')
  throw new Error('nonlitigation: cannot resolve host base URL')
}

async function api(body: Record<string, unknown>, baseUrl: string): Promise<unknown> {
  const path = String(body.route ?? 'projects')
  const { route: _omit, ...payload } = body
  const response = await fetch(`${baseUrl}/api/agentlex-nonlitigation/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`nonlitigation HTTP ${response.status}: ${text || 'request failed'}`)
  }
  const envelope = await response.json() as { success: boolean; data?: unknown; error?: string }
  if (!envelope.success) throw new Error(envelope.error ?? `request failed (${response.status})`)
  return envelope.data
}

const HTTP_ROUTE: Record<Action, { path: string; map?: (data: unknown) => unknown }> = {
  list_projects: {
    path: 'projects',
    map: (data) => {
      const registry = data as { projects: Record<string, { projectId: string; name: string; projectType?: string; status?: string; updatedAt?: string }> }
      const summary = Object.values(registry.projects).map((p) => ({
        projectId: p.projectId, name: p.name, projectType: p.projectType, status: p.status, updatedAt: p.updatedAt,
      }))
      return { count: summary.length, projects: summary }
    },
  },
  get_project: { path: 'project', map: (data) => ({ project: data }) },
  register_project: { path: 'register-project' },
  update_project: { path: 'update-project' },
  delete_project: { path: 'delete-project' },
}

/**
 * Register the nonlitigation agent tool in agent-preset mode (HTTP-backed).
 * @param ctx - host context with the `tools` service injected.
 * @returns disposer.
 */
export function registerNonLitigationHttpTool(ctx: Context): () => void {
  return ctx.tools.register(defineTool({
    name: 'nonlitigation',
    description: DESCRIPTION,
    parameters: {
      action: { type: 'string', required: true, description: `要执行的操作：${ACTIONS.join(' / ')}` },
      projectId: { type: 'string', description: '项目编号，如 CF-2026-001' },
      name: { type: 'string', description: '项目名称' },
      projectType: { type: 'string', description: '项目类型：retainer/special' },
      status: { type: 'string', description: '状态：active/inactive/closed' },
      leadLawyer: { type: 'string', description: '负责人' },
      contractAmount: { type: 'string', description: '合同金额' },
      folder: { type: 'string', description: '项目文件夹路径' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{
        type: 'text',
        text: JSON.stringify(value, null, 2),
      }],
    },
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const action = args.action as Action
      if (!ACTIONS.includes(action)) throw new Error(`unknown action: ${String(args.action)}`)
      const route = HTTP_ROUTE[action]
      const body: Record<string, unknown> = { route: route.path }
      if (args.projectId !== undefined) body.projectId = String(args.projectId)
      if (args.name !== undefined) body.name = String(args.name)
      if (args.projectType !== undefined) body.projectType = String(args.projectType)
      if (args.status !== undefined) body.status = String(args.status)
      if (args.leadLawyer !== undefined) body.leadLawyer = String(args.leadLawyer)
      if (args.contractAmount !== undefined) body.contractAmount = String(args.contractAmount)
      if (args.folder !== undefined) body.folder = String(args.folder)
      const data = await api(body, resolveHostBaseUrl(ctx))
      return clean(route.map ? route.map(data) : data)
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `nonlitigation: ${String(args.action)}${args.projectId !== undefined ? ` ${String(args.projectId)}` : ''}`,
    }),
  }))
}
