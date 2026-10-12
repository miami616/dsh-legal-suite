/**
 * 脱敏域 HTTP 路由（/api/agentlex-redact/*）——供设置页与浏览器侧调试。
 * 与 agent 工具走同一 service/engine/store 实例，行为一致。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type { EntityKind } from './engine/types.ts'
import type { ServiceDeps } from './service.ts'
import { readTermsAndMappings, runRedact, runRedactDirectory, runRestore, runScan } from './service.ts'
import type { ApiResponse } from './store/types.ts'

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

const KINDS: readonly string[] = [
  'person', 'org', 'project', 'caseName', 'caseNumber', 'address', 'custom',
  'phone', 'idCard', 'creditCode', 'bankAccount', 'email', 'passport', 'amount',
]

/** 请求体 → 词条数组。 */
function toTerms(raw: unknown): Array<{ value: string; kind?: EntityKind; note?: string }> {
  if (!Array.isArray(raw)) return []
  const out: Array<{ value: string; kind?: EntityKind; note?: string }> = []
  for (const item of raw) {
    if (typeof item === 'string') { if (item.trim() !== '') out.push({ value: item.trim() }); continue }
    if (item === null || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const value = typeof record.value === 'string' ? record.value.trim() : ''
    if (value === '') continue
    const kind = typeof record.kind === 'string' && KINDS.includes(record.kind) ? record.kind as EntityKind : undefined
    const note = typeof record.note === 'string' && record.note.trim() !== '' ? record.note.trim() : undefined
    out.push({ value, ...(kind === undefined ? {} : { kind }), ...(note === undefined ? {} : { note }) })
  }
  return out
}

export function makeRoutes(ctx: Context, deps: ServiceDeps): () => void {
  const disposers: Array<() => void> = []

  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/api/agentlex-redact/health',
    handler: async (_req: IncomingMessage, res: ServerResponse) => {
      ok(res, { ok: true, plugin: 'dsh-legal-suite/redact', status: 'ready' })
    },
  }))

  for (const [route, runner] of [
    ['scan', runScan],
    ['redact', runRedact],
    ['restore', runRestore],
  ] as const) {
    disposers.push(ctx.webServer.register({
      kind: 'exact',
      path: `/api/agentlex-redact/${route}`,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        try {
          if (req.method !== 'POST') return fail(res, 'method not allowed', 405)
          const body = await readBody(req)
          const request = {
            text: typeof body.text === 'string' ? body.text : undefined,
            path: typeof body.path === 'string' ? body.path : undefined,
            scope: typeof body.scope === 'string' ? body.scope : undefined,
            mode: body.mode === 'masked' ? 'masked' as const : 'reversible' as const,
            outPath: typeof body.outPath === 'string' ? body.outPath : undefined,
            crossScope: typeof body.crossScope === 'boolean' ? body.crossScope : undefined,
            maskAmounts: typeof body.maskAmounts === 'boolean' ? body.maskAmounts : undefined,
            heuristic: typeof body.heuristic === 'boolean' ? body.heuristic : undefined,
            save: route === 'scan' ? false : undefined,
            // 候选原文只给本机界面（浏览器）；agent 工具不传该字段。
            reveal: body.reveal === true,
            includeText: body.includeText === true,
          }
          ok(res, await runner(deps, request))
        } catch (error) {
          fail(res, error)
        }
      },
    }))
  }

  // 批量目录：POST /api/agentlex-redact/batch { dir, scope, mode }
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/api/agentlex-redact/batch',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      try {
        if (req.method !== 'POST') return fail(res, 'method not allowed', 405)
        const body = await readBody(req)
        const dir = typeof body.dir === 'string' ? body.dir : ''
        if (dir === '') return fail(res, 'dir required')
        return ok(res, await runRedactDirectory(deps, {
          dir,
          scope: typeof body.scope === 'string' ? body.scope : undefined,
          mode: body.mode === 'masked' ? 'masked' : 'reversible',
          crossScope: typeof body.crossScope === 'boolean' ? body.crossScope : undefined,
          maskAmounts: typeof body.maskAmounts === 'boolean' ? body.maskAmounts : undefined,
          heuristic: typeof body.heuristic === 'boolean' ? body.heuristic : undefined,
        }))
      } catch (error) {
        fail(res, error)
      }
    },
  }))

  // 词条：GET 列出（?scope=），POST 增删。
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/api/agentlex-redact/terms',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const url = new URL(req.url ?? '/', 'http://localhost')
        if (req.method === 'GET' || req.method === 'HEAD') {
          const scope = url.searchParams.get('scope') ?? undefined
          return ok(res, await readTermsAndMappings(deps, scope))
        }
        const body = await readBody(req)
        const scope = typeof body.scope === 'string' ? body.scope : 'global'
        if (body.action === 'remove') {
          const values = Array.isArray(body.values) ? body.values.filter((v): v is string => typeof v === 'string') : []
          return ok(res, await deps.store.removeTerms(scope, values))
        }
        return ok(res, { added: await deps.store.addTerms(scope, toTerms(body.terms)) })
      } catch (error) {
        fail(res, error)
      }
    },
  }))

  // 映射：GET 列 scopes；GET ?scope=x 看某个案件的假名对照（本机查看用）。
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/api/agentlex-redact/mappings',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      try {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const scope = url.searchParams.get('scope')
        if (scope === null || scope === '') return ok(res, { scopes: await deps.store.listMappingScopes() })
        const doc = await deps.store.readMapping(scope)
        if (doc === undefined) return fail(res, `mapping not found: ${scope}`, 404)
        return ok(res, doc)
      } catch (error) {
        fail(res, error)
      }
    },
  }))

  // 配置：GET 读，PUT/POST 改。
  disposers.push(ctx.webServer.register({
    kind: 'exact',
    path: '/api/agentlex-redact/config',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      try {
        if (req.method === 'GET' || req.method === 'HEAD') return ok(res, await deps.store.readConfig())
        const body = await readBody(req)
        return ok(res, await deps.store.saveConfig({
          ...(typeof body.maskAmounts === 'boolean' ? { maskAmounts: body.maskAmounts } : {}),
          ...(typeof body.heuristic === 'boolean' ? { heuristic: body.heuristic } : {}),
          ...(typeof body.crossScope === 'boolean' ? { crossScope: body.crossScope } : {}),
        }))
      } catch (error) {
        fail(res, error)
      }
    },
  }))

  return () => {
    for (const dispose of disposers.splice(0)) dispose()
  }
}
