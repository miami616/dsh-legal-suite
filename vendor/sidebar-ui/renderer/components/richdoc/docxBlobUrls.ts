/**
 * docx-preview creates blob: URLs for embedded images/fonts via
 * URL.createObjectURL and never revokes them, so a preview leaks Blobs (a 1.5MB
 * book docx embeds dozens). Revoke them on unmount / file-switch.
 *
 * Extracted from DocxViewer so the scan coverage (img src, [href], <style>
 * url(blob:…)) is unit-testable without importing docx-preview.
 */
export function revokeBlobUrls(root: HTMLElement): void {
  root.querySelectorAll('img[src^="blob:"]').forEach((el) => {
    URL.revokeObjectURL((el as HTMLImageElement).src);
  });
  root.querySelectorAll('[href^="blob:"]').forEach((el) => {
    const href = el.getAttribute('href');
    if (href) URL.revokeObjectURL(href);
  });
  root.querySelectorAll('style').forEach((s) => {
    for (const m of (s.textContent || '').matchAll(/url\((blob:[^)]+)\)/g)) {
      URL.revokeObjectURL(m[1]);
    }
  });
}
