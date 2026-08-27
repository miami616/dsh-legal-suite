/**
 * TagInput — free-form tag chips with existing-tag autocomplete AND a grouped
 * preset palette for one-click adds.
 *
 * Contract (per the case-module redesign): tags are a plain `string[]`, shared
 * between the user (this input) and the agent (writes `tags` in the record).
 * When focused with an empty draft, the optional `presets` palette (grouped by
 * category) appears for quick-add; typing switches to the autocomplete pool.
 * Enter / comma commits, clicking a chip removes it. IME-safe (Enter during
 * Chinese composition does not commit).
 */
import { memo, useState, useRef } from 'react';
import { X } from 'lucide-react';
import { getTagCategoryLabel, type TagPresetGroup } from '@/utils/caseTags';

interface TagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  /** Aggregate pool of existing tags to autocomplete from. */
  suggestions?: string[];
  /** Curated preset tags grouped by category — shown on empty-draft focus. */
  presets?: TagPresetGroup[];
  placeholder?: string;
  className?: string;
}

export default memo(function TagInput({ value, onChange, suggestions = [], presets = [], placeholder = '添加标签…', className }: TagInputProps) {
  const [draft, setDraft] = useState('');
  const [focused, setFocused] = useState(false);
  const composingRef = useRef(false);

  const pool = suggestions.filter(s => s && !value.includes(s));
  const matches = draft.trim()
    ? pool.filter(s => s.includes(draft.trim())).slice(0, 8)
    : [];
  // Preset groups with already-added tags removed; drop empty groups.
  const presetGroups = presets
    .map(g => ({ ...g, tags: g.tags.filter(t => !value.includes(t)) }))
    .filter(g => g.tags.length > 0);

  const commit = (raw: string) => {
    const t = raw.trim().replace(/,/g, '');
    if (!t || value.includes(t)) return;
    onChange([...value, t]);
    setDraft('');
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (composingRef.current) return;
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit(draft);
    } else if (e.key === 'Backspace' && !draft && value.length > 0) {
      onChange(value.slice(0, -1));
    } else if (e.key === 'Escape') {
      setDraft('');
      (e.target as HTMLInputElement).blur();
    }
  };

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className ?? ''}`}>
      {value.map((t, i) => (
        <span key={`${t}-${i}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--paper-inset)] text-[var(--ink-muted)]">
          {t}
          <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))}
            className="text-[var(--ink-subtle)] hover:text-red-500 transition-colors" title="移除标签">
            <X size={11} />
          </button>
        </span>
      ))}
      <div className="relative min-w-[120px] flex-1">
        <input
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onCompositionStart={() => { composingRef.current = true; }}
          onCompositionEnd={() => { composingRef.current = false; }}
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); if (draft.trim()) commit(draft); }}
          placeholder={value.length === 0 ? placeholder : ''}
          className="w-full bg-transparent outline-none text-xs text-[var(--ink)] placeholder:text-[var(--ink-subtle)] py-0.5"
        />
        {focused && matches.length > 0 && (
          <div className="absolute top-full left-0 mt-1 min-w-[160px] bg-[var(--paper-elevated)] border border-[var(--paper-inset)] rounded-lg shadow-xl z-30 py-1 max-h-40 overflow-y-auto">
            {matches.map(m => (
              <button key={m} type="button" onMouseDown={(e) => { e.preventDefault(); commit(m); }}
                className="w-full text-left px-3 py-1.5 text-xs text-[var(--ink)] hover:bg-[var(--paper-inset)]">
                {m}
              </button>
            ))}
          </div>
        )}
        {focused && !draft.trim() && presetGroups.length > 0 && (
          <div className="absolute top-full left-0 mt-1 w-60 bg-[var(--paper-elevated)] border border-[var(--paper-inset)] rounded-lg shadow-xl z-30 py-1.5 max-h-64 overflow-y-auto">
            {presetGroups.map(g => (
              <div key={g.category}>
                <div className="px-3 pt-1 pb-0.5 text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]/60">
                  {getTagCategoryLabel(g.category)}
                </div>
                <div className="px-2.5 pb-1 flex flex-wrap gap-1">
                  {g.tags.map(t => (
                    <button key={t} type="button" onMouseDown={(e) => { e.preventDefault(); commit(t); }}
                      className="px-2 py-0.5 rounded-full text-xs font-medium bg-[var(--paper-inset)] text-[var(--ink-muted)] hover:bg-[var(--paper)] hover:text-[var(--ink)] transition-colors">
                      {t}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
