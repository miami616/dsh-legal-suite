/**
 * Close-Layer Registry — centralized Cmd+W dismissal stack.
 *
 * Overlays / panels call `register()` on mount and the returned cleanup on unmount.
 * `dismissTopmost()` walks the registry (highest zIndex first, LIFO within the same
 * zIndex) and invokes the first handler that returns `true`.
 *
 * Priority equals the component's CSS z-index — no separate priority enum.
 */

type CloseHandler = () => boolean;

interface Layer {
    id: number;
    handler: CloseHandler;
    zIndex: number;
}

const layers: Layer[] = [];
let nextId = 0;

/**
 * Register a closeable layer.
 * @param handler — return `true` if the layer was closed, `false` to pass through.
 * @param zIndex  — the component's CSS z-index (determines dismissal priority).
 * @returns unregister function (call on unmount).
 */
export function registerCloseLayer(handler: CloseHandler, zIndex: number): () => void {
    const id = nextId++;
    layers.push({ id, handler, zIndex });
    return () => {
        const idx = layers.findIndex(l => l.id === id);
        if (idx !== -1) layers.splice(idx, 1);
    };
}

/**
 * Dismiss the topmost closeable layer.
 * @returns `true` if a layer handled the close, `false` if nothing to close.
 */
export function dismissTopmost(): boolean {
    // Sort: highest zIndex first; same zIndex → highest id (LIFO / last-mounted first)
    const sorted = layers.slice().sort((a, b) => b.zIndex - a.zIndex || b.id - a.id);
    for (const layer of sorted) {
        try { if (layer.handler()) return true; }
        catch (e) { console.warn('[closeLayer] handler error:', e); }
    }
    return false;
}

/**
 * Check whether any overlay layer (zIndex > 0) is currently registered.
 * Used by BrowserPanel to detect overlays and hide the native Webview.
 */
export function hasOverlayLayer(): boolean {
    return layers.some(l => l.zIndex > 0);
}
