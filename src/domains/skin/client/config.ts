/**
 * AgentLex skin config store.
 *
 * Client-side copy of the host config, fetched from /api/agentlex-skin/config.
 * Brand components subscribe via useSyncExternalStore so a late fetch still
 * updates the UI.
 */
import { useSyncExternalStore } from 'react'
import { DEFAULT_THEME_KEY } from './themes.ts'
import { setModuleToggles } from '../../../shared/module-toggles'

export interface AgentLexSkinConfig {
  /** AgentLex 套件总开关：关闭后皮肤/三模块/技能工具/右边栏全部停用，回到 DSH 原生。 */
  agentlexEnabled: boolean
  userName: string
  brandEn: string
  brandZh: string
  skinEnabled: boolean
  litigationEnabled: boolean
  nonlitigationEnabled: boolean
  taskEnabled: boolean
  /** 技能与工具（面板 + 输入框选择项 + / @ 触发器）开关。 */
  skillsToolsEnabled: boolean
  /** 工作区右边栏（workspace-sidebar）开关。 */
  workspaceSidebarEnabled: boolean
  /** 会话内文件/链接点击用侧边栏打开。 */
  openReferencesInSidebar: boolean
  /** 外观主题 key：见 themes.ts AGENTLEX_THEMES（warm/pure/jade/ink/wisteria/orange/codex/cinnabar/indigo/celadon/onyx） */
  theme: string
  /** 会话排版：AI 输出与用户消息两端对齐显示。 */
  conversationJustify: boolean
  /** 会话排版增强：行距段距与原生一致、可见背景块、彩色表头。 */
  conversationEnhance: boolean
}

const DEFAULT_CONFIG: AgentLexSkinConfig = {
  agentlexEnabled: true,
  userName: 'User',
  brandEn: 'AgentLex',
  brandZh: '超级律师助理',
  skinEnabled: true,
  litigationEnabled: true,
  nonlitigationEnabled: true,
  taskEnabled: true,
  skillsToolsEnabled: true,
  workspaceSidebarEnabled: true,
  openReferencesInSidebar: true,
  theme: DEFAULT_THEME_KEY,
  conversationJustify: true,
  conversationEnhance: true,
}

let config: AgentLexSkinConfig = DEFAULT_CONFIG
const listeners = new Set<() => void>()

/** 主题选择的 localStorage 兜底键（settings 链路在非 loopback 连接下不持久化）。 */
const THEME_STORAGE_KEY = 'agentlex-skin:theme'
/** 品牌与欢迎语（brandEn/brandZh/userName）的 localStorage 兜底键：保证刷新后
 * 首页欢迎称呼/品牌不因 settings scope 水合时序竞态而回退到默认值。 */
const BRAND_STORAGE_KEY = 'agentlex-skin:brand'

export function getSkinConfig(): AgentLexSkinConfig {
  return config
}

/** 从 localStorage 恢复持久化的品牌字段（渲染前调用，刷新时先于异步 fetch）。 */
export function restoreBrandFromStorage(): void {
  try {
    const raw = localStorage.getItem(BRAND_STORAGE_KEY)
    if (raw === null || raw === '') return
    const parsed = JSON.parse(raw) as Partial<Pick<AgentLexSkinConfig, 'brandEn' | 'brandZh' | 'userName'>>
    const patch: Partial<AgentLexSkinConfig> = {}
    for (const key of ['brandEn', 'brandZh', 'userName'] as const) {
      const value = parsed[key]
      if (typeof value === 'string' && value.trim() !== '') patch[key] = value
    }
    if (Object.keys(patch).length > 0) setSkinConfig(patch)
  } catch { /* ignore */ }
}

/** localStorage 是否已有非空品牌覆盖（欢迎称呼/中英文品牌）。 */
export function hasStoredBrand(): boolean {
  try {
    const raw = localStorage.getItem(BRAND_STORAGE_KEY)
    if (raw === null || raw === '') return false
    const parsed = JSON.parse(raw) as { brandEn?: unknown; brandZh?: unknown; userName?: unknown }
    return ['brandEn', 'brandZh', 'userName'].some((k) => typeof parsed[k as keyof typeof parsed] === 'string' && (parsed[k as keyof typeof parsed] as string).trim() !== '')
  } catch {
    return false
  }
}

/**
 * 同步初始化主题（渲染前调用）：优先读 localStorage 的用户选择，
 * 无记录时用默认主题。避免刷新时先显示默认主题再跳转的闪烁。
 */
export function initThemeFromStorage(): void {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY)
    if (saved !== null && saved !== '') setSkinConfig({ theme: saved })
    else setSkinConfig({ theme: DEFAULT_THEME_KEY })
  } catch { /* ignore */ }
}

export function setSkinConfig(next: Partial<AgentLexSkinConfig>): void {
  config = { ...config, ...next }
  if (next.theme !== undefined) {
    try { localStorage.setItem(THEME_STORAGE_KEY, next.theme) } catch { /* ignore */ }
  }
  // 品牌字段（欢迎称呼/中英文品牌）持久化到 localStorage：设置写入后即使
  // settings scope 水合竞态或非 loopback 连接不持久化，刷新也能恢复。
  if (next.brandEn !== undefined || next.brandZh !== undefined || next.userName !== undefined) {
    try {
      localStorage.setItem(BRAND_STORAGE_KEY, JSON.stringify({
        brandEn: config.brandEn,
        brandZh: config.brandZh,
        userName: config.userName,
      }))
    } catch { /* ignore */ }
  }
  // 总开关联动：agentlexEnabled 关闭时各模块开关视为全关（保留原值，重开即恢复）；
  // 同步到共享 module-toggles（三模块/技能读取）与 agentlex:toggles-changed（右边栏读取）。
  const effective = (v: boolean): boolean => config.agentlexEnabled && v
  setModuleToggles({
    skinEnabled: effective(config.skinEnabled),
    litigationEnabled: effective(config.litigationEnabled),
    nonlitigationEnabled: effective(config.nonlitigationEnabled),
    taskEnabled: effective(config.taskEnabled),
    skillsToolsEnabled: effective(config.skillsToolsEnabled),
    workspaceSidebarEnabled: effective(config.workspaceSidebarEnabled),
    openReferencesInSidebar: effective(config.openReferencesInSidebar),
  })
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('agentlex:toggles-changed', {
      detail: {
        agentlexEnabled: config.agentlexEnabled,
        skinEnabled: effective(config.skinEnabled),
        litigationEnabled: effective(config.litigationEnabled),
        nonlitigationEnabled: effective(config.nonlitigationEnabled),
        taskEnabled: effective(config.taskEnabled),
        skillsToolsEnabled: effective(config.skillsToolsEnabled),
        workspaceSidebarEnabled: effective(config.workspaceSidebarEnabled),
        openReferencesInSidebar: effective(config.openReferencesInSidebar),
        conversationJustify: config.conversationJustify,
        conversationEnhance: config.conversationEnhance,
      },
    }))
  }
  for (const listener of listeners) listener()
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useSkinConfig(): AgentLexSkinConfig {
  return useSyncExternalStore(subscribe, getSkinConfig)
}

async function fetchConfig(path: string): Promise<AgentLexSkinConfig | undefined> {
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: '{}',
    })
    if (!response.ok) return undefined
    const envelope = await response.json() as { success?: boolean; data?: AgentLexSkinConfig }
    return envelope.success === true ? envelope.data : undefined
  } catch {
    return undefined
  }
}

/**
 * 品牌字段（brandEn/brandZh/userName）保护：当 localStorage 已有用户偏好时，
 * 传入 patch 里的默认/服务器默认品牌值不得覆盖本地偏好——避免 settings scope
 * 水合时序竞态或重复 namespace 注册导致某条路由返回默认值（如 userName='User'）
 * 把用户设置的称呼重置。返回过滤后的 patch（theme 等非品牌字段不受影响）。
 */
export function guardStoredBrand<T extends Partial<AgentLexSkinConfig>>(patch: T): T {
  if (!hasStoredBrand()) return patch
  const result: Partial<AgentLexSkinConfig> = { ...patch }
  delete result.brandEn
  delete result.brandZh
  delete result.userName
  return result as T
}

export async function loadSkinConfig(): Promise<void> {
  const suite = await fetchConfig('/api/agentlex-suite/config')
  const standalone = await fetchConfig('/api/agentlex-skin/config')
  // suite 路由可能不含 userName 等新字段，skin 路由再补一份，保证设置能生效。
  // host 返回的 theme 是旧默认（warm），一律忽略——theme 只由 localStorage/默认主题决定。
  if (suite) {
    const { theme: _ignored, ...rest } = suite
    setSkinConfig(guardStoredBrand(rest))
  }
  if (standalone) {
    const { theme: _ignored, ...rest } = standalone
    setSkinConfig(guardStoredBrand(rest))
  }
  // localStorage 兜底：用户选择的主题优先于默认；无本地记录时用默认主题（pure）。
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY)
    if (saved !== null && saved !== '') setSkinConfig({ theme: saved })
    else setSkinConfig({ theme: DEFAULT_THEME_KEY })
  } catch { /* ignore */ }
  // 品牌（欢迎称呼 userName 等）以 localStorage 持久化的用户偏好为权威：
  // 服务器 scope 可能因水合时序/非 loopback 未持久化而返回默认值（userName 回退
  // 为 'User'），这里在 fetch 之后再覆盖回去，确保刷新后称呼不丢失。
  restoreBrandFromStorage()
}
