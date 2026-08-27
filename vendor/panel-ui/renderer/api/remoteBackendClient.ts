// remoteBackendClient — resolves the backend transport target for AgentLex
// data (cases / projects / schedules / tasks / thoughts).
//
// Two modes:
//  - Tauri (desktop): LOCAL. All three modules use `cmd_agentlex_*` / `cmd_task_*`
//    IPC through the Rust locked-core; the UI and the backend share one process.
//  - Web (browser): WEB. The renderer is served by the backend origin (dev Vite
//    proxy or the serving sidecar), so `getClientRemoteTarget()` points at the
//    current origin and `useAgentLex` / `taskCenter` dispatch the same commands
//    over HTTP to `/api/agentlex/*` / `/api/task/*` / `/api/thought/*`. An
//    optional token is sent as `x-myagents-remote-token` for cross-machine
//    deployments (LAN gateway / TLS); same-origin local web needs no token.
//
// This replaces the pre-port stub that always reported LOCAL mode — re-enabling
// the resolver is what lets the three business modules read/write REAL data from
// a browser with the EXISTING UI (no parallel shell).

import { isTauriEnvironment } from '@/utils/browserMock';

export type RemoteBackendMode = 'local' | 'web';

export interface RemoteBackendTarget {
    mode: RemoteBackendMode;
    isRemote: boolean;
    /** Gateway origin the transport prefixes HTTP calls with ('' in web = same-origin). */
    origin: string | null;
    /** Auth token for cross-machine gateway access; null when none configured. */
    token: string | null;
}

/** Header the web transport attaches when a token is configured (mirrors the
 *  Rust gateway's `REMOTE_AUTH_HEADER`). */
export const REMOTE_AUTH_HEADER = 'x-myagents-remote-token';

/** localStorage key holding the gateway token in web mode. Kept empty for
 *  same-origin (L1); filled by the future remote-backend settings surface (L5). */
const WEB_TOKEN_KEY = 'myagents:web-auth-token';

function loadWebToken(): string {
    try {
        return window.localStorage.getItem(WEB_TOKEN_KEY) ?? '';
    } catch {
        return '';
    }
}

const LOCAL_TARGET: RemoteBackendTarget = { mode: 'local', isRemote: false, origin: null, token: null };

/** Read the current resolved target. Desktop = LOCAL; browser = WEB (same-origin). */
export function getClientRemoteTarget(): RemoteBackendTarget {
    if (isTauriEnvironment()) return LOCAL_TARGET;
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return { mode: 'web', isRemote: true, origin, token: loadWebToken() || null };
}

/** True when the client should route backend traffic to a gateway origin. */
export function isRemoteBackend(): boolean {
    return getClientRemoteTarget().isRemote;
}

/** Kept for call-site compatibility; only reachable in Tauri-remote mode. */
export const REMOTE_FOLDER_PICK_BLOCKED_MSG =
    '远程模式下无法选择本机文件夹(主机打不开本机路径)。请在主机端操作。';

/** Prefix a same-origin path with the gateway origin when in web mode. */
export function applyRemoteOrigin(localUrl: string): string {
    const target = getClientRemoteTarget();
    if (target.mode !== 'web' || !target.origin) return localUrl;
    const path = localUrl.startsWith('/') ? localUrl : `/${localUrl}`;
    return `${target.origin}${path}`;
}

/** Auth headers for gateway access; empty for local / same-origin web. */
export function remoteAuthHeaders(): Record<string, string> {
    const target = getClientRemoteTarget();
    if (target.mode === 'web' && target.token) {
        return { [REMOTE_AUTH_HEADER]: target.token };
    }
    return {};
}
