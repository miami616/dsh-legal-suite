/**
 * Case timeline — vertical chronicle of a case's events (past + future),
 * with inline add/edit form (type / title / date / reminder). Matches the
 * AgentLex product intent: past nodes as history, future nodes with countdown.
 */
import { useState } from 'react'
import type { TimelineEvent } from '../../store/types.ts'
import * as api from '../api.ts'
import { relativeDays } from '../case-format.ts'
import { errorMessage, tt } from '../i18n.ts'
import css from './timeline.module.css'

/** Event types offered by the add/edit form. */
export const EVENT_TYPES = [
  { value: 'hearing', label: '开庭' },
  { value: 'evidence_deadline', label: '举证期限' },
  { value: 'defense_deadline', label: '答辩期' },
  { value: 'appeal_deadline', label: '上诉期' },
  { value: 'filing_deadline', label: '立案期限' },
  { value: 'filing', label: '起诉/立案' },
  { value: 'service', label: '送达' },
  { value: 'court_notice', label: '法院通知' },
  { value: 'arbitration', label: '仲裁' },
  { value: 'mediation', label: '调解' },
  { value: 'judgment', label: '判决' },
  { value: 'ruling', label: '裁定' },
  { value: 'verdict', label: '宣判' },
  { value: 'appeal', label: '上诉' },
  { value: 'execution', label: '执行' },
  { value: 'case_event', label: '其他节点' },
] as const

const EVENT_TYPE_LABEL = new Map(EVENT_TYPES.map((t) => [t.value, t.label]))

function typeLabel(type: string): string {
  return EVENT_TYPE_LABEL.get(type as never) ?? type
}

/** Source badge label (AgentLex sources). */
function sourceLabel(source: string | undefined): string {
  const map: Record<string, string> = {
    manual: '手动', agent: 'Agent', 'case-file': '卷宗', 'court-sms': '法院',
  }
  return map[source ?? ''] ?? source ?? ''
}

interface TimelineProps {
  caseId: string
  caseName: string
  events: TimelineEvent[]
  onChange: () => void
}

export function Timeline({ caseId, caseName, events, onChange }: TimelineProps): React.JSX.Element {
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<TimelineEvent | 'new' | null>(null)

  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date))

  const report = (err: unknown): void => setError(errorMessage(err))

  const submit = async (input: {
    title: string; type: string; date: string; remindDays: string; status: TimelineEvent['status']
  }): Promise<void> => {
    try {
      const remindRules = input.remindDays.trim() !== ''
        ? [{ enabled: true, minutes: Number(input.remindDays) * 24 * 60, type: 'before_event' as const }]
        : undefined
      if (editing !== 'new' && editing !== null) {
        await api.upsertEvent({
          id: editing.id,
          caseId,
          caseName,
          title: input.title,
          type: input.type,
          date: input.date,
          status: input.status,
          remindRules,
        })
      } else {
        await api.upsertEvent({
          caseId,
          caseName,
          title: input.title,
          type: input.type,
          date: input.date,
          status: input.status,
          remindRules,
          source: 'manual',
        })
      }
      setEditing(null)
      onChange()
    } catch (err) {
      report(err)
    }
  }

  const toggleDone = async (id: string): Promise<void> => {
    try { await api.toggleEvent(id); onChange() } catch (err) { report(err) }
  }

  const remove = async (id: string): Promise<void> => {
    try { await api.deleteEvent(id); onChange() } catch (err) { report(err) }
  }

  return (
    <div className={css.timeline}>
      {error !== '' && <p className={css.tlError}>{error}</p>}

      {sorted.length === 0 && editing === null ? (
        <p className={css.tlEmpty}>{tt('timeline.empty')}</p>
      ) : (
        <div className={css.tlList}>
          {sorted.map((e) => (
            <div key={e.id} className={css.tlRow}>
              <span className={e.status === 'done' ? `${css.tlDot} ${css.tlDotDone}` : css.tlDot} aria-hidden />
              <div className={css.tlContent}>
                <div className={css.tlTitleRow}>
                  <span className={e.status === 'done' ? css.tlTitleDone : css.tlTitle}>{e.title}</span>
                  <span className={css.tlType}>{typeLabel(e.type)}</span>
                  {sourceLabel(e.source) !== '' && <span className={css.tlSource}>{sourceLabel(e.source)}</span>}
                </div>
                {e.detail && <div className={css.tlDetail}>{e.detail}</div>}
                <div className={css.tlMeta}>
                  <span className={css.tlDate}>{e.date}</span>
                  <span className={e.date < new Date().toISOString().slice(0, 10) ? css.tlRelPast : css.tlRelFuture}>{relativeDays(e.date)}</span>
                  <button type="button" className={css.tlAction} onClick={() => { void toggleDone(e.id) }}>
                    {e.status === 'done' ? tt('timeline.reopen') : tt('timeline.complete')}
                  </button>
                  <button type="button" className={css.tlAction} onClick={() => setEditing(e)}>{tt('timeline.edit')}</button>
                  <button type="button" className={css.tlActionDanger} onClick={() => { void remove(e.id) }}>{tt('timeline.delete')}</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing !== null ? (
        <EventForm
          initial={editing === 'new' ? undefined : editing}
          onSubmit={(input) => { void submit(input) }}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <button type="button" className={css.addEventBtn} onClick={() => setEditing('new')}>+ {tt('timeline.addEvent')}</button>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ form */

interface EventFormInput {
  title: string
  type: string
  date: string
  remindDays: string
  status: TimelineEvent['status']
}

function EventForm({ initial, onSubmit, onCancel }: {
  initial?: TimelineEvent
  onSubmit: (input: EventFormInput) => void
  onCancel: () => void
}): React.JSX.Element {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [type, setType] = useState(initial?.type ?? 'hearing')
  const [date, setDate] = useState(initial?.date ?? new Date().toISOString().slice(0, 10))
  const [remindDays, setRemindDays] = useState(() => {
    const rule = initial?.remindRules?.[0]
    return rule?.type === 'before_event' && rule.minutes !== undefined && rule.minutes % 1440 === 0
      ? String(rule.minutes / 1440)
      : ''
  })

  const canSubmit = title.trim() !== '' && date !== ''

  return (
    <div className={css.form}>
      <div className={css.formRow}>
        <input className={css.formInput} placeholder={tt('timeline.titlePlaceholder')} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      </div>
      <div className={css.formRow}>
        <select className={css.formSelect} value={type} onChange={(e) => setType(e.target.value)}>
          {EVENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <input className={css.formInput} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        <input className={css.formInput} placeholder={tt('timeline.remindDaysPlaceholder')} value={remindDays} onChange={(e) => setRemindDays(e.target.value.replace(/[^0-9]/g, ''))} />
      </div>
      <div className={css.formActions}>
        <button type="button" className={css.formCancel} onClick={onCancel}>{tt('timeline.cancel')}</button>
        <button type="button" className={css.formSubmit} disabled={!canSubmit} onClick={() => onSubmit({ title: title.trim(), type, date, remindDays, status: initial?.status ?? 'pending' })}>
          {tt('timeline.save')}
        </button>
      </div>
    </div>
  )
}
