/**
 * TaskEditDrawer — right-side sliding panel for editing a task (v1.2.0).
 *
 * Design (A v4): calm, tokenized, matches the 任务管理 module.
 *  - Case/project tasks: edit 标题 / 截止日期 / 优先级 / 状态 / 备注(detail).
 *    关联案件与阶段是只读上下文 —— 任务的案件归属与阶段(组)由案件详情管理,
 *    这里不提供跨组移动,避免引入"任务在组间搬移"这一新所有权。
 *  - Standalone tasks: 阶段是自由文本,允许直接改;独立任务无 detail,不显示备注。
 *
 * The drawer owns its form state and reports a normalized patch back to the
 * parent, which routes it to the correct mutation path (case / project /
 * standalone). Delete is reported as a separate callback.
 */

import { memo, useState } from 'react';
import { X, Trash2 } from 'lucide-react';
import type { TaskPriority, TaskStatus } from '@/hooks/useAgentLex';
import type { UnifiedTask } from '@/utils/taskAggregation';

export interface TaskDrawerPatch {
  title: string;
  deadline?: string;
  priority: TaskPriority;
  status: TaskStatus;
  /** case/project 任务的备注（映射 Task.detail）；standalone 无此字段。 */
  detail?: string;
  /** standalone 任务的自由阶段文本。 */
  stage?: string;
}

interface TaskEditDrawerProps {
  task: UnifiedTask | null;
  onClose: () => void;
  onSave: (task: UnifiedTask, patch: TaskDrawerPatch) => void;
  onDelete: (task: UnifiedTask) => void;
}

const STATUS_OPTS: Array<{ value: TaskStatus; label: string; onClass: string }> = [
  { value: 'todo', label: '待办', onClass: 'bg-[var(--paper-inset)] text-[var(--ink-muted)]' },
  { value: 'in_progress', label: '进行中', onClass: 'bg-[var(--accent-warm-subtle)] text-[var(--accent-warm)]' },
  { value: 'blocked', label: '受阻', onClass: 'bg-[var(--error-bg)] text-[var(--error)]' },
  { value: 'done', label: '已完成', onClass: 'bg-[var(--success-bg)] text-[var(--success)]' },
];
const PRIO_OPTS: Array<{ value: TaskPriority; label: string; onClass: string }> = [
  { value: 'high', label: '高', onClass: 'bg-[var(--error-bg)] text-[var(--error)]' },
  { value: 'medium', label: '中', onClass: 'bg-[rgba(58,118,98,0.12)] text-[var(--accent-cool)]' },
  { value: 'low', label: '低', onClass: 'bg-[var(--paper-inset)] text-[var(--ink-muted)]' },
];

const inputCls =
  'w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-sm text-[var(--ink)] ' +
  'outline-none transition-shadow focus:border-[var(--line-strong)] focus:ring-2 focus:ring-[var(--accent)]/30';

export default memo(function TaskEditDrawer({ task, onClose, onSave, onDelete }: TaskEditDrawerProps) {
  const [title, setTitle] = useState('');
  const [deadline, setDeadline] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [status, setStatus] = useState<TaskStatus>('todo');
  const [detail, setDetail] = useState('');
  const [stage, setStage] = useState('');

  // Re-seed the form whenever a different task opens. Done during render
  // (the official "adjust state when a prop changes" pattern) instead of an
  // effect so the lint rule `react-hooks/set-state-in-effect` stays green.
  // Keeping the drawer mounted (instead of unmount/remount) preserves the
  // slide-in transition.
  const [prevTask, setPrevTask] = useState(task);
  if (task !== prevTask) {
    setPrevTask(task);
    if (task) {
      setTitle(task.title ?? '');
      setDeadline(task.deadline ?? '');
      setPriority(task.priority ?? 'medium');
      setStatus(task.status ?? 'todo');
      setDetail(task.detail ?? '');
      setStage(task.stage ?? '');
    }
  }

  if (!task) return null;

  const isStandalone = task.origin === 'standalone';
  // 关联案件显示【编号 caseId】（如 2025-071），与台账行一致；不显示案号。
  const context = task.caseId
    ? `${task.caseId}${task.caseName ? ` · ${task.caseName}` : ''}`
    : '独立任务';

  const handleSave = () => {
    const patch: TaskDrawerPatch = {
      title: title.trim() || task.title,
      deadline: deadline || undefined,
      priority,
      status,
      ...(isStandalone ? { stage: stage.trim() } : { detail: detail.trim() }),
    };
    onSave(task, patch);
  };

  return (
    <>
      {/* Backdrop — click to dismiss */}
      <div
        className="fixed inset-0 z-40 bg-black/25 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      {/* Panel */}
      <aside
        className="fixed inset-y-0 right-0 z-50 flex w-[360px] flex-col overflow-y-auto border-l border-[var(--line-subtle)] bg-[var(--paper-elevated)] px-6 pb-5 pt-6 shadow-xl"
        data-agentlex-task-drawer=""
        role="dialog"
        aria-label="编辑任务"
      >
        <div className="mb-5 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <h3 className="shrink-0 text-base font-semibold text-[var(--ink)]">编辑任务</h3>
            {task.caseId && (
              <span className="truncate rounded-md bg-[var(--accent-warm-subtle)] px-1.5 py-0.5 font-mono text-[0.625rem] text-[var(--accent-warm)]">{task.caseId}</span>
            )}
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--ink-faint)] transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--ink)]"
          >
            <X size={15} strokeWidth={1.8} />
          </button>
        </div>

        <div className="mb-4">
          <label className="mb-1.5 block text-xs font-semibold tracking-wide text-[var(--ink-subtle)]">任务名称</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="起草…" className={inputCls} />
        </div>

        <div className="mb-4">
          <label className="mb-1.5 block text-xs font-semibold tracking-wide text-[var(--ink-subtle)]">关联案件</label>
          <div className="rounded-lg border border-[var(--line-subtle)] bg-[var(--paper)] px-3 py-2 font-mono text-xs text-[var(--ink-muted)]">
            {context}
          </div>
        </div>

        {isStandalone ? (
          <div className="mb-4">
            <label className="mb-1.5 block text-xs font-semibold tracking-wide text-[var(--ink-subtle)]">阶段</label>
            <input
              value={stage}
              onChange={(e) => setStage(e.target.value)}
              placeholder="庭前准备 / 文书起草…"
              className={inputCls}
            />
          </div>
        ) : (
          <div className="mb-4">
            <label className="mb-1.5 block text-xs font-semibold tracking-wide text-[var(--ink-subtle)]">阶段</label>
            <div className="rounded-lg border border-[var(--line-subtle)] bg-[var(--paper)] px-3 py-2 text-sm text-[var(--ink-muted)]">
              {task.stage || '未分阶段'}
            </div>
          </div>
        )}

        <div className="mb-4">
          <label className="mb-1.5 block text-xs font-semibold tracking-wide text-[var(--ink-subtle)]">截止日期</label>
          <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} className={inputCls} />
        </div>

        <div className="mb-4">
          <label className="mb-1.5 block text-xs font-semibold tracking-wide text-[var(--ink-subtle)]">优先级</label>
          <div className="flex gap-1.5">
            {PRIO_OPTS.map((o) => (
              <button
                key={o.value}
                onClick={() => setPriority(o.value)}
                className={`flex-1 rounded-lg border px-0 py-1.5 text-sm transition-colors ${
                  priority === o.value
                    ? `border-transparent font-semibold ${o.onClass}`
                    : 'border-[var(--line-subtle)] text-[var(--ink-muted)] hover:border-[var(--line-strong)]'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-4">
          <label className="mb-1.5 block text-xs font-semibold tracking-wide text-[var(--ink-subtle)]">状态</label>
          <div className="flex gap-1.5">
            {STATUS_OPTS.map((o) => (
              <button
                key={o.value}
                onClick={() => setStatus(o.value)}
                className={`flex-1 rounded-lg border px-0 py-1.5 text-sm transition-colors ${
                  status === o.value
                    ? `border-transparent font-semibold ${o.onClass}`
                    : 'border-[var(--line-subtle)] text-[var(--ink-muted)] hover:border-[var(--line-strong)]'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {!isStandalone && (
          <div className="mb-4">
            <label className="mb-1.5 block text-xs font-semibold tracking-wide text-[var(--ink-subtle)]">备注</label>
            <textarea
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="联系人 / 地点 / 需准备的材料…"
              className={`${inputCls} min-h-[64px] resize-y`}
            />
          </div>
        )}

        <div className="mt-auto flex items-center justify-between border-t border-[var(--line-subtle)] pt-4">
          <button
            onClick={() => onDelete(task)}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-[var(--error)] transition-colors hover:bg-[var(--error-bg)]"
          >
            <Trash2 size={14} />删除
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-[var(--ink-muted)] transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--ink)]"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              className="rounded-lg bg-[var(--accent-warm)] px-5 py-2 text-sm font-semibold text-[var(--on-accent)] shadow-sm transition-opacity hover:opacity-90"
            >
              保存
            </button>
          </div>
        </div>
      </aside>
    </>
  );
});
