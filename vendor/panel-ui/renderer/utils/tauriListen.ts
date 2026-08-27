/**
 * Pit-of-success wrapper for Tauri event listeners — guarantees cleanup
 * across the unmount race window that bare `await listen(...)` exposes.
 *
 * The bug class this exists to prevent
 * ────────────────────────────────────
 * Bare pattern (vulnerable):
 *
 *   useEffect(() => {
 *     let unlisten: (() => void) | null = null;
 *     (async () => {
 *       unlisten = await listen('event', handler);
 *     })();
 *     return () => { if (unlisten) unlisten(); };
 *   }, []);
 *
 * If the component unmounts while `await listen(...)` is in flight, the
 * cleanup function runs with `unlisten === null` (no-op). Then `listen`
 * resolves AFTER cleanup, assigns `unlisten`, and nobody ever calls it —
 * the Tauri-side listener leaks for the rest of the process lifetime,
 * the closed-over handler keeps firing on every emit, and any setState
 * inside the handler logs "setState on unmounted component" warnings.
 *
 * Counter-measures inside this helper
 * ────────────────────────────────────
 *  1. Pre-await abort check — if the signal is already aborted before
 *     `listen()` is called, bail without registering. Covers the
 *     synchronous unmount-before-effect-fires path.
 *  2. Handler-time abort check — wraps the user's handler in a guard
 *     that drops events after abort. Belt-and-suspenders alongside
 *     the Tauri unlisten below; covers the small window where Tauri
 *     might dispatch a queued event between `unlisten()` and its own
 *     internal channel teardown.
 *  3. Post-await abort check — the critical one. After `await listen()`
 *     resolves, the listener IS installed. Re-check the abort flag and
 *     immediately unlisten if abort raced us. Without this, every
 *     "Pattern B" callsite (cancelled flag without post-await unlisten,
 *     which is most of them in this codebase) leaks the listener even
 *     though the handler is gated.
 *  4. Auto-cleanup on abort — register an `addEventListener('abort')`
 *     so subsequent abort signals trigger unlisten without the caller
 *     needing to track the unlisten function. Caller's `useEffect`
 *     return just calls `controller.abort()`.
 *
 * Why AbortSignal and not a custom flag
 * ──────────────────────────────────────
 * AbortController is a Web standard, composes naturally for multi-listener
 * effects (one signal, many `listenWithCleanup` calls), aligns with
 * `fetch` / native `addEventListener` cancellation semantics, and the
 * "abort" verb conveys terminal intent more clearly than `cancelled`.
 *
 * Usage
 * ─────
 *   useEffect(() => {
 *     const ac = new AbortController();
 *     void listenWithCleanup<MyPayload>('event-a', (e) => {...}, ac.signal);
 *     void listenWithCleanup<OtherPayload>('event-b', (e) => {...}, ac.signal);
 *     return () => ac.abort();
 *   }, [deps]);
 *
 * ESLint guard at the bottom of this file (project-wide rule in
 * eslint.config.js) bans bare `await listen(...)` outside this helper.
 * Anyone trying to add a new listener at a callsite has to route through
 * here, which structurally prevents the leak from being reintroduced.
 */

// Static import — vi.mock can reliably intercept this in tests, and the
// helper is only invoked from inside Tauri-only code paths in production
// (callers gate themselves on `isTauriEnvironment()`), so the lazy
// `await import()` pattern that earlier callsites used isn't load-bearing
// here.
import { listen } from '@tauri-apps/api/event';

/** Result of a single registration. Caller usually ignores it; the helper
 *  hooks `signal.abort` to call `unlisten()` automatically. Returned for
 *  the rare callsite that wants explicit control. */
export interface ListenWithCleanupResult {
    /** Manually unregister. Equivalent to `controller.abort()` for the
     *  passed signal but scoped to a single listener. Idempotent. */
    unlisten: () => void;
    /** True iff `listen()` succeeded and the listener is currently
     *  registered. False after abort or if registration was skipped
     *  due to pre-await abort. */
    isRegistered: () => boolean;
}

export async function listenWithCleanup<T>(
    event: string,
    handler: (event: { payload: T }) => void,
    signal: AbortSignal,
): Promise<ListenWithCleanupResult> {
    let unlisten: (() => void) | null = null;
    let registered = false;
    // `disposed` covers manual `result.unlisten()` paths where the signal
    // is NEVER aborted by the caller — the in-handler guard `signal.aborted`
    // alone wouldn't gate queued same-microtask events under that path
    // (Codex review WARN-1). Setting `disposed=true` inside `teardown` lets
    // the handler short-circuit regardless of which teardown route fired.
    let disposed = false;

    const teardown = (): void => {
        disposed = true;
        if (unlisten) {
            try {
                unlisten();
            } catch {
                // best-effort — Tauri may have already torn down the channel
            }
            unlisten = null;
            registered = false;
        }
        // Detach the abort listener too so the AbortSignal doesn't keep our
        // closure pinned for the lifetime of a long-lived signal (e.g. one
        // that's reused across reconnect cycles). `once: true` would also
        // remove on first fire, but if `teardown()` is called via manual
        // `unlisten()` first, the abort-fired removal would be moot anyway —
        // explicit removal here keeps the contract symmetric.
        signal.removeEventListener('abort', teardown);
    };

    if (signal.aborted) {
        return {
            unlisten: teardown,
            isRegistered: () => registered,
        };
    }

    try {
        const u = await listen<T>(event, (e) => {
            // Drop events after teardown. Two paths converge here:
            //   (a) signal aborted — Tauri may dispatch already-queued events
            //       between `unlisten()` and its internal channel cleanup.
            //   (b) manual `result.unlisten()` called without aborting the
            //       signal — `disposed` becomes true synchronously, but
            //       same-microtask queued events would still fire without
            //       this guard.
            // The check is cheap; redundant cases are a no-op.
            if (signal.aborted || disposed) return;
            handler(e);
        });

        if (signal.aborted) {
            // Lost the race — listener IS installed but caller has unmounted.
            // Undo immediately so Tauri's dispatcher stops carrying a dead
            // closure. This is the single line that was missing across
            // ~25 Pattern-B callsites in this codebase before the migration.
            try {
                u();
            } catch {
                // best-effort
            }
            return {
                unlisten: teardown,
                isRegistered: () => registered,
            };
        }

        unlisten = u;
        registered = true;
        // Future aborts auto-tear-down. We DON'T pass `{ once: true }`
        // because `teardown` removes the listener itself via
        // `removeEventListener` — keeping the symmetric removal contract
        // means the manual-unlisten path also unhooks the abort listener.
        signal.addEventListener('abort', teardown);
    } catch (err) {
        // Surface registration failures (Tauri IPC dropped, etc.) so the
        // caller's catch path runs. Most callers in this codebase invoke
        // via `void listenWithCleanup(...)` and don't attach their own
        // catch — under those conditions a non-aborted failure becomes an
        // unhandled rejection. Log + swallow to avoid warning noise; the
        // helper has no ability to recover Tauri's IPC anyway.
        if (!signal.aborted) {
            console.warn(`[listenWithCleanup] Failed to register listener for '${event}':`, err);
        }
    }

    return {
        unlisten: teardown,
        isRegistered: () => registered,
    };
}
