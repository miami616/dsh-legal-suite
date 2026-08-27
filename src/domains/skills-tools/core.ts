/**
 * 技能与工具 — 纯工具函数（无 cordis / 无 I/O 副作用）。
 *
 * 从 Jnpz v0.1.4（dsh-skill-config）的 core.js 移植为 TypeScript：
 *   • zip 读取（stored + deflate，无外部依赖）
 *   • SKILL.md YAML frontmatter 解析（js-yaml）
 *   • 技能上传文件解析（zip / .skill / .md）
 *   • MCP 配置 JSON 规范化（stdio / local / streamable-http / sse）
 *   • 技能名 slug 化与稳定 hash
 */
import { inflateRawSync } from 'node:zlib'
import { basename } from 'node:path'
import { load as parseYaml } from 'js-yaml'

/** MCP serverName 契约（对齐 @deepseek-ai/dsh-mcp-client）。 */
export const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/
/** DSH skill 名称契约（对齐 @deepseek-ai/dsh-skill isSkillName）。 */
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

// =====================================================================
// zip reading (stored + deflate, no external deps)
// =====================================================================

function u16(buf: Buffer, off: number): number {
  return buf.readUInt16LE(off)
}
function u32(buf: Buffer, off: number): number {
  return buf.readUInt32LE(off)
}

export interface ZipEntry {
  name: string
  dir: boolean
  data: Buffer | null
}

/**
 * 读取 ZIP 缓冲区的文件条目。支持 method 0（stored）与 method 8（deflate）。
 * 目录条目以 `dir: true` 返回且无数据；条目名统一为 "/" 分隔，
 * 拒绝路径穿越名称。
 */
export function extractZip(buf: Buffer): ZipEntry[] {
  // 1) 定位 End Of Central Directory (0x06054b50)，最多回扫 64KiB+22
  const min = Math.max(0, buf.length - 22 - 0xffff)
  let eocd = -1
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf[i] === 0x50 && buf[i + 1] === 0x4b && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('不是有效的 zip 文件（缺少结束记录）')
  const count = u16(buf, eocd + 10) || u16(buf, eocd + 8)
  let off = u32(buf, eocd + 16)
  if (off <= 0 || off >= buf.length) throw new Error('zip 中央目录偏移无效')

  const entries: ZipEntry[] = []
  for (let n = 0; n < count; n++) {
    if (u32(buf, off) !== 0x02014b50) throw new Error('zip 中央目录损坏')
    const method = u16(buf, off + 10)
    const csize = u32(buf, off + 20)
    const usize = u32(buf, off + 24)
    const fnLen = u16(buf, off + 28)
    const extraLen = u16(buf, off + 30)
    const commentLen = u16(buf, off + 32)
    const localOff = u32(buf, off + 42)
    let name: string
    try {
      name = buf.toString('utf8', off + 46, off + 46 + fnLen)
    } catch {
      name = buf.toString('binary', off + 46, off + 46 + fnLen)
    }
    // normalize separators; reject traversal / absolute names
    // 目录条目（name 以 "/" 结尾）允许尾段空串；中间空段（a//b）与
    // 绝对路径（/x）仍拒绝。
    name = name.replace(/\\/g, '/')
    const isDirName = name.endsWith('/')
    if (name.startsWith('/') || name.split('/').some((seg) => seg === '..' || (seg === '' && !isDirName && name !== ''))) {
      throw new Error(`zip 内含非法路径 "${name}"`)
    }
    const dir = name.endsWith('/') || (csize === 0 && usize === 0 && name.endsWith('/'))
    off += 46 + fnLen + extraLen + commentLen

    if (name === '' || name.endsWith('/')) {
      entries.push({ name, dir: true, data: null })
      continue
    }
    // 2) local header (0x04034b50)
    const lfnLen = u16(buf, localOff + 26)
    const lextraLen = u16(buf, localOff + 28)
    const dataStart = localOff + 30 + lfnLen + lextraLen
    const end = dataStart + csize
    if (end > buf.length) throw new Error(`zip 条目 "${name}" 数据越界`)
    let data = buf.subarray(dataStart, end)
    if (method === 8) {
      try {
        data = inflateRawSync(data, { maxOutputLength: 64 * 1024 * 1024 })
      } catch {
        throw new Error(`zip 条目 "${name}" 解压失败`)
      }
    } else if (method !== 0) {
      throw new Error(`zip 条目 "${name}" 使用了不支持的压缩方式 ${method}`)
    }
    entries.push({ name, dir: false, data })
  }
  return entries
}

// =====================================================================
// SKILL.md frontmatter
// =====================================================================

export interface FrontmatterResult {
  data: Record<string, unknown>
  body: string
}

/**
 * 解析 SKILL.md 的 YAML frontmatter。
 * @returns { data, body }；无 frontmatter 时返回 null。
 * @throws 存在 frontmatter 但不是合法 YAML 时。
 */
export function parseFrontmatter(raw: string): FrontmatterResult | null {
  const firstEnd = raw.indexOf('\n')
  const first = firstEnd < 0 ? raw : raw.slice(0, firstEnd)
  if (first.replace(/\r$/, '') !== '---') return null
  const start = firstEnd < 0 ? raw.length : firstEnd + 1
  let lineStart = start
  while (lineStart <= raw.length) {
    const next = raw.indexOf('\n', lineStart)
    const lineEnd = next < 0 ? raw.length : next
    if (raw.slice(lineStart, lineEnd).replace(/\r$/, '') === '---') {
      const parsed = parseYaml(raw.slice(start, lineStart)) as unknown
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('SKILL.md 前端元数据必须是 YAML 对象')
      }
      return {
        data: parsed as Record<string, unknown>,
        body: raw.slice(next < 0 ? raw.length : next + 1),
      }
    }
    if (next < 0) return null
    lineStart = next + 1
  }
  return null
}

export interface SkillDoc {
  name?: string
  description?: string
  whenToUse?: string
  instructions: string
  frontmatter?: Record<string, unknown>
  error?: string
}

/**
 * 读取技能文档为创建表单形状；缺失字段保持 undefined（由表单决定回退）。
 */
export function parseSkillDoc(text: string): SkillDoc {
  let data: Record<string, unknown> = {}
  let body = text
  let frontmatter: Record<string, unknown> | undefined
  try {
    const fm = parseFrontmatter(text)
    if (fm) {
      data = fm.data
      body = fm.body
      frontmatter = fm.data
    }
  } catch (err) {
    // invalid frontmatter: treat the whole file as instructions
    return { instructions: String(text).trim(), frontmatter: undefined, error: String((err as Error)?.message ?? err) }
  }
  const out: SkillDoc = {
    instructions: String(body).trim(),
    frontmatter,
  }
  if (typeof data.name === 'string' && data.name.trim()) out.name = data.name.trim()
  if (typeof data.description === 'string' && data.description.trim()) out.description = data.description.trim()
  if (typeof data.whenToUse === 'string' && data.whenToUse.trim()) out.whenToUse = data.whenToUse.trim()
  return out
}

// =====================================================================
// names
// =====================================================================

/** 小写连字符 slug（技能名规范化）；无有效字符时返回空串。 */
export function slugifyName(name: string): string {
  const slug = String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug
}

/** 稳定短 hash（djb2），用于 id / 图标配色。 */
export function hashString(input: string): string {
  let h = 5381
  const s = String(input)
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

// =====================================================================
// MCP JSON 转换（“后台自动转换”）
// =====================================================================

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export interface NormalizedMcpConfig {
  serverName: string
  transport: 'stdio' | 'streamable-http'
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  headers?: Record<string, string>
  toolCallTimeoutMs?: number
  enabled?: boolean
}

/**
 * 把用户提供的 MCP JSON 转换为归一化的 mcp-client 配置。
 *
 * 支持的输入形状：
 *   1. { "mcpServers": { "yakit": { "command": "...", "args": [] } } }
 *   2. 单个服务器：{ "serverName": "yakit", "command": "...", ... }
 *      （也接受 `name`、`type`/`transport`、`url`/`sseUrl`）
 *   3. 直接是服务器映射：{ "yakit": { ... } }
 */
export function normalizeMcpInput(input: unknown): NormalizedMcpConfig[] {
  let raw = input
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw)
    } catch (err) {
      throw new Error(`JSON 解析失败: ${(err as Error)?.message ?? err}`)
    }
  }
  const root = asRecord(raw)

  let pairs: Array<[string, Record<string, unknown>]> = []
  if (root.mcpServers !== undefined) {
    if (typeof root.mcpServers !== 'object' || root.mcpServers === null || Array.isArray(root.mcpServers)) {
      throw new Error('"mcpServers" 必须是 { 名称: 配置 } 对象')
    }
    for (const [key, cfg] of Object.entries(root.mcpServers as Record<string, unknown>)) pairs.push([key, asRecord(cfg)])
  } else if (looksLikeServer(root)) {
    pairs.push([String(root.serverName ?? root.name ?? ''), root])
  } else {
    const values = Object.entries(root)
    if (values.length === 0) throw new Error('配置为空')
    if (!values.every(([, v]) => typeof v === 'object' && v !== null && !Array.isArray(v) && looksLikeServer(v))) {
      throw new Error('无法识别的配置格式：请提供单个服务器配置或 { "mcpServers": {...} }')
    }
    pairs = values as Array<[string, Record<string, unknown>]>
  }

  const out: NormalizedMcpConfig[] = []
  for (const [key, cfg] of pairs) {
    const serverName = String(cfg.serverName ?? cfg.name ?? key).trim()
    if (!SERVER_NAME_PATTERN.test(serverName)) {
      throw new Error(`服务器名称 "${serverName}" 无效：仅支持字母/数字/下划线/连字符，最长 32 位`)
    }
    const transport = resolveTransport(cfg, serverName)
    const timeoutMs = cfg.toolCallTimeoutMs ?? cfg.timeout
    if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs as number) || Number(timeoutMs) <= 0)) {
      throw new Error(`服务器 "${serverName}" 的 timeout 必须是正数（毫秒）`)
    }
    const base = {
      serverName,
      transport,
      toolCallTimeoutMs: timeoutMs !== undefined ? Number(timeoutMs) : undefined,
    }
    if (transport === 'stdio') {
      // command 可以是字符串，也可以是数组（首个元素为可执行文件，其余为参数）
      let command: unknown = cfg.command
      const args: string[] = Array.isArray(cfg.args) ? (cfg.args as unknown[]).map(String) : []
      if (Array.isArray(command)) {
        if (command.length === 0 || typeof command[0] !== 'string' || !command[0].trim()) {
          throw new Error(`stdio 服务器 "${serverName}" 的 command 数组不能为空，且首个元素必须是可执行文件路径`)
        }
        const first = command[0]
        for (let i = 1; i < command.length; i++) args.unshift(String(command[i]))
        command = first
      }
      if (typeof command !== 'string' || !command.trim()) {
        throw new Error(`stdio 服务器 "${serverName}" 缺少 command`)
      }
      out.push({
        ...base,
        command,
        args,
        env: asRecord(cfg.env) as Record<string, string>,
        cwd: typeof cfg.cwd === 'string' ? cfg.cwd : '',
        ...(cfg.enabled === false ? { enabled: false } : {}),
      })
    } else {
      const url = String(cfg.url ?? cfg.sseUrl ?? '').trim()
      if (!url) throw new Error(`HTTP 服务器 "${serverName}" 缺少 url`)
      out.push({
        ...base,
        url,
        headers: asRecord(cfg.headers) as Record<string, string>,
        ...(cfg.enabled === false ? { enabled: false } : {}),
      })
    }
  }
  return out
}

function looksLikeServer(cfg: unknown): boolean {
  if (typeof cfg !== 'object' || cfg === null || Array.isArray(cfg)) return false
  const c = cfg as Record<string, unknown>
  return c.command !== undefined || c.url !== undefined || c.transport !== undefined || c.type !== undefined
}

function resolveTransport(cfg: Record<string, unknown>, serverName: string): 'stdio' | 'streamable-http' {
  const explicit = cfg.transport ?? cfg.type
  if (explicit !== undefined) {
    switch (String(explicit).toLowerCase()) {
      case 'stdio':
      case 'local':
        return 'stdio'
      case 'streamable-http':
      case 'streamablehttp':
      case 'http':
      case 'sse':
        return 'streamable-http'
      default:
        throw new Error(`服务器 "${serverName}" 的 transport "${String(explicit)}" 不受支持（支持 stdio / local / streamable-http）`)
    }
  }
  if (cfg.url !== undefined || cfg.sseUrl !== undefined) return 'streamable-http'
  if (cfg.command !== undefined) return 'stdio'
  throw new Error(`服务器 "${serverName}" 缺少 command（stdio）或 url（streamable-http）`)
}

// =====================================================================
// skill archive inspection（只解析，不写盘）
// =====================================================================

export interface SkillUploadParsed {
  name?: string
  description?: string
  whenToUse?: string
  instructions?: string
  resources?: string[]
}

/**
 * 解析上传的技能文件（zip / .skill / .md）为创建表单形状。不触碰文件系统。
 * @returns { ok: true, parsed } 或 { ok: false, error }。
 */
export function parseSkillUpload(fileName: string, buf: Buffer): { ok: true, parsed: SkillUploadParsed } | { ok: false, error: string } {
  const lower = String(fileName ?? '').toLowerCase()
  if (!buf || buf.length === 0) return { ok: false, error: '文件为空' }

  let entries: ZipEntry[] | null = null
  let text: string | null = null
  if (lower.endsWith('.zip') || lower.endsWith('.skill')) {
    try {
      entries = extractZip(buf)
    } catch (err) {
      return { ok: false, error: String((err as Error)?.message ?? err) }
    }
    // 优先根目录 SKILL.md，其次单层包裹目录内的 SKILL.md
    const candidates = entries.filter((e) => !e.dir && basename(e.name) === 'SKILL.md')
    let best: ZipEntry | null = null
    for (const e of candidates) {
      const depth = e.name.split('/').length - 1
      if (depth <= 1 && (best === null || depth < best.name.split('/').length - 1)) best = e
    }
    if (!best) {
      return { ok: false, error: '压缩包中未找到 SKILL.md（需位于根目录或一级子目录）' }
    }
    text = best.data?.toString('utf8') ?? ''
  } else if (lower.endsWith('.md')) {
    text = buf.toString('utf8')
  } else {
    return { ok: false, error: '不支持的文件类型：仅支持 .zip / .skill / .md' }
  }

  const doc = parseSkillDoc(text)
  const fallbackName = slugifyName(basename(String(fileName)).replace(/\.(md|zip|skill)$/i, ''))
  const parsed: SkillUploadParsed = {
    name: doc.name ?? fallbackName,
    description: doc.description ?? '',
    whenToUse: doc.whenToUse,
    instructions: doc.instructions ?? '',
  }
  if (entries) {
    parsed.resources = entries
      .filter((e) => !e.dir && basename(e.name) !== 'SKILL.md')
      .map((e) => e.name)
  }
  if (doc.error && !doc.name && !doc.instructions) {
    return { ok: false, error: `SKILL.md 解析失败: ${doc.error}` }
  }
  return { ok: true, parsed }
}

/** 组装 SKILL.md 正文（frontmatter + 指令；extra 保留自定义字段如 group）。 */
export function buildSkillMarkdown(input: {
  name: string
  description?: string
  whenToUse?: string
  instructions: string
  /** 额外 frontmatter 字段（编辑时保留原自定义字段，如 group / argument-hint）。 */
  extra?: Record<string, unknown>
}): string {
  const fm: Record<string, unknown> = { name: input.name }
  if (input.description && input.description.trim()) fm.description = input.description.trim()
  if (input.whenToUse && input.whenToUse.trim()) fm.whenToUse = input.whenToUse.trim()
  if (input.extra && typeof input.extra === 'object') {
    for (const [k, v] of Object.entries(input.extra)) {
      if (k === 'name' || k === 'description' || k === 'whenToUse') continue
      fm[k] = v
    }
  }
  const lines = ['---', ...Object.entries(fm).map(([k, v]) => `${k}: ${JSON.stringify(String(v))}`), '---', '']
  return `${lines.join('\n')}${input.instructions.trim()}\n`
}
