/**
 * 技能与工具 — 面板联动事件。
 *
 * 打开面板事件（携带目标选项卡）；输入框按钮 / `/` 命令通过它唤起面板。
 * （召唤功能已移除：不写输入框指令，只做导航与管理。）
 */

/** 打开面板事件（携带目标选项卡）。 */
export const OPEN_PANEL_EVENT = 'agentlex:skills-tools-open'

export type SkillsToolsTab = 'skills' | 'tools'

export function openPanel(tab: SkillsToolsTab = 'skills'): void {
  window.dispatchEvent(new CustomEvent(OPEN_PANEL_EVENT, { detail: tab }))
}
