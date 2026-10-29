/**
 * dsh-legal-suite/file-download — shared browser download plumbing.
 *
 * All download surfaces in the suite (交付卡片 / 改动卡片 / 工作区文件树 /
 * 工作区文件夹) save through the browser, so the bytes land on the device that
 * runs the browser — the semantic remote logins need. This module keeps the
 * one-time style sheet, the HEAD preflight, the hidden-iframe handoff and the
 * lightweight notice in one place.
 */

const STYLE_ID = 'agentlex-download-action-style'

/** One-time style sheet: visually matches the neighbouring 24px open control. */
export function ensureDownloadStyle(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
.agentlex-download-action {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  margin-left: 6px;
  padding: 3px 6px;
  border: .5px solid var(--dsw-alias-border-l4, rgba(0, 0, 0, .16));
  border-radius: var(--dsw-radius-sm, 6px);
  background: transparent;
  color: var(--dsw-alias-label-primary, inherit);
  font-family: var(--dsw-font-family, inherit);
  font-size: 11px;
  line-height: 16px;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color .12s;
}
.agentlex-download-action:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, .06));
}
.agentlex-download-action:focus-visible {
  outline: 2px solid var(--dsw-alias-border-focus, currentColor);
  outline-offset: 1px;
}
.agentlex-download-action:disabled {
  cursor: default;
  color: var(--dsw-alias-label-secondary, inherit);
}
.agentlex-download-action[data-error='true'] {
  color: var(--dsw-alias-state-error, #d9534f);
}
.agentlex-download-action svg { flex: none; }
.agentlex-download-action[data-phase='busy'] svg { animation: agentlex-download-spin 1s linear infinite; }
@keyframes agentlex-download-spin { to { transform: rotate(360deg); } }
`
  document.head.appendChild(style)
}

/** Human-readable byte size for notices. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

/** Probe a download route without starting the payload (HEAD). */
export async function probeDownload(url: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const response = await fetch(url, { method: 'HEAD', credentials: 'same-origin', cache: 'no-store' })
    if (response.ok) return { ok: true }
    let message = `HTTP ${response.status}`
    try {
      const payload = await response.json() as { error?: unknown }
      if (typeof payload.error === 'string' && payload.error !== '') message = payload.error
    } catch { /* non-JSON failure body */ }
    return { ok: false, message }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Hand one authenticated GET route to the browser's own download path.
 *
 * A hidden iframe (rather than an anchor) keeps a failed response -- JSON in a
 * browser tab -- invisible, while a successful `Content-Disposition:
 * attachment` still saves to the client's download folder. The frame stays
 * mounted long enough for large files to finish.
 */
export function startBrowserDownload(url: string): void {
  if (typeof document === 'undefined') return
  const frame = document.createElement('iframe')
  frame.style.display = 'none'
  frame.setAttribute('aria-hidden', 'true')
  frame.src = url
  document.body.appendChild(frame)
  window.setTimeout(() => { frame.remove() }, 10 * 60_000)
}

let notice: HTMLElement | undefined
let noticeTimer: number | undefined

/** Transient bottom notice for download feedback outside React portals. */
export function showDownloadNotice(message: string, tone: 'info' | 'error' = 'info'): void {
  if (typeof document === 'undefined') return
  if (notice !== undefined) {
    notice.remove()
    notice = undefined
  }
  if (noticeTimer !== undefined) {
    window.clearTimeout(noticeTimer)
    noticeTimer = undefined
  }
  const el = document.createElement('div')
  el.setAttribute('data-agentlex-download-notice', '')
  el.textContent = message
  el.style.cssText = [
    'position:fixed',
    'left:50%',
    'bottom:24px',
    'transform:translateX(-50%)',
    'z-index:2147483000',
    'max-width:min(620px,90vw)',
    'padding:8px 14px',
    'border-radius:10px',
    'font:12.5px/1.5 var(--dsw-font-family,system-ui)',
    tone === 'error' ? 'color:#fff' : 'color:var(--dsw-alias-label-primary,#111)',
    tone === 'error' ? 'background:#d9534f' : 'background:var(--dsw-alias-bg-elevated,#fff)',
    'box-shadow:0 6px 24px rgba(0,0,0,.18)',
    'border:.5px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12))',
  ].join(';')
  document.body.appendChild(el)
  notice = el
  noticeTimer = window.setTimeout(() => {
    el.remove()
    if (notice === el) notice = undefined
  }, 4200)
}
