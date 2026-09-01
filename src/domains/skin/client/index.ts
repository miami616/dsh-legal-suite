/**
 * dsh-legal-suite/skin — AgentLex DSH 外壳皮肤。
 *
 * 不做 iframe，只做原生皮肤：
 *   - 用 AgentLex 暖纸/陶土色覆盖 DSH 主题 token
 *   - 注册 AgentLex 品牌 mark/name 到侧边栏和空会话 hero
 *   - 注入 CSS 让诉讼/非诉/任务三个侧边栏入口贴近原版风格
 */
import type { ClientContext, SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
// Client-surface imports: the slot contracts (sidebar.brand.mark/name,
// conversation.hero.brand.mark, settings.section) are declared by the kits'
// /client contract files — importing the bare '.' entry only loads the host
// stub and leaves SlotMap empty, so the register calls below fail to typecheck.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { AgentLexBrandMark, AgentLexBrandName, AgentLexHeroMark } from './brand.tsx'
import { AGENTLEX_THEME_TOKENS } from './theme.ts'
import { AGENTLEX_SIDEBAR_CSS } from './sidebar.css.ts'
import { CONVERSATION_TYPOGRAPHY_CSS, CONVERSATION_ENHANCE_CSS, CONVERSATION_TITLE_CSS } from './conversation-typography.ts'
import { CONVERSATION_NAV_CSS, mountConversationNav, type ConversationNavPosition } from './conversation-navigation.ts'
import { setupTurnDataSource, emptyTurnDataSource, type TurnDataSource } from './conversation-turn-data.ts'
import { injectInlineCodeWbr } from './conversation-inline-code.ts'
import { BUSINESS_MODULES_CSS } from './business-modules.ts'
import { mountAgentLexSidebarGroup } from './sidebar-group.ts'
import { buildThemesCss, findTheme, DEFAULT_THEME_KEY } from './themes.ts'
import { getSkinConfig, guardStoredBrand, initThemeFromStorage, loadSkinConfig, restoreBrandFromStorage, setSkinConfig, subscribe as subscribeSkinConfig, type AgentLexSkinConfig } from './config.ts'
import {
  AgentLexSettingsSection,
  bindAgentLexSettingsScope,
  bindModuleDataDirScopes,
  bindScopeRetryHooks,
  bindWorkspaces,
} from './settings-section.tsx'

export const inject = ['slots', 'locale', 'theme', 'settingsScope', 'workspaces', 'sessions']

/** Inject a style tag once. */
function injectStyle(id: string, css: string): () => void {
  if (typeof document === 'undefined') return () => {}
  const tagId = `agentlex-skin-${id}`
  if (document.querySelector(`style[data-agentlex-skin="${tagId}"]`) !== null) return () => {}
  const tag = document.createElement('style')
  tag.dataset.agentlexSkin = tagId
  tag.textContent = css
  document.head.appendChild(tag)
  return () => tag.remove()
}

export function apply(ctx: ClientContext): void {
  const disposers: Array<() => void> = []

  // 诊断：品牌槽注册失败等原因写入 window，供排查（0.1.2-alpha.1 品牌槽
  // 曾被官方插件占用，禁止后仍不显示时据此定位）。
  const diag = (message: string): void => {
    console.warn('[agentlex-skin]', message)
    if (typeof window !== 'undefined') {
      try { (window as unknown as { __agentlexSkinDiag?: string }).__agentlexSkinDiag = message } catch { /* ignore */ }
    }
  }

  // 0. Load customizable skin config (brand/hero copy).
  // 先同步初始化主题与品牌（读 localStorage），避免刷新时先显示默认主题再跳转的闪烁；
  // 品牌（欢迎称呼 userName 等）同样先本地恢复，避免 settings scope 水合时序竞态
  // 导致首页称呼刷新后退回默认 'User'。
  try {
    initThemeFromStorage()
    restoreBrandFromStorage()
    void loadSkinConfig()
  } catch (error) {
    diag(`skin config init failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  // 重新(bind) settings scope。远程端（dsh-bridge 远程登录）下 settingsScope 服务
  // 可能晚于皮肤 apply 就绪：首次可能拿不到 scope，设置页会触发 bindScopeRetryHooks
  // 的重试直到成功，从而设置页不再空白。
  let bindSettingsScopes: (() => void) | null = null
  const doBindSettingsScopes = (): void => {
    try {
      const settingsScope = (ctx as unknown as { settingsScope?: { bind<T>(spec: { namespace: string }): SettingsScope<T> } }).settingsScope
      const agentlexScope = settingsScope?.bind<AgentLexSkinConfig>({ namespace: 'agentlex-legal-suite' })
      bindAgentLexSettingsScope(agentlexScope)
      if (agentlexScope) {
        const syncFromScope = (): void => {
          const value = agentlexScope.getSnapshot().value
          if (value) {
            // theme 由 localStorage/默认主题管理（scope 的 resolved 值带 host 默认
            // 'warm'，会覆盖用户选择与默认 pure），这里排除，只同步其余字段。
            const { theme: _ignored, ...rest } = value
            // 品牌字段（欢迎称呼 userName 等）：localStorage 已有用户偏好时，scope 的
            // 默认值（如 userName='User'）不得回写覆盖——避免水合时序竞态把首页称呼
            // 重置为默认。guardStoredBrand 会过滤掉品牌字段。
            setSkinConfig(guardStoredBrand(rest))
          }
        }
        syncFromScope()
        disposers.push(agentlexScope.subscribe(syncFromScope))
      }
      // Module data-dir scopes (settings UI: 数据目录 fields, host migrates on change).
      bindModuleDataDirScopes({
        litigation: settingsScope?.bind<{ dataDir?: string }>({ namespace: 'agentlex-litigation' }),
        nonlitigation: settingsScope?.bind<{ dataDir?: string }>({ namespace: 'agentlex-nonlitigation' }),
      })
      // 目录选择器（设置页「数据目录 → 选择目录…」按钮，走 client-runtime 的 workspaces.pickDirectory()）。
      bindWorkspaces(ctx.workspaces)
    } catch (error) {
      diag(`skin settingsScope/bind failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  bindSettingsScopes = doBindSettingsScopes
  bindScopeRetryHooks(() => { bindSettingsScopes?.() })
  doBindSettingsScopes()

  // 1. Dynamic skin: theme + sidebar CSS + brand slots, controllable by settings.
  const skinDisposers: Array<() => void> = []
  let skinApplied = false
  let tokenDisposer: (() => void) | undefined
  let appliedThemeKey: string | undefined
  let darkObserver: MutationObserver | undefined
  /** 会话排版样式注入（两端对齐），独立于皮肤开关、跟随 conversationJustify。 */
  let typographyDisposer: (() => void) | undefined
  /** 行内代码 <wbr> 注入（自然边界断行），跟随 conversationJustify。 */
  let wbrDisposer: (() => void) | undefined
  /** 会话排版增强样式注入（密集行距/背景块/彩色表头），跟随 conversationEnhance。 */
  let enhanceDisposer: (() => void) | undefined
  /** 会话页标题字号样式注入（随皮肤启停，无独立开关）。 */
  let titleStyleDisposer: (() => void) | undefined
  /** 会话轨迹导航（TurnNavigator）美化样式注入。 */
  let navStyleDisposer: (() => void) | undefined
  /** 会话轨迹导航（TurnNavigator）DOM 控制（设置 data-agentlex-nav 属性）。 */
  let navMountDisposer: (() => void) | undefined
  /** 会话轮次数据源（时间/状态/指标），供预览卡增强；启用时建立，停用时释放。 */
  let turnDataSource: TurnDataSource | undefined

  /** 按当前配置注入/移除会话排版样式（幂等）。 */
  const syncTypography = (): void => {
    const skinOn = getSkinConfig().agentlexEnabled && getSkinConfig().skinEnabled
    const justify = skinOn && getSkinConfig().conversationJustify
    if (justify && typographyDisposer === undefined) {
      typographyDisposer = injectStyle('typography', CONVERSATION_TYPOGRAPHY_CSS)
    } else if (!justify && typographyDisposer !== undefined) {
      typographyDisposer()
      typographyDisposer = undefined
    }
    // 行内代码自然边界断行（<wbr>）：与两端对齐同开同关
    if (justify && wbrDisposer === undefined) {
      wbrDisposer = injectInlineCodeWbr()
    } else if (!justify && wbrDisposer !== undefined) {
      wbrDisposer()
      wbrDisposer = undefined
    }
    const enhance = skinOn && getSkinConfig().conversationEnhance
    if (enhance && enhanceDisposer === undefined) {
      enhanceDisposer = injectStyle('enhance', CONVERSATION_ENHANCE_CSS)
    } else if (!enhance && enhanceDisposer !== undefined) {
      enhanceDisposer()
      enhanceDisposer = undefined
    }
    // 会话页标题字号：随皮肤启用，常驻注入（无独立开关）。
    if (skinOn && titleStyleDisposer === undefined) {
      titleStyleDisposer = injectStyle('conv-title', CONVERSATION_TITLE_CSS)
    } else if (!skinOn && titleStyleDisposer !== undefined) {
      titleStyleDisposer()
      titleStyleDisposer = undefined
    }
  }
  syncTypography()

  /** 按当前配置注入/移除会话轨迹导航（TurnNavigator）美化样式与 DOM 控制。 */
  const syncNav = (): void => {
    const skinOn = getSkinConfig().agentlexEnabled && getSkinConfig().skinEnabled
    const navOn = skinOn && getSkinConfig().conversationNavEnabled
    const position = getSkinConfig().conversationNavPosition
    if (navOn) {
      // 注入样式并挂载 DOM 控制；position 为 'right'/'left' 时
      // mountConversationNav 会设置 data-agentlex-nav 驱动 CSS 美化与左右切换。
      if (navStyleDisposer === undefined) {
        navStyleDisposer = injectStyle('nav', CONVERSATION_NAV_CSS)
      }
      // 建立会话轮次数据源（仅在启用时，避免无谓订阅）。
      if (turnDataSource === undefined) {
        turnDataSource = setupTurnDataSource(ctx)
      }
      const turnSource = turnDataSource
      // 位置变化时重新挂载（dispose 旧的再挂载新的），确保 data-agentlex-nav 更新。
      navMountDisposer?.()
      navMountDisposer = mountConversationNav(
        position,
        turnSource ? turnSource.get.bind(turnSource) : undefined,
      )
    } else {
      // 关闭时移除样式与 DOM 控制，恢复 DSH 原生轨迹导航。
      navStyleDisposer?.()
      navStyleDisposer = undefined
      navMountDisposer?.()
      navMountDisposer = undefined
      turnDataSource?.dispose()
      turnDataSource = undefined
    }
  }
  syncNav()

  /** 把当前主题的 lit 变量直接写入 html 内联样式（优先级最高，不依赖注入 style 的存活/顺序）。 */
  const applyLitVars = (): void => {
    const key = getSkinConfig().theme || DEFAULT_THEME_KEY
    const def = findTheme(key)
    const dark = document.documentElement.hasAttribute('data-ds-dark-theme')
    const vars = dark ? def.litDark : def.litLight
    const root = document.documentElement
    for (const [k, v] of Object.entries(vars)) {
      root.style.setProperty(`--lit-${k}`, v)
    }
  }

  /** (Re)apply dsw tokens + html attribute for the currently selected theme. */
  const applyTheme = (): void => {
    if (typeof document === 'undefined') return
    const key = getSkinConfig().theme || DEFAULT_THEME_KEY
    const def = findTheme(key)
    if (appliedThemeKey === def.core.key) return
    appliedThemeKey = def.core.key
    document.documentElement.dataset.agentlexTheme = def.core.key
    applyLitVars()
    // warm 沿用 theme.ts 的手调基线；其他主题用推导覆盖
    const tokens = def.core.key === 'warm' ? AGENTLEX_THEME_TOKENS : def.dsw
    const theme = (ctx as unknown as { theme?: { overrideTokens(source: string, t: Record<string, { light: string; dark: string }>): () => void } }).theme
    if (theme?.overrideTokens && tokens) {
      tokenDisposer?.()
      tokenDisposer = theme.overrideTokens('dsh-legal-suite/skin', tokens)
    }
  }

  const applySkin = (): void => {
    if (skinApplied) return
    skinApplied = true
    // 主题/排版/样式注入：任一失败都不阻断品牌槽注册。
    try {
      skinDisposers.push(injectStyle('themes', buildThemesCss()))
      applyTheme()
      // 深浅色切换时刷新内联 lit 变量（body[data-ds-dark-theme] 由 DSH 管理）
      darkObserver = new MutationObserver(() => applyLitVars())
      darkObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
      skinDisposers.push(injectStyle('sidebar', AGENTLEX_SIDEBAR_CSS))
      skinDisposers.push(injectStyle('business', BUSINESS_MODULES_CSS))
      skinDisposers.push(mountAgentLexSidebarGroup())
    } catch (error) {
      diag(`skin theme/sidebar styles failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    // 品牌槽注册独立 try：失败只影响品牌展示，不拖垮皮肤。
    // 0.1.2-alpha.1 起槽注册要求「父条目 children 表已声明该槽」，直接注册
    // 会撞时序型 not-declared；官方（ui-brand-official）用 slots.inject 延迟到
    // 槽渲染时注册（届时声明必就绪），照抄该模式。老版 harness 无 slots.inject
    // 时回退直接注册（老版 slots 宽松，无需声明）。
    try {
      const slotsService = ctx.slots as unknown as {
        inject?(name: string, fn: () => unknown): unknown
        register(o: unknown, c: unknown): unknown
      }
      const registerBrands = function* (): Generator<unknown> {
        yield slotsService.register({ name: 'sidebar.brand.mark', priority: -10 }, AgentLexBrandMark)
        yield slotsService.register({ name: 'sidebar.brand.name', priority: -10 }, AgentLexBrandName)
        yield slotsService.register({ name: 'conversation.hero.brand.mark', priority: -10 }, AgentLexHeroMark)
        return undefined
      }
      if (typeof slotsService.inject === 'function') {
        const injected = slotsService.inject('sidebar.brand.mark', () =>
          slotsService.inject!('sidebar.brand.name', () =>
            slotsService.inject!('conversation.hero.brand.mark', registerBrands)))
        if (typeof injected === 'function') skinDisposers.push(injected)
      } else {
        const generator = registerBrands()
        while (!generator.next().done) { /* sync drive */ }
      }
    } catch (error) {
      diag(`brand slot registration failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const removeSkin = (): void => {
    if (!skinApplied) return
    skinApplied = false
    appliedThemeKey = undefined
    darkObserver?.disconnect()
    darkObserver = undefined
    if (typeof document !== 'undefined') {
      delete document.documentElement.dataset.agentlexTheme
      // 清理内联 lit 变量（回到模块 :root 默认）
      for (const key of ['paper', 'paper-elevated', 'paper-inset', 'ink', 'ink-secondary', 'ink-muted', 'ink-subtle', 'ink-faint', 'accent', 'accent-hover', 'accent-strong', 'accent-subtle', 'accent-muted', 'accent-cool', 'accent-cool-hover', 'line', 'line-strong', 'line-subtle', 'hover-bg', 'hover-bg-strong', 'btn-primary-bg', 'btn-primary-bg-hover', 'btn-primary-text', 'btn-dark-bg', 'btn-dark-bg-hover', 'btn-dark-text', 'btn-secondary-bg', 'btn-secondary-bg-hover', 'btn-secondary-text', 'success', 'success-bg', 'error', 'error-bg', 'error-hover', 'warning', 'warning-bg', 'info', 'info-bg', 'on-accent', 'shadow-card', 'shadow-pop']) {
        document.documentElement.style.removeProperty(`--lit-${key}`)
      }
    }
    tokenDisposer?.()
    tokenDisposer = undefined
    for (const dispose of skinDisposers.splice(0)) dispose()
  }

  const syncSkin = (): void => {
    if (getSkinConfig().agentlexEnabled && getSkinConfig().skinEnabled) {
      applySkin()
      applyTheme() // 主题切换时即时换 dsw token / html 属性
    } else {
      removeSkin()
    }
  }
  syncSkin()


  // Settings sections stay always available (so the user can turn skin back on).
  // 0.1.2-alpha.1 时序：settings.section 需等 ui-settings 声明就绪，改用
  // slots.inject 延迟到设置页渲染时注册（声明必已就绪）。
  try {
    const slotsService = ctx.slots as unknown as {
      inject?(name: string, fn: () => unknown): unknown
      register(o: unknown, c: unknown): unknown
    }
    const registerSettingsSection = (): void => {
      disposers.push(slotsService.register({
        name: 'settings.section',
        id: 'agentlex-legal-suite',
        order: 50,
        label: 'AgentLex 设置',
        // 本页拥有的套件设置槽位：注册该页的同时声明 agentlex.workbench.item，
        // litigation 的「插件版本与更新」块注册进这里（页面内渲染，不占顶层导航）。
        children: {
          'agentlex.workbench.item': {
            kind: 'list',
            scope: 'root',
            owner: {},
          },
        },
      }, AgentLexSettingsSection))
    }
    // 0.1.2-alpha.1 时序：等 ui-settings 声明就绪；老版无 slots.inject 时直接注册。
    if (typeof slotsService.inject === 'function') {
      const injected = slotsService.inject('settings.section', registerSettingsSection)
      if (injected === undefined) registerSettingsSection()
    } else {
      registerSettingsSection()
    }
  } catch (error) {
    console.warn('[agentlex-skin] settings section registration failed:', error)
  }

  // 注：原独立的「桌面」settings.section（Profile 切换 / 桌面通知）已按需求移除。

  const unsubscribeSkin = subscribeSkinConfig(() => {
    syncSkin()
    syncTypography()
    syncNav()
  })
  ctx.effect(() => () => {
    unsubscribeSkin()
    removeSkin()
    typographyDisposer?.()
    typographyDisposer = undefined
    wbrDisposer?.()
    wbrDisposer = undefined
    enhanceDisposer?.()
    enhanceDisposer = undefined
    titleStyleDisposer?.()
    titleStyleDisposer = undefined
    navStyleDisposer?.()
    navStyleDisposer = undefined
    navMountDisposer?.()
    navMountDisposer = undefined
    turnDataSource?.dispose()
    turnDataSource = undefined
    for (const dispose of disposers.splice(0)) dispose()
  }, 'dsh-legal-suite/skin: theme+brand+sidebar+settings')
}
