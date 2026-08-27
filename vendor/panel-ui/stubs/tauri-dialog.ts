/**
 * POC stub for @tauri-apps/plugin-dialog.
 *
 * The original folder-picker opens a native Tauri dialog. In DSH plugin mode
 * we don't have one, so the stub resolves to `null` (no selection).
 */

export async function open(
  _options?: Record<string, unknown>,
): Promise<string | string[] | null> {
  return null
}
