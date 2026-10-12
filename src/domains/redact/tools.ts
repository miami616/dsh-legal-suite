/**
 * 脱敏 agent 工具（`redact`，action union）。
 *
 * 模型面职责：材料外发/上云前先脱敏；能预检（scan）、正式脱敏（redact）、
 * 还原（restore），并管理自定义词条与映射/配置。
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { ALIAS_KINDS, MASK_KINDS, type EntityKind } from './engine/types.ts'
import type { ServiceDeps } from './service.ts'
import { readTermsAndMappings, runRedact, runRedactDirectory, runRestore, runScan } from './service.ts'

const ACTIONS = [
  'scan', 'redact', 'restore', 'batch',
  'terms_add', 'terms_list', 'terms_remove',
  'mappings_list', 'config_get', 'config_set',
] as const

type Action = typeof ACTIONS[number]

const VALID_KINDS: readonly string[] = [...ALIAS_KINDS, ...MASK_KINDS]

const PARAMETERS = {
  action: { type: 'string', required: true, description: `要执行的操作：${ACTIONS.join(' / ')}` },
  text: { type: 'string', description: '待脱敏/还原的文本（与 path 二选一；scan/redact/restore 用）' },
  path: { type: 'string', description: '待处理文件路径（与 text 二选一）：.docx 出保格式副本 + 脱敏文本；.pdf/.txt/.md 出脱敏文本；图片与无文字层 PDF 自动走本机 OCR' },
  dir: { type: 'string', description: 'batch：目录路径，目录内所有可处理文件逐个脱敏（整卷对外提供用）。同一 scope 共用一张映射表，假名跨文件一致' },
  includeText: { type: 'boolean', description: '是否在响应里直接返回脱敏文本（默认 false，只给产物路径；小文件设 true 可省一次读文件）' },
  scope: { type: 'string', description: '归属：案件编号（如 2026-056）/ 非诉项目 id / global（无归属时）。决定用哪套案件词典与哪个映射表' },
  mode: { type: 'string', description: 'redact 模式：reversible（默认，假名可 restore 还原，用于内部流转）/ masked（对外提供，单向不可还原）' },
  outPath: { type: 'string', description: '文件输入时的输出副本路径（默认同目录 <原名>.redacted<扩展名>；原文件绝不动）' },
  crossScope: { type: 'boolean', description: '是否跨案并入全库词条（默认 false：只匹配该 scope + 全局词条）' },
  maskAmounts: { type: 'boolean', description: '是否给金额打码（默认 false——金额多为案件要素，打码后材料不可用）' },
  heuristic: { type: 'boolean', description: '是否输出启发层人名候选（默认 true，只报告不替换）' },
  terms: { type: 'json', description: 'terms_add 的词条数组：[{ value, kind?, note? }] 或字符串数组；kind 取 person/org/project/caseName/caseNumber/address/custom/phone/idCard/creditCode/bankAccount/email/passport/amount' },
  values: { type: 'json', description: 'terms_remove 要删除的词条值数组：["王某某"]' },
} as const

const DESCRIPTION = [
  '本地脱敏工具（AgentLex）：把案件材料里的身份信息在本机替换掉，再外发/上云。',
  '【何时必须用】准备把材料内容发往云端大模型、对外提供、演示或投稿之前；用户提到「脱敏 / 打码 / 匿名化 / 隐去当事人」时。',
  '【识别三层】①规则层：身份证/统一社会信用代码带官方校验位验证，手机号、银行账号（需上下文）、邮箱、护照号；',
  '②案件词典层：直接读本机诉讼/非诉案件库里的当事人、法定代表人、案号、法官、法院、代理机构做白名单精确匹配（比通用识别准）；',
  '③启发层：锚点识别人名候选，**只报告不替换**，确认后用 terms_add 入词典，下次即精确命中。',
  '【模式】reversible（默认）：实体变稳定假名（张某 / 机构A），映射表落本机，之后可用 restore 还原；masked：对外提供，单向不可还原。',
  '【文件级】给 path 就按文件处理：.docx 出**保格式副本**（.redacted.docx，正文/页眉/表格版式不变）+ 脱敏纯文本（.redacted.txt）；.pdf/.txt/.md 出脱敏文本；图片与无文字层 PDF 自动走本机 OCR；给 dir 用 batch 整目录批量（整卷对外提供）。',
  '【给模型读之前】先把文件脱敏，再让模型读 .redacted.txt 或 includeText 取回的文本——原始文件不进模型上下文；产出物里的假名可用 restore 换回真名（未还原清单会列出来）。',
  '【纪律】映射表含原文，属本机机密，绝不写进对外内容/推送；文件输入只写副本，**原件不动**。',
  'action 必填；scan 只预检不替换，redact 落盘映射并产出脱敏文本/副本。',
].join('\n')

/** JSON 值 → 词条数组。 */
function toTermInputs(raw: unknown): Array<{ value: string; kind?: EntityKind; note?: string }> {
  const out: Array<{ value: string; kind?: EntityKind; note?: string }> = []
  if (!Array.isArray(raw)) {
    if (typeof raw === 'string' && raw.trim() !== '') out.push({ value: raw.trim() })
    return out
  }
  for (const item of raw) {
    if (typeof item === 'string') {
      if (item.trim() !== '') out.push({ value: item.trim() })
      continue
    }
    if (item === null || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const value = typeof record.value === 'string' ? record.value.trim() : ''
    if (value === '') continue
    const kind = typeof record.kind === 'string' && VALID_KINDS.includes(record.kind) ? record.kind as EntityKind : undefined
    const note = typeof record.note === 'string' && record.note.trim() !== '' ? record.note.trim() : undefined
    out.push({ value, ...(kind === undefined ? {} : { kind }), ...(note === undefined ? {} : { note }) })
  }
  return out
}

/** JSON 值 → 字符串数组。 */
function toStringList(raw: unknown): string[] {
  if (typeof raw === 'string') return raw.trim() === '' ? [] : [raw.trim()]
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter((item) => item !== '')
}

export function registerRedactTool(ctx: Context, deps: ServiceDeps): () => void {
  return ctx.tools.register(defineTool({
    name: 'redact',
    description: DESCRIPTION,
    parameters: PARAMETERS,
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args: Record<string, unknown>): Promise<JsonValue> {
      const action = String(args.action ?? '') as Action
      if (!ACTIONS.includes(action)) throw new Error(`unknown action: ${String(args.action)}`)
      const scope = args.scope === undefined || String(args.scope).trim() === '' ? undefined : String(args.scope)

      switch (action) {
        case 'scan':
          return await runScan(deps, {
            text: typeof args.text === 'string' ? args.text : undefined,
            path: typeof args.path === 'string' ? args.path : undefined,
            scope,
            crossScope: typeof args.crossScope === 'boolean' ? args.crossScope : undefined,
            maskAmounts: typeof args.maskAmounts === 'boolean' ? args.maskAmounts : undefined,
            heuristic: typeof args.heuristic === 'boolean' ? args.heuristic : undefined,
          }) as unknown as JsonValue

        case 'redact':
          return await runRedact(deps, {
            text: typeof args.text === 'string' ? args.text : undefined,
            path: typeof args.path === 'string' ? args.path : undefined,
            scope,
            mode: args.mode === 'masked' ? 'masked' : 'reversible',
            outPath: typeof args.outPath === 'string' ? args.outPath : undefined,
            crossScope: typeof args.crossScope === 'boolean' ? args.crossScope : undefined,
            maskAmounts: typeof args.maskAmounts === 'boolean' ? args.maskAmounts : undefined,
            heuristic: typeof args.heuristic === 'boolean' ? args.heuristic : undefined,
            includeText: typeof args.includeText === 'boolean' ? args.includeText : undefined,
          }) as unknown as JsonValue

        case 'batch':
          if (typeof args.dir !== 'string' || args.dir.trim() === '') throw new Error('batch 需要 dir（目录路径）')
          return await runRedactDirectory(deps, {
            dir: args.dir,
            scope,
            mode: args.mode === 'masked' ? 'masked' : 'reversible',
            crossScope: typeof args.crossScope === 'boolean' ? args.crossScope : undefined,
            maskAmounts: typeof args.maskAmounts === 'boolean' ? args.maskAmounts : undefined,
            heuristic: typeof args.heuristic === 'boolean' ? args.heuristic : undefined,
          }) as unknown as JsonValue

        case 'restore':
          return await runRestore(deps, {
            text: typeof args.text === 'string' ? args.text : undefined,
            path: typeof args.path === 'string' ? args.path : undefined,
            scope,
            outPath: typeof args.outPath === 'string' ? args.outPath : undefined,
            includeText: typeof args.includeText === 'boolean' ? args.includeText : undefined,
          }) as unknown as JsonValue

        case 'terms_add': {
          const added = await deps.store.addTerms(scope ?? 'global', toTermInputs(args.terms))
          return { added: added.length, terms: added } as unknown as JsonValue
        }
        case 'terms_list': {
          const view = await readTermsAndMappings(deps, scope)
          return { terms: view.terms, mappingScopes: view.mappingScopes } as unknown as JsonValue
        }
        case 'terms_remove': {
          const values = [...toStringList(args.values), ...toTermInputs(args.terms).map((term) => term.value)]
          if (values.length === 0) throw new Error('terms_remove 需要 values（词条值数组）')
          const result = await deps.store.removeTerms(scope ?? 'global', values)
          return { removed: result.removed } as unknown as JsonValue
        }
        case 'mappings_list':
          return { scopes: await deps.store.listMappingScopes() } as unknown as JsonValue
        case 'config_get':
          return await deps.store.readConfig() as unknown as JsonValue
        case 'config_set':
          return await deps.store.saveConfig({
            ...(typeof args.maskAmounts === 'boolean' ? { maskAmounts: args.maskAmounts } : {}),
            ...(typeof args.heuristic === 'boolean' ? { heuristic: args.heuristic } : {}),
            ...(typeof args.crossScope === 'boolean' ? { crossScope: args.crossScope } : {}),
          }) as unknown as JsonValue
        default:
          throw new Error(`unhandled action: ${action}`)
      }
    },
  }))
}

/* ------------------------------------------------------- agent-preset 平面 */

/** action → 宿主 HTTP 路由（preset 平面没有 store，只能走宿主 API）。 */
const HTTP_ROUTE: Record<Action, { path: string; method: 'GET' | 'POST' | 'PUT' }> = {
  scan: { path: 'scan', method: 'POST' },
  redact: { path: 'redact', method: 'POST' },
  restore: { path: 'restore', method: 'POST' },
  batch: { path: 'batch', method: 'POST' },
  terms_add: { path: 'terms', method: 'POST' },
  terms_list: { path: 'terms', method: 'GET' },
  terms_remove: { path: 'terms', method: 'POST' },
  mappings_list: { path: 'mappings', method: 'GET' },
  config_get: { path: 'config', method: 'GET' },
  config_set: { path: 'config', method: 'PUT' },
}

/** 解析宿主自身 base URL（与 litigation 同口径：优先 webServer.port）。 */
function resolveHostBaseUrl(ctx: Context): string {
  const server = ctx.get('webServer') as { port?: number } | undefined
  if (server !== undefined && server.port !== undefined) return `http://127.0.0.1:${String(server.port)}`
  const fromEnv = process.env.DSH_WEB_URL
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv.replace(/\/+$/, '')
  throw new Error('redact: cannot resolve host base URL (no webServer service)')
}

/** args → 宿主路由请求体。 */
function buildBody(action: Action, args: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {}
  for (const key of ['text', 'path', 'dir', 'scope', 'outPath', 'crossScope', 'maskAmounts', 'heuristic', 'includeText', 'terms', 'values']) {
    if (args[key] !== undefined) body[key] = args[key]
  }
  if (action === 'terms_add') body.action = 'add'
  if (action === 'terms_remove') body.action = 'remove'
  return body
}

/**
 * Agent-preset 平面注册：同一个 `redact` 工具，execute 改调宿主 HTTP 路由
 * （/api/agentlex-redact/*）而不是直接碰 store——preset 平面没有宿主服务。
 * 用于把脱敏能力带进「诉讼管家 / 非诉管家」会话（scoped，仅本 agent 可见）。
 */
export function registerRedactHttpTool(ctx: Context): () => void {
  return ctx.tools.register(defineTool({
    name: 'redact',
    description: DESCRIPTION,
    parameters: PARAMETERS,
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args: Record<string, unknown>): Promise<JsonValue> {
      const action = String(args.action ?? '') as Action
      if (!ACTIONS.includes(action)) throw new Error(`unknown action: ${String(args.action)}`)
      const route = HTTP_ROUTE[action]
      const base = resolveHostBaseUrl(ctx)
      const body = buildBody(action, args)
      let url = `${base}/api/agentlex-redact/${route.path}`
      const init: { method: string; headers: Record<string, string>; body?: string } = {
        method: route.method,
        headers: { accept: 'application/json' },
      }
      if (route.method === 'GET') {
        const query = new URLSearchParams()
        if (typeof args.scope === 'string' && args.scope !== '') query.set('scope', args.scope)
        const suffix = query.toString()
        if (suffix !== '') url += `?${suffix}`
      } else {
        init.headers['content-type'] = 'application/json'
        init.body = JSON.stringify(body)
      }
      const response = await fetch(url, init)
      const payload = await response.json() as { success?: boolean; data?: unknown; error?: string }
      if (payload.success !== true) throw new Error(`redact ${action} failed: ${payload.error ?? `HTTP ${response.status}`}`)
      return payload.data as JsonValue
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `redact: ${String(args.action)}${args.scope !== undefined ? ` ${String(args.scope)}` : ''}`,
    }),
  }))
}
