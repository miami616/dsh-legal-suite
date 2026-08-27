/**
 * New project modal — AgentLex-style form (name, type, status, service period,
 * service scope, lead lawyer, folder).
 */
import { useState } from 'react'
import { tt } from '../i18n.ts'
import { pickDirectoryPath } from '../../../../shared/folder-picker.ts'
import css from '../panel.module.css'

export interface NewProjectInput {
  name: string
  projectType: string
  status: string
  leadLawyer?: string
  servicePeriodStart?: string
  servicePeriodEnd?: string
  serviceScope?: string
  folder?: string
}

interface NewProjectModalProps {
  submitting: boolean
  onSubmit: (input: NewProjectInput) => void
  onClose: () => void
}

export function NewProjectModal({ submitting, onSubmit, onClose }: NewProjectModalProps): React.JSX.Element {
  const [name, setName] = useState('')
  const [projectType, setProjectType] = useState('retainer')
  const [status, setStatus] = useState('active')
  const [leadLawyer, setLeadLawyer] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [scope, setScope] = useState('')
  const [folder, setFolder] = useState('')

  const submit = (): void => {
    if (name.trim() === '') return
    onSubmit({
      name: name.trim(),
      projectType,
      status,
      leadLawyer: leadLawyer.trim() || undefined,
      servicePeriodStart: start || undefined,
      servicePeriodEnd: end || undefined,
      serviceScope: scope.trim() || undefined,
      folder: folder.trim() || undefined,
    })
  }

  return (
    <div className={css.modalOverlay} onClick={onClose}>
      <div className={css.formModal} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h2 className={css.formTitle}>{tt('modal.title')}</h2>
        <p className={css.formSub}>{tt('modal.subtitle')}</p>

        <div className={css.field}>
          <label className={css.fieldLabel}>{tt('modal.name')} *</label>
          <input className={css.fieldInput} value={name} autoFocus
            placeholder={tt('modal.namePh')}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />
        </div>

        <div className={css.fieldRow}>
          <div className={css.field}>
            <label className={css.fieldLabel}>{tt('modal.type')}</label>
            <select className={css.fieldSelect} value={projectType} onChange={(e) => setProjectType(e.target.value)}>
              <option value="retainer">{tt('modal.typeRetainer')}</option>
              <option value="special">{tt('modal.typeSpecial')}</option>
              <option value="consult">{tt('modal.typeConsult')}</option>
            </select>
          </div>
          <div className={css.field}>
            <label className={css.fieldLabel}>{tt('modal.status')}</label>
            <select className={css.fieldSelect} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="active">{tt('modal.statusActive')}</option>
              <option value="retained">{tt('modal.statusRetained')}</option>
              <option value="completed">{tt('modal.statusCompleted')}</option>
            </select>
          </div>
        </div>

        <div className={css.field}>
          <label className={css.fieldLabel}>{tt('modal.lead')}</label>
          <input className={css.fieldInput} value={leadLawyer} onChange={(e) => setLeadLawyer(e.target.value)} />
        </div>

        <div className={css.fieldRow}>
          <div className={css.field}>
            <label className={css.fieldLabel}>{tt('modal.periodStart')}</label>
            <input className={css.fieldInput} type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className={css.field}>
            <label className={css.fieldLabel}>{tt('modal.periodEnd')}</label>
            <input className={css.fieldInput} type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>

        <div className={css.field}>
          <label className={css.fieldLabel}>{tt('modal.scope')}</label>
          <input className={css.fieldInput} value={scope} placeholder={tt('modal.scopePh')} onChange={(e) => setScope(e.target.value)} />
        </div>

        <div className={css.field}>
          <label className={css.fieldLabel}>{tt('modal.folder')}</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className={css.fieldInput} value={folder} placeholder={tt('modal.folderPh')} onChange={(e) => setFolder(e.target.value)} />
            <button
              className={css.ghostBtn}
              type="button"
              style={{ flex: 'none', whiteSpace: 'nowrap' }}
              onClick={() => { void (async () => { const picked = await pickDirectoryPath(); if (picked !== null && picked !== '') setFolder(picked) })() }}
            >{tt('modal.folderPick')}</button>
          </div>
        </div>

        <div className={css.formActions}>
          <button className={css.ghostBtn} type="button" onClick={onClose}>{tt('modal.cancel')}</button>
          <button className={css.primaryBtn} type="button" disabled={submitting || name.trim() === ''} onClick={submit}>
            {submitting ? tt('modal.submitting') : tt('modal.create')}
          </button>
        </div>
      </div>
    </div>
  )
}
