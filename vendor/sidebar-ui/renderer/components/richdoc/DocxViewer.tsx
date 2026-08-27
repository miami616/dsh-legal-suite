/**
 * DOCX read-only viewer (docx-preview).
 *
 * `renderAsync` parses the OOXML and builds a high-fidelity, paginated DOM
 * (styles / tables / images / headers / footers) directly via DOM APIs — no
 * arbitrary-HTML injection, so XSS surface is small.
 *
 * Performance (PRD 0.2.20 — a 1.5MB book docx must not freeze the UI):
 * docx-preview has NO virtualization; it builds the whole document DOM in one
 * synchronous pass and backfills images/fonts via async tasks. The two knobs
 * that matter most for large docs:
 *  - default `useBase64URL` (false): embedded images load as `blob:` URLs via
 *    `URL.createObjectURL` — far cheaper than the base64 path (which runs N×
 *    `FileReader.readAsDataURL` and stuffs giant data: strings into the DOM).
 *    docx-preview never revokes those blob URLs, so we revoke them on unmount.
 *  - `ignoreFonts: true`: skips per-font deobfuscation + `@font-face` injection
 *    (CPU-heavy + triggers wide reflow). Trade-off: embedded fonts fall back to
 *    system fonts (glyph/line-break differences) — acceptable for a preview.
 *
 * Privacy: `renderAltChunks: false` avoids `<iframe srcdoc>` (which the host's
 * externalResourceGuard cannot observe). Embedded images are blob:/data: from
 * the zip; the guard neutralizes any external-URL reference.
 */
import { useEffect, useRef, useState } from 'react';
import { i18n } from '@/i18n';
import { Loader2 } from 'lucide-react';
import { renderAsync } from 'docx-preview';
import { revokeBlobUrls } from './docxBlobUrls';
import type { RichDocSubViewerProps } from './types';
import { useZoom, ZoomControls } from './zoom';

export default function DocxViewer({ bytes, onError }: RichDocSubViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const { zoom, zoomIn, zoomOut, reset } = useZoom(scrollRef);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    container.replaceChildren();

    // Blob copies the bytes, so the shared buffer is never detached.
    renderAsync(new Blob([bytes]), container, undefined, {
      className: 'docx',
      inWrapper: true,
      breakPages: true,
      renderHeaders: true,
      renderFooters: true,
      ignoreLastRenderedPageBreak: true,
      renderAltChunks: false, // no <iframe srcdoc> — closes a guard bypass
      ignoreFonts: true, // skip embedded-font deobfuscation + @font-face reflow (perf)
    })
      .then(() => {
        if (!cancelled) setLoading(false);
      })
      .catch((e) => {
        if (!cancelled) onError(e instanceof Error ? e.message : i18n.t('app:richDoc.wordRenderFailed'));
      });

    return () => {
      cancelled = true;
      revokeBlobUrls(container);
      container.replaceChildren();
    };
  }, [bytes, onError]);

  return (
    <div className="relative h-full overflow-hidden bg-[var(--paper-elevated)]">
      <div ref={scrollRef} className="h-full overflow-auto overscroll-contain p-4">
        <div ref={containerRef} className="mx-auto" style={{ zoom }} />
      </div>
      {loading ? (
        <div className="absolute inset-0 flex items-center justify-center text-[var(--ink-muted)]">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <ZoomControls zoom={zoom} onZoomIn={zoomIn} onZoomOut={zoomOut} onReset={reset} />
      )}
    </div>
  );
}
