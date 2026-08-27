/**
 * CaseTimeline — vertical chronological record of a case's PAST events.
 *
 * Per the unified data model + the case-module redesign, the timeline is a pure
 * CHRONICLE of history (已发生): the detail page passes only occurred events
 * here, while future nodes count down in the 关键日程 card. The caller supplies
 * edit/delete callbacks so history stays manageable from the UI.
 */
import { memo } from 'react';
import { CheckCircle2, Pencil, Trash2 } from 'lucide-react';
import type { TimelineEvent as TLEvent } from '@/hooks/useAgentLex';

interface CaseTimelineProps {
  events: TLEvent[];
  onEdit?: (e: TLEvent) => void;
  onDelete?: (e: TLEvent) => void;
}

function daysUntil(date: string): number {
  const d = new Date(date), t = new Date();
  d.setHours(0, 0, 0, 0); t.setHours(0, 0, 0, 0);
  return Math.ceil((d.getTime() - t.getTime()) / 86400000);
}
/** Relative-time label for a past event. */
function fmt(date: string): string {
  const days = daysUntil(date);
  if (days === 0) return '今天';
  if (days < 0) return `${-days} 天前`;
  return `${days} 天后`;
}

/** Small colored pill showing the event source. */
function SourceBadge({ source }: { source: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    manual: { label: '手动', cls: 'bg-gray-100 text-gray-500' },
    agent: { label: 'Agent', cls: 'bg-teal-50 text-teal-600' },
    'case-file': { label: '卷宗', cls: 'bg-blue-50 text-blue-600' },
    'court-sms': { label: '法院', cls: 'bg-orange-50 text-orange-600' },
  };
  const b = map[source] ?? { label: source, cls: 'bg-[var(--paper-inset)] text-[var(--ink-muted)]' };
  return <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${b.cls}`}>{b.label}</span>;
}

export default memo(function CaseTimeline({ events, onEdit, onDelete }: CaseTimelineProps) {
  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date));

  if (!sorted.length) return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold tracking-widest uppercase text-[var(--ink-muted)] opacity-60">办案时间轴</h2>
      <p className="text-xs text-[var(--ink-muted)]">暂无已发生节点</p>
    </section>
  );

  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold tracking-widest uppercase text-[var(--ink-muted)] opacity-60">办案时间轴</h2>
      <div className="relative pl-6 border-l-2 border-[var(--paper-inset)] space-y-0">
        {sorted.map((e, i) => {
          const last = i === sorted.length - 1;
          return (
            <div key={`${e.id}-${e.date}`} className={`relative ${last ? '' : 'pb-4'} group/ev`}>
              <div className={`absolute -left-[25px] top-1 w-2.5 h-2.5 rounded-full border-2 border-[var(--paper)] bg-emerald-400`} />
              <div className="flex items-center gap-2">
                <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
                <span className="text-sm text-[var(--ink-muted)]">{e.label}</span>
                <SourceBadge source={e.source} />
                {(onEdit || onDelete) && (
                  <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover/ev:opacity-100 transition-opacity">
                    {onEdit && <button onClick={() => onEdit(e)} className="p-0.5 rounded text-[var(--ink-muted)] hover:bg-[var(--paper-inset)]" title="编辑"><Pencil size={11} /></button>}
                    {onDelete && <button onClick={() => onDelete(e)} className="p-0.5 rounded text-[var(--ink-subtle)] hover:text-red-500 hover:bg-red-50" title="删除"><Trash2 size={11} /></button>}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 ml-5 mt-0.5">
                <span className="text-xs font-mono text-[var(--ink-muted)]">{e.date}{e.time ? ` ${e.time}` : ''}</span>
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-[var(--paper-inset)] text-[var(--ink-muted)]">{fmt(e.date)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
});
