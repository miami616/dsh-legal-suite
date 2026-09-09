/**
 * TaskManager — unified 任务管理 (v1.3.0 redesign, "C 方案 · 呼吸感").
 *
 * Design: 减法。陶土橙只服务「动作 + 今日焦点」，语义色只在「截止紧迫 /
 * 状态 / 类型」出现，其余中性；统一 4pt 留白节奏；行内三区对齐。
 *   1  Header — 标题 + 日期/逾期/今日进度副标 + 新建任务
 *   2  Hero   — 「今日指挥卡」：今日待办+进度 / 今日事项(事件+任务) / 时间桶分布(下钻)
 *               （替代 v4 的「今日开庭横幅 + 统计 chips」三层堆叠）
 *   3  Ledger — 台账：已逾期/今天/明天/未来/未排程/已完成 分组
 *   4  Calendar — 右栏暖色日历(圆点按类型着色,点空白日建任务) + 关键日程
 *   5  Drawer — 点任务行 → 右侧抽屉编辑
 *
 * 数据层要点（沿用 v4，未动）:
 *   - 分桶/本地日期来自 taskAggregation(taskTimeBucket / daysUntil)，
 *     「未来」= 明天之后全部，不丢 >7 天的任务；日期全用本地时区。
 *   - 案件标识显示【编号 caseId】（如 2025-071），不是案号 caseNo。
 *   - 日历与台账同源：事件(timeline) + 案件/项目任务截止 + 独立任务截止。
 *   - 状态行内改为 pill + 下拉菜单（Popover），避免 v4 行内 76px 下拉占位。
 */

import { memo, useMemo, useState, useCallback, useRef, useEffect } from 'react';
import {
  Plus, Check, Trash2, ChevronLeft, ChevronRight, X, ListChecks, Search,
} from 'lucide-react';
import { useAgentLex, type TaskPriority, type TaskStatus, type Task, type CaseEntry } from '@/hooks/useAgentLex';
import CustomSelect from '@/components/CustomSelect';
import { Popover } from '@/components/ui/Popover';
import TaskEditDrawer, { type TaskDrawerPatch } from '@/components/agentlex/TaskEditDrawer';
import { useIsMobile } from '@/hooks/useIsMobile';
import { MobileNav } from '@/components/agentlex/MobileNav';
import {
  deriveAllTasks, taskTimeBucket, daysUntil, localTodayStr,
  type UnifiedTask,
} from '@/utils/taskAggregation';

// ── 本地日期工具（deadline 是本地日历日，禁止用 UTC） ──
const fmtMD = (ds: string) => {
  const [, m, d] = ds.split('-');
  return `${Number(m)}月${Number(d)}日`;
};
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const weekdayOf = (ds: string) => WEEK[new Date(`${ds}T00:00:00`).getDay()];
const todayStr = localTodayStr();

// ── 时间桶定义（顺序即渲染顺序） ──
const BUCKETS: Array<{ key: TaskBucketKey; label: string; dot: string }> = [
  { key: 'overdue', label: '已逾期', dot: 'var(--error)' },
  { key: 'today', label: '今天', dot: 'var(--accent-warm)' },
  { key: 'tomorrow', label: '明天', dot: 'var(--warning)' },
  { key: 'future', label: '未来', dot: 'var(--info)' },
  { key: 'none', label: '未排程', dot: 'var(--ink-faint)' },
  { key: 'done', label: '已完成', dot: 'var(--success)' },
];
type TaskBucketKey = 'overdue' | 'today' | 'tomorrow' | 'future' | 'none' | 'done';

const STATUS_OPTS: Array<{ value: TaskStatus; label: string }> = [
  { value: 'todo', label: '待办' }, { value: 'in_progress', label: '进行中' },
  { value: 'blocked', label: '受阻' }, { value: 'done', label: '已完成' },
];
const STATUS_PILL: Record<TaskStatus, string> = {
  todo: 'bg-[var(--paper-inset)] text-[var(--ink-muted)]',
  in_progress: 'bg-[var(--accent-warm-subtle)] text-[var(--accent-warm)]',
  blocked: 'bg-[var(--error-bg)] text-[var(--error)]',
  done: 'bg-[var(--success-bg)] text-[var(--success)]',
};
const STATUS_DOT: Record<TaskStatus, string> = {
  todo: 'bg-[var(--ink-faint)]',
  in_progress: 'bg-[var(--accent-warm)]',
  blocked: 'bg-[var(--error)]',
  done: 'bg-[var(--success)]',
};
const PRIORITY_OPTS = [
  { value: 'high', label: '高' }, { value: 'medium', label: '中' }, { value: 'low', label: '低' },
];

// 事件类型 → 徽章/圆点色（语义色：开庭/时效红，期限琥珀，会议/递交青，其余信息蓝）
const EVENT_META: Record<string, { label: string; dot: string }> = {
  hearing: { label: '开庭', dot: 'var(--error)' },
  arbitration: { label: '仲裁', dot: 'var(--error)' },
  limitation_expiry: { label: '时效', dot: 'var(--error)' },
  evidence_deadline: { label: '举证', dot: 'var(--warning)' },
  defense_deadline: { label: '答辩', dot: 'var(--warning)' },
  appeal_deadline: { label: '上诉', dot: 'var(--warning)' },
  retrial_deadline: { label: '再审', dot: 'var(--warning)' },
  filing_deadline: { label: '递交', dot: 'var(--warning)' },
  deadline: { label: '期限', dot: 'var(--warning)' },
  task_deadline: { label: '期限', dot: 'var(--warning)' },
  filing: { label: '递交', dot: 'var(--accent-cool)' },
  meeting: { label: '会议', dot: 'var(--accent-cool)' },
  service: { label: '送达', dot: 'var(--accent-cool)' },
  court_notice: { label: '通知', dot: 'var(--info)' },
  reference: { label: '参考', dot: 'var(--info)' },
  case_event: { label: '事项', dot: 'var(--info)' },
};
const eventMeta = (type: string) => EVENT_META[type] ?? { label: '事项', dot: 'var(--info)' };

interface CalendarEntry {
  key: string;
  label: string;
  time?: string;
  caseName?: string;
  kind: 'event' | 'task';
  badge: string;
  dot: string;
}

interface TaskManagerProps {
  isActive?: boolean;
  onOpenCase: (entry: CaseEntry) => void;
}

// ── 行内状态 pill：点击弹出下拉菜单（v4 是行内 76px CustomSelect） ──
const StatusPill = memo(function StatusPill({
  t, onPatch,
}: {
  t: UnifiedTask;
  onPatch: (patch: { status: TaskStatus }) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const label = STATUS_OPTS.find(o => o.value === t.status)?.label ?? '待办';
  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen(v => !v)}
        title="切换状态"
        className={`rounded-md px-2 py-0.5 text-[0.6875rem] font-semibold transition-colors hover:brightness-[.97] ${STATUS_PILL[t.status]}`}
      >
        {label}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={ref} placement="bottom-end" zIndex={70} className="shadow-md">
        <div className="w-28 p-1">
          {STATUS_OPTS.map(o => (
            <button
              key={o.value}
              type="button"
              onClick={() => { onPatch({ status: o.value }); setOpen(false); }}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                o.value === t.status
                  ? 'bg-[var(--paper-inset)] font-semibold text-[var(--ink)]'
                  : 'text-[var(--ink-muted)] hover:bg-[var(--paper-inset)] hover:text-[var(--ink)]'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[o.value]}`} />
              {o.label}
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
});

export default memo(function TaskManager({ isActive: _isActive, onOpenCase }: TaskManagerProps) {
  const mobile = useIsMobile();
  const {
    cases, projects, standaloneTasks, timelineEvents,
    addTask: addCaseTask, updateTask, deleteTask,
    addStandaloneTask, updateStandaloneTask, deleteStandaloneTask,
    updateProjectTask, deleteProjectTask,
    addItem,
  } = useAgentLex();

  // ── State ──
  const [bucketFilter, setBucketFilter] = useState<TaskBucketKey | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCase, setFilterCase] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showDone, setShowDone] = useState(false); // 备忘录 #16：默认隐藏已完成，聚焦待办
  const [editTask, setEditTask] = useState<UnifiedTask | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [calYear, setCalYear] = useState(() => new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(() => new Date().getMonth());
  const [popupDate, setPopupDate] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newCaseId, setNewCaseId] = useState('');
  const [newGroupId, setNewGroupId] = useState('');
  const [newDeadline, setNewDeadline] = useState('');
  const [newTime, setNewTime] = useState('');
  const [newPriority, setNewPriority] = useState<TaskPriority>('medium');
  const [newType, setNewType] = useState<'event' | 'task' | 'both'>('task');

  // ── Derived data ──
  const allTasks = useMemo(
    () => deriveAllTasks(cases, standaloneTasks, projects),
    [cases, standaloneTasks, projects],
  );

  const bucketCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const t of allTasks) {
      const b = taskTimeBucket(t);
      c[b] = (c[b] ?? 0) + 1;
    }
    return c;
  }, [allTasks]);

  // 待办数（不含已办）——备忘录 #7：「全部」等数字基数应为待办。
  const openTaskCount = useMemo(() => allTasks.filter(t => t.status !== 'done').length, [allTasks]);

  // ── 过滤（搜索真实生效） ──
  const filtered = useMemo(
    () =>
      allTasks.filter(t => {
        if (!showDone && t.status === 'done') return false;
        if (bucketFilter !== 'all' && taskTimeBucket(t) !== bucketFilter) return false;
        if (filterStatus && t.status !== filterStatus) return false;
        if (filterCase && (filterCase === '__none__' ? t.caseId !== null : t.caseId !== filterCase)) return false;
        if (searchQuery) {
          const n = (t.title + (t.caseId ?? '') + (t.caseName ?? '') + t.stage).toLowerCase();
          if (!n.includes(searchQuery.toLowerCase())) return false;
        }
        return true;
      }),
    [allTasks, showDone, bucketFilter, filterStatus, filterCase, searchQuery],
  );

  const groups = useMemo(() => {
    const m: Record<string, UnifiedTask[]> = {};
    for (const b of BUCKETS) m[b.key] = [];
    for (const t of filtered) m[taskTimeBucket(t)].push(t);
    return BUCKETS.filter(b => m[b.key].length).map(b => ({ key: b.key, tasks: m[b.key] }));
  }, [filtered]);

  // ── 今日副标 / hero ──
  const todayProgress = useMemo(() => {
    const tt = allTasks.filter(t => t.deadline === todayStr);
    const dn = tt.filter(t => t.status === 'done').length;
    return { total: tt.length, done: dn };
  }, [allTasks]);
  const overdueCount = bucketCounts.overdue ?? 0;
  // ── 今日事项（事件 + 到期任务）：备忘录 #4「今日日程」→「今日事项」 ──
  const todayItems = useMemo(() => {
    const items: Array<{
      key: string; kind: 'event' | 'task'; time?: string; label: string;
      sub?: string; urgent?: boolean; status?: string;
    }> = [];
    // 事件：今天发生的未取消节点（开庭/举证/会议/立案…都算）。
    for (const e of timelineEvents) {
      if (e.date !== todayStr || e.status === 'cancelled' || e.status === 'completed') continue;
      items.push({
        key: `ev:${e.id}`,
        kind: 'event',
        time: e.time,
        label: e.label || e.title || '',
        sub: e.caseName,
        urgent: e.type === 'hearing' || e.type === 'arbitration',
      });
    }
    // 任务：今天到期的未完成任务（案件/项目/独立）。
    for (const t of allTasks) {
      if (t.deadline !== todayStr || t.status === 'done') continue;
      items.push({
        key: `task:${t.key}`,
        kind: 'task',
        time: t.time,
        label: t.title,
        sub: t.caseName || t.stage,
        urgent: t.priority === 'high',
        status: t.status,
      });
    }
    items.sort((a, b) => (a.time ?? '99:99').localeCompare(b.time ?? '99:99'));
    return items;
  }, [timelineEvents, allTasks]);

  // ── 日历同源数据（事件 + 案件/项目/独立任务截止） ──
  const calByDate = useMemo(() => {
    const m = new Map<string, CalendarEntry[]>();
    const push = (date: string, entry: CalendarEntry) => {
      const arr = m.get(date) ?? [];
      arr.push(entry);
      m.set(date, arr);
    };
    for (const ev of timelineEvents) {
      if (ev.status === 'cancelled') continue;
      const meta = eventMeta(ev.type);
      push(ev.date, {
        key: `ev:${ev.id}`, label: ev.label, time: ev.time, caseName: ev.caseName,
        kind: 'event', badge: meta.label, dot: meta.dot,
      });
    }
    for (const t of allTasks) {
      if (t.deadline && t.status !== 'done') {
        push(t.deadline, {
          key: `t:${t.key}`, label: t.title, caseName: t.caseName,
          time: t.time, kind: 'task', badge: '任务', dot: 'var(--ink-faint)',
        });
      }
    }
    return m;
  }, [timelineEvents, allTasks]);

  const keyDates = useMemo(
    () =>
      timelineEvents
        .filter(e => (e.status === 'pending' || e.status === 'upcoming') && e.date >= todayStr)
        .sort((a, b) => a.date.localeCompare(b.date)),
    [timelineEvents],
  );

  // ── Calendar grid ──
  const calDays = useMemo(() => {
    const s = new Date(calYear, calMonth, 1).getDay();
    const n = new Date(calYear, calMonth + 1, 0).getDate();
    return [...Array(s).fill(null) as null[], ...Array.from({ length: n }, (_, i) => i + 1)];
  }, [calYear, calMonth]);

  const popupItems = useMemo(() => (popupDate ? calByDate.get(popupDate) ?? [] : []), [popupDate, calByDate]);

  // ── 日历日弹层：点击弹层外部自动关闭（备忘录 #9：不能只能靠 X 关闭）──
  // popupDate 打开期间，捕获 document pointerdown：点在天格（开弹层）、弹层内
  // 或「关键日程」等同卡内容都不关；点其它任意处关闭。
  const popupRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!popupDate) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (popupRef.current?.contains(t)) return;
      // 天格按钮自带 data-calday（开弹层/新建），点它不关。
      if (t.closest('[data-calday]')) return;
      setPopupDate(null);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [popupDate]);

  // ── Calendar nav ──
  const calPrev = useCallback(() => {
    if (calMonth === 0) { setCalMonth(11); setCalYear(y => y - 1); } else { setCalMonth(m => m - 1); }
    setPopupDate(null);
  }, [calMonth]);
  const calNext = useCallback(() => {
    if (calMonth === 11) { setCalMonth(0); setCalYear(y => y + 1); } else { setCalMonth(m => m + 1); }
    setPopupDate(null);
  }, [calMonth]);
  const backToday = useCallback(() => {
    const n = new Date(); setCalYear(n.getFullYear()); setCalMonth(n.getMonth()); setPopupDate(null);
  }, []);

  // ── Actions ──
  const openLinkedCase = useCallback(
    (caseId: string | null) => {
      if (!caseId) return;
      const ce = cases.find(c => c.caseId === caseId);
      if (ce) { onOpenCase(ce); return; }
      const pe = projects.find(p => p.projectId === caseId);
      if (pe) onOpenCase({ caseId: pe.projectId, name: pe.name } as CaseEntry);
    },
    [cases, projects, onOpenCase],
  );

  const toggleDone = useCallback(
    (t: UnifiedTask) => {
      const next: TaskStatus = t.status === 'done' ? 'todo' : 'done';
      if (t.origin === 'case-task' && t.caseId) void updateTask(t.caseId, t.id, { status: next });
      else if (t.origin === 'project-task' && t.caseId) void updateProjectTask(t.caseId, t.id, { status: next });
      else void updateStandaloneTask(t.id, s => ({ ...s, status: next, updatedAt: new Date().toISOString() }));
    },
    [updateTask, updateProjectTask, updateStandaloneTask],
  );

  const patchTask = useCallback(
    (t: UnifiedTask, patch: { status?: TaskStatus; priority?: TaskPriority; deadline?: string }) => {
      if (t.origin === 'case-task' && t.caseId) void updateTask(t.caseId, t.id, patch);
      else if (t.origin === 'project-task' && t.caseId) void updateProjectTask(t.caseId, t.id, patch);
      else void updateStandaloneTask(t.id, s => ({ ...s, ...patch, updatedAt: new Date().toISOString() }));
    },
    [updateTask, updateProjectTask, updateStandaloneTask],
  );

  const removeTask = useCallback(
    (t: UnifiedTask) => {
      if (t.origin === 'case-task' && t.caseId) void deleteTask(t.caseId, t.id);
      else if (t.origin === 'project-task' && t.caseId) void deleteProjectTask(t.caseId, t.id);
      else void deleteStandaloneTask(t.id);
    },
    [deleteTask, deleteProjectTask, deleteStandaloneTask],
  );

  const handleDrawerSave = useCallback(
    (t: UnifiedTask, patch: TaskDrawerPatch) => {
      if (t.origin === 'case-task' && t.caseId) {
        // merge_patch 是裸 insert：null 才真正清空截止日
        const taskPatch = {
          title: patch.title,
          deadline: patch.deadline ?? null,
          time: patch.time ?? null,
          priority: patch.priority,
          status: patch.status,
          detail: patch.detail,
        } as unknown as Partial<Task>;
        void updateTask(t.caseId, t.id, taskPatch);
      } else if (t.origin === 'project-task' && t.caseId) {
        const taskPatch = {
          title: patch.title,
          deadline: patch.deadline ?? null,
          time: patch.time ?? null,
          priority: patch.priority,
          status: patch.status,
          detail: patch.detail,
        } as unknown as Partial<Task>;
        void updateProjectTask(t.caseId, t.id, taskPatch);
      } else {
        void updateStandaloneTask(t.id, s => ({
          ...s,
          title: patch.title,
          deadline: patch.deadline,
          time: patch.time,
          priority: patch.priority,
          status: patch.status,
          stage: patch.stage ?? s.stage,
          updatedAt: new Date().toISOString(),
        }));
      }
      setEditTask(null);
    },
    [updateTask, updateProjectTask, updateStandaloneTask],
  );

  const handleDrawerDelete = useCallback(
    (t: UnifiedTask) => {
      if (t.origin === 'case-task' && t.caseId) void deleteTask(t.caseId, t.id);
      else if (t.origin === 'project-task' && t.caseId) void deleteProjectTask(t.caseId, t.id);
      else void deleteStandaloneTask(t.id);
      setEditTask(null);
    },
    [deleteTask, deleteProjectTask, deleteStandaloneTask],
  );

  const newCaseGroups = useMemo(() => {
    if (!newCaseId) return [];
    const c = cases.find(x => x.caseId === newCaseId);
    return Array.isArray(c?.taskGroups) ? c!.taskGroups : [];
  }, [newCaseId, cases]);

  const handleAdd = useCallback(() => {
    if (!newTitle.trim()) return;
    const timeOrUndef = newTime.trim() || undefined;
    // 统一事项：登记一个事项（type: event/task/both），自动分流到日程/时间轴/任务树。
    void addItem({
      ownerId: newCaseId || '',
      ownerType: newCaseId ? 'litigation' : 'standalone',
      ownerName: newCaseId ? cases.find(c => c.caseId === newCaseId)?.name : undefined,
      type: newType,
      title: newTitle.trim(),
      date: newDeadline || undefined,
      time: timeOrUndef,
      priority: newPriority,
      groupId: newGroupId || undefined,
    });
    setNewTitle(''); setNewCaseId(''); setNewGroupId(''); setNewDeadline(''); setNewTime(''); setNewPriority('medium'); setNewType('task'); setShowAdd(false);
  }, [newTitle, newCaseId, newGroupId, newDeadline, newTime, newPriority, newType, addItem, cases]);

  const openAddPrefill = useCallback((deadline?: string) => {
    setNewDeadline(deadline ?? '');
    setNewTitle(''); setNewCaseId(''); setNewGroupId(''); setNewTime(''); setNewPriority('medium'); setNewType('task');
    setShowAdd(true);
  }, []);

  // ── 行内渲染小工具 ──
  const dueMeta = useCallback((t: UnifiedTask): { text: string; cls: string } | null => {
    if (!t.deadline) return null;
    const timeSuffix = t.time ? ` ${t.time}` : '';
    const dd = daysUntil(t.deadline);
    if (t.status !== 'done') {
      if (dd < 0) return { text: `逾期 ${-dd} 天${timeSuffix}`, cls: 'bg-[var(--error-bg)] text-[var(--error)]' };
      if (dd === 0) return { text: `今天${timeSuffix}`, cls: 'bg-[var(--accent-warm-subtle)] text-[var(--accent-warm)]' };
      if (dd === 1) return { text: `明天${timeSuffix}`, cls: 'bg-[var(--warning-bg)] text-[var(--warning)]' };
      return { text: `${fmtMD(t.deadline)}${timeSuffix}`, cls: 'bg-[var(--paper-inset)] text-[var(--ink-muted)]' };
    }
    return { text: `${fmtMD(t.deadline)}${timeSuffix}`, cls: 'bg-[var(--paper-inset)] text-[var(--ink-muted)]' };
  }, []);

  const prioDotClass = useCallback((p: TaskPriority) =>
    p === 'high' ? 'bg-[var(--error)]' : p === 'medium' ? 'bg-[var(--accent-cool)]' : 'bg-[var(--ink-faint)]', []);

  // ── Task row ──
  const TaskItem = useCallback(({ t }: { t: UnifiedTask }) => {
    const done = t.status === 'done';
    const dt = dueMeta(t);
    return (
      <div
        onClick={() => setEditTask(t)}
        className={`group flex cursor-pointer items-start gap-3 rounded-lg px-2.5 py-2.5 transition-colors hover:bg-[var(--hover-bg)] ${done ? 'opacity-60' : ''}`}
      >
        <button
          onClick={(e) => { e.stopPropagation(); toggleDone(t); }}
          title={done ? '标记未完成' : '标记完成'}
          className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.6px] transition-colors ${
            done ? 'border-[var(--success)] bg-[var(--success)] text-white' : 'border-[var(--line-strong)] text-transparent hover:border-[var(--success)] hover:text-[var(--success)]'
          }`}
        >
          <Check size={10} strokeWidth={3.2} />
        </button>
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${prioDotClass(t.priority)}`} title={`优先级：${t.priority}`} />
        <div className="min-w-0 flex-1">
          <span className={`block text-sm font-medium leading-snug ${done ? 'text-[var(--ink-muted)] line-through' : 'text-[var(--ink)]'}`}>{t.title}</span>
          <div className="mt-0.5 truncate text-xs text-[var(--ink-muted)]">
            {t.caseId ? (
              <>
                <span className="font-mono tracking-tight text-[var(--ink-subtle)]">{t.caseId}</span>
                <span className="mx-1.5 text-[var(--ink-faint)]">·</span>
                {t.caseName}
                {t.stage ? <><span className="mx-1.5 text-[var(--ink-faint)]">·</span>{t.stage}</> : null}
              </>
            ) : (
              <>
                <span className="text-[var(--ink-subtle)]">独立任务</span>
                {t.stage ? <><span className="mx-1.5 text-[var(--ink-faint)]">·</span>{t.stage}</> : null}
              </>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <StatusPill t={t} onPatch={(p) => patchTask(t, p)} />
          {dt && <span className={`whitespace-nowrap rounded-md px-2 py-0.5 text-[0.6875rem] font-semibold ${dt.cls}`}>{dt.text}</span>}
          <button
            onClick={() => removeTask(t)}
            title="删除"
            className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--ink-subtle)]/60 opacity-0 transition-all hover:bg-[var(--error-bg)] hover:text-[var(--error)] group-hover:opacity-100"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    );
  }, [toggleDone, patchTask, removeTask, dueMeta, prioDotClass]);

  // ════════════════════════════════════════════════════════
  //  MAIN RENDER
  // ════════════════════════════════════════════════════════
  return (
    <div
      className="flex h-full flex-col overflow-hidden"
      style={{ background: 'var(--theme-body-background)' }}
    >
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1200px] 2xl:max-w-[1400px] px-8 pb-16 pt-10">

          {/* ── 页头 ── */}
          <header className="mb-8 flex items-center justify-between gap-6">
            <div>
              <h1 className="text-3xl font-extrabold tracking-tight leading-tight text-[var(--ink)]" style={{ background: 'linear-gradient(135deg, var(--ink) 0%, #555 50%, var(--ink) 100%)', backgroundSize: '200% 100%', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>任务管理</h1>
              <p className="mt-1 text-xs text-[var(--ink-muted)]">
                <span className="font-semibold text-[var(--ink-secondary)]">{fmtMD(todayStr)} {weekdayOf(todayStr)}</span>
                <span className="mx-1.5 text-[var(--ink-faint)]">·</span>今日 {todayProgress.total} 项到期
                {overdueCount > 0 && (
                  <>
                    <span className="mx-1.5 text-[var(--ink-faint)]">·</span>
                    <span className="font-semibold text-[var(--error)]">{overdueCount} 项逾期</span>
                  </>
                )}
                <span className="mx-1.5 text-[var(--ink-faint)]">·</span>
                完成 <b className="font-semibold text-[var(--ink)]">{todayProgress.done}</b>/{todayProgress.total}
              </p>
            </div>
            <button
              onClick={() => openAddPrefill()}
              className="flex shrink-0 items-center gap-2 rounded-full bg-[var(--accent-warm)] px-4 py-2 text-sm font-semibold text-[var(--on-accent)] shadow-sm transition-all hover:bg-[var(--accent-warm-hover)] hover:shadow-md"
            >
              <Plus size={15} strokeWidth={2.4} />新建任务
            </button>
          </header>
          <div className="mt-1 mb-7 h-[2px] w-48 rounded-full" style={{ background: 'linear-gradient(90deg, #b8943a 0%, rgba(184,148,58,0.15) 100%)' }} />

          {/* ── 今日指挥卡（hero） ── */}
          <section
            className="mb-6 grid grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] overflow-hidden rounded-xl border shadow-sm"
            style={{
              borderColor: 'var(--accent-warm-muted)',
              background: 'linear-gradient(120deg, var(--accent-warm-subtle) 0%, var(--accent-warm-subtle-a0) 46%), var(--paper-elevated)',
            }}
          >
            {/* 今日待办 + 进度 */}
            <div className="border-r border-[var(--line-subtle)] px-6 py-5">
              <div className="flex items-center gap-2 text-[0.6875rem] font-bold uppercase tracking-[.1em] text-[var(--accent-warm)]">
                <span className="h-[7px] w-[7px] rounded-full bg-[var(--accent-warm)] shadow-[0_0_0_3px_var(--accent-warm-subtle)]" />
                今日
              </div>
              <div className="mt-2 text-2xl font-extrabold tracking-[-.015em] text-[var(--ink)]">
                {fmtMD(todayStr)}
                <span className="ml-2 text-base font-semibold text-[var(--ink-muted)]">{weekdayOf(todayStr)}</span>
              </div>
              <div className="mt-4">
                <div className="flex items-center gap-1.5 text-xs text-[var(--ink-muted)]">
                  <b className="tabular-nums text-[var(--accent-warm)]">{todayProgress.total - todayProgress.done}</b> 项待办
                  <span className="text-[var(--ink-faint)]">·</span>
                  <b className="tabular-nums">{todayProgress.done}</b> 项已完成
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--paper-inset)]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[var(--accent-warm)] to-[var(--accent-warm-hover)] transition-all duration-500"
                    style={{ width: todayProgress.total ? `${(todayProgress.done / todayProgress.total) * 100}%` : '0%' }}
                  />
                </div>
              </div>
            </div>

            {/* 今日事项（事件 + 任务；备忘录 #4） */}
            <div className="px-6 py-5">
              <div className="text-[0.6875rem] font-bold uppercase tracking-[.08em] text-[var(--ink-muted)]">今日事项</div>
              <div className="mt-2.5 flex flex-col gap-0.5">
                {todayItems.length === 0 ? (
                  <div className="flex items-center gap-2.5 px-2.5 py-2 text-sm text-[var(--ink-muted)]">
                    <span className="h-[7px] w-[7px] rounded-full bg-[var(--ink-faint)]" />
                    今日暂无事件与到期任务
                  </div>
                ) : todayItems.map(item => (
                  <div key={item.key} className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-[var(--hover-bg)]">
                    <span className="w-[40px] shrink-0 font-mono text-xs font-semibold text-[var(--ink-secondary)]">{item.time ?? '全天'}</span>
                    <span
                      className="h-[7px] w-[7px] shrink-0 rounded-full"
                      style={{ background: item.urgent ? 'var(--error)' : item.kind === 'event' ? 'var(--accent-cool)' : 'var(--accent-warm)' }}
                      title={item.kind === 'event' ? '事件' : '任务'}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold leading-tight text-[var(--ink)]">
                        {item.kind === 'task' && <span className="mr-1 text-xs font-normal text-[var(--ink-muted)]">[任务]</span>}
                        {item.label}
                      </span>
                      <span className="block truncate text-xs text-[var(--ink-muted)]">{item.sub}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* 时间桶分布（下钻） */}
            <div className="col-span-2 flex flex-wrap items-center gap-1.5 border-t border-[var(--line-subtle)] px-6 py-2.5">
              <span className="mr-1 text-[0.6875rem] font-bold uppercase tracking-[.08em] text-[var(--ink-subtle)]">时间</span>
              <button
                onClick={() => setBucketFilter('all')}
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${
                  bucketFilter === 'all'
                    ? 'bg-[var(--ink)] text-[var(--paper)] shadow-sm'
                    : 'text-[var(--ink-muted)] hover:bg-[var(--paper-inset)] hover:text-[var(--ink)]'
                }`}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: bucketFilter === 'all' ? 'currentColor' : 'var(--ink-subtle)' }} />
                全部 <b className="tabular-nums">{openTaskCount}</b>
              </button>
              {BUCKETS.map(b => {
                const n = bucketCounts[b.key] ?? 0;
                if (!n) return null;
                const active = bucketFilter === b.key;
                return (
                  <button
                    key={b.key}
                    onClick={() => setBucketFilter(active ? 'all' : b.key)}
                    className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${
                      active
                        ? 'bg-[var(--ink)] text-[var(--paper)] shadow-sm'
                        : 'text-[var(--ink-muted)] hover:bg-[var(--paper-inset)] hover:text-[var(--ink)]'
                    }`}
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: active ? 'currentColor' : b.dot }} />
                    {b.label} <b className="tabular-nums">{n}</b>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ── 主体两栏 ── */}
          <div className="grid grid-cols-[minmax(0,1fr)_300px] items-start gap-6">
            {/* 左：台账 */}
            <section className="overflow-hidden rounded-xl border border-[var(--line-subtle)] bg-[var(--paper-elevated)] shadow-sm">
              {/* 工具栏 */}
              <div className="flex flex-wrap items-center gap-2 border-b border-[var(--line-subtle)] px-5 py-3.5">
                <h2 className="flex items-center gap-2 text-sm font-bold text-[var(--ink)]">
                  台账
                  <span className="rounded-full bg-[var(--paper-inset)] px-2 py-0.5 text-[0.6875rem] font-semibold text-[var(--ink-muted)]">{filtered.length}</span>
                </h2>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--ink-subtle)]" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="搜索任务 / 编号…"
                      className="h-[30px] w-[170px] rounded-lg border border-[var(--line)] bg-[var(--paper)] py-1.5 pl-7 pr-2.5 text-xs text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--ink-faint)] focus:border-[var(--accent-warm)] focus:ring-2 focus:ring-[var(--accent-warm)]/25"
                    />
                  </div>
                  <div className="w-[104px]">
                    <CustomSelect compact value={filterStatus} onChange={setFilterStatus}
                      options={[{ value: '', label: '全部状态' }, ...STATUS_OPTS]} />
                  </div>
                  <div className="w-[150px]">
                    <CustomSelect compact value={filterCase} onChange={setFilterCase}
                      options={[
                        { value: '', label: '全部案件' },
                        { value: '__none__', label: '独立任务' },
                        ...cases.filter(c => !c.archived).map(c => ({ value: c.caseId, label: `${c.caseId} · ${c.name}` })),
                        ...projects.filter(p => !p.archived).map(p => ({ value: p.projectId, label: `${p.projectId} · ${p.name.slice(0, 20)}` })),
                      ]} />
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-[var(--ink-muted)] transition-colors hover:bg-[var(--paper-inset)]">
                    <span
                      onClick={() => setShowDone(v => !v)}
                      className={`relative h-[16px] w-[27px] rounded-full transition-colors ${showDone ? 'bg-[var(--accent-warm)]' : 'bg-[var(--paper-inset)]'}`}
                    >
                      <span className={`absolute top-[2px] h-[12px] w-[12px] rounded-full bg-white shadow-sm transition-all ${showDone ? 'left-[13px]' : 'left-[2px]'}`} />
                    </span>
                    含已完成
                  </label>
                </div>
              </div>

              {/* 分组 */}
              <div className="px-3 py-1.5">
                {groups.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <ListChecks size={32} className="mb-4 text-[var(--ink-faint)]/60" />
                    <p className="text-sm text-[var(--ink-muted)]">没有符合条件的任务</p>
                    <p className="mt-1 text-xs text-[var(--ink-faint)]">调整筛选条件，或点右上角新建任务</p>
                  </div>
                ) : (
                  groups.map(g => {
                    const meta = BUCKETS.find(b => b.key === g.key)!;
                    return (
                      <div key={g.key} className="mb-1 last:mb-0">
                        <div className="mb-1.5 flex items-center gap-2.5 px-2.5 pt-3">
                          <span className="h-2 w-2 rounded-full" style={{ background: meta.dot }} />
                          <span className="text-xs font-bold uppercase tracking-[.06em] text-[var(--ink-muted)]">{meta.label}</span>
                          <span className="tabular-nums text-[0.6875rem] font-semibold text-[var(--ink-subtle)]">{g.tasks.length}</span>
                          <span className="h-px flex-1 bg-[var(--line-subtle)]" />
                        </div>
                        <div>
                          {g.tasks.map(t => <TaskItem key={t.key} t={t} />)}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </section>

            {/* 右：日历 + 关键日程 */}
            <aside className="flex flex-col gap-5">
              <section className="relative rounded-xl border border-[var(--line-subtle)] bg-[var(--paper-elevated)] p-4 shadow-sm">
                <div className="mb-3.5 flex items-center gap-1">
                  <button
                    onClick={calPrev}
                    className="flex h-6 w-6 items-center justify-center rounded-lg text-[var(--ink-faint)] transition-colors hover:bg-[var(--paper-inset)] hover:text-[var(--ink)]"
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <span className="flex-1 text-center text-sm font-bold text-[var(--ink)]">{calYear}年{calMonth + 1}月</span>
                  <button
                    onClick={calNext}
                    className="flex h-6 w-6 items-center justify-center rounded-lg text-[var(--ink-faint)] transition-colors hover:bg-[var(--paper-inset)] hover:text-[var(--ink)]"
                  >
                    <ChevronRight size={14} />
                  </button>
                  <button
                    onClick={backToday}
                    className="ml-1 rounded-full bg-[var(--accent-warm-subtle)] px-2 py-0.5 text-[0.6875rem] font-semibold text-[var(--accent-warm)] transition-colors hover:bg-[var(--accent-warm-muted)]"
                  >
                    回今天
                  </button>
                </div>
                <div className="grid grid-cols-7">
                  {['日', '一', '二', '三', '四', '五', '六'].map((d, i) => (
                    <div key={d} className={`py-1 text-center text-[0.625rem] font-semibold tracking-wide ${i === 0 || i === 6 ? 'text-[var(--ink-faint)]' : 'text-[var(--ink-subtle)]'}`}>{d}</div>
                  ))}
                </div>
                <div className="grid grid-cols-7">
                  {calDays.map((day, i) => {
                    const ds = day ? `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}` : '';
                    const items = ds ? calByDate.get(ds) ?? [] : [];
                    const isToday = ds === todayStr;
                    const isSel = popupDate === ds;
                    return (
                      <div key={i} className="flex flex-col items-center py-px">
                        {day ? (
                          <button
                            data-calday=""
                            onClick={() => items.length > 0 ? setPopupDate(ds) : openAddPrefill(ds)}
                            title={items.length ? items.map(it => it.label).join('、') : `在 ${fmtMD(ds)} 新建任务`}
                            className={`relative mx-auto flex h-8 w-8 items-center justify-center rounded-full text-xs transition-all ${
                              isToday
                                ? 'bg-[var(--accent-warm)] font-bold text-white shadow-sm'
                                : isSel
                                  ? 'bg-[var(--accent-warm-subtle)] ring-1 ring-inset ring-[var(--accent-warm)]'
                                  : 'text-[var(--ink-secondary)] hover:bg-[var(--paper-inset)]'
                            }`}
                          >
                            {day}
                            {items.length > 0 && (
                              <span className="absolute bottom-0.5 flex items-center gap-[3px]">
                                {items.slice(0, 2).map(it => (
                                  <span
                                    key={it.key}
                                    className="h-[3.5px] w-[3.5px] rounded-full"
                                    style={{ background: isToday ? 'var(--on-accent)' : it.dot }}
                                  />
                                ))}
                                {items.length > 2 && (
                                  <span className="text-[0.5rem] leading-none text-[var(--ink-subtle)]">+{items.length - 2}</span>
                                )}
                              </span>
                            )}
                          </button>
                        ) : <span className="h-8 w-8" />}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 flex justify-center gap-4 border-t border-dashed border-[var(--line-subtle)] pt-2.5">
                  <span className="flex items-center gap-1.5 text-[0.625rem] text-[var(--ink-subtle)]"><span className="h-1.5 w-1.5 rounded-full bg-[var(--error)]" />开庭/期限</span>
                  <span className="flex items-center gap-1.5 text-[0.625rem] text-[var(--ink-subtle)]"><span className="h-1.5 w-1.5 rounded-full bg-[var(--accent-cool)]" />调解/递交</span>
                  <span className="flex items-center gap-1.5 text-[0.625rem] text-[var(--ink-subtle)]"><span className="h-1.5 w-1.5 rounded-full bg-[var(--ink-faint)]" />任务截止</span>
                </div>

                {/* 日历日弹层（inline） */}
                {popupDate && popupItems.length > 0 && (
                  <div ref={popupRef} className="absolute inset-x-4 top-[104px] z-20 rounded-xl border border-[var(--line-strong)] bg-[var(--paper-elevated)] p-3.5 shadow-xl">
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="text-sm font-bold text-[var(--ink)]">
                        {fmtMD(popupDate)} <span className="ml-1.5 font-normal text-[var(--ink-muted)]">{weekdayOf(popupDate)}</span>
                      </h3>
                      <button onClick={() => setPopupDate(null)} className="flex h-5 w-5 items-center justify-center rounded-md text-[var(--ink-subtle)] transition-colors hover:bg-[var(--paper-inset)] hover:text-[var(--ink)]">
                        <X size={12} />
                      </button>
                    </div>
                    <button
                      onClick={() => { setPopupDate(null); openAddPrefill(popupDate); }}
                      className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-lg border-[1.5px] border-dashed border-[var(--line-strong)] py-2 text-xs text-[var(--ink-muted)] transition-colors hover:border-[var(--accent-warm)] hover:bg-[var(--accent-warm-subtle)] hover:text-[var(--accent-warm)]"
                    >
                      <Plus size={13} />在这天新建任务
                    </button>
                    <div className="max-h-[180px] space-y-0.5 overflow-y-auto">
                      {popupItems.map(it => (
                        <div key={it.key} className="flex items-start gap-2.5 rounded-lg px-2 py-1.5">
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: it.dot }} />
                          <div className="min-w-0 flex-1">
                            <p className={`truncate text-xs font-medium ${it.kind === 'task' ? 'text-[var(--ink)]' : 'text-[var(--ink)]'}`}>{it.label}</p>
                            {it.caseName && <p className="mt-px truncate text-[0.6875rem] text-[var(--ink-muted)]">{it.caseName}</p>}
                          </div>
                          <span className="shrink-0 rounded-md bg-[var(--paper-inset)] px-2 py-0.5 text-[0.625rem] font-medium text-[var(--ink-muted)]">{it.badge}</span>
                          {it.time && <span className="shrink-0 font-mono text-[0.6875rem] text-[var(--ink-subtle)]">{it.time}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>

              {/* 关键日程 */}
              <section className="rounded-xl border border-[var(--line-subtle)] bg-[var(--paper-elevated)] px-3 py-4 shadow-sm">
                <div className="mb-2 flex items-center gap-2 px-1">
                  <h3 className="text-sm font-bold text-[var(--ink)]">关键日程</h3>
                  <span className="rounded-full bg-[var(--paper-inset)] px-2 py-px text-[0.6875rem] font-semibold text-[var(--ink-muted)]">{keyDates.length}</span>
                </div>
                <div>
                  {keyDates.length === 0 ? (
                    <p className="py-8 text-center text-xs text-[var(--ink-faint)]">暂无未来关键节点</p>
                  ) : (
                    keyDates.slice(0, 8).map(e => {
                      const dd = daysUntil(e.date);
                      const urgent = dd <= 3 && (e.type === 'hearing' || e.type === 'arbitration' || e.type === 'evidence_deadline' || e.type === 'limitation_expiry');
                      const soon = dd === 0 || dd === 1;
                      const [, m, d] = e.date.split('-');
                      return (
                        <button
                          key={e.id}
                          onClick={() => openLinkedCase(e.caseId)}
                          className={`flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors ${
                            urgent
                              ? 'border-l-[3px] border-[var(--error)] bg-[var(--error-bg)]'
                              : soon
                                ? 'border-l-[3px] border-[var(--accent-warm)] hover:bg-[var(--hover-bg)]'
                                : 'border-l-[3px] border-transparent hover:bg-[var(--hover-bg)]'
                          }`}
                        >
                          <span className="w-[42px] shrink-0 rounded-lg bg-[var(--paper-inset)] px-1 py-1.5 text-center">
                            <span className={`block text-base font-bold leading-none ${urgent ? 'text-[var(--error)]' : 'text-[var(--ink)]'}`}>{+m}/{+d}</span>
                            <span className="mt-0.5 block text-[0.625rem] text-[var(--ink-subtle)]">{weekdayOf(e.date)}</span>
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className={`block truncate text-xs font-semibold ${urgent ? 'text-[var(--error)]' : 'text-[var(--ink)]'}`}>{e.label}</span>
                            <span className="block truncate text-[0.6875rem] text-[var(--ink-muted)]">{e.caseName}</span>
                          </span>
                          {e.time && <span className={`shrink-0 font-mono text-[0.6875rem] ${urgent ? 'text-[var(--error)]' : 'text-[var(--ink-subtle)]'}`}>{e.time}</span>}
                        </button>
                      );
                    })
                  )}
                </div>
              </section>
            </aside>
          </div>
        </div>
      </div>

      {/* ── 手机底部导航（桶筛选，仅窄屏渲染） ── */}
      {mobile && (
        <MobileNav
          items={[
            { key: 'all', label: '全部', icon: '☰', active: bucketFilter === 'all', onClick: () => setBucketFilter('all') },
            { key: 'overdue', label: '逾期', icon: '⚠', active: bucketFilter === 'overdue', count: bucketCounts.overdue ?? 0, onClick: () => setBucketFilter(bucketFilter === 'overdue' ? 'all' : 'overdue') },
            { key: 'today', label: '今天', icon: '●', active: bucketFilter === 'today', count: bucketCounts.today ?? 0, onClick: () => setBucketFilter(bucketFilter === 'today' ? 'all' : 'today') },
            { key: 'tomorrow', label: '明天', icon: '○', active: bucketFilter === 'tomorrow', count: bucketCounts.tomorrow ?? 0, onClick: () => setBucketFilter(bucketFilter === 'tomorrow' ? 'all' : 'tomorrow') },
            { key: 'future', label: '未来', icon: '▸', active: bucketFilter === 'future', count: bucketCounts.future ?? 0, onClick: () => setBucketFilter(bucketFilter === 'future' ? 'all' : 'future') },
            { key: 'none', label: '未排程', icon: '·', active: bucketFilter === 'none', count: bucketCounts.none ?? 0, onClick: () => setBucketFilter(bucketFilter === 'none' ? 'all' : 'none') },
          ]}
        />
      )}

      {/* ── 编辑抽屉 ── */}
      <TaskEditDrawer
        task={editTask}
        onClose={() => setEditTask(null)}
        onSave={handleDrawerSave}
        onDelete={handleDrawerDelete}
      />

      {/* ── 新建任务弹窗 ── */}
      {showAdd && (
        <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/20 pt-24 backdrop-blur-sm" data-agentlex-modal="" onClick={() => setShowAdd(false)}>
          <section
            className="w-[520px] rounded-2xl border border-[var(--line-subtle)] bg-[var(--paper-elevated)] p-6 shadow-xl"
            data-agentlex-modal-box=""
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-[var(--ink)]">新建任务</h3>
              <button onClick={() => setShowAdd(false)} className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--ink-faint)] transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--ink)]">
                <X size={15} />
              </button>
            </div>
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="输入任务名称…"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              className="mb-4 w-full rounded-lg bg-[var(--paper)] px-4 py-3 text-sm text-[var(--ink)] outline-none ring-1 ring-inset ring-[var(--line)] placeholder:text-[var(--ink-faint)] focus:ring-2 focus:ring-[var(--accent-warm)]/30"
            />
            <div className="mb-4 flex flex-wrap items-end gap-3">
              <div className="w-44">
                <label className="mb-1.5 block text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--ink-muted)]">关联案件</label>
                <CustomSelect
                  value={newCaseId}
                  onChange={(v) => { setNewCaseId(v); setNewGroupId(''); }}
                  options={[
                    { value: '', label: '独立任务' },
                    ...cases.filter(c => !c.archived).map(c => ({ value: c.caseId, label: `${c.caseId} · ${c.name}` })),
                  ]}
                />
              </div>
              {newCaseId && (
                <div className="w-36">
                  <label className="mb-1.5 block text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--ink-muted)]">任务阶段</label>
                  <CustomSelect
                    value={newGroupId}
                    onChange={setNewGroupId}
                    options={newCaseGroups.length > 0 ? newCaseGroups.map(g => ({ value: g.id, label: g.title })) : [{ value: '', label: '暂无阶段' }]}
                  />
                </div>
              )}
              <div className="w-36">
                <label className="mb-1.5 block text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--ink-muted)]">截止日期</label>
                <input
                  type="date"
                  value={newDeadline}
                  onChange={(e) => setNewDeadline(e.target.value)}
                  className="w-full rounded-lg bg-[var(--paper)] px-3 py-2.5 text-sm text-[var(--ink)] outline-none ring-1 ring-inset ring-[var(--line)] focus:ring-2 focus:ring-[var(--accent-warm)]/30"
                />
              </div>
              <div className="w-28">
                <label className="mb-1.5 block text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--ink-muted)]">时间</label>
                <input
                  type="time"
                  value={newTime}
                  onChange={(e) => setNewTime(e.target.value)}
                  className="w-full rounded-lg bg-[var(--paper)] px-3 py-2.5 text-sm text-[var(--ink)] outline-none ring-1 ring-inset ring-[var(--line)] focus:ring-2 focus:ring-[var(--accent-warm)]/30"
                />
              </div>
              <div className="w-24">
                <label className="mb-1.5 block text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--ink-muted)]">优先级</label>
                <CustomSelect value={newPriority} onChange={(v) => setNewPriority(v as TaskPriority)} options={PRIORITY_OPTS} />
              </div>
              <div className="w-28">
                <label className="mb-1.5 block text-[0.6875rem] font-semibold uppercase tracking-wider text-[var(--ink-muted)]">类型</label>
                <CustomSelect
                  value={newType}
                  onChange={(v) => setNewType(v as 'event' | 'task' | 'both')}
                  options={[
                    { value: 'task', label: '任务' },
                    { value: 'event', label: '事件' },
                    { value: 'both', label: '事件+任务' },
                  ]}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowAdd(false)} className="rounded-lg px-4 py-2 text-sm text-[var(--ink-muted)] transition-colors hover:bg-[var(--hover-bg)] hover:text-[var(--ink)]">取消</button>
              <button
                onClick={handleAdd}
                disabled={!newTitle.trim() || (!!newCaseId && newCaseGroups.length === 0)}
                className="rounded-lg bg-[var(--accent-warm)] px-5 py-2 text-sm font-semibold text-[var(--on-accent)] shadow-sm transition-opacity hover:opacity-90 disabled:opacity-30"
              >
                添加任务
              </button>
            </div>
            {newCaseId && newCaseGroups.length === 0 && (
              <p className="mt-3 text-xs text-[var(--warning)]">该案件还没有任务阶段，请先在案件详情页添加。</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
});
