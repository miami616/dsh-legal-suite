/**
 * Mobile bottom navigation for the original AgentLex module pages.
 *
 * Only rendered when useIsMobile() is true (viewport ≤ 1023px — the same
 * breakpoint as the dsh-mobile-hanui shell). Desktop never renders it.
 * Styling lives in ORIGINAL_MOBILE_CSS (original-styles.ts).
 */
import { memo, type ReactNode } from 'react';

export interface MobileNavItem {
  key: string;
  label: string;
  icon?: ReactNode;
  count?: number;
  active?: boolean;
  onClick?: () => void;
}

interface MobileNavProps {
  items: MobileNavItem[];
  /** Index (or key) of the "+"-style primary action slot, if any. */
  primaryKey?: string;
}

export const MobileNav = memo(function MobileNav({ items, primaryKey }: MobileNavProps): React.JSX.Element {
  return (
    <nav className="agentlex-mobile-nav" aria-label="底部导航">
      {items.map((item) => {
        const isPrimary = primaryKey !== undefined && item.key === primaryKey;
        return (
          <button
            key={item.key}
            type="button"
            onClick={item.onClick}
            className={
              isPrimary
                ? 'agentlex-mobile-nav-primary'
                : `agentlex-mobile-nav-item${item.active ? ' agentlex-mobile-nav-item-active' : ''}`
            }
          >
            {item.icon !== undefined && <span className="agentlex-mobile-nav-icon">{item.icon}</span>}
            <span className="agentlex-mobile-nav-label">{item.label}</span>
            {item.count !== undefined && item.count > 0 && (
              <span className="agentlex-mobile-nav-count">{item.count}</span>
            )}
          </button>
        );
      })}
    </nav>
  );
});