/**
 * Agent tool for the ideas module — the model-facing "想法/备忘" surface.
 *
 * 让 AI 既能管理想法（记录/更新/状态/删除），也能在用户于输入框以
 * `#idea-<id>` 引用某条想法时，通过 get_idea 按 id 拉取全文。所有变更
 * 走与 HTTP 路由相同的 store，浏览器半经 SSE 实时刷新。
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { IdeaStore } from './store/idea-store.ts'
import type { IdeaStatus } from './store/types.ts'

export interface ToolDeps {
  ideaStore: IdeaStore
}

const ACTIONS = [
  'list_ideas',
  'get_idea',
  'create_idea',
  'update_idea',
  'set_status',
  'delete_idea',
] as const

type Action = typeof ACTIONS[number]

const PARAMETERS = {
  action: { type: 'string', required: true, description: `要执行的操作：${ACTIONS.join(' / ')}` },
  id: { type: 'string', description: '想法 id（如 idea-xxx 或引用令牌 #idea-xxx 中的 xxx）。update/set_status/delete/get 必填' },
  title: { type: 'string', description: '想法标题。create/update 使用；未提供时默认「未命名想法」' },
  content: { type: 'string', description: '想法正文（多行，可空）' },
  caseId: { type: 'string', description: '可选关联案件编号' },
  caseName: { type: 'string', description: '可选关联案件名称' },
  tags: { type: 'array', description: '可选标签数组', items: { type: 'string' } },
  status: { type: 'string', description: 'set_status 目标状态：active（进行中）/ done（已实现，面板划掉）/ archived（已归档）' },
} as const

const DESCRIPTION = [
  '想法/备忘管理工具（AgentLex「想法」）。记录、更新、查询个人想法或备忘；',
  '可关联案件（caseId/caseName）与标签（tags），并支持状态流转：active（进行中）、',
  'done（已实现/划掉）、archived（已归档）。',
  '当用户提到「想法/备忘/记一下/记个想法」、或消息里出现 #idea-<id> 引用令牌、',
  '或要求归档/完成某条想法时调用。',
  'action 必填；列表/解析类只读，变更类立即持久化并刷新界面。',
].join('')

function requireIds(ids: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(ids)) {
    if (value === undefined || value === '') throw new Error(`${key} is required`)
  }
}

/** Strip undefined/null recursively so values are JSON-safe. */
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

/** 解析 id：接受完整 id 或引用令牌 #idea-xxx（去掉前缀）。 */
function normalizeId(value: unknown): string {
  let raw = String(value ?? '')
  if (raw.startsWith('#')) raw = raw.slice(1)
  if (raw.startsWith('idea-')) raw = raw.slice('idea-'.length)
  return raw
}

export function registerIdeasTool(ctx: Context, deps: ToolDeps): () => void {
  return ctx.tools.register(defineTool({
    name: 'ideas',
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

      const store = deps.ideaStore
      const s = (v: unknown): string | undefined => (v === undefined || v === null) ? undefined : String(v)

      switch (action) {
        case 'list_ideas': {
          const ideas = await store.listIdeas()
          const summary = ideas.map((i) => ({
            id: i.id,
            title: i.title,
            status: i.status,
            caseId: i.caseId ?? null,
            caseName: i.caseName ?? null,
            tags: i.tags ?? [],
            updatedAt: i.updatedAt ?? i.createdAt ?? null,
          }))
          return clean({ count: summary.length, ideas: summary })
        }
        case 'get_idea': {
          requireIds({ id: s(args.id) })
          const key = normalizeId(args.id)
          let idea = await store.getIdea(key)
          if (idea === undefined) {
            const all = await store.listIdeas()
            idea = all.find((i) => i.id === key || i.id.endsWith(key))
          }
          if (idea === undefined) return { error: `idea not found: ${key}` }
          return clean({ idea })
        }
        case 'create_idea': {
          const input: Record<string, unknown> = {
            title: s(args.title),
            content: s(args.content),
            caseId: s(args.caseId),
            caseName: s(args.caseName),
            tags: Array.isArray(args.tags) ? args.tags.map((t) => String(t)) : undefined,
          }
          const idea = await store.upsertIdea(input)
          return { id: idea.id, title: idea.title, ok: true }
        }
        case 'update_idea': {
          requireIds({ id: s(args.id) })
          const key = normalizeId(args.id)
          const existing = await store.getIdea(key)
          if (existing === undefined) return { error: `idea not found: ${key}` }
          const input: Record<string, unknown> = { id: existing.id }
          if (args.title !== undefined) input.title = s(args.title)
          if (args.content !== undefined) input.content = s(args.content)
          if (args.caseId !== undefined) input.caseId = s(args.caseId)
          if (args.caseName !== undefined) input.caseName = s(args.caseName)
          if (args.tags !== undefined) input.tags = Array.isArray(args.tags) ? args.tags.map((t) => String(t)) : undefined
          const idea = await store.upsertIdea(input)
          return { id: idea.id, ok: true }
        }
        case 'set_status': {
          requireIds({ id: s(args.id), status: s(args.status) })
          const key = normalizeId(args.id)
          const status = String(args.status)
          if (status !== 'active' && status !== 'done' && status !== 'archived') {
            throw new Error(`invalid status: ${status}`)
          }
          const idea = await store.setStatus(key, status as IdeaStatus)
          return { id: idea.id, status: idea.status, ok: true }
        }
        case 'delete_idea': {
          requireIds({ id: s(args.id) })
          const key = normalizeId(args.id)
          await store.deleteIdea(key)
          return { id: key, deleted: true }
        }
        default:
          throw new Error(`unhandled action: ${action}`)
      }
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `ideas: ${String(args.action)}${args.id !== undefined ? ` ${String(args.id)}` : ''}`,
    }),
  }))
}
