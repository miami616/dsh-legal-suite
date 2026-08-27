// runAfterNextPaint — run a callback only AFTER the browser has painted the
// current frame.
//
// WHY this exists (root cause of the "new-tab 黄屏" jank):
//   App.openNewTabDeferred paints a cheap paper-colored placeholder in the
//   urgent click commit, then needs to mount the heavy real subtree (Launcher /
//   Settings / TaskCenter) afterwards. It used to clear the deferral inside a
//   React `useTransition`, i.e. at LOW priority. But every still-mounted
//   background Tab keeps firing NORMAL-priority state updates (SSE token
//   deltas, session-state polling, task notifications). A low-priority
//   transition is repeatedly interrupted/restarted by that churn and can stay
//   pending for 1-2s — so the full-screen placeholder lingers ("黄屏"). A
//   transition that is restarted N times also re-renders the subtree N times,
//   wasting wall-clock even when the app is idle.
//   Revealing the subtree in ONE normal-priority commit scheduled *after the
//   placeholder paints* fixes both: the commit is not starvable, and the click
//   already got its feedback from the placeholder.
//
// WHY double rAF (load-bearing):
//   The first requestAnimationFrame callback runs BEFORE the paint of the frame
//   whose commit scheduled it. A state update there could be batched into that
//   same, not-yet-painted frame — mounting the heavy subtree in the very frame
//   we were trying to keep cheap (re-introducing the click-frame jank). The
//   second rAF runs on the NEXT frame, guaranteeing the placeholder painted
//   first. This is the standard "after paint" idiom.
//
// Caveat: rAF is paused while the window is hidden/backgrounded, so "after
// paint" is only guaranteed for a visible document. That is exactly what we
// want here — there is no point mounting the heavy subtree while the user
// can't see it; the reveal simply waits until the window is foregrounded again.
//
// Returns a cancel function so callers can drop a pending callback (e.g. on
// unmount). Falls back to setTimeout when rAF is unavailable (non-browser /
// test env without a mocked rAF — note that fallback is not truly "after paint").
export function runAfterNextPaint(cb: () => void): () => void {
    if (typeof requestAnimationFrame !== 'function') {
        const t = setTimeout(cb, 0);
        return () => clearTimeout(t);
    }
    let innerHandle = 0;
    let cancelled = false;
    const outerHandle = requestAnimationFrame(() => {
        if (cancelled) return;
        innerHandle = requestAnimationFrame(() => {
            if (cancelled) return;
            cb();
        });
    });
    return () => {
        cancelled = true;
        cancelAnimationFrame(outerHandle);
        if (innerHandle) cancelAnimationFrame(innerHandle);
    };
}
