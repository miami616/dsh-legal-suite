/**
 * Agent tool for the non-litigation module — the model-facing "非诉管家"
 * surface.
 *
 * A single `nonlitigation` tool with an `action` union keeps the schema flat
 * and the model's job easy: read/query projects, register/update projects,
 * manage task groups/tasks/subtasks/checklists, key dates, and service
 * records. Every mutation goes through the same HTTP routes as the browser
 * half, so the UI live-refreshes (agentlex:registry-changed) after a change.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

const ACTIONS = [
  'list_projects',
  'get_project',
  'register_project',
  'update_project',
  'delete_project',
  'add_keydate',
  'toggle_keydate',
  'delete_keydate',
  'upsert_group',
  'delete_group',
  'reorder_groups',
  'upsert_task',
  'delete_task',
  'move_task',
  'upsert_subtask',
  'delete_subtask',
  'add_checklist',
  'toggle_check',
  'delete_checklist',
  'list_services',
  'upsert_service',
  'delete_service',
  'import_projects',
] as const

type Action = typeof ACTIONS[number]

const DESCRIPTION = [
  '非诉项目管理工具（AgentLex 非诉管家）。管理非诉项目：常法/专项项目登记/更新/删除、',
  '服务周期、负责人、合同金额、任务树（阶段→任务→子任务→检查项）、关键日期、服务记录台账。',
  '当用户提到项目、常法、专项、服务周期、合同金额、任务计划、服务台账时调用。',
  'action 必填；各 action 所需字段见 parameters。列表/查询类只读，变更类会立即持久化并刷新界面。',
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
  add_keydate: { path: 'keydate' },
  toggle_keydate: { path: 'toggle-keydate' },
  delete_keydate: { path: 'delete-keydate' },
  upsert_group: { path: 'group' },
  delete_group: { path: 'delete-group' },
  reorder_groups: { path: 'reorder-groups' },
  upsert_task: { path: 'task' },
  delete_task: { path: 'delete-task' },
  move_task: { path: 'move-task' },
  upsert_subtask: { path: 'subtask' },
  delete_subtask: { path: 'delete-subtask' },
  add_checklist: { path: 'add-checklist' },
  toggle_check: { path: 'check' },
  delete_checklist: { path: 'delete-checklist' },
  list_services: { path: 'services' },
  upsert_service: { path: 'service' },
  delete_service: { path: 'delete-service' },
  import_projects: { path: 'import' },
}

/** Build the request payload (route + action fields) for an action. */
function buildBody(action: Action, args: Record<string, unknown>): Record<string, unknown> {
  const route = HTTP_ROUTE[action].path
  const s = (v: unknown): string | undefined => (v === undefined || v === null) ? undefined : String(v)
  const body: Record<string, unknown> = { route }
  switch (action) {
    case 'list_projects': case 'list_services':
      return body
    case 'get_project': case 'delete_project':
      body.projectId = s(args.projectId)
      return body
    case 'register_project':
      for (const key of ['name', 'projectType', 'status', 'leadLawyer', 'contractAmount', 'folder', 'summary'] as const) {
        const value = s(args[key])
        if (value !== undefined) body[key] = value
      }
      if (args.serviceScope !== undefined) body.serviceScope = clean(args.serviceScope)
      if (args.servicePeriod !== undefined) body.servicePeriod = clean(args.servicePeriod)
      return body
    case 'update_project':
      body.projectId = s(args.projectId)
      for (const key of ['name', 'projectType', 'status', 'leadLawyer', 'contractAmount', 'folder', 'summary'] as const) {
        const value = s(args[key])
        if (value !== undefined) body[key] = value
      }
      if (args.serviceScope !== undefined) body.serviceScope = clean(args.serviceScope)
      if (args.servicePeriod !== undefined) body.servicePeriod = clean(args.servicePeriod)
      return body
    case 'add_keydate': case 'toggle_keydate': case 'delete_keydate':
      body.projectId = s(args.projectId)
      if (args.keyDateId !== undefined) body.keyDateId = s(args.keyDateId)
      if (args.label !== undefined) body.label = s(args.label)
      if (args.date !== undefined) body.date = s(args.date)
      return body
    case 'upsert_group': case 'delete_group':
      body.projectId = s(args.projectId)
      if (args.groupId !== undefined) body.groupId = s(args.groupId)
      if (args.groupName !== undefined) body.name = s(args.groupName)
      return body
    case 'reorder_groups':
      body.projectId = s(args.projectId)
      if (Array.isArray(args.orderedIds)) body.orderedIds = (args.orderedIds as unknown[]).map(String)
      return body
    case 'upsert_task': case 'delete_task':
      body.projectId = s(args.projectId)
      body.groupId = s(args.groupId)
      if (args.taskId !== undefined) body.taskId = s(args.taskId)
      if (action === 'upsert_task') {
        if (args.taskTitle !== undefined) body.title = s(args.taskTitle)
        if (args.deadline !== undefined) body.deadline = s(args.deadline)
        if (args.priority !== undefined) body.priority = s(args.priority)
        if (args.status !== undefined) body.status = s(args.status)
      }
      return body
    case 'move_task':
      body.projectId = s(args.projectId)
      body.taskId = s(args.taskId)
      body.toGroupId = s(args.toGroupId)
      if (typeof args.index === 'number') body.index = args.index
      return body
    case 'upsert_subtask': case 'delete_subtask':
      body.projectId = s(args.projectId)
      body.groupId = s(args.groupId)
      body.taskId = s(args.taskId)
      if (args.subtaskId !== undefined) body.subtaskId = s(args.subtaskId)
      if (args.subtaskTitle !== undefined) body.title = s(args.subtaskTitle)
      return body
    case 'add_checklist':
      body.projectId = s(args.projectId)
      body.groupId = s(args.groupId)
      body.taskId = s(args.taskId)
      if (args.checklistText !== undefined) body.text = s(args.checklistText)
      return body
    case 'toggle_check': case 'delete_checklist':
      body.projectId = s(args.projectId)
      body.groupId = s(args.groupId)
      body.taskId = s(args.taskId)
      if (args.checklistId !== undefined) body.checklistId = s(args.checklistId)
      return body
    case 'upsert_service':
      if (args.serviceId !== undefined) body.id = s(args.serviceId)
      if (args.name !== undefined) body.name = s(args.name)
      if (args.kind !== undefined) body.kind = s(args.kind)
      if (args.client !== undefined) body.client = s(args.client)
      if (args.status !== undefined) body.status = s(args.status)
      if (args.date !== undefined) body.date = s(args.date)
      if (args.note !== undefined) body.note = s(args.note)
      return body
    case 'delete_service':
      if (args.serviceId !== undefined) body.id = s(args.serviceId)
      return body
    case 'import_projects':
      if (args.sourceDir !== undefined) body.sourceDir = s(args.sourceDir)
      return body
    default:
      return body
  }
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
      summary: { type: 'string', description: '项目摘要/备注' },
      serviceScope: { type: 'json', description: '服务范围数组，如 ["合同审查","法律咨询"]' },
      servicePeriod: { type: 'json', description: '服务周期对象：{ start?: YYYY-MM-DD, end?: YYYY-MM-DD }' },
      keyDateId: { type: 'string', description: '关键日期 id' },
      label: { type: 'string', description: '关键日期名称，如 续约提醒' },
      date: { type: 'string', description: '日期 YYYY-MM-DD' },
      groupId: { type: 'string', description: '任务组（阶段）id（upsert_task/upsert_subtask/add_checklist/toggle_check/delete_checklist 必填）' },
      groupName: { type: 'string', description: '任务组（阶段）名称，如 尽调阶段' },
      taskId: { type: 'string', description: '任务 id（upsert_subtask/delete_subtask/add_checklist/toggle_check/delete_checklist 必填）' },
      taskTitle: { type: 'string', description: '任务标题' },
      deadline: { type: 'string', description: '任务截止日期 YYYY-MM-DD' },
      priority: { type: 'string', description: '优先级：low/medium/high' },
      toGroupId: { type: 'string', description: 'move_task 目标任务组 id' },
      index: { type: 'number', description: 'move_task 目标位置索引（可选）' },
      orderedIds: { type: 'json', description: 'reorder_groups 任务组 id 有序数组' },
      subtaskId: { type: 'string', description: '子任务 id（upsert_subtask 可选——省略则新建子任务并自动生成 id；delete_subtask 必填）' },
      subtaskTitle: { type: 'string', description: '子任务标题（upsert_subtask 新建时必填）' },
      checklistId: { type: 'string', description: '检查项 id（toggle_check/delete_checklist 必填）' },
      checklistText: { type: 'string', description: '检查项内容（add_checklist 创建检查项）' },
      serviceId: { type: 'string', description: '服务记录 id（upsert_service 传则更新，delete_service 必填）' },
      kind: { type: 'string', description: '服务类型，如 常法/专项' },
      client: { type: 'string', description: '服务客户' },
      note: { type: 'string', description: '服务备注' },
      sourceDir: { type: 'string', description: 'import_projects 源目录（AgentLex 桌面数据目录）' },
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
      const body = buildBody(action, args)
      const data = await api(body, resolveHostBaseUrl(ctx))
      return clean(route.map ? route.map(data) : data)
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `nonlitigation: ${String(args.action)}${args.projectId !== undefined ? ` ${String(args.projectId)}` : ''}`,
    }),
  }))
}
