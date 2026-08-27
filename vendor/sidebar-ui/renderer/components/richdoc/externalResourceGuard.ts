/**
 * External-resource guard for rich-document previews.
 *
 * WHY: confidential office docs (lawyers / finance) may embed externally-linked
 * resources (`<img src="http://attacker/x.png">`, `background-image: url(...)`,
 * a `<style>` rule with `url(http://...)`, an SVG `xlink:href`). The renderer
 * CSP `img-src` allows `https:` (needed for AI markdown images), so such a
 * reference WOULD hit the network and leak "this document was opened" to a third
 * party. PRD 0.2.20 §6.2 + acceptance #10 require zero network egress when
 * previewing a local document offline.
 *
 * HOW: install this once on the rich-doc host container. It (1) neutralizes any
 * external-URL resource already present, and (2) keeps a `MutationObserver`
 * running so resources injected later (docx-preview / pptx-renderer render
 * asynchronously, pptx list mode mounts slides on scroll) are neutralized as
 * they appear.
 *
 * SCOPE / LIMITATIONS (be honest — this is defense-in-depth, not a hard wall):
 *  - All three renderers resolve EMBEDDED media (the common case) to
 *    `blob:`/`data:` URLs extracted from the zip, which never touch the network.
 *    `blob:`/`data:` are intentionally left untouched here.
 *  - The remaining surface is rare EXTERNAL-URL references. The MutationObserver
 *    neutralizes them on insertion; there is a theoretical race where the WebView
 *    could schedule a fetch before the (microtask) callback runs. We close the
 *    known concrete vectors below; DocxViewer additionally disables `altChunk`
 *    iframe rendering (which would bypass this guard entirely) and uses
 *    base64/data image URLs. A fully airtight boundary would require a
 *    sandboxed-iframe + scoped CSP rework (out of scope for this read-only v1).
 */

/** Attributes that can trigger an automatic network fetch. */
const RESOURCE_ATTRS = ['src', 'srcset', 'href', 'poster', 'data'] as const;

/** Tags whose `href` auto-loads a resource (vs `<a href>` which is user-click).
 *  Compared against an upper-cased tagName so SVG's lowercase `image`/`use`
 *  (HTML parser keeps SVG localNames lowercase) are matched too. */
const HREF_LOADS_RESOURCE = new Set(['LINK', 'IMAGE', 'USE']);

const XLINK_NS = 'http://www.w3.org/1999/xlink';

/** Matches an absolute external URL: `http://`, `https://`, or protocol-relative `//`. */
const EXTERNAL_URL = /^\s*(?:https?:)?\/\//i;
/** Matches a CSS `url(...)` pointing at an external URL (in `<style>` text or inline). */
const EXTERNAL_CSS_URL = /url\(\s*['"]?\s*(?:https?:)?\/\//i;

function isExternal(value: string | null): boolean {
  return !!value && EXTERNAL_URL.test(value);
}

/** Replace every external `url(...)` in a CSS string with an inert `url()`. */
function stripExternalCssUrls(css: string): string {
  return css.replace(/url\(\s*(['"]?)\s*(?:https?:)?\/\/[^)'"]*\1\s*\)/gi, 'url()');
}

/** Neutralize external-URL resources on a single element. */
function neutralizeElement(el: Element): void {
  const tag = el.tagName.toUpperCase();

  // <style> blocks: external `url(...)` in CSS text (font-face, background, etc.).
  if (tag === 'STYLE') {
    const css = el.textContent || '';
    if (EXTERNAL_CSS_URL.test(css)) el.textContent = stripExternalCssUrls(css);
    return;
  }

  for (const attr of RESOURCE_ATTRS) {
    const value = el.getAttribute(attr);
    if (!value) continue;
    // `href` only auto-fetches for resource elements; leave `<a href>` navigable.
    if (attr === 'href' && !HREF_LOADS_RESOURCE.has(tag)) continue;
    if (attr === 'srcset') {
      // srcset is a comma list of candidates; blank it entirely if any is external.
      if (value.split(',').some((c) => isExternal(c.trim().split(/\s+/)[0]))) {
        el.setAttribute(attr, '');
      }
      continue;
    }
    if (isExternal(value)) el.setAttribute(attr, '');
  }

  // SVG `xlink:href` (namespaced) on <image>/<use> — getAttribute('href') misses it.
  const xlinkHref = el.getAttributeNS(XLINK_NS, 'href');
  if (isExternal(xlinkHref)) el.setAttributeNS(XLINK_NS, 'href', '');

  // Inline style background-image: url(http...)
  const style = (el as HTMLElement).style;
  if (style && EXTERNAL_CSS_URL.test(style.backgroundImage || '')) {
    style.backgroundImage = 'none';
  }
}

/** Recursively neutralize an element and its descendants. */
function neutralizeSubtree(root: Node): void {
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  neutralizeElement(root as Element);
  (root as Element)
    .querySelectorAll('style,[src],[srcset],[href],[poster],[data],[style]')
    .forEach(neutralizeElement);
}

/**
 * Install the guard on `root`. Returns a disposer that stops the observer.
 * Idempotent per call — call once per viewer host and dispose on unmount.
 */
export function installExternalResourceGuard(root: HTMLElement): () => void {
  // Initial sweep for anything rendered synchronously before we attached.
  neutralizeSubtree(root);

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes' && record.target) {
        neutralizeElement(record.target as Element);
      } else if (record.type === 'characterData' && record.target.parentNode) {
        // <style> text edited after insertion.
        neutralizeElement(record.target.parentNode as Element);
      }
      record.addedNodes.forEach(neutralizeSubtree);
    }
  });
  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: [...RESOURCE_ATTRS, 'style', 'xlink:href'],
    characterData: true,
  });

  return () => observer.disconnect();
}
