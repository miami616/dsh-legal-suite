import type { InstalledPlugin } from '../../../shared/types/im';

export function upsertInstalledPlugin(plugins: InstalledPlugin[], plugin: InstalledPlugin): InstalledPlugin[] {
  const existingIndex = plugins.findIndex(p => p.pluginId === plugin.pluginId);
  if (existingIndex === -1) return [...plugins, plugin];
  const next = plugins.slice();
  next[existingIndex] = plugin;
  return next;
}
