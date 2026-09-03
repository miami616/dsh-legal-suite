/**
 * CaseTaskTree — work-breakdown tree for a case (Phase 2, redesigned).
 */
import { memo, useState, useEffect, useRef, useCallback } from 'react';
import {
  ChevronRight, ChevronDown, Plus, Trash2, ListChecks, GitBranch,
  Circle, CircleDot, CheckCircle2, Ban, ArrowUp, ArrowDown, FolderOpen, GripVertical,
  MoreHorizontal,
} from 'lucide-react';
import { isTauriEnvironment } from '@/utils/browserMock';
import { pickDirectoryPath } from '@/utils/directoryPicker';
import CustomSelect from '@/components/CustomSelect';
import { useAgentLex } from '@/hooks/useAgentLex';
import type { TaskGroup, Task, TaskStatus, TaskPriority } from '@/hooks/useAgentLex';

const STATUS_OPTS = [{ value: 'todo', label: '待办' },{ value: 'in_progress', label: '进行中' },{ value: 'done', label: '已完成' },{ value: 'blocked', label: '受阻' }];
const PRIORITY_OPTS = [{ value: 'high', label: '高' },{ value: 'medium', label: '中' },{ value: 'low', label: '低' }];

function StatusIcon({ status }: { status: TaskStatus }) {
  if (status === 'done') return <CheckCircle2 size={11} className="text-emerald-500 shrink-0" />;
  if (status === 'in_progress') return <CircleDot size={11} className="text-blue-500 shrink-0" />;
  if (status === 'blocked') return <Ban size={11} className="text-red-500 shrink-0" />;
  return <Circle size={11} className="text-[var(--ink-subtle)] shrink-0" />;
}
function isOverdue(d: string): boolean { return d < new Date().toISOString().slice(0,10); }
function daysUntil(d: string): number { return Math.ceil((new Date(d).getTime()-Date.now())/86400000); }

const InlineAdd = memo(function InlineAdd({ placeholder, onAdd }: { placeholder: string; onAdd: (text: string) => void }) {
  const [text, setText] = useState('');
  const submit = () => { const t = text.trim(); if (t) { onAdd(t); setText(''); } };
  return (
    <div className="flex items-center gap-2">
      <input type="text" value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit(); }}
        placeholder={placeholder} className="flex-1 px-2 py-1 rounded text-xs bg-[var(--paper)] border border-[var(--paper-inset)] outline-none focus:ring-1 focus:ring-blue-400/40" />
      <button onClick={submit} disabled={!text.trim()} className="px-2 py-1 rounded text-xs text-[var(--ink-muted)] hover:bg-[var(--paper-inset)] disabled:opacity-40">添加</button>
    </div>
  );
});

const TaskRow = memo(function TaskRow({ caseId, task, isProject }: { caseId: string; task: Task; isProject?: boolean }) {
  const {
    updateTask, deleteTask, addSubtask, updateSubtask, deleteSubtask,
    addChecklistItem, toggleChecklistItem, deleteChecklistItem,
    updateProjectTask, deleteProjectTask, addProjectSubtask, updateProjectSubtask, deleteProjectSubtask,
    addProjectChecklistItem, toggleProjectChecklistItem, deleteProjectChecklistItem,
  } = useAgentLex();
  const uTask = isProject ? updateProjectTask : updateTask;
  const dTask = isProject ? deleteProjectTask : deleteTask;
  const aSub = isProject ? addProjectSubtask : addSubtask;
  const uSub = isProject ? updateProjectSubtask : updateSubtask;
  const dSub = isProject ? deleteProjectSubtask : deleteSubtask;
  const aCk = isProject ? addProjectChecklistItem : addChecklistItem;
  const tCk = isProject ? toggleProjectChecklistItem : toggleChecklistItem;
  const dCk = isProject ? deleteProjectChecklistItem : deleteChecklistItem;
  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  // Local title draft for responsive IME-safe editing.
  const [titleDraft, setTitleDraft] = useState(task.title);
  const composingRef = useRef(false);
  const titleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const lastPersistedRef = useRef(task.title);
  useEffect(() => {
    // Only sync from disk when the value changed EXTERNALLY
    // (not when our own write-back completed - the stored title
    // will differ from lastPersisted while user is still typing).
    if (task.title !== lastPersistedRef.current) {
      setTitleDraft(task.title);
    }
  }, [task.title]);
  const persistTitle = useCallback((value: string) => {
    lastPersistedRef.current = value;
    if (value !== task.title) uTask(caseId, task.id, { title: value });
  }, [caseId, task.id, task.title, uTask]);
  const titleOnChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTitleDraft(e.target.value);
    if (!composingRef.current) {
      clearTimeout(titleTimerRef.current);
      titleTimerRef.current = setTimeout(() => persistTitle(e.target.value), 400);
    }
  };
  const titleOnCompositionEnd = (e: React.CompositionEvent<HTMLInputElement>) => {
    composingRef.current = false;
    const v = (e.target as HTMLInputElement).value;
    setTitleDraft(v);
    titleTimerRef.current = setTimeout(() => persistTitle(v), 300);
  };
  const titleOnBlur = () => {
    clearTimeout(titleTimerRef.current);
    if (titleDraft !== task.title) persistTitle(titleDraft);
  };
  const checkDone = task.checklist.filter(c => c.done).length;
  useEffect(() => {
    if (!menuOpen) return;
    const h = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menuOpen]);

  const bindFolder = async () => {
    // 注意：isRemoteBackend() 在 web 模式恒为 true，不能用来拦截——DSH web
    // 走插件 client 发布的目录选择桥，桌面端走 Tauri 对话框。
    try {
      const sel = await pickDirectoryPath('选择任务文件夹', task.folder ?? '');
      if (sel && typeof sel === 'string') uTask(caseId, task.id, { folder: sel });
    } catch (e) { console.warn('[TaskTree] folder:', e); }
  };
  const revealFolder = async () => {
    if (!task.folder || !isTauriEnvironment()) return;
    try { const { invoke } = await import('@tauri-apps/api/core'); await invoke('cmd_open_path_external', { fullPath: task.folder, workspace: task.folder }); }
    catch (e) { console.warn('[TaskTree] reveal:', e); }
  };

  return (
    <div className="rounded-lg border border-[var(--paper-inset)] bg-[var(--paper)]">
      <div className="flex items-center gap-2 px-3 py-2">
        <button onClick={() => setExpanded(v => !v)} className="shrink-0 text-[var(--ink-subtle)] hover:text-[var(--ink)]">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <button onClick={() => uTask(caseId, task.id, { status: task.status === 'done' ? 'todo' : 'done' })} className="shrink-0">
          <StatusIcon status={task.status} />
        </button>
        <input value={titleDraft} onChange={titleOnChange} onCompositionStart={() => { composingRef.current = true; }} onCompositionEnd={titleOnCompositionEnd} onBlur={titleOnBlur}
          className={`flex-1 min-w-0 bg-transparent outline-none text-sm font-medium text-[var(--ink)] placeholder:text-[var(--ink-subtle)] ${task.status === 'done' ? 'line-through opacity-50' : ''}`} placeholder="任务名称" />
        {/* Always visible: deadline + time */}
        {(task.deadline || task.time) && (
          <span className={`text-xs font-mono shrink-0 ${isOverdue(task.deadline ?? '') ? 'text-red-500' : daysUntil(task.deadline ?? '') <= 3 ? 'text-amber-600' : 'text-[var(--ink-muted)]'}`}>
            {task.deadline}{task.time ? ` ${task.time}` : ''}
          </span>
        )}
        {/* Overflow menu */}
        <div className="relative shrink-0" ref={menuRef}>
          <button onClick={() => setMenuOpen(!menuOpen)}
            className="p-1 rounded text-[var(--ink-subtle)] hover:text-[var(--ink)] hover:bg-[var(--paper-inset)]">
            <MoreHorizontal size={14} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 w-44 bg-[var(--paper-elevated)] border border-[var(--paper-inset)] rounded-xl shadow-xl z-50 py-1">
              <div className="px-2 py-1.5 space-y-2">
                <label className="block text-xs text-[var(--ink-muted)]">截止日期</label>
                <div className="flex gap-1.5">
                  <input type="date" value={task.deadline ?? ''} onChange={e => uTask(caseId, task.id, { deadline: e.target.value || undefined })}
                    className="w-full px-2 py-1 rounded text-xs bg-[var(--paper-inset)] outline-none text-[var(--ink)]" />
                  <input type="time" value={task.time ?? ''} onChange={e => uTask(caseId, task.id, { time: e.target.value || undefined })}
                    className="w-24 px-2 py-1 rounded text-xs bg-[var(--paper-inset)] outline-none text-[var(--ink)]" />
                </div>
              </div>
              <div className="px-2 py-1.5 flex items-center justify-between">
                <span className="text-xs text-[var(--ink-muted)]">优先级</span>
                <div className="w-16"><CustomSelect compact value={task.priority} options={PRIORITY_OPTS} onChange={v => { uTask(caseId, task.id, { priority: v as TaskPriority }); }} /></div>
              </div>
              <div className="px-2 py-1.5 flex items-center justify-between">
                <span className="text-xs text-[var(--ink-muted)]">状态</span>
                <div className="w-20"><CustomSelect compact value={task.status} options={STATUS_OPTS} onChange={v => { uTask(caseId, task.id, { status: v as TaskStatus }); }} /></div>
              </div>
              <div className="border-t border-[var(--paper-inset)] mt-1 pt-1 px-1 space-y-0.5">
                <button onClick={() => { setMenuOpen(false); (task.folder ? revealFolder : bindFolder)(); }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-[var(--ink-muted)] hover:bg-[var(--paper-inset)]">
                  <FolderOpen size={12} />{task.folder ? '打开文件夹' : '绑定文件夹'}
                </button>
                <button onClick={() => { setMenuOpen(false); dTask(caseId, task.id); }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-red-500 hover:bg-red-50">
                  <Trash2 size={12} />删除任务
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      {expanded && (
        <div className="px-4 pb-3 pt-1 space-y-3 border-t border-[var(--paper-inset)] bg-[var(--paper)]">
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-[var(--ink-muted)] font-medium"><GitBranch size={12} />子任务 {task.subtasks.length > 0 && `(${task.subtasks.length})`}</div>
            {task.subtasks.map(st => (
              <div key={st.id} className="flex items-center gap-2 group/s">
                <button onClick={() => uSub(caseId, task.id, st.id, { status: st.status === 'done' ? 'todo' : 'done' })} className="shrink-0"><StatusIcon status={st.status} /></button>
                <input value={st.title} onChange={e => uSub(caseId, task.id, st.id, { title: e.target.value })}
                  className={`flex-1 min-w-0 bg-transparent outline-none text-xs text-[var(--ink)] ${st.status === 'done' ? 'line-through opacity-50' : ''}`} placeholder="子任务" />
                {st.deadline && <span className={`text-xs font-mono shrink-0 ${isOverdue(st.deadline) ? 'text-red-500' : 'text-[var(--ink-muted)]'}`}>{st.deadline}</span>}
                <button onClick={() => dSub(caseId, task.id, st.id)} className="shrink-0 p-0.5 rounded text-[var(--ink-subtle)] opacity-0 group-hover/s:opacity-100 hover:text-red-500"><Trash2 size={12} /></button>
              </div>
            ))}
            <InlineAdd placeholder="添加子任务…" onAdd={text => aSub(caseId, task.id, text)} />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-[var(--ink-muted)] font-medium"><ListChecks size={12} />检查项 {task.checklist.length > 0 && `(${checkDone}/${task.checklist.length})`}</div>
            {task.checklist.map(item => (
              <div key={item.id} className="flex items-center gap-2 group/c">
                <button onClick={() => tCk(caseId, task.id, item.id)} className="shrink-0">{item.done ? <CheckCircle2 size={11} className="text-emerald-500" /> : <Circle size={11} className="text-[var(--ink-subtle)]" />}</button>
                <span className={`flex-1 text-xs ${item.done ? 'line-through opacity-50 text-[var(--ink-muted)]' : 'text-[var(--ink)]'}`}>{item.text}</span>
                <button onClick={() => dCk(caseId, task.id, item.id)} className="shrink-0 p-0.5 rounded text-[var(--ink-subtle)] opacity-0 group-hover/c:opacity-100 hover:text-red-500"><Trash2 size={12} /></button>
              </div>
            ))}
            <InlineAdd placeholder="添加检查项…" onAdd={text => aCk(caseId, task.id, text)} />
          </div>
        </div>
      )}
    </div>
  );
});

const GroupSection = memo(function GroupSection({ caseId, group, index, total, groupOptions, isProject }: {
  caseId: string; group: TaskGroup; index: number; total: number; groupOptions: { value: string; label: string }[];
  isProject?: boolean;
}) {
  const {
    updateTaskGroup, deleteTaskGroup, reorderTaskGroups, addTask,
    updateProjectTaskGroup, deleteProjectTaskGroup, reorderProjectTaskGroups, addProjectTask,
  } = useAgentLex();
  const uGroup = isProject ? updateProjectTaskGroup : updateTaskGroup;
  const dGroup = isProject ? deleteProjectTaskGroup : deleteTaskGroup;
  const rGroup = isProject ? reorderProjectTaskGroups : reorderTaskGroups;
  const aTask = isProject ? addProjectTask : addTask;
  const [collapsed, setCollapsed] = useState(false);
  const doneTasks = group.tasks.filter(t => t.status === 'done').length;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 group/g">
        <GripVertical size={14} className="text-[var(--ink-subtle)] opacity-30 shrink-0" />
        <button onClick={() => setCollapsed(v => !v)} className="shrink-0 text-[var(--ink-subtle)] hover:text-[var(--ink)]">
          {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
        </button>
        <input value={group.title} onChange={e => uGroup(caseId, group.id, { title: e.target.value })}
          className="flex-1 min-w-0 bg-transparent outline-none text-sm font-bold text-[var(--ink)] placeholder:text-[var(--ink-subtle)]" placeholder="阶段名称" />
        <span className="text-xs text-[var(--ink-muted)] shrink-0">
          {group.tasks.length} 任务{doneTasks > 0 && ` · ${doneTasks} 完成`}
        </span>
        <button disabled={index === 0} onClick={() => rGroup(caseId, reordered(groupOptions, index, -1))}
          className="shrink-0 p-1 rounded text-[var(--ink-subtle)] hover:text-[var(--ink)] disabled:opacity-30"><ArrowUp size={13} /></button>
        <button disabled={index === total - 1} onClick={() => rGroup(caseId, reordered(groupOptions, index, 1))}
          className="shrink-0 p-1 rounded text-[var(--ink-subtle)] hover:text-[var(--ink)] disabled:opacity-30"><ArrowDown size={13} /></button>
        <button onClick={() => aTask(caseId, group.id, '新任务')}
          className="shrink-0 flex items-center gap-1 px-2 py-1 rounded text-xs text-[var(--ink-muted)] hover:bg-[var(--paper-inset)]"><Plus size={12} />任务</button>
        <button onClick={() => dGroup(caseId, group.id)}
          className="shrink-0 p-1 rounded text-[var(--ink-subtle)] opacity-0 group-hover/g:opacity-100 hover:text-red-500"><Trash2 size={13} /></button>
      </div>
      {!collapsed && (
        <div className="pl-6 space-y-1.5">
          {group.tasks.length === 0
            ? <p className="text-xs text-[var(--ink-subtle)] py-2">暂无任务，点击「+ 任务」添加</p>
            : group.tasks.map(t => <TaskRow key={t.id} caseId={caseId} task={t} isProject={isProject} />)}
        </div>
      )}
    </div>
  );
});

function reordered(groupOptions: { value: string }[], index: number, dir: -1 | 1): string[] {
  const ids = groupOptions.map(g => g.value);
  const j = index + dir;
  if (j < 0 || j >= ids.length) return ids;
  [ids[index], ids[j]] = [ids[j], ids[index]];
  return ids;
}

export default memo(function CaseTaskTree({ caseId, taskGroups, isProject }: { caseId: string; taskGroups: TaskGroup[]; isProject?: boolean }) {
  const { addTaskGroup, addProjectTaskGroup } = useAgentLex();
  const handleAddGroup = isProject ? addProjectTaskGroup : addTaskGroup;
  const groupOptions = taskGroups.map(g => ({ value: g.id, label: g.title || '未命名阶段' }));
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-[var(--ink)]">{isProject ? '项目任务' : '办案任务'}</h3>
        <button onClick={() => handleAddGroup(caseId, '新阶段')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--ink-muted)] hover:bg-[var(--paper-inset)] hover:text-[var(--ink)] transition-colors">
          <Plus size={14} />添加任务组
        </button>
      </div>
      {taskGroups.length === 0 ? (
        <div className="text-center py-10 rounded-xl border border-dashed border-[var(--paper-inset)]">
          <ListChecks size={24} className="mx-auto mb-2 text-[var(--ink-subtle)] opacity-40" />
          <p className="text-xs text-[var(--ink-muted)]">{isProject ? '暂无项目任务' : '暂无办案任务'}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {taskGroups.map((g, i) => (
            <GroupSection key={g.id} caseId={caseId} group={g} index={i} total={taskGroups.length} groupOptions={groupOptions} isProject={isProject} />
          ))}
        </div>
      )}
    </div>
  );
});
