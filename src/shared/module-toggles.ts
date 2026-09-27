/**
 * Shared module toggle store.
 *
 * The AgentLex skin settings write here; the three module plugins read it to
 * decide whether to mount their sidebar entry / panel. Keeping it in the
 * shared original-ui package lets all plugins use one source of truth without
 * a hard dependency on the skin plugin.
 */
import { useSyncExternalStore } from 'react'

export interface ModuleToggles {
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
  /** 会话绑定案件/项目时，右边栏自动带上「案件卷宗」面板。 */
  autoOpenCaseTab: boolean
  /** 备忘录（memo）开关。 */
  memoEnabled: boolean
  /** 模拟法庭（moot-court）开关。 */
  mootCourtEnabled: boolean
}

const DEFAULT_TOGGLES: ModuleToggles = {
  skinEnabled: true,
  litigationEnabled: true,
  nonlitigationEnabled: true,
  taskEnabled: true,
  skillsToolsEnabled: true,
  workspaceSidebarEnabled: true,
  openReferencesInSidebar: true,
  autoOpenCaseTab: true,
  memoEnabled: true,
  // 实验性功能默认关闭，需在设置里开启。
  mootCourtEnabled: false,
}

let toggles: ModuleToggles = DEFAULT_TOGGLES
const listeners = new Set<() => void>()

export function getModuleToggles(): ModuleToggles {
  return toggles
}

export function setModuleToggles(next: Partial<ModuleToggles>): void {
  toggles = { ...toggles, ...next }
  for (const listener of listeners) listener()
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useModuleToggle(key: keyof ModuleToggles): boolean {
  return useSyncExternalStore(
    subscribe,
    () => toggles[key],
  )
}
