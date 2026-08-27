/**
 * 技能与工具 — 边栏入口（与 AGENTLEX 组同级并列、组下方）。
 *
 * 复用共享的 sidebar-entry-core 注入逻辑；行属性 data-agentlex-skills-entry
 * 不在皮肤侧栏组的收纳清单内，保持为 AGENTLEX 组的兄弟行（组下方）。
 */
import { mountSidebarEntry as mountSharedSidebarEntry } from './sidebar-entry-core.ts'
import css from './skills-tools.module.css'

/** 稳定 data 属性标识注入的入口行。 */
export const SKILLS_ENTRY_SELECTOR = '[data-agentlex-skills-entry]'

/** 内联图标：工具箱（技能与工具，线条风格，与业务域 16px 图标一致）。 */
const ICON = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="6.5" width="11" height="7" rx="1.5"/><path d="M5.5 6.5V5.2a1.7 1.7 0 0 1 1.7-1.7h1.6a1.7 1.7 0 0 1 1.7 1.7v1.3"/><path d="M2.5 9.5h11"/></svg>'

export interface SkillsSidebarEntryOptions {
  /** 点击动作（打开/关闭技能与工具页面）。 */
  onToggle(): void
  /** 激活态桥：页面打开时高亮入口行。 */
  active?: {
    subscribe(listener: () => void): () => void
    isOpen(): boolean
  }
}

/**
 * 挂载技能与工具边栏入口（与 AGENTLEX 组同级并列、组下方）。
 * @returns disposer 移除入口行与观察器。
 */
export function mountSkillsSidebarEntry(options: SkillsSidebarEntryOptions): () => void {
  return mountSharedSidebarEntry({
    rowAttribute: 'data-agentlex-skills-entry',
    rowSelector: SKILLS_ENTRY_SELECTOR,
    plugin: 'skills-tools',
    icon: ICON,
    css: css as unknown as Record<string, string>,
    label: () => '技能与工具',
    tooltip: () => '技能与工具 · 技能 / MCP 管理',
    onToggle: options.onToggle,
    position: 'after',
    familySelectors: ['[data-agentlex-group-items]', '[data-agentlex-group]'],
    active: options.active,
  })
}
