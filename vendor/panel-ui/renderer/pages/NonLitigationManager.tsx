/**
 * NonLitigationManager — 非诉业务项目总览 (v1.1.0 project-based refactor).
 *
 * Replaces the old BusinessModule for the 'contracts' root module. Shows a
 * dashboard of non-litigation projects (常法/专项) with type tags, stat cards,
 * and breadcrumb navigation to project detail / docked session.
 */

import { memo, useCallback, useState, Suspense, useMemo, useRef, useEffect } from 'react';
import { useIsMobile } from '@/hooks/useIsMobile';
import { MobileNav } from '@/components/agentlex/MobileNav';
import { MobileDetailDrawer } from '@/components/agentlex/MobileDetailDrawer';
import {
  ChevronRight, X, ExternalLink, Plus, Search, Briefcase, Trash2, Check,
  CalendarClock, MessageSquare,
} from 'lucide-react';
import { useAgentLex, type ProjectType, type ProjectEntry } from '@/hooks/useAgentLex';
import NewProjectModal, { type ProjectFormData } from '@/components/agentlex/NewProjectModal';
import CustomSelect from '@/components/CustomSelect';
import ConfirmDialog from '@/components/ConfirmDialog';
import { setSessionSlot } from '@/utils/sessionDock';
import { formatAmount, parseAmountValue, daysUntil, todayStr, isOverdue, timeAgo } from '@/utils/caseFormat';
import { TAG_CATEGORIES, tagCategoryOf, getTagColor, getTagCategoryLabel } from '@/utils/caseTags';

import NonLitigationDetailPage from '@/pages/NonLitigationDetailPage';

// ── Helpers ──

// ── Sorted unique project types ──
const PROJECT_TYPES: { key: ProjectType | '__all'; label: string; color: string; accent: string }[] = [
  { key: '__all', label: '全部', color: '', accent: '' },
  { key: 'retainer', label: '常法', color: 'bg-blue-50 text-blue-600', accent: 'bg-blue-500' },
  { key: 'special', label: '专项', color: 'bg-orange-50 text-orange-600', accent: 'bg-orange-500' },
];

// ── Props ──

interface NonLitigationManagerProps {
  isActive?: boolean;
  /** 主页「非诉管家」入口：直接打开非诉管家会话（无项目上下文）。 */
  onLaunchSteward?: () => void;
  selectedProjectId: string | null;
  onSelectProject: (projectId: string | null) => void;
  /** Launch a sub-service session bound to a project */
  onStartProjectService: (projectId: string, typeId: string, message: string) => void;
  /** Resolves the DSH workspace archive set — archived sessions are hidden
   *  from the project detail's historical-session dropdown. */
  getArchivedSessionIds?: () => Promise<Set<string>>;
  trafficInset?: number;
  hasDockedSession?: boolean;
  dockedSessionTitle?: string;
  onCloseDockedSession?: () => void;
  onMoveDockedToWorkspace?: () => void;
  onOpenCalendar?: () => void;
}

// ── Component ──

export default memo(function NonLitigationManager({
  isActive: _isActive,
  onLaunchSteward,
  selectedProjectId,
  onSelectProject,
  onStartProjectService,
  getArchivedSessionIds,
  trafficInset = 0,
  hasDockedSession = false,
  dockedSessionTitle,
  onCloseDockedSession,
  onMoveDockedToWorkspace,
  onOpenCalendar,
}: NonLitigationManagerProps) {
  const mobile = useIsMobile();
  const { projects, timelineEvents, deleteProject } = useAgentLex();
  const [newProjectModalOpen, setNewProjectModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<ProjectType | '__all'>('__all');
  const [showArchived, setShowArchived] = useState(false);
  const [sortKey, setSortKey] = useState<'recent' | 'serviceEnd' | 'amount'>('recent');
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [tagMenuOpen, setTagMenuOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProjectEntry | null>(null);
  const tagMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!tagMenuOpen) return;
    const h = (e: MouseEvent) => { if (tagMenuRef.current && !tagMenuRef.current.contains(e.target as Node)) setTagMenuOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [tagMenuOpen]);

  // Three-level breadcrumb navigation: overview → detail → session
  const [viewLevel, setViewLevel] = useState<'overview' | 'detail' | 'session'>('overview');

  // Session dock slot (same pattern as CaseManager)
  const slotRef = useCallback((el: HTMLDivElement | null) => {
    if (selectedProjectId) setSessionSlot(selectedProjectId, el);
  }, [selectedProjectId]);

  // View-level transitions derived from docked-session / selection changes.
  // Adjust state during render (React Compiler-safe; avoids setState-in-effect
  // cascading re-renders): https://react.dev/learn/you-might-not-need-an-effect
  const [prevDocked, setPrevDocked] = useState(hasDockedSession);
  const [prevSelected, setPrevSelected] = useState(selectedProjectId);
  if (hasDockedSession !== prevDocked) {
    setPrevDocked(hasDockedSession);
    if (hasDockedSession && selectedProjectId) setViewLevel('session');
  }
  if (selectedProjectId !== prevSelected) {
    setPrevSelected(selectedProjectId);
    if (selectedProjectId && !hasDockedSession) setViewLevel('detail');
  }
  if (!hasDockedSession && viewLevel === 'session') {
    // Docked session vanished while showing it — snap back to detail.
    setViewLevel('detail');
  }

  // Filter projects
  const visibleProjects = showArchived ? projects : projects.filter(p => !p.archived);
  const tagPool = useMemo(() => [...new Set(visibleProjects.flatMap(p => p.tags ?? []))].sort((a, b) => a.localeCompare(b)), [visibleProjects]);
  // Tag filter menu grouped by category.
  const groupedTags = useMemo(() => {
    const groups: { category: string; tags: string[] }[] = [];
    for (const cat of TAG_CATEGORIES) {
      const tags = tagPool.filter(t => tagCategoryOf(t) === cat.key);
      if (tags.length) groups.push({ category: cat.key, tags });
    }
    return groups;
  }, [tagPool]);
  const filteredProjects = visibleProjects.filter(p => {
    if (typeFilter !== '__all' && p.projectType !== typeFilter) return false;
    if (tagFilter.length > 0 && !(p.tags ?? []).some(t => tagFilter.includes(t))) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      if (!p.name.toLowerCase().includes(q) && !p.projectId.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // Per-project next future date (timeline event or service end) for the badge.
  const nextDateMap = useMemo(() => {
    const m = new Map<string, string>();
    const today = todayStr();
    // Build per-project earliest future timeline date.
    const byCase = new Map<string, string>();
    for (const e of timelineEvents) {
      if ((e.status === 'pending' || e.status === 'upcoming') && e.date >= today) {
        const cur = byCase.get(e.caseId);
        if (!cur || e.date < cur) byCase.set(e.caseId, e.date);
      }
    }
    for (const p of visibleProjects) {
      const tl = byCase.get(p.projectId);
      if (tl) m.set(p.projectId, tl);
      else if (p.servicePeriod.end && p.servicePeriod.end >= today) m.set(p.projectId, p.servicePeriod.end);
    }
    return m;
  }, [timelineEvents, visibleProjects]);

  const displayProjects = useMemo(() => {
    const arr = [...filteredProjects];
    switch (sortKey) {
      case 'serviceEnd':
        return arr.sort((a, b) => {
          const da = nextDateMap.get(a.projectId) ?? '9999';
          const db = nextDateMap.get(b.projectId) ?? '9999';
          return da.localeCompare(db);
        });
      case 'amount':
        return arr.sort((a, b) => parseAmountValue(b.contractAmount) - parseAmountValue(a.contractAmount));
      case 'recent':
      default:
        return arr.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
    }
  }, [filteredProjects, sortKey, nextDateMap]);

  const selectedProject = selectedProjectId ? projects.find(p => p.projectId === selectedProjectId) : null;

  // Stats
  const activeCount = visibleProjects.filter(p => p.status === 'active').length;
  const closedCount = visibleProjects.filter(p => p.status === 'closed').length;
  const retainerCount = visibleProjects.filter(p => p.projectType === 'retainer').length;
  const specialCount = visibleProjects.filter(p => p.projectType === 'special').length;
  const overdueTaskCount = visibleProjects.reduce((n, p) => {
    for (const g of p.taskGroups) {
      for (const t of g.tasks) {
        if (t.status !== 'done' && t.deadline && isOverdue(t.deadline)) n++;
      }
    }
    return n;
  }, 0);

  const handleDeleteProject = useCallback((projectId: string) => {
    void deleteProject(projectId);
    if (selectedProjectId === projectId) onSelectProject(null);
    setDeleteTarget(null);
  }, [deleteProject, selectedProjectId, onSelectProject]);

  const handleNewProject = useCallback((data: ProjectFormData) => {
    setNewProjectModalOpen(false);
    onSelectProject(data.projectId);
  }, [onSelectProject]);

  // ── Detail / Session views (same pattern as CaseManager) ──
  // Mobile: detail opens as a slide-in drawer over the dashboard instead of a
  // full-page swap; desktop behaviour is unchanged.
  if (selectedProjectId && !mobile) {
    const isSessionView = viewLevel === 'session' && hasDockedSession;
    return (
      <div className="h-full bg-[var(--paper)] flex flex-col overflow-hidden">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 py-3 pr-4 border-b border-[var(--paper-inset)] text-sm shrink-0 h-12"
          style={{ paddingLeft: 24 + trafficInset }} data-tauri-drag-region>
          <button onClick={() => onSelectProject(null)} data-no-drag title="返回项目总览"
            className="p-1 -ml-1 rounded-md text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--paper-inset)] transition-colors shrink-0">
            <ChevronRight size={16} className="rotate-180" />
          </button>
          {hasDockedSession ? (
            <>
              {isSessionView ? (
                <button onClick={() => setViewLevel('detail')} data-no-drag
                  className="text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors truncate max-w-[200px]">
                  {selectedProject ? selectedProject.name : selectedProjectId}
                </button>
              ) : (
                <span className="text-[var(--ink)] font-medium truncate max-w-[200px]" data-no-drag>
                  {selectedProject ? selectedProject.name : selectedProjectId}
                </span>
              )}
              <ChevronRight size={14} className="text-[var(--ink-subtle)] shrink-0" />
              {isSessionView ? (
                <span className="text-[var(--ink)] font-medium truncate" data-no-drag>{dockedSessionTitle || '会话'}</span>
              ) : (
                <button onClick={() => setViewLevel('session')} data-no-drag
                  className="text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors truncate">
                  {dockedSessionTitle || '会话'}
                </button>
              )}
              <div className="flex items-center gap-0.5 shrink-0" data-no-drag>
                <button onClick={() => onMoveDockedToWorkspace?.()} title="在工作台打开"
                  className="p-1 rounded hover:bg-[var(--paper-inset)] text-[var(--ink-muted)] hover:text-[var(--ink)]"><ExternalLink size={13} /></button>
                <button onClick={() => onCloseDockedSession?.()} title="关闭会话"
                  className="p-1 rounded hover:bg-red-50 text-[var(--ink-muted)] hover:text-red-500"><X size={13} /></button>
              </div>
            </>
          ) : (
            <span className="text-[var(--ink)] font-medium truncate flex-1 min-w-0" data-no-drag>
              {selectedProject ? selectedProject.name : selectedProjectId}
            </span>
          )}
        </div>

        {/* Detail page + Session slot */}
        <div className="flex-1 relative overflow-hidden">
          {hasDockedSession && (
            <div ref={slotRef} className={`absolute inset-0 overflow-hidden ${isSessionView ? 'z-10' : 'z-0'}`} />
          )}
          <div className={`absolute inset-0 overflow-hidden ${isSessionView ? 'z-0 invisible pointer-events-none' : 'z-10'}`}>
            <Suspense fallback={<div className="h-full w-full bg-[var(--paper)]" />}>
              <NonLitigationDetailPage
                projectId={selectedProjectId}
                isActive
                onStartProjectService={(typeId, message) => onStartProjectService(selectedProjectId, typeId, message)}
                getArchivedSessionIds={getArchivedSessionIds}
              />
            </Suspense>
          </div>
        </div>
      </div>
    );
  }

  // ── Overview (dashboard) ──
  return (
    <div className="h-full bg-[var(--paper)] flex flex-col overflow-hidden">
      <div className="h-11 shrink-0" data-tauri-drag-region />
      <div className="flex-1 overflow-y-auto -mt-11 pt-11">
        <div className="max-w-5xl xl:max-w-6xl 2xl:max-w-7xl mx-auto px-8 pt-6 pb-2 w-full">
          {/* Header */}
          <div className={`flex items-end justify-between gap-6 ${mobile ? 'flex-col items-start gap-3' : ''}`}>
            <div>
              <h1 className="text-3xl font-extrabold text-[var(--ink)] tracking-tight leading-tight"
                style={{ background: 'linear-gradient(135deg, var(--ink) 0%, #555 50%, var(--ink) 100%)', backgroundSize: '200% 100%', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                非诉业务
              </h1>
              <p className={`text-xs text-[var(--ink-subtle)] tracking-wide uppercase ${mobile ? 'mb-0 mt-0.5 opacity-40' : 'opacity-50 mt-1'}`}>Non-Litigation Business</p>
            </div>
            <div className={`flex items-center gap-2 ${mobile ? 'flex-wrap w-full' : ''}`}>
              <div className={`relative ${mobile ? 'w-full' : 'w-48'}`}>
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-muted)]" />
                <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  placeholder="搜索项目..." className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-[var(--paper-elevated)] border border-[var(--paper-inset)] text-[var(--ink)] text-xs placeholder:text-[var(--ink-subtle)] outline-none focus:border-[var(--ink-subtle)]" />
              </div>
              <button onClick={() => onLaunchSteward?.()}
                title="打开非诉管家会话"
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--ink)] text-[var(--paper)] text-sm font-medium hover:opacity-90 transition-colors shadow-sm">
                <MessageSquare size={15} /> 非诉管家
              </button>
              <button onClick={() => setNewProjectModalOpen(true)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--accent-warm)] text-[var(--on-accent)] text-sm font-medium hover:bg-[var(--accent-warm-hover)] transition-colors shadow-sm">
                <Plus size={16} /> 新建项目
              </button>
            </div>
          </div>
          <div className="mt-4 h-[2px] w-48 rounded-full" style={{ background: 'linear-gradient(90deg, #b8943a 0%, rgba(184,148,58,0.15) 100%)' }} />
        </div>

        <div className="max-w-5xl xl:max-w-6xl 2xl:max-w-7xl mx-auto px-8 pt-6 pb-12 space-y-6">
          {/* Stats */}
          {visibleProjects.length > 0 && (
            <div className="flex items-stretch gap-4">
              <div className="flex items-center gap-5 px-5 py-3.5 rounded-xl bg-[var(--paper-elevated)] border border-[var(--paper-inset)] shrink-0">
                <div className="text-center min-w-[48px]">
                  <p className="text-3xl font-extrabold text-[var(--ink)] tabular-nums">{visibleProjects.length}</p>
                  <p className="text-xs text-[var(--ink-muted)] mt-0.5 tracking-wide">全部</p>
                </div>
                <span className="w-px h-10 bg-[var(--paper-inset)]" />
                <div className="text-center min-w-[48px]">
                  <p className="text-3xl font-extrabold text-blue-600 tabular-nums">{activeCount}</p>
                  <p className="text-xs text-[var(--ink-muted)] mt-0.5 tracking-wide">进行中</p>
                </div>
                {closedCount > 0 && <><span className="w-px h-10 bg-[var(--paper-inset)]" /><div className="text-center min-w-[48px]"><p className="text-3xl font-extrabold text-gray-400 tabular-nums">{closedCount}</p><p className="text-xs text-[var(--ink-muted)] mt-0.5 tracking-wide">已结束</p></div></>}
                {retainerCount > 0 && specialCount > 0 && (
                  <><span className="w-px h-10 bg-[var(--paper-inset)]" />
                    <div className="text-center min-w-[36px]"><p className="text-lg font-bold text-blue-500 tabular-nums">{retainerCount}</p><p className="text-xs text-[var(--ink-muted)] mt-0.5">常法</p></div>
                    <div className="text-center min-w-[36px]"><p className="text-lg font-bold text-orange-500 tabular-nums">{specialCount}</p><p className="text-xs text-[var(--ink-muted)] mt-0.5">专项</p></div>
                  </>
                )}
              </div>
              <div className="flex items-center gap-5 ml-auto">
                {overdueTaskCount > 0 && (
                  <button onClick={onOpenCalendar} className="flex items-center gap-2 hover:opacity-70 transition-opacity">
                    <span className="text-xl font-extrabold text-red-500 tabular-nums">{overdueTaskCount}</span>
                    <span className="text-xs text-[var(--ink-muted)] font-medium">项逾期</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Filter row: type chips + tag filter + sort + archive */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 flex-wrap">
              {PROJECT_TYPES.map(pt => (
                <button key={pt.key} onClick={() => setTypeFilter(pt.key)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    typeFilter === pt.key
                      ? 'bg-[var(--ink)] text-[var(--paper)]'
                      : pt.color || 'bg-[var(--paper-inset)] text-[var(--ink-muted)] hover:bg-[var(--paper-elevated)]'
                  }`}>
                  {pt.label}
                </button>
              ))}
              {groupedTags.length > 0 && (
                <div className="relative" ref={tagMenuRef}>
                  <button onClick={() => setTagMenuOpen(v => !v)}
                    className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-colors ${tagFilter.length > 0 ? 'bg-[var(--ink)] text-[var(--paper)]' : 'bg-[var(--paper-inset)] text-[var(--ink-muted)] hover:bg-[var(--paper-elevated)]'}`}>
                    标签{tagFilter.length > 0 ? `(${tagFilter.length})` : ''} ▾
                  </button>
                  {tagMenuOpen && (
                    <div className="absolute top-full left-0 mt-1 w-56 bg-[var(--paper-elevated)] border border-[var(--paper-inset)] rounded-xl shadow-xl z-40 py-1 max-h-64 overflow-y-auto">
                      {groupedTags.map(g => (
                        <div key={g.category}>
                          <div className="px-3 pt-1.5 pb-0.5 text-xs font-semibold uppercase tracking-wider text-[var(--ink-muted)]/60">{getTagCategoryLabel(g.category)}</div>
                          {g.tags.map(t => (
                            <button key={t} onClick={() => setTagFilter(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])}
                              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[var(--ink)] hover:bg-[var(--paper-inset)] text-left">
                              <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${tagFilter.includes(t) ? 'bg-[var(--ink)] border-[var(--ink)]' : 'border-[var(--ink-subtle)]'}`}>
                                {tagFilter.includes(t) && <Check size={10} className="text-[var(--paper)]" />}
                              </span>
                              {t}
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <CustomSelect size="sm" value={sortKey}
                options={[{ value: 'recent', label: '最近更新' }, { value: 'serviceEnd', label: '服务期截止' }, { value: 'amount', label: '合同金额' }]}
                onChange={v => setSortKey(v as 'recent' | 'serviceEnd' | 'amount')} />
              {projects.filter(p => p.archived).length > 0 && (
                <button onClick={() => setShowArchived(v => !v)}
                  className={`text-xs ${showArchived ? 'text-[var(--ink)]' : 'text-[var(--ink-muted)] hover:text-[var(--ink)]'}`}>
                  {showArchived ? '隐藏归档' : `归档 (${projects.filter(p => p.archived).length})`}
                </button>
              )}
            </div>
          </div>

          {/* Project cards or empty state */}
          {projects.length === 0 ? (
            <div className="text-center py-16 rounded-2xl bg-[var(--paper-elevated)] border border-dashed border-[var(--paper-inset)]">
              <Briefcase size={28} className="mx-auto mb-3 text-[var(--ink-muted)] opacity-40" />
              <p className="text-sm text-[var(--ink-muted)] mb-3">暂无非诉项目</p>
              <button onClick={() => setNewProjectModalOpen(true)}
                className="text-sm text-[var(--ink)] font-medium hover:underline">新建第一个项目 →</button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {displayProjects.map(p => {
                const typeConfig = PROJECT_TYPES.find(t => t.key === p.projectType);
                const hasOverdue = p.taskGroups.some(g => g.tasks.some(t => t.status !== 'done' && t.deadline && isOverdue(t.deadline)));
                const pendingTaskCount = p.taskGroups.reduce((n, g) => n + g.tasks.filter(t => t.status !== 'done').length, 0);
                const nextDate = nextDateMap.get(p.projectId);
                const nextDays = nextDate ? daysUntil(nextDate) : null;
                const tags = p.tags ?? [];
                const dash = p.projectId.lastIndexOf('-');
                const idHead = dash > 0 ? p.projectId.slice(0, dash + 1) : '';
                const idTail = dash > 0 ? p.projectId.slice(dash + 1) : p.projectId;
                return (
                  <div key={p.projectId} role="button" tabIndex={0}
                    onClick={() => onSelectProject(p.projectId)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onSelectProject(p.projectId); } }}
                    className={`group rounded-xl bg-[var(--paper-elevated)] text-left transition-shadow hover:shadow-sm cursor-pointer grid grid-cols-[68px_minmax(0,1fr)] overflow-hidden h-[182px] ${p.archived ? 'opacity-55 hover:shadow-none' : ''}`}>
                    {/* 左轨：项目编号（类型前缀小号 + 序号大字）+ 底部类型签 */}
                    <div className="flex flex-col py-2.5 border-r border-[var(--paper-inset)]" style={{ background: 'color-mix(in srgb, var(--paper-inset) 80%, transparent)' }}>
                      <div className="px-1.5 leading-tight break-words">
                        {idHead && <div className="font-mono text-xs text-[var(--ink-subtle)] tracking-[0.02em]">{idHead}</div>}
                        <div className="font-mono text-lg font-bold text-[var(--ink)] tracking-[0.02em]">{idTail}</div>
                      </div>
                      <div className="mt-auto px-1.5 pb-0.5">
                        <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-semibold ${typeConfig?.color || 'bg-[var(--paper-inset)] text-[var(--ink-muted)]'}`}>{typeConfig?.label || p.projectType}</span>
                      </div>
                    </div>
                    {/* 主体 */}
                    <div className="flex flex-col p-3.5 min-w-0" style={{ background: 'var(--biz-card-bg, #ffffff)' }}>
                      <div className="flex items-center gap-2">
                        <h3 className="flex-1 min-w-0 text-sm font-semibold text-[var(--ink)] truncate leading-snug" style={{ letterSpacing: '-0.005em' }} title={p.name}>{p.name}</h3>
                        <span className={`shrink-0 px-2 py-0.5 rounded text-xs font-medium ${
                          p.status === 'active' ? 'bg-emerald-50 text-emerald-600' :
                          p.status === 'closed' ? 'bg-gray-100 text-gray-500' : 'bg-amber-50 text-amber-600'
                        }`}>
                          {p.status === 'active' ? '进行中' : p.status === 'closed' ? '已结束' : '暂停'}
                        </span>
                      </div>
                      {/* 期限 */}
                      {(p.servicePeriod.start || p.servicePeriod.end) && (
                        <div className="mt-1.5 flex items-center gap-1.5 text-xs text-[var(--ink-muted)] min-w-0">
                          <span className="w-8 shrink-0 text-[var(--ink-subtle)]">期限</span>
                          <span className="truncate font-mono">{p.servicePeriod.start} ~ {p.servicePeriod.end}</span>
                        </div>
                      )}
                      {/* 负责 */}
                      {(p.leadLawyer || p.team.length > 0) && (
                        <div className="mt-1 flex items-center gap-1.5 text-xs text-[var(--ink-muted)] min-w-0">
                          <span className="w-8 shrink-0 text-[var(--ink-subtle)]">负责</span>
                          <span className="truncate">{p.leadLawyer}{p.leadLawyer && p.team.length > 0 ? ' · ' : ''}{p.team.join('、')}</span>
                        </div>
                      )}
                      {/* 金额 */}
                      {p.contractAmount && (
                        <div className="mt-1 flex items-center gap-1.5 text-xs text-[var(--ink-muted)] min-w-0">
                          <span className="w-8 shrink-0 text-[var(--ink-subtle)]">金额</span>
                          <span className="text-[var(--ink)] font-semibold tabular-nums">{formatAmount(p.contractAmount)}</span>
                        </div>
                      )}
                      <div className="mt-auto pt-2.5 border-t border-[var(--line-subtle)] flex items-center gap-1.5 text-xs text-[var(--ink-subtle)] overflow-hidden">
                        {nextDate && nextDays !== null && (
                          <span className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${
                            nextDays <= 3 ? 'bg-red-50 text-red-600' : nextDays <= 7 ? 'bg-amber-50 text-amber-700' : 'bg-[var(--paper-inset)] text-[var(--ink-muted)]'
                          }`} title={nextDate}>
                            <CalendarClock size={11} className="shrink-0" strokeWidth={2} />
                            到期 {nextDays === 0 ? '今天' : nextDays === 1 ? '明天' : `${nextDays}天后`}
                          </span>
                        )}
                        {hasOverdue && <span className="shrink-0 text-red-500 font-semibold">逾期</span>}
                        {pendingTaskCount > 0 && <span className="shrink-0">{pendingTaskCount} 待办</span>}
                        {tags.slice(0, 2).map(t => (
                          <span key={t} className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${getTagColor(t)}`}>{t}</span>
                        ))}
                        {tags.length > 2 && <span className="shrink-0 text-xs text-[var(--ink-subtle)]">+{tags.length - 2}</span>}
                        <span className="flex-1" />
                        {p.boundSessions.length > 0 && <span className="shrink-0">{p.boundSessions.length} 会话</span>}
                        {p.updatedAt && <span className="shrink-0 opacity-50">{timeAgo(p.updatedAt)}</span>}
                        <button onClick={e => { e.stopPropagation(); setDeleteTarget(p); }}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 text-[var(--ink-subtle)] hover:text-red-500 transition-all" title="删除"><Trash2 size={12} /></button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {projects.length > 0 && displayProjects.length === 0 && (
            <div className="text-center py-16 rounded-2xl bg-[var(--paper-elevated)] border border-dashed border-[var(--paper-inset)]">
              <p className="text-sm text-[var(--ink-muted)]">没有符合条件的项目</p>
            </div>
          )}
        </div>
      </div>

      {mobile && (
        <MobileNav
          primaryKey="new"
          items={[
            { key: 'projects', label: '项目', icon: '🗂', active: !selectedProjectId && typeFilter === '__all', onClick: () => { onSelectProject(null); } },
            { key: 'new', label: '新建项目', icon: '＋', onClick: () => setNewProjectModalOpen(true) },
            { key: 'retainer', label: '常法', icon: '🗄', active: typeFilter === 'retainer', onClick: () => setTypeFilter((v) => (v === 'retainer' ? '__all' : 'retainer')) },
          ]}
        />
      )}

      {mobile && selectedProjectId && selectedProject && (
        <MobileDetailDrawer title={selectedProject.name} onClose={() => onSelectProject(null)}>
          <NonLitigationDetailPage
            projectId={selectedProjectId}
            isActive
            onStartProjectService={(typeId, message) => onStartProjectService(selectedProjectId, typeId, message)}
            getArchivedSessionIds={getArchivedSessionIds}
          />
        </MobileDetailDrawer>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="删除项目"
          message={`确认删除「${deleteTarget.projectId} ${deleteTarget.name}」？所有任务和会话将保留。`}
          confirmText="删除"
          cancelText="取消"
          confirmVariant="danger"
          onConfirm={() => handleDeleteProject(deleteTarget.projectId)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      <NewProjectModal
        isOpen={newProjectModalOpen}
        onClose={() => setNewProjectModalOpen(false)}
        onSubmit={handleNewProject}
        existingProjects={projects}
      />
    </div>
  );
});
