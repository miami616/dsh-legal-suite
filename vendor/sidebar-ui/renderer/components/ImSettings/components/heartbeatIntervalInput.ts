/**
 * Pure helpers for the "custom heartbeat interval" input in HeartbeatConfigCard.
 *
 * Background — issue #310. The custom <input> used to bind directly to the
 * persisted `HeartbeatConfig.intervalMinutes` (domain: integer minutes, min 5).
 * That conflated two distinct state machines:
 *
 *  1. Persisted minutes (drives the preset highlight + the actual scheduler)
 *  2. The string the user is currently typing (transient, may be temporarily
 *     invalid — e.g. "1" on the way to "10" — or may equal a preset for an
 *     instant — e.g. "5" on the way to "50")
 *
 * Binding the input directly to (1) caused two visible bugs:
 *  - Typing "10": the leading "1" is < 5, the change handler dropped it, the
 *    controlled value snapped back to "" and nothing made it into the box.
 *  - Typing "50": the leading "5" matched a preset, the derived "is custom"
 *    flag flipped to false, the input collapsed to "" and the "5 分钟" preset
 *    lit up — looking like keystrokes were rerouted to the preset buttons.
 *
 * The component now holds a local `customDraft: string | null` while the user
 * is editing, and calls `commitHeartbeatIntervalDraft` on blur to decide what
 * (if anything) to persist. These helpers are pure so they can be unit-tested
 * in the fast `unit` pool without DOM setup.
 */

export const HEARTBEAT_INTERVAL_MIN = 5;
export const HEARTBEAT_INTERVAL_MAX = 1440;

export type HeartbeatIntervalCommit =
    | { kind: 'commit'; value: number }
    | { kind: 'revert' };

/**
 * Decide what to do when the user finishes editing the custom interval input.
 * Empty / non-numeric drafts revert to the previously persisted value; numeric
 * drafts commit, clamped into [min, max] so out-of-range typing still produces
 * a sane persisted value.
 */
export function commitHeartbeatIntervalDraft(
    draft: string,
    options: { min?: number; max?: number } = {},
): HeartbeatIntervalCommit {
    const min = options.min ?? HEARTBEAT_INTERVAL_MIN;
    const max = options.max ?? HEARTBEAT_INTERVAL_MAX;
    const trimmed = draft.trim();
    if (trimmed === '') return { kind: 'revert' };
    // Parse the FULL numeric value first. `<input type="number">` accepts
    // scientific notation like "1e9", which `parseInt('1e9', 10)` truncates to
    // `1` (stops at 'e') — so a "billion" would clamp UP to min(5) instead of
    // DOWN to max(1440). `Number('1e9')` reads it as 1e9 → clamps to max. Fall
    // back to parseInt only for trailing-garbage drafts like "45abc" (Number →
    // NaN) that can't come from a number input but are kept tolerant for paste.
    let n = Number(trimmed);
    if (!Number.isFinite(n)) n = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(n)) return { kind: 'revert' };
    // Floor to integer minutes (the persisted domain) before clamping, so
    // "45.7" → 45 matches the legacy parseInt behavior.
    return { kind: 'commit', value: Math.max(min, Math.min(max, Math.floor(n))) };
}

/**
 * Resolve the controlled `value` for the custom input.
 *
 *  - While editing (draft !== null): show the draft verbatim — including
 *    intermediate values that are temporarily invalid or equal a preset.
 *    This is the load-bearing fix for #310: it stops the input from snapping
 *    back to "" the moment a digit lands on a preset boundary.
 *  - Idle (draft === null): show the persisted value only when it's a real
 *    custom (non-preset) commit; otherwise empty so the preset chips own
 *    the visual selection.
 */
export function resolveHeartbeatIntervalInputValue(
    draft: string | null,
    committedMinutes: number,
    presetValues: readonly number[],
): string {
    if (draft !== null) return draft;
    return presetValues.includes(committedMinutes) ? '' : String(committedMinutes);
}

/** Whether the committed minutes are a custom (non-preset) value. */
export function isHeartbeatIntervalCustom(
    committedMinutes: number,
    presetValues: readonly number[],
): boolean {
    return !presetValues.includes(committedMinutes);
}
