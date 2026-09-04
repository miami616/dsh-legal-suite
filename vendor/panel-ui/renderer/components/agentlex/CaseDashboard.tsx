/**
 * CaseDashboard — Case management overview with stats, a single-row dropdown
 * filter toolbar, sort control, and a Direction-B card grid.
 *
 * Filtering: 顶部收进一行下拉工具栏 —— 类型/审级/状态/标签/排序，选中后按钮内联
 * 「●民商 ×」，面板带色点、计数与勾选。卡片（v2.5 Direction B）为左轨结构：
 * 左边栏 = 编号 mono 戳记 + 审级历程节点轨（数据模型 instances + 当前 level，
 * 按案件实际路径动态显示：一审案单节点，二审案「一审→二审」，再审/执行按实际历程，
 * 已过节点灰色实心、当前节点审级色实心）；右侧 = 类型色点 + 案名 + 状态 + 元数据 +
 * 下次节点倒计时 + 中性灰标签（最多 2 个 + 溢出）。占位文本【】自动隐藏，0/占位标的额不显示。
 */
import { memo, useMemo, useState, useCallback, useRef, useEffect, type ReactNode } from 'react';
import { Briefcase, Trash2, Check, CalendarClock, ChevronDown, Sparkles } from 'lucide-react';
import type { CaseEntry, TimelineEvent } from '@/hooks/useAgentLex';
import StatusBadge from '@/components/agentlex/StatusBadge';
import ConfirmDialog from '@/components/ConfirmDialog';
import CaseBoard from '@/components/agentlex/CaseBoard';
import { normalizeStatus, normalizeLevel, getStatusDef, getProcedureShort, PROCEDURE_LEVELS, getProcedureDot } from '@/utils/caseStatus';
import { formatAmount, parseAmountValue, daysUntil, todayStr, timeAgo, ourPartyList, theirPartyList } from '@/utils/caseFormat';
import { CASE_TYPES, getCaseTypeDot } from '@/utils/caseTypes';
import { TAG_CATEGORIES, tagCategoryOf, getTagCategoryLabel } from '@/utils/caseTags';

const s = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return '';
};

/** 【】包裹的占位文本（【尚未立案】/【待确认】…）不当作真实信息上卡。 */
const isPlaceholder = (v: string): boolean => /^【.+】$/.test(v.trim());

type SortKey = 'recent' | 'nextKeyDate' | 'caseId' | 'claimAmount';
const SORT_OPTIONS = [
  { value: 'recent', label: '最近更新' },
  { value: 'nextKeyDate', label: '下次关键节点' },
  { value: 'caseId', label: '编号（倒序）' },
  { value: 'claimAmount', label: '诉讼标的' },
] as const;
const SORT_LABEL = new Map(SORT_OPTIONS.map(o => [o.value, o.label]));

/** 筛选下拉面板 + 选项（模块级组件，避免 render 内创建导致状态重置）。 */
function MenuPanel({ children }: { children: ReactNode }) {
  return (
    <div className="absolute top-full left-0 mt-1.5 z-50 min-w-[208px] max-h-[70vh] overflow-y-auto bg-[var(--paper-elevated)] border border-[var(--paper-inset)] rounded-xl shadow-lg py-1">
      {children}
    </div>
  );
}

function MenuOption({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick}
      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left text-[var(--ink)] transition-colors hover:bg-[var(--paper-inset)]"
      style={active ? { background: 'var(--hover-bg)' } : undefined}>
      {children}
      {active && <Check size={13} className="ml-auto text-[var(--accent)]" />}
    </button>
  );
}

/** 筛选色点（模块级）。 */
function ActiveDot({ color }: { color?: string }) {
  return <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} aria-hidden />;
}

/** 左轨审级历程 = instances 已过节点（归一 + 仅规范审级）+ 当前审级 level（末节点）。 */
function railLevels(c: CaseEntry): string[] {
  const levels: string[] = [];
  for (const inst of c.instances ?? []) {
    const lv = normalizeLevel(inst.level, c.type);
    if (lv && PROCEDURE_LEVELS.includes(lv) && levels[levels.length - 1] !== lv) levels.push(lv);
  }
  const cur = normalizeLevel(c.level, c.type);
  if (cur && levels[levels.length - 1] !== cur) levels.push(cur);
  return levels;
}

/** Next future pending event for a case (soonest first) — '' when none. */
function nextUpcomingDate(events: TimelineEvent[] | undefined): string {
  if (!events) return '';
  const today = todayStr();
  return events
    .filter(e => (e.status === 'pending' || e.status === 'upcoming') && e.date >= today)
    .map(e => e.date)
    .sort((a, b) => a.localeCompare(b))[0] ?? '';
}

type MenuDim = 'type' | 'level' | 'status' | 'tag' | 'sort';

interface CaseDashboardProps {
  cases: CaseEntry[];
  timelineEvents?: TimelineEvent[];
  onOpenCase: (entry: CaseEntry) => void;
  onNewCase: () => void;
  onDeleteCase: (caseId: string) => void;
  searchQuery?: string;
  onClearSearch?: () => void;
  onOpenCalendar?: () => void;
}

export default memo(function CaseDashboard({ cases, timelineEvents = [], onOpenCase, onNewCase, onDeleteCase, searchQuery = '', onClearSearch, onOpenCalendar }: CaseDashboardProps) {
  const [showArchived, setShowArchived] = useState(false);
  const [showBoard, setShowBoard] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [levelFilter, setLevelFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('recent');
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [openMenu, setOpenMenu] = useState<MenuDim | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CaseEntry | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!openMenu) return;
    const h = (e: MouseEvent) => { if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) setOpenMenu(null); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [openMenu]);

  const archivedCount = useMemo(() => cases.filter(c => c.archived).length, [cases]);
  const visibleCases = useMemo(() => showArchived ? cases : cases.filter(c => !c.archived), [cases, showArchived]);

  const tagPool = useMemo(() => [...new Set(visibleCases.flatMap(c => c.tags ?? []))].sort((a, b) => a.localeCompare(b)), [visibleCases]);

  // Tag dropdown grouped by category (客户/案件性质/阶段特征/优先级/自定义).
  const groupedTags = useMemo(() => {
    const groups: { category: string; tags: string[] }[] = [];
    for (const cat of TAG_CATEGORIES) {
      const tags = tagPool.filter(t => tagCategoryOf(t) === cat.key);
      if (tags.length) groups.push({ category: cat.key, tags });
    }
    return groups;
  }, [tagPool]);

  const filteredCases = useMemo(() => {
    let result = visibleCases;
    if (typeFilter) result = result.filter(c => c.type === typeFilter);
    if (levelFilter) result = result.filter(c => c.level === levelFilter);
    if (statusFilter) result = result.filter(c => normalizeStatus(c.status) === statusFilter);
    if (tagFilter.length > 0) result = result.filter(c => (c.tags ?? []).some(t => tagFilter.includes(t)));
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(c =>
        c.caseId.toLowerCase().includes(q) || c.name.toLowerCase().includes(q) ||
        c.caseNumber.toLowerCase().includes(q) || c.court?.toLowerCase().includes(q) ||
        c.type.toLowerCase().includes(q) || c.alias.some(a => a.toLowerCase().includes(q)) ||
        (c.tags ?? []).some(t => t.toLowerCase().includes(q))
      );
    }
    return result;
  }, [visibleCases, typeFilter, levelFilter, statusFilter, tagFilter, searchQuery]);

  // Pre-computed timeline-lookup map for efficient per-case queries.
  const caseTimelineMap = useMemo(() => {
    const m = new Map<string, TimelineEvent[]>();
    for (const e of timelineEvents) {
      if (!m.has(e.caseId)) m.set(e.caseId, []);
      m.get(e.caseId)!.push(e);
    }
    return m;
  }, [timelineEvents]);

  // 紧急日程 = 未来 7 天内的重要时间节点(倒计时)。
  const urgentDates = useMemo(() => {
    const today = todayStr();
    const items: { label: string; date: string; caseId: string; caseName: string }[] = [];
    for (const c of visibleCases) {
      const events = caseTimelineMap.get(c.caseId);
      if (!events) continue;
      for (const e of events) {
        if (e.status !== 'pending' && e.status !== 'upcoming') continue;
        if (e.date < today) continue;
        const days = (new Date(e.date).getTime() - new Date(today).getTime()) / 86400000;
        if (days <= 7) items.push({ label: e.label, date: e.date, caseId: c.caseId, caseName: c.name });
      }
    }
    items.sort((a, b) => a.date.localeCompare(b.date));
    return items.slice(0, 5);
  }, [visibleCases, caseTimelineMap]);

  const displayCases = useMemo(() => {
    const arr = [...filteredCases];
    switch (sortKey) {
      case 'claimAmount':
        return arr.sort((a, b) => parseAmountValue(b.claimAmount) - parseAmountValue(a.claimAmount));
      case 'nextKeyDate':
        return arr.sort((a, b) => {
          const da = nextUpcomingDate(caseTimelineMap.get(a.caseId));
          const db = nextUpcomingDate(caseTimelineMap.get(b.caseId));
          if (!da) return db ? 1 : 0;
          if (!db) return -1;
          return da.localeCompare(db);
        });
      case 'caseId':
        // 编号倒序：最新年份/序号在前
        return arr.sort((a, b) => b.caseId.localeCompare(a.caseId));
      case 'recent':
      default:
        return arr.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    }
  }, [filteredCases, sortKey, caseTimelineMap]);

  // 顶部统计基于全部案件（含归档），与当前归档开关/筛选无关：全部=在办+已结，归档单独一类。
  const activeCount = useMemo(() => cases.filter(c => normalizeStatus(c.status) !== 'closed').length, [cases]);
  const closedCount = useMemo(() => cases.filter(c => normalizeStatus(c.status) === 'closed').length, [cases]);
  // 逾期 = 任务概念:有 deadline、未完成、且 deadline 已过的任务。
  const overdueCount = useMemo(() => {
    const today = todayStr();
    let n = 0;
    for (const c of visibleCases) {
      for (const g of (Array.isArray(c.taskGroups) ? c.taskGroups : [])) {
        for (const t of g.tasks) {
          if (t.status !== 'done' && t.deadline && t.deadline < today) n++;
        }
      }
    }
    return n;
  }, [visibleCases]);
  const pendingTaskCount = useMemo(() => {
    let n = 0;
    for (const c of visibleCases) {
      for (const g of (Array.isArray(c.taskGroups) ? c.taskGroups : [])) {
        for (const t of g.tasks) {
          if (t.status !== 'done') n++;
          for (const st of t.subtasks) { if (st.status !== 'done') n++; }
        }
      }
    }
    return n;
  }, [visibleCases]);

  /** 关键节点 chips：最近 2 条未发生节点，紧迫(≤3天)/紧要(≤7天) 用语义色，其余中性。 */
  const keyDateChips = (c: CaseEntry) => {
    const events = caseTimelineMap.get(c.caseId);
    if (!events) return null;
    const today = todayStr();
    const upcoming = events
      .filter(e => (e.status === 'pending' || e.status === 'upcoming') && e.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 2);
    if (upcoming.length === 0) return null;
    return (
      <>
        {upcoming.map(e => {
          const days = daysUntil(e.date);
          const urgent = days <= 3;
          const soon = days <= 7;
          const cls = urgent ? 'bg-[var(--error-bg)] text-[var(--error)]' : soon ? 'bg-[var(--warning-bg)] text-[var(--warning)]' : 'bg-[var(--paper-inset)] text-[var(--ink-muted)]';
          return (
            <span key={`${e.label}-${e.date}`} className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-xs font-semibold ${cls}`} title={`${e.label} ${e.date}`}>
              <CalendarClock size={10} className="shrink-0" strokeWidth={2} />
              <span className="font-mono">{e.date.slice(5)}</span>
              <span className="truncate max-w-[4.5rem]">{e.label}</span>
              {days === 0 ? '今天' : days === 1 ? '明天' : `${days}天后`}
            </span>
          );
        })}
      </>
    );
  };

  const tagChips = (c: CaseEntry) => {
    const tags = c.tags ?? [];
    if (tags.length === 0) return null;
    const shown = tags.slice(0, 2);
    return (
      <>
        {shown.map(t => (
          <span key={t} className="shrink-0 px-2 py-0.5 rounded-sm text-xs font-medium bg-[var(--paper-inset)] text-[var(--ink-muted)]">{t}</span>
        ))}
        {tags.length > 2 && <span className="shrink-0 text-xs text-[var(--ink-subtle)]">+{tags.length - 2}</span>}
      </>
    );
  };

  const toggleTag = (t: string) => setTagFilter(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);

  const caseCount = (pred: (c: CaseEntry) => boolean) => visibleCases.filter(pred).length;

  // ── 下拉工具栏渲染 ──
  const dimBtnCls = (active: boolean, open: boolean) =>
    `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
      open ? 'bg-[var(--paper-elevated)] text-[var(--ink)] border-[var(--ink-subtle)] shadow-sm'
        : active ? 'bg-[var(--paper-elevated)] text-[var(--ink)] border-[var(--paper-inset)]'
        : 'bg-[var(--paper-elevated)] text-[var(--ink-muted)] border-[var(--paper-inset)] hover:text-[var(--ink)]'}`;

  const caseIdParts = (id: string): { head: string; tail: string } => {
    const dash = id.indexOf('-');
    return dash > 0 ? { head: id.slice(0, dash + 1), tail: id.slice(dash + 1) } : { head: '', tail: id };
  };

  return (
    <div className="max-w-5xl xl:max-w-6xl 2xl:max-w-7xl mx-auto px-8 pt-6 pb-12 space-y-6">
      {/* Overview — stats + urgent（全部含归档，归档单独一类） */}
      {cases.length > 0 && (
        <div className="flex items-stretch gap-4">
          <div className="flex items-center gap-5 px-5 py-3.5 rounded-xl bg-[var(--paper-elevated)] border border-[var(--paper-inset)] shrink-0">
            <div className="text-center min-w-[48px]"><p className="text-3xl font-extrabold text-[var(--ink)] tabular-nums">{cases.length}</p><p className="text-xs text-[var(--ink-muted)] mt-0.5 tracking-wide">全部</p></div>
            <span className="w-px h-10 bg-[var(--paper-inset)]" />
            <div className="text-center min-w-[48px]"><p className="text-3xl font-extrabold text-[var(--ink-secondary)] tabular-nums">{activeCount}</p><p className="text-xs text-[var(--ink-muted)] mt-0.5 tracking-wide">在办</p></div>
            {closedCount > 0 && <><span className="w-px h-10 bg-[var(--paper-inset)]" /><div className="text-center min-w-[48px]"><p className="text-3xl font-extrabold text-[var(--success)] tabular-nums">{closedCount}</p><p className="text-xs text-[var(--ink-muted)] mt-0.5 tracking-wide">已结</p></div></>}
            {archivedCount > 0 && <><span className="w-px h-10 bg-[var(--paper-inset)]" /><div className="text-center min-w-[48px]"><p className="text-3xl font-extrabold text-[var(--ink-subtle)] tabular-nums">{archivedCount}</p><p className="text-xs text-[var(--ink-muted)] mt-0.5 tracking-wide">归档</p></div></>}
          </div>
          <div className="flex items-center gap-5 ml-auto">
            {overdueCount > 0 && (
              <button onClick={onOpenCalendar} className="flex items-center gap-2 hover:opacity-70 transition-opacity">
                <span className="text-xl font-extrabold text-[var(--error)] tabular-nums">{overdueCount}</span>
                <span className="text-xs text-[var(--ink-muted)] font-medium">项逾期</span>
              </button>
            )}
            {pendingTaskCount > 0 && (
              <button onClick={onOpenCalendar} className="flex items-center gap-2 hover:opacity-70 transition-opacity">
                <span className="text-xl font-extrabold text-[var(--warning)] tabular-nums">{pendingTaskCount}</span>
                <span className="text-xs text-[var(--ink-muted)] font-medium">项待办</span>
              </button>
            )}
            {urgentDates.length > 0 && (
              <button onClick={onOpenCalendar} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--error)] text-[var(--on-error)] text-sm font-bold hover:bg-[var(--error-hover)] transition-colors shadow-sm">
                !! {urgentDates.length} 紧急日程
              </button>
            )}
          </div>
        </div>
      )}

      {/* 单行下拉筛选工具栏 */}
      <div ref={toolbarRef} className="flex items-center gap-2 flex-wrap">
        {/* 类型 */}
        <div className="relative">
          <button onClick={() => setOpenMenu(openMenu === 'type' ? null : 'type')} className={dimBtnCls(!!typeFilter, openMenu === 'type')}>
            {typeFilter && <ActiveDot color={getCaseTypeDot(typeFilter)} />}
            {typeFilter ? <>{typeFilter}<button className="text-[var(--ink-subtle)] hover:text-[var(--ink)] font-bold px-0.5" onClick={e => { e.stopPropagation(); setTypeFilter(null); }}>×</button></> : <>类型 <ChevronDown size={12} className="text-[var(--ink-subtle)]" /></>}
          </button>
          {openMenu === 'type' && (
            <MenuPanel>
              {CASE_TYPES.filter(t => t.key !== '__all').map(t => (
                <MenuOption key={t.key} active={typeFilter === t.key} onClick={() => { setTypeFilter(typeFilter === t.key ? null : t.key); setOpenMenu(null); }}>
                  <ActiveDot color={t.dot} />
                  <span>{t.label}</span>
                  <span className="ml-auto text-xs text-[var(--ink-subtle)] tabular-nums">{caseCount(c => c.type === t.key)}</span>
                </MenuOption>
              ))}
            </MenuPanel>
          )}
        </div>

        {/* 审级 */}
        <div className="relative">
          <button onClick={() => setOpenMenu(openMenu === 'level' ? null : 'level')} className={dimBtnCls(!!levelFilter, openMenu === 'level')}>
            {levelFilter && <ActiveDot color={getProcedureDot(levelFilter)} />}
            {levelFilter ? <>{levelFilter}<button className="text-[var(--ink-subtle)] hover:text-[var(--ink)] font-bold px-0.5" onClick={e => { e.stopPropagation(); setLevelFilter(null); }}>×</button></> : <>审级 <ChevronDown size={12} className="text-[var(--ink-subtle)]" /></>}
          </button>
          {openMenu === 'level' && (
            <MenuPanel>
              {PROCEDURE_LEVELS.map(lv => (
                <MenuOption key={lv} active={levelFilter === lv} onClick={() => { setLevelFilter(levelFilter === lv ? null : lv); setOpenMenu(null); }}>
                  <ActiveDot color={getProcedureDot(lv)} />
                  <span>{lv}</span>
                  <span className="ml-auto text-xs text-[var(--ink-subtle)] tabular-nums">{caseCount(c => c.level === lv)}</span>
                </MenuOption>
              ))}
            </MenuPanel>
          )}
        </div>

        {/* 状态 */}
        <div className="relative">
          <button onClick={() => setOpenMenu(openMenu === 'status' ? null : 'status')} className={dimBtnCls(!!statusFilter, openMenu === 'status')}>
            {statusFilter ? (
              <>
                {(() => { const d = getStatusDef(statusFilter); return d ? <span className={`shrink-0 px-1.5 py-0.5 rounded text-xs font-bold ${d.color}`}>{d.label}</span> : <span className="text-[var(--ink-muted)]">{statusFilter}</span>; })()}
                <button className="text-[var(--ink-subtle)] hover:text-[var(--ink)] font-bold px-0.5" onClick={e => { e.stopPropagation(); setStatusFilter(null); }}>×</button>
              </>
            ) : <>状态 <ChevronDown size={12} className="text-[var(--ink-subtle)]" /></>}
          </button>
          {openMenu === 'status' && (
            <MenuPanel>
              {['intake', 'pretrial', 'awaiting_trial', 'post_trial', 'closed'].map(sid => {
                const d = getStatusDef(sid);
                if (!d) return null;
                return (
                  <MenuOption key={sid} active={statusFilter === sid} onClick={() => { setStatusFilter(statusFilter === sid ? null : sid); setOpenMenu(null); }}>
                    <span className={`shrink-0 px-1.5 py-0.5 rounded text-xs font-bold ${d.color}`}>{d.label}</span>
                    <span className="ml-auto text-xs text-[var(--ink-subtle)] tabular-nums">{caseCount(c => normalizeStatus(c.status) === sid)}</span>
                  </MenuOption>
                );
              })}
            </MenuPanel>
          )}
        </div>

        {/* 标签（多选） */}
        <div className="relative">
          <button onClick={() => setOpenMenu(openMenu === 'tag' ? null : 'tag')} className={dimBtnCls(tagFilter.length > 0, openMenu === 'tag')}>
            {tagFilter.length > 0 ? <>标签 <span className="bg-[var(--ink)] text-[var(--paper)] rounded-full text-xs font-bold px-1.5">{tagFilter.length}</span><button className="text-[var(--ink-subtle)] hover:text-[var(--ink)] font-bold px-0.5" onClick={e => { e.stopPropagation(); setTagFilter([]); }}>×</button></> : <>标签 <ChevronDown size={12} className="text-[var(--ink-subtle)]" /></>}
          </button>
          {openMenu === 'tag' && groupedTags.length > 0 && (
            <MenuPanel>
              {groupedTags.map(g => (
                <div key={g.category}>
                  <div className="px-3 pt-1.5 pb-0.5 text-xs font-semibold uppercase tracking-wider text-[var(--ink-subtle)]">{getTagCategoryLabel(g.category)}</div>
                  {g.tags.map(t => (
                    <button key={t} onClick={() => toggleTag(t)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--ink)] hover:bg-[var(--paper-inset)] text-left">
                      <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${tagFilter.includes(t) ? 'bg-[var(--ink)] border-[var(--ink)]' : 'border-[var(--ink-subtle)]'}`}>
                        {tagFilter.includes(t) && <Check size={10} className="text-[var(--paper)]" />}
                      </span>
                      <span className="truncate">{t}</span>
                      <span className="ml-auto text-xs text-[var(--ink-subtle)] tabular-nums">{caseCount(c => (c.tags ?? []).includes(t))}</span>
                    </button>
                  ))}
                </div>
              ))}
            </MenuPanel>
          )}
        </div>

        <div className="flex-1" />

        {/* 排序 */}
        <div className="relative">
          <button onClick={() => setOpenMenu(openMenu === 'sort' ? null : 'sort')} className={dimBtnCls(false, openMenu === 'sort')}>
            排序 · {SORT_LABEL.get(sortKey)} <ChevronDown size={12} className="text-[var(--ink-subtle)]" />
          </button>
          {openMenu === 'sort' && (
            <MenuPanel>
              {SORT_OPTIONS.map(o => (
                <MenuOption key={o.value} active={sortKey === o.value} onClick={() => { setSortKey(o.value as SortKey); setOpenMenu(null); }}>
                  <span>{o.label}</span>
                </MenuOption>
              ))}
            </MenuPanel>
          )}
        </div>

        {archivedCount > 0 && (
          <button onClick={() => setShowArchived(v => !v)}
            className={`text-xs px-2 py-1 rounded-lg transition-colors ${showArchived ? 'text-[var(--ink)]' : 'text-[var(--ink-muted)] hover:text-[var(--ink)]'}`}>{showArchived ? '隐藏归档' : `归档 (${archivedCount})`}</button>
        )}
        {/* 案件看板：科幻风数据看板，点击展开/收起，日常收起不占空间 */}
        <button onClick={() => setShowBoard(v => !v)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${showBoard ? 'text-[var(--accent-warm)] bg-[var(--accent-warm-subtle)]' : 'text-[var(--ink-muted)] hover:text-[var(--ink)]'}`}>
          <Sparkles size={12} className={showBoard ? 'text-[var(--accent-warm)]' : 'text-[var(--ink-subtle)]'} />
          案件看板
        </button>
        {searchQuery && (
          <button onClick={onClearSearch} className="text-xs px-2 py-1 rounded-lg text-[var(--ink-muted)] hover:text-[var(--ink)]">清除搜索</button>
        )}
      </div>

      {/* Card grid or empty state */}
      {cases.length === 0 ? (
        <div className="text-center py-16 rounded-2xl bg-[var(--paper-elevated)] border border-dashed border-[var(--paper-inset)]">
          <Briefcase size={28} className="mx-auto mb-3 text-[var(--ink-muted)] opacity-40" />
          <p className="text-sm text-[var(--ink-muted)] mb-3">暂无案件</p>
          <button onClick={onNewCase} className="text-sm text-[var(--ink)] font-medium hover:underline">注册第一个案件 →</button>
        </div>
      ) : displayCases.length === 0 ? (
        <div className="text-center py-16 rounded-2xl bg-[var(--paper-elevated)] border border-dashed border-[var(--paper-inset)]">
          <p className="text-sm text-[var(--ink-muted)]">没有符合条件的案件</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {displayCases.map(c => {
            const ours = ourPartyList(c);
            const theirs = theirPartyList(c);
            const typeDot = getCaseTypeDot(c.type);
            const levels = railLevels(c);
            const { head, tail } = caseIdParts(c.caseId);
            const amount = formatAmount(c.claimAmount);
            const showAmount = parseAmountValue(c.claimAmount) > 0;
            const caseNoReal = c.caseNumber && !isPlaceholder(s(c.caseNumber)) ? s(c.caseNumber) : '';
            const courtReal = c.court && !isPlaceholder(s(c.court)) ? s(c.court) : '';
            return (
              <div key={c.caseId} role="button" tabIndex={0}
                onClick={() => onOpenCase(c)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onOpenCase(c); } }}
                className={`group rounded-xl bg-[var(--paper-elevated)] text-left transition-shadow hover:shadow-sm cursor-pointer grid grid-cols-[64px_minmax(0,1fr)] overflow-hidden min-h-[192px] ${c.archived ? 'opacity-55 hover:shadow-none' : ''}`}>
                {/* 左轨：编号（年份小号 + 序号大字）+ 审级历程 */}
                <div className="py-3 border-r border-[var(--paper-inset)]" style={{ background: 'color-mix(in srgb, var(--paper-inset) 80%, transparent)' }}>
                  <div className="px-2 leading-tight break-words">
                    {head && <div className="text-xs text-[var(--ink-subtle)] tracking-[0.02em]" style={{ fontFamily: "'Microsoft YaHei','微软雅黑',sans-serif" }}>{head}</div>}
                    <div className="text-lg font-bold text-[var(--ink)] tracking-[0.02em]" style={{ fontFamily: "'Microsoft YaHei','微软雅黑',sans-serif" }}>{tail}</div>
                  </div>
                  <div className="relative mt-2">
                    {levels.length === 0 ? (
                      <div className="pl-2 text-xs text-[var(--ink-subtle)]">待定</div>
                    ) : (
                      <>
                        <span className="absolute left-2.5 top-1 bottom-1 w-px bg-[var(--paper-inset)]" aria-hidden />
                        {levels.map((lv, i) => {
                          const last = i === levels.length - 1;
                          const dotColor = last ? getProcedureDot(lv) : 'var(--ink-subtle)';
                          return (
                            <div key={lv + i} className="relative flex items-center gap-1 h-[24px] pl-1.5">
                              <span className="relative w-2 h-2 rounded-full shrink-0" style={{ background: dotColor, border: `1px solid ${dotColor}` }} aria-hidden />
                              <span className="text-xs leading-none" title={lv} style={{ color: last ? 'var(--ink-secondary)' : 'var(--ink-subtle)', fontWeight: last ? 700 : 500 }}>{getProcedureShort(lv)}</span>
                            </div>
                          );
                        })}
                      </>
                    )}
                  </div>
                </div>
                {/* 主体 */}
                <div className="flex flex-col p-3.5 min-w-0" style={{ background: 'var(--biz-card-bg, #ffffff)' }}>
                  <div className="flex items-center gap-2">
                    {/* 类型标签：色点 + 浅色底（身份色，随明暗自适应） */}
                    <span className="inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-xs font-semibold whitespace-nowrap shrink-0"
                      style={{ background: `color-mix(in srgb, ${typeDot} 13%, transparent)`, color: `color-mix(in srgb, ${typeDot} 62%, var(--ink))` }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: typeDot }} aria-hidden />
                      {s(c.type)}
                    </span>
                    <h3 className="flex-1 min-w-0 text-sm font-semibold text-[var(--ink)] truncate leading-snug" style={{ letterSpacing: '-0.005em' }} title={s(c.name)}>{s(c.name)}</h3>
                    <StatusBadge status={normalizeStatus(c.status, c.level)} level={c.level} />
                  </div>
                  {/* 我方：同侧所有我方当事人（可能多人，逐行清晰） */}
                  <div className="mt-2 flex items-start gap-1.5 text-xs text-[var(--ink-muted)] min-w-0">
                    <span className="w-8 shrink-0 text-[var(--ink-subtle)] pt-px">我方</span>
                    {ours.length > 0 ? (
                      <span className="min-w-0">
                        {ours.map((p, pi) => (
                          <span key={pi} className="block truncate leading-5">
                            <span className="shrink-0 text-[var(--ink-secondary)] font-medium">{p.role || '—'}</span>
                            <span className="mx-1 text-[var(--ink)] font-medium">{p.name}</span>
                            {p.firm && <span className="text-[var(--ink-subtle)]">· {p.firm}</span>}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span className="text-[var(--ink-subtle)]">—</span>
                    )}
                  </div>
                  {/* 对方：对侧所有当事人 */}
                  {theirs.length > 0 && (
                    <div className="mt-1 flex items-start gap-1.5 text-xs text-[var(--ink-muted)] min-w-0">
                      <span className="w-8 shrink-0 text-[var(--ink-subtle)] pt-px">对方</span>
                      <span className="min-w-0">
                        {theirs.map((p, pi) => (
                          <span key={pi} className="block truncate leading-5">
                            <span className="shrink-0 text-[var(--ink-secondary)] font-medium">{p.role || '—'}</span>
                            <span className="mx-1 text-[var(--ink-muted)]">{p.name}</span>
                            {p.firm && <span className="text-[var(--ink-subtle)]">· {p.firm}</span>}
                          </span>
                        ))}
                      </span>
                    </div>
                  )}
                  {/* 案号 · 法院 */}
                  {(caseNoReal || courtReal) && (
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-[var(--ink-muted)] min-w-0">
                      <span className="w-8 shrink-0 text-[var(--ink-subtle)]">案号</span>
                      {caseNoReal && <span className="font-mono truncate">{caseNoReal}</span>}
                      {courtReal && <span className="truncate">{caseNoReal ? ' · ' : ''}{courtReal}</span>}
                    </div>
                  )}
                  {/* 案由 · 标的（一行） */}
                  {(s(c.cause) || showAmount) && (
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-[var(--ink-muted)] min-w-0">
                      <span className="w-8 shrink-0 text-[var(--ink-subtle)]">案由</span>
                      {s(c.cause) ? <span className="truncate">{s(c.cause)}</span> : <span className="text-[var(--ink-subtle)]">—</span>}
                      {showAmount && <>
                        <span className="shrink-0 text-[var(--ink-subtle)]">·</span>
                        <span className="shrink-0 text-[var(--ink-subtle)]">标的</span>
                        <span className="text-[var(--ink)] font-semibold tabular-nums">{amount}</span>
                      </>}
                    </div>
                  )}
                  {/* 底部：关键节点 chips + 标签 + 会话/时间 + 删除 */}
                  <div className="mt-auto pt-2.5 border-t border-[var(--line-subtle)] flex items-center gap-1.5 text-xs text-[var(--ink-subtle)] flex-wrap">
                    {keyDateChips(c)}
                    {tagChips(c)}
                    <span className="flex-1" />
                    {c.boundSessions.length > 0 && <span className="shrink-0">{c.boundSessions.length} 会话</span>}
                    {c.updatedAt && <span className="shrink-0 opacity-50">{timeAgo(c.updatedAt)}</span>}
                    <button onClick={e => { e.stopPropagation(); setDeleteTarget(c); }}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 text-[var(--ink-subtle)] hover:text-red-500 transition-all" title="删除"><Trash2 size={12} /></button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 案件看板（主题化数据面板，点击工具栏「案件看板」展开；置于卡片下方，不挤动卡片） */}
      {showBoard && (
        <CaseBoard cases={cases} onClose={() => setShowBoard(false)} />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="删除案件"
          message={`确认删除「${deleteTarget.caseId} ${deleteTarget.name}」？该操作不可撤销。`}
          confirmText="删除"
          cancelText="取消"
          confirmVariant="danger"
          onConfirm={() => { onDeleteCase(deleteTarget.caseId); setDeleteTarget(null); }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
});
