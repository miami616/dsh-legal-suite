// focusRetention — the one-line "don't steal focus on click" primitive.
//
// Problem (v0.1.69 UX round):
// On macOS WebKit / WKWebView, a touchpad tap synthesises the entire
// `pointerdown → mousedown → focus → mouseup → click` sequence inside a
// single frame (sub-16 ms). If an onClick handler then schedules a
// `requestAnimationFrame(() => otherElement.focus())`, the rAF fires
// mid-sequence and steals focus from the just-pressed button BEFORE
// WebKit has finalised the `click` event. WebKit interprets the
// focus-change as the interaction being cancelled and DROPS the click
// synthesis — the user sees only the `:active` animation (mousedown
// was accepted) but their onClick never runs. Physical click (press-
// and-hold) has ~50 ms of separation between mousedown and mouseup,
// so the rAF lands after click is complete, and the bug doesn't show.
//
// The right fix: stop fighting focus at all. If a button doesn't need
// focus (toolbar-style "toggle" / "run" / "open" actions where the
// primary input is a nearby textarea), just tell the browser not to
// give it focus in the first place. Standard HTML trick:
//     `<button onMouseDown={(e) => e.preventDefault()}>`
// Preventing default on mousedown cancels the focus transfer without
// affecting click. The input that previously had focus keeps it.
//
// Why a shared constant (pit-of-success):
// Every toolbar/mode/secondary-action button that shouldn't grab
// focus should apply the SAME handler. A shared constant makes that
// trivially greppable and keeps future additions on the correct path —
// no chance of someone writing `(e) => { e.preventDefault(); ... }`
// and subtly swallowing some other event property.
//
// When NOT to use this:
// - Buttons that SHOULD gain focus on click (primary CTA / form
//   submit / navigation that moves the user away from the current
//   input). Those are rare in our UI; default is "toolbar-style".
// - Inputs / textareas — they need focus, not retention.

/**
 * Apply as `onMouseDown` on any button that should not steal focus
 * from the currently focused element (typically an input/textarea).
 *
 * Example:
 * ```tsx
 * <button
 *   onClick={() => setMode('thought')}
 *   onMouseDown={retainFocusOnMouseDown}
 * >
 *   想法
 * </button>
 * ```
 */
export function retainFocusOnMouseDown(e: React.MouseEvent): void {
  // Primary button only. Focus retention is a left-click concern; calling
  // preventDefault on a right-/middle-button mousedown is pointless and risks
  // interfering with native right-click behaviour on buttons that also handle
  // `onContextMenu` (e.g. AgentCapabilitiesPanel command/skill rows).
  if (e.button !== 0) return;
  e.preventDefault();
}
