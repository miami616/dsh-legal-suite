/**
 * Agent tool for the litigation module — the model-facing "诉讼管家" surface.
 *
 * A single `litigation` tool with an `action` union keeps the schema flat and
 * the model's job easy: read/query cases, register/update cases, manage task
 * groups/tasks/subtasks/checklists, timeline events, and deadline summaries.
 * Every mutation goes through the same stores as the HTTP routes, so the
 * browser half live-refreshes (agentlex:registry-changed) after a change.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { CaseStore } from './store/case-store.ts'
import type { TimelineStore } from './store/timeline-store.ts'
import { LITIGATION_STATUSES } from '../../shared/playbook/litigation.ts'
import {
  STAGE_ORDER,
  applyStageExpansion,
  detectStageSuggestions,
  planStageExpansion,
} from './stage-expansion.ts'
import { computeCaseHealth, computeRegistryHealth } from './health.ts'

/** Stores the tool operates on (same instances as the route family). */
export interface ToolDeps {
  caseStore: CaseStore
  timelineStore: TimelineStore
  /** Deadline engine summary (optional when unavailable). */
  deadlines?(caseId?: string, opts?: { includeOverdue?: boolean }): unknown | Promise<unknown>
}

const ACTIONS = [
  'list_cases',
  'get_case',
  'register_case',
  'update_case',
  'delete_case',
  'add_keydate',
  'toggle_keydate',
  'upsert_group',
  'delete_group',
  'upsert_task',
  'delete_task',
  'move_task',
  'set_task_keydate',
  'upsert_subtask',
  'delete_subtask',
  'upsert_check',
  'toggle_check',
  'upsert_event',
  'toggle_event',
  'delete_event',
  'list_events',
  'deadlines',
  'apply_stage_template',
  'stage_suggestions',
  'case_health',
] as const

type Action = typeof ACTIONS[number]

/** Tool parameters (shared by both registrations). */
const PARAMETERS = {
  action: { type: 'string', required: true, description: `要执行的操作：${ACTIONS.join(' / ')}` },
  caseId: { type: 'string', description: '案件编号，如 2025-003' },
  caseNumber: { type: 'string', description: '法院案号' },
  name: { type: 'string', description: '案件名称' },
  type: { type: 'string', description: '案件类型：民商/刑事/行政/劳动争议/知识产权/执行/其他' },
  cause: { type: 'string', description: '案由，如 广告合同纠纷' },
  status: { type: 'string', description: `进度，必须取值于规范状态阶梯：${LITIGATION_STATUSES.map((s) => s.id).join('/')}（对应 ${LITIGATION_STATUSES.map((s) => s.label).join('/')}）。审级（一审/二审/执行）写 level 字段，不要混进 status` },
  court: { type: 'string', description: '受理法院' },
  judge: { type: 'string', description: '承办法官' },
  level: { type: 'string', description: '审级：一审/二审/再审/劳动仲裁/商事仲裁/首次执行/恢复执行' },
  claimAmount: { type: 'string', description: '标的额，如 84000 或 8.4万' },
  filingDate: { type: 'string', description: '立案日期 YYYY-MM-DD' },
  ourSide: { type: 'string', description: '我方身份：plaintiff/defendant/applicant/respondent/appellant/appellee/executionApplicant/executionRespondent' },
  summary: { type: 'string', description: '案情摘要' },
  folder: { type: 'string', description: '卷宗文件夹路径' },
  parties: { type: 'json', description: '当事人明细对象：{ plaintiff?, defendant?, ourSide?, details?: [{ name, role?, address?, legalRep?, creditCode?, phone?, ourClient? }] }。登记/更新案件时传入以写入当事人' },
  label: { type: 'string', description: '关键日期名称，如 开庭' },
  date: { type: 'string', description: '日期 YYYY-MM-DD' },
  keyDateId: { type: 'string', description: '关键日期 id' },
  groupId: { type: 'string', description: '任务组（阶段）id（upsert_task/upsert_subtask/delete_subtask/toggle_check/upsert_check 必填）' },
  groupName: { type: 'string', description: '任务组（阶段）名称，如 一审阶段（upsert_group 新建时必填）' },
  taskId: { type: 'string', description: '任务 id（upsert_subtask/delete_subtask/toggle_check/upsert_check 必填；upsert_task 可选——省略则新建任务并自动生成 id）' },
  taskTitle: { type: 'string', description: '任务标题（upsert_task 新建时必填）' },
  deadline: { type: 'string', description: '任务截止日期 YYYY-MM-DD' },
  priority: { type: 'string', description: '优先级：low/medium/high' },
  toGroupId: { type: 'string', description: 'move_task 目标任务组 id' },
  enabled: { type: 'boolean', description: 'set_task_keydate 是否启用任务的关键日期提醒（true=生成/解除关键日期，双向联动；任务须已有 deadline）' },
  subtaskId: { type: 'string', description: '子任务 id（upsert_subtask 可选——省略则新建子任务并自动生成 id；delete_subtask 必填）' },
  subtaskTitle: { type: 'string', description: '子任务标题（upsert_subtask 新建时必填）' },
  checklistId: { type: 'string', description: '检查项 id（upsert_check 可选——省略则新建检查项并自动生成 id；toggle_check/delete_checklist 必填）' },
  checklistText: { type: 'string', description: '检查项内容（upsert_check 新建时必填；同时传 checklistId 则更新该检查项）' },
  eventId: { type: 'string', description: '时间轴事件 id' },
  eventType: { type: 'string', description: '事件类型：hearing/evidence_deadline/defense_deadline/appeal_deadline/filing_deadline/filing/service/court_notice/arbitration/mediation/judgment/ruling/verdict/appeal/execution/case_event' },
  title: { type: 'string', description: '时间轴事件名称，如 第一次开庭' },
  detail: { type: 'string', description: '事件详情' },
  includeOverdue: { type: 'boolean', description: 'deadlines 是否包含已过期历史事项（默认 false，只返回未到期）' },
  stageId: { type: 'string', description: `apply_stage_template 的阶段模板 id：${STAGE_ORDER.join('/')}。模板只给骨架，落地后可按案情增删改用 only/skip 裁剪` },
  anchorDate: { type: 'string', description: 'apply_stage_template 的锚点日期 YYYY-MM-DD（如开庭日）：模板中带提前量的任务据此推算 deadline' },
  only: { type: 'json', description: 'apply_stage_template 只展开这些任务标题的数组，如 ["提交证据","申请财产保全"]' },
  skip: { type: 'json', description: 'apply_stage_template 跳过这些任务标题的数组（本案不适用的标准动作）' },
  dryRun: { type: 'boolean', description: 'apply_stage_template 传 true 时只返回展开计划不落库（预览用）；默认 false' },
  includeClosed: { type: 'boolean', description: 'case_health 不带 caseId 扫描全部时，是否包含已结案案件（默认 false）' },
} as const

/** Tool description — the model reads this to know when to call. */
const DESCRIPTION = [
  '案件管理工具（AgentLex 诉讼管家）。管理诉讼案件：案件登记/更新/删除、当事人、案由、法院、标的、进度、',
  '任务树（阶段→任务→子任务→检查项）、时间轴（开庭/举证/上诉等节点与提醒）、关键日期、期限汇总。',
  '当用户提到具体案件、要求登记/更新案件、安排任务、记录开庭/举证/上诉等节点、查询期限时调用。',
  'action 必填；各 action 所需字段见 parameters。列表/查询类只读，变更类会立即持久化并刷新界面。',
  '写入纪律：任务名写「动作」不写「状态」（用「出庭参加庭审」，不用「等待开庭」）；',
  '同一事项不得同时登记为任务 deadline、关键日期与时间轴事件，只登记必要的体系；',
  '新建案件时只铺当前阶段，不要一次性生成全流程任务。',
  '阶段推进：apply_stage_template 按阶段模板展开标准任务（dryRun=true 先预览、only/skip 裁剪、anchorDate 推算 deadline）；',
  'stage_suggestions 只读检测「当前阶段已完成→该展开下一阶段」与缺失的登记字段；',
  'update_case 改变 status 时响应会内联返回 stageSuggestions，据此向用户提出下一步建议。',
  'case_health 只读体检：信息完整度按当前阶段动态计算（诉前不罚缺案号），附缺口清单与阶段进度。',
].join('')

/** Validate ids are non-empty strings for mutation actions. */
function requireIds(ids: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(ids)) {
    if (value === undefined || value === '') throw new Error(`${key} is required`)
  }
}

/** Strip undefined/null properties recursively so values are JSON-safe. */
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

/**
 * 当事人入参归一化：DSH 工具框架把 `type: 'json'` 参数以 JSON 字符串传给
 * handler，原样落盘会把 parties 序列化成字符串、界面无法渲染（issue:
 * 当事人信息不显示）。字符串（合法 JSON）→ 解析为对象；解析失败保留原值。
 */
function normalizeParties(value: unknown): unknown {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return JSON.parse(trimmed) as unknown
      } catch {
        /* 非 JSON 字符串：保留原值（如手写文本备注） */
      }
    }
  }
  return value
}

/**
 * 数组类入参归一化：`type: 'json'` 的参数同样以 JSON 字符串传入，因此
 * only/skip 既可能是真数组，也可能是 `["a","b"]` 这样的字符串，还可能是
 * 单个标题。三种形态一律归一为字符串数组，避免管家按直觉传单个字符串时
 * 被静默忽略。
 */
function toStringArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return undefined
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown
        return Array.isArray(parsed) ? parsed.map(String) : undefined
      } catch {
        /* 非 JSON 数组：按单个标题处理 */
      }
    }
    return [trimmed]
  }
  return undefined
}

/**
 * Register the litigation agent tool on ctx.tools.
 * @param ctx - host context with the `tools` service injected.
 * @param deps - the stores backing the operations.
 * @returns the disposer that unregisters the tool.
 */
export function registerLitigationTool(ctx: Context, deps: ToolDeps): () => void {
  return ctx.tools.register(defineTool({
    name: 'litigation',
    description: DESCRIPTION,
    parameters: PARAMETERS,
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

      const cs = deps.caseStore
      const ts = deps.timelineStore
      const s = (v: unknown): string | undefined => (v === undefined || v === null) ? undefined : String(v)

      switch (action) {
        /* ----------------------------- read ----------------------------- */
        case 'list_cases': {
          const registry = await cs.readRegistry()
          const summary = Object.values(registry.cases).map((c) => ({
            caseId: c.caseId, name: c.name, type: c.type, status: c.status,
            court: c.court, level: c.level, updatedAt: c.updatedAt,
          }))
          return clean({ count: summary.length, cases: summary })
        }
        case 'get_case': {
          requireIds({ caseId: s(args.caseId) })
          const record = await cs.readCase(args.caseId as string)
          if (record === undefined) return { error: `case not found: ${args.caseId}` }
          return clean({ case: record })
        }
        case 'list_events': {
          const events = await ts.listEvents(args.caseId === undefined ? undefined : String(args.caseId))
          return clean({ count: events.length, events })
        }
        case 'deadlines': {
          if (deps.deadlines === undefined) return { error: 'deadline engine unavailable' }
          const opts = typeof args.includeOverdue === 'boolean' ? { includeOverdue: args.includeOverdue } : undefined
          return clean({ deadlines: await deps.deadlines(args.caseId === undefined ? undefined : String(args.caseId), opts) })
        }
        /* ------------------- stage templates & suggestions -------------- */
        case 'stage_suggestions': {
          const registry = await cs.readRegistry()
          const found = detectStageSuggestions(registry, s(args.caseId))
          return clean({ count: found.length, cases: found })
        }
        case 'apply_stage_template': {
          requireIds({ caseId: s(args.caseId), stageId: s(args.stageId) })
          const opts = {
            anchorDate: s(args.anchorDate),
            only: toStringArray(args.only),
            skip: toStringArray(args.skip),
          }
          const caseId = args.caseId as string
          const stageId = args.stageId as string
          const plan = args.dryRun === true
            ? await planStageExpansion(cs, caseId, stageId, { ...opts, dryRun: true })
            : await applyStageExpansion(cs, caseId, stageId, opts)
          return clean(plan)
        }
        case 'case_health': {
          const healthOpts = {
            deadlines: deps.deadlines === undefined
              ? undefined
              : async (id: string) => await deps.deadlines!(id),
          }
          const caseId = s(args.caseId)
          if (caseId !== undefined) {
            const record = await cs.readCase(caseId)
            if (record === undefined) return { error: `case not found: ${caseId}` }
            return clean(await computeCaseHealth(record, healthOpts))
          }
          const registry = await cs.readRegistry()
          const rows = await computeRegistryHealth(registry, {
            ...healthOpts,
            includeClosed: args.includeClosed === true,
          })
          return clean({ count: rows.length, cases: rows })
        }

        /* ---------------------------- cases ----------------------------- */
        case 'register_case': {
          const input: Record<string, unknown> = {
            name: s(args.name), type: s(args.type), cause: s(args.cause),
            status: s(args.status), court: s(args.court), judge: s(args.judge),
            level: s(args.level), claimAmount: s(args.claimAmount),
            filingDate: s(args.filingDate), ourSide: s(args.ourSide),
            caseNumber: s(args.caseNumber), summary: s(args.summary),
          }
          if (args.parties !== undefined) input.parties = clean(normalizeParties(args.parties))
          const record = await cs.registerCase(input)
          return { caseId: record.caseId, name: record.name, ok: true }
        }
        case 'update_case': {
          requireIds({ caseId: s(args.caseId) })
          const patch: Record<string, unknown> = {}
          for (const key of ['name', 'type', 'cause', 'status', 'court', 'judge', 'level', 'claimAmount', 'filingDate', 'ourSide', 'caseNumber', 'summary', 'folder'] as const) {
            const value = s(args[key])
            if (value !== undefined) patch[key] = value
          }
          if (args.parties !== undefined) patch.parties = clean(normalizeParties(args.parties))
          const record = await cs.updateCase(args.caseId as string, patch)
          // 同回合钩子：更新 status 时内联返回阶段推进建议，让管家在同一轮
          // 对话里就能接着问用户「要不要展开下一阶段」，不必等下一次体检。
          if (args.status !== undefined) {
            const registry = await cs.readRegistry()
            const found = detectStageSuggestions(registry, args.caseId as string)[0]
            return clean({ caseId: record.caseId, ok: true, stageSuggestions: found?.suggestions ?? [] })
          }
          return { caseId: record.caseId, ok: true }
        }
        case 'delete_case': {
          requireIds({ caseId: s(args.caseId) })
          await cs.deleteCase(args.caseId as string)
          return clean({ caseId: args.caseId, deleted: true })
        }
        case 'add_keydate': {
          requireIds({ caseId: s(args.caseId), label: s(args.label), date: s(args.date) })
          const record = await cs.addKeyDate(args.caseId as string, args.label as string, args.date as string)
          // Issue 附: return the created keyDateId so the model can toggle it
          // right away (toggle_keydate requires keyDateId) without re-reading.
          const created = (record.keyDates ?? []).at(-1)
          return clean({ caseId: record.caseId, ok: true, keyDateId: created?.id, label: created?.label, date: created?.date })
        }
        case 'toggle_keydate': {
          requireIds({ caseId: s(args.caseId), keyDateId: s(args.keyDateId) })
          const record = await cs.toggleKeyDate(args.caseId as string, args.keyDateId as string)
          return { caseId: record.caseId, ok: true }
        }

        /* ---------------------------- task groups ----------------------- */
        case 'upsert_group': {
          requireIds({ caseId: s(args.caseId) })
          const group: Record<string, unknown> = {}
          if (args.groupId !== undefined) group.id = String(args.groupId)
          if (args.groupName !== undefined) group.name = String(args.groupName)
          const record = await cs.upsertTaskGroup(args.caseId as string, group)
          return { caseId: record.caseId, ok: true }
        }
        case 'delete_group': {
          requireIds({ caseId: s(args.caseId), groupId: s(args.groupId) })
          await cs.deleteTaskGroup(args.caseId as string, args.groupId as string)
          return { ok: true }
        }

        /* ------------------------------ tasks --------------------------- */
        case 'upsert_task': {
          requireIds({ caseId: s(args.caseId), groupId: s(args.groupId) })
          const task: Record<string, unknown> = {}
          if (args.taskId !== undefined) task.id = String(args.taskId)
          if (args.taskTitle !== undefined) task.title = String(args.taskTitle)
          if (args.deadline !== undefined) task.deadline = String(args.deadline)
          if (args.priority !== undefined) task.priority = String(args.priority)
          if (args.status !== undefined) task.status = String(args.status)
          const record = await cs.upsertTask(args.caseId as string, args.groupId as string, task)
          return { caseId: record.caseId, ok: true }
        }
        case 'delete_task': {
          requireIds({ caseId: s(args.caseId), groupId: s(args.groupId), taskId: s(args.taskId) })
          await cs.deleteTask(args.caseId as string, args.groupId as string, args.taskId as string)
          return { ok: true }
        }
        case 'set_task_keydate': {
          requireIds({ caseId: s(args.caseId), groupId: s(args.groupId), taskId: s(args.taskId) })
          if (typeof args.enabled !== 'boolean') throw new Error('enabled (boolean) is required')
          const record = await cs.setTaskKeyDate(args.caseId as string, args.groupId as string, args.taskId as string, args.enabled)
          return { caseId: record.caseId, ok: true, enabled: args.enabled }
        }
        case 'move_task': {
          requireIds({ caseId: s(args.caseId), taskId: s(args.taskId), toGroupId: s(args.toGroupId) })
          await cs.moveTask(args.caseId as string, args.taskId as string, args.toGroupId as string)
          return { ok: true }
        }

        /* ---------------------------- subtasks -------------------------- */
        case 'upsert_subtask': {
          requireIds({ caseId: s(args.caseId), groupId: s(args.groupId), taskId: s(args.taskId) })
          const subtask: Record<string, unknown> = {}
          if (args.subtaskId !== undefined) subtask.id = String(args.subtaskId)
          if (args.subtaskTitle !== undefined) subtask.title = String(args.subtaskTitle)
          const record = await cs.upsertSubtask(args.caseId as string, args.groupId as string, args.taskId as string, subtask)
          return { caseId: record.caseId, ok: true }
        }
        case 'delete_subtask': {
          requireIds({ caseId: s(args.caseId), groupId: s(args.groupId), taskId: s(args.taskId), subtaskId: s(args.subtaskId) })
          await cs.deleteSubtask(args.caseId as string, args.groupId as string, args.taskId as string, args.subtaskId as string)
          return { ok: true }
        }
        case 'upsert_check': {
          requireIds({ caseId: s(args.caseId), groupId: s(args.groupId), taskId: s(args.taskId) })
          const item: Record<string, unknown> = {}
          if (args.checklistId !== undefined) item.id = String(args.checklistId)
          if (args.checklistText !== undefined) item.text = String(args.checklistText)
          const record = await cs.upsertChecklist(args.caseId as string, args.groupId as string, args.taskId as string, item)
          return { caseId: record.caseId, ok: true }
        }
        case 'toggle_check': {
          requireIds({ caseId: s(args.caseId), groupId: s(args.groupId), taskId: s(args.taskId), checklistId: s(args.checklistId) })
          const record = await cs.toggleChecklist(args.caseId as string, args.groupId as string, args.taskId as string, args.checklistId as string)
          return { caseId: record.caseId, ok: true }
        }

        /* ---------------------------- timeline -------------------------- */
        case 'upsert_event': {
          requireIds({ caseId: s(args.caseId) })
          const event: Record<string, unknown> = {
            caseId: String(args.caseId),
            title: s(args.title),
            date: s(args.date),
            type: s(args.eventType) ?? 'case_event',
            detail: s(args.detail),
            status: s(args.status) ?? 'pending',
          }
          if (args.eventId !== undefined) event.id = String(args.eventId)
          const created = await ts.upsertEvent(event)
          return { eventId: created.id, ok: true }
        }
        case 'toggle_event': {
          requireIds({ eventId: s(args.eventId) })
          const updated = await ts.toggleEvent(args.eventId as string)
          return { eventId: updated.id, status: updated.status, ok: true }
        }
        case 'delete_event': {
          requireIds({ eventId: s(args.eventId) })
          await ts.deleteEvent(args.eventId as string)
          return { deleted: true }
        }

        default:
          throw new Error(`unhandled action: ${action}`)
      }
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `litigation: ${String(args.action)}${args.caseId !== undefined ? ` ${String(args.caseId)}` : ''}`,
    }),
  }))
}

/**
 * Agent-plane (preset) registration: the same `litigation` tool, but its
 * execute calls the host's HTTP route family (/api/agentlex-case/*) instead
 * of touching stores directly. Used when the plugin is mounted as a row of an
 * agent preset's agent.cordis.yml — no host services are available there.
 */
export function registerLitigationHttpTool(ctx: Context): () => void {
  // Base URL is resolved lazily on each execute: the agent-preset context may
  // not expose webServer at registration time (and DSH_WEB_URL may not be set
  // until the web shell publishes it). Registering must never throw just
  // because the host origin isn't resolvable yet.
  return ctx.tools.register(defineTool({
    name: 'litigation',
    description: DESCRIPTION,
    parameters: PARAMETERS,
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
      if (route === undefined) throw new Error(`no route for action: ${action}`)
      const body = buildBody(action, args)
      const data = await api(body, resolveHostBaseUrl(ctx))
      return clean(route.map ? route.map(data) : data)
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `litigation: ${String(args.action)}${args.caseId !== undefined ? ` ${String(args.caseId)}` : ''}`,
    }),
  }))
}

/** Resolve the litigation host's own base URL for node-side fetches. */
function resolveHostBaseUrl(ctx: Context): string {
  // Prefer the live webServer service port; DSH_WEB_URL can be stale (e.g.
  // pointing at 3080 while the actual web shell is on 3081).
  const server = ctx.get('webServer') as { port?: number } | undefined
  if (server !== undefined && server.port !== undefined) {
    return `http://127.0.0.1:${String(server.port)}`
  }
  const fromEnv = process.env.DSH_WEB_URL
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv.replace(/\/+$/, '')
  throw new Error('litigation: cannot resolve host base URL (no webServer service)')
}

/** One host route call: POST /api/agentlex-case/<route> and unwrap the envelope. */
async function api(body: Record<string, unknown>, baseUrl: string): Promise<unknown> {
  const path = String(body.route ?? 'read')
  const { route: _omit, ...payload } = body
  let response: Response
  try {
    response = await fetch(`${baseUrl}/api/agentlex-case/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch (error) {
    throw new Error(`litigation host unreachable: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`litigation host HTTP ${response.status}: ${text || 'request failed'}`)
  }
  const envelope = await response.json() as { success: boolean; data?: unknown; error?: string }
  if (!envelope.success) throw new Error(envelope.error ?? `request failed (${response.status})`)
  return envelope.data
}

/** action → { route, map? } where map transforms the raw route data. */
const HTTP_ROUTE: Record<Action, { route: string; map?: (data: unknown) => unknown }> = {
  list_cases: {
    route: 'read',
    map: (data) => {
      const registry = data as { cases: Record<string, { caseId: string; name: string; type: string; status?: string; court?: string; level?: string; updatedAt?: string }> }
      const summary = Object.values(registry.cases).map((c) => ({
        caseId: c.caseId, name: c.name, type: c.type, status: c.status,
        court: c.court, level: c.level, updatedAt: c.updatedAt,
      }))
      return { count: summary.length, cases: summary }
    },
  },
  get_case: { route: 'read-case', map: (data) => ({ case: data }) },
  list_events: { route: 'events' },
  deadlines: { route: 'deadlines' },
  register_case: { route: 'register-case' },
  update_case: { route: 'update-case' },
  delete_case: { route: 'delete-case' },
  add_keydate: { route: 'add-keydate' },
  toggle_keydate: { route: 'toggle-keydate' },
  upsert_group: { route: 'group' },
  delete_group: { route: 'delete-group' },
  upsert_task: { route: 'task' },
  delete_task: { route: 'delete-task' },
  move_task: { route: 'move-task' },
  set_task_keydate: { route: 'set-task-keydate' },
  upsert_subtask: { route: 'subtask' },
  delete_subtask: { route: 'delete-subtask' },
  upsert_check: { route: 'checklist' },
  toggle_check: { route: 'check' },
  upsert_event: { route: 'event' },
  toggle_event: { route: 'toggle-event' },
  delete_event: { route: 'delete-event' },
  apply_stage_template: { route: 'stage-template' },
  stage_suggestions: { route: 'stage-suggestions' },
  case_health: { route: 'case-health' },
}

/** Build the request payload (route + action fields) for an action. */
function buildBody(action: Action, args: Record<string, unknown>): Record<string, unknown> {
  const route = HTTP_ROUTE[action].route
  const s = (v: unknown): string | undefined => (v === undefined || v === null) ? undefined : String(v)
  const body: Record<string, unknown> = { route }
  switch (action) {
    case 'list_cases': case 'list_events':
      if (args.caseId !== undefined) body.caseId = s(args.caseId)
      return body
    case 'deadlines':
      if (args.caseId !== undefined) body.caseId = s(args.caseId)
      if (typeof args.includeOverdue === 'boolean') body.includeOverdue = args.includeOverdue
      return body
    case 'register_case':
      for (const key of ['name', 'type', 'cause', 'status', 'court', 'judge', 'level', 'claimAmount', 'filingDate', 'ourSide', 'caseNumber', 'summary', 'folder'] as const) {
        const value = s(args[key])
        if (value !== undefined) body[key] = value
      }
      if (args.parties !== undefined) body.parties = clean(normalizeParties(args.parties))
      return body
    case 'get_case': case 'update_case': case 'delete_case':
    case 'add_keydate': case 'toggle_keydate':
      body.caseId = s(args.caseId)
      if (args.keyDateId !== undefined) body.keyDateId = s(args.keyDateId)
      if (args.label !== undefined) body.label = s(args.label)
      if (args.date !== undefined) body.date = s(args.date)
      if (action === 'update_case') {
        for (const key of ['name', 'type', 'cause', 'status', 'court', 'judge', 'level', 'claimAmount', 'filingDate', 'ourSide', 'caseNumber', 'summary', 'folder'] as const) {
          const value = s(args[key])
          if (value !== undefined) body[key] = value
        }
        if (args.parties !== undefined) body.parties = clean(normalizeParties(args.parties))
      }
      return body
    case 'upsert_group': case 'delete_group':
      body.caseId = s(args.caseId)
      if (args.groupId !== undefined) body.groupId = s(args.groupId)
      if (args.groupName !== undefined) body.name = s(args.groupName)
      return body
    case 'apply_stage_template': case 'stage_suggestions': case 'case_health':
      if (args.caseId !== undefined) body.caseId = s(args.caseId)
      if (action === 'case_health' && typeof args.includeClosed === 'boolean') {
        body.includeClosed = args.includeClosed
      }
      if (action === 'apply_stage_template') {
        if (args.stageId !== undefined) body.stageId = s(args.stageId)
        if (args.anchorDate !== undefined) body.anchorDate = s(args.anchorDate)
        if (typeof args.dryRun === 'boolean') body.dryRun = args.dryRun
        const only = toStringArray(args.only)
        if (only !== undefined) body.only = only
        const skip = toStringArray(args.skip)
        if (skip !== undefined) body.skip = skip
      }
      return body
    case 'upsert_task': case 'delete_task':
      body.caseId = s(args.caseId)
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
      body.caseId = s(args.caseId)
      body.taskId = s(args.taskId)
      body.toGroupId = s(args.toGroupId)
      return body
    case 'set_task_keydate':
      body.caseId = s(args.caseId)
      body.groupId = s(args.groupId)
      body.taskId = s(args.taskId)
      body.enabled = Boolean(args.enabled)
      return body
    case 'upsert_subtask': case 'delete_subtask': case 'toggle_check': case 'upsert_check':
      body.caseId = s(args.caseId)
      body.groupId = s(args.groupId)
      body.taskId = s(args.taskId)
      if (args.subtaskId !== undefined) body.subtaskId = s(args.subtaskId)
      if (args.checklistId !== undefined) body.checklistId = s(args.checklistId)
      if (args.subtaskTitle !== undefined) body.title = s(args.subtaskTitle)
      if (args.checklistText !== undefined) body.text = s(args.checklistText)
      return body
    case 'upsert_event':
      body.caseId = s(args.caseId)
      if (args.eventId !== undefined) body.id = s(args.eventId)
      if (args.title !== undefined) body.title = s(args.title)
      if (args.date !== undefined) body.date = s(args.date)
      if (args.eventType !== undefined) body.type = s(args.eventType)
      if (args.detail !== undefined) body.detail = s(args.detail)
      if (args.status !== undefined) body.status = s(args.status)
      return body
    case 'toggle_event': case 'delete_event':
      if (args.eventId !== undefined) body.eventId = s(args.eventId)
      return body
    default:
      return body
  }
}
