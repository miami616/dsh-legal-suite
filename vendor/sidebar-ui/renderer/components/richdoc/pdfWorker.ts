/**
 * pdf.js worker wiring — side-effect import.
 *
 * Sets `GlobalWorkerOptions.workerSrc` to a **same-origin, Vite-bundled** worker
 * asset (`?url` resolves to a hashed file served from our own origin). This is
 * the load-bearing CSP detail: the current `script-src 'self'` (no `blob:`, no
 * `wasm-unsafe-eval`) allows a same-origin worker but would reject a `blob:`
 * worker — so we MUST NOT let pdf.js fall back to its inline/blob worker.
 *
 * `GlobalWorkerOptions` is a singleton on the `pdfjs-dist` module. Both
 * `PdfViewer` and `PptxViewer` import this module (pptx-renderer declares a
 * peerDependency on pdfjs-dist for embedded PDF objects) so the worker is
 * configured regardless of which viewer loads first.
 */
import { GlobalWorkerOptions } from 'pdfjs-dist';
// LEGACY worker to match the legacy main build (aliased in vite.config). The
// worker thread is also JavaScriptCore and also lacks getOrInsertComputed, so it
// must be the polyfilled legacy worker too. Vite `?url` → hashed same-origin URL.
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

if (!GlobalWorkerOptions.workerSrc) {
  GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
}
