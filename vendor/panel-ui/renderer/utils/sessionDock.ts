/**
 * sessionDock — the portal registry that lets a docked session render in a
 * business module's split-pane while its TabProvider stays mounted in the
 * always-mounted tab map (Phase 6).
 *
 * Why this exists: a chat session is 1:1 with its sidecar and must mount in
 * exactly ONE React-tree location for its whole life (two TabProviders → two
 * SSE connections → Owner conflict). So every chat tab's TabProvider lives in
 * the stable, display-gated tab map. When a session is DOCKED into a module
 * (sessionHost.kind === 'module'), the module renders an empty slot <div> and
 * registers it here under its contextId; the tab map reads the slot and
 * `createPortal`s the session's visible output into it. Switching modules
 * unmounts the slot (portal target gone → nothing painted) but NEVER unmounts
 * the TabProvider, so the session keeps streaming. Re-entering the module
 * re-registers the slot and the session reappears.
 *
 * Module-level external store (not context) so the tab map and the module pane
 * — which live in different subtrees — share one source of truth, and tabs
 * re-render via useSyncExternalStore the moment a slot appears/disappears.
 */

import { useSyncExternalStore } from 'react';

const slots = new Map<string, HTMLElement>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/** Module pane registers (or clears, with null) its session slot for a context. */
export function setSessionSlot(contextId: string, el: HTMLElement | null): void {
  if (el) {
    if (slots.get(contextId) === el) return;
    slots.set(contextId, el);
  } else {
    if (!slots.has(contextId)) return;
    slots.delete(contextId);
  }
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** Tab map reads the live slot for a docked session's contextId (null = not
 *  currently shown anywhere → render nothing). */
export function useSessionSlot(contextId: string | null | undefined): HTMLElement | null {
  return useSyncExternalStore(
    subscribe,
    () => (contextId ? slots.get(contextId) ?? null : null),
  );
}
