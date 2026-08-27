/**
 * dsh-legal-suite/skin — AgentLex DSH 外壳皮肤（host 半）。
 *
 * 提供「AgentLex 设置」设置项（欢迎语/品牌文案），并通过
 * /api/agentlex-skin/config 暴露给 client 半。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from 'schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'

export const name = 'dsh-legal-suite/skin'
export const inject = ['webServer']

export const AGENTLEX_SKIN_SETTINGS_NS = settingsNamespace('agentlex-legal-suite')

export interface Config {
  enabled?: boolean
  /** AgentLex 套件总开关：关闭后皮肤/三模块/技能工具/右边栏全部停用。 */
  agentlexEnabled?: boolean
  userName?: string
  brandEn?: string
  brandZh?: string
  skinEnabled?: boolean
  litigationEnabled?: boolean
  nonlitigationEnabled?: boolean
  taskEnabled?: boolean
  skillsToolsEnabled?: boolean
  workspaceSidebarEnabled?: boolean
  openReferencesInSidebar?: boolean
  theme?: string
  /** 会话排版：AI 输出与用户消息两端对齐显示。 */
  conversationJustify?: boolean
  /** 会话排版增强：行距段距与原生一致、可见背景块、彩色表头。 */
  conversationEnhance?: boolean
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  agentlexEnabled: z.boolean().default(true),
  userName: z.string().default('User'),
  brandEn: z.string().default('AgentLex'),
  brandZh: z.string().default('超级律师助理'),
  skinEnabled: z.boolean().default(true),
  litigationEnabled: z.boolean().default(true),
  nonlitigationEnabled: z.boolean().default(true),
  taskEnabled: z.boolean().default(true),
  skillsToolsEnabled: z.boolean().default(true),
  workspaceSidebarEnabled: z.boolean().default(true),
  openReferencesInSidebar: z.boolean().default(true),
  theme: z.string().default('warm'),
  conversationJustify: z.boolean().default(true),
  conversationEnhance: z.boolean().default(true),
})

function sendJson(res: ServerResponse, body: unknown): void {
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/** Module-level route ownership (see the apply comment for the reload race). */
interface HostRoute {
  token: object
  dispose: () => void
}

let activeRoute: HostRoute | undefined

/** Wipe the module-level route when it belongs to `owner`. */
function disposeSurface(owner: object): void {
  if (activeRoute !== undefined && activeRoute.token === owner) {
    activeRoute.dispose()
    activeRoute = undefined
  }
}

export function apply(ctx: Context, config: Config = {}): void {
  if (config.enabled === false) return

  // Module-level route ownership — cordis RELOADS the plugin fiber when an
  // injected service becomes available during boot (Fiber._reload re-runs
  // apply with fresh closures); per-apply effect-backed registration collides
  // on "duplicate exact route". Register at module level with synchronous
  // teardown; the token keeps the fiber-unload effect from wiping a newer
  // reload's surface.
  if (activeRoute !== undefined) { activeRoute.dispose(); activeRoute = undefined }
  const token = {}

  let current: () => Config = () => config
  let resolved: Config = {
    enabled: config.enabled ?? true,
    agentlexEnabled: config.agentlexEnabled ?? true,
    userName: config.userName ?? 'User',
    brandEn: config.brandEn ?? 'AgentLex',
    brandZh: config.brandZh ?? '超级律师助理',
    skinEnabled: config.skinEnabled ?? true,
    litigationEnabled: config.litigationEnabled ?? true,
    nonlitigationEnabled: config.nonlitigationEnabled ?? true,
    taskEnabled: config.taskEnabled ?? true,
    skillsToolsEnabled: config.skillsToolsEnabled ?? true,
    workspaceSidebarEnabled: config.workspaceSidebarEnabled ?? true,
    openReferencesInSidebar: config.openReferencesInSidebar ?? true,
    theme: config.theme ?? 'warm',
    conversationJustify: config.conversationJustify ?? true,
    conversationEnhance: config.conversationEnhance ?? true,
  }

  const sync = (): void => {
    const value = current()
    resolved = {
      enabled: value.enabled ?? true,
      userName: value.userName ?? 'User',
      brandEn: value.brandEn ?? 'AgentLex',
      brandZh: value.brandZh ?? '超级律师助理',
      skinEnabled: value.skinEnabled ?? true,
      litigationEnabled: value.litigationEnabled ?? true,
      nonlitigationEnabled: value.nonlitigationEnabled ?? true,
      taskEnabled: value.taskEnabled ?? true,
      skillsToolsEnabled: value.skillsToolsEnabled ?? true,
      workspaceSidebarEnabled: value.workspaceSidebarEnabled ?? true,
      openReferencesInSidebar: value.openReferencesInSidebar ?? true,
      theme: value.theme ?? 'warm',
      conversationJustify: value.conversationJustify ?? true,
      conversationEnhance: value.conversationEnhance ?? true,
    }
  }

  installSettingsSection(ctx, AGENTLEX_SKIN_SETTINGS_NS, Config, config, {
    setSource: (source) => { current = source; sync() },
    onChange: sync,
  })

  activeRoute = {
    token,
    dispose: ctx.webServer.register({
      kind: 'exact',
      path: '/api/agentlex-skin/config',
      handler: async (_req: IncomingMessage, res: ServerResponse) => {
        sendJson(res, { success: true, data: resolved })
      },
    }),
  }
  ctx.effect(() => () => { disposeSurface(token) }, 'dsh-legal-suite/skin: teardown')

  sync()
}
