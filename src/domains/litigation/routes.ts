/**
 * Host half route family: /api/agentlex-case/*.
 *
 * All routes are same-origin POST with a JSON body; the browser half's
 * api.ts speaks this shape. Response envelope:
 *   { success: true, data }  |  { success: false, error, hint? }
 *
 * Security: loopback-only binding is enforced by the webServer service's
 * host config; every mutation re-validates ids for path safety; bodies are
 * treated as untrusted and cloned (no prototype pollution).
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context, Events } from '@deepseek-ai/cordis'
import type { CaseStore } from './store/case-store.ts'
import type { TimelineStore } from './store/timeline-store.ts'
import type { ScheduleStore } from './store/schedule-store.ts'
import type { ApiResponse } from './store/types.ts'
import { parseReminderMinutes } from './store/timeline-store.ts'
import { buildFolderTree, downloadFile, expandFolder, openPath, readPreviewFile, searchFolder } from './file-service.ts'
import { registerLegacyCompatRoutes } from './legacy-compat.ts'
import { selfVersion } from './self-version.ts'
import { applyStageExpansion, detectStageSuggestions, planStageExpansion } from './stage-expansion.ts'
import { computeCaseHealth, computeRegistryHealth } from './health.ts'

/** Route prefix for the whole family. */
export const API_PREFIX = '/api/agentlex-case'

/** Services the routes need. */
export interface RouteDeps {
  caseStore: CaseStore
  timelineStore: TimelineStore
  scheduleStore: ScheduleStore
  /** Absolute data directory used as the module DSH workspace. */
  dataDir: string
  /** 统一事项 store —— 任务写统一事项（v0.1.27 统一事项模型）。 */
  itemStore?: import('../item/store/item-store.ts').ItemStore
  /** Announce the deadline engine's per-case summary (M4). */
  deadlines?(caseId?: string, opts?: { includeOverdue?: boolean }): unknown | Promise<unknown>
  /** Import from an AgentLex data directory (M5). */
  importFromAgentLex?(sourceDir: string): Promise<unknown>
  /** Plugin self-update: version check + upgrade via pnpm from the public npm registry. */
  pluginUpdate?: {
    check(): Promise<unknown>
    update(pkgFilter?: string): Promise<unknown>
    /** 更新进度快照（前端轮询）。 */
    status(): Promise<unknown>
    /** 取消正在进行的更新。 */
    cancel(): Promise<unknown>
    /** 一键修复 pnpm 供应链策略（minimumReleaseAge）拦截。 */
    policyFix?(): Promise<unknown>
    /** 重启 DSH 宿主进程（新版本宿主代码生效）。 */
    restart?(): { ok: boolean; scheduled?: boolean }
  }
}

/** Parse the request body as a JSON object (untrusted → {} on failure). */
async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (raw.length === 0) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

/** Send a JSON response with the envelope. */
function sendJson(res: ServerResponse, status: number, body: ApiResponse): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function ok<T>(res: ServerResponse, data: T): void {
  sendJson(res, 200, { success: true, data })
}

function fail(res: ServerResponse, error: unknown, status = 400, hint?: string): void {
  const message = error instanceof Error ? error.message : String(error)
  sendJson(res, status, { success: false, error: message, hint })
}

/**
 * Register the whole /api/agentlex-case route family on the webServer service.
 * @param ctx - host context (webServer injected).
 * @param deps - the stores backing the routes.
 * @returns disposer removing all routes.
 */
export function makeRoutes(ctx: Context, deps: RouteDeps): () => void {
  const disposers: Array<() => void> = []
  /**
   * 已注册路径表：`kind: 'exact'` 的同一路径注册两次会让宿主在启动时直接
   * 崩溃（历史上 /events 与 /events-stream 就踩过）。这里主动拦截并报出冲突
   * 路径，把「启动崩一次且看不出原因」变成「注册时就知道哪一行写重了」。
   */
  const registeredPaths = new Set<string>()

  /** Register one exact route with a handler that reads the body first. */
  function route(path: string, handler: (deps: RouteDeps, body: Record<string, unknown>, res: ServerResponse) => Promise<void> | void): void {
    if (registeredPaths.has(path)) {
      throw new Error(`duplicate route registration: ${path}（同一 kind:exact 路径只能注册一次）`)
    }
    registeredPaths.add(path)
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        try {
          const body = await readBody(req)
          await handler(deps, body, res)
        } catch (error) {
          fail(res, error)
        }
      },
    }))
  }

  /* ------------------------------ health ------------------------------ */
  route(`${API_PREFIX}/health`, (_deps, _body, res) => {
    ok(res, { ok: true, plugin: 'dsh-legal-suite/litigation', status: 'ready' })
  })

  route(`${API_PREFIX}/data-dir`, (d, _b, res) => {
    ok(res, { dataDir: d.dataDir })
  })

  /* ------------------- live-refresh SSE event bridge ------------------- */
  // Every store write (cases/tasks/timeline/schedules) broadcasts the host
  // `agentlex:registry-changed` cordis event; DSH does not bridge arbitrary
  // host events to the browser, so this SSE endpoint forwards them to the
  // client's EventSource, which re-dispatches the window CustomEvent the
  // panels listen for — live refresh without polling. The path is
  // events-stream on purpose: `/api/agentlex-case/events` is the JSON list
  // route (registering both under one path crashed boot with duplicate
  // exact route).
  const sseClients = new Set<ServerResponse>()
  const broadcast = (payload: unknown): void => {
    const data = `data: ${JSON.stringify(payload)}\n\n`
    for (const res of sseClients) {
      try { res.write(data) } catch { /* client gone; cleaned on close */ }
    }
  }
  const onRegistryChanged = (payload: unknown): void => broadcast(payload)
  const disposeRegistryListener = ctx.on('agentlex:registry-changed' as keyof Events, onRegistryChanged)
  disposers.push(() => {
    disposeRegistryListener()
    for (const res of sseClients) { try { res.end() } catch { /* noop */ } }
    sseClients.clear()
  })

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: `${API_PREFIX}/events-stream`,
    handler: (req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      res.write('retry: 3000\n\n')
      sseClients.add(res)
      req.on('close', () => { sseClients.delete(res) })
    },
  }))

  /* ------------------------------- cases ------------------------------ */
  route(`${API_PREFIX}/read`, async (d, _b, res) => {
    ok(res, await d.caseStore.readRegistry())
  })

  route(`${API_PREFIX}/read-case`, async (d, b, res) => {
    const caseId = String(b.caseId ?? '')
    const record = await d.caseStore.readCase(caseId)
    if (record === undefined) return fail(res, `case not found: ${caseId}`, 404)
    ok(res, record)
  })

  route(`${API_PREFIX}/register-case`, async (d, b, res) => {
    ok(res, await d.caseStore.registerCase(b))
  })

  route(`${API_PREFIX}/update-case`, async (d, b, res) => {
    const caseId = String(b.caseId ?? '')
    if (caseId === '') return fail(res, 'caseId required')
    const { caseId: _omit, ...patch } = b
    const record = await d.caseStore.updateCase(caseId, patch)
    // 同回合钩子：status 被更新时，在响应里内联返回阶段推进建议——
    // 调用方（管家/浏览器）在同一轮交互里就能拿到「接下来该展开什么」，
    // 不必等下一次体检。
    if (patch.status !== undefined) {
      const registry = await d.caseStore.readRegistry()
      const found = detectStageSuggestions(registry, caseId)[0]
      ok(res, { ...record, stageSuggestions: found?.suggestions ?? [] })
    } else {
      ok(res, record)
    }
  })

  route(`${API_PREFIX}/delete-case`, async (d, b, res) => {
    const caseId = String(b.caseId ?? '')
    if (caseId === '') return fail(res, 'caseId required')
    ok(res, await d.caseStore.deleteCase(caseId))
  })

  /* ----------------------------- key dates ---------------------------- */
  route(`${API_PREFIX}/add-keydate`, async (d, b, res) => {
    const caseId = String(b.caseId ?? '')
    const label = String(b.label ?? '')
    const date = String(b.date ?? '')
    if (caseId === '' || label === '' || date === '') return fail(res, 'caseId/label/date required')
    ok(res, await d.caseStore.addKeyDate(caseId, label, date))
  })

  route(`${API_PREFIX}/toggle-keydate`, async (d, b, res) => {
    const caseId = String(b.caseId ?? '')
    const keyDateId = String(b.keyDateId ?? '')
    if (caseId === '' || keyDateId === '') return fail(res, 'caseId/keyDateId required')
    ok(res, await d.caseStore.toggleKeyDate(caseId, keyDateId))
  })

  /* --------------------------- task groups ---------------------------- */
  route(`${API_PREFIX}/group`, async (d, b, res) => {
    const caseId = String(b.caseId ?? '')
    if (caseId === '') return fail(res, 'caseId required')
    // The transport spells the upsert id as `groupId` (HTTP tool / curl),
    // while the store and the browser half use the canonical `id`. Accept
    // both so a group update never silently becomes a new group.
    const { caseId: _omit, groupId, ...group } = b
    if (groupId !== undefined) group.id = String(groupId)
    ok(res, await d.caseStore.upsertTaskGroup(caseId, group))
  })

  route(`${API_PREFIX}/delete-group`, async (d, b, res) => {
    const caseId = String(b.caseId ?? '')
    const groupId = String(b.groupId ?? '')
    if (caseId === '' || groupId === '') return fail(res, 'caseId/groupId required')
    ok(res, await d.caseStore.deleteTaskGroup(caseId, groupId))
  })

  route(`${API_PREFIX}/reorder-groups`, async (d, b, res) => {
    const caseId = String(b.caseId ?? '')
    const orderedIds = Array.isArray(b.orderedIds) ? (b.orderedIds as unknown[]).map(String) : []
    if (caseId === '' || orderedIds.length === 0) return fail(res, 'caseId/orderedIds required')
    ok(res, await d.caseStore.reorderTaskGroups(caseId, orderedIds))
  })

  /* ------------------------------- tasks ------------------------------ */
  route(`${API_PREFIX}/task`, async (d, b, res) => {
    const caseId = String(b.caseId ?? '')
    const groupId = String(b.groupId ?? '')
    if (caseId === '' || groupId === '') return fail(res, 'caseId/groupId required')
    // 统一事项模型：任务写到 items.json（type=task）。
    if (d.itemStore !== undefined) {
      const { caseId: _omit, groupId: _g, taskId, taskTitle: _tt, ...rest } = b
      const created = await d.itemStore.upsertItem({
        ownerId: caseId,
        type: 'task',
        title: String(b.title ?? b.taskTitle ?? '新事项'),
        date: b.deadline === undefined ? undefined : String(b.deadline),
        time: b.time === undefined ? undefined : String(b.time),
        priority: (b.priority as never) ?? 'medium',
        // 透传 status（todo/doing/done → pending/doing/done）。
        status: (b.status === 'done' ? 'done' : b.status === 'doing' || b.status === 'in_progress' ? 'doing' : b.status === 'todo' ? 'pending' : undefined) as never,
        groupId: groupId || undefined,
        ...(taskId !== undefined ? { id: String(taskId) } : {}),
      })
      return ok(res, { id: created.id, caseId, groupId, ok: true })
    }
    const { caseId: _omit2, groupId: _g2, taskId: _t2, ...task2 } = b
    ok(res, await d.caseStore.upsertTask(caseId, groupId, { ...task2, ...(b.taskId !== undefined ? { id: String(b.taskId) } : {}) }))
  })

  route(`${API_PREFIX}/delete-task`, async (d, b, res) => {
    const caseId = String(b.caseId ?? '')
    const groupId = String(b.groupId ?? '')
    const taskId = String(b.taskId ?? '')
    if (caseId === '' || groupId === '' || taskId === '') return fail(res, 'caseId/groupId/taskId required')
    if (d.itemStore !== undefined) {
      return ok(res, await d.itemStore.deleteItem(taskId))
    }
    ok(res, await d.caseStore.deleteTask(caseId, groupId, taskId))
  })

  route(`${API_PREFIX}/set-task-keydate`, async (d, b, res) => {
    const caseId = String(b.caseId ?? '')
    const groupId = String(b.groupId ?? '')
    const taskId = String(b.taskId ?? '')
    if (caseId === '' || groupId === '' || taskId === '') return fail(res, 'caseId/groupId/taskId required')
    if (typeof b.enabled !== 'boolean') return fail(res, 'enabled (boolean) required')
    ok(res, await d.caseStore.setTaskKeyDate(caseId, groupId, taskId, b.enabled))
  })

  route(`${API_PREFIX}/move-task`, async (d, b, res) => {
    const caseId = String(b.caseId ?? '')
    const taskId = String(b.taskId ?? '')
    const toGroupId = String(b.toGroupId ?? '')
    if (caseId === '' || taskId === '' || toGroupId === '') return fail(res, 'caseId/taskId/toGroupId required')
    ok(res, await d.caseStore.moveTask(caseId, taskId, toGroupId, typeof b.index === 'number' ? b.index : undefined))
  })

  /* ----------------------------- subtasks ----------------------------- */
  route(`${API_PREFIX}/subtask`, async (d, b, res) => {
    const caseId = String(b.caseId ?? '')
    const groupId = String(b.groupId ?? '')
    const taskId = String(b.taskId ?? '')
    if (caseId === '' || groupId === '' || taskId === '') return fail(res, 'caseId/groupId/taskId required')
    // Transport spells the upsert id as `subtaskId`; store/browser use `id`.
    const { caseId: _omit, groupId: _g, taskId: _t, subtaskId, ...subtask } = b
    if (subtaskId !== undefined) subtask.id = String(subtaskId)
    ok(res, await d.caseStore.upsertSubtask(caseId, groupId, taskId, subtask))
  })

  route(`${API_PREFIX}/delete-subtask`, async (d, b, res) => {
    const caseId = String(b.caseId ?? '')
    const groupId = String(b.groupId ?? '')
    const taskId = String(b.taskId ?? '')
    const subtaskId = String(b.subtaskId ?? '')
    if (caseId === '' || groupId === '' || taskId === '' || subtaskId === '') return fail(res, 'caseId/groupId/taskId/subtaskId required')
    ok(res, await d.caseStore.deleteSubtask(caseId, groupId, taskId, subtaskId))
  })

  route(`${API_PREFIX}/checklist`, async (d, b, res) => {
    const caseId = String(b.caseId ?? '')
    const groupId = String(b.groupId ?? '')
    const taskId = String(b.taskId ?? '')
    if (caseId === '' || groupId === '' || taskId === '') return fail(res, 'caseId/groupId/taskId required')
    // Transport spells the upsert id as `checklistId`; store/browser use `id`.
    const { caseId: _omit, groupId: _g, taskId: _t, checklistId, ...item } = b
    if (checklistId !== undefined) item.id = String(checklistId)
    ok(res, await d.caseStore.upsertChecklist(caseId, groupId, taskId, item))
  })

  route(`${API_PREFIX}/check`, async (d, b, res) => {
    const caseId = String(b.caseId ?? '')
    const groupId = String(b.groupId ?? '')
    const taskId = String(b.taskId ?? '')
    const checklistId = String(b.checklistId ?? '')
    if (caseId === '' || groupId === '' || taskId === '' || checklistId === '') return fail(res, 'caseId/groupId/taskId/checklistId required')
    ok(res, await d.caseStore.toggleChecklist(caseId, groupId, taskId, checklistId))
  })

  /* ------------------------------ timeline ---------------------------- */
  route(`${API_PREFIX}/events`, async (d, b, res) => {
    ok(res, await d.timelineStore.listEvents(b.caseId === undefined ? undefined : String(b.caseId)))
  })

  route(`${API_PREFIX}/event`, async (d, b, res) => {
    // 统一事项模型：时间轴事件写 items.json（type=event）。
    if (d.itemStore !== undefined) {
      const created = await d.itemStore.upsertItem({
        ownerId: String(b.caseId ?? ''),
        type: 'event',
        title: String(b.title ?? b.label ?? '新事件'),
        date: b.date === undefined ? undefined : String(b.date),
        time: b.time === undefined ? undefined : String(b.time),
        detail: b.detail === undefined ? undefined : String(b.detail),
        status: (b.status as never) ?? 'pending',
        ...(b.eventId !== undefined ? { id: String(b.eventId) } : {}),
      })
      return ok(res, created)
    }
    ok(res, await d.timelineStore.upsertEvent(b as Parameters<TimelineStore['upsertEvent']>[0]))
  })

  route(`${API_PREFIX}/delete-event`, async (d, b, res) => {
    const eventId = String(b.eventId ?? '')
    if (eventId === '') return fail(res, 'eventId required')
    if (d.itemStore !== undefined) {
      return ok(res, await d.itemStore.deleteItem(eventId))
    }
    ok(res, await d.timelineStore.deleteEvent(eventId))
  })

  route(`${API_PREFIX}/toggle-event`, async (d, b, res) => {
    const eventId = String(b.eventId ?? '')
    if (eventId === '') return fail(res, 'eventId required')
    if (d.itemStore !== undefined) {
      return ok(res, await d.itemStore.toggleItem(eventId))
    }
    ok(res, await d.timelineStore.toggleEvent(eventId))
  })

  /* ------------------------------ schedules --------------------------- */
  route(`${API_PREFIX}/schedules`, async (d, b, res) => {
    ok(res, await d.scheduleStore.listItems(b.caseId === undefined ? undefined : String(b.caseId)))
  })

  route(`${API_PREFIX}/schedule`, async (d, b, res) => {
    ok(res, await d.scheduleStore.upsertItem(b as Parameters<ScheduleStore['upsertItem']>[0]))
  })

  route(`${API_PREFIX}/delete-schedule`, async (d, b, res) => {
    const itemId = String(b.itemId ?? '')
    if (itemId === '') return fail(res, 'itemId required')
    ok(res, await d.scheduleStore.deleteItem(itemId))
  })

  route(`${API_PREFIX}/toggle-schedule`, async (d, b, res) => {
    const itemId = String(b.itemId ?? '')
    if (itemId === '') return fail(res, 'itemId required')
    ok(res, await d.scheduleStore.toggleItem(itemId))
  })

  /* ------------------------------ deadlines --------------------------- */
  route(`${API_PREFIX}/deadlines`, async (d, b, res) => {
    if (d.deadlines === undefined) return fail(res, 'deadline engine not mounted', 501)
    ok(res, await d.deadlines(
      b.caseId === undefined ? undefined : String(b.caseId),
      typeof b.includeOverdue === 'boolean' ? { includeOverdue: b.includeOverdue } : undefined,
    ))
  })

  /* ----------------------- stage templates & suggestions -------------- */
  // 阶段模板展开：dryRun=true 只返回计划（预览），否则落库。模板是骨架，
  // only/skip 供管家按案情裁剪；已存在的任务按标题跳过，天然幂等。
  route(`${API_PREFIX}/stage-template`, async (d, b, res) => {
    const caseId = String(b.caseId ?? '')
    const stageId = String(b.stageId ?? '')
    if (caseId === '' || stageId === '') return fail(res, 'caseId/stageId required')
    const opts = {
      anchorDate: b.anchorDate === undefined ? undefined : String(b.anchorDate),
      only: Array.isArray(b.only) ? (b.only as unknown[]).map(String) : undefined,
      skip: Array.isArray(b.skip) ? (b.skip as unknown[]).map(String) : undefined,
    }
    if (b.dryRun === true) {
      ok(res, await planStageExpansion(d.caseStore, caseId, stageId, { ...opts, dryRun: true }))
    } else {
      ok(res, await applyStageExpansion(d.caseStore, caseId, stageId, opts, d.itemStore))
    }
  })

  // 阶段推进检测：只读。返回每个案件的阶段展开/状态推进/信息缺口建议。
  route(`${API_PREFIX}/stage-suggestions`, async (d, b, res) => {
    const registry = await d.caseStore.readRegistry()
    const cases = detectStageSuggestions(
      registry,
      b.caseId === undefined ? undefined : String(b.caseId),
    )
    ok(res, { count: cases.length, cases })
  })

  // 案件体检：信息完整度（按当前阶段动态计算）+ 缺口清单 + 阶段进度 + 建议。
  // 传 caseId 单案件体检；不传则扫描全部（跳过已结案，按完整度升序）。
  // 路径必须是 case-health：`/health` 已被上面的插件健康检查占用，
  // 同一路径注册两次会在启动时崩溃（历史上 /events 就踩过这个坑）。
  route(`${API_PREFIX}/case-health`, async (d, b, res) => {
    const opts = {
      deadlines: d.deadlines === undefined ? undefined : async (caseId: string) => await d.deadlines!(caseId),
    }
    const caseId = b.caseId === undefined ? undefined : String(b.caseId)
    if (caseId !== undefined && caseId !== '') {
      const record = await d.caseStore.readCase(caseId)
      if (record === undefined) return fail(res, `case not found: ${caseId}`, 404)
      ok(res, await computeCaseHealth(record, opts))
      return
    }
    const registry = await d.caseStore.readRegistry()
    const cases = await computeRegistryHealth(registry, {
      ...opts,
      includeClosed: b.includeClosed === true,
    })
    ok(res, { count: cases.length, cases })
  })

  /* ------------------------------- import ----------------------------- */
  route(`${API_PREFIX}/import-agentlex`, async (d, b, res) => {
    if (d.importFromAgentLex === undefined) return fail(res, 'import not mounted', 501)
    const sourceDir = b.sourceDir === undefined ? undefined : String(b.sourceDir)
    ok(res, await d.importFromAgentLex(sourceDir ?? ''))
  })

  /* --------------------------- case folder file service ----------------- */
  route(`${API_PREFIX}/folder-tree`, async (_d, b, res) => {
    const root = String(b.path ?? '')
    if (root === '') return fail(res, 'path required')
    ok(res, await buildFolderTree(root))
  })

  route(`${API_PREFIX}/folder-expand`, async (_d, b, res) => {
    const root = String(b.path ?? '')
    const dir = String(b.dir ?? '')
    if (root === '' || dir === '') return fail(res, 'path/dir required')
    ok(res, await expandFolder(root, dir))
  })

  route(`${API_PREFIX}/folder-search`, async (_d, b, res) => {
    const root = String(b.path ?? '')
    const query = String(b.query ?? '')
    if (root === '' || query === '') return fail(res, 'path/query required')
    ok(res, await searchFolder(root, query))
  })

  route(`${API_PREFIX}/file-preview`, async (_d, b, res) => {
    const root = String(b.path ?? '')
    const file = String(b.file ?? '')
    if (root === '' || file === '') return fail(res, 'path/file required')
    ok(res, await readPreviewFile(root, file))
  })

  route(`${API_PREFIX}/file-download`, async (_d, b, res) => {
    const root = String(b.path ?? '')
    const file = String(b.file ?? '')
    if (root === '' || file === '') return fail(res, 'path/file required')
    ok(res, await downloadFile(root, file))
  })

  route(`${API_PREFIX}/open-path`, async (_d, b, res) => {
    const root = String(b.path ?? '')
    const file = b.file === undefined ? undefined : String(b.file)
    const kind = b.kind === 'finder' ? 'finder' : 'default'
    if (root === '') return fail(res, 'path required')
    openPath(root, file, kind)
    ok(res, { ok: true })
  })

  /* --------------------------- reminder helper ------------------------ */
  route(`${API_PREFIX}/parse-reminder`, async (_d, b, res) => {
    ok(res, { minutes: parseReminderMinutes(b.value as string | number) })
  })

  /* --------------------------- self version --------------------------- */
  // POST /api/agentlex-case/self-version —— 当前运行版本（轻量、零网络开销）。
  //   服务端模块加载时读取安装目录 package.json 并缓存：进程跑哪份代码就返回
  //   哪个版本，更新重启后自动跟随；构建期 __PLUGIN_VERSION__ 仅作客户端兜底。
  route(`${API_PREFIX}/self-version`, async (_d, _b, res) => {
    ok(res, { version: selfVersion() })
  })

  /* --------------------------- plugin update -------------------------- */
  // POST /api/agentlex-case/plugin-version —— 检测当前安装版本与 registry 最新版。
  // POST /api/agentlex-case/plugin-update —— 拉取最新 tarball 并替换安装目录
  //   （body 可带 { pkg } 只更新单包；更新完成后需重启 DSH 生效）。
  route(`${API_PREFIX}/plugin-version`, async (d, _b, res) => {
    if (d.pluginUpdate === undefined) return fail(res, 'plugin updater not mounted', 501)
    ok(res, await d.pluginUpdate.check())
  })

  route(`${API_PREFIX}/plugin-update`, async (d, b, res) => {
    if (d.pluginUpdate === undefined) return fail(res, 'plugin updater not mounted', 501)
    const pkg = b.pkg === undefined ? undefined : String(b.pkg)
    ok(res, await d.pluginUpdate.update(pkg))
  })

  // POST /api/agentlex-case/plugin-update-status —— 更新进度快照（阶段/包/字节/步骤）。
  // POST /api/agentlex-case/plugin-update-cancel —— 取消进行中的更新（下载中止、余包跳过）。
  route(`${API_PREFIX}/plugin-update-status`, async (d, _b, res) => {
    if (d.pluginUpdate === undefined) return fail(res, 'plugin updater not mounted', 501)
    ok(res, await d.pluginUpdate.status())
  })

  route(`${API_PREFIX}/plugin-update-cancel`, async (d, _b, res) => {
    if (d.pluginUpdate === undefined) return fail(res, 'plugin updater not mounted', 501)
    ok(res, await d.pluginUpdate.cancel())
  })

  // POST /api/agentlex-case/plugin-policy-fix —— 一键修复 pnpm 供应链策略
  //   （minimumReleaseAge）拦截：把最近一次 pnpm 报错中被拦的 pkg@version
  //   追加进 profile pnpm-workspace.yaml 的 minimumReleaseAgeExclude。
  route(`${API_PREFIX}/plugin-policy-fix`, async (d, _b, res) => {
    if (d.pluginUpdate === undefined) return fail(res, 'plugin updater not mounted', 501)
    if (d.pluginUpdate.policyFix === undefined) return fail(res, 'policy fix not mounted', 501)
    ok(res, await d.pluginUpdate.policyFix())
  })

  // POST /api/agentlex-case/plugin-restart —— 重启 DSH 宿主进程（新版本宿主代码
  //   在启动时加载）。参考 dsh-bridge：守护进程退出后拉起 / 派生子进程接管。
  route(`${API_PREFIX}/plugin-restart`, async (d, _b, res) => {
    if (d.pluginUpdate === undefined || d.pluginUpdate.restart === undefined) {
      return fail(res, 'plugin restart not mounted', 501)
    }
    ok(res, d.pluginUpdate.restart())
  })

  // 适配器消化：诉讼域 legacy 兼容面（/api/agentlex/*）与原生路由共用同一批 store。
  disposers.push(registerLegacyCompatRoutes(ctx, deps))

  return () => { for (const dispose of disposers) dispose() }
}
