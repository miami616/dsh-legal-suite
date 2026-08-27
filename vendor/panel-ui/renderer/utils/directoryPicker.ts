/**
 * Cross-environment directory picker for folder binding.
 *
 * AgentLex desktop (Tauri) opened the native dialog via
 * `@tauri-apps/plugin-dialog`. Inside DSH web there is no Tauri runtime, and
 * the old code early-returned on `!isTauriEnvironment()` — the 绑定文件夹 /
 * 更换 buttons in the mounted legacy UI (新建案件 / 案件详情 / 非诉详情 /
 * 任务树) were permanently dead in web mode (issue「案件绑定/更换文件夹仍然
 * 不可用」, still open at 0.7.5 because the fixed new UI was never mounted).
 *
 * This module picks a directory through, in order:
 *   1. `window.__agentlexPickDirectory` — the DSH bridge the plugin client
 *      publishes (backed by client-runtime `workspaces.pickDirectory()`, the
 *      host's native directory dialog). Works in DSH web and desktop alike.
 *   2. The Tauri plugin dialog — original desktop behaviour.
 *   3. `null` — caller falls back to manual path input (or a hint).
 */
import { isTauriEnvironment } from './browserMock';

declare global {
  interface Window {
    /** 插件 client 发布的 DSH 原生目录选择桥（apply 时注册，卸载时清理）。 */
    __agentlexPickDirectory?: (initialPath?: string) => Promise<string | null>;
    /** 最近一次目录选择失败的原因（诊断用；成功/取消时清空）。 */
    __agentlexPickLastError?: string;
  }
}

/**
 * Open a system directory picker and return the chosen absolute path.
 * @param title - dialog title (Tauri path only; DSH picker shows its own UI).
 * @returns the selected path, or null when cancelled / unavailable.
 */
export async function pickDirectoryPath(title: string, initialPath = ''): Promise<string | null> {
  // 1) DSH web: the plugin client bridges the host's native directory picker
  //    (with an in-app browse dialog fallback when the host serves browse).
  if (typeof window !== 'undefined' && typeof window.__agentlexPickDirectory === 'function') {
    try {
      return await window.__agentlexPickDirectory(initialPath);
    } catch (error) {
      const reason = `DSH 目录选择桥调用失败: ${error instanceof Error ? error.message : String(error)}`;
      console.warn('[agentlex]', reason);
      if (typeof window !== 'undefined') window.__agentlexPickLastError = reason;
      return null;
    }
  }
  // 桥未发布（插件 client 未加载/未执行 apply）：记录诊断后走下一分支。
  if (typeof window !== 'undefined' && !isTauriEnvironment()) {
    window.__agentlexPickLastError = '插件 client 未发布目录选择桥（window.__agentlexPickDirectory 缺失）';
  }
  // 2) Tauri desktop: the original native dialog.
  if (isTauriEnvironment()) {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({ directory: true, multiple: false, title });
      return selected && typeof selected === 'string' ? selected : null;
    } catch (error) {
      console.warn('[agentlex] Folder picker:', error);
      return null;
    }
  }
  // 3) No picker available — callers fall back to manual path input.
  return null;
}
