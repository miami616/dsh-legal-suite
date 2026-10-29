/**
 * dsh-legal-suite — 法律事务 DSH 套件（单插件合包版）。
 *
 * 本包是「真·单插件」：cordis.patch.yml 只插入一个 entry（agentlex），
 * 由本聚合插件在 apply 内用 ctx.plugin() 嵌套挂载各业务域（诉讼/非诉/任务/
 * 皮肤/技能与工具）与套件自身。等价于旧版 6 个独立 entry 的运行时行为：
 * 每个子域获得独立 fiber，各自的 settings section、路由、agent preset
 * 注册互不干扰。
 *
 * 配置：为兼容旧版各 entry 的独立设置分区，各子域仍以独立 settings
 * namespace 注册（agentlex-litigation / agentlex-nonlitigation /
 * agentlex-task / agentlex-legal-suite），本层只负责装配，不吞并配置。
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import * as suite from './suite.ts'
import { setLiveConfig, getLiveConfig, unwrapVolatile, registerDomainConfig } from './shared/live-config.ts'
import * as litigation from './domains/litigation/index.ts'
import * as nonlitigation from './domains/nonlitigation/index.ts'
import * as task from './domains/task/index.ts'
import * as skin from './domains/skin/index.ts'
import * as workspaceSidebar from './domains/workspace-sidebar/index.ts'
import * as fileDownload from './domains/file-download/index.ts'
import * as skillsTools from './domains/skills-tools/index.ts'
import * as memo from './domains/memo/index.ts'
import * as push from './domains/push/index.ts'
import * as item from './domains/item/index.ts'
import * as mootCourt from './domains/moot-court/index.ts'
import * as redact from './domains/redact/index.ts'

export const name = 'dsh-legal-suite'

/**
 * 并集注入：子域（诉讼/非诉/任务/技能与工具）需要 webServer + systemPrompt
 * + tools，皮肤与套件需要 webServer。声明并集让 cordis 在全部服务就绪后
 * 再 apply。
 */
export const inject = ['webServer', 'systemPrompt', 'tools', 'settings']

/**
 * 聚合配置。
 *
 * 0.1.6 及以前：各子域用独立 settings 命名空间（agentlex-legal-suite /
 * agentlex-litigation / …），本层只负责装配，字段与各域 Config 无关。
 *
 * 0.1.7-alpha.1 起：harness 移除了插件的自定义 namespace 注册
 * （`ctx.settings.register/installSection/get` 全部下线，改为 `SettingsForms`
 * —— schema 取自「loader 条目自己的 cordis Config」）。合包后只有 agentlex
 * 这一个条目，所以各域的配置必须**并到这个条目上**才能被设置页看到并持久化。
 * 这里因此聚合全部字段：皮肤域沿用原 ns 的扁平字段名（存量配置语义不变），
 * 其余各域用域名前缀（dataDir → litigationDataDir/…）避免同名冲突；
 * `apply` 再把它们拆回各域自己的 Config 形态下发。
 */
export interface Config {
  enabled?: boolean
  /**
   * Agent-preset 模式：只挂载指定业务域的 scoped tool（agent 会话内使用），
   * 不挂任何 host 路由/stores/皮肤。取值 'litigation' | 'nonlitigation'。
   */
  agentPreset?: 'litigation' | 'nonlitigation' | 'redact'
  // —— 皮肤 / 套件（字段名与 0.1.6 的 agentlex-legal-suite 分区一致）——
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
  autoOpenCaseTab?: boolean
  /** @deprecated 旧键：语义已被 autoOpenCaseTab 取代，仅作迁移回退读取。 */
  openReferencesInSidebar?: boolean
  memoEnabled?: boolean
  theme?: string
  conversationJustify?: boolean
  conversationEnhance?: boolean
  conversationNavEnabled?: boolean
  conversationNavPosition?: 'right' | 'left'
  centerCard?: boolean
  conversationHeader?: boolean
  // —— 诉讼域 ——
  litigationAnnounceToAgent?: boolean
  litigationDataDir?: string
  litigationCalendarSyncEnabled?: boolean
  litigationCalendarName?: string
  litigationCalendarSyncEvents?: boolean
  litigationCalendarSyncTasks?: boolean
  // —— 非诉域 ——
  nonlitigationDataDir?: string
  // —— 任务域 ——
  taskDataDir?: string
  taskLitigationDir?: string
  taskNonlitigationDir?: string
  // —— 备忘录域 ——
  memoDataDir?: string
  // —— 期限推送域 ——
  pushDataDir?: string
  // —— 模拟法庭域 ——
  mootCourtEnabled?: boolean
  mootCourtDataDir?: string
  mootCourtLitigationDir?: string
  mootCourtJudgeModel?: string
  mootCourtOpponentModel?: string
  mootCourtRetrievalEnabled?: boolean
  mootCourtMaxRounds?: number
  mootCourtTokenBudget?: number
  mootCourtMaxTokensPerTurn?: number
  // —— 脱敏域（本地脱敏：规则 + 案件词典，纯本地无网络）——
  redactEnabled?: boolean
  redactDataDir?: string
  redactLitigationDir?: string
  redactNonlitigationDir?: string
}

/**
 * 可选路径串：留空即让各域走自己的 $DSH_HOME 默认目录。
 * 0.1.7 起字段须 `.volatile()` 才会出现在配置表单里（见 shared/live-config.ts）。
 */
/**
 * 把字段标记为 volatile —— 0.1.7-alpha.1 配置表单的可见性门槛（只有 `meta.volatile`
 * 的字段会进入 `SettingsForms.describe()`，也才允许 `configForms.set` 写入且不 remount）。
 *
 * 直接写 schema 的 `meta.volatile` 而**不调用** `schema.volatile()`：宿主随附的
 * schemastery 版本不一致（0.1.6 profile 装的是 3.18.0，没有这个方法；0.1.7 才有），
 * 而 `meta` 是两代都有的普通数据槽，harness 读的也正是 `schema.meta.volatile`。
 * 老版 harness 不读这个标记，字段仍是普通值，行为不变。
 */
const v = <S,>(schema: S): S => {
  try {
    const meta = (schema as unknown as { meta?: Record<string, unknown> }).meta
    if (meta !== undefined && meta !== null && typeof meta === 'object') {
      Object.defineProperty(meta, 'volatile', { value: true, enumerable: true, configurable: true, writable: true })
    }
  } catch { /* 无 meta 的旧 schema 形态：保持原样 */ }
  return schema
}

const optionalPath = () => z.string().required(false)

/**
 * 聚合配置 schema。
 *
 * `enabled` / `agentPreset` 是结构性开关（改动需要 remount），保持普通字段；
 * 其余全部标记 `.volatile()` —— 这是 0.1.7 配置表单的可见性门槛：只有 volatile
 * 字段会进入 `SettingsForms.describe()`，也才允许经 `configForms.set` 写入且
 * 不 remount 插件（改动经 `loader/volatile-update` 就地生效）。
 * 0.1.6 的 schemastery 也认识 `.volatile()`，字段值仍是裸值，不影响旧行为。
 */
export const Config: Schemastery<Schemastery.ObjectS<Config>, Config> = z.object({
  enabled: z.boolean().default(true),
  agentPreset: z.union(['litigation', 'nonlitigation', 'redact']).required(false),
  agentlexEnabled: v(z.boolean().default(true)),
  userName: v(z.string().default('User')),
  brandEn: v(z.string().default('AgentLex')),
  brandZh: v(z.string().default('超级律师助理')),
  skinEnabled: v(z.boolean().default(true)),
  litigationEnabled: v(z.boolean().default(true)),
  nonlitigationEnabled: v(z.boolean().default(true)),
  taskEnabled: v(z.boolean().default(true)),
  skillsToolsEnabled: v(z.boolean().default(true)),
  workspaceSidebarEnabled: v(z.boolean().default(true)),
  autoOpenCaseTab: v(z.boolean().default(true)),
  memoEnabled: v(z.boolean().default(true)),
  theme: v(z.string().default('warm')),
  conversationJustify: v(z.boolean().default(true)),
  conversationEnhance: v(z.boolean().default(true)),
  conversationNavEnabled: v(z.boolean().default(true)),
  conversationNavPosition: v(z.union(['right', 'left']).default('right')),
  centerCard: v(z.boolean().default(false)),
  conversationHeader: v(z.boolean().default(true)),
  litigationAnnounceToAgent: v(z.boolean().default(true)),
  litigationDataDir: v(optionalPath()),
  litigationCalendarSyncEnabled: v(z.boolean().default(false)),
  // 合包层必须给出与诉讼域 Config 一致的默认值：域里的默认只在 schema 校验时生效，
  // 而 litigationConfigOf() 是直接构造对象传给域 apply 的，不会再校验一次——缺默认
  // 就会让 current().calendarSyncEvents 恒为 undefined，规则判定成「日程开关关闭」，
  // 所有日程（含自动同步与手动「立即同步」）一条都不进日历（0.2.18 起的回归）。
  litigationCalendarName: v(z.string().default('个人')),
  litigationCalendarSyncEvents: v(z.boolean().default(true)),
  litigationCalendarSyncTasks: v(z.boolean().default(false)),
  nonlitigationDataDir: v(optionalPath()),
  taskDataDir: v(optionalPath()),
  taskLitigationDir: v(optionalPath()),
  taskNonlitigationDir: v(optionalPath()),
  memoDataDir: v(optionalPath()),
  pushDataDir: v(optionalPath()),
  // 实验性功能：默认关闭，由用户在「AgentLex 设置 → 功能模块」按需打开。
  mootCourtEnabled: v(z.boolean().default(false)),
  mootCourtDataDir: v(optionalPath()),
  mootCourtLitigationDir: v(optionalPath()),
  mootCourtJudgeModel: v(z.string().required(false)),
  mootCourtOpponentModel: v(z.string().required(false)),
  mootCourtRetrievalEnabled: v(z.boolean().default(true)),
  mootCourtMaxRounds: v(z.number().default(2)),
  mootCourtTokenBudget: v(z.number().default(120000)),
  mootCourtMaxTokensPerTurn: v(z.number().default(2400)),
  // —— 脱敏域（本地）——
  redactEnabled: v(z.boolean().default(true)),
  redactDataDir: v(optionalPath()),
  redactLitigationDir: v(optionalPath()),
  redactNonlitigationDir: v(optionalPath()),
})

/**
 * 挂载全部业务域。每个子域通过 ctx.plugin() 嵌套挂载——cordis 为每个
 * 子域创建独立 fiber（与旧 6-entry 布局等价），settings / 路由 /
 * agent preset 的注册互不冲突；fiber reload 时每个子域按自己的 token
 * 重建 surface。
 */
/** 聚合字段 → 皮肤域 Config（字段名一致，原样透传）。 */
function skinConfigOf(config: Config): skin.Config {
  return {
    enabled: config.enabled,
    agentlexEnabled: config.agentlexEnabled,
    userName: config.userName,
    brandEn: config.brandEn,
    brandZh: config.brandZh,
    skinEnabled: config.skinEnabled,
    litigationEnabled: config.litigationEnabled,
    nonlitigationEnabled: config.nonlitigationEnabled,
    taskEnabled: config.taskEnabled,
    skillsToolsEnabled: config.skillsToolsEnabled,
    workspaceSidebarEnabled: config.workspaceSidebarEnabled,
    autoOpenCaseTab: config.autoOpenCaseTab,
    openReferencesInSidebar: config.openReferencesInSidebar,
    memoEnabled: config.memoEnabled,
    theme: config.theme,
    conversationJustify: config.conversationJustify,
    conversationEnhance: config.conversationEnhance,
    conversationNavEnabled: config.conversationNavEnabled,
    conversationNavPosition: config.conversationNavPosition,
    centerCard: config.centerCard,
    conversationHeader: config.conversationHeader,
  }
}

/** 聚合字段 → 诉讼域 Config（去掉 litigation 前缀）。 */
function litigationConfigOf(config: Config): litigation.Config {
  return {
    announceToAgent: config.litigationAnnounceToAgent,
    dataDir: config.litigationDataDir,
    calendarSyncEnabled: config.litigationCalendarSyncEnabled,
    calendarName: config.litigationCalendarName,
    calendarSyncEvents: config.litigationCalendarSyncEvents,
    calendarSyncTasks: config.litigationCalendarSyncTasks,
  }
}

/** 聚合字段 → 模拟法庭域 Config（去掉 mootCourt 前缀）。 */
function mootCourtConfigOf(config: Config): mootCourt.Config {
  return {
    enabled: config.mootCourtEnabled,
    dataDir: config.mootCourtDataDir,
    litigationDir: config.mootCourtLitigationDir,
    judgeModel: config.mootCourtJudgeModel,
    opponentModel: config.mootCourtOpponentModel,
    retrievalEnabled: config.mootCourtRetrievalEnabled,
    maxRounds: config.mootCourtMaxRounds,
    tokenBudget: config.mootCourtTokenBudget,
    maxTokensPerTurn: config.mootCourtMaxTokensPerTurn,
  }
}

/** 聚合字段 → 脱敏域 Config（去掉 redact 前缀）。 */
function redactConfigOf(config: Config): redact.Config {
  return {
    enabled: config.redactEnabled,
    dataDir: config.redactDataDir,
    litigationDir: config.redactLitigationDir,
    nonlitigationDir: config.redactNonlitigationDir,
  }
}

/**
 * 关掉 harness 的「自动生成配置页」。0.1.7 起每个 loader 条目会按 cordis Config
 * 自动渲染一页配置；本套件自带「AgentLex 设置」页（settings.section 槽），自动页
 * 与之重复且只有英文 key。老版 harness 无 configure()，静默跳过。
 */
function disableAutoSettingsPage(ctx: Context): void {
  try {
    const settings = ctx.get('settings') as { configure?: (presentation: { auto?: boolean }) => unknown } | undefined
    if (typeof settings?.configure !== 'function') return
    const dispose = settings.configure({ auto: false })
    if (typeof dispose === 'function') {
      ctx.effect(() => dispose as () => void, 'dsh-legal-suite: settings presentation')
    }
  } catch {
    /* 老版 harness：无 configure，保留其原生行为 */
  }
}

/**
 * 挂载全部业务域。每个子域通过 ctx.plugin() 嵌套挂载——cordis 为每个
 * 子域创建独立 fiber（与旧 6-entry 布局等价），settings / 路由 /
 * agent preset 的注册互不冲突；fiber reload 时每个子域按自己的 token
 * 重建 surface。
 *
 * 配置下发：0.1.7 起各域拿不到自己的 settings 命名空间，改从本条目 Config
 * 读值（各域的 settings 适配器在无 register/installSection 时即以传入 config
 * 为源）；0.1.6 下该值只作为 settings scope 的 base 回退层，不改变原行为。
 */
export function apply(ctx: Context, config: Config = {}): void {
  if (config.enabled === false) return

  // Agent-preset 平面：只挂载指定域的 scoped tool（不注册 host 表面）。
  if (config.agentPreset === 'litigation') {
    ctx.plugin(litigation, { agentPreset: true })
    // 脱敏工具随办案 preset 一起进入会话（scoped，走宿主 HTTP 路由）。
    ctx.plugin(redact, { agentPreset: true })
    return
  }
  if (config.agentPreset === 'nonlitigation') {
    ctx.plugin(nonlitigation, { agentPreset: true })
    ctx.plugin(redact, { agentPreset: true })
    return
  }

  disableAutoSettingsPage(ctx)

  // 0.1.7 起 volatile 字段以 Volatile{get()} 引用形式到达；解包成裸值放进进程内镜像，
  // 让各域（以及本层的分发）读到普通字符串/布尔。0.1.6 下 unwrapVolatile 是恒等操作。
  const applyLive = (raw: unknown): Config => {
    const plain = unwrapVolatile(raw as Config)
    setLiveConfig(plain as unknown as Record<string, unknown>)
    return plain
  }
  const rawFiberConfig = (): unknown => (ctx as unknown as { fiber?: { config?: unknown } }).fiber?.config
  let live = applyLive(config)
  try {
    const fromFiber = rawFiberConfig()
    if (fromFiber !== undefined && fromFiber !== null) live = applyLive(fromFiber)
  } catch { /* 无 fiber 的装配（测试/预置）沿用入参 */ }

  // volatile 就地更新（不 remount）：重新解包刷新镜像，各域经 onChange 重判派生状态。
  try {
    ;(ctx as unknown as { on?: (name: string, fn: () => void) => () => void }).on?.('loader/volatile-update', () => {
      try {
        const fromFiber = rawFiberConfig()
        if (fromFiber !== undefined && fromFiber !== null) applyLive(fromFiber)
      } catch { /* 读取失败保持上一份快照 */ }
    })
  } catch { /* 老版 harness 无该事件 */ }

  // 各域配置读取器：settings 适配器在 0.1.7 下由此取当前值（0.1.6 走命名空间注册）。
  registerDomainConfig(litigation.LITIGATION_SETTINGS_NAMESPACE,
    () => litigationConfigOf(getLiveConfig() as unknown as Config))
  registerDomainConfig(nonlitigation.NONLITIGATION_SETTINGS_NAMESPACE,
    () => ({ dataDir: (getLiveConfig() as unknown as Config).nonlitigationDataDir }))
  registerDomainConfig(task.TASK_SETTINGS_NAMESPACE,
    () => ({
      dataDir: (getLiveConfig() as unknown as Config).taskDataDir,
      litigationDir: (getLiveConfig() as unknown as Config).taskLitigationDir,
      nonlitigationDir: (getLiveConfig() as unknown as Config).taskNonlitigationDir,
    }))
  registerDomainConfig(skin.AGENTLEX_SKIN_SETTINGS_NS,
    () => skinConfigOf(getLiveConfig() as unknown as Config))
  registerDomainConfig(memo.MEMO_SETTINGS_NAMESPACE,
    () => ({ dataDir: (getLiveConfig() as unknown as Config).memoDataDir }))
  registerDomainConfig(push.PUSH_SETTINGS_NAMESPACE,
    () => ({ dataDir: (getLiveConfig() as unknown as Config).pushDataDir }))
  registerDomainConfig(mootCourt.MOOT_SETTINGS_NAMESPACE,
    () => mootCourtConfigOf(getLiveConfig() as unknown as Config))
  registerDomainConfig(redact.REDACT_SETTINGS_NAMESPACE,
    () => redactConfigOf(getLiveConfig() as unknown as Config))

  // 套件自身（/api/agentlex-suite/config、/api/agentlex/read 聚合、preset 安装）。
  // 0.1.7 起 settings 命名空间读不到，品牌/称呼改从本条目 Config 下发。
  ctx.plugin(suite, {
    enabled: live.enabled,
    userName: live.userName,
    brandEn: live.brandEn,
    brandZh: live.brandZh,
  })
  // 诉讼域（案件/任务树/时间轴/日程/期限提醒 + 诉讼管家 preset）。
  ctx.plugin(litigation, litigationConfigOf(live))
  // 非诉域（项目/合同/研究/常法）。
  ctx.plugin(nonlitigation, { dataDir: live.nonlitigationDataDir })
  // 任务域（独立任务 + 跨插件统一任务视图）。
  ctx.plugin(task, {
    dataDir: live.taskDataDir,
    litigationDir: live.taskLitigationDir,
    nonlitigationDir: live.taskNonlitigationDir,
  })
  // 皮肤域（AgentLex 主题/品牌/工作台设置页；与套件共用设置分区，各自 fiber 隔离）。
  ctx.plugin(skin, skinConfigOf(live))
  // 工作区右边栏域（会话工作区右侧面板：文件树/搜索/预览/终端/引用联动；
  // 由桌面端 app renderer 移植，client 经双 renderer 解析打包）。
  ctx.plugin(workspaceSidebar, {})
  // 会话文件下载域（交付卡片/改动卡片 → 浏览器本机下载）。
  ctx.plugin(fileDownload)
  // 技能与工具域（技能落盘 ~/.dsh/skills + MCP 热加载，CRUD 路由）。
  ctx.plugin(skillsTools, {})
  // 备忘录域（随手记/标签/归档 + 会话 # 引用自动补全，host 存储 + 工具）。
  ctx.plugin(memo, { dataDir: live.memoDataDir })
  // 期限 IM 推送域（关键日期快到期 → dsh-im 主动投递；定时复用 dsh-timer-agent）。
  ctx.plugin(push, { dataDir: live.pushDataDir })
  // 统一事项域（事件+任务统一模型，items.json；诉讼/非诉/任务管理共用）。
  ctx.plugin(item, {})
  // 模拟法庭域（四类程序 × 三种模式的庭审推演；产物独立存储，不写卷宗）。
  ctx.plugin(mootCourt, mootCourtConfigOf(live))
  // 本地脱敏域（规则 + 案件词典白名单；映射表本机 0600，禁外发）。
  ctx.plugin(redact, redactConfigOf(live))
}
