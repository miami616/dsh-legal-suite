/**
 * Task tree — the work-breakdown structure for a case: task groups (阶段) →
 * tasks (with status / priority / deadline) → subtasks → checklist items.
 *
 * Self-contained (api.ts + registry-changed refresh), matching the AgentLex
 * product intent without its agent / project coupling.
 */
import { useState } from 'react'
import type { CaseRecord, CaseTask, TaskGroup } from '../../store/types.ts'
import * as api from '../api.ts'
import { relativeDays } from '../case-format.ts'
import { errorMessage, tt } from '../i18n.ts'
import css from './tasktree.module.css'

type Status = CaseTask['status']
type Priority = NonNullable<CaseTask['priority']>

const STATUS_LABELS: Record<Status, string> = { todo: '待办', doing: '进行中', done: '已完成' }
const PRIORITY_LABELS: Record<Priority, string> = { low: '低', medium: '中', high: '高' }

interface TaskTreeProps {
  record: CaseRecord
  onChange: () => void
}

export function TaskTree({ record, onChange }: TaskTreeProps): React.JSX.Element {
  const [error, setError] = useState('')

  const reportError = (err: unknown): void => setError(errorMessage(err))

  const refresh = (): void => { setError(''); onChange() }

  /* ----------------------------- group ops ----------------------------- */
  const addGroup = async (name: string): Promise<void> => {
    try { await api.upsertTaskGroup(record.caseId, { name }); refresh() } catch (err) { reportError(err) }
  }
  const renameGroup = async (groupId: string, name: string): Promise<void> => {
    try { await api.upsertTaskGroup(record.caseId, { id: groupId, name }); refresh() } catch (err) { reportError(err) }
  }
  const deleteGroup = async (groupId: string): Promise<void> => {
    try { await api.deleteTaskGroup(record.caseId, groupId); refresh() } catch (err) { reportError(err) }
  }
  const reorderGroup = async (groupId: string, dir: -1 | 1): Promise<void> => {
    const groups = [...(record.taskGroups ?? [])]
    const idx = groups.findIndex((g) => g.id === groupId)
    const target = idx + dir
    if (idx < 0 || target < 0 || target >= groups.length) return
    const [g] = groups.splice(idx, 1)
    groups.splice(target, 0, g)
    try { await api.reorderTaskGroups(record.caseId, groups.map((x) => x.id)); refresh() } catch (err) { reportError(err) }
  }

  /* ----------------------------- task ops ------------------------------ */
  const addTask = async (groupId: string, title: string): Promise<void> => {
    try { await api.upsertTask(record.caseId, groupId, { title }); refresh() } catch (err) { reportError(err) }
  }
  const updateTask = async (groupId: string, taskId: string, patch: Partial<CaseTask>): Promise<void> => {
    try { await api.upsertTask(record.caseId, groupId, { id: taskId, ...patch }); refresh() } catch (err) { reportError(err) }
  }
  const deleteTask = async (groupId: string, taskId: string): Promise<void> => {
    try { await api.deleteTask(record.caseId, groupId, taskId); refresh() } catch (err) { reportError(err) }
  }
  const toggleTaskKeyDate = async (groupId: string, taskId: string, enabled: boolean): Promise<void> => {
    try { await api.setTaskKeyDate(record.caseId, groupId, taskId, enabled); refresh() } catch (err) { reportError(err) }
  }

  /* ---------------------------- subtask ops ---------------------------- */
  const addSubtask = async (groupId: string, taskId: string, title: string): Promise<void> => {
    try { await api.upsertSubtask(record.caseId, groupId, taskId, { title }); refresh() } catch (err) { reportError(err) }
  }
  const toggleSubtask = async (groupId: string, taskId: string, subtaskId: string): Promise<void> => {
    try {
      const task = record.taskGroups?.find((g) => g.id === groupId)?.tasks.find((t) => t.id === taskId)
      const sub = task?.subtasks?.find((s) => s.id === subtaskId)
      if (!sub) return
      await api.upsertSubtask(record.caseId, groupId, taskId, { id: subtaskId, done: !sub.done })
      refresh()
    } catch (err) { reportError(err) }
  }
  const deleteSubtask = async (groupId: string, taskId: string, subtaskId: string): Promise<void> => {
    try { await api.deleteSubtask(record.caseId, groupId, taskId, subtaskId); refresh() } catch (err) { reportError(err) }
  }

  /* ---------------------------- checklist ops -------------------------- */
  const toggleChecklist = async (groupId: string, taskId: string, checklistId: string): Promise<void> => {
    try { await api.toggleChecklist(record.caseId, groupId, taskId, checklistId); refresh() } catch (err) { reportError(err) }
  }

  const groups = record.taskGroups ?? []

  return (
    <div className={css.tree}>
      {error !== '' && <p className={css.treeError}>{error}</p>}
      {groups.length === 0 ? (
        <div className={css.treeEmpty}>
          <p>{tt('tasks.empty')}</p>
        </div>
      ) : (
        <div className={css.groups}>
          {groups.map((group) => (
            <GroupBlock
              key={group.id}
              group={group}
              caseId={record.caseId}
              onRename={renameGroup}
              onDelete={deleteGroup}
              onMove={reorderGroup}
              onAddTask={addTask}
              onUpdateTask={updateTask}
              onDeleteTask={deleteTask}
              onToggleKeyDate={toggleTaskKeyDate}
              onAddSubtask={addSubtask}
              onToggleSubtask={toggleSubtask}
              onDeleteSubtask={deleteSubtask}
              onToggleChecklist={toggleChecklist}
            />
          ))}
        </div>
      )}
      <GroupAdd onAdd={addGroup} />
    </div>
  )
}

/* ------------------------------------------------------------------ group */

interface GroupBlockProps {
  group: TaskGroup
  caseId: string
  onRename: (groupId: string, name: string) => void
  onDelete: (groupId: string) => void
  onMove: (groupId: string, dir: -1 | 1) => void
  onAddTask: (groupId: string, title: string) => void
  onUpdateTask: (groupId: string, taskId: string, patch: Partial<CaseTask>) => void
  onDeleteTask: (groupId: string, taskId: string) => void
  onToggleKeyDate: (groupId: string, taskId: string, enabled: boolean) => void
  onAddSubtask: (groupId: string, taskId: string, title: string) => void
  onToggleSubtask: (groupId: string, taskId: string, subtaskId: string) => void
  onDeleteSubtask: (groupId: string, taskId: string, subtaskId: string) => void
  onToggleChecklist: (groupId: string, taskId: string, checklistId: string) => void
}

function GroupBlock(props: GroupBlockProps): React.JSX.Element {
  const { group, onRename, onDelete, onMove } = props
  const [nameDraft, setNameDraft] = useState(group.name)
  const done = group.tasks.filter((t) => t.status === 'done').length

  return (
    <section className={css.group}>
      <header className={css.groupHeader}>
        <input
          className={css.groupName}
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={() => { if (nameDraft.trim() !== '' && nameDraft !== group.name) onRename(group.id, nameDraft.trim()) }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        />
        <span className={css.groupCount}>{done}/{group.tasks.length}</span>
        <div className={css.groupActions}>
          <button type="button" className={css.iconBtn} onClick={() => onMove(group.id, -1)} title={tt('tasks.moveUp')}>↑</button>
          <button type="button" className={css.iconBtn} onClick={() => onMove(group.id, 1)} title={tt('tasks.moveDown')}>↓</button>
          <button type="button" className={css.iconBtnDanger} onClick={() => onDelete(group.id)} title={tt('tasks.deleteGroup')}>✕</button>
        </div>
      </header>
      <div className={css.taskList}>
        {group.tasks.map((task) => (
          <TaskRow key={task.id} {...props} groupId={group.id} task={task} />
        ))}
      </div>
      <InlineAdd placeholder={tt('tasks.addTask')} onAdd={(title) => props.onAddTask(group.id, title)} />
    </section>
  )
}

/* ------------------------------------------------------------------- task */

interface TaskRowProps {
  groupId: string
  task: CaseTask
  onUpdateTask: (groupId: string, taskId: string, patch: Partial<CaseTask>) => void
  onDeleteTask: (groupId: string, taskId: string) => void
  onAddSubtask: (groupId: string, taskId: string, title: string) => void
  onToggleSubtask: (groupId: string, taskId: string, subtaskId: string) => void
  onDeleteSubtask: (groupId: string, taskId: string, subtaskId: string) => void
  onToggleChecklist: (groupId: string, taskId: string, checklistId: string) => void
  onToggleKeyDate: (groupId: string, taskId: string, enabled: boolean) => void
}

function TaskRow({ groupId, task, onUpdateTask, onDeleteTask, onAddSubtask, onToggleSubtask, onDeleteSubtask, onToggleChecklist, onToggleKeyDate }: TaskRowProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const [titleDraft, setTitleDraft] = useState(task.title)
  const [addingSubtask, setAddingSubtask] = useState(false)
  const [subtaskDraft, setSubtaskDraft] = useState('')

  const subtasks = task.subtasks ?? []
  const checklist = task.checklist ?? []
  const checkDone = checklist.filter((c) => c.done).length
  const overdue = task.deadline !== undefined && task.deadline < new Date().toISOString().slice(0, 10) && task.status !== 'done'

  const cycleStatus = (): void => {
    const next: Status = task.status === 'todo' ? 'doing' : task.status === 'doing' ? 'done' : 'todo'
    onUpdateTask(groupId, task.id, { status: next })
  }

  const addSubtask = (): void => {
    const title = subtaskDraft.trim()
    if (title === '') return
    onAddSubtask(groupId, task.id, title)
    setSubtaskDraft('')
  }

  const hasChildren = subtasks.length > 0 || checklist.length > 0

  return (
    <div className={css.task}>
      <div className={css.taskRow}>
        <button type="button" className={css.statusToggle} onClick={cycleStatus} title={tt('tasks.cycleStatus')} aria-label={STATUS_LABELS[task.status]}>
          {task.status === 'done' ? '✓' : task.status === 'doing' ? '◐' : '○'}
        </button>
        <input
          className={task.status === 'done' ? `${css.taskTitle} ${css.taskTitleDone}` : css.taskTitle}
          value={titleDraft}
          onChange={(e) => setTitleDraft(e.target.value)}
          onBlur={() => { if (titleDraft.trim() !== '' && titleDraft !== task.title) onUpdateTask(groupId, task.id, { title: titleDraft.trim() }) }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        />
        <span className={overdue ? css.deadlineOverdue : css.deadline}>
          {task.deadline ? `${task.deadline.slice(0, 10)} (${relativeDays(task.deadline.slice(0, 10))})` : ''}
        </span>
        <span className={`${css.priority} ${css[`p-${task.priority ?? 'medium'}`]}`}>{PRIORITY_LABELS[task.priority ?? 'medium']}</span>
        {task.remindKeyDate === true && (
          <span className={css.keydateBadge} title={tt('tasks.keydateTooltip', { date: task.deadline ?? '' })}>
            {tt('tasks.keydateBadge', { date: task.deadline ?? '' })}
          </span>
        )}
        <button
          type="button"
          className={`${css.keydateToggle} ${task.remindKeyDate === true ? css.keydateOn : ''}`}
          disabled={task.deadline === undefined || task.deadline === ''}
          title={task.deadline === undefined || task.deadline === '' ? tt('tasks.keydateNeedDeadline') : (task.remindKeyDate === true ? tt('tasks.keydateOff') : tt('tasks.keydateOn'))}
          onClick={() => onToggleKeyDate(groupId, task.id, !(task.remindKeyDate === true))}
        >
          {task.remindKeyDate === true ? '🔔' : '○'}
        </button>
        {hasChildren && (
          <button type="button" className={css.iconBtn} onClick={() => setExpanded(!expanded)} title={expanded ? tt('tasks.collapse') : tt('tasks.expand')}>
            {expanded ? '▾' : '▸'}
          </button>
        )}
        <button type="button" className={css.iconBtnDanger} onClick={() => onDeleteTask(groupId, task.id)} title={tt('tasks.deleteTask')}>✕</button>
      </div>

      {expanded && (
        <div className={css.taskChildren}>
          {subtasks.map((sub) => (
            <div key={sub.id} className={css.subtaskRow}>
              <button type="button" className={sub.done ? css.subCheckDone : css.subCheck} onClick={() => onToggleSubtask(groupId, task.id, sub.id)} aria-label={sub.title}>
                {sub.done ? '✓' : ''}
              </button>
              <span className={sub.done ? css.subLabelDone : css.subLabel}>{sub.title}</span>
              <button type="button" className={css.iconBtnDanger} onClick={() => onDeleteSubtask(groupId, task.id, sub.id)} title={tt('tasks.deleteSubtask')}>✕</button>
            </div>
          ))}
          {checklist.length > 0 && (
            <div className={css.checkList}>
              {checklist.map((c) => (
                <div key={c.id} className={css.subtaskRow}>
                  <button type="button" className={c.done ? css.subCheckDone : css.subCheck} onClick={() => onToggleChecklist(groupId, task.id, c.id)} aria-label={c.text}>
                    {c.done ? '✓' : ''}
                  </button>
                  <span className={c.done ? css.subLabelDone : css.subLabel}>{c.text}</span>
                </div>
              ))}
            </div>
          )}
          {checklist.length > 0 && (
            <div className={css.checkMeta}>{tt('tasks.checklistProgress')}: {checkDone}/{checklist.length}</div>
          )}
          {addingSubtask ? (
            <div className={css.subtaskAdd}>
              <input className={css.subInput} autoFocus value={subtaskDraft} placeholder={tt('tasks.addSubtask')}
                onChange={(e) => setSubtaskDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') addSubtask(); if (e.key === 'Escape') setAddingSubtask(false) }}
              />
              <button type="button" className={css.smallBtn} onClick={addSubtask}>+</button>
            </div>
          ) : (
            <button type="button" className={css.subAddBtn} onClick={() => setAddingSubtask(true)}>+ {tt('tasks.addSubtask')}</button>
          )}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------- group add */

function GroupAdd({ onAdd }: { onAdd: (name: string) => void }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const submit = (): void => {
    const n = name.trim()
    if (n === '') return
    onAdd(n)
    setName('')
    setOpen(false)
  }
  return open ? (
    <div className={css.groupAdd}>
      <input className={css.groupNameInput} autoFocus placeholder={tt('tasks.groupName')} value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') setOpen(false) }} />
      <button type="button" className={css.smallBtn} onClick={submit}>{tt('tasks.add')}</button>
      <button type="button" className={css.smallBtn} onClick={() => setOpen(false)}>{tt('tasks.cancel')}</button>
    </div>
  ) : (
    <button type="button" className={css.addGroupBtn} onClick={() => setOpen(true)}>+ {tt('tasks.addGroup')}</button>
  )
}

/* ------------------------------------------------------------ inline add */

function InlineAdd({ placeholder, onAdd }: { placeholder: string; onAdd: (text: string) => void }): React.JSX.Element {
  const [text, setText] = useState('')
  const submit = (): void => {
    const t = text.trim()
    if (t === '') return
    onAdd(t)
    setText('')
  }
  return (
    <div className={css.inlineAdd}>
      <input className={css.subInput} placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />
      <button type="button" className={css.smallBtn} onClick={submit} disabled={text.trim() === ''}>+</button>
    </div>
  )
}
