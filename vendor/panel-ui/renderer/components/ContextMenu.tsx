import { useEffect, useRef } from 'react';
import { useCloseLayer } from '@/hooks/useCloseLayer';
import { retainFocusOnMouseDown } from '@/utils/focusRetention';

export type ContextMenuItem = {
    label: string;
    icon?: React.ReactNode;
    disabled?: boolean;
    danger?: boolean;
    separator?: false;
    onClick: () => void;
} | {
    separator: true;
};

interface ContextMenuProps {
    x: number;
    y: number;
    items: ContextMenuItem[];
    onClose: () => void;
    /**
     * Stacking layer. Defaults to 50 (matches inline panel usages like the file
     * tree). Callers that portal the menu OVER a higher overlay (e.g. Monaco
     * inside the z-[210] FilePreviewModal) must pass a value above that overlay so
     * the menu isn't rendered behind it — and so Cmd+W/Esc close ordering stays
     * correct (useCloseLayer uses the same value).
     */
    zIndex?: number;
}

export default function ContextMenu({ x, y, items, onClose, zIndex = 50 }: ContextMenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);

    // Cmd+W dismissal: always active while mounted (component only renders when open)
    useCloseLayer(() => { onClose(); return true; }, zIndex);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                onClose();
            }
        };

        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleEscape);

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEscape);
        };
    }, [onClose]);

    // Adjust position to keep menu in viewport
    useEffect(() => {
        if (menuRef.current) {
            const rect = menuRef.current.getBoundingClientRect();
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;

            let adjustedX = x;
            let adjustedY = y;

            if (x + rect.width > viewportWidth) {
                adjustedX = viewportWidth - rect.width - 8;
            }
            if (y + rect.height > viewportHeight) {
                adjustedY = viewportHeight - rect.height - 8;
            }

            menuRef.current.style.left = `${adjustedX}px`;
            menuRef.current.style.top = `${adjustedY}px`;
        }
    }, [x, y]);

    return (
        <div
            ref={menuRef}
            className="fixed min-w-[160px] rounded-xl border border-[var(--line)] bg-[var(--paper-elevated)] py-1.5 shadow-lg backdrop-blur"
            style={{ left: x, top: y, zIndex }}
            // A right-click on the menu itself must not bubble (incl. through a
            // React portal) to a parent's onContextMenu and re-open another menu.
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
        >
            {items.map((item, index) =>
                'separator' in item && item.separator ? (
                    <div key={index} className="my-1 border-t border-[var(--line)]" />
                ) : (
                    <button
                        key={index}
                        type="button"
                        disabled={item.disabled}
                        // Menu items are actions that never need focus. Without this,
                        // an item whose onClick routes focus to an input (e.g. 引用文件 →
                        // textarea.focus()) drops its own click on a macOS WebKit trackpad
                        // tap (focus-steal). preventDefault on mousedown keeps focus put.
                        onMouseDown={retainFocusOnMouseDown}
                        onClick={() => {
                            if (!item.disabled) {
                                item.onClick();
                                onClose();
                            }
                        }}
                        className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm transition-colors ${item.disabled
                                ? 'cursor-not-allowed text-[var(--ink-muted)]/50'
                                : item.danger
                                    ? 'text-[var(--error)] hover:bg-[var(--error-bg)]'
                                    : 'text-[var(--ink)] hover:bg-[var(--paper-inset)]'
                            }`}
                    >
                        {item.icon && <span className="h-4 w-4">{item.icon}</span>}
                        <span>{item.label}</span>
                    </button>
                )
            )}
        </div>
    );
}
