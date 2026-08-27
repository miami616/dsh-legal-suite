/**
 * Workflow/Runbook service-entry predicate — single source of truth for "is this
 * service entry a structured runtime (workflow or runbook)?".
 *
 * Matches:
 * - `'playbook'` — the legacy structured workflow runtime (retired engine)
 * - `'workflow'` — the RETIRED legacy literal (back-compat)
 * - `'runbook'` — the current structured runtime ("Workflow")
 *
 * Service entries created by the 装配车间 (WorkspaceHub) create flow are stamped
 * with the runtime matching the mode they were created for.
 * This predicate matches ALL structured runtimes so they appear in the
 * «我的 Workflow» list.
 */
export function isWorkflowServiceRuntime(
  runtime: string | null | undefined,
): boolean {
  return runtime === 'playbook' || runtime === 'workflow' || runtime === 'runbook';
}

/**
 * Predicate over a service-entry-shaped object. Kept structurally typed (only
 * reads `runtime`) so both the renderer `ServiceEntry` and any test fixture
 * satisfy it without importing the renderer type into shared/.
 */
export function isWorkflowServiceEntry(
  entry: { runtime?: string | null },
): boolean {
  return isWorkflowServiceRuntime(entry.runtime);
}

/**
 * Predicate for the "plain agent" bucket — the complement used by the «我的
 * Agent» list: builtin / unset / null, but NOT workflow and NOT an external
 * CLI runtime. Mirrors WorkspaceHub's agent split so the two lists stay
 * mutually exclusive and exhaustive over the runtimes the hub creates.
 */
export function isAgentServiceEntry(
  entry: { runtime?: string | null },
): boolean {
  const r = entry.runtime;
  return !r || r === 'builtin';
}
