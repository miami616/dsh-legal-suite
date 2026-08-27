/**
 * WorkspaceIcon — renders a workspace icon (Phosphor SVG or emoji fallback)
 * Phosphor icons are tinted with the Cocoa CSS filter.
 */

import { memo } from 'react';
import { getWorkspaceIconUrl, DEFAULT_WORKSPACE_ICON } from '@/assets/workspace-icons';

interface WorkspaceIconProps {
    icon?: string;
    size?: number;
    className?: string;
}

/**
 * Cocoa color filter for monochrome SVGs.
 * Matches design system warm brown (#8b6f5a).
 */
const COCOA_FILTER = 'invert(45%) sepia(15%) saturate(500%) hue-rotate(350deg) brightness(85%)';

export default memo(function WorkspaceIcon({ icon, size = 24, className = '' }: WorkspaceIconProps) {
    // Try Phosphor icon ID first
    const iconUrl = icon ? getWorkspaceIconUrl(icon) : undefined;

    if (iconUrl) {
        return (
            <img
                src={iconUrl}
                alt=""
                width={size}
                height={size}
                className={className}
                style={{ filter: COCOA_FILTER }}
                draggable={false}
            />
        );
    }

    // Emoji fallback (legacy data or custom emoji)
    if (icon) {
        return (
            <span
                className={className}
                style={{ fontSize: size * 0.75, lineHeight: 1, width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            >
                {icon}
            </span>
        );
    }

    // Default folder icon
    const defaultUrl = getWorkspaceIconUrl(DEFAULT_WORKSPACE_ICON);
    return (
        <img
            src={defaultUrl}
            alt=""
            width={size}
            height={size}
            className={className}
            style={{ filter: COCOA_FILTER }}
            draggable={false}
        />
    );
});
