/**
 * CaseManager — the 案件管理 module (Phase 5). Owns the full content area, no
 * tabs. Internal navigation between the dashboard (总览) and a case detail is a
 * breadcrumb + selectedCaseId state — NOT a tab (Phase 2's per-case tab was
 * removed). Cross-module "open this case" arrives via openCaseRequest (nonced so
 * a repeat request for the same case re-opens detail). Still owns the
 * session-integrity effects (bind / unbind / prune) since they react to
 * app-wide session events.
 */

import { memo, useCallback, useRef, useEffect, useState, Suspense } from 'react';
import { ChevronRight, X, ExternalLink, Plus, Search, MessageSquare } from 'lucide-react';
import CaseDashboard from '@/components/agentlex/CaseDashboard';
import CaseSwitcher from '@/components/agentlex/CaseSwitcher';
import NewCaseModal, { type CaseFormData } from '@/components/agentlex/NewCaseModal';
import { useAgentLex } from '@/hooks/useAgentLex';
import type { CaseEntry } from '@/hooks/useAgentLex';
import { getSessions, type SessionMetadata } from '@/api/sessionClient';
import { setSessionSlot } from '@/utils/sessionDock';
import { canonicalPartyRole } from '@/utils/caseFormat';

import CaseDetailPage from '@/pages/CaseDetailPage';
import { useIsMobile } from '@/hooks/useIsMobile';
import { MobileNav } from '@/components/agentlex/MobileNav';
import { MobileDetailDrawer } from '@/components/agentlex/MobileDetailDrawer';

interface CaseManagerProps {
  isActive?: boolean;
  onOpenCaseSession: (caseEntry: CaseEntry, sessionId?: string, intake?: boolean, bindingKey?: string) => void;
  onCaseRegistered: (caseId: string, caseFolder: string, caseName: string) => void;
  /** Controlled selection (lifted to App so it survives module switches, bug 10). */
  selectedCaseId: string | null;
  onSelectCase: (caseId: string | null) => void;
  /** Left inset (px) to clear macOS traffic lights when the sidebar is narrow. */
  trafficInset?: number;
  /** True when a chat session is docked to the selected case. */
  hasDockedSession?: boolean;
  /** The docked session's title (for breadcrumb display — Bug 3 fix). */
  dockedSessionTitle?: string;
  /** Close (release) the docked session — like closing a tab. */
  onCloseDockedSession?: () => void;
  /** Move the docked session OUT to the Agent workspace (undock). */
  onMoveDockedToWorkspace?: () => void;
  onOpenCalendar?: () => void;
  /** Open a session with the case management agent from the dashboard. */
  onOpenCaseAgent?: () => void;
  /** Open a bound case folder in the better-sidebar. */
  onOpenCaseFolder?: (folder: string) => void;
  /** Resolves the DSH workspace archive set — archived sessions are hidden
   *  from the case detail's historical-session dropdown. */
  getArchivedSessionIds?: () => Promise<Set<string>>;
}

/** 我方侧角色 → ourSide key（推导用）。 */
const ROLE_TO_OURSIDE: Record<string, string> = {
  原告: 'plaintiff', 申请人: 'applicant', 上诉人: 'appellant', 申请执行人: 'executionApplicant',
  被告: 'defendant', 被申请人: 'respondent', 被上诉人: 'appellee', 被执行人: 'executionRespondent',
};

/**
 * 由新建表单的当事人行（我方/对方分组）组装 parties：
 *  - 我方行 ourClient:true，对方行 false；
 *  - ourSide 由我方第一行角色推导（没有我方行 → unknown）；
 *  - 首级 plaintiff/defendant 取各侧第一行名字（兼容旧数据；details 才是权威）。
 */
function buildPartiesFromRows(rows: Array<{ side: 'our' | 'their'; role: string; name: string }>): CaseEntry['parties'] {
  const ourRows = rows.filter(r => r.side === 'our' && r.name.trim() !== '');
  const theirRows = rows.filter(r => r.side === 'their' && r.name.trim() !== '');
  const details: CaseEntry['parties']['details'] = [
    ...ourRows.map(r => ({ name: r.name.trim(), role: r.role || '原告', ourClient: true })),
    ...theirRows.map(r => ({ name: r.name.trim(), role: r.role || '被告', ourClient: false })),
  ];
  let ourSide: string = 'unknown';
  if (ourRows.length > 0) {
    const canon = canonicalPartyRole(ourRows[0].role || '');
    ourSide = ROLE_TO_OURSIDE[canon] ?? 'unknown';
  }
  const primary = ourRows[0]?.name?.trim();
  const counterpartPrimary = theirRows[0]?.name?.trim();
  const A = ['plaintiff', 'applicant', 'appellant', 'executionApplicant'];
  return {
    ...(A.includes(ourSide) ? { plaintiff: primary, defendant: counterpartPrimary } : { plaintiff: counterpartPrimary, defendant: primary }),
    ourSide,
    ourClientName: primary,
    details,
  };
}

/** 由表单数据构建 CaseEntry（模块级纯函数：新建的卡片，未采集字段留空交给后续）。 */
function buildCaseEntry(data: CaseFormData): CaseEntry {
  const now = new Date().toISOString();
  return {
    caseId: data.caseId,
    caseNumber: data.caseNumber,
    name: data.name,
    alias: [],
    type: data.type,
    cause: data.cause,
    status: 'intake',
    folder: data.folder,
    parties: buildPartiesFromRows(data.partyRows),
    court: '',
    keyDates: [],
    boundSessions: [],
    linkedContracts: [],
    linkedResearch: [],
    tags: data.tags ?? [],
    taskGroups: [],
    createdAt: now,
    updatedAt: now,
  };
}

export default memo(function CaseManager({ isActive: _isActive, onOpenCaseSession, onCaseRegistered, selectedCaseId, onSelectCase, trafficInset = 0, hasDockedSession = false, dockedSessionTitle, onCloseDockedSession, onMoveDockedToWorkspace, onOpenCalendar, onOpenCaseAgent, onOpenCaseFolder, getArchivedSessionIds }: CaseManagerProps) {
  const mobile = useIsMobile();
  const { cases, timelineEvents, addCase, updateCase, deleteCase, bindSession, unbindSession, unbindProjectSession, pruneStaleSessions, projects } = useAgentLex();
  const [newCaseModalOpen, setNewCaseModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  // Three-level breadcrumb navigation: overview → detail → session. Each level
  // is a full page within the module (no split panes). Portal mechanism unchanged.
  const [viewLevel, setViewLevel] = useState<'overview' | 'detail' | 'session'>('overview');
  // Register the session dock slot so the tab map can portal the docked Chat in.
  const slotRef = useCallback((el: HTMLDivElement | null) => {
    if (selectedCaseId) setSessionSlot(selectedCaseId, el);
  }, [selectedCaseId]);

  // Auto-navigate to session view on false→true transition (session just docked).
  const prevDockedRef = useRef(false);
  useEffect(() => {
    if (hasDockedSession && !prevDockedRef.current && selectedCaseId) {
      setViewLevel('session');
    }
    prevDockedRef.current = hasDockedSession;
  }, [hasDockedSession, selectedCaseId]);

  // When session is externally closed (Cmd+W / workspace) while viewing it, fall back to detail.
  useEffect(() => {
    if (!hasDockedSession && viewLevel === 'session') {
      setViewLevel('detail');
    }
  }, [hasDockedSession, viewLevel]);

  // Switching between cases resets to detail ONLY when no session is docked.
  // If a session is already docked (e.g. quick-launch), keep the session view.
  useEffect(() => {
    if (selectedCaseId && !hasDockedSession) setViewLevel('detail');
  }, [selectedCaseId, hasDockedSession]);

  const casesRef = useRef(cases);
  casesRef.current = cases;

  // The store (useAgentLex) owns disk reload. This effect only prunes bound
  // sessions that no longer exist in the session system (needs the live list).
  useEffect(() => {
    let active = true;
    const prune = async () => {
      try {
        const sessions: SessionMetadata[] = await getSessions();
        if (!active) return;
        const validIds = new Set(sessions.map(s => s.id));
        void pruneStaleSessions(validIds);
      } catch { /* sidecar may not be ready */ }
    };
    prune();
    const onFocus = () => { void prune(); };
    window.addEventListener('focus', onFocus);
    return () => {
      active = false;
      window.removeEventListener('focus', onFocus);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = (e: Event) => {
      const { caseId, sessionId, label, agentKey } = (e as CustomEvent).detail;
      bindSession(caseId, sessionId, label, agentKey);
    };
    window.addEventListener('agentlex:session-bound', handler);
    return () => window.removeEventListener('agentlex:session-bound', handler);
  }, [bindSession]);

  useEffect(() => {
    const handler = (e: Event) => {
      const { sessionId } = (e as CustomEvent).detail;
      unbindSession(sessionId);
    };
    window.addEventListener('agentlex:session-deleted', handler);
    return () => window.removeEventListener('agentlex:session-deleted', handler);
  }, [unbindSession]);

  useEffect(() => {
    const handler = async (e: Event) => {
      const { sessionId } = (e as CustomEvent).detail;
      const { querySessionHasPersistentOwners } = await import('@/api/tauriClient');
      try {
        // Upstream retired the session-activation map in the owner-model
        // refactor; "has persistent owners" is the current authority for
        // "this session is still live somewhere".
        const hasOwners = await querySessionHasPersistentOwners(sessionId);
        if (!hasOwners) {
          for (const c of casesRef.current) {
            const stale = c.boundSessions.find(s => s.sessionId === sessionId);
            if (stale) {
              updateCase(c.caseId, entry => ({
                ...entry,
                boundSessions: entry.boundSessions.filter(s => s.sessionId !== sessionId),
                updatedAt: new Date().toISOString(),
              }));
            }
          }
          // Also clean up project bindings
          for (const p of projects) {
            const stale = p.boundSessions.find(s => s.sessionId === sessionId);
            if (stale) {
              unbindProjectSession(sessionId);
            }
          }
        }
      } catch { /* keep on query failure */ }
    };
    window.addEventListener('session:sidecar-terminal', handler);
    return () => window.removeEventListener('session:sidecar-terminal', handler);
  }, [updateCase, projects, unbindProjectSession]);

  const finishCaseSubmit = useCallback((entry: CaseEntry) => {
    setNewCaseModalOpen(false);
    onCaseRegistered(entry.caseId, entry.folder, entry.name);
    onSelectCase(entry.caseId);
  }, [onCaseRegistered, onSelectCase]);

  // 智能注册：落库后带着案件卡片进入「案件管理」agent 新会话，由 agent 按 SOP
  // 补全全部信息（法院/法官/标的额/立案日期/概述等）。
  // 编号冲突（addCase 抛错）向上抛给表单提示，不关闭、不覆盖数据（备忘录 #8）。
  const handleCaseSubmit = useCallback(async (data: CaseFormData) => {
    const entry = buildCaseEntry(data);
    await addCase(entry);
    finishCaseSubmit(entry);
    onOpenCaseSession(entry, undefined, true);
  }, [addCase, finishCaseSubmit, onOpenCaseSession]);

  // 普通注册：仅落库（不跳 agent 会话），供手动登记 / 无需 agent 补全的场景。
  const handleCaseSubmitPlain = useCallback(async (data: CaseFormData) => {
    const entry = buildCaseEntry(data);
    await addCase(entry);
    finishCaseSubmit(entry);
  }, [addCase, finishCaseSubmit]);

  const handleDeleteCase = useCallback((caseId: string) => {
    void deleteCase(caseId);
    if (selectedCaseId === caseId) onSelectCase(null);
  }, [deleteCase, selectedCaseId, onSelectCase]);

  const selectedCase = selectedCaseId ? cases.find(c => c.caseId === selectedCaseId) : null;

  // ── Detail / Session views (full-page, breadcrumb-controlled) ────────
  // Both pages stay MOUNTED once selectedCaseId is set; only CSS visibility
  // toggles (hidden). This keeps the session dock slot DOM-stable (Bug 1 fix)
  // and avoids CaseDetailPage remount (Bug 2 fix).
  // ── Mobile: detail opens as a slide-in drawer over the dashboard, and the
  //     dashboard stays mounted below (state preserved). Desktop unchanged.
  if (selectedCaseId && !mobile) {
    const isSessionView = viewLevel === 'session' && hasDockedSession;
    return (
      <div className="h-full bg-[var(--paper)] flex flex-col overflow-hidden">
        {/* Breadcrumb — two or three levels depending on docked session.
            When a session is docked, the breadcrumb always shows three
            levels so the user can navigate between detail and session
            without the session closing. */}
        <div className="flex items-center gap-2 py-3 pr-4 border-b border-[var(--paper-inset)] text-sm shrink-0 h-12" style={{ paddingLeft: 24 + trafficInset }} data-tauri-drag-region>
          <button onClick={() => onSelectCase(null)} data-no-drag title="返回案件总览"
            className="p-1 -ml-1 rounded-md text-[var(--ink-muted)] hover:text-[var(--ink)] hover:bg-[var(--paper-inset)] transition-colors shrink-0">
            <ChevronRight size={16} className="rotate-180" />
          </button>
          {hasDockedSession ? (
            <>
              {isSessionView ? (
                <button onClick={() => setViewLevel('detail')} data-no-drag className="text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors truncate max-w-[200px]">
                  {selectedCase ? `${selectedCase.caseId} ${selectedCase.name}` : selectedCaseId}
                </button>
              ) : (
                <span className="text-[var(--ink)] font-medium truncate max-w-[200px]" data-no-drag>
                  {selectedCase ? `${selectedCase.caseId} ${selectedCase.name}` : selectedCaseId}
                </span>
              )}
              <ChevronRight size={14} className="text-[var(--ink-subtle)] shrink-0" />
              {isSessionView ? (
                <span className="text-[var(--ink)] font-medium truncate" data-no-drag>{dockedSessionTitle || '会话'}</span>
              ) : (
                <button onClick={() => setViewLevel('session')} data-no-drag className="text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors truncate">
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
            <span className="text-[var(--ink)] font-medium truncate flex-1 min-w-0" data-no-drag>{selectedCase ? `${selectedCase.caseId} ${selectedCase.name}` : selectedCaseId}</span>
          )}
          {selectedCaseId && (
            <div className="ml-auto mr-2" data-no-drag>
              <CaseSwitcher cases={cases} selectedCaseId={selectedCaseId} onSelect={(c) => onSelectCase(c.caseId)} />
            </div>
          )}
        </div>

        {/* Detail page + Session slot: both absolute-inset-0 inside a relative
            parent. Session slot is ALWAYS visible (z-10 when active, z-0 behind
            detail). Detail page layers on top when not in session view. Both
            always have computed dimensions → no display:none → Chat never
            initializes with 0-size container (Bug 1). */}
        <div className="flex-1 relative overflow-hidden">
          {/* Session dock slot: always visible, behind detail when detail is active */}
          {hasDockedSession && (
            <div ref={slotRef} className={`absolute inset-0 overflow-hidden ${isSessionView ? 'z-10' : 'z-0'}`} />
          )}
          {/* Detail page: on top when active, invisible when session view */}
          <div className={`absolute inset-0 overflow-hidden ${isSessionView ? 'z-0 invisible pointer-events-none' : 'z-10'}`}>
            <Suspense fallback={<div className="h-full w-full bg-[var(--paper)]" />}>
              <CaseDetailPage caseId={selectedCaseId} isActive onOpenCaseSession={onOpenCaseSession} onOpenCaseFolder={onOpenCaseFolder} getArchivedSessionIds={getArchivedSessionIds} />
            </Suspense>
          </div>
        </div>
      </div>
    );
  }

  // Overview (dashboard). Topmost row is a slim draggable strip clearing the
  // traffic lights (bug 7: no titlebar in this module).
  return (
    <div className="h-full bg-[var(--paper)] flex flex-col overflow-hidden">
      <div className="h-11 shrink-0" data-tauri-drag-region />
      <div className="flex-1 overflow-y-auto -mt-11 pt-11">
        {/* Module title — search + new case in title row */}
        <div className="max-w-5xl xl:max-w-6xl 2xl:max-w-7xl mx-auto px-8 pt-10 pb-2 w-full">
          <div className={`flex items-end justify-between gap-6 ${mobile ? 'flex-col items-start gap-3' : ''}`}>
            <div>
              <h1 className="text-3xl font-extrabold text-[var(--ink)] tracking-tight leading-tight" style={{ background: 'linear-gradient(135deg, var(--ink) 0%, #555 50%, var(--ink) 100%)', backgroundSize: '200% 100%', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>诉讼案件</h1>
              <p className={`text-xs text-[var(--ink-subtle)] tracking-wide uppercase ${mobile ? 'mb-0 mt-0.5 opacity-40' : 'opacity-50 mt-1'}`}>LITIGATION CASES</p>
            </div>
            <div className={`flex items-center gap-2 ${mobile ? 'flex-wrap w-full' : ''}`}>
              <div className={`relative ${mobile ? 'w-full' : 'w-48'}`}>
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-muted)]" />
                <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  placeholder="搜索案件..." className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-[var(--paper-elevated)] border border-[var(--paper-inset)] text-[var(--ink)] text-xs placeholder:text-[var(--ink-subtle)] outline-none focus:border-[var(--ink-subtle)]" />
              </div>
              <button onClick={() => onOpenCaseAgent?.()}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--button-dark-bg)] text-[var(--button-dark-text)] text-sm font-medium hover:bg-[var(--button-dark-bg-hover)] transition-colors shadow-sm"
                title="打开诉讼管家会话">
                <MessageSquare size={15} /> 诉讼管家
              </button>
              <button onClick={() => setNewCaseModalOpen(true)}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[var(--accent-warm)] text-[var(--on-accent)] text-sm font-medium hover:bg-[var(--accent-warm-hover)] transition-colors shadow-sm">
                <Plus size={16} /> 新建案件
              </button>
            </div>
          </div>
          <div className="mt-4 h-[2px] w-48 rounded-full" style={{ background: 'linear-gradient(90deg, #b8943a 0%, rgba(184,148,58,0.15) 100%)' }} />
        </div>
        <CaseDashboard
          cases={cases}
          timelineEvents={timelineEvents}
          onOpenCase={(e) => onSelectCase(e.caseId)}
          onNewCase={() => setNewCaseModalOpen(true)}
          onDeleteCase={handleDeleteCase}
          searchQuery={searchQuery}
          onClearSearch={() => setSearchQuery('')}
          onOpenCalendar={onOpenCalendar}
        />
      </div>

      {mobile && (
        <MobileNav
          primaryKey="new"
          items={[
            { key: 'overview', label: '案件总览', icon: '⚖', active: !selectedCaseId, onClick: () => onSelectCase(null) },
            { key: 'new', label: '新建案件', icon: '＋', onClick: () => setNewCaseModalOpen(true) },
            { key: 'agent', label: '诉讼管家', icon: '🤖', onClick: () => onOpenCaseAgent?.() },
          ]}
        />
      )}

      {mobile && selectedCaseId && selectedCase && (
        <MobileDetailDrawer title={`${selectedCase.caseId} ${selectedCase.name}`} onClose={() => onSelectCase(null)}>
          <CaseDetailPage caseId={selectedCaseId} isActive onOpenCaseSession={onOpenCaseSession} onOpenCaseFolder={onOpenCaseFolder} getArchivedSessionIds={getArchivedSessionIds} />
        </MobileDetailDrawer>
      )}

      <NewCaseModal
        isOpen={newCaseModalOpen}
        onClose={() => setNewCaseModalOpen(false)}
        onSubmit={handleCaseSubmit}
        onSubmitPlain={handleCaseSubmitPlain}
        existingCases={cases}
      />
    </div>
  );
});
