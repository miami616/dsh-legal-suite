/**
 * Title-bar strip probe for the desktop shell (mirrors dsh-better-sidebar's
 * `wco.ts` + `--dsh-title-bar-strip` contract, minimal self-contained copy).
 *
 * Frameless desktop shells draw the native caption buttons (minimize /
 * maximize / close) OVER the top-right corner of the web content — on
 * Windows that is exactly where this plugin's workspace toggle floats, so
 * the button ends up unreachable / under the close button. This module
 * resolves how many pixels the top of the page yields to the shell chrome
 * and publishes it as the STANDARD `--dsh-title-bar-strip` CSS variable on
 * <html> plus `body[data-dsh-title-bar-compat]` (the same contract
 * dsh-better-sidebar uses), so the toggle and the panel can position below
 * the native strip instead of underneath the caption buttons.
 *
 * Resolution chain (first hit wins):
 *   1. Window Controls Overlay real geometry
 *      (`navigator.windowControlsOverlay.getTitlebarAreaRect()` — the
 *      standard, authoritative signal when present; follows maximize /
 *      restore / move via `geometrychange`). A present-but-invisible API
 *      (phantom, e.g. macOS builds) is treated as absent; a transient
 *      0-height while the overlay is hidden keeps the last known positive
 *      height so the toggle never jumps back under the caption buttons.
 *   2. The `dsh-desktop-titlebar-inset` URL contract parameter (a shell
 *      may stamp the exact pixels it reserves, 0–120 clamped).
 *   3. 0 — plain browser / no chrome to adapt.
 */
export interface WcoSource {
  readonly visible: boolean
  getTitlebarAreaRect(): { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  addEventListener(type: 'geometrychange', listener: () => void): void
  removeEventListener(type: 'geometrychange', listener: () => void): void
}

type Listener = () => void

let strip = 0
let lastPositive = 0
let source: WcoSource | undefined
let attached = false
let onChange: (() => void) | undefined
const listeners = new Set<Listener>()

/** Raw WCO height (0 when the API is absent / phantom / broken). */
function readWcoHeight(): number {
  if (source === undefined) return 0
  try {
    // A present-but-NOT-visible API is a phantom (headless Chromium, macOS
    // builds): it exposes the interface but draws no overlay — ignore it.
    if (source.visible !== true) return 0
    const rect = source.getTitlebarAreaRect()
    const height = Math.round(rect.height)
    return Number.isFinite(height) && height > 0 ? height : 0
  } catch {
    return 0
  }
}

/** Shell-declared inset from the URL contract parameter (clamped 0–120). */
function readUrlInset(): number {
  try {
    const params = new URLSearchParams(window.location.search.replace(/^\?/, ''))
    const raw = Number(params.get('dsh-desktop-titlebar-inset'))
    if (!Number.isFinite(raw)) return 0
    return Math.min(120, Math.max(0, Math.round(raw)))
  } catch {
    return 0
  }
}

function computeStrip(): number {
  const wco = readWcoHeight()
  if (wco > 0) {
    lastPositive = wco
    return wco
  }
  // WCO present but reports 0 (e.g. the overlay is hidden while maximized):
  // keep the last known positive height — never jump back under the buttons.
  if (source !== undefined) return lastPositive
  return readUrlInset()
}

function applyStrip(): void {
  const root = document.documentElement
  if (strip > 0) {
    document.body.setAttribute('data-dsh-title-bar-compat', '')
    root.style.setProperty('--dsh-title-bar-strip', `${strip}px`)
  } else {
    document.body.removeAttribute('data-dsh-title-bar-compat')
    root.style.removeProperty('--dsh-title-bar-strip')
  }
}

function emit(): void {
  const next = computeStrip()
  if (next !== strip) {
    strip = next
    applyStrip()
  }
  for (const listener of listeners) listener()
}

/** Attach the native geometrychange listener (once, page lifetime). */
function attach(): void {
  if (attached || typeof window === 'undefined' || typeof navigator === 'undefined') return
  attached = true
  const candidate = (navigator as unknown as { windowControlsOverlay?: WcoSource }).windowControlsOverlay
  if (candidate === undefined) return
  source = candidate
  onChange = (): void => emit()
  source.addEventListener('geometrychange', onChange)
  emit()
}

/** Current resolved strip height in CSS px (0 = nothing reserved). */
export function getTitleBarStrip(): number {
  attach()
  return strip
}

/** Subscribe to strip changes (fires immediately with the current value). */
export function subscribeTitleBarStrip(listener: Listener): () => void {
  attach()
  listeners.add(listener)
  listener()
  return () => {
    listeners.delete(listener)
  }
}

/** Detach the native geometrychange listener (module-level, page lifetime). */
export function disposeTitleBarStrip(): void {
  if (source !== undefined && onChange !== undefined) {
    source.removeEventListener('geometrychange', onChange)
  }
  onChange = undefined
  source = undefined
  attached = false
}
