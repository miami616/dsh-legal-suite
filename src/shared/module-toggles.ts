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
}

const DEFAULT_TOGGLES: ModuleToggles = {
  skinEnabled: true,
  litigationEnabled: true,
  nonlitigationEnabled: true,
  taskEnabled: true,
  skillsToolsEnabled: true,
  workspaceSidebarEnabled: true,
  openReferencesInSidebar: true,
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
