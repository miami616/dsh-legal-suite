/**
 * dsh-legal-suite/memo — 备忘录域（host 半）。
 *
 * 提供备忘的持久化 + REST API（/api/agentlex-memo/* CRUD + 归档 + SSE
 * live-refresh），并注册一个 agent 工具 `memo_read`，让模型能把会话里的
 * `#ref` 引用解析为备忘正文。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'
import z from 'schemastery'
import { createMemoStore, type MemoStore } from './store/memo-store.ts'
import { makeRoutes, type RouteDeps } from './routes.ts'
import type { MemoItem } from './store/types.ts'

export const name = 'dsh-legal-suite/memo'

/** Services required before the memo surfaces can mount. */
export const inject = ['webServer', 'settings', 'systemPrompt', 'tools']

export const MEMO_SETTINGS_NAMESPACE = 'agentlex-memo' as const

export interface Config {
  enabled?: boolean
  dataDir?: string
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  dataDir: z.string().required(false),
})

export function resolveDataDir(configured?: string): string {
  if (configured !== undefined && configured !== '') return configured
  const home = process.env.DSH_HOME ?? ''
  if (home !== '') return `${home}/agentlex/memos`
  const os = process.platform === 'win32' ? 'USERPROFILE' : 'HOME'
  const userHome = process.env[os] ?? '.'
  return `${userHome}/.dsh/agentlex/memos`
}

interface HostSurface {
  token: object
  dispose: () => void
}

let activeSurface: HostSurface | undefined

function disposeSurface(owner: object): void {
  if (activeSurface !== undefined && activeSurface.token === owner) {
    activeSurface.dispose()
    activeSurface = undefined
  }
}

export function apply(ctx: Context, config: Config = {}): void {
  let current: () => Config = () => config
  const resolve = (): Config => ({
    enabled: current().enabled ?? true,
    dataDir: current().dataDir,
  })
  const token = {}

  const sync = (): void => {
    if (activeSurface !== undefined) { activeSurface.dispose(); activeSurface = undefined }
    const value = resolve()
    if (!value.enabled) return
    const dataDir = resolveDataDir(value.dataDir)
    const memoStore = createMemoStore(dataDir, ctx)
    const deps: RouteDeps = { memoStore }
    // 同时注册 API 路由与模型工具（agent 用 #ref 查备忘正文），
    // 两者随同一 surface 一起卸载。
    const disposeRoutes = makeRoutes(ctx, deps)
    const disposeTool = registerMemoTool(ctx, memoStore)
    activeSurface = {
      token,
      dispose: () => {
        disposeTool()
        disposeRoutes()
      },
    }
  }

  ctx.settings.installSection(ctx, MEMO_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => { current = source; sync() },
    onChange: sync,
  })

  ctx.effect(() => () => { disposeSurface(token) }, 'dsh-legal-suite/memo: teardown')

  sync()
}

/**
 * 注册模型工具 memo_read / memo_search，供 agent 把会话输入框里的 `#ref`
 * 备忘录引用解析为内容。工具注册随 fiber 生命周期自动清理。
 */
export function registerMemoTool(ctx: Context, memoStore: MemoStore): () => void {
  const disposers: Array<() => void> = []

  const renderJson = (_args: unknown, value: unknown): Array<{ type: 'text'; text: string }> => [
    { type: 'text', text: JSON.stringify(value, null, 2) },
  ]

  disposers.push(ctx.tools.register(defineTool({
    name: 'memo_read',
    description: '读取一条备忘（备忘录）内容。传 id 或 ref（会话输入框里 # 后的引用码）。用于在对话中把 #ref 备忘引用还原为正文。',
    parameters: {
      id: { type: 'string', description: '备忘 id' },
      ref: { type: 'string', description: '备忘引用码（# 后的 token）' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    async execute(args: { id?: string; ref?: string }): Promise<JsonValue> {
      const id = args?.id === undefined ? '' : String(args.id)
      const ref = args?.ref === undefined ? '' : String(args.ref).toLowerCase()
      const all = await memoStore.listMemos()
      const memo = id !== ''
        ? all.find((m) => m.id === id)
        : (ref !== '' ? all.find((m) => m.ref === ref) : undefined)
      if (memo === undefined) {
        return { found: false, message: `未找到备忘（id=${id || '-'} ref=${ref || '-'}）` }
      }
      return { found: true, id: memo.id, ref: memo.ref, content: memo.content, tags: memo.tags, status: memo.status }
    },
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: 'memo_search',
    description: '搜索备忘（备忘录）。按关键字/标签匹配正文与标签，可选是否包含已归档。返回匹配条目列表。',
    parameters: {
      query: { type: 'string', description: '关键字（匹配正文/引用码）' },
      tag: { type: 'string', description: '标签（精确匹配单个标签）' },
      includeArchived: { type: 'boolean', description: '是否包含已归档备忘' },
    },
    output: { schema: { type: 'json' }, render: renderJson },
    async execute(args: { query?: string; tag?: string; includeArchived?: boolean }): Promise<JsonValue> {
      const q = args?.query === undefined ? '' : String(args.query).trim().toLowerCase()
      const tag = args?.tag === undefined ? '' : String(args.tag).trim().toLowerCase()
      const includeArchived = args?.includeArchived === true
      const all = await memoStore.listMemos()
      const hits = all
        .filter((m) => {
          if (!includeArchived && m.status !== 'active') return false
          if (tag !== '' && !m.tags.includes(tag)) return false
          if (q !== '' && !m.content.toLowerCase().includes(q) && !m.ref.includes(q)) return false
          return true
        })
        .slice(0, 20)
        .map((m) => ({ id: m.id, ref: m.ref, content: m.content.slice(0, 80), tags: m.tags, status: m.status }))
      return { count: hits.length, hits }
    },
  })))

  return () => {
    for (const dispose of disposers.splice(0)) dispose()
  }
}
