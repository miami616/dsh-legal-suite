/**
 * AgentLex 主题配色系统（v0.2）。
 *
 * 五套皮肤配色，每套同时提供：
 *  - dsw token 覆盖（DSH shell 外壳：边栏/会话/设置/输入框/弹层）
 *  - 三模块（lit/nonlit/task）的 --lit-* 设计变量覆盖（CSS 片段）
 *
 * 生成策略：
 *  - 每套主题只手写一份核心色板（ThemeCore），dsw token / lit 变量
 *    都由 derive 函数按统一规则推导，保证各区域天生协调；
 *  - 暖纸陶土（warm）是历史基线，dsw 部分沿用原 theme.ts 的手调值，
 *    lit 部分即三模块内置默认值，视觉上与旧版完全一致；
 *  - 其余主题用 derive() 推导。
 *
 * CSS 挂载方式：所有主题的 --lit-* 覆盖一次性注入一个 <style>，
 * 以 `html[data-agentlex-theme="<key>"]` 门控（特异性高于模块 :root 默认），
 * 切换主题只改 html 属性，零重排成本。
 */

// ── 颜色小工具 ───────────────────────────────────────────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ]
}

function rgbToHex(r: number, g: number, b: number): string {
  const to = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`
}

/** t=0 → a，t=1 → b */
function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a)
  const [r2, g2, b2] = hexToRgb(b)
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t)
}

function alpha(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

/** "r g b"（空格分隔），供 rgb(var / 0.1) 语法使用。 */
function rgbTuple(hex: string): string {
  return hexToRgb(hex).join(' ')
}

// ── 核心色板定义 ─────────────────────────────────────────────

export interface AgentLexThemeCore {
  key: string
  label: string
  desc: string
  /** 设置页色卡：边栏底色 / 主区底色 / 品牌强调色 */
  swatch: [string, string, string]

  // —— light ——
  paper: string        // 主底色（lit-paper / 页面底）
  elevated: string     // 卡片/弹层（lit-paper-elevated）
  inset: string        // 凹陷/次级按钮底（lit-paper-inset）
  sidebar: string      // 边栏底（dsw sidebar-fill）
  activeBg: string     // 激活条目底（边栏 active-bg / 标签选中底）
  ink: string          // 最强文字（lit-ink）
  text: string         // 主文字（dsw label-primary，比 ink 略柔和）
  muted: string        // 次级文字
  subtle: string       // 三级文字
  faint: string        // 弱提示
  accent: string       // 品牌主色
  accentHover: string  // 品牌主色 hover
  accentStrong: string // 深一档（按钮 hover/文字强调）
  accentCool: string   // 对比辅色（模块二/冷色强调）
  accentCoolHover: string

  // —— dark ——
  dPaper: string
  dElevated: string
  dInset: string
  dSidebar: string
  dActiveBg: string
  dInk: string
  dLabel: string
  dMuted: string
  dSubtle: string
  dFaint: string
  dAccent: string
  dAccentHover: string
  dAccentStrong: string
}

// ── 推导：dsw token 集 ───────────────────────────────────────

export type TokenMap = Record<string, { light: string; dark: string }>

/** 由核心色板推导完整 dsw token 覆盖。 */
function deriveDsw(c: AgentLexThemeCore): TokenMap {
  const lLine = rgbTuple(c.ink)
  const dLine = rgbTuple(c.dInk)

  // 中性色阶：亮色端=近白（暖白），暗色端=深底；按基线相对亮度取 19 档
  const neutralLightTop = mix(c.elevated, '#ffffff', 0.5)
  const neutralLightBottom = c.ink
  const stops = [0.005, 0.03, 0.05, 0.08, 0.11, 0.15, 0.21, 0.30, 0.45, 0.56,
    0.66, 0.78, 0.87, 0.92, 0.95, 0.97, 0.98, 0.99, 1.0]
  const neutralKeys = ['00', '50', '60', '75', '100', '150', '200', '300', '400',
    '500', '600', '700', '750', '800', '850', '875', '900', '950', '1000']
  const neutralRamp = (top: string, bottom: string): Record<string, string> =>
    Object.fromEntries(neutralKeys.map((k, i) => [k, mix(top, bottom, stops[i]!)]))
  const nL = neutralRamp(neutralLightTop, neutralLightBottom)
  const nD = neutralRamp(c.dElevated, mix(c.dInk, '#000000', 0.35))

  const token = (light: string, dark: string): { light: string; dark: string } => ({ light, dark })
  const map: TokenMap = {}

  // 背景层次（会话主区纯白，与 DSH 原生一致；弹层/卡片保留一档主题色）
  map['--dsw-alias-bg-base'] = token('#ffffff', c.dPaper)
  map['--dsw-alias-bg-layer-1'] = token('#ffffff', c.dElevated)
  map['--dsw-alias-bg-layer-2'] = token(mix(c.paper, '#ffffff', 0.3), c.dInset)
  map['--dsw-alias-bg-layer-3'] = token(c.paper, mix(c.dPaper, c.dElevated, 0.4))
  map['--dsw-alias-bg-overlay'] = token(mix(c.paper, c.inset, 0.35), mix(c.dElevated, c.dInk, 0.08))
  map['--dsw-alias-bg-module-platform'] = token(mix(c.paper, '#ffffff', 0.4), mix(c.dPaper, c.dElevated, 0.4))
  map['--dsw-alias-bg-multi-select'] = token(c.paper, mix(c.dElevated, c.dInk, 0.08))
  map['--dsw-alias-bg-mask-1'] = token(`rgba(${c.ink ? hexToRgb(c.ink).join(', ') : '0,0,0'}, 0.24)`, 'rgba(0, 0, 0, 0.5)')
  map['--dsw-alias-bg-mask-2'] = token(`rgba(${hexToRgb(c.ink).join(', ')}, 0.10)`, 'rgba(0, 0, 0, 0.3)')
  map['--dsw-alias-bg-mask-3'] = token(`rgba(${hexToRgb(c.ink).join(', ')}, 0.45)`, 'rgba(0, 0, 0, 0.6)')

  // 边框
  map['--dsw-alias-border-l1'] = token(`rgba(${lLine.split(' ').join(', ')}, 0.05)`, `rgba(${dLine.split(' ').join(', ')}, 0.06)`)
  map['--dsw-alias-border-l2'] = token(`rgba(${lLine.split(' ').join(', ')}, 0.08)`, `rgba(${dLine.split(' ').join(', ')}, 0.10)`)
  map['--dsw-alias-border-l3'] = token(`rgba(${lLine.split(' ').join(', ')}, 0.12)`, `rgba(${dLine.split(' ').join(', ')}, 0.16)`)
  map['--dsw-alias-border-l4'] = token(`rgba(${lLine.split(' ').join(', ')}, 0.17)`, `rgba(${dLine.split(' ').join(', ')}, 0.22)`)

  // 品牌 / 按钮
  map['--dsw-alias-brand-primary'] = token(mix(c.accent, c.elevated, 0.18), c.dAccent)
  map['--dsw-alias-brand-primary-invert'] = token('#fffdfb', c.dPaper)
  map['--dsw-alias-brand-text'] = token(c.text, c.dLabel)
  map['--dsw-alias-button-primary-fill'] = token(mix(c.accent, c.elevated, 0.12), c.dAccentStrong)
  map['--dsw-alias-button-primary-hover'] = token(c.accent, mix(c.dAccentStrong, '#000000', 0.12))
  map['--dsw-alias-button-primary-dimmed'] = token(mix(c.inset, c.accent, 0.16), mix(c.dElevated, c.dAccent, 0.22))
  map['--dsw-alias-button-elevated-fill'] = token(mix(c.elevated, '#ffffff', 0.5), c.dElevated)
  map['--dsw-alias-button-contrast-fill'] = token(mix(c.ink, c.elevated, 0.28), mix(c.dElevated, c.dInk, 0.12))
  map['--dsw-alias-button-info-fill'] = token(mix(c.accent, c.elevated, 0.12), c.dAccentStrong)
  map['--dsw-alias-button-info-hover'] = token(c.accent, mix(c.dAccentStrong, '#000000', 0.12))
  map['--dsw-alias-brand-primary-new-colorprimary-new-color'] = token(mix(c.accent, c.elevated, 0.12), c.dAccent)

  // deepseek 静态蓝 → 品牌色系
  map['--dsw-static-deepseek-50'] = token(mix(c.paper, c.accent, 0.06), mix(c.dPaper, c.dAccent, 0.14))
  map['--dsw-static-deepseek-100'] = token(mix(c.paper, c.accent, 0.10), mix(c.dPaper, c.dAccent, 0.22))
  map['--dsw-static-deepseek-200'] = token(mix(c.paper, c.accent, 0.18), mix(c.dPaper, c.dAccent, 0.32))
  map['--dsw-static-deepseek-400'] = token(mix(c.accent, c.elevated, 0.15), c.dAccentHover)
  map['--dsw-static-deepseek-450'] = token(c.accent, c.dAccent)
  map['--dsw-static-deepseek-500'] = token(c.accent, c.dAccentStrong)
  map['--dsw-static-deepseek-800'] = token(mix(c.ink, c.accent, 0.28), mix(c.dElevated, c.dAccent, 0.22))

  // Markdown / 代码块（可见浅灰底：按 ink→白 混出原生 bluish-50/100 的观感，
  // 不再白到隐形）
  map['--dsw-alias-markdown-code-block'] = token(mix(c.ink, '#ffffff', 0.985), mix(c.dElevated, c.dPaper, 0.25))
  map['--dsw-alias-markdown-code-block-banner'] = token(mix(c.ink, '#ffffff', 0.97), mix(c.dElevated, c.dAccent, 0.08))
  map['--dsw-alias-markdown-inline-code'] = token(mix(c.ink, '#ffffff', 0.975), mix(c.dElevated, c.dInk, 0.05))
  map['--dsw-alias-markdown-citation'] = token(mix(c.ink, '#ffffff', 0.98), mix(c.dElevated, c.dAccent, 0.08))
  map['--dsw-alias-markdown-code-segment-selected'] = token(mix(c.elevated, '#ffffff', 0.5), mix(c.dElevated, c.dInk, 0.06))
  map['--dsw-alias-markdown-code-segment-unselected'] = token(mix(c.paper, '#ffffff', 0.5), c.dPaper)
  map['--dsw-alias-markdown-placeholder'] = token(mix(c.paper, '#ffffff', 0.4), mix(c.dPaper, c.dElevated, 0.3))
  map['--dsw-alias-markdown-tag'] = token(mix(c.paper, '#ffffff', 0.5), mix(c.dPaper, c.dElevated, 0.3))

  // 中性静态色阶
  for (const k of neutralKeys) {
    map[`--dsw-static-neutral-bluish-${k}`] = token(nL[k]!, nD[k]!)
  }

  // 交互 hover
  map['--dsw-alias-interactive-bg-hover'] = token(alpha(c.accent, 0.05), alpha(c.dAccent, 0.10))
  map['--dsw-alias-interactive-bg-active'] = token(alpha(c.accent, 0.08), alpha(c.dAccent, 0.18))
  map['--dsw-alias-interactive-bg-hover-accent'] = token(alpha(c.accent, 0.06), alpha(c.dAccent, 0.14))
  map['--dsw-alias-interactive-bg-hover-danger'] = token('rgba(220, 38, 38, 0.04)', 'rgba(239, 68, 68, 0.12)')

  // 文字（主文字用 ink 近黑，与原生 bluish-1000 观感一致）
  map['--dsw-alias-label-primary'] = token(c.ink, c.dLabel)
  map['--dsw-alias-label-secondary'] = token(c.muted, c.dMuted)
  map['--dsw-alias-label-tertiary'] = token(c.subtle, c.dSubtle)
  map['--dsw-alias-label-caption'] = token(c.faint, mix(c.dMuted, c.dPaper, 0.35))
  map['--dsw-alias-label-dimmed'] = token(mix(c.faint, c.elevated, 0.3), mix(c.dMuted, c.dPaper, 0.55))
  map['--dsw-alias-label-primary-foreground'] = token('#fffdf9', c.dPaper)
  map['--dsw-alias-label-primary-inverted'] = token('#fffdf9', c.dLabel)

  // 语义色（淡雅低饱和，跨主题共享基调，仅随底色调和）
  map['--dsw-alias-state-business-primary'] = token(mix(c.accent, c.elevated, 0.12), c.dAccent)
  map['--dsw-alias-state-business-tertiary'] = token(alpha(c.accent, 0.08), alpha(c.dAccent, 0.12))
  map['--dsw-alias-state-success-primary'] = token('#4e9c6f', '#4aad7a')
  map['--dsw-alias-state-success-secondary'] = token('#56ac7e', '#5ec49e')
  map['--dsw-alias-state-success-tertiary'] = token('#e4f1e9', 'rgba(74, 173, 122, 0.15)')
  map['--dsw-alias-state-error-primary'] = token('#cd6b6b', '#ef4444')
  map['--dsw-alias-state-error-secondary'] = token('#e07070', '#f27e7e')
  map['--dsw-alias-state-error-tertiary'] = token('#fdeaea', 'rgba(239, 68, 68, 0.15)')
  map['--dsw-alias-state-warn-primary'] = token('#d19a33', '#f59e0b')
  map['--dsw-alias-state-warn-secondary'] = token('#e0a548', '#f7b955')
  map['--dsw-alias-state-warn-tertiary'] = token('#faf1d8', 'rgba(245, 158, 11, 0.15)')
  map['--dsw-alias-state-info-primary'] = token('#6492c2', '#6b9fd4')
  map['--dsw-alias-state-info-tertiary'] = token('#e6edf5', 'rgba(107, 159, 212, 0.15)')

  // 边栏
  map['--dsw-specific-sidebar-fill'] = token(c.sidebar, c.dSidebar)
  map['--dsw-specific-sidebar-nav-item-active'] = token(c.activeBg, mix(c.dSidebar, c.dInk, 0.10))
  map['--dsw-specific-sidebar-nav-item-hover'] = token(alpha(c.accent, 0.05), alpha(c.dAccent, 0.12))
  map['--dsw-specific-sidebar-nav-item-active-accent'] = token(c.accent, c.dAccent)
  map['--dsw-specific-sidebar-nav-item-active-bg'] = token(c.activeBg, mix(c.dElevated, c.dAccent, 0.12))

  // 气泡 / 输入 / 菜单（气泡恢复主题色浅底：accent 90% 混白，浅色下清晰可见）
  map['--dsw-specific-bubble'] = token(mix(c.accent, '#ffffff', 0.90), c.dElevated)
  map['--dsw-specific-bubble-highlight'] = token(mix(c.accent, '#ffffff', 0.84), mix(c.dElevated, c.dAccent, 0.10))
  map['--dsw-specific-input-major'] = token('#ffffff', c.dElevated)
  map['--dsw-specific-menu'] = token(mix(c.elevated, '#ffffff', 0.5), c.dElevated)
  map['--dsw-specific-selector'] = token(c.paper, mix(c.dPaper, c.dElevated, 0.35))
  map['--dsw-specific-tip'] = token(mix(c.paper, '#ffffff', 0.3), mix(c.dPaper, c.dElevated, 0.3))

  return map
}

// ── 推导：lit 变量集（三模块共享） ───────────────────────────

function hexRgbComma(hex: string): string {
  return hexToRgb(hex).join(', ')
}

/** light 模式 lit 变量（含模块内部引用的全部键）。 */
function deriveLitLight(c: AgentLexThemeCore): Record<string, string> {
  const ink = c.ink
  const line = hexRgbComma(ink)
  return {
    'ink': ink,
    'ink-secondary': mix(ink, c.elevated, 0.14),
    'ink-muted': c.muted,
    'ink-subtle': c.subtle,
    'ink-faint': c.faint,
    'paper': c.paper,
    'paper-elevated': c.elevated,
    'paper-inset': c.inset,
    'hover-bg': alpha(c.accent, 0.07),
    'hover-bg-strong': alpha(c.accent, 0.12),
    'accent': c.accent,
    'accent-hover': c.accentHover,
    'accent-strong': c.accentStrong,
    'accent-subtle': alpha(c.accent, 0.08),
    'accent-muted': alpha(c.accent, 0.15),
    'accent-cool': c.accentCool,
    'accent-cool-hover': c.accentCoolHover,
    'on-accent': '#ffffff',
    'success': '#2d8a5e',
    'success-bg': mix(c.elevated, '#2d8a5e', 0.14),
    'error': '#dc2626',
    'error-bg': '#fee2e2',
    'error-hover': '#b91c1c',
    'warning': '#d97706',
    'warning-bg': '#fef3c7',
    'info': mix('#4a7ab5', c.accent, 0.12),
    'info-bg': mix(c.elevated, '#4a7ab5', 0.10),
    'line': `rgb(${line} / 0.28)`,
    'line-strong': `rgb(${line} / 0.44)`,
    'line-subtle': `rgb(${line} / 0.16)`,
    'btn-primary-bg': c.accent,
    'btn-primary-bg-hover': c.accentStrong,
    'btn-primary-text': '#ffffff',
    'btn-dark-bg': ink,
    'btn-dark-bg-hover': mix(ink, c.elevated, 0.2),
    'btn-dark-text': '#ffffff',
    'btn-secondary-bg': c.inset,
    'btn-secondary-bg-hover': mix(c.inset, ink, 0.08),
    'btn-secondary-text': ink,
    'shadow-card': `0 1px 2px rgb(${line} / 0.10), 0 2px 8px rgb(${line} / 0.06)`,
    'shadow-pop': `0 8px 24px rgb(${line} / 0.12), 0 2px 6px rgb(${line} / 0.06)`,
  }
}

function deriveLitDark(c: AgentLexThemeCore): Record<string, string> {
  const line = hexRgbComma(c.dInk)
  return {
    'ink': c.dLabel,
    'ink-secondary': mix(c.dLabel, c.dPaper, 0.16),
    'ink-muted': c.dMuted,
    'ink-subtle': mix(c.dMuted, c.dPaper, 0.35),
    'ink-faint': mix(c.dMuted, c.dPaper, 0.55),
    'paper': c.dPaper,
    'paper-elevated': c.dElevated,
    'paper-inset': c.dInset,
    'hover-bg': alpha(c.dAccent, 0.12),
    'hover-bg-strong': alpha(c.dAccent, 0.20),
    'accent': c.dAccent,
    'accent-hover': c.dAccentHover,
    'accent-strong': mix(c.dAccentStrong, '#000000', 0.1),
    'accent-subtle': alpha(c.dAccent, 0.12),
    'accent-muted': alpha(c.dAccent, 0.20),
    'accent-cool': '#4aad8a',
    'accent-cool-hover': '#5ec49e',
    'on-accent': '#ffffff',
    'success': '#4aad7a',
    'success-bg': 'rgba(74, 173, 122, 0.15)',
    'error': '#ef4444',
    'error-bg': 'rgba(239, 68, 68, 0.15)',
    'error-hover': '#dc2626',
    'warning': '#f59e0b',
    'warning-bg': 'rgba(245, 158, 11, 0.15)',
    'info': '#6b9fd4',
    'info-bg': 'rgba(107, 159, 212, 0.15)',
    'line': `rgb(${line} / 0.28)`,
    'line-strong': `rgb(${line} / 0.44)`,
    'line-subtle': `rgb(${line} / 0.16)`,
    'btn-primary-bg': mix(c.dAccentStrong, '#000000', 0.08),
    'btn-primary-bg-hover': mix(c.dAccentStrong, '#000000', 0.18),
    'btn-primary-text': '#ffffff',
    'btn-dark-bg': mix(c.dElevated, c.dInk, 0.16),
    'btn-dark-bg-hover': mix(c.dElevated, c.dInk, 0.26),
    'btn-dark-text': c.dLabel,
    'btn-secondary-bg': mix(c.dInset, c.dInk, 0.10),
    'btn-secondary-bg-hover': mix(c.dInset, c.dInk, 0.18),
    'btn-secondary-text': c.dLabel,
    'shadow-card': '0 1px 2px rgb(0 0 0 / 0.30)',
    'shadow-pop': '0 8px 24px rgb(0 0 0 / 0.42), 0 2px 6px rgb(0 0 0 / 0.22)',
  }
}

// ── 五套主题色板 ─────────────────────────────────────────────

/** 边栏三条业务入口的图标色调（诉讼=主色 / 非诉=冷色 / 任务=金）。 */
export interface EntryTints { lit: string; nl: string; task: string }

export interface AgentLexTheme {
  core: AgentLexThemeCore
  /** dsw 覆盖（undefined = 调用方使用基线 theme.ts） */
  dsw?: TokenMap
  litLight: Record<string, string>
  litDark: Record<string, string>
  tints: { light: EntryTints; dark: EntryTints }
}

interface ThemeOverrides {
  dsw?: TokenMap
  litLight?: Record<string, string>
  litDark?: Record<string, string>
}

function makeTheme(
  core: AgentLexThemeCore,
  tints: { light: EntryTints; dark: EntryTints },
  overrides: ThemeOverrides = {},
): AgentLexTheme {
  return {
    core,
    dsw: overrides.dsw ?? deriveDsw(core),
    litLight: { ...deriveLitLight(core), ...(overrides.litLight ?? {}) },
    litDark: { ...deriveLitDark(core), ...(overrides.litDark ?? {}) },
    tints,
  }
}

// 暖纸陶土的 lit 值 = 三模块内置默认（历史基线，视觉零回退）
const WARM_LIT_LIGHT: Record<string, string> = {
  'ink': '#1c1612',
  'ink-secondary': '#2e2825',
  'ink-muted': '#6f6156',
  'ink-subtle': '#a69a90',
  'ink-faint': '#c4b8ad',
  'paper': '#f9f5ee',
  'paper-elevated': '#fffcf7',
  'paper-inset': '#ece2d4',
  'hover-bg': 'rgba(194, 109, 58, 0.07)',
  'hover-bg-strong': 'rgba(194, 109, 58, 0.12)',
  'accent': '#c26d3a',
  'accent-hover': '#e18a58',
  'accent-strong': '#b05e2d',
  'accent-subtle': 'rgba(194, 109, 58, 0.08)',
  'accent-muted': 'rgba(194, 109, 58, 0.15)',
  'accent-cool': '#2e6f5e',
  'accent-cool-hover': '#3d8a75',
  'on-accent': '#ffffff',
  'success': '#2d8a5e',
  'success-bg': '#e2f0e8',
  'error': '#dc2626',
  'error-bg': '#fee2e2',
  'error-hover': '#b91c1c',
  'warning': '#d97706',
  'warning-bg': '#fef3c7',
  'info': '#4a7ab5',
  'info-bg': '#e4ecf4',
  'line': 'rgb(28 22 18 / 0.28)',
  'line-strong': 'rgb(28 22 18 / 0.44)',
  'line-subtle': 'rgb(28 22 18 / 0.16)',
  'btn-primary-bg': '#c26d3a',
  'btn-primary-bg-hover': '#b05e2d',
  'btn-primary-text': '#ffffff',
  'btn-dark-bg': '#1c1612',
  'btn-dark-bg-hover': '#3a3532',
  'btn-dark-text': '#ffffff',
  'btn-secondary-bg': '#e8dccf',
  'btn-secondary-bg-hover': '#ddd0c2',
  'btn-secondary-text': '#1c1612',
}

const WARM_LIT_DARK: Record<string, string> = {
  'ink': '#e4dcd4',
  'ink-secondary': '#cfc5ba',
  'ink-muted': '#968a7e',
  'ink-subtle': '#685c52',
  'ink-faint': '#4a4038',
  'paper': '#1a1614',
  'paper-elevated': '#242018',
  'paper-inset': '#12100e',
  'hover-bg': 'rgba(212, 128, 63, 0.12)',
  'hover-bg-strong': 'rgba(212, 128, 63, 0.20)',
  'accent': '#d4803f',
  'accent-hover': '#e89860',
  'accent-strong': '#b05e2d',
  'accent-subtle': 'rgba(212, 128, 63, 0.12)',
  'accent-muted': 'rgba(212, 128, 63, 0.20)',
  'accent-cool': '#4aad8a',
  'accent-cool-hover': '#5ec49e',
  'on-accent': '#ffffff',
  'success': '#4aad7a',
  'success-bg': 'rgba(74, 173, 122, 0.15)',
  'error': '#ef4444',
  'error-bg': 'rgba(239, 68, 68, 0.15)',
  'error-hover': '#dc2626',
  'warning': '#f59e0b',
  'warning-bg': 'rgba(245, 158, 11, 0.15)',
  'info': '#6b9fd4',
  'info-bg': 'rgba(107, 159, 212, 0.15)',
  'line': 'rgb(228 220 212 / 0.10)',
  'line-strong': 'rgb(228 220 212 / 0.18)',
  'line-subtle': 'rgb(228 220 212 / 0.06)',
  'btn-primary-bg': '#b05e2d',
  'btn-primary-bg-hover': '#9c5027',
  'btn-primary-text': '#ffffff',
  'btn-dark-bg': '#443e36',
  'btn-dark-bg-hover': '#564e44',
  'btn-dark-text': '#e4dcd4',
  'btn-secondary-bg': '#302a22',
  'btn-secondary-bg-hover': '#3a342c',
  'btn-secondary-text': '#e4dcd4',
}

/** 暖纸陶土（默认，历史基线的延续与微调）。 */
const WARM: AgentLexTheme = makeTheme({
  key: 'warm',
  label: '暖纸陶土',
  desc: '米白暖纸底 + 柔和陶土橙，原版 AgentLex 的经典温度',
  swatch: ['#f7f2ea', '#fdfbf7', '#cf8f68'],
  paper: '#f9f5ee',
  elevated: '#fffcf7',
  inset: '#ece2d4',
  sidebar: '#f7f2ea',
  activeBg: '#f0e6da',
  ink: '#221b15',
  text: '#3a312a',
  muted: '#6f6254',
  subtle: '#a3927f',
  faint: '#b9ada2',
  accent: '#cf8f68',
  accentHover: '#c07d54',
  accentStrong: '#b05e2d',
  accentCool: '#2e6f5e',
  accentCoolHover: '#3d8a75',
  dPaper: '#1a1614',
  dElevated: '#242018',
  dInset: '#12100e',
  dSidebar: '#181412',
  dActiveBg: '#2b231b',
  dInk: '#e4dcd4',
  dLabel: '#e4dcd4',
  dMuted: '#968a7e',
  dSubtle: '#8c8276',
  dFaint: '#5c534a',
  dAccent: '#d4803f',
  dAccentHover: '#e89860',
  dAccentStrong: '#b05e2d',
}, {
  light: { lit: '#c26d3a', nl: '#2e6f5e', task: '#b08d2f' },
  dark: { lit: '#d4803f', nl: '#4aad8a', task: '#d4af4a' },
}, {
  litLight: WARM_LIT_LIGHT,
  litDark: WARM_LIT_DARK,
})

/** 紫藤烟雨：淡紫罗兰，书卷温柔。 */
const WISTERIA: AgentLexTheme = makeTheme({
  key: 'wisteria',
  label: '紫藤烟雨',
  desc: '雾白藤紫底 + 深紫罗兰花色，温柔的书房氛围',
  swatch: ['#f1edf6', '#faf8fc', '#7d68b3'],
  paper: '#f3eefb',
  elevated: '#f9f6fd',
  inset: '#e7e0f2',
  sidebar: '#f1edf6',
  activeBg: '#e7dff0',
  ink: '#241d33',
  text: '#352d47',
  muted: '#625a75',
  subtle: '#948ca6',
  faint: '#b3acc0',
  accent: '#7d68b3',
  accentHover: '#6e58a5',
  accentStrong: '#5e4a96',
  accentCool: '#2f7d6f',
  accentCoolHover: '#3a9484',
  dPaper: '#1a1622',
  dElevated: '#231d2e',
  dInset: '#131020',
  dSidebar: '#1d1826',
  dActiveBg: '#2c2438',
  dInk: '#e2dce8',
  dLabel: '#e2dce8',
  dMuted: '#9b92a8',
  dSubtle: '#877e94',
  dFaint: '#554e62',
  dAccent: '#a48fd6',
  dAccentHover: '#b5a4e0',
  dAccentStrong: '#7d68b3',
}, {
  light: { lit: '#7d68b3', nl: '#2f7d6f', task: '#b07a3e' },
  dark: { lit: '#a48fd6', nl: '#4ab3a1', task: '#d4a04a' },
})

/** 活力亮橙：纯白底 + 鲜艳亮橙，明快有能量。 */
const ORANGE: AgentLexTheme = makeTheme({
  key: 'orange',
  label: '活力亮橙',
  desc: '纯白净底 + 鲜活亮橙，明快有元气的工作氛围',
  swatch: ['#faf9f7', '#ffffff', '#fb923c'],
  paper: '#fdf6ee',
  elevated: '#fffaf3',
  inset: '#f3e8dc',
  sidebar: '#faf9f7',
  activeBg: '#fdefe2',
  ink: '#211d18',
  text: '#33291f',
  muted: '#64574a',
  subtle: '#9a9389',
  faint: '#b8b2a8',
  accent: '#fb923c',
  accentHover: '#f97316',
  accentStrong: '#ea580c',
  accentCool: '#0d9488',
  accentCoolHover: '#0f766e',
  dPaper: '#181512',
  dElevated: '#221e19',
  dInset: '#100e0c',
  dSidebar: '#1b1814',
  dActiveBg: '#2d241a',
  dInk: '#e8e2da',
  dLabel: '#e8e2da',
  dMuted: '#a39a8f',
  dSubtle: '#8b8177',
  dFaint: '#575046',
  dAccent: '#fb923c',
  dAccentHover: '#fdba74',
  dAccentStrong: '#f97316',
}, {
  light: { lit: '#f97316', nl: '#0d9488', task: '#7c3aed' },
  dark: { lit: '#fb923c', nl: '#2dd4bf', task: '#a78bfa' },
})

/** 纯白原版：纯白底 + 经典 DeepSeek 蓝，最接近 DSH 原生气质。 */
const PURE: AgentLexTheme = makeTheme({
  key: 'pure',
  label: '碧空蓝',
  desc: '浅蓝灰底 + 经典 DeepSeek 蓝，层次分明的原生风格',
  swatch: ['#eef1f7', '#ffffff', '#4d6bfe'],
  paper: '#eef1f7',
  elevated: '#ffffff',
  inset: '#e3eaf9',
  sidebar: '#dbe4f6',
  activeBg: '#dde5f6',
  ink: '#191b1f',
  text: '#2b2f36',
  muted: '#5c6370',
  subtle: '#8a919e',
  faint: '#adb3bf',
  accent: '#4d6bfe',
  accentHover: '#3d5bf5',
  accentStrong: '#2f49d6',
  accentCool: '#0d9488',
  accentCoolHover: '#0f766e',
  dPaper: '#161719',
  dElevated: '#1f2124',
  dInset: '#0f1012',
  dSidebar: '#1a1b1e',
  dActiveBg: '#26282e',
  dInk: '#e6e8eb',
  dLabel: '#e6e8eb',
  dMuted: '#9aa0aa',
  dSubtle: '#858b96',
  dFaint: '#595e66',
  dAccent: '#8296ff',
  dAccentHover: '#9cacff',
  dAccentStrong: '#4d6bfe',
}, {
  light: { lit: '#4d6bfe', nl: '#0d9488', task: '#d97706' },
  dark: { lit: '#8296ff', nl: '#2dd4bf', task: '#fbbf24' },
})

/** 青瓷竹绿：灰绿竹影，清冷克制（由 Codex 薄荷更名）。 */
const CODEX: AgentLexTheme = makeTheme({
  key: 'codex',
  label: '青瓷竹绿',
  desc: '灰绿竹影 + 墨绿青字，清冷克制的东方气质',
  swatch: ['#eef7f5', '#ffffff', '#2f8f81'],
  paper: '#eaf5f1',
  elevated: '#f4faf8',
  inset: '#d9ebe5',
  sidebar: '#eef7f5',
  activeBg: '#dcebe7',
  ink: '#1f2a27',
  text: '#393d3e',
  muted: '#676b6c',
  subtle: '#9a9f9f',
  faint: '#b7bcbc',
  accent: '#2f8f81',
  accentHover: '#27786c',
  accentStrong: '#1e6a5e',
  accentCool: '#3d5a80',
  accentCoolHover: '#4a6b96',
  dPaper: '#171b1a',
  dElevated: '#222624',
  dInset: '#101312',
  dSidebar: '#1d2120',
  dActiveBg: '#2a302e',
  dInk: '#e8eae9',
  dLabel: '#b9bab9',
  dMuted: '#909191',
  dSubtle: '#666867',
  dFaint: '#4a4d4c',
  dAccent: '#4fb3a5',
  dAccentHover: '#66c5b7',
  dAccentStrong: '#3d9c8f',
}, {
  light: { lit: '#2f8f81', nl: '#3d5a80', task: '#a07830' },
  dark: { lit: '#4fb3a5', nl: '#7d9cc9', task: '#d0a04a' },
})

/** 玄墨朱砂：卷宗纸感 × 印章朱砂，庄重的诉讼主场（design/THEME-PROPOSALS-2025.md 方案 A）。 */
const CINNABAR: AgentLexTheme = makeTheme({
  key: 'cinnabar',
  label: '玄墨朱砂',
  desc: '卷宗纸感 × 印章朱砂：庄重的诉讼主场，黛青承接非诉，鎏金标记任务与期限',
  swatch: ['#F1EBE0', '#FFFCF6', '#A93F2B'],
  paper: '#F7F3EC',
  elevated: '#FFFCF6',
  inset: '#EAE3D6',
  sidebar: '#F1EBE0',
  activeBg: '#F0E6D5',
  ink: '#23201B',
  text: '#3A362E',
  muted: '#6E6557',
  subtle: '#A29786',
  faint: '#C0B5A3',
  accent: '#A93F2B',
  accentHover: '#93321F',
  accentStrong: '#7E2A19',
  accentCool: '#2E6D5E',
  accentCoolHover: '#275C50',
  dPaper: '#171310',
  dElevated: '#211C16',
  dInset: '#0F0C0A',
  dSidebar: '#151110',
  dActiveBg: '#2A211A',
  dInk: '#E7DED1',
  dLabel: '#E7DED1',
  dMuted: '#9C9080',
  dSubtle: '#857A6B',
  dFaint: '#574E42',
  dAccent: '#D06A50',
  dAccentHover: '#DD8068',
  dAccentStrong: '#A93F2B',
}, {
  light: { lit: '#A93F2B', nl: '#2E6D5E', task: '#96742A' },
  dark: { lit: '#D06A50', nl: '#4FA48D', task: '#C9A44C' },
})

/** 墨玉鎏金：暖黑墨玉 × 鎏金点缀，庄重贵气、深色友好（design/THEME-PROPOSALS-2025.md 方案 D）。 */
const ONYX: AgentLexTheme = makeTheme({
  key: 'onyx',
  label: '墨玉鎏金',
  desc: '暖黑墨玉 × 鎏金点缀：庄重贵气，深色模式友好',
  swatch: ['#F0EAE0', '#FDFAF3', '#A67C00'],
  paper: '#F6F1E8',
  elevated: '#FDFAF3',
  inset: '#EAE2D2',
  sidebar: '#F0EAE0',
  activeBg: '#E9DFCC',
  ink: '#211D17',
  text: '#37322A',
  muted: '#6E6557',
  subtle: '#A29684',
  faint: '#C2B7A4',
  accent: '#A67C00',
  accentHover: '#966D00',
  accentStrong: '#7A5800',
  accentCool: '#2E6D5E',
  accentCoolHover: '#275C50',
  dPaper: '#171310',
  dElevated: '#211C16',
  dInset: '#0F0C0A',
  dSidebar: '#151110',
  dActiveBg: '#2A211A',
  dInk: '#E7DED1',
  dLabel: '#E7DED1',
  dMuted: '#9C9080',
  dSubtle: '#857A6B',
  dFaint: '#574E42',
  dAccent: '#D4A017',
  dAccentHover: '#E0B32E',
  dAccentStrong: '#B8860B',
}, {
  light: { lit: '#A67C00', nl: '#2E6D5E', task: '#8B5E3C' },
  dark: { lit: '#D4A017', nl: '#4FA48D', task: '#C9A44C' },
})

// ── warm 主题的 dsw：沿用 theme.ts 的手调基线 ────────────────
// 由 index.ts 组装：warm → AGENTLEX_THEME_TOKENS；其余 → theme.dsw

/** DSH 原生：与 DeepSeek Harness 官方 design-platform 配色一致，不做风格化。 */
const NATIVE: AgentLexTheme = makeTheme({
  key: 'dsh-native',
  label: 'DSH 原生',
  desc: '与 DSH 官方界面完全一致的配色，不做过多的品牌化调整',
  swatch: ['#f5f6f7', '#ffffff', '#4176e6'],
  paper: '#f5f6f7',
  elevated: '#ffffff',
  inset: '#eef0f3',
  sidebar: '#f5f6f7',
  activeBg: '#ebecee',
  ink: '#0f1115',
  text: '#0f1115',
  muted: '#61666b',
  subtle: '#81858c',
  faint: '#adb2b8',
  accent: '#4176e6',
  accentHover: '#679efe',
  accentStrong: '#4868b2',
  accentCool: '#0d9488',
  accentCoolHover: '#0f766e',
  dPaper: '#151517',
  dElevated: '#1d1d1f',
  dInset: '#101113',
  dSidebar: '#1a1b1d',
  dActiveBg: '#26272a',
  dInk: '#f5f6f7',
  dLabel: '#f5f6f7',
  dMuted: '#979da6',
  dSubtle: '#7d838c',
  dFaint: '#595e66',
  dAccent: '#679efe',
  dAccentHover: '#86a6fe',
  dAccentStrong: '#4176e6',
}, {
  light: { lit: '#4176e6', nl: '#0d9488', task: '#d97706' },
  dark: { lit: '#679efe', nl: '#2dd4bf', task: '#fbbf24' },
}, {
  // 关键表面直接使用官方 design-platform 精确值，其余由 derive 推导。
  dsw: {
    '--dsw-alias-bg-base': { light: '#ffffff', dark: '#151517' },
    '--dsw-alias-bg-layer-1': { light: '#ffffff', dark: '#1d1d1f' },
    '--dsw-alias-bg-layer-2': { light: '#ffffff', dark: '#212123' },
    '--dsw-alias-bg-layer-3': { light: '#f9fafb', dark: '#27282b' },
    '--dsw-alias-bg-module-platform': { light: '#f5f6f7', dark: '#1a1b1d' },
    '--dsw-specific-sidebar-fill': { light: '#f5f6f7', dark: '#1a1b1d' },
    '--dsw-specific-bubble': { light: '#edf3fe', dark: '#29292b' },
    '--dsw-alias-state-business-primary': { light: '#4176e6', dark: '#679efe' },
    '--dsw-static-deepseek-500': { light: '#4176e6', dark: '#679efe' },
    '--dsw-alias-label-primary': { light: '#0f1115', dark: '#f5f6f7' },
    '--dsw-alias-markdown-code-block': { light: '#f5f6f7', dark: '#161618' },
    '--dsw-alias-markdown-inline-code': { light: '#ebecee', dark: '#29292b' },
  },
})

export const AGENTLEX_THEMES: AgentLexTheme[] = [WARM, PURE, WISTERIA, ORANGE, CODEX, CINNABAR, ONYX, NATIVE]
export const DEFAULT_THEME_KEY = 'pure'

export function findTheme(key: string | undefined): AgentLexTheme {
  return AGENTLEX_THEMES.find((t) => t.core.key === key) ?? WARM
}

// ── --lit-* 覆盖 CSS 生成 ────────────────────────────────────

function varBlock(vars: Record<string, string>, indent: string): string {
  return Object.entries(vars)
    .map(([k, v]) => `${indent}--lit-${k}: ${v};`)
    .join('\n')
}

/**
 * 生成全部主题的 --lit-* 覆盖 CSS。特异性说明：
 *  - light：`html[data-agentlex-theme="x"]:root`（0-2-1）> 模块 `:root`（0-1-0）
 *  - dark：`html[...] body[data-ds-dark-theme]`（0-2-2）> 模块 `body[data-ds-dark-theme]`（0-1-1）
 * 不依赖注入顺序，任何时刻都能赢过三模块的内置默认值。
 * 同时输出每主题的三入口图标色 `--alx-tint-lit/-nl/-task`。
 */
export function buildThemesCss(): string {
  const chunks: string[] = []
  for (const t of AGENTLEX_THEMES) {
    const k = t.core.key
    chunks.push(`
/* ── ${t.core.label} (${k}) ── */
html[data-agentlex-theme="${k}"]:root {
${varBlock(t.litLight, '  ')}
  --alx-tint-lit: ${t.tints.light.lit};
  --alx-tint-nl: ${t.tints.light.nl};
  --alx-tint-task: ${t.tints.light.task};
  --alx-sidebar-via: ${t.core.sidebar};
  --alx-active-bg: ${t.core.activeBg};
  --alx-accent: ${t.core.accent};
}
html[data-agentlex-theme="${k}"] body[data-ds-dark-theme] {
${varBlock(t.litDark, '  ')}
  --alx-tint-lit: ${t.tints.dark.lit};
  --alx-tint-nl: ${t.tints.dark.nl};
  --alx-tint-task: ${t.tints.dark.task};
  --alx-sidebar-via: ${t.core.dSidebar};
  --alx-active-bg: ${t.core.dActiveBg};
  --alx-accent: ${t.core.dAccent};
}`)
  }
  return chunks.join('\n')
}
