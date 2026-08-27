/**
 * CaseDetailPage — full-page case detail tab (v2.6, detail-v2 redesign).
 *
 * Pure VIEW over the disk-authoritative case registry (no sidecar). Layout:
 *  - Masthead: 类型色点 + 审级签 + 状态 + 操作 / 编号+案名 / 案号·法院 / 我方·对方当事人
 *  - Left column: 案件基本信息(2列) / 当事人信息(角色徽章+我方高亮+案件文件夹+卷宗内容) /
 *    关键日程 / 办案任务
 *  - Right column: 案件概述 / 审级历程(规范时间线) / 办案时间轴
 *  - Footer: 归档
 *
 * 关键日程 and 办案时间轴 are a time-split of the SAME timelineEvents source:
 * future nodes count down in 关键日程; anything past/完成 lands in the timeline.
 * 关联文件夹 = 案件文件夹路径 + 其卷宗目录内容（以案件文件夹为 workspace 根，复用
 * 工作区文件服务：cmd_workspace_dir_tree 只读列举、dir_expand 懒展开、readPreview /
 * downloadFile / FilePreviewModal 点击预览，openWithDefault / openInFinder 打开与定位）。
 */

import { memo, useMemo, useCallback, useState, useEffect, useRef, Suspense } from 'react';
import {
  MessageSquare, FolderOpen, Clock, Calendar, Briefcase, Archive, ArchiveRestore, UserCheck,
  Pencil, Plus, ArrowUp, ArrowDown, Trash2, Eye, ExternalLink, LocateFixed, ChevronDown, ChevronRight,
} from 'lucide-react';
import { isTauriEnvironment } from '@/utils/browserMock';
import { pickDirectoryPath } from '@/utils/directoryPicker';
import { useAgentLex, projectKeyDatesToTimeline } from '@/hooks/useAgentLex';
import type { CaseEntry, TimelineEvent, TimelineEventStatus } from '@/hooks/useAgentLex';
import { getSessions } from '@/api/sessionClient';
import CaseTaskTree from '@/components/agentlex/CaseTaskTree';
import CustomSelect from '@/components/CustomSelect';
import CaseTimeline from '@/components/agentlex/CaseTimeline';
import StatusBadge from '@/components/agentlex/StatusBadge';
import TagInput from '@/components/agentlex/TagInput';
import EventForm, { type EventFormData } from '@/components/agentlex/EventForm';
import InstanceForm, { type InstanceData } from '@/components/agentlex/InstanceForm';
import { getProcedureColor, getProcedureDot } from '@/utils/caseStatus';
import { daysUntil, todayStr, formatAmount, PARTY_ROLE_ZH } from '@/utils/caseFormat';
import { CASE_TYPES, getCaseTypeDot } from '@/utils/caseTypes';
import { TAG_PRESETS } from '@/utils/caseTags';
import { useWorkspaceFileService } from '@/hooks/useWorkspaceFileService';
import { useDshFileService } from '@/hooks/useDshFileService';
import { useImagePreview } from '@/context/ImagePreviewContext';
import { useToastOptional } from '@/components/Toast';
import ContextMenu, { type ContextMenuItem } from '@/components/ContextMenu';
import { getRichDocKind, isImageFile, isPreviewable } from '../../shared/fileTypes';
import type { RichDocKind } from '../../shared/fileTypes';
import FilePreviewModal from '@/components/FilePreviewModal';

interface CaseDetailPageProps {
  caseId: string;
  isActive?: boolean;
  onOpenCaseSession: (caseEntry: CaseEntry, sessionId?: string, intake?: boolean, bindingKey?: string) => void;
  /** Open the bound case folder in the better-sidebar. */
  onOpenCaseFolder?: (folder: string) => void;
  /** Resolves the DSH workspace archive set — archived sessions are hidden
   *  from the historical-session dropdown. */
  getArchivedSessionIds?: () => Promise<Set<string>>;
}

/** Agent descriptor for the case agent type. */
const CASE_AGENTS = [
  { key: 'litigation', label: '诉讼管家', desc: '案件管理、卷宗分析、流程跟踪', Icon: UserCheck },
] as const;

/** 审级节点配色统一走 caseStatus：hex=getProcedureDot（冷色族身份色）、
 *  label=getProcedureColor（中性标签）——不再在本页重复定义（见 2026-08 配色收敛）。 */

/** ourSide 值 → 中文角色（原告/申请人、被告/被申请人 各自独立）。 */
const OUR_SIDE_LABEL: Record<string, string> = {
  plaintiff: '原告',
  applicant: '申请人',
  defendant: '被告',
  respondent: '被申请人',
  appellant: '上诉人',
  appellee: '被上诉人',
  executionApplicant: '申请执行人',
  executionRespondent: '被执行人',
};

/** 我方角色 → 对方角色。 */
const OPPOSITE_ROLE: Record<string, string> = {
  plaintiff: '被告', applicant: '被申请人', defendant: '原告', respondent: '申请人',
  appellant: '被上诉人', appellee: '上诉人',
  executionApplicant: '被执行人', executionRespondent: '申请执行人',
};

/** 当事人角色徽章配色。 */
const ROLE_BADGE: Record<string, string> = {
  '原告': 'bg-[#e6eef6] text-[#3568a0]',
  '申请人': 'bg-[#e6eef6] text-[#3568a0]',
  '申请执行人': 'bg-[#e7f4ea] text-[#2d8a5e]',
  '被告': 'bg-[#fbeaea] text-[#a03838]',
  '被申请人': 'bg-[#fbeaea] text-[#a03838]',
  '被执行人': 'bg-[#fdf3e2] text-[#b7791f]',
  '上诉人': 'bg-[#f3e9f5] text-[#8b4fa0]',
  '被上诉人': 'bg-[#e8eef6] text-[#3f6391]',
  '第三人': 'bg-[var(--paper-inset)] text-[var(--ink-muted)]',
};

const fileKind = (name: string): string => {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return 'PDF';
  if (['doc', 'docx'].includes(ext)) return 'DOC';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'XLS';
  if (['md', 'txt'].includes(ext)) return 'TXT';
  if (['ppt', 'pptx'].includes(ext)) return 'PPT';
  return 'FILE';
};

/** 文件类型徽章：一律中性（2026-08 配色收敛，去掉 PDF/DOC/XLS/PPT 彩虹配色）。 */
const fileKindCls = (k: string): string => ({
  PDF: 'bg-[var(--paper-inset)] text-[var(--ink-muted)]',
  DOC: 'bg-[var(--paper-inset)] text-[var(--ink-muted)]',
  XLS: 'bg-[var(--paper-inset)] text-[var(--ink-muted)]',
  PPT: 'bg-[var(--paper-inset)] text-[var(--ink-muted)]',
  TXT: 'bg-[var(--paper-inset)] text-[var(--ink-muted)]',
  FILE: 'bg-[var(--paper-inset)] text-[var(--ink-muted)]',
}[k] ?? 'bg-[var(--paper-inset)] text-[var(--ink-muted)]');

/** 工作区目录树节点（cmd_workspace_dir_tree 返回，path 相对案件文件夹根）。 */
interface FolderTreeNode {
  id: string;
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: FolderTreeNode[];
  loaded?: boolean;
}
interface FolderTreeResult {
  root: string;
  summary: { totalFiles: number; totalDirs: number };
  tree: FolderTreeNode;
  truncated: boolean;
}

function hasOccurred(e: TimelineEvent): boolean {
  return e.status === 'completed' || e.status === 'cancelled' || e.date < todayStr();
}

/** 当事人角色徽章 + 点击展开角色选择。 */
function RoleBadge({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const role = value || '原告';
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(v => !v)} title="切换角色"
        className={`shrink-0 px-1.5 py-0.5 rounded text-xs font-semibold ${ROLE_BADGE[role] ?? 'bg-[var(--paper-inset)] text-[var(--ink-muted)]'}`}>
        {role}
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-40 w-28 bg-[var(--paper-elevated)] border border-[var(--paper-inset)] rounded-lg shadow-lg py-0.5">
          {PARTY_ROLE_ZH.map(r => (
            <button key={r} onClick={() => { onChange(r); setOpen(false); }}
              className={`w-full text-left px-2.5 py-1.5 text-xs ${r === role ? 'text-[var(--ink)] font-semibold' : 'text-[var(--ink-muted)] hover:bg-[var(--paper-inset)]'}`}>{r}</button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Inline sub-component: an agent session button with its own bound-sessions
 * picker dropdown. Each agent type shows only sessions whose agentKey matches.
 * Sessions archived in the DSH workspace (归档会话) are hidden — the archive
 * set is refreshed every time the dropdown opens.
 */
function AgentSessionButton({
  agent,
  boundSessions,
  onOpen,
  getArchivedSessionIds,
}: {
  agent: typeof CASE_AGENTS[number];
  boundSessions: CaseEntry['boundSessions'];
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
    (s.agentKey ?? 'litigation') === agent.key && !archivedIds.has(s.sessionId));

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

export default memo(function CaseDetailPage({ caseId, isActive: _isActive, onOpenCaseSession, onOpenCaseFolder, getArchivedSessionIds }: CaseDetailPageProps) {
  const { cases, projects, timelineEvents, updateCase, pruneStaleSessions, addTimelineEvent, updateTimelineEvent, deleteTimelineEvent, toggleTimelineEvent } = useAgentLex();
  const entry = cases.find(c => c.caseId === caseId) ?? null;

  // Treat the bound case folder as a workspace root — same file-service surface
  // the chat workspace sidebar uses, so preview/open/reveal behave identically.
  // In DSH web mode there is no Tauri runtime, so fall back to the DSH adapter's
  // Node-backed folder routes.
  const tauriFileService = useWorkspaceFileService(entry?.folder ?? null);
  const dshFileService = useDshFileService(entry?.folder ?? null);
  const fileService = isTauriEnvironment() ? tauriFileService : dshFileService;
  const { openPreview: openImagePreview } = useImagePreview();
  const toast = useToastOptional();

  // Direct reactive handler: when ANY session is deleted, immediately remove it
  // from this case's boundSessions so the UI button updates in real time.
  useEffect(() => {
    if (!entry) return;
    const handler = (e: Event) => {
      const { sessionId } = (e as CustomEvent).detail;
      if (entry.boundSessions.some(bs => bs.sessionId === sessionId)) {
        updateCase(caseId, c => ({
          ...c, boundSessions: c.boundSessions.filter(bs => bs.sessionId !== sessionId),
        }));
      }
    };
    window.addEventListener('agentlex:session-deleted', handler);
    return () => window.removeEventListener('agentlex:session-deleted', handler);
  }, [entry, caseId, updateCase]);

  // On mount + focus: full stale-session prune.
  useEffect(() => {
    const check = () => {
      getSessions().then(all => {
        const valid = new Set(all.map(s => s.id));
        pruneStaleSessions(valid);
      }).catch(() => {});
    };
    check();
    window.addEventListener('focus', check);
    return () => window.removeEventListener('focus', check);
  }, [pruneStaleSessions]);

  const caseTimeline = useMemo<TimelineEvent[]>(() => {
    if (!entry) return [];
    const own = timelineEvents.filter(e => e.caseId === caseId);
    return own.length ? own : projectKeyDatesToTimeline(entry);
  }, [entry, timelineEvents, caseId]);

  // Time-split: 未来节点 → 关键日程; 已发生 → 办案时间轴.
  const upcomingDates = useMemo(() => caseTimeline
    .filter(e => (e.status === 'pending' || e.status === 'upcoming') && e.date >= todayStr())
    .sort((a, b) => a.date.localeCompare(b.date)), [caseTimeline]);
  const occurredEvents = useMemo(() => caseTimeline.filter(hasOccurred), [caseTimeline]);

  // Aggregate tag pool across all cases (TagInput suggestions).
  const allTags = useMemo(() => [...new Set(cases.flatMap(c => c.tags ?? []))].sort((a, b) => a.localeCompare(b)), [cases]);

  // 常年顾问单位候选：对接非诉模块的常法（retainer）项目名，可下拉选择或手填。
  const retainerUnitCandidates = useMemo(() => {
    const set = new Set<string>();
    for (const p of projects) {
      if (p.projectType === 'retainer' && p.name.trim()) set.add(p.name.trim());
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [projects]);

  // 绑定/更换卷宗文件夹：优先弹 DSH 原生目录选择框（web 经插件 client 桥 /
  // workspaces.pickDirectory，桌面端 Tauri 对话框）；取消或环境不可用时
  // 进入内联手填模式（在输入框填写主机端路径，回车/失焦保存）。
  const [editingFolder, setEditingFolder] = useState(false);
  const [folderDraft, setFolderDraft] = useState('');
  const [folderPickError, setFolderPickError] = useState('');
  const handleBindFolder = useCallback(async () => {
    if (!entry) return;
    try {
      const selected = await pickDirectoryPath('选择案件文件夹', entry.folder ?? '');
      if (selected && typeof selected === 'string') {
        updateCase(entry.caseId, c => ({ ...c, folder: selected, updatedAt: new Date().toISOString() }));
        setEditingFolder(false);
        setFolderPickError('');
      } else {
        // 取消/选择器不可用 → 内联手填（不弹无意义的报错 toast）
        setFolderPickError(typeof window !== 'undefined' ? (window.__agentlexPickLastError ?? '') : '');
        setFolderDraft(entry.folder ?? '');
        setEditingFolder(true);
      }
    } catch (e) {
      console.warn('[CaseDetailPage] Folder picker:', e);
      setFolderPickError(e instanceof Error ? e.message : String(e));
      setFolderDraft(entry.folder ?? '');
      setEditingFolder(true);
    }
  }, [entry, updateCase]);
  const saveFolderDraft = useCallback(() => {
    if (!entry || !editingFolder) return;
    const value = folderDraft.trim();
    setEditingFolder(false);
    if (value === (entry.folder ?? '')) return;
    updateCase(entry.caseId, c => ({ ...c, folder: value, updatedAt: new Date().toISOString() }));
  }, [entry, editingFolder, folderDraft, updateCase]);
  const folderEditRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editingFolder) folderEditRef.current?.focus();
  }, [editingFolder]);

  const [editingSummary, setEditingSummary] = useState(false);
  const [summaryDraft, setSummaryDraft] = useState('');
  const [editingField, setEditingField] = useState<string | null>(null);
  const [fieldDraft, setFieldDraft] = useState('');
  // 顾问单位：两段式编辑（先选候选，选不到再手填）。retainerManual=true 时为手填输入。
  const [retainerManual, setRetainerManual] = useState(false);
  const retainerEditorRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (editingField !== 'retainerUnit' || retainerManual) return;
    const h = (e: MouseEvent) => { if (retainerEditorRef.current && !retainerEditorRef.current.contains(e.target as Node)) setEditingField(null); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [editingField, retainerManual]);
  // Event / instance editing state
  const [addingEvent, setAddingEvent] = useState(false);
  const [editingEvent, setEditingEvent] = useState<TimelineEvent | null>(null);
  const [editingInstance, setEditingInstance] = useState<{ index: number; data: InstanceData } | null>(null);
  const [addingInstance, setAddingInstance] = useState(false);
  const [deleteEventId, setDeleteEventId] = useState<string | null>(null);

  // ── 案件文件夹内容（复用工作区目录树命令，只读列举） ──
  const [folderTree, setFolderTree] = useState<FolderTreeResult | null>(null);
  const [folderTreeError, setFolderTreeError] = useState(false);
  // Lazy-expanded subdir children (path → children) + user-expanded dir paths
  // （默认折叠：子文件夹需点击展开）。
  const [dirChildren, setDirChildren] = useState<Record<string, FolderTreeNode[]>>({});
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    const f = entry?.folder?.trim() ?? '';
    setFolderTree(null);
    setFolderTreeError(false);
    setDirChildren({});
    setExpandedDirs(new Set());
    setPreviewFile(null);
    setFileMenu(null);
    if (f && fileService.isAvailable) {
      fileService.dirTree()
        .then(res => { if (!cancelled) setFolderTree(res); })
        .catch(() => { if (!cancelled) { setFolderTree(null); setFolderTreeError(true); } });
    }
    return () => { cancelled = true; };
  }, [entry?.folder]);

  // In-app file preview (mirrors the chat workspace sidebar's preview modal).
  const [previewFile, setPreviewFile] = useState<{
    name: string; content: string; size: number; path: string;
    richDocKind?: RichDocKind; isLoading: boolean; error: string | null;
  } | null>(null);
  // Right-click menu on a file row.
  const [fileMenu, setFileMenu] = useState<{ x: number; y: number; node: FolderTreeNode } | null>(null);

  // ── 案件文件夹操作（复用工作区文件服务，与会话工作区边栏同源） ──
  /** Open the bound folder itself in the OS file manager. */
  const openFolderInFinder = useCallback(() => {
    if (!fileService.isAvailable) return;
    fileService.openWithDefault({ path: '' }).catch((err) => {
      console.error('[CaseDetailPage] open folder in finder:', err);
      toast?.error('无法在 Finder 中打开该文件夹');
    });
  }, [fileService, toast]);

  /** Primary action on a file: preview in-app when possible, else open externally. */
  const openFolderFile = useCallback((node: FolderTreeNode) => {
    if (!fileService.isAvailable) return;
    const relPath = node.path;
    const name = node.name;
    const richDocKind = getRichDocKind(name);
    void (async () => {
      try {
        if (richDocKind) {
          // Rich viewers (pdf/docx/xlsx/pptx) fetch bytes themselves via workspacePath+path.
          setPreviewFile({ name, content: '', size: 0, path: relPath, richDocKind, isLoading: true, error: null });
          return;
        }
        if (isImageFile(name)) {
          const resp = await fileService.downloadFile({ path: relPath });
          openImagePreview(`data:${resp.mimeType};base64,${resp.data}`, resp.name || name);
          return;
        }
        if (isPreviewable(name)) {
          setPreviewFile({ name, content: '', size: 0, path: relPath, isLoading: true, error: null });
          const resp = await fileService.readPreview({ path: relPath });
          setPreviewFile(prev => prev && prev.path === relPath
            ? { ...prev, content: resp.content, size: resp.size, name: resp.name, isLoading: false }
            : prev);
          return;
        }
        // Binary / unsupported → hand off to the OS default app.
        await fileService.openWithDefault({ path: relPath });
      } catch (err) {
        console.error('[CaseDetailPage] open folder file failed:', err);
        setPreviewFile(prev => prev && prev.path === relPath
          ? { ...prev, isLoading: false, error: err instanceof Error ? err.message : '打开文件失败' }
          : prev);
      }
    })();
  }, [fileService, openImagePreview]);

  const openFileExternal = useCallback((node: FolderTreeNode) => {
    if (!fileService.isAvailable) return;
    fileService.openWithDefault({ path: node.path }).catch((err) => {
      console.error('[CaseDetailPage] open file external:', err);
      toast?.error('无法用默认应用打开该文件');
    });
  }, [fileService, toast]);

  const revealFileInFinder = useCallback((node: FolderTreeNode) => {
    if (!fileService.isAvailable) return;
    fileService.openInFinder({ path: node.path }).catch((err) => {
      console.error('[CaseDetailPage] reveal file:', err);
      toast?.error('无法在 Finder 中显示该文件');
    });
  }, [fileService, toast]);

  /** Directory click: lazily fetch truncated dirs, otherwise expand/collapse. */
  const toggleDir = useCallback((node: FolderTreeNode) => {
    if (!fileService.isAvailable) return;
    const path = node.path;
    if (node.loaded === false && !dirChildren[path]) {
      fileService.dirExpand({ path })
        .then((res) => setDirChildren(prev => ({ ...prev, [path]: res.children })))
        .catch((e) => console.warn('[CaseDetailPage] expand dir:', e));
      return;
    }
    setExpandedDirs(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }, [fileService, dirChildren]);

  const buildFileMenuItems = useCallback((node: FolderTreeNode): ContextMenuItem[] => {
    const previewable = isPreviewable(node.name) || isImageFile(node.name) || !!getRichDocKind(node.name);
    return [
      { label: '预览', icon: <Eye size={13} />, disabled: !previewable, onClick: () => { setFileMenu(null); openFolderFile(node); } },
      { label: '用默认应用打开', icon: <ExternalLink size={13} />, onClick: () => { setFileMenu(null); openFileExternal(node); } },
      { label: '在 Finder 中显示', icon: <LocateFixed size={13} />, onClick: () => { setFileMenu(null); revealFileInFinder(node); } },
    ];
  }, [openFolderFile, openFileExternal, revealFileInFinder]);

  const openManagerSession = useCallback((sessionId?: string) => {
    onOpenCaseSession(entry!, sessionId, false, 'litigation');
  }, [entry, onOpenCaseSession]);

  const startEditField = (field: string, value: string) => { setEditingField(field); setFieldDraft(value); };
  const saveField = (field: string, draftOverride?: string) => {
    if (!entry || editingField !== field) return;
    const draft = draftOverride ?? fieldDraft;
    if (field === 'plaintiff' || field === 'defendant') {
      updateCase(entry.caseId, c => ({ ...c, parties: { ...c.parties, [field]: draft }, updatedAt: new Date().toISOString() }));
    } else if (field === 'ourSide') {
      // 被申请人 ⊃ 申请人、被上诉人 ⊃ 上诉人，须先匹配长的再匹配短的。
      const mapped = draft.includes('原告') ? 'plaintiff'
        : draft.includes('申请执行人') ? 'executionApplicant'
        : draft.includes('被执行人') ? 'executionRespondent'
        : draft.includes('被申请人') ? 'respondent'
        : draft.includes('申请人') ? 'applicant'
        : draft.includes('被告') ? 'defendant'
        : draft.includes('被上诉人') ? 'appellee'
        : draft.includes('上诉人') ? 'appellant'
        : 'unknown';
      updateCase(entry.caseId, c => ({ ...c, parties: { ...c.parties, ourSide: mapped }, updatedAt: new Date().toISOString() }));
    } else {
      updateCase(entry.caseId, c => ({ ...c, [field]: draft, updatedAt: new Date().toISOString() }));
    }
    setEditingField(null);
  };
  const safeStr = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (typeof v === 'object') return '';
    return String(v);
  };

  /**
   * Inline editable field, rendered as a plain function (NOT a JSX component).
   * Defining a component inside the page body makes React treat it as a NEW
   * type every render → the <input> unmounts/remounts on each keystroke, which
   * drops IME composition mid-word (Chinese pinyin commits as raw garbage like
   * "qqiqiaqiang…") and loses focus (fields become hard to edit). A render
   * function keeps the <input> element stable across renders.
   */
  const renderEditable = ({ field, value, placeholder = '—', options }: { field: string; value?: string; placeholder?: string; options?: string[] }) => {
    const display = safeStr(value);
    if (editingField === field) {
      if (options) {
        return (
          <CustomSelect
            value={fieldDraft}
            options={options.map(o => ({ value: o, label: o }))}
            onChange={v => { setFieldDraft(v); saveField(field, v); }}
            size="sm"
            className="w-full"
          />
        );
      }
      return (
        <input type="text" value={fieldDraft} onChange={e => setFieldDraft(e.target.value)}
          onBlur={() => saveField(field)}
          onKeyDown={e => {
            // IME: Enter during composition confirms the pinyin candidate, NOT
            // a field commit. Save only on a real Enter; keyCode 229 is the
            // legacy isComposing signal for older IMEs.
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) saveField(field);
            if (e.key === 'Escape') setEditingField(null);
          }}
          className="w-full px-2 py-0.5 -mx-2 rounded bg-[var(--paper-inset)] text-sm text-[var(--ink)] outline-none ring-1 ring-[var(--ink-subtle)]" autoFocus />
      );
    }
    return (
      <span onClick={() => startEditField(field, display)}
        className="group/editable cursor-pointer hover:bg-[var(--paper-inset)] px-2 py-0.5 -mx-2 rounded transition-colors block">
        {display || placeholder}
        <Pencil size={9} className="inline ml-1 mb-0.5 text-[var(--ink-subtle)] opacity-0 group-hover/editable:opacity-100 transition-opacity" />
      </span>
    );
  };

  // ── Parties management ──
  const updateParties = useCallback((details: CaseEntry['parties']['details']) => {
    if (!entry) return;
    updateCase(entry.caseId, c => ({ ...c, parties: { ...c.parties, details }, updatedAt: new Date().toISOString() }));
  }, [entry, updateCase]);
  const updateParty = (i: number, patch: Partial<CaseEntry['parties']['details'][number]>) =>
    updateParties(entry!.parties.details.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const addParty = () => updateParties([...entry!.parties.details, { name: '', role: '原告' }]);
  const removeParty = (i: number) => updateParties(entry!.parties.details.filter((_, j) => j !== i));
  const moveParty = (i: number, dir: -1 | 1) => {
    const arr = [...entry!.parties.details];
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    updateParties(arr);
  };

  // ── Event CRUD ──
  const handleAddEvent = useCallback((d: EventFormData) => {
    if (!entry) return;
    const now = new Date().toISOString();
    addTimelineEvent({
      id: '', caseId, caseName: entry.name, type: d.type,
      label: d.label, date: d.date, time: d.time, source: 'manual',
      status: d.status, remindRules: d.remindDays ? [{ type: 'before_event', minutes: d.remindDays * 1440, enabled: true }] : [],
      createdAt: now, createdBy: '用户', updatedAt: now,
    });
    setAddingEvent(false);
  }, [entry, caseId, addTimelineEvent]);
  const handleSaveEvent = useCallback((d: EventFormData) => {
    if (!editingEvent) return;
    updateTimelineEvent(editingEvent.id, e => ({
      ...e, label: d.label, date: d.date, time: d.time, type: d.type,
      remindRules: d.remindDays ? [{ type: 'before_event', minutes: d.remindDays * 1440, enabled: true }] : e.remindRules,
      updatedAt: new Date().toISOString(),
    }));
    setEditingEvent(null);
  }, [editingEvent, updateTimelineEvent]);

  // ── Instance management ──
  const handleSaveInstance = useCallback((d: InstanceData) => {
    if (!entry) return;
    if (editingInstance) {
      updateCase(entry.caseId, c => ({ ...c, instances: (c.instances ?? []).map((inst, i) => i === editingInstance.index ? d : inst), updatedAt: new Date().toISOString() }));
    } else {
      updateCase(entry.caseId, c => ({ ...c, instances: [...(c.instances ?? []), d], updatedAt: new Date().toISOString() }));
    }
    setEditingInstance(null);
    setAddingInstance(false);
  }, [entry, editingInstance, updateCase]);
  const handleDeleteInstance = useCallback(() => {
    if (!entry || !editingInstance) return;
    updateCase(entry.caseId, c => ({ ...c, instances: (c.instances ?? []).filter((_, i) => i !== editingInstance.index), updatedAt: new Date().toISOString() }));
    setEditingInstance(null);
  }, [entry, editingInstance, updateCase]);

  if (!entry) {
    return (
      <div className="h-full bg-[var(--paper)] flex flex-col items-center justify-center text-center">
        <Briefcase size={36} className="mb-3 text-[var(--ink-subtle)]" />
        <p className="text-sm text-[var(--ink-muted)]">案件不存在或已被删除</p>
        <p className="text-xs text-[var(--ink-subtle)] mt-1">案件编号：{caseId}</p>
      </div>
    );
  }

  const sectionTitle = 'text-xs font-semibold tracking-widest uppercase text-[var(--ink-muted)] opacity-60';

  // ── Masthead 计算 ──
  const caseIdDash = entry.caseId.indexOf('-');
  const idHead = caseIdDash > 0 ? entry.caseId.slice(0, caseIdDash + 1) : '';
  const idTail = caseIdDash > 0 ? entry.caseId.slice(caseIdDash + 1) : entry.caseId;
  const ourRole = OUR_SIDE_LABEL[entry.parties.ourSide] ?? '';
  const oppositeRole = OPPOSITE_ROLE[entry.parties.ourSide] ?? '';
  const ourSideName = ourRole
    ? (entry.parties.details.find(p => p.role === ourRole)?.name
      ?? (entry.parties.ourSide === 'plaintiff' ? entry.parties.plaintiff
        : entry.parties.ourSide === 'defendant' ? entry.parties.defendant : ''))
    : '';
  const oppositeName = oppositeRole ? (entry.parties.details.find(p => p.role === oppositeRole)?.name ?? '') : '';

  // ── 案件文件夹目录树渲染 ──
  const folderChildren = folderTree?.tree?.children ?? [];
  const folderCount = folderTree ? folderTree.summary.totalFiles + folderTree.summary.totalDirs : 0;
  const renderDirNodes = (nodes: FolderTreeNode[], depth: number): React.ReactNode =>
    nodes.map(n => {
      const isDir = n.type === 'dir';
      const kind = fileKind(n.name);
      const folderRoot = entry?.folder ?? '';
      const fullPath = n.path ? `${folderRoot}/${n.path}` : folderRoot;
      if (isDir) {
        const isTruncated = n.loaded === false;
        const hasFetched = !!dirChildren[n.path];
        // 子文件夹默认折叠；懒加载取回的目录直接视为展开。
        const expanded = hasFetched || expandedDirs.has(n.path);
        const children = hasFetched ? dirChildren[n.path] : (n.children ?? []);
        return (
          <div key={n.id}>
            <button onClick={() => toggleDir(n)} title={fullPath}
              className="w-full flex items-center gap-1.5 py-1 px-1 rounded hover:bg-[var(--paper-elevated)] text-left"
              style={{ paddingLeft: 6 + depth * 14 }}>
              {expanded
                ? <ChevronDown size={12} className="text-[var(--ink-subtle)] shrink-0" />
                : <ChevronRight size={12} className="text-[var(--ink-subtle)] shrink-0" />}
              <FolderOpen size={12} className="text-[var(--ink-muted)] shrink-0" />
              <span className="truncate font-medium text-[var(--ink)]">{n.name}</span>
              {isTruncated && !hasFetched && <span className="shrink-0 text-xs text-[var(--ink-subtle)]">…</span>}
            </button>
            {expanded && children.length > 0 && renderDirNodes(children, depth + 1)}
          </div>
        );
      }
      return (
        <div key={n.id}>
          <button onClick={() => openFolderFile(n)}
            onContextMenu={(e) => { e.preventDefault(); setFileMenu({ x: e.clientX, y: e.clientY, node: n }); }}
            title={fullPath}
            className="w-full flex items-center gap-1.5 py-1 px-1 rounded hover:bg-[var(--paper-elevated)] text-left cursor-pointer"
            style={{ paddingLeft: 6 + depth * 14 }}>
            <span className={`shrink-0 min-w-8 text-center text-xs font-bold px-1 py-0.5 rounded ${fileKindCls(kind)}`}>{kind}</span>
            <span className="truncate text-[var(--ink-muted)]">{n.name}</span>
          </button>
        </div>
      );
    });

  return (
    <div className="h-full bg-[var(--paper)] overflow-y-auto">
      <div className="max-w-6xl mx-auto px-8 py-7 space-y-6">

        {/* ═══ Masthead ═══ */}
        <header>
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--ink-muted)]">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: getCaseTypeDot(entry.type) }} aria-hidden />
              {entry.type}
            </span>
            {entry.level && <span className={`px-2 py-0.5 rounded text-xs font-semibold ${getProcedureColor(entry.level)}`}>{entry.level}</span>}
            {entry.archived && <span className="px-2 py-0.5 rounded text-xs font-medium bg-[var(--paper-inset)] text-[var(--ink-muted)]">已归档</span>}
            <span className="flex-1" />
            <StatusBadge status={entry.status} editable onChange={(s) => updateCase(entry.caseId, c => ({ ...c, status: s, updatedAt: new Date().toISOString() }))} />
            <AgentSessionButton agent={CASE_AGENTS[0]} boundSessions={entry.boundSessions} onOpen={openManagerSession} getArchivedSessionIds={getArchivedSessionIds} />
          </div>

          <div className="flex items-baseline gap-3 mt-4 flex-wrap">
            <span className="font-mono text-lg font-bold tracking-[0.02em] text-[var(--ink-subtle)]">{idHead}<b className="text-[var(--ink)]">{idTail}</b></span>
            <h1 className="text-3xl font-extrabold text-[var(--ink)] tracking-[-0.01em] leading-tight">{entry.name}</h1>
          </div>

          <div className="flex items-center gap-2 mt-2 text-sm text-[var(--ink-muted)] flex-wrap">
            {renderEditable({ field: 'caseNumber', value: entry.caseNumber, placeholder: '添加案号' })}
            {/* 身份行的法院是只读展示；编辑入口在「案件基本信息」的审理法院（同一字段
                field 若在两处都可编辑，editingField 会把两处同时切输入框、autoFocus 抢焦点）。 */}
            {entry.court ? <><span className="text-[var(--ink-subtle)]">·</span><span>{entry.court}</span></> : null}
          </div>

          {(ourRole || oppositeRole) && (
            <div className="flex items-center gap-2.5 mt-4 text-sm flex-wrap">
              {ourRole && (
                <>
                  <span className={`px-2 py-0.5 rounded text-xs font-semibold ${ROLE_BADGE[ourRole] ?? 'bg-[var(--paper-inset)] text-[var(--ink-muted)]'}`}>{ourRole}</span>
                  <span className="font-semibold text-[var(--ink)]">{ourSideName || '—'}</span>
                </>
              )}
              {(ourRole && oppositeRole) && <span className="text-xs text-[var(--ink-subtle)]">VS</span>}
              {oppositeRole && (
                <>
                  <span className={`px-2 py-0.5 rounded text-xs font-semibold ${ROLE_BADGE[oppositeRole] ?? 'bg-[var(--paper-inset)] text-[var(--ink-muted)]'}`}>{oppositeRole}</span>
                  <span className="text-[var(--ink-muted)]">{oppositeName || '—'}</span>
                </>
              )}
            </div>
          )}
        </header>

        {/* ═══ Body ═══ */}
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(320px,380px)] gap-6">
          {/* 左栏 */}
          <div className="space-y-5 min-w-0">

            {/* ── 1. 案件基本信息 ── */}
            <section className="rounded-2xl bg-[var(--paper-elevated)] border border-[var(--paper-inset)] p-5 space-y-3">
              <h2 className={sectionTitle}>案件基本信息</h2>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div><span className="text-xs text-[var(--ink-subtle)]">案由</span><p className="text-[var(--ink)] mt-0.5 font-medium">{renderEditable({ field: 'cause', value: entry.cause })}</p></div>
                <div><span className="text-xs text-[var(--ink-subtle)]">案件类型</span><p className="text-[var(--ink)] mt-0.5 font-medium">{renderEditable({ field: 'type', value: entry.type, options: CASE_TYPES.filter(t => t.key !== '__all').map(t => t.label) })}</p></div>
                <div><span className="text-xs text-[var(--ink-subtle)]">审理法院</span><p className="text-[var(--ink)] mt-0.5 font-medium">{renderEditable({ field: 'court', value: entry.court })}</p></div>
                <div><span className="text-xs text-[var(--ink-subtle)]">承办法官</span><p className="text-[var(--ink)] mt-0.5 font-medium">{renderEditable({ field: 'judge', value: entry.judge })}</p></div>
                <div><span className="text-xs text-[var(--ink-subtle)]">立案日期</span><p className="text-[var(--ink)] mt-0.5 font-medium">{renderEditable({ field: 'filingDate', value: entry.filingDate, placeholder: '未设置' })}</p></div>
                <div><span className="text-xs text-[var(--ink-subtle)]">诉讼标的</span><p className="text-[var(--ink)] mt-0.5 font-medium">{renderEditable({ field: 'claimAmount', value: entry.claimAmount ? formatAmount(entry.claimAmount) : undefined })}</p></div>
                <div><span className="text-xs text-[var(--ink-subtle)]">收费金额</span><p className="text-[var(--ink)] mt-0.5 font-medium">{renderEditable({ field: 'fee', value: entry.fee ? formatAmount(entry.fee) : undefined, placeholder: '未填写' })}</p></div>
                <div>
                  <span className="text-xs text-[var(--ink-subtle)]">顾问单位</span>
                  <p className="text-[var(--ink)] mt-0.5 font-medium">
                    {editingField === 'retainerUnit' ? (
                      retainerManual ? (
                        <input type="text" value={fieldDraft} onChange={e => setFieldDraft(e.target.value)}
                          onBlur={() => saveField('retainerUnit')}
                          onKeyDown={e => {
                            if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) saveField('retainerUnit');
                            if (e.key === 'Escape') setEditingField(null);
                          }}
                          className="w-full px-2 py-0.5 -mx-2 rounded bg-[var(--paper-inset)] text-sm text-[var(--ink)] outline-none ring-1 ring-[var(--ink-subtle)]" autoFocus />
                      ) : (
                        /* 两段式：先列非诉常法项目候选，选不到再「手动填写」。 */
                        <span className="relative block" ref={retainerEditorRef}>
                          <span className="absolute top-full left-0 mt-1 z-40 w-64 bg-[var(--paper-elevated)] border border-[var(--paper-inset)] rounded-lg shadow-lg py-1 overflow-hidden">
                            {retainerUnitCandidates.length === 0 ? (
                              <div className="px-2.5 py-1.5 text-xs text-[var(--ink-subtle)]">无常法项目，可直接手填</div>
                            ) : (
                              <div className="max-h-52 overflow-y-auto">
                                {retainerUnitCandidates.map(c => (
                                  <button key={c} onClick={() => saveField('retainerUnit', c)}
                                    className="w-full text-left px-2.5 py-1.5 text-xs text-[var(--ink)] hover:bg-[var(--paper-inset)] truncate">{c}</button>
                                ))}
                              </div>
                            )}
                            <button onClick={() => setRetainerManual(true)}
                              className="w-full text-left px-2.5 py-1.5 text-xs font-medium text-[var(--ink)] border-t border-[var(--paper-inset)] hover:bg-[var(--paper-inset)]">＋ 手动填写…</button>
                          </span>
                        </span>
                      )
                    ) : (
                      <span onClick={() => { startEditField('retainerUnit', entry.retainerUnit ?? ''); setRetainerManual(false); }}
                        className="group/editable cursor-pointer hover:bg-[var(--paper-inset)] px-2 py-0.5 -mx-2 rounded transition-colors block">
                        {entry.retainerUnit || '非顾问 / 选择或手填'}
                        <Pencil size={9} className="inline ml-1 mb-0.5 text-[var(--ink-subtle)] opacity-0 group-hover/editable:opacity-100 transition-opacity" />
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <div className="pt-1 border-t border-[var(--paper-inset)]">
                <span className="text-xs text-[var(--ink-muted)]">标签</span>
                <div className="mt-1">
                  <TagInput
                    value={entry.tags ?? []}
                    onChange={(tags) => updateCase(entry.caseId, c => ({ ...c, tags, updatedAt: new Date().toISOString() }))}
                    suggestions={allTags}
                    presets={TAG_PRESETS}
                    placeholder="添加标签，如 高净值 / 异地 / 系列案…"
                  />
                </div>
              </div>
            </section>

            {/* ── 2. 当事人信息 ── */}
            <section className="rounded-2xl bg-[var(--paper-elevated)] border border-[var(--paper-inset)] p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className={sectionTitle}>当事人信息</h2>
                <span className="text-xs text-[var(--ink-muted)]">我方：
                  {renderEditable({ field: 'ourSide', value: OUR_SIDE_LABEL[entry.parties.ourSide], options: ['原告', '申请人', '被告', '被申请人', '上诉人', '被上诉人', '申请执行人', '被执行人', '待确认'], placeholder: '待确认' })}
                </span>
              </div>
              <div className="space-y-1.5">
                {entry.parties.details.map((p, i) => {
                  const role = safeStr(p.role) || '原告';
                  const isOur = role === ourRole;
                  return (
                    <div key={i} className={`flex items-center gap-2 rounded-lg border p-2 ${isOur ? 'border-[var(--ink-subtle)]/40' : 'border-[var(--paper-inset)]'}`} style={isOur ? { background: 'var(--hover-bg)' } : undefined}>
                      <RoleBadge value={role} onChange={v => updateParty(i, { role: v })} />
                      {isOur && <span className="shrink-0 text-xs font-bold text-[var(--accent)]">我方</span>}
                      <input type="text" value={safeStr(p.name)} onChange={e => updateParty(i, { name: e.target.value })}
                        placeholder="姓名/名称" className="flex-1 min-w-0 bg-transparent outline-none text-sm text-[var(--ink)] placeholder:text-[var(--ink-subtle)]" />
                      <input type="text" value={safeStr(p.firm)} onChange={e => updateParty(i, { firm: e.target.value })}
                        placeholder="律所/单位" className="w-24 bg-transparent outline-none text-xs text-[var(--ink-muted)] placeholder:text-[var(--ink-subtle)] hidden lg:block" />
                      <input type="text" value={safeStr(p.phone)} onChange={e => updateParty(i, { phone: e.target.value })}
                        placeholder="电话" className="w-24 bg-transparent outline-none text-xs text-[var(--ink-muted)] placeholder:text-[var(--ink-subtle)]" />
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button onClick={() => moveParty(i, -1)} disabled={i === 0} className="p-0.5 rounded text-[var(--ink-subtle)] hover:text-[var(--ink)] disabled:opacity-30"><ArrowUp size={12} /></button>
                        <button onClick={() => moveParty(i, 1)} disabled={i === entry.parties.details.length - 1} className="p-0.5 rounded text-[var(--ink-subtle)] hover:text-[var(--ink)] disabled:opacity-30"><ArrowDown size={12} /></button>
                        <button onClick={() => removeParty(i)} className="p-0.5 rounded text-[var(--ink-subtle)] hover:text-red-500"><Trash2 size={12} /></button>
                      </div>
                    </div>
                  );
                })}
                <button onClick={addParty} className="w-full py-1.5 rounded-lg border border-dashed border-[var(--paper-inset)] text-xs text-[var(--ink-muted)] hover:border-[var(--ink-subtle)] hover:text-[var(--ink)] transition-colors">
                  <Plus size={12} className="inline mr-1" />添加当事人
                </button>
              </div>
            </section>

            {/* ── 3. 关键日程（未来节点） ── */}
            <section className="rounded-2xl bg-[var(--paper-elevated)] border border-[var(--paper-inset)] p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className={sectionTitle}>关键日程</h2>
                <button onClick={() => { setEditingEvent(null); setAddingEvent(v => !v); }}
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs text-[var(--ink-muted)] hover:bg-[var(--paper-inset)] hover:text-[var(--ink)] transition-colors">
                  <Plus size={13} />添加日程
                </button>
              </div>
              {addingEvent && (
                <EventForm defaultStatus="pending" onCancel={() => setAddingEvent(false)} onSubmit={handleAddEvent} />
              )}
              {editingEvent && (
                <EventForm
                  initial={editingEvent}
                  defaultStatus={editingEvent.status as TimelineEventStatus}
                  onCancel={() => setEditingEvent(null)}
                  onSubmit={handleSaveEvent}
                />
              )}
              {upcomingDates.length === 0 && !addingEvent ? <p className="text-xs text-[var(--ink-muted)]">暂无未来日程</p> : (
                <div className="space-y-2">
                  {upcomingDates.map(d => {
                    const days = daysUntil(d.date), urgent = days <= 3;
                    return (
                      <div key={`${d.id}-${d.date}`} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border ${urgent ? 'bg-amber-50 border-amber-100' : 'bg-[var(--paper)] border-[var(--paper-inset)]'}`}>
                        {urgent ? <Clock size={16} className="text-amber-500 shrink-0" /> : <Calendar size={16} className="text-[var(--ink-muted)] shrink-0" />}
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-semibold ${urgent ? 'text-amber-700' : 'text-[var(--ink)]'}`}>{d.label}</p>
                          <p className={`text-xs font-mono mt-0.5 ${urgent ? 'text-amber-500' : 'text-[var(--ink-muted)]'}`}>{d.date}{d.time ? ` ${d.time}` : ''}</p>
                        </div>
                        <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-bold ${urgent ? 'bg-amber-100 text-amber-700' : 'bg-[var(--paper-inset)] text-[var(--ink-muted)]'}`}>
                          {days === 0 ? '今天' : days === 1 ? '明天' : `${days} 天后`}
                        </span>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button onClick={() => { setAddingEvent(false); setEditingEvent(d); }} className="p-1 rounded text-[var(--ink-muted)] hover:bg-[var(--paper-inset)]" title="编辑"><Pencil size={12} /></button>
                          <button onClick={() => toggleTimelineEvent(d.id)} className="p-1 rounded text-emerald-500 hover:bg-emerald-50" title="标记完成"><Clock size={12} /></button>
                          <button onClick={() => setDeleteEventId(d.id)} className="p-1 rounded text-[var(--ink-subtle)] hover:text-red-500 hover:bg-red-50" title="删除"><Trash2 size={12} /></button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* ── 4. 任务拆解 ── */}
            <section className="rounded-2xl bg-[var(--paper-elevated)] border border-[var(--paper-inset)] p-5">
              <CaseTaskTree caseId={entry.caseId} taskGroups={entry.taskGroups} />
            </section>
          </div>

          {/* 右栏 */}
          <div className="min-w-0">
            <div className="sticky top-8 space-y-4">

              {/* 案件概述 */}
              <div className="rounded-xl bg-[var(--paper-elevated)] border border-[var(--paper-inset)] p-4">
                <h3 className={sectionTitle} style={{ marginBottom: 8 }}>案件概述</h3>
                {editingSummary ? (
                  <div className="space-y-2">
                    <textarea value={summaryDraft} onChange={e => setSummaryDraft(e.target.value)} maxLength={100}
                      placeholder="案件概述（100字以内）…" rows={3}
                      className="w-full px-3 py-2 rounded-lg bg-[var(--paper-inset)] text-xs text-[var(--ink)] placeholder:text-[var(--ink-subtle)] outline-none resize-none" autoFocus />
                    <div className="flex justify-end gap-1.5">
                      <button onClick={() => { setEditingSummary(false); }} className="px-2 py-1 rounded text-xs text-[var(--ink-muted)] hover:bg-[var(--paper-inset)]">取消</button>
                      <span className="text-xs text-[var(--ink-subtle)]">{summaryDraft.length}/100</span>
                      <button onClick={() => { if (summaryDraft.trim()) { updateCase(entry.caseId, c => ({ ...c, summary: summaryDraft.trim(), updatedAt: new Date().toISOString() })); } setEditingSummary(false); }}
                        className="px-2 py-1 rounded text-xs font-medium bg-[var(--ink)] text-[var(--paper)] hover:opacity-90">保存</button>
                    </div>
                  </div>
                ) : safeStr(entry.summary) ? (
                  <div className="group relative rounded-lg p-2 -mx-1 text-sm text-[var(--ink)] leading-relaxed">
                    {safeStr(entry.summary)}
                    <button onClick={() => { setSummaryDraft(safeStr(entry.summary)); setEditingSummary(true); }}
                      className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded text-xs opacity-0 group-hover:opacity-100 hover:bg-[var(--paper-inset)] text-[var(--ink-muted)] transition-all">编辑</button>
                  </div>
                ) : (
                  <button onClick={() => { setSummaryDraft(''); setEditingSummary(true); }}
                    className="w-full p-2 rounded-xl border border-dashed border-[var(--paper-inset)] text-xs text-[var(--ink-muted)] hover:border-[var(--ink-subtle)] hover:text-[var(--ink)] transition-colors">+ 案件概述</button>
                )}
              </div>

              {/* 审级历程 */}
              <div className="rounded-xl bg-[var(--paper-elevated)] border border-[var(--paper-inset)] p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className={sectionTitle}>审级历程</h3>
                  <button onClick={() => { setEditingInstance(null); setAddingInstance(true); }}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs text-[var(--ink-muted)] hover:bg-[var(--paper-inset)] hover:text-[var(--ink)]">
                    <Plus size={12} />新增
                  </button>
                </div>
                {(entry.instances && entry.instances.length > 0) ? (
                  <div className="relative pl-5">
                    <span className="absolute left-1 top-2 bottom-2 w-[2px] bg-[var(--paper-inset)]" aria-hidden />
                    {[...entry.instances].reverse().map((inst, i, arr) => {
                      const last = i === arr.length - 1;
                      const realIdx = entry.instances!.length - 1 - i;
                      const color = getProcedureDot(inst.level);
                      const cls = getProcedureColor(inst.level);
                      return (
                        <div key={i} className={`relative ${last ? '' : 'pb-4'} group/inst`}>
                          <span className="absolute -left-5 top-1 w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color, boxShadow: `0 0 0 2.5px var(--paper)` }} aria-hidden />
                          <div className="flex items-center gap-2">
                            <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-semibold ${cls}`}>{inst.level}</span>
                            {last && <span className="text-xs font-semibold text-[var(--ink-muted)]">当前</span>}
                            <button onClick={() => setEditingInstance({ index: realIdx, data: inst })}
                              className="ml-auto p-1 rounded text-[var(--ink-subtle)] opacity-0 group-hover/inst:opacity-100 hover:bg-[var(--paper-inset)]" title="编辑">
                              <Pencil size={11} />
                            </button>
                          </div>
                          {inst.caseNo ? <p className="text-xs font-mono text-[var(--ink)] mt-1">{inst.caseNo}</p> : null}
                          {inst.court ? <p className="text-xs text-[var(--ink-muted)] mt-0.5">{inst.court}</p> : null}
                          {(inst.plaintiff || inst.defendant) ? <p className="text-xs text-[var(--ink-muted)] mt-0.5 opacity-70">{inst.plaintiff || '—'} 诉 {inst.defendant || '—'}</p> : null}
                          {inst.result ? <p className="text-xs text-[var(--ink-muted)] mt-0.5 opacity-50">{inst.result}</p> : null}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-[var(--ink-muted)]">暂无审级记录</p>
                )}
              </div>

              {/* 案件文件夹 + 卷宗内容（独立于当事人，置于时间轴上方） */}
              <div className="rounded-xl bg-[var(--paper-elevated)] border border-[var(--paper-inset)] p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className={sectionTitle}>案件文件夹</h3>
                  <div className="flex items-center gap-3">
                    {entry.folder && onOpenCaseFolder && (
                      <button onClick={() => onOpenCaseFolder(entry.folder!)} className="text-xs text-[var(--ink-muted)] hover:text-[var(--ink)]">在侧边栏打开</button>
                    )}
                    {entry.folder && <button onClick={openFolderInFinder} className="text-xs text-[var(--ink-muted)] hover:text-[var(--ink)]">在 Finder 打开</button>}
                    <button onClick={handleBindFolder} className="text-xs text-[var(--ink-muted)] hover:text-[var(--ink)]">{entry.folder ? '更换' : '绑定文件夹'}</button>
                  </div>
                </div>
                {editingFolder ? (
                  <div className="flex flex-col gap-1">
                    <input
                      ref={folderEditRef}
                      type="text"
                      value={folderDraft}
                      onChange={e => setFolderDraft(e.target.value)}
                      onBlur={saveFolderDraft}
                      onKeyDown={e => {
                        if (e.key === 'Enter') { e.preventDefault(); saveFolderDraft(); }
                        if (e.key === 'Escape') { setEditingFolder(false); }
                      }}
                      placeholder="/绝对路径/案件卷宗目录（主机端路径）"
                      className="w-full px-2 py-1.5 rounded-lg bg-[var(--paper)] border border-[var(--paper-inset)] text-xs text-[var(--ink)] outline-none focus:ring-1 focus:ring-blue-400/40"
                    />
                    <span className="text-[11px] text-[var(--ink-subtle)]">目录选择暂不可用时可手动填写主机端路径，回车或失焦保存</span>
                    {folderPickError !== '' && (
                      <span className="text-[11px] text-[var(--error)]">选择失败原因：{folderPickError}</span>
                    )}
                  </div>
                ) : entry.folder ? (
                  <>
                    <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--ink)] min-w-0" title={entry.folder}>
                      <FolderOpen size={13} className="shrink-0 text-[var(--ink-muted)]" />
                      <span className="truncate">{entry.folder.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || entry.folder}</span>
                      {folderTree && <span className="shrink-0 ml-auto font-normal text-[var(--ink-subtle)]">{folderCount} 项</span>}
                    </div>
                    {folderTreeError ? (
                      <p className="text-xs text-[var(--error)]">无法读取文件夹，请确认路径仍存在</p>
                    ) : folderTree === null ? (
                      <p className="text-xs text-[var(--ink-subtle)]">读取文件夹…</p>
                    ) : folderChildren.length === 0 ? (
                      <p className="text-xs text-[var(--ink-subtle)]">（空文件夹）</p>
                    ) : (
                      <div className="rounded-lg bg-[var(--paper-inset)]/40 border border-[var(--paper-inset)] p-1.5 max-h-64 overflow-y-auto text-xs">
                        {renderDirNodes(folderChildren, 0)}
                      </div>
                    )}
                  </>
                ) : (
                  <button onClick={handleBindFolder} className="w-full py-2 rounded-lg border border-dashed border-[var(--paper-inset)] text-xs text-[var(--ink-muted)] hover:text-[var(--ink)]">
                    绑定案件文件夹
                  </button>
                )}
              </div>

              {/* 办案时间轴（历史纪年） */}
              <div className="rounded-xl bg-[var(--paper-elevated)] border border-[var(--paper-inset)] p-4">
                <CaseTimeline
                  events={occurredEvents}
                  onEdit={(e) => setEditingEvent(e)}
                  onDelete={(e) => setDeleteEventId(e.id)}
                />
              </div>
            </div>
          </div>
        </div>

        {/* ═══ 页脚：归档 ═══ */}
        <footer className="flex items-center justify-end gap-2 pt-4 border-t border-[var(--paper-inset)]">
          <button onClick={() => updateCase(entry.caseId, c => ({ ...c, archived: !c.archived, updatedAt: new Date().toISOString() }))}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs text-[var(--ink-muted)] bg-[var(--paper-elevated)] border border-[var(--paper-inset)] hover:text-[var(--ink)] hover:border-[var(--ink-subtle)] transition-all">
            {entry.archived ? <><ArchiveRestore size={13} />取消归档</> : <><Archive size={13} />归档</>}
          </button>
        </footer>
      </div>

      {addingInstance && (
        <InstanceForm onCancel={() => setAddingInstance(false)} onSubmit={handleSaveInstance} />
      )}
      {editingInstance && (
        <InstanceForm
          initial={editingInstance.data}
          onCancel={() => setEditingInstance(null)}
          onSubmit={handleSaveInstance}
          onDelete={handleDeleteInstance}
        />
      )}
      {deleteEventId && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setDeleteEventId(null)} />
          <div className="relative w-full max-w-sm bg-[var(--paper-elevated)] rounded-xl shadow-2xl border border-[var(--paper-inset)] p-5">
            <p className="text-sm text-[var(--ink)] mb-4">确认删除该时间节点？</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setDeleteEventId(null)} className="px-3 py-1.5 rounded-lg text-sm text-[var(--ink-muted)] hover:bg-[var(--paper-inset)]">取消</button>
              <button onClick={() => { if (deleteEventId) void deleteTimelineEvent(deleteEventId); setDeleteEventId(null); }}
                className="px-3 py-1.5 rounded-lg bg-red-500 text-white text-sm font-medium hover:bg-red-600">删除</button>
            </div>
          </div>
        </div>
      )}

      {previewFile && (
        <Suspense fallback={null}>
          <FilePreviewModal
            name={previewFile.name}
            content={previewFile.content}
            size={previewFile.size}
            path={previewFile.path}
            richDocKind={previewFile.richDocKind}
            isLoading={previewFile.isLoading}
            error={previewFile.error}
            workspacePath={entry.folder}
            onClose={() => setPreviewFile(null)}
            onOpenExternal={() => {
              const node = folderTree?.tree?.children?.find((c) => c.path === previewFile.path)
                ?? { path: previewFile.path, name: previewFile.name, type: 'file' as const, id: previewFile.path };
              openFileExternal(node);
            }}
          />
        </Suspense>
      )}

      {fileMenu && (
        <ContextMenu
          x={fileMenu.x}
          y={fileMenu.y}
          items={buildFileMenuItems(fileMenu.node)}
          onClose={() => setFileMenu(null)}
        />
      )}
    </div>
  );
});
