/**
 * SearchHighlight - Generic component for rendering text with highlights.
 *
 * Takes a string and an array of [start, end] positions.
 * Safely renders the text with <mark> tags without using dangerouslySetInnerHTML.
 */

import { memo } from 'react';

interface SearchHighlightProps {
    text: string;
    /**
     * Array of [start, end] tuples indicating UTF-16 code unit offsets to
     * highlight. The Rust search layer emits UTF-16 offsets specifically so
     * they line up with JavaScript's `String.prototype.slice`.
     */
    highlights: [number, number][];
    className?: string;
    /** Class name applied to the <mark> tag. Defaults to a warm accent background. */
    highlightClassName?: string;
}

export default memo(function SearchHighlight({
    text,
    highlights,
    className = '',
    highlightClassName = 'bg-[var(--accent)]/30 text-[var(--ink)] font-medium rounded-sm px-0.5',
}: SearchHighlightProps) {
    if (!text || highlights.length === 0) {
        return <span className={className}>{text}</span>;
    }

    // Sort highlights by start position
    const sorted = [...highlights].sort((a, b) => a[0] - b[0]);

    // Merge overlapping highlights
    const merged: [number, number][] = [];
    for (const current of sorted) {
        if (merged.length === 0) {
            merged.push([...current]);
        } else {
            const previous = merged[merged.length - 1];
            if (current[0] <= previous[1]) {
                // Overlap or consecutive
                previous[1] = Math.max(previous[1], current[1]);
            } else {
                merged.push([...current]);
            }
        }
    }

    const parts: React.ReactNode[] = [];
    let lastIndex = 0;

    for (let i = 0; i < merged.length; i++) {
        const [start, end] = merged[i];
        
        // Safety bounds
        const safeStart = Math.max(0, Math.min(start, text.length));
        const safeEnd = Math.max(0, Math.min(end, text.length));

        // Unhighlighted text before this highlight
        if (safeStart > lastIndex) {
            parts.push(<span key={`t-${lastIndex}`}>{text.slice(lastIndex, safeStart)}</span>);
        }

        // Highlighted text
        if (safeStart < safeEnd) {
            parts.push(
                <mark key={`h-${safeStart}`} className={highlightClassName}>
                    {text.slice(safeStart, safeEnd)}
                </mark>
            );
        }

        lastIndex = safeEnd;
    }

    // Remaining unhighlighted text
    if (lastIndex < text.length) {
        parts.push(<span key={`t-${lastIndex}`}>{text.slice(lastIndex)}</span>);
    }

    return <span className={className}>{parts}</span>;
});
