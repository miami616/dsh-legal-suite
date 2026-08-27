/**
 * 技能与工具 — 浏览器端 API（同源 POST /api/agentlex-skills/*）。
 */
import type { SkillsToolsState } from '../types.ts'

const PREFIX = '/api/agentlex-skills'

interface ApiResult<T = unknown> {
  ok?: boolean
  error?: string
  state?: SkillsToolsState
  parsed?: T
  results?: Array<{ serverName: string; updated: boolean }>
  name?: string
  description?: string
  instructions?: string
  group?: string
}

async function post<T = unknown>(sub: string, payload: Record<string, unknown>): Promise<ApiResult<T>> {
  const res = await fetch(`${PREFIX}${sub}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const json = (await res.json().catch(() => ({}))) as ApiResult<T>
  if (!res.ok) {
    throw new Error(json.error ?? `HTTP ${res.status}`)
  }
  return json
}

/** 拉取整体状态（技能 + MCP）。 */
export async function fetchState(): Promise<SkillsToolsState> {
  const json = await post('/state', {})
  if (!json.ok || !json.state) throw new Error(json.error ?? 'state 加载失败')
  return json.state
}

/** 解析上传的技能文件（zip/.skill/.md → 表单形状）。 */
export interface SkillUploadParsedShape {
  name?: string
  description?: string
  whenToUse?: string
  instructions?: string
  resources?: string[]
}

export async function parseSkillUpload(fileName: string, dataBase64: string): Promise<SkillUploadParsedShape> {
  const json = await post<SkillUploadParsedShape>('/skills.parse', { fileName, dataBase64 })
  if (!json.ok || !json.parsed) throw new Error(json.error ?? '解析失败')
  return json.parsed as SkillUploadParsedShape
}

/** 创建技能（可携带上传文件的资源一并落盘）。 */
export async function createSkill(payload: {
  name: string
  fileName?: string
  dataBase64?: string
  description?: string
  instructions: string
  group?: string
  overwrite?: boolean
}): Promise<{ name: string; state: SkillsToolsState }> {
  const json = await post('/skills.create', payload as Record<string, unknown>)
  if (!json.ok || !json.state) throw new Error(json.error ?? '创建失败')
  return { name: json.name ?? payload.name, state: json.state }
}

/** 读取单个技能（编辑回填）。 */
export async function readSkill(name: string): Promise<{ name: string; description: string; instructions: string; group?: string }> {
  const json = await post('/skills.read', { name })
  if (!json.ok) throw new Error(json.error ?? '读取失败')
  return { name: json.name ?? name, description: json.description ?? '', instructions: json.instructions ?? '', group: json.group }
}

/** 更新技能（改名/改描述/改指令/改分组）。 */
export async function updateSkill(payload: { name: string; newName?: string; description?: string; instructions?: string; group?: string }): Promise<SkillsToolsState> {
  const json = await post('/skills.update', payload)
  if (!json.ok || !json.state) throw new Error(json.error ?? '更新失败')
  return json.state
}

/** 删除技能。 */
export async function removeSkill(name: string): Promise<SkillsToolsState> {
  const json = await post('/skills.remove', { name })
  if (!json.ok || !json.state) throw new Error(json.error ?? '删除失败')
  return json.state
}

/** 启停技能。 */
export async function toggleSkill(name: string, enabled: boolean): Promise<SkillsToolsState> {
  const json = await post('/skills.toggle', { name, enabled })
  if (!json.ok || !json.state) throw new Error(json.error ?? '切换失败')
  return json.state
}

/** 添加 MCP（JSON 粘贴，后台自动转换 + 热加载）。 */
export async function addMcp(jsonValue: unknown): Promise<{ results: Array<{ serverName: string; updated: boolean }>; state: SkillsToolsState }> {
  const json = await post('/mcp.add', { json: jsonValue })
  if (!json.ok || !json.state) throw new Error(json.error ?? '添加失败')
  return { results: json.results ?? [], state: json.state }
}

/** 删除 MCP。 */
export async function removeMcp(id: string): Promise<SkillsToolsState> {
  const json = await post('/mcp.remove', { id })
  if (!json.ok || !json.state) throw new Error(json.error ?? '删除失败')
  return json.state
}

/** 设置单个 MCP 的分组（空串 → 回退自动派生）。 */
export async function mcpSetGroup(id: string, group: string): Promise<SkillsToolsState> {
  const json = await post('/mcp.group', { id, group })
  if (!json.ok || !json.state) throw new Error(json.error ?? '分组设置失败')
  return json.state
}

/** 重命名分组（组内条目批量迁移；to 为空 → 移入「未分组/其他」）。 */
export async function renameGroup(kind: 'skill' | 'mcp', from: string, to: string): Promise<SkillsToolsState> {
  const json = await post('/groups.rename', { kind, from, to })
  if (!json.ok || !json.state) throw new Error(json.error ?? '重命名失败')
  return json.state
}

/** 启停 MCP（用户服务器或 cordis 内置）。 */
export async function toggleMcp(payload: { id: string; entryId?: string; source?: 'user' | 'cordis'; enabled: boolean }): Promise<SkillsToolsState> {
  const json = await post('/mcp.toggle', { ...payload })
  if (!json.ok || !json.state) throw new Error(json.error ?? '切换失败')
  return json.state
}
