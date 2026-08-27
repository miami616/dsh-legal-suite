/**
 * Narrow-viewport (mobile) detection for the original AgentLex renderer.
 *
 * Uses the same breakpoint as the dsh-mobile-hanui mobile shell
 * (`(max-width: 1023px)`), so the original module pages switch to their
 * mobile layout exactly when the surrounding DSH web GUI does. Desktop
 * (wide viewport) rendering is untouched.
 */
import { useEffect, useState } from 'react';

export const MOBILE_MEDIA_QUERY = '(max-width: 1023px)';

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' && window.matchMedia(MOBILE_MEDIA_QUERY).matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(MOBILE_MEDIA_QUERY);
    const onChange = (event: MediaQueryListEvent): void => setIsMobile(event.matches);
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
    // Older WebKit fallback.
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
  }, []);
  return isMobile;
}