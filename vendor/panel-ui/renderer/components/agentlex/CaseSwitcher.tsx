/**
 * CaseSwitcher — compact dropdown for quick case switching.
 */
import { memo, useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import type { CaseEntry } from '@/hooks/useAgentLex';
import { normalizeStatus } from '@/utils/caseStatus';

interface CaseSwitcherProps {
  cases: CaseEntry[];
  selectedCaseId: string;
  onSelect: (entry: CaseEntry) => void;
}

export default memo(function CaseSwitcher({ cases, selectedCaseId, onSelect }: CaseSwitcherProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const activeCases = cases.filter(c => normalizeStatus(c.status) !== 'closed' && !c.archived);
  if (activeCases.length <= 1) return null;

  return (
    <div ref={ref} className="relative shrink-0" data-no-drag>
      <button onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-xs text-[var(--ink-muted)] hover:text-[var(--ink)] px-2 py-1 rounded-md hover:bg-[var(--paper-inset)] transition-colors">
        切换案件 <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 w-72 bg-[var(--paper-elevated)] border border-[var(--paper-inset)] rounded-xl shadow-xl z-50 overflow-hidden">
          <div className="max-h-64 overflow-y-auto py-1">
            {activeCases.map(c => (
              <button key={c.caseId} onClick={() => { onSelect(c); setOpen(false); }}
                className={`w-full text-left px-4 py-3 hover:bg-[var(--paper-inset)] transition-colors ${c.caseId === selectedCaseId ? 'bg-[var(--paper-inset)]' : ''}`}>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-[var(--ink)] shrink-0">{c.caseId}</span>
                  <span className="text-sm text-[var(--ink)] truncate">{c.name}</span>
                </div>
                {c.caseNumber && <p className="text-xs text-[var(--ink-muted)] font-mono mt-0.5 truncate">{c.caseNumber}</p>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
