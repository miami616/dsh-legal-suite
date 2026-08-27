// agentlexRemote — translate a desktop `cmd_agentlex_*` invoke (command + camelCase
// args) into the equivalent Management-API HTTP call (`/api/agentlex/*` + snake_case
// body) for Plan A remote mode. The host's `/api/agentlex/*` routes call the SAME
// `crate::agentlex` locked-core functions the desktop cmd_* commands use, so a
// remote client and the host UI share one file lock + one registry-changed emit.
//
// This is PURE string/shape logic → unit-testable. The actual HTTP dispatch
// (through the gateway, with auth) lives in useAgentLex, which calls this to build
// the request. Mirrors the exact field mapping in src/server/admin-api.ts so the
// agent CLI and the remote desktop client hit the routes identically.

/** camelCase → snake_case for a single key. `caseId`→`case_id`,
 *  `targetGroupId`→`target_group_id`, `orderedIds`→`ordered_ids`. */
export function camelToSnake(key: string): string {
  return key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}

export interface AgentlexRemoteCall {
  method: 'GET' | 'POST';
  /** Path under the gateway origin, e.g. '/api/agentlex/register-case'. */
  path: string;
  /** JSON body for POST (snake_cased top-level keys); undefined for GET. */
  body?: Record<string, unknown>;
}

/**
 * Build the remote HTTP call for a desktop agentlex command.
 *
 * Rules (matching admin-api.ts):
 *  - `cmd_agentlex_read_registry` → GET /api/agentlex/read (no body).
 *  - everything else → POST /api/agentlex/<verb-with-dashes>, where the verb is
 *    the command minus the `cmd_agentlex_` prefix, underscores → dashes.
 *  - body: each top-level arg key camelCase→snake_case; VALUES pass through
 *    unchanged (nested `record`/`patch` keep the shape Rust expects — the same
 *    objects the desktop invoke would have sent).
 *
 * Returns null for a command this translator doesn't recognize (caller should
 * fall back / surface an error rather than POST to a guessed route).
 */
export function buildAgentlexRemoteCall(
  command: string,
  args: Record<string, unknown>,
): AgentlexRemoteCall | null {
  const PREFIX = 'cmd_agentlex_';
  if (!command.startsWith(PREFIX)) return null;
  const verb = command.slice(PREFIX.length);

  if (verb === 'read_registry') {
    return { method: 'GET', path: '/api/agentlex/read' };
  }

  const path = `/api/agentlex/${verb.replace(/_/g, '-')}`;
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    body[camelToSnake(k)] = v;
  }
  return { method: 'POST', path, body };
}
