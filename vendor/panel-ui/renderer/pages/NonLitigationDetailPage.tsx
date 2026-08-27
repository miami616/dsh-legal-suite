/**
 * NonLitigationDetailPage — 非诉项目详情页 (v1.1.0 project-based refactor).
 *
 * Full-page detail for a non-litigation project. Modeled after CaseDetailPage
 * but with project-specific fields (service period, scope, team, etc.) instead
 * of litigation fields (cause, court, judge, parties).
 */

import { memo, useMemo, useCallback, useState, useRef, useEffect } from 'react';
import {
  MessageSquare, FolderOpen, Clock, Calendar, UserCheck, Briefcase,
  Archive, ArchiveRestore, Plus,
} from 'lucide-react';
import { isTauriEnvironment } from '@/utils/browserMock';
import { pickDirectoryPath } from '@/utils/directoryPicker';
import { useAgentLex } from '@/hooks/useAgentLex';
import type { ProjectEntry, TimelineEvent } from '@/hooks/useAgentLex';
import { getSessions } from '@/api/sessionClient';
import CaseTaskTree from '@/components/agentlex/CaseTaskTree';
import ServiceLog, { type ServiceLogEntry } from '@/components/agentlex/ServiceLog';
import TagInput from '@/components/agentlex/TagInput';
import EventForm, { type EventFormData } from '@/components/agentlex/EventForm';
import { formatAmount, todayStr, daysUntil } from '@/utils/caseFormat';
import { TAG_PRESETS } from '@/utils/caseTags';

interface NonLitigationDetailPageProps {
  projectId: string;
  isActive?: boolean;
  /** Launch a sub-service session inside this project */
  onStartProjectService: (typeId: string, message: string) => void;
  /** Resolves the DSH workspace archive set — archived sessions are hidden
   *  from the historical-session dropdown. */
  getArchivedSessionIds?: () => Promise<Set<string>>;
}

// ── Project type display config ──
const PROJECT_TYPE_CONFIG = {
  retainer: { label: '常法', color: 'bg-blue-50 text-blue-600' },
  special: { label: '专项', color: 'bg-orange-50 text-orange-600' },
} as const;

function getProjectTypeConfig(t: string) {
  return PROJECT_TYPE_CONFIG[t as keyof typeof PROJECT_TYPE_CONFIG] ?? { label: t, color: 'bg-[var(--paper-inset)] text-[var(--ink-muted)]' };
}

// ── Agent session button (same pattern as CaseDetailPage) ──

const NONLIT_AGENTS = [
  { key: 'contracts', label: '非诉管家', desc: '合同审查、起草、法律意见书等', Icon: UserCheck },
] as const;

function AgentSessionButton({
  agent, boundSessions, onOpen, getArchivedSessionIds,
}: {
  agent: typeof NONLIT_AGENTS[number];
  boundSessions: ProjectEntry['boundSessions'];
  onOpen: (sessionId?: string) => void;
  getArchivedSessionIds?: () => Promise<Set<string>>;
}) {
  const [open, setOpen] = useState(false);
  const [archivedIds, setArchivedIds] = useState<ReadonlySet<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const mySessions = boundSessions.filter(s =>
    (s.agentKey ?? 'contracts') === agent.key && !archivedIds.has(s.sessionId));

  const toggle = (): void => {
    if (mySessions.length === 0) { onOpen(); return; }
    if (!open) {
      // Refresh the archive set on every open so sessions archived in the
      // DSH workspace disappear from the list immediately.
      void (getArchivedSessionIds?.() ?? Promise.resolve(new Set<string>()))
        .then(setArchivedIds)
        .catch(() => {});
    }
    setOpen(!open);
  };

  return (
    <div className="relative" ref={ref}>
      <button onClick={toggle}
        className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold bg-[var(--ink)] text-[var(--paper)] hover:opacity-90 shadow-sm transition-all">
        <agent.Icon size={14} />
        {agent.label}
        {mySessions.length > 0 && <span className="ml-0.5 opacity-60">({mySessions.length}) ▾</span>}
      </button>
      {open && mySessions.length > 0 && (
        <div className="absolute top-full right-0 mt-1 w-60 bg-[var(--paper-elevated)] border border-[var(--paper-inset)] rounded-xl shadow-xl z-50 py-1 overflow-hidden">
          <div className="max-h-48 overflow-y-auto">
            {mySessions.map(s => (
              <button key={s.sessionId} onClick={() => { setOpen(false); onOpen(s.sessionId); }}
                className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-[var(--paper-inset)] text-left">
                <MessageSquare size={13} className="text-[var(--ink-muted)] shrink-0" />
                <span className="flex-1 text-xs text-[var(--ink)] truncate">{s.label}</span>
                <span className="text-xs text-[var(--ink-subtle)] shrink-0">{s.createdAt.slice(0, 10)}</span>
              </button>
            ))}
          </div>
          <div className="border-t border-[var(--paper-inset)]">
            <button onClick={() => { setOpen(false); onOpen(); }}
              className="w-full text-center py-2.5 text-xs font-medium text-[var(--ink)] hover:bg-[var(--paper-inset)] flex items-center justify-center gap-1.5">
              <MessageSquare size={12} /> 新建会话
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default memo(function NonLitigationDetailPage({
  projectId, isActive: _isActive, onStartProjectService, getArchivedSessionIds,
}: NonLitigationDetailPageProps) {
  const {
    projects, timelineEvents, schedules, updateProject,
    pruneStaleSessions,
    addProjectTimelineEvent,
  } = useAgentLex();
  const entry = projects.find(p => p.projectId === projectId) ?? null;

  // Aggregate tag pool across all projects.
  const allTags = useMemo(() => [...new Set(projects.flatMap(p => p.tags ?? []))].sort((a, b) => a.localeCompare(b)), [projects]);
  const [addingEvent, setAddingEvent] = useState(false);

  // Project timeline: store events + completed tasks + project schedules
  const projectTimeline = useMemo<TimelineEvent[]>(() => {
    if (!entry) return [];
    const result: TimelineEvent[] = [];

    // 1. Store timeline events for this project
    const own = timelineEvents.filter(e => e.caseId === projectId);
    result.push(...own);

    // 2. Tasks projected as timeline events (completed or with completed subtasks)
    for (const g of entry.taskGroups) {
      for (const t of g.tasks) {
        const hasDoneSubtask = t.subtasks.some(st => st.status === 'done');
        const taskDone = t.status === 'done';

        // Only show tasks that either are done or have at least one completed subtask
        if (taskDone || hasDoneSubtask) {
          result.push({
            id: `task-done-${t.id}`,
            caseId: projectId,
            caseName: entry.name,
            type: 'task_deadline',
            label: t.title,
            date: t.updatedAt ? t.updatedAt.slice(0, 10) : '',
            time: t.updatedAt ? t.updatedAt.slice(11, 16) : undefined,
            source: 'manual' as TimelineEvent['source'],
            status: (taskDone ? 'completed' : 'pending') as TimelineEvent['status'],
            remindRules: [],
            createdAt: t.updatedAt ?? new Date().toISOString(),
            createdBy: '诉讼管家',
            updatedAt: t.updatedAt ?? new Date().toISOString(),
          });
        }

        // 2b. Completed subtasks projected as timeline events
        // id encodes parent task id so ServiceLog can nest them in the tree
        for (const st of t.subtasks) {
          if (st.status === 'done') {
            const ts = st.updatedAt || t.updatedAt || new Date().toISOString();
            result.push({
              id: `subtask-done-${st.id}@${t.id}`,
              caseId: projectId,
              caseName: entry.name,
              type: 'task_deadline',
              label: st.title,
              date: ts.slice(0, 10),
              time: ts.slice(11, 16),
              source: 'manual' as TimelineEvent['source'],
              status: 'completed' as TimelineEvent['status'],
              remindRules: [],
              createdAt: ts,
              createdBy: '诉讼管家',
              updatedAt: ts,
            });
          }
        }
      }
    }

    // 3. Schedule items for this project
    for (const s of schedules) {
      if (s.caseId === projectId) {
        result.push({
          id: `sched-${s.id}`,
          caseId: projectId,
          caseName: entry.name,
          type: 'case_event',
          label: s.title,
          date: s.date,
          time: s.time,
          source: (s.source === 'agent' ? 'agent' : 'manual') as TimelineEvent['source'],
          status: s.completed ? 'completed' : (s.date < new Date().toISOString().slice(0, 10) ? 'completed' : 'pending'),
          remindRules: s.reminderLeadMinutes ? [{ type: 'before_event', minutes: s.reminderLeadMinutes, enabled: true }] : [],
          createdAt: s.createdAt,
          createdBy: s.source === 'agent' ? 'Agent' : '手动',
          updatedAt: s.createdAt,
        });
      }
    }

    // Fallback: if nothing found, project keyDates → timeline
    if (result.length === 0) {
      return (entry.keyDates ?? []).filter(kd => kd.date && kd.label).map((kd, i) => ({
        id: `kd-proj-${projectId}-${i}`,
        caseId: projectId,
        caseName: entry.name,
        type: 'case_event' as const,
        label: kd.label,
        date: kd.date,
        source: (kd.source === 'agent-computed' ? 'agent' : 'manual') as TimelineEvent['source'],
        status: (kd.completed === true ? 'completed' : 'pending') as TimelineEvent['status'],
        remindRules: [],
        createdAt: new Date().toISOString(),
        createdBy: '诉讼管家',
        updatedAt: new Date().toISOString(),
      }));
    }

    return result;
  }, [entry, timelineEvents, schedules, projectId]);

  // Service log: transform timeline events into descriptive log entries
  // Uses full timestamp (epoch ms) from createdAt for timezone-safe display
  const serviceLogEntries = useMemo<ServiceLogEntry[]>(() => {
    if (!projectTimeline.length) return [];
    const today = new Date().toISOString().slice(0, 10);
    return projectTimeline
      // Include completed/cancelled events AND pending task containers
      .filter(e => e.status === 'completed' || e.status === 'cancelled' || (e.date && e.date < today)
        || (e.id.startsWith('task-done-') && e.status === 'pending'))
      .map(e => {
        let message: string;
        let parentTaskId: string | undefined;
        const done = e.status === 'completed';
        if (e.id.startsWith('subtask-done-')) {
          // id format: subtask-done-<subtaskId>@<parentTaskId>
          const parts = e.id.split('@');
          parentTaskId = parts[1] ? `task-done-${parts[1]}` : undefined;
          message = `完成了「${e.label}」`;
        } else if (e.type === 'task_deadline' && done) {
          message = `完成了「${e.label}」`;
        } else if (e.type === 'task_deadline' && !done) {
          message = `进行中「${e.label}」`;
        } else if (e.id.startsWith('sched-')) {
          message = `记录了日程「${e.label}」`;
        } else {
          message = e.detail || e.label;
        }
        return { id: e.id, message, ts: new Date(e.createdAt).getTime(), parentTaskId, done };
      });
  }, [projectTimeline]);

  // On mount, prune stale bound sessions (previously deleted but still showing)
  useEffect(() => {
    if (!entry) return;
    getSessions().then(all => {
      const valid = new Set(all.map(s => s.id));
      pruneStaleSessions(valid);
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // 绑定/更换项目文件夹：优先弹 DSH 原生目录选择框（web 经插件 client 桥 /
  // workspaces.pickDirectory，桌面端 Tauri 对话框）；取消或不可用时进入
  // 内联手填模式（填写主机端路径，回车/失焦保存）。
  const [editingFolder, setEditingFolder] = useState(false);
  const [folderDraft, setFolderDraft] = useState('');
  const [folderPickError, setFolderPickError] = useState('');
  const handleBindFolder = useCallback(async () => {
    if (!entry) return;
    try {
      const selected = await pickDirectoryPath('选择项目文件夹', entry.folder ?? '');
      if (selected && typeof selected === 'string') {
        updateProject(entry.projectId, p => ({ ...p, folder: selected, updatedAt: new Date().toISOString() }));
        setEditingFolder(false);
        setFolderPickError('');
      } else {
        setFolderPickError(typeof window !== 'undefined' ? (window.__agentlexPickLastError ?? '') : '');
        setFolderDraft(entry.folder ?? '');
        setEditingFolder(true);
      }
    } catch (e) {
      console.warn('[NonLitigationDetailPage] Folder picker:', e);
      setFolderPickError(e instanceof Error ? e.message : String(e));
      setFolderDraft(entry.folder ?? '');
      setEditingFolder(true);
    }
  }, [entry, updateProject]);
  const saveFolderDraft = useCallback(() => {
    if (!entry || !editingFolder) return;
    const value = folderDraft.trim();
    setEditingFolder(false);
    if (value === (entry.folder ?? '')) return;
    updateProject(entry.projectId, p => ({ ...p, folder: value, updatedAt: new Date().toISOString() }));
  }, [entry, editingFolder, folderDraft, updateProject]);

  const [editingField, setEditingField] = useState<string | null>(null);
  const [fieldDraft, setFieldDraft] = useState('');

  const startEditField = (field: string, value: string) => { setEditingField(field); setFieldDraft(value); };
  const saveField = (field: string) => {
    if (!entry || editingField !== field) return;
    updateProject(entry.projectId, p => ({ ...p, [field]: fieldDraft, updatedAt: new Date().toISOString() }));
    setEditingField(null);
  };

  const safeStr = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (typeof v === 'object') return '';
    return String(v);
  };

  const Editable = ({ field, value, placeholder = '—' }: { field: string; value?: string; placeholder?: string }) => {
    const display = safeStr(value);
    if (editingField === field) {
      return (
        <input type="text" value={fieldDraft} onChange={e => setFieldDraft(e.target.value)}
          onBlur={() => saveField(field)} onKeyDown={e => { if (e.key === 'Enter') saveField(field); if (e.key === 'Escape') setEditingField(null); }}
          className="w-full px-2 py-0.5 -mx-2 rounded bg-[var(--paper-inset)] text-sm text-[var(--ink)] outline-none ring-1 ring-[var(--ink-subtle)]" autoFocus />
      );
    }
    return (
      <span onClick={() => startEditField(field, display)}
        className="cursor-pointer hover:bg-[var(--paper-inset)] px-2 py-0.5 -mx-2 rounded transition-colors block">
        {display || placeholder}
      </span>
    );
  };

  const openServiceSession = useCallback((sessionId?: string) => {
    if (sessionId) {
      const docked = projects.find(p => p.projectId === projectId)?.boundSessions.find(bs => bs.sessionId === sessionId);
      if (docked) {
        window.dispatchEvent(new CustomEvent('agentlex:quick-launch', {
          detail: { businessKey: 'contracts', moduleId: 'contracts', bindProjectId: projectId, targetSessionId: sessionId },
        }));
        return;
      }
    }
    onStartProjectService('default', '');
  }, [onStartProjectService, projectId, projects]);

  const handleAddEvent = useCallback((d: EventFormData) => {
    if (!entry) return;
    const now = new Date().toISOString();
    addProjectTimelineEvent({
      id: '', caseId: projectId, caseName: entry.name, type: d.type,
      label: d.label, date: d.date, time: d.time, source: 'manual',
      status: d.status, remindRules: d.remindDays ? [{ type: 'before_event', minutes: d.remindDays * 1440, enabled: true }] : [],
      createdAt: now, createdBy: '用户', updatedAt: now,
    });
    setAddingEvent(false);
  }, [addProjectTimelineEvent, entry, projectId]);

  if (!entry) {
    return (
      <div className="h-full bg-[var(--paper)] flex flex-col items-center justify-center text-center">
        <Briefcase size={36} className="mb-3 text-[var(--ink-subtle)]" />
        <p className="text-sm text-[var(--ink-muted)]">项目不存在或已被删除</p>
        <p className="text-xs text-[var(--ink-subtle)] mt-1">项目编号：{projectId}</p>
      </div>
    );
  }

  const typeCfg = getProjectTypeConfig(entry.projectType);
  const today = todayStr();

  // Key dates from service period + keyDates array + store timeline future events
  const keyDateItems: { label: string; date: string }[] = [];
  if (entry.servicePeriod.end) {
    keyDateItems.push({ label: '服务到期', date: entry.servicePeriod.end });
  }
  for (const kd of entry.keyDates) {
    if (kd.date && kd.date >= today) keyDateItems.push({ label: kd.label, date: kd.date });
  }
  for (const e of timelineEvents) {
    if (e.caseId === projectId && (e.status === 'pending' || e.status === 'upcoming') && e.date >= today) {
      keyDateItems.push({ label: e.label, date: e.date });
    }
  }
  // Dedup by label+date, then sort ascending.
  const seen = new Set<string>();
  const unique = keyDateItems.filter(k => { const k2 = `${k.label}|${k.date}`; if (seen.has(k2)) return false; seen.add(k2); return true; });
  unique.sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="h-full bg-[var(--paper)] overflow-y-auto">
      <div className="max-w-6xl mx-auto px-8 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className={`px-2.5 py-0.5 rounded-md text-xs font-semibold ${typeCfg.color} tracking-wide`}>
                {typeCfg.label}
              </span>
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                entry.status === 'active' ? 'bg-emerald-50 text-emerald-600' :
                entry.status === 'closed' ? 'bg-gray-100 text-gray-500' :
                'bg-amber-50 text-amber-600'
              }`}>
                {entry.status === 'active' ? '进行中' : entry.status === 'closed' ? '已结束' : '暂停'}
              </span>
              {entry.archived && <span className="px-2 py-0.5 rounded text-xs font-medium bg-[var(--paper-inset)] text-[var(--ink-muted)]">已归档</span>}
            </div>
            <p className="text-sm font-mono text-[var(--ink-muted)] tracking-wider mb-1">{entry.projectId}</p>
            <h1 className="text-3xl font-extrabold text-[var(--ink)] tracking-[-0.01em] leading-tight">{entry.name}</h1>
          </div>
          <div className="shrink-0 flex items-center gap-2" style={{ marginTop: 48 }}>
            <button onClick={() => updateProject(entry.projectId, p => ({ ...p, archived: !p.archived, updatedAt: new Date().toISOString() }))}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs text-[var(--ink-muted)] bg-[var(--paper-elevated)] border border-[var(--paper-inset)] shadow-sm hover:text-[var(--ink)] hover:border-[var(--ink-subtle)] transition-all">
              {entry.archived ? <><ArchiveRestore size={13} />取消归档</> : <><Archive size={13} />归档</>}
            </button>
            {NONLIT_AGENTS.map(agent => (
              <AgentSessionButton key={agent.key} agent={agent} boundSessions={entry.boundSessions} onOpen={openServiceSession} getArchivedSessionIds={getArchivedSessionIds} />
            ))}
          </div>
        </div>

        {/* Two-column body */}
        <div className="grid grid-cols-[1fr_360px] gap-8">
          {/* Left column */}
          <div className="space-y-5 min-w-0">
            {/* ── 1. 项目基本信息 ── */}
            <section className="rounded-2xl bg-[var(--paper-elevated)] border border-[var(--paper-inset)] p-5 space-y-3">
              <h2 className="text-xs font-semibold tracking-widest uppercase text-[var(--ink-muted)] opacity-60">项目基本信息</h2>
              <div className="grid grid-cols-3 gap-x-6 gap-y-3 text-sm">
                <div>
                  <span className="text-xs text-[var(--ink-muted)]">服务周期</span>
                  <p className="text-[var(--ink)] mt-0.5 font-medium">
                    {entry.servicePeriod.start} ~ {entry.servicePeriod.end}
                    {entry.servicePeriod.end && daysUntil(entry.servicePeriod.end) >= 0 && (
                      <span className="ml-2 text-xs text-amber-500">
                        ({daysUntil(entry.servicePeriod.end)} 天后到期)
                      </span>
                    )}
                    {entry.servicePeriod.end && daysUntil(entry.servicePeriod.end) < 0 && (
                      <span className="ml-2 text-xs text-red-500">
                        (已到期 {Math.abs(daysUntil(entry.servicePeriod.end))} 天)
                      </span>
                    )}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-[var(--ink-muted)]">主办律师</span>
                  <p className="text-[var(--ink)] mt-0.5 font-medium">
                    <Editable field="leadLawyer" value={entry.leadLawyer} placeholder="未设置" />
                  </p>
                </div>
                <div>
                  <span className="text-xs text-[var(--ink-muted)]">合同标的额</span>
                  <p className="text-[var(--ink)] mt-0.5 font-medium">
                    <Editable field="contractAmount" value={entry.contractAmount ? formatAmount(entry.contractAmount) : undefined} placeholder="未设置" />
                  </p>
                </div>
              </div>
              <div className="pt-1 border-t border-[var(--paper-inset)]">
                <span className="text-xs text-[var(--ink-muted)]">标签</span>
                <div className="mt-1">
                  <TagInput
                    value={entry.tags ?? []}
                    onChange={(tags) => updateProject(entry.projectId, p => ({ ...p, tags, updatedAt: new Date().toISOString() }))}
                    suggestions={allTags}
                    presets={TAG_PRESETS}
                    placeholder="添加标签，如 高净值 / 异地 / 系列案…"
                  />
                </div>
              </div>
              {entry.team.length > 0 && (
                <div>
                  <span className="text-xs text-[var(--ink-muted)]">团队</span>
                  <p className="text-[var(--ink)] mt-0.5 font-medium text-sm">{entry.team.join('、')}</p>
                </div>
              )}
              {entry.serviceScope.length > 0 && (
                <div>
                  <span className="text-xs text-[var(--ink-muted)]">服务范围</span>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {entry.serviceScope.map(s => (
                      <span key={s} className="px-2 py-0.5 rounded text-xs font-medium bg-[var(--paper-inset)] text-[var(--ink-muted)]">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <span className="text-xs text-[var(--ink-muted)]">项目文件夹</span>
                {editingFolder ? (
                  <div className="flex flex-col gap-1 mt-1">
                    <input
                      type="text"
                      value={folderDraft}
                      onChange={e => setFolderDraft(e.target.value)}
                      onBlur={saveFolderDraft}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); saveFolderDraft(); }
                        if (e.key === 'Escape') { setEditingFolder(false); }
                      }}
                      placeholder="/绝对路径/项目目录（主机端路径）"
                      className="w-full px-2 py-1.5 rounded-lg bg-[var(--paper)] border border-[var(--paper-inset)] text-xs text-[var(--ink)] outline-none focus:ring-1 focus:ring-blue-400/40"
                    />
                    <span className="text-[11px] text-[var(--ink-subtle)]">目录选择暂不可用时可手动填写主机端路径，回车或失焦保存</span>
                    {folderPickError !== '' && (
                      <span className="text-[11px] text-[var(--error)]">选择失败原因：{folderPickError}</span>
                    )}
                  </div>
                ) : (
                  <p className="text-[var(--ink)] mt-0.5 font-medium truncate text-sm">
                    {entry.folder ? (
                      <>
                        <button onClick={() => { if (isTauriEnvironment()) { import('@tauri-apps/api/core').then(({ invoke }) => invoke('cmd_open_path_external', { fullPath: entry.folder, workspace: entry.folder })); } }}
                          className="flex items-center gap-1 hover:text-[var(--blue)] transition-colors cursor-pointer" title="在 Finder 中打开">
                          <FolderOpen size={12} className="text-[var(--ink-muted)] shrink-0" />{entry.folder.split('/').pop()}
                        </button>
                        <button onClick={handleBindFolder} className="ml-2 text-xs text-[var(--ink-muted)] hover:text-[var(--ink)]">更换</button>
                      </>
                    ) : (
                      <button onClick={handleBindFolder} className="text-[var(--blue)] text-sm">绑定文件夹</button>
                    )}
                  </p>
                )}
              </div>
            </section>

            {/* ── 2. 关键日程（常法项目隐藏） ── */}
            {entry.projectType !== 'retainer' && (
            <section className="rounded-2xl bg-[var(--paper-elevated)] border border-[var(--paper-inset)] p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold tracking-widest uppercase text-[var(--ink-muted)] opacity-60">关键日程</h2>
                <button onClick={() => setAddingEvent(v => !v)}
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs text-[var(--ink-muted)] hover:bg-[var(--paper-inset)] hover:text-[var(--ink)] transition-colors">
                  <Plus size={13} />添加日程
                </button>
              </div>
              {addingEvent && <EventForm defaultStatus="pending" onCancel={() => setAddingEvent(false)} onSubmit={handleAddEvent} />}
              {unique.length === 0 ? (
                <p className="text-xs text-[var(--ink-muted)]">暂无未来日程</p>
              ) : (
                <div className="space-y-2">
                  {unique.slice(0, 5).map((d, i) => {
                    const days = daysUntil(d.date);
                    const urgent = days <= 7;
                    const past = days < 0;
                    return (
                      <div key={`${i}-${d.date}`}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border ${
                          past ? 'bg-gray-50 border-gray-100' :
                          urgent ? 'bg-amber-50 border-amber-100' :
                          'bg-[var(--paper)] border-[var(--paper-inset)]'
                        }`}>
                        {past ? <Clock size={16} className="text-gray-400 shrink-0" /> :
                         urgent ? <Clock size={16} className="text-amber-500 shrink-0" /> :
                         <Calendar size={16} className="text-[var(--ink-muted)] shrink-0" />}
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-semibold ${past ? 'text-gray-400' : urgent ? 'text-amber-700' : 'text-[var(--ink)]'}`}>{d.label}</p>
                          <p className={`text-xs font-mono mt-0.5 ${past ? 'text-gray-300' : urgent ? 'text-amber-500' : 'text-[var(--ink-muted)]'}`}>{d.date}</p>
                        </div>
                        <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-bold ${
                          past ? 'bg-gray-100 text-gray-400' :
                          urgent ? 'bg-amber-100 text-amber-700' :
                          'bg-[var(--paper-inset)] text-[var(--ink-muted)]'
                        }`}>
                          {past ? '已过期' : days === 0 ? '今天' : days === 1 ? '明天' : `${days} 天后`}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
            )}

            {/* ── 3. 任务拆解 ── */}
            <section className="rounded-2xl bg-[var(--paper-elevated)] border border-[var(--paper-inset)] p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-xs font-semibold tracking-widest uppercase text-[var(--ink-muted)] opacity-60">项目任务</h2>
              </div>
              <CaseTaskTree caseId={entry.projectId} taskGroups={entry.taskGroups} isProject />
            </section>


          </div>

          {/* Right column */}
          <div className="min-w-0">
            <div className="sticky top-8 space-y-4">

              {/* ── 项目概况 ── */}
              <div className="rounded-xl bg-[var(--paper-elevated)] border border-[var(--paper-inset)] p-4 space-y-3">
                <h3 className="text-xs font-semibold tracking-widest uppercase text-[var(--ink-muted)] opacity-60">项目概况</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="text-center p-2 rounded-lg bg-[var(--paper)]">
                    <p className="text-xl font-extrabold text-[var(--ink)] tabular-nums">{entry.taskGroups.reduce((n, g) => n + g.tasks.filter(t => t.status !== 'done').length, 0)}</p>
                    <p className="text-xs text-[var(--ink-muted)] mt-0.5">待办</p>
                  </div>
                  <div className="text-center p-2 rounded-lg bg-[var(--paper)]">
                    <p className="text-xl font-extrabold text-emerald-600 tabular-nums">{entry.taskGroups.reduce((n, g) => n + g.tasks.filter(t => t.status === 'done').length, 0)}</p>
                    <p className="text-xs text-[var(--ink-muted)] mt-0.5">已完成</p>
                  </div>
                  <div className="text-center p-2 rounded-lg bg-[var(--paper)]">
                    <p className="text-xl font-extrabold text-red-500 tabular-nums">{entry.taskGroups.reduce((n, g) => n + g.tasks.filter(t => t.status !== 'done' && t.deadline && t.deadline < new Date().toISOString().slice(0, 10)).length, 0)}</p>
                    <p className="text-xs text-[var(--ink-muted)] mt-0.5">逾期</p>
                  </div>
                  <div className="text-center p-2 rounded-lg bg-[var(--paper)]">
                    <p className="text-xl font-extrabold text-[var(--ink)] tabular-nums">{entry.boundSessions.length}</p>
                    <p className="text-xs text-[var(--ink-muted)] mt-0.5">会话</p>
                  </div>
                </div>
              </div>

              {/* ── 服务日志 ── */}
              <div className="rounded-xl bg-[var(--paper-elevated)] border border-[var(--paper-inset)] p-3 max-h-[calc(100vh-280px)] overflow-y-auto">
                <ServiceLog entries={serviceLogEntries} />
              </div>

              {/* ── 服务周期 ── */}
              {entry.servicePeriod.end && (
                <div className="rounded-xl bg-[var(--paper-elevated)] border border-[var(--paper-inset)] p-4 space-y-2">
                  <h3 className="text-xs font-semibold tracking-widest uppercase text-[var(--ink-muted)] opacity-60">服务周期</h3>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-[var(--ink-muted)]">{entry.servicePeriod.start}</span>
                    <span className="text-[var(--ink-muted)]">→</span>
                    <span className="text-[var(--ink)] font-semibold">{entry.servicePeriod.end}</span>
                  </div>
                  {(() => {
                    const days = daysUntil(entry.servicePeriod.end);
                    if (days < 0) return <p className="text-xs text-red-500 font-semibold">已到期 {Math.abs(days)} 天</p>;
                    if (days <= 30) return <p className="text-xs text-amber-600 font-semibold">剩余 {days} 天</p>;
                    return <p className="text-xs text-[var(--ink-muted)]">剩余 {days} 天</p>;
                  })()}
                </div>
              )}

              {/* ── 团队成员 ── */}
              {entry.team.length > 0 && (
                <div className="rounded-xl bg-[var(--paper-elevated)] border border-[var(--paper-inset)] p-4 space-y-2">
                  <h3 className="text-xs font-semibold tracking-widest uppercase text-[var(--ink-muted)] opacity-60">团队成员</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {entry.team.map((m, i) => (
                      <span key={i} className="px-2.5 py-1 rounded-full text-xs font-medium bg-[var(--paper)] text-[var(--ink)] border border-[var(--paper-inset)]">
                        {m}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

      </div>

    </div>
  );
});
