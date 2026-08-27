/**
 * 技能与工具 — 共享数据模型（host store 与客户端共用）。
 *
 * 两类资源：
 *   • 技能（skill）：真实写入 ~/.dsh/skills/<name>/SKILL.md 的 DSH 技能，
 *     DSH 自动发现、即时生效；启停通过 frontmatter 的
 *     `disable-model-invocation` 实现。
 *   • 工具（mcp）：由本插件热加载的 MCP 服务器（ctx.plugin(dsh-mcp-client)），
 *     配置持久化在 $DSH_HOME/plugins/dsh-skill-config/state.json。
 */

/** 技能条目（来自 ~/.dsh/skills 扫描）。 */
export interface SkillSummary {
  /** 技能目录名（小写连字符，即 SKILL_NAME）。 */
  name: string
  /** SKILL.md frontmatter 描述。 */
  description?: string
  /** SKILL.md frontmatter whenToUse。 */
  whenToUse?: string
  /** SKILL.md 正文（指令）。 */
  instructions?: string
  /** 目录下的资源文件（相对路径，不含 SKILL.md）。 */
  resources?: string[]
  /** 分组（frontmatter group ?? metadata.author ?? 未分组）。 */
  group?: string
  /** 作者（frontmatter metadata.author；缺省不显示标签）。 */
  author?: string
  /** 是否启用（disable-model-invocation 为 false/缺省 → 启用）。 */
  enabled: boolean
  /** 技能目录绝对路径。 */
  path: string
  /** SKILL.md 修改时间（ms）。 */
  updatedAt: number
}

/** MCP 服务器条目（用户添加，热加载）。 */
export interface McpServerEntry {
  /** 稳定 id（slug + 随机后缀）。 */
  id: string
  /** mcp-client serverName（工具名命名空间前缀）。 */
  serverName: string
  transport: 'stdio' | 'streamable-http'
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  headers?: Record<string, string>
  toolCallTimeoutMs?: number
  /** 用户开关（false = 停用，不启动连接）。 */
  enabled: boolean
  /** 运行时连接状态。 */
  status: 'connected' | 'connecting' | 'error' | 'disabled'
  /** 状态错误信息（status=error 时）。 */
  error?: string
  /** 来源：cordis.patch.yml 内置服务器（只读启停）。 */
  cordis?: boolean
  /** 分组（内置 / URL 域名 / 命令基名）。 */
  group?: string
}

/** 技能与工具整体状态（一次 GET 返回）。 */
export interface SkillsToolsState {
  skills: SkillSummary[]
  mcp: McpServerEntry[]
}

/** 生成稳定 id（slug + 随机后缀）。 */
export function makeServerId(serverName: string): string {
  const slug = serverName.trim().toLowerCase().replace(/[^\w-]+/g, '-').slice(0, 24) || 'server'
  return `${slug}-${Math.random().toString(36).slice(2, 7)}`
}
