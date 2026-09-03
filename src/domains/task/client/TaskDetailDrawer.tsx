/**
 * Task detail drawer (mobile). Opens from a task-row tap: standalone tasks
 * can be edited (title / detail / priority / deadline / status / delete);
 * tasks sourced from litigation / non-litigation are read-only with a hint
 * (edit them in the owning panel). Desktop keeps the plain row actions.
 */
import { useState } from 'react'
import type { TaskItem } from '../store/types.ts'
import * as api from './api.ts'
import { errorMessage, tt } from './i18n.ts'
import css from './panel.module.css'
import mobileCss from './mobile.module.css'

interface TaskDetailDrawerProps {
  task: TaskItem
  onClose: () => void
  onChange: () => void
}

const SOURCE_LABEL: Record<string, string> = {
  standalone: 'source.standalone', litigation: 'source.litigation', nonlitigation: 'source.nonlitigation',
}

export function TaskDetailDrawer({ task, onClose, onChange }: TaskDetailDrawerProps): React.JSX.Element {
  const editable = task.source === undefined || task.source === 'standalone'
  const source = (task.source ?? 'standalone') as Exclude<TaskItem['source'], undefined>
  const [title, setTitle] = useState(task.title)
  const [detail, setDetail] = useState(task.detail ?? '')
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>(task.priority ?? 'medium')
  const [deadline, setDeadline] = useState(task.deadline ?? '')
  const [time, setTime] = useState(task.time ?? '')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  const save = async (): Promise<void> => {
    const t = title.trim()
    if (t === '') { setError(tt('mobile.task.titleRequired')); return }
    setSaving(true)
    setError('')
    try {
      await api.upsertTask({
        id: task.id,
        title: t,
        detail: detail.trim() === '' ? undefined : detail.trim(),
        priority,
        deadline: deadline === '' ? undefined : deadline,
        time: time.trim() === '' ? undefined : time.trim(),
      })
      onChange()
      onClose()
    } catch (err) {
      setError(errorMessage(err))
      setSaving(false)
    }
  }

  const toggleStatus = async (): Promise<void> => {
    setSaving(true)
    setError('')
    try {
      await api.upsertTask({
        id: task.id,
        status: task.status === 'todo' ? 'doing' : task.status === 'doing' ? 'done' : 'todo',
        source: task.source,
        sourceId: task.sourceId,
        groupId: task.groupId,
      })
      onChange()
      onClose()
    } catch (err) {
      setError(errorMessage(err))
      setSaving(false)
    }
  }

  const remove = async (): Promise<void> => {
    setDeleting(true)
    setError('')
    try {
      await api.deleteTask(task.id)
      onChange()
      onClose()
    } catch (err) {
      setError(errorMessage(err))
      setDeleting(false)
    }
  }

  return (
    <div className={mobileCss.drawerLayer}>
      <div className={mobileCss.drawerScrim} onClick={onClose} />
      <div className={mobileCss.drawer} role="dialog" aria-modal="true">
        <header className={mobileCss.drawerHeader}>
          <h1 className={mobileCss.drawerTitle}>{editable ? tt('mobile.task.edit') : tt('mobile.task.detail')}</h1>
          <button className={css.close} type="button" aria-label={tt('mobile.task.close')} onClick={onClose}>✕</button>
        </header>

        <div className={mobileCss.drawerBody}>
          <div className={mobileCss.taskDrawerBody}>
            {!editable && (
              <p className={mobileCss.taskReadonly}>{tt('mobile.task.readonly', { source: tt(SOURCE_LABEL[source]) })}</p>
            )}
            <label className={mobileCss.taskField}>
              <span className={mobileCss.taskFieldLabel}>{tt('mobile.task.title')}</span>
              <input className={mobileCss.taskInput} value={title} onChange={(e) => setTitle(e.target.value)} disabled={!editable} />
            </label>

            <label className={mobileCss.taskField}>
              <span className={mobileCss.taskFieldLabel}>{tt('mobile.task.detail')}</span>
              <textarea
                className={mobileCss.taskTextarea}
                rows={4}
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                disabled={!editable}
                placeholder={tt('mobile.task.detailPh')}
              />
            </label>

            <label className={mobileCss.taskField}>
              <span className={mobileCss.taskFieldLabel}>{tt('mobile.task.priority')}</span>
              <select
                className={mobileCss.taskSelect}
                value={priority}
                onChange={(e) => setPriority(e.target.value as 'low' | 'medium' | 'high')}
                disabled={!editable}
              >
                <option value="low">{tt('priority.low')}</option>
                <option value="medium">{tt('priority.medium')}</option>
                <option value="high">{tt('priority.high')}</option>
              </select>
            </label>

            <label className={mobileCss.taskField}>
              <span className={mobileCss.taskFieldLabel}>{tt('mobile.task.deadline')}</span>
              <input className={mobileCss.taskInput} type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} disabled={!editable} />
            </label>

            <label className={mobileCss.taskField}>
              <span className={mobileCss.taskFieldLabel}>时间</span>
              <input className={mobileCss.taskInput} type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={!editable} />
            </label>

            {error !== '' && <p className={mobileCss.taskError}>{error}</p>}
          </div>
        </div>

        <footer className={mobileCss.taskDrawerFooter}>
          <button className={mobileCss.taskFooterBtn} type="button" onClick={() => { void toggleStatus() }} disabled={saving}>
            {tt(task.status === 'done' ? 'mobile.task.markTodo' : task.status === 'doing' ? 'mobile.task.markDone' : 'mobile.task.markDoing')}
          </button>
          {editable && (
            <button className={mobileCss.taskFooterDanger} type="button" onClick={() => { void remove() }} disabled={deleting}>
              {deleting ? tt('mobile.task.deleting') : tt('mobile.task.delete')}
            </button>
          )}
          {editable ? (
            <button className={mobileCss.taskFooterPrimary} type="button" onClick={() => { void save() }} disabled={saving}>
              {saving ? tt('mobile.task.saving') : tt('mobile.task.save')}
            </button>
          ) : (
            <button className={mobileCss.taskFooterPrimary} type="button" onClick={onClose}>{tt('mobile.task.close')}</button>
          )}
        </footer>
      </div>
    </div>
  )
}