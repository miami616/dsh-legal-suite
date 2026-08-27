/**
 * PDF read-only viewer (pdf.js / pdfjs-dist, LEGACY build — see vite alias).
 *
 * Renders pages to canvas with IntersectionObserver virtualization — only pages
 * scrolled near the viewport are rasterized (PRD 0.2.20 §5), so a 200-page
 * scanned contract doesn't pin memory.
 *
 * Each page also gets a pdf.js TEXT LAYER: a transparent, %-positioned overlay of
 * the page's text so it's selectable / copyable / (browser-)searchable. Sizing is
 * driven entirely by the `--scale-factor` CSS var (set on contentRef = baseScale ×
 * zoom): the layer self-sizes via `calc(--total-scale-factor * pageWidth)`, spans
 * position by percentage, font scales by the var — so zoom is just a var update
 * (no re-render, vector-crisp text, aligned with the CSS-scaled canvas).
 *
 * Zoom scales each page holder's width NUMERICALLY (not CSS `zoom`/`transform` on
 * the observed content — that corrupts IntersectionObserver geometry → blank pages).
 *
 * The page DOM is built imperatively (an island React doesn't manage); cleanup
 * cancels in-flight render tasks + text layers and destroys the document.
 */
import { useEffect, useRef, useState } from 'react';
import { i18n } from '@/i18n';
import { Loader2 } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy, RenderTask, TextLayer } from 'pdfjs-dist';
import './pdfWorker';
import './pdfTextLayer.css';
import { clampDpr, deviceCanvasSize, estimatedPageHeight, fitScale, pageContainerWidth } from './pdfMetrics';
import type { RichDocSubViewerProps } from './types';
import { useZoom, ZoomControls } from './zoom';

export default function PdfViewer({ bytes, onError, onEmpty }: RichDocSubViewerProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const { zoom, zoomIn, zoomOut, reset } = useZoom(scrollRef);

  // Base (zoom=1) render width, page-1 aspect height, and page-1 fit scale — set
  // during render, read by the zoom effect to resize holders + rescale text.
  const zoomRef = useRef(zoom);
  const baseWidthRef = useRef(0);
  const estHeightRef = useRef(0);
  const baseScaleRef = useRef(0);

  // Resize holders + rescale text layers when zoom changes. Canvas (width:100%)
  // follows the holder; text layers follow the inherited `--scale-factor`.
  useEffect(() => {
    zoomRef.current = zoom;
    const content = contentRef.current;
    if (!content || !baseWidthRef.current) return;
    const w = baseWidthRef.current * zoom;
    const h = estHeightRef.current * zoom;
    content.style.setProperty('--scale-factor', String(baseScaleRef.current * zoom));
    content.querySelectorAll<HTMLElement>('[data-page]').forEach((holder) => {
      holder.style.width = `${w}px`;
      if (!holder.querySelector('canvas')) holder.style.minHeight = `${h}px`;
      // Rescale this page's text layer (per-page scale × zoom) if rendered.
      const ps = Number(holder.dataset.pageScale);
      if (ps) holder.style.setProperty('--scale-factor', String(ps * zoom));
    });
  }, [zoom]);

  useEffect(() => {
    const scroller = scrollRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;

    let cancelled = false;
    let loadingTask: ReturnType<typeof pdfjsLib.getDocument> | null = null;
    let pdf: PDFDocumentProxy | null = null;
    const renderTasks = new Set<RenderTask>();
    const textLayers = new Map<number, TextLayer>();
    let observer: IntersectionObserver | null = null;
    const rendered = new Set<number>();

    const recycle = (pageNum: number, holder: HTMLElement, estHeight: number) => {
      textLayers.get(pageNum)?.cancel();
      textLayers.delete(pageNum);
      holder.replaceChildren();
      holder.style.minHeight = `${estHeight * zoomRef.current}px`;
      rendered.delete(pageNum);
    };

    const renderPage = async (pageNum: number, holder: HTMLElement, width: number, dpr: number) => {
      if (!Number.isFinite(pageNum) || rendered.has(pageNum) || cancelled || !pdf) return;
      rendered.add(pageNum);
      try {
        const page = await pdf.getPage(pageNum);
        if (cancelled) return;
        const scale = fitScale(width, page.getViewport({ scale: 1 }).width);
        const viewport = page.getViewport({ scale });
        // Per-page fit scale → drives THIS page's text-layer size/position/font
        // (handles PDFs with mixed page sizes; the text layer inherits it).
        holder.dataset.pageScale = String(scale);
        holder.style.setProperty('--scale-factor', String(scale * zoomRef.current));
        const canvas = document.createElement('canvas');
        const backing = deviceCanvasSize(viewport.width, viewport.height, dpr);
        canvas.width = backing.width;
        canvas.height = backing.height;
        canvas.style.width = '100%'; // display size set by holder (zoom-scaled)
        canvas.style.height = 'auto';
        holder.style.minHeight = '';
        holder.replaceChildren(canvas);
        // pdf.js v5: pass `canvas` (not the legacy `canvasContext`) and let pdf.js
        // create the 2d context with its own options.
        const task = page.render({
          canvas,
          viewport,
          annotationMode: pdfjsLib.AnnotationMode.DISABLE, // read-only canvas
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        });
        renderTasks.add(task);
        await task.promise;
        renderTasks.delete(task);
        if (cancelled) {
          page.cleanup();
          return;
        }
        // Selectable/copyable text overlay. Sizing/position/font all derive from
        // the inherited `--scale-factor` (set on contentRef), so it tracks zoom.
        const textLayerDiv = document.createElement('div');
        textLayerDiv.className = 'textLayer';
        holder.appendChild(textLayerDiv);
        const textLayer = new pdfjsLib.TextLayer({
          textContentSource: page.streamTextContent(),
          container: textLayerDiv,
          viewport,
        });
        textLayers.set(pageNum, textLayer);
        await textLayer.render();
        page.cleanup();
      } catch (e) {
        rendered.delete(pageNum); // allow retry when it re-enters the viewport
        if (e instanceof Error && e.name === 'RenderingCancelledException') return;
        // Per-page failures are non-fatal — leave the placeholder, keep scrolling.
        console.error(`[PdfViewer] render p${pageNum} FAILED:`, e); // surfaces silent failures
      }
    };

    (async () => {
      try {
        // slice(0): pdf.js transfers the buffer into the worker and detaches it.
        loadingTask = pdfjsLib.getDocument({ data: bytes.slice(0) });
        pdf = await loadingTask.promise;
        if (cancelled) return; // cleanup will destroy the loading task
        if (pdf.numPages === 0) {
          onEmpty();
          return;
        }

        const width = pageContainerWidth(scroller.clientWidth);
        const dpr = clampDpr(window.devicePixelRatio);

        // Estimate placeholder height + base fit-scale from page 1 (most PDFs are
        // uniform); each page's actual render corrects its own canvas height.
        const first = await pdf.getPage(1);
        const baseVp = first.getViewport({ scale: 1 });
        const estHeight = estimatedPageHeight(width, baseVp.width, baseVp.height);
        const baseScale = fitScale(width, baseVp.width);
        first.cleanup();
        if (cancelled) return;

        baseWidthRef.current = width;
        estHeightRef.current = estHeight;
        baseScaleRef.current = baseScale;
        // Drives every text layer's size/position/font (inherited by .textLayer).
        content.style.setProperty('--scale-factor', String(baseScale * zoomRef.current));

        observer = new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              const holder = entry.target as HTMLElement;
              const pageNum = Number(holder.dataset.page);
              if (entry.isIntersecting) {
                void renderPage(pageNum, holder, width, dpr);
              } else if (rendered.has(pageNum) && holder.firstChild) {
                // Recycle off-screen pages — `rendered` would otherwise grow
                // unbounded and a long/scanned PDF leaks tens of MB per page.
                recycle(pageNum, holder, estHeight);
              }
            }
          },
          { root: scroller, rootMargin: '300px 0px' },
        );

        const z = zoomRef.current;
        const frag = document.createDocumentFragment();
        for (let n = 1; n <= pdf.numPages; n++) {
          const holder = document.createElement('div');
          holder.dataset.page = String(n);
          holder.style.width = `${width * z}px`;
          holder.style.minHeight = `${estHeight * z}px`;
          // `relative` positions the absolute text layer over the canvas.
          // `bg-white`: a PDF page is physical white paper; tinting with --paper-*
          // would distort rendered colors (Chrome/Preview also show white pages).
          holder.className = 'relative mx-auto mb-3 bg-white shadow-sm';
          frag.appendChild(holder);
        }
        // Attach FIRST, then observe — with an explicit `root`, IntersectionObserver
        // only reports a target that is a descendant of the root at observe() time;
        // observing detached fragment nodes left WebKit never firing → blank pages.
        const io = observer;
        content.replaceChildren(frag);
        content.querySelectorAll<HTMLElement>('[data-page]').forEach((holder) => io.observe(holder));
        setLoading(false);
      } catch (e) {
        if (!cancelled) onError(e instanceof Error ? e.message : i18n.t('app:richDoc.pdfRenderFailed'));
      }
    })();

    return () => {
      cancelled = true;
      observer?.disconnect();
      textLayers.forEach((tl) => tl.cancel());
      // pdf.js warns against destroy() during an active render — cancel all
      // in-flight render tasks, then destroy the loading task (which also destroys
      // the document) once they've settled.
      const pending = [...renderTasks].map((t) => t.promise.catch(() => {}));
      renderTasks.forEach((t) => t.cancel());
      void Promise.allSettled(pending).then(() => loadingTask?.destroy());
    };
  }, [bytes, onError, onEmpty]);

  return (
    <div className="relative h-full overflow-hidden bg-[var(--paper-elevated)]">
      <div ref={scrollRef} className="h-full overflow-auto overscroll-contain p-4">
        <div ref={contentRef} />
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
