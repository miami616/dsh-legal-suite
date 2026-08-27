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
import { BUSINESS_MODULES_CSS } from './business-modules.ts'
import { mountAgentLexSidebarGroup } from './sidebar-group.ts'
import { buildThemesCss, findTheme, DEFAULT_THEME_KEY } from './themes.ts'
import { getSkinConfig, initThemeFromStorage, loadSkinConfig, setSkinConfig, subscribe as subscribeSkinConfig, type AgentLexSkinConfig } from './config.ts'
import {
  AgentLexSettingsSection,
  bindAgentLexSettingsScope,
  bindDesktopNotificationScope,
  bindModuleDataDirScopes,
  bindWorkspaces,
  DesktopSettingsSection,
  type DesktopNotificationSettings,
} from './settings-section.tsx'

export const inject = ['slots', 'locale', 'theme', 'settingsScope', 'workspaces']

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

  // 0. Load customizable skin config (brand/hero copy).
  // 先同步初始化主题（读 localStorage），避免刷新时先显示默认主题再跳转的闪烁。
  initThemeFromStorage()
  void loadSkinConfig()
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
        setSkinConfig(rest)
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
  // Desktop notification scope (namespace owned by dsh-desktop-notifications).
  bindDesktopNotificationScope(
    settingsScope?.bind<DesktopNotificationSettings>({ namespace: 'dsh-desktop-notifications' }),
  )
  // 目录选择器（设置页「数据目录 → 选择目录…」按钮，走 client-runtime 的 workspaces.pickDirectory()）。
  bindWorkspaces(ctx.workspaces)

  // 1. Dynamic skin: theme + sidebar CSS + brand slots, controllable by settings.
  const skinDisposers: Array<() => void> = []
  let skinApplied = false
  let tokenDisposer: (() => void) | undefined
  let appliedThemeKey: string | undefined
  let darkObserver: MutationObserver | undefined
  /** 会话排版样式注入（两端对齐），独立于皮肤开关、跟随 conversationJustify。 */
  let typographyDisposer: (() => void) | undefined
  /** 会话排版增强样式注入（密集行距/背景块/彩色表头），跟随 conversationEnhance。 */
  let enhanceDisposer: (() => void) | undefined
  /** 会话页标题字号样式注入（随皮肤启停，无独立开关）。 */
  let titleStyleDisposer: (() => void) | undefined

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
    skinDisposers.push(injectStyle('themes', buildThemesCss()))
    applyTheme()
    // 深浅色切换时刷新内联 lit 变量（body[data-ds-dark-theme] 由 DSH 管理）
    darkObserver = new MutationObserver(() => applyLitVars())
    darkObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
    skinDisposers.push(injectStyle('sidebar', AGENTLEX_SIDEBAR_CSS))
    skinDisposers.push(injectStyle('business', BUSINESS_MODULES_CSS))
    skinDisposers.push(mountAgentLexSidebarGroup())
    try {
      skinDisposers.push(ctx.slots.register({ name: 'sidebar.brand.mark', priority: -10 }, AgentLexBrandMark))
      skinDisposers.push(ctx.slots.register({ name: 'sidebar.brand.name', priority: -10 }, AgentLexBrandName))
      skinDisposers.push(ctx.slots.register({ name: 'conversation.hero.brand.mark', priority: -10 }, AgentLexHeroMark))
    } catch (error) {
      console.warn('[agentlex-skin] brand slot registration failed:', error)
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
  try {
    disposers.push(ctx.slots.register({
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
  } catch (error) {
    console.warn('[agentlex-skin] settings section registration failed:', error)
  }

  // Independent「桌面」settings entry: Profile switching (desktop-profiles) +
  // privacy-safe desktop notifications. Rendered as its own section so users
  // find it without digging into the skin page.
  try {
    disposers.push(ctx.slots.register({
      name: 'settings.section',
      id: 'agentlex-desktop',
      order: 51,
      label: '桌面',
    }, DesktopSettingsSection))
  } catch (error) {
    console.warn('[agentlex-skin] desktop settings section registration failed:', error)
  }

  const unsubscribeSkin = subscribeSkinConfig(() => {
    syncSkin()
    syncTypography()
  })
  ctx.effect(() => () => {
    unsubscribeSkin()
    removeSkin()
    typographyDisposer?.()
    typographyDisposer = undefined
    enhanceDisposer?.()
    enhanceDisposer = undefined
    titleStyleDisposer?.()
    titleStyleDisposer = undefined
    for (const dispose of disposers.splice(0)) dispose()
  }, 'dsh-legal-suite/skin: theme+brand+sidebar+settings')
}
