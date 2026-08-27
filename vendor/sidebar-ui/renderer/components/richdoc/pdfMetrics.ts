/**
 * Pure layout math for PdfViewer — extracted so the tricky bits (DPR clamping,
 * fit-to-width scale, device-pixel canvas sizing, placeholder height) are
 * unit-testable without pdf.js / canvas / a real WebView. The component wires
 * these to the live scroller width + pdf.js page viewports.
 */

/** Min page-container width; below this a page would be unreadably small. */
export const MIN_PAGE_WIDTH = 320;
/** Horizontal breathing room subtracted from the scroller's client width. */
export const PAGE_WIDTH_PADDING = 32;
/** Cap device-pixel ratio: past 2× the canvas memory cost isn't worth it. */
export const MAX_DPR = 2;

/** Page-container width derived from the scroll container's client width. */
export function pageContainerWidth(scrollerClientWidth: number): number {
  return Math.max(scrollerClientWidth - PAGE_WIDTH_PADDING, MIN_PAGE_WIDTH);
}

/**
 * Effective device-pixel ratio: falsy (0 / NaN / undefined) → 1, capped at
 * MAX_DPR. pdf.js v5 does NOT auto-apply DPR, so the caller scales the canvas
 * backing store + render transform by this.
 */
export function clampDpr(devicePixelRatio: number | undefined | null): number {
  return Math.min(devicePixelRatio || 1, MAX_DPR);
}

/** Fit-to-width scale: factor to scale a page (at native scale 1) to fill width. */
export function fitScale(containerWidth: number, pageWidthAtScale1: number): number {
  return containerWidth / pageWidthAtScale1;
}

/** Placeholder height estimate from the page aspect ratio (before render). */
export function estimatedPageHeight(
  containerWidth: number,
  pageWidthAtScale1: number,
  pageHeightAtScale1: number,
): number {
  return Math.round(containerWidth * (pageHeightAtScale1 / pageWidthAtScale1));
}

/** Backing-store (device-pixel) canvas size for a scaled viewport. */
export function deviceCanvasSize(
  viewportWidth: number,
  viewportHeight: number,
  dpr: number,
): { width: number; height: number } {
  return {
    width: Math.floor(viewportWidth * dpr),
    height: Math.floor(viewportHeight * dpr),
  };
}
