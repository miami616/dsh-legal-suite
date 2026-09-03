/**
 * Task-management panel — AgentLex unified task center. Owns the data fetch +
 * registry-changed subscription, an add-task row (standalone tasks), and a
 * filterable list (source / status / sort / search) with per-row status
 * toggle + delete for standalone tasks.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TaskItem } from '../store/types.ts'
import * as api from './api.ts'
import type { PanelController } from './controller.ts'
import { errorMessage, tt } from './i18n.ts'
import { useIsMobile } from './use-mobile.ts'
import { TaskDetailDrawer } from './TaskDetailDrawer.tsx'
import css from './panel.module.css'
import mobileCss from './mobile.module.css'

interface TaskPanelProps {
  controller: PanelController
}

const SOURCE_FILTERS: { value: TaskItem['source'] | 'all'; labelKey: string }[] = [
  { value: 'all', labelKey: 'board.all' },
  { value: 'standalone', labelKey: 'source.standalone' },
  { value: 'litigation', labelKey: 'source.litigation' },
  { value: 'nonlitigation', labelKey: 'source.nonlitigation' },
]

const STATUS_FILTERS: { id: TaskItem['status'] | 'all'; labelKey: string }[] = [
  { id: 'all', labelKey: 'status.all' },
  { id: 'todo', labelKey: 'status.todo' },
  { id: 'doing', labelKey: 'status.doing' },
  { id: 'done', labelKey: 'status.done' },
]

type SortKey = 'recent' | 'deadline' | 'priority'

const SORT_OPTIONS: { value: SortKey; labelKey: string }[] = [
  { value: 'recent', labelKey: 'board.sortRecent' },
  { value: 'deadline', labelKey: 'board.sortDeadline' },
  { value: 'priority', labelKey: 'board.sortPriority' },
]

const SOURCE_LABEL: Record<string, string> = {
  standalone: 'source.standalone', litigation: 'source.litigation', nonlitigation: 'source.nonlitigation',
}

function nextStatus(s: TaskItem['status']): TaskItem['status'] {
  return s === 'todo' ? 'doing' : s === 'doing' ? 'done' : 'todo'
}

function daysUntil(date: string | undefined): number {
  if (!date) return Infinity
  const now = new Date()
  // 兼容纯日期与带时分（`YYYY-MM-DD HH:mm` / `YYYY-MM-DDTHH:mm`）两种形态，
  // 只取日期部分做倒计时，避免带时分时 new Date 解析失败返回 NaN。
  const m = String(date).trim().match(/^(\d{4}-\d{2}-\d{2})/)
  const dateOnly = m ? m[1] : String(date)
  const target = new Date(`${dateOnly}T00:00:00`)
  return Math.round((target.getTime() - now.getTime()) / 86400000)
}

/**
 * 把 deadline 渲染成「具体时间点」：纯日期显示为 MM-DD，带时分（如
 * `2026-09-10T15:10` 或 `2026-09-10 15:10`）则显示 MM-DD HH:mm。
 * 这是 #8 的核心：非诉/独立任务即便设了 deadline，也要像诉讼任务一样
 * 看到具体时间点，而不是只看到「X d」倒计时。
 */
function formatDeadline(date: string | undefined): string {
  if (!date) return ''
  const t = date.trim()
  // 兼容 `YYYY-MM-DD HH:mm` 与 `YYYY-MM-DDTHH:mm` 两种带时分形态。
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/)
  if (!m) return t
  const [, , mm, dd, hh, mi] = m
  const datePart = `${mm}-${dd}`
  return hh !== undefined ? `${datePart} ${hh}:${mi}` : datePart
}

/**
 * 从 detail 自然语言里提取具体时间（HH:MM），无则 undefined。
 * 与 push 域 extractTimeFromDetail 同规则：非诉/独立任务的 deadline 只存
 * 纯日期，具体时间点写在 detail（如「9月4日下午3点10分开会」）。
 */
function extractTimeFromDetail(detail: string | undefined): string | undefined {
  if (detail === undefined || detail === '') return undefined
  const text = detail.trim()
  const colon = /(?:^|[^0-9])(\d{1,2}):(\d{2})(?:[^0-9]|$)/.exec(text)
  if (colon !== null) {
    const h = Number(colon[1])
    const min = Number(colon[2])
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
    }
  }
  const cn = /(?:下午|晚上|上午|早上|凌晨)?(\d{1,2})\s*[点时]\s*((?:\d{1,2}\s*分?)|半)?/.exec(text)
  if (cn !== null) {
    let h = Number(cn[1])
    let min = 0
    if (cn[2] !== undefined && cn[2] !== '') {
      if (cn[2] === '半') min = 30
      else {
        const minNum = Number(cn[2].replace(/分/g, '').trim())
        if (!Number.isNaN(minNum)) min = minNum
      }
    }
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) {
      if (/下午|晚上/.test(text) && h < 12) h += 12
      if (/凌晨/.test(text) && h === 12) h = 0
      return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
    }
  }
  return undefined
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 }

export function TaskPanel({ controller }: TaskPanelProps): React.JSX.Element {
  const mobile = useIsMobile()
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [newDeadline, setNewDeadline] = useState('')
  const [newTime, setNewTime] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState<TaskItem['source'] | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<TaskItem['status'] | 'all'>('all')
  const [sortKey, setSortKey] = useState<SortKey>('recent')
  const [openMenu, setOpenMenu] = useState<'source' | 'status' | 'sort' | null>(null)
  const [drawerTask, setDrawerTask] = useState<TaskItem | null>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const bootedRef = useRef(false)

  const refresh = useCallback(async () => {
    try {
      const list = await api.unifiedTasks()
      setTasks(list)
      setError('')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (bootedRef.current) return
    bootedRef.current = true
    void refresh()
  }, [refresh])

  useEffect(() => {
    const onChanged = (): void => { void refresh() }
    window.addEventListener('agentlex:registry-changed', onChanged)
    return () => window.removeEventListener('agentlex:registry-changed', onChanged)
  }, [refresh])

  useEffect(() => {
    if (!openMenu) return
    const h = (e: MouseEvent): void => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) setOpenMenu(null)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [openMenu])

  const addTask = async (): Promise<void> => {
    const title = newTitle.trim()
    if (title === '') return
    try {
      await api.upsertTask({
        title,
        deadline: newDeadline === '' ? undefined : newDeadline,
        time: newTime.trim() === '' ? undefined : newTime.trim(),
      })
      setNewTitle('')
      setNewDeadline('')
      setNewTime('')
      await refresh()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const toggleStatus = async (task: TaskItem): Promise<void> => {
    try {
      // Standalone tasks update in the task store; litigation / non-litigation
      // tasks write through to the source case/project store (bidirectional sync).
      await api.upsertTask({
        id: task.id,
        status: nextStatus(task.status),
        source: task.source,
        sourceId: task.sourceId,
        groupId: task.groupId,
      })
      await refresh()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const removeTask = async (task: TaskItem): Promise<void> => {
    if (task.source !== undefined && task.source !== 'standalone') return
    try {
      await api.deleteTask(task.id)
      await refresh()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const visible = useMemo(() => {
    let list = tasks
    if (sourceFilter !== 'all') list = list.filter((t) => (t.source ?? 'standalone') === sourceFilter)
    if (statusFilter !== 'all') list = list.filter((t) => t.status === statusFilter)
    if (searchQuery.trim() !== '') {
      const q = searchQuery.trim().toLowerCase()
      list = list.filter((t) => [t.title, t.detail, t.sourceName].filter(Boolean).join(' ').toLowerCase().includes(q))
    }
    const sorted = [...list]
    switch (sortKey) {
      case 'recent': sorted.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')); break
      case 'deadline': sorted.sort((a, b) => (a.deadline ?? '9999-99-99').localeCompare(b.deadline ?? '9999-99-99')); break
      case 'priority': sorted.sort((a, b) => (PRIORITY_ORDER[a.priority ?? 'medium'] ?? 1) - (PRIORITY_ORDER[b.priority ?? 'medium'] ?? 1)); break
    }
    return sorted
  }, [tasks, sourceFilter, statusFilter, searchQuery, sortKey])

  const stats = useMemo(() => {
    const todo = tasks.filter((t) => t.status === 'todo').length
    const doing = tasks.filter((t) => t.status === 'doing').length
    const done = tasks.filter((t) => t.status === 'done').length
    const overdue = tasks.filter((t) => t.status !== 'done' && t.deadline && t.deadline < todayStr()).length
    return { total: tasks.length, todo, doing, done, overdue }
  }, [tasks])

  const countBySource = (v: TaskItem['source']): number => tasks.filter((t) => (t.source ?? 'standalone') === v).length
  const countByStatus = (v: TaskItem['status']): number => tasks.filter((t) => t.status === v).length

  const dimBtn = (active: boolean, open: boolean): string => `${css.dropBtn} ${open ? css.dropBtnOpen : active ? css.dropBtnActive : ''}`

  return (
    <div className={`${css.panel} ${mobile ? mobileCss.panelMobile : ''}`}>
      <header className={`${css.header} ${mobile ? mobileCss.headerMobile : ''}`}>
        <h1 className={css.title}>{tt('panel.title')}</h1>
        {!mobile && <span className={css.subtitle}>{tt('panel.subtitle')}</span>}
        <button className={css.close} type="button" aria-label="Close" onClick={() => controller.close()}>✕</button>
      </header>

      <div className={css.center}>
        <div className={css.addRow}>
          <input
            className={css.input}
            value={newTitle}
            placeholder={tt('add.placeholder')}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void addTask() }} />
          <input
            className={css.addDate}
            type="date"
            value={newDeadline}
            onChange={(e) => setNewDeadline(e.target.value)}
            title="截止日期" />
          <input
            className={css.addTime}
            type="time"
            value={newTime}
            onChange={(e) => setNewTime(e.target.value)}
            title="具体时间" />
          <button className={css.primaryBtn} type="button" onClick={() => void addTask()}>{tt('add.btn')}</button>
        </div>

        {stats.total > 0 && (
          <div className={css.statsBar}>
            <div className={css.statBlock}><span className={css.statNum}>{stats.total}</span><span className={css.statLabel}>{tt('stats.total')}</span></div>
            <span className={css.statDivider} />
            <div className={css.statBlock}><span className={css.statNumAccent}>{stats.todo}</span><span className={css.statLabel}>{tt('stats.todo')}</span></div>
            <div className={css.statBlock}><span className={css.statNumCool}>{stats.doing}</span><span className={css.statLabel}>{tt('stats.doing')}</span></div>
            <div className={css.statBlock}><span className={css.statNumSuccess}>{stats.done}</span><span className={css.statLabel}>{tt('stats.done')}</span></div>
            <div className={css.statsRight}>
              {stats.overdue > 0 && (
                <button className={css.urgentStat} type="button"><span className={css.urgentNum}>{stats.overdue}</span><span className={css.urgentLabel}>{tt('stats.overdue')}</span></button>
              )}
            </div>
          </div>
        )}

        <div ref={toolbarRef} className={css.toolbar}>
          <div className={css.searchBox}>
            <span className={css.searchIcon} aria-hidden>🔍</span>
            <input className={css.searchInput} placeholder={tt('board.search')} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
            {searchQuery !== '' && <button className={css.clearSearch} type="button" onClick={() => setSearchQuery('')}>✕</button>}
          </div>
          <div className={css.toolbarActions}>
            <div className={css.dropWrap}>
              <button type="button" className={dimBtn(sourceFilter !== 'all', openMenu === 'source')} onClick={() => setOpenMenu(openMenu === 'source' ? null : 'source')}>
                {sourceFilter !== 'all' ? <>{tt(SOURCE_LABEL[sourceFilter as string])}<button className={css.dropClear} type="button" onClick={(e) => { e.stopPropagation(); setSourceFilter('all') }}>×</button></> : <>{tt('board.source')} <span className={css.dropChevron}>▾</span></>}
              </button>
              {openMenu === 'source' && (
                <div className={css.dropPanel}>
                  {SOURCE_FILTERS.map((f) => (
                    <button key={f.value} type="button" className={sourceFilter === f.value ? `${css.dropOption} ${css.dropOptionActive}` : css.dropOption} onClick={() => { setSourceFilter(f.value); setOpenMenu(null) }}>
                      <span>{tt(f.labelKey)}</span>
                      {f.value !== 'all' && <span className={css.dropOptionCount}>{countBySource(f.value)}</span>}
                      {sourceFilter === f.value && <span className={css.dropCheck}>✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className={css.dropWrap}>
              <button type="button" className={dimBtn(statusFilter !== 'all', openMenu === 'status')} onClick={() => setOpenMenu(openMenu === 'status' ? null : 'status')}>
                {statusFilter !== 'all' ? <>{tt(statusLabelKey(statusFilter))}<button className={css.dropClear} type="button" onClick={(e) => { e.stopPropagation(); setStatusFilter('all') }}>×</button></> : <>{tt('board.status')} <span className={css.dropChevron}>▾</span></>}
              </button>
              {openMenu === 'status' && (
                <div className={css.dropPanel}>
                  {STATUS_FILTERS.map((f) => (
                    <button key={f.id} type="button" className={statusFilter === f.id ? `${css.dropOption} ${css.dropOptionActive}` : css.dropOption} onClick={() => { setStatusFilter(f.id); setOpenMenu(null) }}>
                      <span className={`${css.statusPill} ${css[`tone-${toneOf(f.id)}`]}`}>{tt(f.labelKey)}</span>
                      {f.id !== 'all' && <span className={css.dropOptionCount}>{countByStatus(f.id)}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className={css.dropWrap}>
              <button type="button" className={dimBtn(false, openMenu === 'sort')} onClick={() => setOpenMenu(openMenu === 'sort' ? null : 'sort')}>
                {tt('board.sortBy')}{tt(SORT_OPTIONS.find((o) => o.value === sortKey)?.labelKey ?? 'board.sortRecent')} <span className={css.dropChevron}>▾</span>
              </button>
              {openMenu === 'sort' && (
                <div className={css.dropPanel}>
                  {SORT_OPTIONS.map((o) => (
                    <button key={o.value} type="button" className={sortKey === o.value ? `${css.dropOption} ${css.dropOptionActive}` : css.dropOption} onClick={() => { setSortKey(o.value); setOpenMenu(null) }}>
                      <span>{tt(o.labelKey)}</span>
                      {sortKey === o.value && <span className={css.dropCheck}>✓</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {loading ? (
          <div className={css.empty}><p className={css.muted}>…</p></div>
        ) : error !== '' && tasks.length === 0 ? (
          <div className={css.empty}><p className={css.error}>{error}</p></div>
        ) : tasks.length === 0 ? (
          <div className={css.empty}><div className={css.emptyIcon}>✓</div><p>{tt('empty')}</p></div>
        ) : visible.length === 0 ? (
          <div className={css.empty}><p>{tt('emptyNoMatch')}</p></div>
        ) : (
          <div className={css.list}>
            {visible.map((t) => (
              <TaskRow key={t.id} task={t} onToggle={() => { void toggleStatus(t) }} onDelete={() => { void removeTask(t) }} onOpen={mobile ? () => setDrawerTask(t) : undefined} />
            ))}
          </div>
        )}
      </div>

      {mobile && (
        <nav className={mobileCss.bottomNav}>
          <button
            type="button"
            className={`${mobileCss.navItem} ${statusFilter === 'all' ? mobileCss.navItemActive : ''}`}
            onClick={() => setStatusFilter('all')}
          >
            <span className={mobileCss.navIcon}>☰</span>
            <span>{tt('status.all')}</span>
            <span className={mobileCss.navCount}>{stats.total}</span>
          </button>
          <button
            type="button"
            className={`${mobileCss.navItem} ${statusFilter === 'todo' ? mobileCss.navItemActive : ''}`}
            onClick={() => setStatusFilter(statusFilter === 'todo' ? 'all' : 'todo')}
          >
            <span className={mobileCss.navIcon}>○</span>
            <span>{tt('status.todo')}</span>
            <span className={mobileCss.navCount}>{stats.todo}</span>
          </button>
          <button
            type="button"
            className={`${mobileCss.navItem} ${statusFilter === 'doing' ? mobileCss.navItemActive : ''}`}
            onClick={() => setStatusFilter(statusFilter === 'doing' ? 'all' : 'doing')}
          >
            <span className={mobileCss.navIcon}>◐</span>
            <span>{tt('status.doing')}</span>
            <span className={mobileCss.navCount}>{stats.doing}</span>
          </button>
          <button
            type="button"
            className={`${mobileCss.navItem} ${statusFilter === 'done' ? mobileCss.navItemActive : ''}`}
            onClick={() => setStatusFilter(statusFilter === 'done' ? 'all' : 'done')}
          >
            <span className={mobileCss.navIcon}>✓</span>
            <span>{tt('status.done')}</span>
            <span className={mobileCss.navCount}>{stats.done}</span>
          </button>
        </nav>
      )}

      {drawerTask !== null && (
        <TaskDetailDrawer task={drawerTask} onClose={() => setDrawerTask(null)} onChange={refresh} />
      )}
    </div>
  )
}

function TaskRow({ task, onToggle, onDelete, onOpen }: { task: TaskItem; onToggle: () => void; onDelete: () => void; onOpen?: () => void }): React.JSX.Element {
  // Status toggle is always available (litigation / non-litigation tasks write
  // through to their source); delete stays standalone-only.
  const deletable = task.source === undefined || task.source === 'standalone'
  const done = task.status === 'done'
  const deadline = task.deadline ? daysUntil(task.deadline) : null
  const deadlineCls = deadline === null ? css.deadlineNeutral : done ? css.deadlineNeutral : deadline < 0 ? css.deadlineUrgent : deadline <= 3 ? css.deadlineUrgent : deadline <= 7 ? css.deadlineSoon : css.deadlineNeutral
  const deadlineText = deadline === null ? '' : deadline < 0 ? `逾期 ${-deadline}d` : deadline === 0 ? tt('detail.today') : `${deadline}d`
  // 具体时间点：显示实际日期 + 具体时间。优先取独立的 time 字段，无则从
  // detail 里提取（如「下午3点10分」），让非诉/独立任务也能看到时间点。
  const deadlineDate = formatDeadline(task.deadline)
  const detailTime = task.time?.trim() ?? extractTimeFromDetail(task.detail)
  const showTime = detailTime !== undefined && detailTime !== '' && !/:\d{2}$/.test(deadlineDate)
  const source = (task.source ?? 'standalone') as Exclude<TaskItem['source'], undefined>
  const sourceCls = source === 'litigation' ? css.sourceLitigation : source === 'nonlitigation' ? css.sourceNonlitigation : css.sourceStandalone

  const rowProps = onOpen !== undefined
    ? { onClick: onOpen, role: 'button' as const, tabIndex: 0, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } } }
    : {}

  return (
    <div className={done ? `${css.taskRow} ${css.taskRowDone}` : css.taskRow} {...rowProps}>
      <button
        className={`${css.statusToggle} ${done ? css.toggleDone : task.status === 'doing' ? css.toggleDoing : css.toggleTodo}`}
        type="button"
        onClick={(e) => { e.stopPropagation(); onToggle() }}
        title={tt('board.status')}
        disabled={false}>
        {done ? '✓' : task.status === 'doing' ? '◐' : ''}
      </button>
      <div className={css.taskBody}>
        <div className={done ? `${css.taskTitle} ${css.taskTitleDone}` : css.taskTitle}>{task.title}</div>
        <div className={css.taskSub}>
          <span className={`${css.sourceTag} ${sourceCls}`}>{tt(SOURCE_LABEL[source])}</span>
          {task.sourceName && <span>{task.sourceName}</span>}
          {task.detail && <span className={css.mono}>{task.detail}</span>}
        </div>
      </div>
      <div className={css.taskMeta}>
        {task.priority && task.priority !== 'medium' && <span className={`${css.priority} ${css[`priority${cap(task.priority)}`]}`}>{task.priority}</span>}
        {deadline !== null && (
          <span className={`${css.deadline} ${deadlineCls}`} title={task.deadline}>
            {deadlineDate}
            {showTime && <span className={css.deadlineTime}>{detailTime}</span>}
            <span className={css.deadlineCount}>{deadlineText}</span>
          </span>
        )}
        {onOpen !== undefined && <span className={css.rowChevron} aria-hidden>›</span>}
        <button className={css.deleteBtn} type="button" aria-label="删除" disabled={!deletable} onClick={(e) => { e.stopPropagation(); onDelete() }}>✕</button>
      </div>
    </div>
  )
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function toneOf(s: TaskItem['status'] | 'all'): 'neutral' | 'info' | 'accent' | 'success' {
  return s === 'done' ? 'success' : s === 'doing' ? 'accent' : s === 'todo' ? 'info' : 'neutral'
}

function statusLabelKey(s: TaskItem['status'] | 'all'): string {
  return s === 'all' ? 'status.all' : s === 'done' ? 'status.done' : s === 'doing' ? 'status.doing' : 'status.todo'
}
