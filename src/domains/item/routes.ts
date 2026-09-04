/**
 * 统一事项域 — REST 路由。
 *
 * /api/agentlex-item/* CRUD + 任务组 CRUD。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { ItemStore } from './store/item-store.ts'
import type { ApiResponse } from './store/types.ts'
import { buildLegacyTaskGroupsFromStore, itemToLegacyTask, itemToTimelineEvent } from './shape.ts'

export interface RouteDeps {
  itemStore: ItemStore
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

  function route(path: string, handler: (deps: RouteDeps, body: Record<string, unknown>, res: ServerResponse) => Promise<void> | void): void {
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

  route('/api/agentlex-item/health', (_d, _b, res) => {
    ok(res, { ok: true, plugin: 'dsh-legal-suite/item', status: 'ready' })
  })

  /* ------------------------------ items ------------------------------ */
  route('/api/agentlex-item/items', async (d, b, res) => {
    const ownerId = b.ownerId === undefined ? undefined : String(b.ownerId)
    ok(res, await d.itemStore.listItems(ownerId))
  })

  route('/api/agentlex-item/item', async (d, b, res) => {
    const { itemId, ...input } = b
    if (itemId !== undefined) input.id = String(itemId)
    ok(res, await d.itemStore.upsertItem(input))
  })

  route('/api/agentlex-item/delete-item', async (d, b, res) => {
    const id = String(b.id ?? '')
    if (id === '') return fail(res, 'id required')
    ok(res, await d.itemStore.deleteItem(id))
  })

  route('/api/agentlex-item/toggle-item', async (d, b, res) => {
    const id = String(b.id ?? '')
    if (id === '') return fail(res, 'id required')
    ok(res, await d.itemStore.toggleItem(id))
  })

  /* --------------------------- task groups --------------------------- */
  route('/api/agentlex-item/groups', async (d, b, res) => {
    const ownerId = b.ownerId === undefined ? undefined : String(b.ownerId)
    ok(res, await d.itemStore.listGroups(ownerId))
  })

  route('/api/agentlex-item/group', async (d, b, res) => {
    const { groupId, ...input } = b
    if (groupId !== undefined) input.id = String(groupId)
    ok(res, await d.itemStore.upsertGroup(input))
  })

  route('/api/agentlex-item/delete-group', async (d, b, res) => {
    const id = String(b.id ?? '')
    if (id === '') return fail(res, 'id required')
    ok(res, await d.itemStore.deleteGroup(id))
  })

  /* ------------------- legacy 聚合（从 items 生成旧形状） ------------------- */
  // 供 /api/agentlex/read 聚合调用：把统一事项转成旧渲染层的 timeline + taskGroups。
  // 这是「数据源统一」的桥：现有组件暂时读旧形状，但数据来自 items.json
  // （0.2.2：组壳也来自同一文件，唯一真相源 = items.json）。
  route('/api/agentlex-item/legacy', async (d, _b, res) => {
    const items = await d.itemStore.listItems()
    const groups = await d.itemStore.listGroups()
    // timeline = type 为 event/both 的事项（转成 TimelineEvent 形状）。
    const timeline: Record<string, unknown> = {}
    for (const it of items) {
      if (it.type === 'task') continue
      timeline[it.id] = itemToTimelineEvent(it)
    }
    // taskGroups = 统一事项按 (ownerId, groupId) 分组（共享 builder）。
    // rawGroups/rawItems 一并透出，供 suite /api/agentlex/read 按 ownerType 精确
    // 归属生成各案件/项目的任务组（0.2.2 唯一真相源 = items.json）。
    ok(res, {
      timeline,
      taskGroups: buildLegacyTaskGroupsFromStore(groups, items),
      rawGroups: groups,
      rawItems: items,
    })
  })

  return () => {
    for (const dispose of disposers.splice(0)) dispose()
  }
}
