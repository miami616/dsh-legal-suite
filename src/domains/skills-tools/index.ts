/**
 * 技能与工具 — host half（真实技能落盘 + MCP 热加载 + CRUD 路由）。
 *
 * 能力（对齐 Jnpz v0.1.4 的实现）：
 *   • 技能管理：上传 zip/.skill/.md 解析 SKILL.md → 创建/编辑/删除/启停，
 *     写入 $DSH_HOME/skills/<name>/SKILL.md，DSH 自动发现、即时生效；
 *   • MCP 管理：粘贴 JSON 一键添加（批量 mcpServers 或单个对象），后台
 *     自动转换为 @deepseek-ai/dsh-mcp-client 实例并热加载（无需重启），
 *     支持编辑（同 serverName 覆盖）、删除、启停、实时连接状态；
 *     配置持久化在 $DSH_HOME/plugins/dsh-skill-config/state.json
 *     （与 Jnpz v0.1.4 同路径：已有 Jnpz 配置可直接继承）。
 *
 * 浏览器端经同源 POST 路由 /api/agentlex-skills/* 与本文件通信。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-tools'
import * as mcpClient from '@deepseek-ai/dsh-mcp-client'
import z from 'schemastery'
import { mkdir, readFile, writeFile, readdir, rm, rename, stat } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { homedir } from 'node:os'
import { dump as stringifyYaml } from 'js-yaml'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  extractZip,
  parseFrontmatter,
  parseSkillDoc,
  parseSkillUpload,
  normalizeMcpInput,
  slugifyName,
  hashString,
  buildSkillMarkdown,
  SKILL_NAME_PATTERN,
  type NormalizedMcpConfig,
} from './core.ts'
import { makeServerId, type McpServerEntry, type SkillsToolsState, type SkillSummary } from './types.ts'

export const name = 'dsh-legal-suite'
export const inject = ['webServer']

export interface Config {
  enabled?: boolean
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
})

const ROUTE_PREFIX = '/api/agentlex-skills'
const MAX_BODY_BYTES = 32 * 1024 * 1024
const STATUS_POLL_MS = 10000

/** 运行中的 MCP 实例记录。 */
interface RunningRecord {
  config: NormalizedMcpConfig
  fiber: Promise<unknown> | null
  status: 'connecting' | 'connected' | 'error'
  error: string | null
}

function dshHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function apply(ctx: Context, config: Config = {}): void {
  if (config.enabled === false) return
  ctx.inject(['webServer'], (scope) => {
    mount(scope).catch((error) => {
      scope.logger.warn(`agentlex-skills: setup failed: ${(error as Error)?.message ?? error}`)
    })
  })
}

async function mount(scope: Context): Promise<void> {
  const dshHomePath = dshHome()
  const stateDir = join(dshHomePath, 'plugins', 'dsh-skill-config')
  const stateFile = join(stateDir, 'state.json')
  const skillsDir = join(dshHomePath, 'skills')

  // ------------------------------------------------------------------
  // durable state: { servers: [ user entries ] }
  // 兼容 Jnpz v0.1.4 同路径 state.json：projectMcp / cordisDisabled 字段
  // 原样保留（本插件不管理项目级 MCP，但写回时不能丢掉对方的配置）。
  // ------------------------------------------------------------------
  interface PersistedServer {
    id: string
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
    /** 用户分组（缺省时按 URL 域名/命令基名自动派生）。 */
    group?: string
  }
  interface PersistedState {
    projectMcp?: unknown
    cordisDisabled?: unknown
    servers: PersistedServer[]
  }
  let state: PersistedState = { servers: [] }

  async function loadState(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(stateFile, 'utf8')) as PersistedState
      const servers = Array.isArray(raw?.servers) ? raw.servers : []
      state = {
        projectMcp: raw?.projectMcp,
        cordisDisabled: raw?.cordisDisabled,
        servers: servers.filter((s): s is PersistedServer => typeof s === 'object' && s !== null),
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        scope.logger.warn(`agentlex-skills: state load failed, starting fresh: ${(error as Error)?.message ?? error}`)
      }
    }
  }

  async function saveState(): Promise<void> {
    await mkdir(stateDir, { recursive: true })
    const tmp = `${stateFile}.tmp`
    const payload = {
      ...(state.projectMcp === undefined ? {} : { projectMcp: state.projectMcp }),
      ...(state.cordisDisabled === undefined ? {} : { cordisDisabled: state.cordisDisabled }),
      servers: state.servers,
    }
    await writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8')
    await rename(tmp, stateFile)
  }

  // ------------------------------------------------------------------
  // live MCP instances
  // ------------------------------------------------------------------
  const userRunning = new Map<string, { config: NormalizedMcpConfig; fiber: Promise<unknown> | null; status: 'connecting' | 'connected' | 'error'; error: string | null }>()

  function mcpConfigOf(entry: PersistedServer): NormalizedMcpConfig {
    const config: NormalizedMcpConfig = {
      serverName: entry.serverName,
      transport: entry.transport,
    }
    if (entry.transport === 'stdio') {
      config.command = entry.command ?? ''
      config.args = Array.isArray(entry.args) ? entry.args : []
      config.env = entry.env && typeof entry.env === 'object' ? entry.env : {}
      config.cwd = typeof entry.cwd === 'string' ? entry.cwd : ''
    } else {
      config.url = entry.url ?? ''
      config.headers = entry.headers && typeof entry.headers === 'object' ? entry.headers : {}
    }
    if (Number.isFinite(entry.toolCallTimeoutMs)) config.toolCallTimeoutMs = entry.toolCallTimeoutMs
    return config
  }

  function toolsForServer(serverName: string): boolean {
    try {
      const tools = scope.get('tools') as { view?: (arg?: unknown) => { knownNames?: Iterable<string> } } | undefined
      const view = tools && typeof tools.view === 'function' ? tools.view(undefined) : undefined
      if (!view || !view.knownNames) return false
      const prefix = `mcp__${serverName}__`
      for (const name of view.knownNames) if (name.startsWith(prefix)) return true
    } catch {
      /* tools service absent — keep previous status */
    }
    return false
  }

  function startServer(id: string, config: NormalizedMcpConfig): void {
    const existing = userRunning.get(id)
    if (existing) return
    const rec: RunningRecord = { config, fiber: null, status: 'connecting', error: null }
    userRunning.set(id, rec)
    let fiber: unknown
    try {
      fiber = (scope.plugin as unknown as (plugin: unknown, cfg: NormalizedMcpConfig) => unknown)(mcpClient, config)
    } catch (error) {
      rec.status = 'error'
      rec.error = String((error as Error)?.message ?? error)
      return
    }
    rec.fiber = Promise.resolve(fiber) as Promise<unknown>
    rec.fiber.then(
      () => {
        if (userRunning.get(id) !== rec) return
        const ok = toolsForServer(config.serverName)
        rec.status = ok ? 'connected' : 'error'
        rec.error = ok ? null : '连接失败或工具未同步，后台正在自动重试'
      },
      (error: unknown) => {
        if (userRunning.get(id) !== rec) return
        rec.status = 'error'
        rec.error = String((error as Error)?.message ?? error)
      },
    )
  }

  async function stopServer(id: string): Promise<void> {
    const rec = userRunning.get(id)
    if (!rec) return
    userRunning.delete(id)
    if (rec.fiber) {
      try {
        const fiber = await rec.fiber
        if (fiber && typeof (fiber as { dispose?: () => unknown }).dispose === 'function') {
          await (fiber as { dispose: () => Promise<void> }).dispose()
        }
      } catch {
        /* already disposing */
      }
    }
  }

  // 周期状态恢复（首次失败后重连可能成功）
  const poll = setInterval(() => {
    for (const rec of userRunning.values()) {
      if (rec.status === 'error' && toolsForServer(rec.config.serverName)) {
        rec.status = 'connected'
        rec.error = null
      }
    }
  }, STATUS_POLL_MS)
  poll.unref()

  // ------------------------------------------------------------------
  // cordis.patch.yml 内置 MCP（只读展示 + 运行时启停，不改用户 patch）
  // ------------------------------------------------------------------
  interface CordisEntry {
    id: string
    entryId: string
    serverName: string
    transport: 'stdio' | 'streamable-http'
    command?: string
    args?: string[]
    env?: Record<string, string>
    cwd?: string
    url?: string
    headers?: Record<string, string>
    enabled: boolean
    status: 'connected' | 'connecting' | 'error' | 'disabled'
    error?: string
    group?: string
  }

  function cordisMcpEntries(): CordisEntry[] {
    const out: CordisEntry[] = []
    try {
      const loader = scope.get('loader') as { entries?: () => Array<{ options?: Record<string, unknown>; disabled?: boolean; fiber?: unknown }> } | undefined
      if (!loader || typeof loader.entries !== 'function') return out
      for (const entry of loader.entries()) {
        const options = entry.options
        if (!options || options.name !== '@deepseek-ai/dsh-mcp-client' || options.group) continue
        const cfg = options.config as Record<string, unknown> | undefined
        if (!cfg || typeof cfg.serverName !== 'string') continue
        const active = !entry.disabled && entry.fiber !== undefined
        const connected = active && toolsForServer(cfg.serverName)
        const pub: CordisEntry = {
          id: `cordis:${String(options.id ?? '')}`,
          entryId: String(options.id ?? ''),
          serverName: cfg.serverName,
          transport: cfg.transport === 'streamable-http' ? 'streamable-http' : 'stdio',
          enabled: !entry.disabled,
          status: entry.disabled ? 'disabled' : connected ? 'connected' : active ? 'connecting' : 'error',
          error: undefined,
          group: '内置',
        }
        if (pub.transport === 'stdio') {
          pub.command = typeof cfg.command === 'string' ? cfg.command : ''
          pub.args = Array.isArray(cfg.args) ? (cfg.args as unknown[]).map(String) : []
          pub.env = typeof cfg.env === 'object' && cfg.env !== null ? cfg.env as Record<string, string> : {}
          pub.cwd = typeof cfg.cwd === 'string' ? cfg.cwd : ''
        } else {
          pub.url = typeof cfg.url === 'string' ? cfg.url : ''
          pub.headers = typeof cfg.headers === 'object' && cfg.headers !== null ? cfg.headers as Record<string, string> : {}
        }
        out.push(pub)
      }
    } catch {
      /* loader unavailable — no cordis view */
    }
    return out
  }

  function findCordisEntry(entryId: string): { update?: (patch: { disabled?: boolean }) => Promise<unknown> } | undefined {
    try {
      const loader = scope.get('loader') as { entries?: () => Array<{ options?: Record<string, unknown>; disabled?: boolean; update?: (patch: { disabled?: boolean }) => Promise<unknown> }> } | undefined
      if (!loader || typeof loader.entries !== 'function') return undefined
      return loader
        .entries()
        .find((entry) => entry.options && entry.options.id === entryId && entry.options.name === '@deepseek-ai/dsh-mcp-client')
    } catch {
      return undefined
    }
  }

  async function toggleCordisEntry(entryId: string, enabled: boolean): Promise<{ ok: boolean; error?: string }> {
    const entry = findCordisEntry(entryId)
    if (!entry) return { ok: false, error: `未找到 cordis 条目 "${entryId}"` }
    try {
      await entry.update?.({ disabled: !enabled })
    } catch (error) {
      return { ok: false, error: `切换失败: ${(error as Error)?.message ?? error}` }
    }
    return { ok: true }
  }

  // ------------------------------------------------------------------
  // skills
  // ------------------------------------------------------------------
  /** 启用的判定：disable-model-invocation !== true 且 user-invocable !== false。 */
  function skillInvocationEnabled(frontmatter: Record<string, unknown> | undefined): boolean {
    if (!frontmatter) return true
    const modelInvocable = frontmatter['disable-model-invocation'] !== true
    const userInvocable = frontmatter['user-invocable'] !== false
    return modelInvocable || userInvocable
  }

  /** 技能分组键：frontmatter group ?? metadata.author ?? 未分组。 */
  function skillGroupOf(frontmatter: Record<string, unknown> | undefined): string {
    if (frontmatter === undefined) return '未分组'
    const explicit = frontmatter['group']
    if (typeof explicit === 'string' && explicit.trim() !== '') return explicit.trim()
    const metadata = frontmatter['metadata']
    if (typeof metadata === 'object' && metadata !== null) {
      const author = (metadata as Record<string, unknown>)['author']
      if (typeof author === 'string' && author.trim() !== '') return author.trim()
    }
    return '未分组'
  }

  /** 作者：frontmatter metadata.author（缺省 undefined，卡片不显示作者标签）。 */
  function skillAuthorOf(frontmatter: Record<string, unknown> | undefined): string | undefined {
    if (frontmatter === undefined) return undefined
    const metadata = frontmatter['metadata']
    if (typeof metadata === 'object' && metadata !== null) {
      const author = (metadata as Record<string, unknown>)['author']
      if (typeof author === 'string' && author.trim() !== '') return author.trim()
    }
    const direct = frontmatter['author']
    if (typeof direct === 'string' && direct.trim() !== '') return direct.trim()
    return undefined
  }

  async function listSkills(): Promise<SkillSummary[]> {
    const out: SkillSummary[] = []
    let entries: Dirent[] = []
    try {
      entries = await readdir(skillsDir, { withFileTypes: true })
    } catch {
      return out
    }
    for (const entry of entries) {
      try {
        if (entry.isDirectory()) {
          if (entry.name === '.system') continue
          const path = join(skillsDir, entry.name, 'SKILL.md')
          const raw = await readFile(path, 'utf8')
          const doc = parseSkillDoc(raw)
          out.push({
            name: doc.name ?? entry.name,
            description: doc.description ?? '',
            whenToUse: doc.whenToUse,
            instructions: doc.instructions ?? '',
            group: skillGroupOf(doc.frontmatter),
            author: skillAuthorOf(doc.frontmatter),
            enabled: skillInvocationEnabled(doc.frontmatter),
            path,
            updatedAt: (await stat(path)).mtimeMs,
          })
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          const path = join(skillsDir, entry.name)
          const raw = await readFile(path, 'utf8')
          const doc = parseSkillDoc(raw)
          out.push({
            name: doc.name ?? entry.name.replace(/\.md$/, ''),
            description: doc.description ?? '',
            whenToUse: doc.whenToUse,
            instructions: doc.instructions ?? '',
            group: skillGroupOf(doc.frontmatter),
            author: skillAuthorOf(doc.frontmatter),
            enabled: skillInvocationEnabled(doc.frontmatter),
            path,
            updatedAt: (await stat(path)).mtimeMs,
          })
        }
      } catch {
        /* 不可读技能 — 跳过 */
      }
    }
    out.sort((a, b) => a.name.localeCompare(b.name))
    return out
  }

  async function skillsParse(body: { fileName?: string; dataBase64?: string }): Promise<{ ok: boolean; error?: string; parsed?: unknown }> {
    const fileName = String(body.fileName ?? '')
    const data = String(body.dataBase64 ?? '')
    let buf: Buffer
    try {
      buf = Buffer.from(data, 'base64')
    } catch {
      return { ok: false, error: '文件内容解码失败' }
    }
    const result = parseSkillUpload(fileName, buf)
    if (!result.ok) return { ok: false, error: result.error }
    return { ok: true, parsed: result.parsed }
  }

  async function skillsCreate(body: {
    name?: string
    fileName?: string
    dataBase64?: string
    description?: string
    instructions?: string
    group?: string
    overwrite?: boolean
  }): Promise<{ ok: boolean; error?: string; name?: string; state?: SkillsToolsState }> {
    let name = slugifyName(String(body.name ?? '').trim())
    if (!name && body.fileName) {
      name = slugifyName(basename(String(body.fileName)).replace(/\.(md|zip|skill)$/i, ''))
    }
    if (!SKILL_NAME_PATTERN.test(name)) {
      return { ok: false, error: '技能名称无效：仅支持小写字母、数字与连字符（如 "codemap"）' }
    }
    const description = String(body.description ?? '').trim()
    const instructions = String(body.instructions ?? '').trim()
    if (!instructions) return { ok: false, error: '指令不能为空' }

    // 可选：压缩包内资源一并落盘（SKILL.md 由表单重新生成）
    let entries: Awaited<ReturnType<typeof extractZip>> | null = null
    if (body.fileName && body.dataBase64) {
      const lower = String(body.fileName).toLowerCase()
      if (lower.endsWith('.zip') || lower.endsWith('.skill')) {
        try {
          entries = extractZip(Buffer.from(String(body.dataBase64), 'base64'))
        } catch (error) {
          return { ok: false, error: `压缩包解析失败: ${(error as Error)?.message ?? error}` }
        }
      }
    }

    const target = join(skillsDir, name)
    const exists = await pathExists(target)
    if (exists && body.overwrite !== true) {
      return { ok: false, error: `技能 "${name}" 已存在；可先删除后再创建，或勾选覆盖更新` }
    }
    if (exists) await rm(target, { recursive: true, force: true })

    await mkdir(target, { recursive: true })
    if (entries) {
      for (const entry of entries) {
        if (entry.dir) continue
        if (basename(entry.name) === 'SKILL.md') continue
        const dest = join(target, entry.name)
        await mkdir(dirname(dest), { recursive: true })
        await writeFile(dest, entry.data as Buffer)
      }
    }
    const skillMd = buildSkillMarkdown({
      name,
      description,
      instructions,
      extra: groupOf(body.group),
    })
    await writeFile(join(target, 'SKILL.md'), skillMd, 'utf8')
    return { ok: true, name, state: await buildState() }
  }

  async function skillsRead(body: { name?: string }): Promise<{ ok: boolean; error?: string; name?: string; description?: string; instructions?: string; group?: string }> {
    const name = String(body.name ?? '').trim()
    if (!SKILL_NAME_PATTERN.test(name)) return { ok: false, error: `无效的技能名称 "${name}"` }
    const dirPath = join(skillsDir, name, 'SKILL.md')
    const flatPath = join(skillsDir, `${name}.md`)
    let path: string | null = null
    if (await pathExists(dirPath)) path = dirPath
    else if (await pathExists(flatPath)) path = flatPath
    if (!path) return { ok: false, error: `未找到技能 "${name}"` }
    const doc = parseSkillDoc(await readFile(path, 'utf8'))
    return {
      ok: true,
      name: doc.name ?? name,
      description: doc.description ?? '',
      instructions: doc.instructions ?? '',
      group: skillGroupOf(doc.frontmatter),
    }
  }

  async function skillsUpdate(body: { name?: string; newName?: string; description?: string; instructions?: string; group?: string }): Promise<{ ok: boolean; error?: string; state?: SkillsToolsState }> {
    const name = String(body.name ?? '').trim()
    if (!SKILL_NAME_PATTERN.test(name)) return { ok: false, error: `无效的技能名称 "${name}"` }

    const dirPath = join(skillsDir, name, 'SKILL.md')
    const flatPath = join(skillsDir, `${name}.md`)
    let path: string | null = null
    let isFlat = false
    if (await pathExists(dirPath)) path = dirPath
    else if (await pathExists(flatPath)) {
      path = flatPath
      isFlat = true
    }
    if (!path) return { ok: false, error: `未找到技能 "${name}"` }

    let newName = name
    if (typeof body.newName === 'string' && body.newName.trim() !== '') {
      const slug = slugifyName(body.newName)
      if (!slug) {
        return { ok: false, error: '新技能名称需包含字母或数字（将自动转为小写连字符格式，如 codemap）' }
      }
      newName = slug
    }

    if (newName !== name) {
      const newDir = join(skillsDir, newName)
      const newFlat = join(skillsDir, `${newName}.md`)
      if ((await pathExists(newDir)) || (await pathExists(newFlat))) {
        return { ok: false, error: `技能 "${newName}" 已存在` }
      }
      if (isFlat) await rename(flatPath, newFlat)
      else await rename(dirname(path), newDir)
    }

    const targetPath = isFlat ? join(skillsDir, `${newName}.md`) : join(skillsDir, newName, 'SKILL.md')
    const raw = await readFile(targetPath, 'utf8')
    let fm = parseFrontmatter(raw)
    if (!fm) fm = { data: {}, body: raw.replace(/^\s+/, '') }
    const instructions = String(body.instructions ?? fm.body ?? '').trim()
    // 保留原 frontmatter 的自定义字段（argument-hint / metadata 等）；
    // group 由表单值覆盖（未传时保留原值）。
    const extra: Record<string, unknown> = { ...fm.data }
    delete extra.name
    delete extra.description
    delete extra.whenToUse
    if (body.group !== undefined) {
      const g = String(body.group).trim()
      if (g === '') delete extra.group
      else extra.group = g
    } else {
      delete extra.group
      const original = skillGroupOf(fm.data)
      if (original !== '未分组') extra.group = original
    }
    const skillMd = buildSkillMarkdown({
      name: newName,
      description: String(body.description ?? String(fm.data.description ?? '')).trim(),
      instructions,
      extra,
    })
    await writeFile(targetPath, skillMd, 'utf8')
    return { ok: true, state: await buildState() }
  }

  async function skillsRemove(body: { name?: string }): Promise<{ ok: boolean; error?: string; state?: SkillsToolsState }> {
    const name = String(body.name ?? '').trim()
    if (!SKILL_NAME_PATTERN.test(name)) return { ok: false, error: `无效的技能名称 "${name}"` }
    let removed = false
    const dir = join(skillsDir, name)
    if (await pathExists(dir)) {
      await rm(dir, { recursive: true, force: true })
      removed = true
    }
    const flat = join(skillsDir, `${name}.md`)
    if (await pathExists(flat)) {
      await rm(flat, { force: true })
      removed = true
    }
    if (!removed) return { ok: false, error: `未找到技能 "${name}"` }
    return { ok: true, state: await buildState() }
  }

  async function skillsToggle(body: { name?: string; enabled?: boolean }): Promise<{ ok: boolean; error?: string; state?: SkillsToolsState }> {
    const name = String(body.name ?? '').trim()
    if (!SKILL_NAME_PATTERN.test(name)) return { ok: false, error: `无效的技能名称 "${name}"` }
    const enable = body.enabled !== false

    const dirPath = join(skillsDir, name, 'SKILL.md')
    const flatPath = join(skillsDir, `${name}.md`)
    let path: string | null = null
    if (await pathExists(dirPath)) path = dirPath
    else if (await pathExists(flatPath)) path = flatPath
    if (!path) return { ok: false, error: `未找到技能 "${name}"` }

    const raw = await readFile(path, 'utf8')
    let fm = parseFrontmatter(raw)
    if (!fm) fm = { data: {}, body: raw.replace(/^\s+/, '') }
    if (enable) {
      delete fm.data['disable-model-invocation']
      delete fm.data['user-invocable']
    } else {
      fm.data['disable-model-invocation'] = true
      fm.data['user-invocable'] = false
    }
    const rewritten =
      '---\n' + stringifyYaml(fm.data).replace(/\s+$/, '') + '\n---\n\n' + String(fm.body).trimStart() + '\n'
    await writeFile(path, rewritten, 'utf8')
    return { ok: true, state: await buildState() }
  }

  // ------------------------------------------------------------------
  // state projection
  // ------------------------------------------------------------------
  /** MCP 分组：stdio 按命令基名；HTTP 按 URL 域名；cordis 为内置。 */
  function mcpGroupOf(entry: PersistedServer): string {
    if (typeof entry.group === 'string' && entry.group.trim() !== '') return entry.group.trim()
    if (entry.transport === 'stdio') {
      const cmd = (entry.command ?? '').trim()
      if (cmd === '') return '本地命令'
      const base = basename(cmd).replace(/\.(exe|cmd|bat|sh|bin)$/i, '')
      return base || '本地命令'
    }
    const url = (entry.url ?? '').trim()
    try {
      const host = new URL(url).hostname
      return host || 'HTTP 服务'
    } catch {
      return 'HTTP 服务'
    }
  }

  function publicServer(entry: PersistedServer): McpServerEntry {
    const rec = userRunning.get(entry.id)
    const enabled = entry.enabled !== false
    const pub: McpServerEntry = {
      id: entry.id,
      serverName: entry.serverName,
      transport: entry.transport,
      enabled,
      status: !enabled ? 'disabled' : rec ? rec.status : 'error',
      error: rec?.error ?? undefined,
      group: mcpGroupOf(entry),
    }
    if (entry.transport === 'stdio') {
      pub.command = entry.command
      pub.args = Array.isArray(entry.args) ? entry.args : []
      pub.env = entry.env ?? {}
      pub.cwd = entry.cwd ?? ''
    } else {
      pub.url = entry.url
      pub.headers = entry.headers ?? {}
    }
    return pub
  }

  async function buildState(): Promise<SkillsToolsState> {
    const servers: McpServerEntry[] = []
    for (const entry of state.servers) servers.push(publicServer(entry))
    for (const server of cordisMcpEntries()) {
      servers.push({ ...server, id: server.id })
    }
    return { skills: await listSkills(), mcp: servers }
  }

  /** 归一化分组输入（空 → undefined）。 */
  function groupOf(value: unknown): Record<string, unknown> | undefined {
    const g = String(value ?? '').trim()
    return g === '' ? undefined : { group: g }
  }

  // ------------------------------------------------------------------
  // endpoint handlers
  // ------------------------------------------------------------------
  async function mcpAdd(body: { json?: unknown }): Promise<{ ok: boolean; error?: string; results?: Array<{ serverName: string; updated: boolean }>; state?: SkillsToolsState }> {
    let normalized: NormalizedMcpConfig[]
    try {
      normalized = normalizeMcpInput(body.json)
    } catch (error) {
      return { ok: false, error: String((error as Error)?.message ?? error) }
    }
    if (normalized.length === 0) return { ok: false, error: '未解析到任何服务器配置' }
    const results: Array<{ serverName: string; updated: boolean }> = []
    for (const config of normalized) {
      const existing = state.servers.find((s) => s.serverName === config.serverName)
      if (existing) {
        const enabled = config.enabled === undefined ? existing.enabled : config.enabled
        Object.assign(existing, config, { enabled: enabled !== false })
        results.push({ serverName: config.serverName, updated: true })
      } else {
        const entry: PersistedServer = {
          id: makeServerId(config.serverName),
          ...config,
          enabled: config.enabled !== false,
        }
        state.servers.push(entry)
        results.push({ serverName: config.serverName, updated: false })
      }
    }
    await saveState()
    // (re)start / stop affected instances
    for (const config of normalized) {
      const entry = state.servers.find((s) => s.serverName === config.serverName)
      if (!entry) continue
      const running = userRunning.get(entry.id)
      const changed = running && JSON.stringify(running.config) !== JSON.stringify(mcpConfigOf(entry))
      if (changed) await stopServer(entry.id)
      if (entry.enabled !== false) startServer(entry.id, mcpConfigOf(entry))
      else await stopServer(entry.id)
    }
    return { ok: true, results, state: await buildState() }
  }

  async function mcpRemove(body: { id?: string }): Promise<{ ok: boolean; error?: string; state?: SkillsToolsState }> {
    const id = String(body.id ?? '')
    const at = state.servers.findIndex((s) => s.id === id)
    if (at < 0) return { ok: false, error: `未找到服务器 "${id}"` }
    await stopServer(id)
    state.servers.splice(at, 1)
    await saveState()
    return { ok: true, state: await buildState() }
  }

  async function mcpToggle(body: { id?: string; entryId?: string; source?: string; enabled?: boolean }): Promise<{ ok: boolean; error?: string; state?: SkillsToolsState }> {
    const source = body.source === 'cordis' ? 'cordis' : 'user'
    if (source === 'cordis') {
      const result = await toggleCordisEntry(String(body.entryId ?? body.id ?? '').replace(/^cordis:/, ''), body.enabled !== false)
      if (!result.ok) return { ok: false, error: result.error }
      return { ok: true, state: await buildState() }
    }
    const id = String(body.id ?? '')
    const entry = state.servers.find((s) => s.id === id)
    if (!entry) return { ok: false, error: `未找到服务器 "${id}"` }
    entry.enabled = body.enabled !== false
    await saveState()
    if (entry.enabled) startServer(id, mcpConfigOf(entry))
    else await stopServer(id)
    return { ok: true, state: await buildState() }
  }

  /** 设置单个 MCP 的分组（空串 → 回退自动派生）。 */
  async function mcpSetGroup(body: { id?: string; group?: string }): Promise<{ ok: boolean; error?: string; state?: SkillsToolsState }> {
    const id = String(body.id ?? '')
    const entry = state.servers.find((s) => s.id === id)
    if (!entry) return { ok: false, error: `未找到服务器 "${id}"` }
    const g = String(body.group ?? '').trim()
    if (g === '') delete entry.group
    else entry.group = g
    await saveState()
    return { ok: true, state: await buildState() }
  }

  /** 重命名分组（组内所有条目批量改到新组；空目标 = 移入「未分组/其他」）。 */
  async function groupsRename(body: { kind?: string; from?: string; to?: string }): Promise<{ ok: boolean; error?: string; state?: SkillsToolsState }> {
    const kind = body.kind === 'mcp' ? 'mcp' : 'skill'
    const from = String(body.from ?? '').trim()
    const to = String(body.to ?? '').trim()
    if (from === '') return { ok: false, error: '缺少原分组名' }

    if (kind === 'mcp') {
      // MCP:匹配「显式 group」或「自动派生等于 from」的条目
      for (const entry of state.servers) {
        const current = mcpGroupOf(entry)
        if (current !== from) continue
        if (to === '') delete entry.group
        else entry.group = to
      }
      await saveState()
      return { ok: true, state: await buildState() }
    }

    // 技能:逐个重写 SKILL.md frontmatter 的 group(保留其他字段)
    let renamed = 0
    for (const entry of await readdir(skillsDir, { withFileTypes: true })) {
      try {
        let path: string | null = null
        if (entry.isDirectory() && entry.name !== '.system') {
          const p = join(skillsDir, entry.name, 'SKILL.md')
          if (await pathExists(p)) path = p
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          path = join(skillsDir, entry.name)
        }
        if (path === null) continue
        const raw = await readFile(path, 'utf8')
        const doc = parseSkillDoc(raw)
        if (skillGroupOf(doc.frontmatter) !== from) continue
        const fm = doc.frontmatter ?? {}
        if (to === '') delete fm['group']
        else fm['group'] = to
        await writeFile(path, buildSkillMarkdown({
          name: doc.name ?? entry.name,
          description: String(doc.description ?? ''),
          instructions: doc.instructions ?? '',
          extra: fm,
        }), 'utf8')
        renamed += 1
      } catch {
        /* 单技能失败跳过 */
      }
    }
    if (renamed === 0) return { ok: false, error: `没有技能处于分组「${from}」` }
    return { ok: true, state: await buildState() }
  }

  async function dispatch(sub: string, body: Record<string, unknown>): Promise<unknown> {
    switch (sub) {
      case '':
      case '/state':
        return { ok: true, state: await buildState() }
      case '/mcp.add':
        return await mcpAdd(body as { json?: unknown })
      case '/mcp.remove':
        return await mcpRemove(body as { id?: string })
      case '/mcp.toggle':
        return await mcpToggle(body as { id?: string; entryId?: string; source?: string; enabled?: boolean })
      case '/mcp.group':
        return await mcpSetGroup(body as { id?: string; group?: string })
      case '/groups.rename':
        return await groupsRename(body as { kind?: string; from?: string; to?: string })
      case '/skills.parse':
        return await skillsParse(body as { fileName?: string; dataBase64?: string })
      case '/skills.create':
        return await skillsCreate(body as { fileName?: string; dataBase64?: string; name?: string; description?: string; instructions?: string; group?: string; overwrite?: boolean })
      case '/skills.remove':
        return await skillsRemove(body as { name?: string })
      case '/skills.toggle':
        return await skillsToggle(body as { name?: string; enabled?: boolean })
      case '/skills.read':
        return await skillsRead(body as { name?: string })
      case '/skills.update':
        return await skillsUpdate(body as { name?: string; newName?: string; description?: string; instructions?: string; group?: string })
      default:
        return { ok: false, error: `未知端点 "${sub}"` }
    }
  }

  // ------------------------------------------------------------------
  // HTTP plumbing
  // ------------------------------------------------------------------
  async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
      size += (chunk as Buffer).length
      if (size > MAX_BODY_BYTES) throw new Error('请求体过大')
      chunks.push(chunk as Buffer)
    }
    if (chunks.length === 0) return {}
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
  }

  function send(res: ServerResponse, status: number, payload: unknown): void {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(payload))
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let pathname: string
    try {
      pathname = new URL(req.url ?? '/', 'http://x').pathname
    } catch {
      send(res, 400, { ok: false, error: 'bad request' })
      return
    }
    const sub = pathname === ROUTE_PREFIX ? '' : pathname.slice(ROUTE_PREFIX.length)
    if (req.method !== 'POST') {
      send(res, 405, { ok: false, error: 'method not allowed' })
      return
    }
    const mediaType = String(req.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase()
    if (mediaType !== 'application/json') {
      send(res, 415, { ok: false, error: 'content type must be application/json' })
      return
    }
    let body: Record<string, unknown>
    try {
      body = await readJson(req)
    } catch {
      send(res, 400, { ok: false, error: 'invalid JSON body' })
      return
    }
    let out: unknown
    try {
      out = await dispatch(sub, body ?? {})
    } catch (error) {
      scope.logger.warn(`agentlex-skills: ${sub || '/state'} failed: ${(error as Error)?.message ?? error}`)
      out = { ok: false, error: String((error as Error)?.message ?? error) }
    }
    send(res, 200, out)
  }

  const disposeRoute = scope.webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: handle,
  })
  scope.effect(() => disposeRoute, 'agentlex-skills: routes')

  scope.effect(
    () => async () => {
      clearInterval(poll)
      for (const id of [...userRunning.keys()]) await stopServer(id)
    },
    'agentlex-skills: teardown',
  )

  // ------------------------------------------------------------------
  // boot：恢复持久化服务器并启动
  // ------------------------------------------------------------------
  await loadState()
  for (const entry of state.servers) {
    if (entry.enabled !== false) startServer(entry.id, mcpConfigOf(entry))
  }
  scope.logger.info(`agentlex-skills: ready — ${state.servers.length} persisted MCP server(s), skills at ${skillsDir}`)
}
