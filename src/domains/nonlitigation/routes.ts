import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context, Events } from '@deepseek-ai/cordis'
import { importFromAgentLex } from './import/import-agentlex.ts'
import type { ProjectStore } from './store/project-store.ts'
import type { ServiceStore } from './store/service-store.ts'
import type { ApiResponse } from './store/types.ts'
import type { ItemStore } from '../item/store/item-store.ts'
import { registerLegacyCompatRoutes } from './legacy-compat.ts'
import { applyStageExpansion, detectStageSuggestions, planStageExpansion } from './stage-expansion.ts'
import { computeProjectHealth, computeRegistryHealth } from './health.ts'
import { hydrateProjectTaskGroups, hydrateRegistryProjectTaskGroups } from './project-task-view.ts'

export interface RouteDeps {
  projectStore: ProjectStore
  serviceStore: ServiceStore
  /** Absolute data directory used as the module DSH workspace. */
  dataDir: string
  /** 统一事项 store —— 任务/事件/任务组写统一事项（v0.1.27 统一事项模型）。 */
  itemStore?: ItemStore
}

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

function sendJson(res: ServerResponse, status: number, body: ApiResponse): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function ok<T>(res: ServerResponse, data: T): void {
  sendJson(res, 200, { success: true, data })
}

function fail(res: ServerResponse, error: unknown, status = 400): void {
  const message = error instanceof Error ? error.message : String(error)
  sendJson(res, status, { success: false, error: message })
}

export function makeRoutes(ctx: Context, deps: RouteDeps): () => void {
  const disposers: Array<() => void> = []
  /** 同一 kind:exact 路径注册两次会让宿主启动崩溃，主动拦截并报出冲突路径。 */
  const registeredPaths = new Set<string>()

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

  /* ------------------- live-refresh SSE event bridge ------------------- */
  // Every store write broadcasts the host `agentlex:registry-changed` cordis
  // event; DSH does not bridge host events to the browser, so this SSE
  // endpoint forwards them to the client EventSource (which re-dispatches
  // the window CustomEvent the panels listen for).
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
    path: '/api/agentlex-nonlitigation/events-stream',
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

  route('/api/agentlex-nonlitigation/health', (_d, _b, res) => {
    ok(res, { ok: true, plugin: 'dsh-legal-suite/nonlitigation', status: 'ready' })
  })
  route('/api/agentlex-nonlitigation/data-dir', (d, _b, res) => {
    ok(res, { dataDir: d.dataDir })
  })

  // projects
  route('/api/agentlex-nonlitigation/projects', async (d, _b, res) => {
    const registry = await d.projectStore.readRegistry()
    if (d.itemStore !== undefined) {
      ok(res, await hydrateRegistryProjectTaskGroups(registry, d.itemStore))
      return
    }
    ok(res, registry)
  })
  route('/api/agentlex-nonlitigation/project', async (d, b, res) => {
    const id = String(b.projectId ?? '')
    if (id === '') return fail(res, 'projectId required')
    const rec = await d.projectStore.readProject(id)
    if (rec === undefined) return fail(res, `project not found: ${id}`, 404)
    if (d.itemStore !== undefined) {
      ok(res, await hydrateProjectTaskGroups(rec, d.itemStore))
      return
    }
    ok(res, rec)
  })
  route('/api/agentlex-nonlitigation/register-project', async (d, b, res) => {
    ok(res, await d.projectStore.registerProject(b))
  })
  route('/api/agentlex-nonlitigation/update-project', async (d, b, res) => {
    const id = String(b.projectId ?? '')
    if (id === '') return fail(res, 'projectId required')
    const { projectId: _omit, ...patch } = b
    const record = await d.projectStore.updateProject(id, patch)
    // 同回合钩子：status 被更新时内联返回阶段推进建议（见 stage-expansion.ts）。
    // 任务组从 items 重建（registry taskGroups 下岗，0.2.2）。
    if (patch.status !== undefined) {
      const [registry, services] = await Promise.all([
        d.projectStore.readRegistry(),
        d.serviceStore.listServices(),
      ])
      const hydrated = d.itemStore !== undefined
        ? await hydrateRegistryProjectTaskGroups(registry, d.itemStore)
        : registry
      const found = detectStageSuggestions(hydrated, services, id)[0]
      ok(res, { ...record, stageSuggestions: found?.suggestions ?? [] })
    } else {
      ok(res, record)
    }
  })
  route('/api/agentlex-nonlitigation/delete-project', async (d, b, res) => {
    const id = String(b.projectId ?? '')
    if (id === '') return fail(res, 'projectId required')
    // 级联删除：项目 + items（任务/事件）+ task-groups（备忘录 #3）。
    if (d.itemStore !== undefined) {
      const { cascadeDeleteProject } = await import('../litigation/cascade-delete.ts')
      ok(res, await cascadeDeleteProject(d.projectStore, d.itemStore, id))
      return
    }
    ok(res, await d.projectStore.deleteProject(id))
  })
  route('/api/agentlex-nonlitigation/group', async (d, b, res) => {
    const id = String(b.projectId ?? '')
    if (id === '') return fail(res, 'projectId required')
    // Transport spells the upsert id as `groupId`; store/browser use `id`.
    const { projectId: _omit, groupId, name, title, ...rest } = b
    if (d.itemStore !== undefined) {
      const input: Record<string, unknown> = { ownerId: id, ownerType: 'nonlitigation', ...rest }
      if (groupId !== undefined) input.id = String(groupId)
      const gname = name !== undefined ? String(name) : title !== undefined ? String(title) : undefined
      if (gname !== undefined) input.name = gname
      const created = await d.itemStore.upsertGroup(input as Parameters<ItemStore['upsertGroup']>[0])
      ok(res, { projectId: id, ok: true, ...created })
      return
    }
    const group: Record<string, unknown> = { ...rest }
    if (groupId !== undefined) group.id = String(groupId)
    if (name !== undefined) group.name = String(name)
    ok(res, await d.projectStore.upsertTaskGroup(id, group))
  })
  route('/api/agentlex-nonlitigation/delete-group', async (d, b, res) => {
    const id = String(b.projectId ?? '')
    const groupId = String(b.groupId ?? '')
    if (id === '' || groupId === '') return fail(res, 'projectId/groupId required')
    if (d.itemStore !== undefined) {
      ok(res, await d.itemStore.deleteGroup(groupId))
      return
    }
    ok(res, await d.projectStore.deleteTaskGroup(id, groupId))
  })
  route('/api/agentlex-nonlitigation/reorder-groups', async (d, b, res) => {
    const id = String(b.projectId ?? '')
    const orderedIds = Array.isArray(b.orderedIds) ? (b.orderedIds as unknown[]).map(String) : []
    if (id === '' || orderedIds.length === 0) return fail(res, 'projectId/orderedIds required')
    if (d.itemStore !== undefined) {
      const groups = await d.itemStore.listGroups(id)
      const byId = new Map(groups.map((g) => [g.id, g]))
      for (let i = 0; i < orderedIds.length; i++) {
        const g = byId.get(orderedIds[i])
        if (g !== undefined && g.order !== i) await d.itemStore.upsertGroup({ id: g.id, order: i })
      }
      ok(res, { ok: true })
      return
    }
    ok(res, await d.projectStore.reorderTaskGroups(id, orderedIds))
  })
  route('/api/agentlex-nonlitigation/task', async (d, b, res) => {
    const id = String(b.projectId ?? '')
    const gid = String(b.groupId ?? '')
    if (id === '' || gid === '') return fail(res, 'projectId/groupId required')
    // 统一事项模型：任务写到 items.json（type=task，ownerType=nonlitigation）。
    if (d.itemStore !== undefined) {
      const title = String(b.title ?? b.taskTitle ?? '新事项')
      const groupName = (await d.itemStore.listGroups(id)).find((g) => g.id === gid)?.name
      const created = await d.itemStore.upsertItem({
        ownerId: id,
        ownerType: 'nonlitigation',
        type: 'task',
        title,
        date: b.deadline === undefined ? undefined : String(b.deadline),
        time: b.time === undefined ? undefined : String(b.time),
        priority: (b.priority as never) ?? 'medium',
        status: (b.status === 'done' ? 'done' : b.status === 'doing' || b.status === 'in_progress' ? 'doing' : b.status === 'todo' ? 'pending' : undefined) as never,
        groupId: gid || undefined,
        groupName,
        templateTitle: title,
        ...(b.taskId !== undefined ? { id: String(b.taskId) } : {}),
      })
      return ok(res, { id: created.id, projectId: id, groupId: gid, ok: true })
    }
    const { projectId: _omit, groupId: _g, taskId: _t, ...task } = b
    ok(res, await d.projectStore.upsertTask(id, gid, { ...task, ...(b.taskId !== undefined ? { id: String(b.taskId) } : {}) }))
  })
  route('/api/agentlex-nonlitigation/delete-task', async (d, b, res) => {
    const id = String(b.projectId ?? '')
    const gid = String(b.groupId ?? '')
    const taskId = String(b.taskId ?? '')
    if (id === '' || gid === '' || taskId === '') return fail(res, 'projectId/groupId/taskId required')
    if (d.itemStore !== undefined) {
      return ok(res, await d.itemStore.deleteItem(taskId))
    }
    ok(res, await d.projectStore.deleteTask(id, gid, taskId))
  })
  route('/api/agentlex-nonlitigation/move-task', async (d, b, res) => {
    const id = String(b.projectId ?? '')
    const taskId = String(b.taskId ?? '')
    const toGroupId = String(b.toGroupId ?? '')
    if (id === '' || taskId === '' || toGroupId === '') return fail(res, 'projectId/taskId/toGroupId required')
    if (d.itemStore !== undefined) {
      const toGroup = (await d.itemStore.listGroups(id)).find((g) => g.id === toGroupId)
      await d.itemStore.upsertItem({ id: taskId, groupId: toGroupId, groupName: toGroup?.name, ownerId: id, ownerType: 'nonlitigation' })
      ok(res, { ok: true })
      return
    }
    ok(res, await d.projectStore.moveTask(id, taskId, toGroupId, typeof b.index === 'number' ? b.index : undefined))
  })
  route('/api/agentlex-nonlitigation/subtask', async (d, b, res) => {
    const id = String(b.projectId ?? '')
    const taskId = String(b.taskId ?? '')
    if (id === '' || taskId === '') return fail(res, 'projectId/taskId required')
    if (d.itemStore !== undefined) {
      const subtaskId = b.subtaskId === undefined ? undefined : String(b.subtaskId)
      const title = String(b.title ?? b.subtaskTitle ?? '')
      const deadline = b.deadline === undefined ? undefined : String(b.deadline)
      if (subtaskId !== undefined) {
        const updated = await d.itemStore.updateSubtask(taskId, subtaskId, {
          ...(title !== '' ? { title } : {}),
          ...(deadline !== undefined ? { deadline } : {}),
          ...(b.done !== undefined ? { done: b.done === true } : {}),
        })
        ok(res, updated)
        return
      }
      ok(res, await d.itemStore.addSubtask(taskId, { title, deadline }))
      return
    }
    const { projectId: _omit, groupId: _g, taskId: _t, subtaskId, ...subtask } = b
    if (subtaskId !== undefined) subtask.id = String(subtaskId)
    ok(res, await d.projectStore.upsertSubtask(id, String(b.groupId ?? ''), taskId, subtask))
  })
  route('/api/agentlex-nonlitigation/delete-subtask', async (d, b, res) => {
    const id = String(b.projectId ?? '')
    const taskId = String(b.taskId ?? '')
    const subtaskId = String(b.subtaskId ?? '')
    if (id === '' || taskId === '' || subtaskId === '') return fail(res, 'ids required')
    if (d.itemStore !== undefined) {
      ok(res, await d.itemStore.deleteSubtask(taskId, subtaskId))
      return
    }
    ok(res, await d.projectStore.deleteSubtask(id, String(b.groupId ?? ''), taskId, subtaskId))
  })
  route('/api/agentlex-nonlitigation/check', async (d, b, res) => {
    const id = String(b.projectId ?? '')
    const taskId = String(b.taskId ?? '')
    const checklistId = String(b.checklistId ?? '')
    if (id === '' || taskId === '' || checklistId === '') return fail(res, 'ids required')
    if (d.itemStore !== undefined) {
      const done = b.done === undefined ? undefined : b.done === true
      ok(res, await d.itemStore.toggleChecklist(taskId, checklistId, done))
      return
    }
    ok(res, await d.projectStore.toggleChecklist(id, String(b.groupId ?? ''), taskId, checklistId))
  })
  route('/api/agentlex-nonlitigation/add-checklist', async (d, b, res) => {
    const id = String(b.projectId ?? '')
    const taskId = String(b.taskId ?? '')
    const text = String(b.text ?? '')
    if (id === '' || taskId === '' || text === '') return fail(res, 'projectId/taskId/text required')
    if (d.itemStore !== undefined) {
      ok(res, await d.itemStore.addChecklist(taskId, { text }))
      return
    }
    ok(res, await d.projectStore.addChecklistItem(id, String(b.groupId ?? ''), taskId, text))
  })
  route('/api/agentlex-nonlitigation/delete-checklist', async (d, b, res) => {
    const id = String(b.projectId ?? '')
    const taskId = String(b.taskId ?? '')
    const checklistId = String(b.checklistId ?? '')
    if (id === '' || taskId === '' || checklistId === '') return fail(res, 'ids required')
    if (d.itemStore !== undefined) {
      ok(res, await d.itemStore.deleteChecklist(taskId, checklistId))
      return
    }
    ok(res, await d.projectStore.deleteChecklistItem(id, String(b.groupId ?? ''), taskId, checklistId))
  })

  // key dates (常法续约/年审等提醒)
  route('/api/agentlex-nonlitigation/keydate', async (d, b, res) => {
    const id = String(b.projectId ?? '')
    if (id === '') return fail(res, 'projectId required')
    // Transport spells the upsert id as `keyDateId`; store uses `id`.
    const { projectId: _omit, keyDateId, ...keyDate } = b
    if (keyDateId !== undefined) keyDate.id = String(keyDateId)
    ok(res, await d.projectStore.upsertKeyDate(id, keyDate))
  })
  route('/api/agentlex-nonlitigation/toggle-keydate', async (d, b, res) => {
    const id = String(b.projectId ?? '')
    const keyDateId = String(b.keyDateId ?? '')
    if (id === '' || keyDateId === '') return fail(res, 'projectId/keyDateId required')
    ok(res, await d.projectStore.toggleKeyDate(id, keyDateId))
  })
  route('/api/agentlex-nonlitigation/delete-keydate', async (d, b, res) => {
    const id = String(b.projectId ?? '')
    const keyDateId = String(b.keyDateId ?? '')
    if (id === '' || keyDateId === '') return fail(res, 'projectId/keyDateId required')
    ok(res, await d.projectStore.deleteKeyDate(id, keyDateId))
  })

  // import
  route('/api/agentlex-nonlitigation/import', async (d, b, res) => {
    ok(res, await importFromAgentLex(d.projectStore, d.serviceStore, String(b.sourceDir ?? ''), d.itemStore))
  })

  /* ----------------------- stage templates & suggestions -------------- */
  // 阶段模板展开：dryRun=true 只返回计划（预览），否则落库。模板是骨架，
  // only/skip 供管家按项目裁剪；已存在的任务按标题跳过，天然幂等。
  route('/api/agentlex-nonlitigation/stage-template', async (d, b, res) => {
    const projectId = String(b.projectId ?? '')
    const stageId = String(b.stageId ?? '')
    if (projectId === '' || stageId === '') return fail(res, 'projectId/stageId required')
    const opts = {
      anchorDate: b.anchorDate === undefined ? undefined : String(b.anchorDate),
      only: Array.isArray(b.only) ? (b.only as unknown[]).map(String) : undefined,
      skip: Array.isArray(b.skip) ? (b.skip as unknown[]).map(String) : undefined,
    }
    if (b.dryRun === true) {
      ok(res, await planStageExpansion(d.projectStore, projectId, stageId, { ...opts, dryRun: true }, d.itemStore))
    } else {
      ok(res, await applyStageExpansion(d.projectStore, projectId, stageId, opts, d.itemStore))
    }
  })

  // 阶段推进检测：只读。返回每个项目的阶段展开/续约/台账断更/结项建议。
  // 任务组从 items 重建（registry taskGroups 下岗，0.2.2）。
  route('/api/agentlex-nonlitigation/stage-suggestions', async (d, b, res) => {
    const [registry, services] = await Promise.all([
      d.projectStore.readRegistry(),
      d.serviceStore.listServices(),
    ])
    const hydrated = d.itemStore !== undefined
      ? await hydrateRegistryProjectTaskGroups(registry, d.itemStore)
      : registry
    const projects = detectStageSuggestions(
      hydrated,
      services,
      b.projectId === undefined ? undefined : String(b.projectId),
    )
    ok(res, { count: projects.length, projects })
  })

  // 项目体检：信息完整度（按类型与状态动态计算）+ 缺口清单 + 阶段进度 +
  // 台账时效 + 服务期剩余天数 + 建议。传 projectId 单项目，不传则扫描全部。
  // 路径必须是 project-health：`/health` 已被上面的插件健康检查占用，
  // 同一路径注册两次会在启动时崩溃。
  route('/api/agentlex-nonlitigation/project-health', async (d, b, res) => {
    const projectId = b.projectId === undefined ? undefined : String(b.projectId)
    if (projectId !== undefined && projectId !== '') {
      const record = await d.projectStore.readProject(projectId)
      if (record === undefined) return fail(res, `project not found: ${projectId}`, 404)
      const hydrated = d.itemStore !== undefined ? await hydrateProjectTaskGroups(record, d.itemStore) : record
      ok(res, computeProjectHealth(hydrated, await d.serviceStore.listServices()))
      return
    }
    const [registry, services] = await Promise.all([
      d.projectStore.readRegistry(),
      d.serviceStore.listServices(),
    ])
    const hydrated = d.itemStore !== undefined
      ? await hydrateRegistryProjectTaskGroups(registry, d.itemStore)
      : registry
    const projects = computeRegistryHealth(hydrated, services, {
      includeClosed: b.includeClosed === true,
    })
    ok(res, { count: projects.length, projects })
  })

  // services
  route('/api/agentlex-nonlitigation/services', async (d, _b, res) => {
    ok(res, await d.serviceStore.listServices())
  })
  route('/api/agentlex-nonlitigation/service', async (d, b, res) => {
    ok(res, await d.serviceStore.upsertService(b))
  })
  route('/api/agentlex-nonlitigation/delete-service', async (d, b, res) => {
    const id = String(b.id ?? '')
    if (id === '') return fail(res, 'id required')
    ok(res, await d.serviceStore.deleteService(id))
  })

  // 适配器消化：非诉域 legacy 兼容面（/api/agentlex/*）与原生路由共用同一批 store。
  disposers.push(registerLegacyCompatRoutes(ctx, deps))

  return () => {
    for (const dispose of disposers.splice(0)) dispose()
  }
}
