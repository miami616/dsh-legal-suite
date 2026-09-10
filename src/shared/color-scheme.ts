/**
 * Effective color scheme for the three AgentLex business modules.
 *
 * DSH's theme presenter projects the active palette onto the document —
 * `body[data-ds-dark-theme]` (the documented location) and, on older builds,
 * the same attribute on `<html>`. The vendored AgentLex theme keys its dark
 * palette off `data-color-scheme='dark'` on the theme root
 * (`.agentlex-original-root`), so the panels must mirror the DSH state onto
 * their own root instead of pinning `light`.
 *
 * Both locations are observed so a scheme flip while a panel is open repaints
 * immediately (the presenter toggles the attribute on the live document, not
 * on a React render).
 */
import { useEffect, useState } from 'react'

/** Attribute DSH sets on the themed root while the dark palette is active. */
const DARK_ATTRIBUTE = 'data-ds-dark-theme'

/** Read the live scheme from whichever document element carries the attribute. */
function readDark(): boolean {
  if (typeof document === 'undefined') return false
  return document.documentElement.hasAttribute(DARK_ATTRIBUTE)
    || document.body?.hasAttribute(DARK_ATTRIBUTE) === true
}

/**
 * Subscribe to the document's active scheme.
 * @returns `'dark'` while DSH has the dark palette active, otherwise `'light'`.
 */
export function useColorScheme(): 'light' | 'dark' {
  const [dark, setDark] = useState(readDark)
  useEffect(() => {
    const sync = (): void => { setDark(readDark()) }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: [DARK_ATTRIBUTE] })
    if (document.body) observer.observe(document.body, { attributes: true, attributeFilter: [DARK_ATTRIBUTE] })
    return () => { observer.disconnect() }
  }, [])
  return dark ? 'dark' : 'light'
}

/** Non-React read for the skin's inline `--lit-*` variable writer. */
export { readDark as isDarkScheme }
