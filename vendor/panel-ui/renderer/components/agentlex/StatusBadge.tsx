/**
 * StatusBadge — colored chip for case workflow status.
 */
import { memo, useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { CASE_STATUSES, getStatusDef } from '@/utils/caseStatus';

interface StatusBadgeProps {
  status: string;
  onChange?: (statusId: string) => void;
  /** When true, clicking shows a dropdown to change status. */
  editable?: boolean;
}

export default memo(function StatusBadge({ status, onChange, editable = false }: StatusBadgeProps) {
  const def = getStatusDef(status);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  if (!def) return <span className="px-2 py-0.5 rounded-sm text-xs bg-[var(--paper-inset)] text-[var(--ink-muted)]">{status || '未知'}</span>;

  if (!editable) {
    return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-sm text-xs font-medium ${def.color}`}>{def.label}</span>;
  }

  return (
    <div ref={ref} className="relative inline-flex">
      <button onClick={() => setOpen(!open)}
        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-sm text-xs font-medium ${def.color} hover:opacity-80 transition-opacity cursor-pointer`}>
        {def.label} <ChevronDown size={10} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 w-36 bg-[var(--paper-elevated)] border border-[var(--paper-inset)] rounded-xl shadow-lg z-50 py-1 max-h-64 overflow-y-auto">
          {CASE_STATUSES.map(s => (
            <button key={s.id} onClick={() => { onChange?.(s.id); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--paper-inset)] transition-colors ${s.id === status ? 'font-semibold' : ''}`}>
              <span className={`inline-block w-2 h-2 rounded-full mr-2 ${s.dot}`} />
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});
