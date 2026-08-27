/**
 * AgentLex 设计色彩体系（DSH shell token 映射）。
 *
 * 会话主体与 DSH 原生保持一致（白底黑字、可见的背景块、主题色气泡底），
 * 主题色/暖色只保留在品牌、侧边栏、按钮、激活态与气泡底色上：
 *  - 会话主底纯白（#ffffff，与原生一致），不再带米色
 *  - 主文字近黑（warm ink #221b15），不再偏棕
 *  - 用户气泡用主题色浅底（浅杏 #f7e7d4），浅色下清晰可见
 *  - 代码/引用/行内代码等背景块恢复为可见的浅灰
 *  - 侧边栏仍略深（#f9f4ed），与主页面形成层次
 */

export type AgentLexTokenOverrides = Record<string, { light: string; dark: string }>

export const AGENTLEX_THEME_TOKENS: AgentLexTokenOverrides = {
  // ── 背景层次（会话主区纯白，与 DSH 原生一致） ──────────────
  '--dsw-alias-bg-base': { light: '#ffffff', dark: '#1a1614' },
  '--dsw-alias-bg-layer-1': { light: '#ffffff', dark: '#242018' },
  '--dsw-alias-bg-layer-2': { light: '#fcfaf6', dark: '#12100e' },
  '--dsw-alias-bg-layer-3': { light: '#f8f4ee', dark: '#181412' },
  '--dsw-alias-bg-overlay': { light: '#f9f5ef', dark: '#2a241e' },
  '--dsw-alias-bg-module-platform': { light: '#fcf9f5', dark: '#181412' },
  '--dsw-alias-bg-multi-select': { light: '#f8f4ee', dark: '#2a241e' },
  '--dsw-alias-bg-mask-1': { light: 'rgba(28, 22, 18, 0.24)', dark: 'rgba(0, 0, 0, 0.5)' },
  '--dsw-alias-bg-mask-2': { light: 'rgba(28, 22, 18, 0.10)', dark: 'rgba(0, 0, 0, 0.3)' },
  '--dsw-alias-bg-mask-3': { light: 'rgba(28, 22, 18, 0.45)', dark: 'rgba(0, 0, 0, 0.6)' },

  // ── 边框层次（更轻） ───────────────────────────────────────
  '--dsw-alias-border-l1': { light: 'rgba(28, 22, 18, 0.04)', dark: 'rgba(228, 220, 212, 0.06)' },
  '--dsw-alias-border-l2': { light: 'rgba(28, 22, 18, 0.07)', dark: 'rgba(228, 220, 212, 0.10)' },
  '--dsw-alias-border-l3': { light: 'rgba(28, 22, 18, 0.11)', dark: 'rgba(228, 220, 212, 0.16)' },
  '--dsw-alias-border-l4': { light: 'rgba(28, 22, 18, 0.16)', dark: 'rgba(228, 220, 212, 0.22)' },

  // ── 品牌 / 操作（陶土橙提亮降饱和，柔和杏色） ────────────────
  '--dsw-alias-brand-primary': { light: '#cf8f68', dark: '#d4803f' },
  '--dsw-alias-brand-primary-invert': { light: '#fffdfb', dark: '#1a1614' },
  '--dsw-alias-brand-text': { light: '#3a3129', dark: '#e4dcd4' },
  '--dsw-alias-button-primary-fill': { light: '#cf8f68', dark: '#b05e2d' },
  '--dsw-alias-button-primary-hover': { light: '#c07d54', dark: '#9c5027' },
  '--dsw-alias-button-primary-dimmed': { light: '#f5ead9', dark: '#3a2d20' },
  '--dsw-alias-button-elevated-fill': { light: '#fffefd', dark: '#242018' },
  '--dsw-alias-button-contrast-fill': { light: '#4a4137', dark: '#443e36' },
  // 会话输入/信息按钮：DSH 默认用 DeepSeek 蓝，改成 AgentLex 杏橙
  '--dsw-alias-button-info-fill': { light: '#cf8f68', dark: '#b05e2d' },
  '--dsw-alias-button-info-hover': { light: '#c07d54', dark: '#9c5027' },
  // 轨迹/详情里的品牌主色，也统一成杏橙
  '--dsw-alias-brand-primary-new-colorprimary-new-color': { light: '#cf8f68', dark: '#d4803f' },
  // DSH 静态 DeepSeek 蓝：会话运行状态等仍会直接用，映射成暖杏色系
  '--dsw-static-deepseek-50': { light: '#fbf6ef', dark: '#2a211b' },
  '--dsw-static-deepseek-100': { light: '#f9f1e8', dark: '#33281f' },
  '--dsw-static-deepseek-200': { light: '#f6e9d9', dark: '#3a2d20' },
  '--dsw-static-deepseek-400': { light: '#d8a06c', dark: '#c26d3a' },
  '--dsw-static-deepseek-450': { light: '#cf8f68', dark: '#d4803f' },
  '--dsw-static-deepseek-500': { light: '#cf8f68', dark: '#b05e2d' },
  '--dsw-static-deepseek-800': { light: '#5d4e3f', dark: '#3a2d20' },

  // ── Markdown / 代码块：可见浅灰底（原生 bluish-50/100 等价），不再白到隐形 ──
  '--dsw-alias-markdown-code-block': { light: '#fbf8f3', dark: '#241f1a' },
  '--dsw-alias-markdown-code-block-banner': { light: '#f6f1e9', dark: '#2b231b' },
  '--dsw-alias-markdown-inline-code': { light: '#f8f4ee', dark: '#2a241e' },
  '--dsw-alias-markdown-citation': { light: '#fbf8f4', dark: '#2b231b' },
  '--dsw-alias-markdown-code-segment-selected': { light: '#fffefc', dark: '#2a241e' },
  '--dsw-alias-markdown-code-segment-unselected': { light: '#f9f6f0', dark: '#1a1614' },
  '--dsw-alias-markdown-placeholder': { light: '#fcfaf7', dark: '#201b16' },
  '--dsw-alias-markdown-tag': { light: '#f9f6f0', dark: '#201b16' },

  // ── DSH 静态中性色：亮端纯白（与原生 bluish-00 一致） ────────
  '--dsw-static-neutral-bluish-00': { light: '#ffffff', dark: '#ffffff' },
  '--dsw-static-neutral-bluish-50': { light: '#fcfbf8', dark: '#fcfbf8' },
  '--dsw-static-neutral-bluish-60': { light: '#faf8f4', dark: '#faf8f4' },
  '--dsw-static-neutral-bluish-75': { light: '#f7f3ed', dark: '#f7f3ed' },
  '--dsw-static-neutral-bluish-100': { light: '#f4f0e9', dark: '#f4f0e9' },
  '--dsw-static-neutral-bluish-150': { light: '#f1ece4', dark: '#f1ece4' },
  '--dsw-static-neutral-bluish-200': { light: '#eae3d8', dark: '#eae3d8' },
  '--dsw-static-neutral-bluish-300': { light: '#e0d4c5', dark: '#e0d4c5' },
  '--dsw-static-neutral-bluish-400': { light: '#c7b9a7', dark: '#c7b9a7' },
  '--dsw-static-neutral-bluish-500': { light: '#b3a593', dark: '#b3a593' },
  '--dsw-static-neutral-bluish-600': { light: '#9e9080', dark: '#9e9080' },
  '--dsw-static-neutral-bluish-700': { light: '#7f7062', dark: '#7f7062' },
  '--dsw-static-neutral-bluish-750': { light: '#635549', dark: '#635549' },
  '--dsw-static-neutral-bluish-800': { light: '#4c4137', dark: '#4c4137' },
  '--dsw-static-neutral-bluish-850': { light: '#3e352d', dark: '#3e352d' },
  '--dsw-static-neutral-bluish-875': { light: '#332c25', dark: '#332c25' },
  '--dsw-static-neutral-bluish-900': { light: '#28221c', dark: '#28221c' },
  '--dsw-static-neutral-bluish-950': { light: '#1f1a16', dark: '#1f1a16' },
  '--dsw-static-neutral-bluish-1000': { light: '#171310', dark: '#171310' },

  // ── 交互（更浅更克制的暖色） ────────────────────────────────
  '--dsw-alias-interactive-bg-hover': { light: 'rgba(207, 143, 104, 0.05)', dark: 'rgba(212, 128, 63, 0.10)' },
  '--dsw-alias-interactive-bg-active': { light: 'rgba(207, 143, 104, 0.08)', dark: 'rgba(212, 128, 63, 0.18)' },
  '--dsw-alias-interactive-bg-hover-accent': { light: 'rgba(207, 143, 104, 0.06)', dark: 'rgba(212, 128, 63, 0.14)' },
  '--dsw-alias-interactive-bg-hover-danger': { light: 'rgba(220, 38, 38, 0.04)', dark: 'rgba(239, 68, 68, 0.12)' },

  // ── 文字层次（主文字近黑，与原生 bluish-1000 观感一致） ────
  '--dsw-alias-label-primary': { light: '#221b15', dark: '#e4dcd4' },
  '--dsw-alias-label-secondary': { light: '#6f6254', dark: '#cfc5ba' },
  '--dsw-alias-label-tertiary': { light: '#a3927f', dark: '#968a7e' },
  '--dsw-alias-label-caption': { light: '#b9ada2', dark: '#685c52' },
  '--dsw-alias-label-dimmed': { light: '#d3c8bc', dark: '#4a4038' },
  '--dsw-alias-label-primary-foreground': { light: '#fffdf9', dark: '#1a1614' },
  '--dsw-alias-label-primary-inverted': { light: '#fffdf9', dark: '#e4dcd4' },

  // ── 语义色（原版，低饱和柔和、整体淡雅） ─────────────────────
  '--dsw-alias-state-business-primary': { light: '#cf8f68', dark: '#d4803f' },
  '--dsw-alias-state-business-tertiary': { light: 'rgba(207, 143, 104, 0.08)', dark: 'rgba(212, 128, 63, 0.12)' },
  '--dsw-alias-state-success-primary': { light: '#4e9c6f', dark: '#4aad7a' },
  '--dsw-alias-state-success-secondary': { light: '#56ac7e', dark: '#5ec49e' },
  '--dsw-alias-state-success-tertiary': { light: '#e4f1e9', dark: 'rgba(74, 173, 122, 0.15)' },
  '--dsw-alias-state-error-primary': { light: '#cd6b6b', dark: '#ef4444' },
  '--dsw-alias-state-error-secondary': { light: '#e07070', dark: '#f27e7e' },
  '--dsw-alias-state-error-tertiary': { light: '#fdeaea', dark: 'rgba(239, 68, 68, 0.15)' },
  '--dsw-alias-state-warn-primary': { light: '#d19a33', dark: '#f59e0b' },
  '--dsw-alias-state-warn-secondary': { light: '#e0a548', dark: '#f7b955' },
  '--dsw-alias-state-warn-tertiary': { light: '#faf1d8', dark: 'rgba(245, 158, 11, 0.15)' },
  '--dsw-alias-state-info-primary': { light: '#6492c2', dark: '#6b9fd4' },
  '--dsw-alias-state-info-tertiary': { light: '#e6edf5', dark: 'rgba(107, 159, 212, 0.15)' },

  // ── 侧边栏（略深，和主页面区分） ───────────────────────────
  '--dsw-specific-sidebar-fill': { light: '#f9f4ed', dark: '#181412' },
  '--dsw-specific-sidebar-nav-item-active': { light: '#f0e6da', dark: '#241d17' },
  '--dsw-specific-sidebar-nav-item-hover': { light: 'rgba(207, 143, 104, 0.05)', dark: 'rgba(212, 128, 63, 0.12)' },
  '--dsw-specific-sidebar-nav-item-active-accent': { light: '#cf8f68', dark: '#d4803f' },
  '--dsw-specific-sidebar-nav-item-active-bg': { light: '#f0e6da', dark: '#2b231b' },

  // ── 会话 / 气泡 / 输入（气泡恢复主题色浅底，浅色下清晰可见） ──
  '--dsw-specific-bubble': { light: '#f7e7d4', dark: '#242018' },
  '--dsw-specific-bubble-highlight': { light: '#f1dcc1', dark: '#2b231b' },
  '--dsw-specific-input-major': { light: '#ffffff', dark: '#242018' },
  '--dsw-specific-menu': { light: '#ffffff', dark: '#242018' },
  '--dsw-specific-selector': { light: '#f8f4ee', dark: '#201b16' },
  '--dsw-specific-tip': { light: '#fcfaf6', dark: '#201b16' },
}
