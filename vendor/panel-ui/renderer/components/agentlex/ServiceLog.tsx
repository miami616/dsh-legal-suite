/**
 * ServiceLog — reverse-chronological record of completed service activities.
 *
 * Concept: replaces "办案时间轴" on the non-litigation detail page with a
 * descriptive "服务日志" that records what work was done and when. Each entry
 * carries a full timestamp (epoch ms) for timezone-safe formatting: "刚刚"
 * only appears for events within the last hour, and all times are displayed
 * in the user's local timezone with date when appropriate.
 */
import { memo, useCallback, useMemo, useState } from 'react';
import { CheckCircle2, Clock, ChevronDown, ChevronRight } from 'lucide-react';

export interface ServiceLogEntry {
  id: string;
  /** Descriptive message text (e.g. "完成了「审查合同」") */
  message: string;
  /** Full timestamp in epoch ms — used for sorting, "刚刚" detection, and local-time display */
  ts: number;
  /** When set, this entry is a subtask completion nested under its parent task */
  parentTaskId?: string;
  /** Whether this entry represents a completed item (vs in-progress container) */
  done?: boolean;
}

interface ServiceLogProps {
  entries: ServiceLogEntry[];
}

const HOUR_MS = 3600_000;
const DAY_MS = 86400_000;

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

/** Format a timestamp into a display string in the user's local timezone. */
function fmtDateTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - DAY_MS;
  const eventStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (eventStart === todayStart) return time;
  if (eventStart === yesterdayStart) return `昨天 ${time}`;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}`;
}

export default memo(function ServiceLog({ entries }: ServiceLogProps) {
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(new Set());

  const toggleCollapse = useCallback((parentId: string) => {
    setCollapsedParents(prev => {
      const next = new Set(prev);
      if (next.has(parentId)) next.delete(parentId);
      else next.add(parentId);
      return next;
    });
  }, []);

  // Build a tree: main entries (no parent) with children grouped under them.
  // Children are sorted by ts ascending (oldest first) for natural reading.
  const tree = useMemo(() => {
    const children = new Map<string, ServiceLogEntry[]>();
    const mains: ServiceLogEntry[] = [];

    // Also track orphan child entries whose parent isn't in the log.
    const orphans: ServiceLogEntry[] = [];

    for (const e of entries) {
      if (e.parentTaskId) {
        const list = children.get(e.parentTaskId);
        if (list) list.push(e);
        else children.set(e.parentTaskId, [e]);
      } else {
        mains.push(e);
      }
    }

    // Sort mains by ts descending (newest first)
    mains.sort((a, b) => b.ts - a.ts);

    // Sort children by ts descending (newest first)
    for (const [, list] of children) {
      list.sort((a, b) => b.ts - a.ts);
    }

    // Main entries that have children get them attached; orphan children
    // (subtask completions whose parent task isn't in the log) appear flat.
    const result: { main: ServiceLogEntry; children: ServiceLogEntry[] }[] = [];
    const remaining = new Set(children.keys());

    for (const m of mains) {
      const childList = children.get(m.id) ?? [];
      if (childList.length > 0) remaining.delete(m.id);
      result.push({ main: m, children: childList });
    }

    // Orphans: children whose parent isn't in the log
    for (const pid of remaining) {
      for (const child of children.get(pid)!) {
        orphans.push(child);
      }
    }
    orphans.sort((a, b) => b.ts - a.ts);

    return { result, orphans };
  }, [entries]);

  if (!tree.result.length && !tree.orphans.length) return null;

  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold tracking-widest uppercase text-[var(--ink-muted)] opacity-60">服务日志</h2>
      <div className="relative pl-5 border-l-2 border-[var(--paper-inset)] space-y-0">
        {tree.result.map(({ main, children }) => {
          const isRecent = now - main.ts < HOUR_MS;

          return (
            <div key={main.id} className="relative pb-3">
              {/* Dot — green for completed, gray for in-progress container */}
              <div className={`absolute -left-[21px] top-1.5 w-2 h-2 rounded-full border-2 border-[var(--paper)] ${
                main.done !== false ? 'bg-emerald-400' : 'bg-[var(--ink-subtle)]'
              }`} />
              <div className="flex items-start gap-2">
                {main.done !== false
                  ? <CheckCircle2 size={13} className="text-emerald-400 shrink-0 mt-0.5" />
                  : <Clock size={13} className="text-[var(--ink-muted)] shrink-0 mt-0.5" />}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm leading-snug ${main.done !== false ? 'text-[var(--ink)]' : 'text-[var(--ink-muted)]'}`}>
                    {isRecent && <span className="text-emerald-500 font-medium">刚刚 </span>}
                    {main.message}
                  </p>
                  <p className="text-xs font-mono text-[var(--ink-muted)] mt-0.5">
                    {fmtDateTime(main.ts)}
                  </p>
                  {/* Nested subtask completions — collapsible */}
                  {children.length > 0 && (
                    <div className="mt-1">
                      <button
                        type="button"
                        onClick={() => toggleCollapse(main.id)}
                        className="flex items-center gap-1 text-xs text-[var(--ink-subtle)] hover:text-[var(--ink)] transition-colors mb-1"
                      >
                        {collapsedParents.has(main.id)
                          ? <ChevronRight size={12} />
                          : <ChevronDown size={12} />}
                        <span>{children.length} 个子任务</span>
                      </button>
                      {!collapsedParents.has(main.id) && (
                        <div className="space-y-1.5 border-l-2 border-[var(--paper-inset)] pl-3">
                          {children.map(child => {
                            const childRecent = now - child.ts < HOUR_MS;
                            return (
                              <div key={child.id} className="flex items-start gap-1.5">
                                <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs text-[var(--ink-muted)] leading-snug">
                                    {childRecent && <span className="text-emerald-500 font-medium">刚刚 </span>}
                                    {child.message}
                                  </p>
                                  <p className="text-xs font-mono text-[var(--ink-subtle)] mt-0.5">
                                    {fmtDateTime(child.ts)}
                                  </p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {/* Orphan subtask completions (parent task not completed yet) */}
        {tree.orphans.length > 0 && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => toggleCollapse('__orphans__')}
              className="flex items-center gap-1 text-xs text-[var(--ink-subtle)] hover:text-[var(--ink)] transition-colors mb-1"
            >
              {collapsedParents.has('__orphans__')
                ? <ChevronRight size={12} />
                : <ChevronDown size={12} />}
              <span>{tree.orphans.length} 个其他子任务</span>
            </button>
            {!collapsedParents.has('__orphans__') && tree.orphans.map((entry, i) => {
              const isRecent = now - entry.ts < HOUR_MS;
              const last = i === tree.orphans.length - 1;
              return (
                <div key={entry.id} className={`relative ${last ? '' : 'pb-2'}`}>
                  <div className="flex items-start gap-1.5 ml-3">
                    <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-[var(--ink-muted)] leading-snug">
                        {isRecent && <span className="text-emerald-500 font-medium">刚刚 </span>}
                        {entry.message}
                      </p>
                      <p className="text-xs font-mono text-[var(--ink-subtle)] mt-0.5">
                        {fmtDateTime(entry.ts)}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
});
