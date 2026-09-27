/**
 * dsh-legal-suite/moot-court — host 半（模拟法庭）。
 *
 * 组装一个独立的业务域（与诉讼/非诉/任务域并列，由 src/index.ts 经 ctx.plugin
 * 挂载）：
 *   • 存储：$DSH_HOME/agentlex/moot-court（**与案件卷宗完全分离**，方案 §3）；
 *   • 引擎：host 侧状态机（engine/orchestrator.ts），经 ctx.llm.stream 调用部署
 *     模型路由，经 ctx.tools.execute 复用元典 MCP 与 legal_calc；
 *   • 路由：/api/agentlex-moot/*（面板用）；
 *   • 工具：moot_court（agent 用）；
 *   • 播报：systemPrompt 段落，含「不得向当事人承诺裁判结果」的硬口径。
 *
 * harness 兼容：settings 走 shared/settings-adapter.ts（0.1.6 走命名空间注册，
 * 0.1.7 走聚合条目的 volatile 字段）；`llm` 不进 inject，运行时惰性解析。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { installSettingsSection } from '../../shared/settings-adapter.ts'
import { createMootStore, type MootStore } from './store/session-store.ts'
import { createLlmGateway, type LlmGateway } from './engine/llm.ts'
import { createOrchestrator, type Orchestrator } from './engine/orchestrator.ts'
import { makeRoutes, MOOT_CHANGED_EVENT } from './routes.ts'
import { registerMootTool } from './tools.ts'
import { MOOT_DISCLAIMER } from './store/types.ts'

export const name = 'moot-court'

/** 所需服务：webServer（路由/SSE）、systemPrompt（播报）、tools（注册工具 + 调 MCP）、settings。 */
export const inject = ['webServer', 'systemPrompt', 'tools', 'settings']

/** 域设置命名空间（0.1.6 用；0.1.7 由聚合层登记读取器）。 */
export const MOOT_SETTINGS_NAMESPACE = 'agentlex-moot-court' as const

/** 插件配置（由聚合条目的 mootCourt* 字段拆解而来）。 */
export interface Config {
  /** 总开关。 */
  enabled?: boolean
  /** 数据目录覆盖（默认 $DSH_HOME/agentlex/moot-court）。 */
  dataDir?: string
  /** 诉讼域数据目录（读案件登记构建快照；默认 $DSH_HOME/agentlex/litigation）。 */
  litigationDir?: string
  /** 裁判者模型路由 "provider/model"，留空用部署默认。 */
  judgeModel?: string
  /** 对方代理人模型路由，留空同裁判者路由。 */
  opponentModel?: string
  /** 是否启用元典法条/类案锚定。 */
  retrievalEnabled?: boolean
  /** 默认最大辩论轮次。 */
  maxRounds?: number
  /** 默认 token 预算。 */
  tokenBudget?: number
  /** 默认单条发言 maxTokens。 */
  maxTokensPerTurn?: number
}

export const Config: z<Config> = z.object({
  // 实验性功能：默认关闭（聚合层传入的 mootCourtEnabled 为准）。
  enabled: z.boolean().default(false),
  dataDir: z.string().required(false),
  litigationDir: z.string().required(false),
  judgeModel: z.string().required(false),
  opponentModel: z.string().required(false),
  retrievalEnabled: z.boolean().default(true),
  maxRounds: z.number().default(2),
  tokenBudget: z.number().default(120_000),
  maxTokensPerTurn: z.number().default(2400),
})

/** 默认数据目录。 */
export function resolveDataDir(configured?: string): string {
  if (configured !== undefined && configured !== '') return configured
  const home = process.env.DSH_HOME ?? ''
  if (home !== '') return `${home}/agentlex/moot-court`
  const key = process.platform === 'win32' ? 'USERPROFILE' : 'HOME'
  return `${process.env[key] ?? '.'}/.dsh/agentlex/moot-court`
}

/** 默认诉讼域数据目录（案件登记的所在地）。 */
export function resolveLitigationDir(configured?: string): string {
  if (configured !== undefined && configured !== '') return configured
  const home = process.env.DSH_HOME ?? ''
  if (home !== '') return `${home}/agentlex/litigation`
  const key = process.platform === 'win32' ? 'USERPROFILE' : 'HOME'
  return `${process.env[key] ?? '.'}/.dsh/agentlex/litigation`
}

/** 模型可读的能力播报（含硬口径）。 */
const MOOT_GUIDANCE =
  '本机已安装 dsh-legal-suite 模拟法庭（moot-court）插件：可按现行法律与司法实践推演庭审，' +
  '支持民事一审、民事二审、劳动仲裁、商事仲裁（刑事不在范围）。使用 moot_court 工具：' +
  'action=prepare 检查材料、action=create 建会话、action=start 开庭、action=status/transcript 查看进度、' +
  'action=report 取报告与模拟判决书、action=writeback 把改进建议写入案件任务树。' +
  '三种模式：stress 文书压力测试（不开庭，直接给攻击面报告）、auto 全自动演练、rehearsal 单方预演（律师本人参与发言）。' +
  '产物只存放在模拟法庭自己的目录（$DSH_HOME/agentlex/moot-court），绝不写入案件卷宗。' +
  `硬口径：${MOOT_DISCLAIMER}不得据此向当事人承诺裁判结果。` +
  '用户提到「模拟法庭 / 开庭预演 / 庭审推演 / 攻击面 / 模拟判决」时即指本插件。'

/** 已挂载的 host 表面（单例，随配置变更重建）。 */
interface HostSurface {
  token: object
  store: MootStore
  orchestrator: Orchestrator
  dispose: () => void
}

let activeSurface: HostSurface | undefined

function disposeSurface(owner: object): void {
  if (activeSurface !== undefined && activeSurface.token === owner) {
    activeSurface.orchestrator.stopAll()
    activeSurface.dispose()
    activeSurface = undefined
  }
}

/** 当前活动的模拟法庭 store（供其它域/suite 读取，只读用途）。 */
export function activeMootStore(): MootStore | undefined {
  return activeSurface?.store
}

export function apply(ctx: Context, config: Config = {}): void {
  let current: () => Config = () => config
  const token = {}

  const resolve = (): Required<Pick<Config, 'enabled' | 'retrievalEnabled' | 'maxRounds' | 'tokenBudget' | 'maxTokensPerTurn'>> & Config => {
    const value = current()
    return {
      ...value,
      enabled: value.enabled ?? false,
      retrievalEnabled: value.retrievalEnabled ?? true,
      maxRounds: value.maxRounds ?? 2,
      tokenBudget: value.tokenBudget ?? 120_000,
      maxTokensPerTurn: value.maxTokensPerTurn ?? 2400,
    }
  }

  const sync = (): void => {
    if (activeSurface !== undefined) {
      activeSurface.orchestrator.stopAll()
      activeSurface.dispose()
      activeSurface = undefined
    }
    const value = resolve()
    if (!value.enabled) return

    const dataDir = resolveDataDir(value.dataDir)
    const litigationDir = resolveLitigationDir(value.litigationDir)
    const store = createMootStore(dataDir, ctx)
    const gateway: LlmGateway = createLlmGateway(ctx)
    const orchestrator = createOrchestrator({
      ctx,
      store,
      gateway,
      onChange: (sessionId, reason) => {
        // 广播给 SSE（面板实时刷新）。cordis 的 emit 类型按 Events 表收窄，
        // 自定义事件名走一次鸭子类型转换（与其它域的 ctx.on 同法）。
        try {
          const emitter = ctx as unknown as { emit?: (name: string, payload: unknown) => void }
          emitter.emit?.(MOOT_CHANGED_EVENT, { sessionId, reason, at: new Date().toISOString() })
        } catch {
          // 无监听者时 emit 失败不影响引擎。
        }
      },
    })

    const defaults = {
      ...(value.judgeModel === undefined || value.judgeModel === '' ? {} : { judgeModel: value.judgeModel }),
      ...(value.opponentModel === undefined || value.opponentModel === '' ? {} : { opponentModel: value.opponentModel }),
      retrievalEnabled: value.retrievalEnabled,
      maxRounds: value.maxRounds,
      tokenBudget: value.tokenBudget,
      maxTokensPerTurn: value.maxTokensPerTurn,
    }

    const disposeRoutes = makeRoutes({ ctx, store, orchestrator, gateway, litigationDir, defaults })
    const disposeTool = registerMootTool(ctx, { store, orchestrator, litigationDir, defaults })
    const disposePrompt = ctx.systemPrompt.section({
      name: 'plugin:agentlex-moot-court',
      order: 176,
      text: MOOT_GUIDANCE,
    })

    activeSurface = {
      token,
      store,
      orchestrator,
      dispose: () => {
        disposePrompt()
        disposeTool()
        disposeRoutes()
      },
    }
  }

  const disposeSettings = installSettingsSection(ctx, MOOT_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => { current = source; sync() },
    onChange: sync,
  })

  ctx.effect(() => () => {
    disposeSettings()
    disposeSurface(token)
  }, 'dsh-legal-suite/moot-court: teardown')

  sync()
}
