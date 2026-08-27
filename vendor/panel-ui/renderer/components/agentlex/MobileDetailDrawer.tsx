/**
 * Mobile detail drawer — slide-in overlay used by the original module pages
 * on phones (viewport ≤ 1023px). The underlying dashboard stays mounted, so
 * filters / scroll position survive; close via the back/close buttons or a
 * scrim tap. Desktop never renders this (detail opens as a full page there).
 * Styling lives in ORIGINAL_MOBILE_CSS (original-styles.ts).
 */
import { memo, type ReactNode } from 'react';
import { ChevronRight, X } from 'lucide-react';

interface MobileDetailDrawerProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

export const MobileDetailDrawer = memo(function MobileDetailDrawer({ title, onClose, children }: MobileDetailDrawerProps): React.JSX.Element {
  return (
    <div className="agentlex-mobile-drawer-layer">
      <div className="agentlex-mobile-drawer-scrim" onClick={onClose} />
      <div className="agentlex-mobile-drawer" role="dialog" aria-modal="true" aria-label={title}>
        <header className="agentlex-mobile-drawer-header" data-no-drag>
          <button type="button" className="agentlex-mobile-drawer-back" onClick={onClose} aria-label="返回" data-no-drag>
            <ChevronRight size={18} className="rotate-180" />
          </button>
          <h1 className="agentlex-mobile-drawer-title">{title}</h1>
          <button type="button" className="agentlex-mobile-drawer-close" onClick={onClose} aria-label="关闭" data-no-drag>
            <X size={16} />
          </button>
        </header>
        <div className="agentlex-mobile-drawer-body">{children}</div>
      </div>
    </div>
  );
});