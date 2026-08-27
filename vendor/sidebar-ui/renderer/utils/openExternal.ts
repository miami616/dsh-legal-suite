// Open external URLs and files using system default applications.
//
// Web URLs (http/https/mailto) → Tauri `shell:allow-open` plugin.
// File paths and `file://` URLs → Rust invoke `cmd_open_path_with_default`.
//
// Why split: the default `shell:allow-open` scope regex
//   `^((mailto:\w+)|(tel:\w+)|(https?://\w+)).+`
// rejects ANY file target — both `file://...` and bare absolute paths. So
// for local files this helper hands off to the Rust command, which validates
// the path against `home/tmp prefix + credential blacklist + canonicalize`
// (anti-symlink-escape) before spawning the OS default app. See issue #125.
//
// Workspace context (issue #125 follow-up): Windows users with workspaces
// on non-system drives (`D:\`, mapped drives) hit `Path not allowed`
// because the workspace path doesn't start with `USERPROFILE` or `%TEMP%`.
// Callers that know the path lives inside a chat workspace pass
// `{ workspace: agentDir }` so Rust can add that root to the trusted-prefix
// list. The home-anchored credential blacklist (`<home>/.ssh`,
// `Library/Keychains`, etc.) still applies, but it does NOT cover
// workspace-relative credential dirs — that's consistent with the rest
// of the app and matches the behavior of the Rust validator (see
// `validate_external_open_path` in `system_open.rs`).
//
// Browser fallback mode (Vite dev served in a regular browser) keeps the
// existing `window.open` behavior for web URLs only — file paths can't be
// opened from a sandboxed renderer.
//
// Windows path note: `new URL("file:///C:/foo").pathname` returns
// `/C:/foo`, NOT a native `C:\foo`. `fileUrlToPath` strips the leading
// slash on a drive-letter prefix and normalizes separators, so the path
// reaches Rust as a real Windows path.

import { isTauriEnvironment } from './browserMock';

export interface OpenExternalOptions {
    /**
     * Workspace root the file target belongs to, for callers operating
     * inside a chat workspace (BrowserPanel previewing a workspace HTML
     * file, project-scope SkillDetailPanel / CommandDetailPanel). When
     * provided, Rust adds the canonical workspace root to the trusted
     * prefix list, fixing the "workspace on D:\ → Path not allowed" bug
     * (issue #125 follow-up). No-op for web URLs.
     */
    workspace?: string | null;
}

/**
 * Open a URL or file path using the system default application.
 * - HTTP/HTTPS / mailto / tel → Tauri shell.open (system default browser /
 *   email / dialer)
 * - `file://` URLs and absolute filesystem paths → Rust
 *   `cmd_open_path_with_default` (system default app for the file type)
 *
 * @param target - URL or file path to open
 * @param options - optional workspace context for file targets
 */
export async function openExternal(
    target: string,
    options?: OpenExternalOptions,
): Promise<void> {
    if (!target || typeof target !== 'string') {
        console.warn('[openExternal] Invalid target provided');
        return;
    }

    const trimmedTarget = target.trim();
    if (!trimmedTarget) {
        console.warn('[openExternal] Empty target provided');
        return;
    }

    if (isTauriEnvironment()) {
        // Local file targets cannot go through Tauri shell.open — route
        // through Rust invoke instead. Detect either `file://...` or a
        // platform-native absolute path.
        const filePath = toLocalFilePath(trimmedTarget);
        if (filePath) {
            try {
                const { invoke } = await import('@tauri-apps/api/core');
                // Workspace is forwarded as null when not provided so the
                // Rust `Option<String>` deserializer sees an explicit None
                // rather than a missing field.
                const workspace = options?.workspace?.trim() || null;
                await invoke('cmd_open_path_with_default', {
                    fullPath: filePath,
                    workspace,
                });
            } catch (error) {
                console.error('[openExternal] cmd_open_path_with_default failed:', error);
            }
            return;
        }

        // Web URLs (http/https/mailto/tel) — use the shell plugin.
        try {
            const { open } = await import('@tauri-apps/plugin-shell');
            await open(trimmedTarget);
        } catch (error) {
            console.error('[openExternal] shell.open failed:', error);
            // Fallback to window.open for URLs only
            if (isExternalUrl(trimmedTarget)) {
                window.open(trimmedTarget, '_blank', 'noopener,noreferrer');
            }
        }
    } else {
        // Browser mode: use window.open for URLs only. File targets are not
        // openable from a sandboxed renderer.
        if (isExternalUrl(trimmedTarget)) {
            window.open(trimmedTarget, '_blank', 'noopener,noreferrer');
        } else {
            console.warn('[openExternal] Cannot open file paths in browser mode:', trimmedTarget);
        }
    }
}

/**
 * Check if a string is an external URL (http, https, mailto)
 */
export function isExternalUrl(url: string): boolean {
    if (!url) return false;
    const lowerUrl = url.toLowerCase();
    return lowerUrl.startsWith('http://') ||
           lowerUrl.startsWith('https://') ||
           lowerUrl.startsWith('mailto:');
}

/**
 * If `target` is a `file://` URL or an absolute filesystem path, return the
 * native absolute path; otherwise null. Handles Windows drive letters.
 *
 * UNC `file://server/share/...` is not supported — `URL.pathname` drops the
 * host segment, so we'd silently lose `\\server\share`. Returns the
 * host-less path; callers should not rely on UNC opens through this helper.
 *
 * Exported for unit testing; callers should use `openExternal()` instead.
 */
export function toLocalFilePath(target: string): string | null {
    // file:// URL → decode pathname; strip leading `/` on Windows drive paths.
    if (/^file:\/\//i.test(target)) {
        try {
            const url = new URL(target);
            let pathname = decodeURIComponent(url.pathname);
            // Windows: `/C:/foo/bar.html` → `C:\foo\bar.html`
            if (/^\/[A-Za-z]:[/\\]/.test(pathname)) {
                pathname = pathname.slice(1).replace(/\//g, '\\');
            }
            return pathname || null;
        } catch {
            return null;
        }
    }
    // Absolute paths (Unix `/...`, Windows `C:\...` or `C:/...`).
    if (target.startsWith('/')) return target;
    if (/^[A-Za-z]:[\\/]/.test(target)) return target;
    return null;
}

/**
 * Check if a string looks like a file path (Unix/Windows/home).
 * Kept exported for legacy callers; new code should use `openExternal`
 * directly (it handles routing).
 */
export function isFilePath(str: string): boolean {
    if (!str) return false;
    if (str.startsWith('/')) return true;
    if (/^[a-zA-Z]:\\/.test(str)) return true;
    if (str.startsWith('~/')) return true;
    return false;
}
