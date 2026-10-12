/**
 * dsh-legal-suite/redact — 本地脱敏域（host 半）。
 *
 * 提供：agent 工具 `redact`（scan/redact/restore/词条/映射/配置）+
 * REST 路由（/api/agentlex-redact/*）。引擎纯本地（无网络、无模型），
 * 识别 = 规则（含官方校验位）+ 案件库白名单词典 + 锚点启发（只报告）。
 *
 * 两个平面（与 litigation 同构，绝不能互相拆台）：
 *   - host 平面（agentPreset=false）：路由 + store + 工具 + 提示词；
 *   - agent-preset 平面（agentPreset=true）：只注册 scoped 工具，execute 走宿主
 *     HTTP 路由（/api/agentlex-redact/*），不带路由/store。用于把脱敏带进
 *     「诉讼管家 / 非诉管家」会话。
 *
 * 数据：$DSH_HOME/agentlex/redact/（mappings/<scope>.json 为机密级，0600）。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { homedir } from 'node:os'
import z from '@deepseek-ai/schemastery'
import { installSettingsSection } from '../../shared/settings-adapter.ts'
import { createRedactStore } from './store/redact-store.ts'
import { makeRoutes } from './routes.ts'
import { registerRedactHttpTool, registerRedactTool } from './tools.ts'
import type { ServiceDeps } from './service.ts'

export const name = 'dsh-legal-suite/redact'

/** Services required before the redact surfaces can mount. */
export const inject = ['webServer', 'settings', 'systemPrompt', 'tools']

export const REDACT_SETTINGS_NAMESPACE = 'agentlex-redact' as const

/** Model-facing announcement: 何时该脱敏、以及映射表纪律。 */
const REDACT_GUIDANCE =
  '本机已安装 dsh-legal-suite 本地脱敏能力（工具 `redact`）：把案件材料里的身份证号、手机号、' +
  '当事人与公司名、案号、法官/法院等身份信息在**本机**替换后再外发。准备把材料内容发往云端模型、' +
  '对外提供、演示或投稿前，先调用 `redact`（text 或 path + scope=案件编号）；只想预检调用 scan；' +
  '需拿回原文（reversible 模式）调用 restore。识别规则+案件库词典全部本地运行，不联网、不上传。' +
  '纪律：$DSH_HOME/agentlex/redact/mappings/ 下的映射表含原文，属本机机密——绝不写进对外内容、' +
  '绝不推送、绝不贴进会话；扫描件/PDF 先经 vision-ocr 或 pdftotext 转成文本再脱敏。'

export interface Config {
  /** Master switch. */
  enabled?: boolean
  /** 脱敏数据目录（默认 $DSH_HOME/agentlex/redact）。 */
  dataDir?: string
  /** 诉讼数据目录（词典源，默认 $DSH_HOME/agentlex/litigation）。 */
  litigationDir?: string
  /** 非诉数据目录（词典源，默认 $DSH_HOME/agentlex/nonlitigation）。 */
  nonlitigationDir?: string
  /** Agent-preset 平面：只注册 scoped 工具（走宿主 HTTP 路由），不挂路由/store。 */
  agentPreset?: boolean
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  dataDir: z.string().required(false),
  litigationDir: z.string().required(false),
  nonlitigationDir: z.string().required(false),
  agentPreset: z.boolean().default(false),
})

/** URL 形态的值不是合法目录路径。 */
const URLISH_PATH = /^[a-z][a-z0-9+.-]*:\/\//i

function dshHome(): string {
  const home = process.env.DSH_HOME ?? ''
  if (home !== '') return home
  const os = process.platform === 'win32' ? 'USERPROFILE' : 'HOME'
  return `${process.env[os] ?? homedir()}/.dsh`
}

/** Resolve the redact data directory. */
export function resolveDataDir(configured?: string): string {
  if (configured !== undefined && configured !== '' && !URLISH_PATH.test(configured.trim())) return configured
  return `${dshHome()}/agentlex/redact`
}

/** 词典源目录：显式配置优先，否则 $DSH_HOME/agentlex/<域>（与各域默认一致）。 */
function resolveAuxDir(configured: string | undefined, fallback: string): string {
  if (configured !== undefined && configured !== '' && !URLISH_PATH.test(configured.trim())) return configured
  return `${dshHome()}/agentlex/${fallback}`
}

/**
 * Module-level surface registry, SPLIT BY PLANE（同 litigation 的做法）。
 *
 * 本插件在同一进程里会被挂两次：host 行（routes/store/工具）与「诉讼管家」
 * preset 行（agentPreset: true——只注册 scoped 工具）。两个平面绝不共用槽位，
 * 否则 preset 的 apply 会把 host 的路由拆掉（0.1.17 类事故）。每个平面对
 * fiber reload 也各自持有 token，只清自己的那份。
 */
interface Surface {
  token: object
  dispose: () => void
}

let hostSurface: Surface | undefined
let presetSurface: Surface | undefined

function disposeSurfaceWhenOwned(slot: Surface | undefined, owner: object): Surface | undefined {
  if (slot !== undefined && slot.token === owner) {
    slot.dispose()
    return undefined
  }
  return slot
}

export function apply(ctx: Context, config: Config = {}): void {
  let current: () => Config = () => config
  const resolve = (): Config => ({
    enabled: current().enabled ?? true,
    dataDir: current().dataDir,
    litigationDir: current().litigationDir,
    nonlitigationDir: current().nonlitigationDir,
    agentPreset: current().agentPreset === true,
  })
  const token = {}

  const sync = (): void => {
    const value = resolve()
    const isPreset = value.agentPreset === true

    // 先同步拆掉「本平面」上一次的注册（另一平面原样保留）。
    if (isPreset) {
      presetSurface = disposeSurfaceWhenOwned(presetSurface, presetSurface?.token ?? token)
      presetSurface = undefined
    } else {
      hostSurface = disposeSurfaceWhenOwned(hostSurface, hostSurface?.token ?? token)
      hostSurface = undefined
    }
    if (!value.enabled) return

    // agent-preset 平面：只注册 scoped 工具（execute 走宿主 HTTP 路由）。
    if (isPreset) {
      presetSurface = { token, dispose: registerRedactHttpTool(ctx) }
      return
    }

    const dataDir = resolveDataDir(value.dataDir)
    const store = createRedactStore(dataDir, ctx)
    const deps: ServiceDeps = {
      store,
      dataDir,
      dirs: {
        litigationDir: resolveAuxDir(value.litigationDir, 'litigation'),
        nonlitigationDir: resolveAuxDir(value.nonlitigationDir, 'nonlitigation'),
      },
    }
    // 路由、工具与系统提示随同一 surface 启停。
    const disposers: Array<() => void> = []
    disposers.push(makeRoutes(ctx, deps))
    disposers.push(registerRedactTool(ctx, deps))
    disposers.push(ctx.systemPrompt.section({
      name: 'plugin:agentlex-redact',
      order: 175,
      text: REDACT_GUIDANCE,
    }))
    hostSurface = {
      token,
      dispose: () => { for (const dispose of disposers.splice(0).reverse()) dispose() },
    }
  }

  // settings 注册失败绝不中断路由/工具注册（0.1.17 教训）。
  const disposeSettings = installSettingsSection(ctx, REDACT_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => { current = source; sync() },
    onChange: sync,
  })

  // Fiber-unload 兜底：只拆本 apply 所属平面的 surface。
  ctx.effect(() => () => {
    disposeSettings()
    hostSurface = disposeSurfaceWhenOwned(hostSurface, token)
    presetSurface = disposeSurfaceWhenOwned(presetSurface, token)
  }, 'dsh-legal-suite/redact: teardown')

  sync()
}
