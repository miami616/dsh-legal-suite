/**
 * 统一事项域 — REST 路由。
 *
 * /api/agentlex-item/* CRUD + 任务组 CRUD。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { ItemStore } from './store/item-store.ts'
import type { ApiResponse } from './store/types.ts'
import { itemToLegacyTask, itemToTimelineEvent } from './shape.ts'

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
  // 这是「数据源统一」的桥：现有组件暂时读旧形状，但数据来自 items.json。
  route('/api/agentlex-item/legacy', async (d, _b, res) => {
    const items = await d.itemStore.listItems()
    const groups = await d.itemStore.listGroups()
    // timeline = type 为 event/both 的事项（转成 TimelineEvent 形状）。
    const timeline: Record<string, unknown> = {}
    for (const it of items) {
      if (it.type === 'task') continue
      timeline[it.id] = itemToTimelineEvent(it)
    }
    // taskGroups = type 为 task/both 的事项，按 (ownerId, groupId) 分组。
    // 未分组的任务各 owner 一个「未分组」组，避免串 owner。
    // ownerType 随组透出（聚合按它区分同号案件/项目）。
    const groupMap = new Map<string, { ownerId: string; ownerType?: string; id: string; title: string; order: number; tasks: unknown[] }>()
    for (const g of groups) {
      groupMap.set(`${g.ownerId}|${g.id}`, { ownerId: g.ownerId, ownerType: g.ownerType, id: g.id, title: g.name, order: g.order, tasks: [] })
    }
    for (const it of items) {
      if (it.type === 'event') continue
      const ownerId = it.ownerId ?? ''
      const gid = it.groupId ?? '__ungrouped'
      const key = `${ownerId}|${gid}`
      if (!groupMap.has(key)) {
        groupMap.set(key, { ownerId, ownerType: it.ownerType, id: gid, title: it.groupName ?? '未分组', order: groupMap.size, tasks: [] })
      }
      const g = groupMap.get(key)!
      g.tasks.push(itemToLegacyTask(it))
    }
    ok(res, { timeline, taskGroups: [...groupMap.values()] })
  })

  return () => {
    for (const dispose of disposers.splice(0)) dispose()
  }
}
