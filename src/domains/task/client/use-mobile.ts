/**
 * Narrow-viewport (mobile) detection for the plugin panels.
 *
 * Uses the same breakpoint as the dsh-mobile-hanui mobile shell
 * (`(max-width: 1023px)`), so the plugin's mobile layout activates exactly
 * when the surrounding DSH web GUI switches to its phone layout. Desktop
 * (wide viewport) rendering is untouched.
 */
import { useEffect, useState } from 'react'

export const MOBILE_MEDIA_QUERY = '(max-width: 1023px)'

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' && window.matchMedia(MOBILE_MEDIA_QUERY).matches,
  )
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MEDIA_QUERY)
    const onChange = (event: MediaQueryListEvent): void => setIsMobile(event.matches)
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onChange)
      return () => mq.removeEventListener('change', onChange)
    }
    // Older WebKit fallback.
    mq.addListener(onChange)
    return () => mq.removeListener(onChange)
  }, [])
  return isMobile
}