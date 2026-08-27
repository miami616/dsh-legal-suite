/**
 * New case modal — AgentLex-style registration form.
 *
 * Sections: 案件名称 · 分类（类型/案由/审级/标的）· 办案信息（法院/法官/立案日期/我方身份）·
 * 当事人（原告/被告）· 卷宗文件夹. The folder is a path the host resolves
 * against the case data workspace; it becomes CaseRecord.folder.
 */
import { useState } from 'react'
import { pickDirectoryPath } from '../../../../shared/folder-picker.ts'
import { CASE_CAUSES, CASE_TYPE_DEFS } from '../case-taxonomy.ts'
import { PROCEDURE_LEVELS } from '../case-status.ts'
import { tt } from '../i18n.ts'
import css from './board.module.css'

export interface NewCaseInput {
  name: string
  type: string
  cause: string
  court: string
  judge: string
  level: string
  claimAmount: string
  filingDate: string
  plaintiff: string
  defendant: string
  ourSide: string
  folder: string
}

interface NewCaseModalProps {
  submitting: boolean
  onSubmit: (input: NewCaseInput) => void
  onClose: () => void
}

/** Section label used inside the modal body. */
function SectionLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className={css.sectionLabel}>{children}</div>
}

export function NewCaseModal({ submitting, onSubmit, onClose }: NewCaseModalProps): React.JSX.Element {
  const [form, setForm] = useState<NewCaseInput>({
    name: '', type: '民商', cause: '', court: '', judge: '', level: '一审',
    claimAmount: '', filingDate: '', plaintiff: '', defendant: '', ourSide: 'plaintiff', folder: '',
  })
  const [error, setError] = useState('')

  const set = <K extends keyof NewCaseInput>(key: K, value: NewCaseInput[K]): void => {
    setForm((f) => {
      if (key === 'type') return { ...f, type: value as string, cause: '' }
      return { ...f, [key]: value }
    })
  }

  const submit = (): void => {
    if (form.name.trim() === '') { setError(tt('modal.nameRequired')); return }
    const cause = form.cause || CASE_CAUSES[form.type]?.[0] || ''
    onSubmit({ ...form, cause })
  }

  return (
    <div className={css.modalOverlay} onClick={onClose}>
      <div className={css.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={tt('modal.title')}>
        <header className={css.modalHeader}>
          <h2 className={css.modalTitle}>{tt('modal.title')}</h2>
          <button className={css.closeBtn} type="button" onClick={onClose} aria-label={tt('modal.close')}>✕</button>
        </header>

        <div className={css.modalBody}>
          {/* 1. 案件名称 */}
          <label className={css.field}>
            <span className={css.fieldLabel}>{tt('modal.name')} *</span>
            <input className={css.input} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder={tt('modal.namePlaceholder')} autoFocus />
          </label>

          {/* 2. 分类 */}
          <SectionLabel>{tt('modal.section.category')}</SectionLabel>
          <div className={css.fieldRow}>
            <label className={css.field}>
              <span className={css.fieldLabel}>{tt('modal.type')}</span>
              <select className={css.select} value={form.type} onChange={(e) => set('type', e.target.value)}>
                {CASE_TYPE_DEFS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </label>
            <label className={css.field}>
              <span className={css.fieldLabel}>{tt('modal.cause')}</span>
              <select className={css.select} value={form.cause} onChange={(e) => set('cause', e.target.value)}>
                <option value="">{tt('modal.causePlaceholder')}</option>
                {(CASE_CAUSES[form.type] ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          </div>
          <div className={css.fieldRow}>
            <label className={css.field}>
              <span className={css.fieldLabel}>{tt('modal.level')}</span>
              <select className={css.select} value={form.level} onChange={(e) => set('level', e.target.value)}>
                {PROCEDURE_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </label>
            <label className={css.field}>
              <span className={css.fieldLabel}>{tt('modal.claimAmount')}</span>
              <input className={css.input} value={form.claimAmount} onChange={(e) => set('claimAmount', e.target.value)} placeholder={tt('modal.amountPlaceholder')} />
            </label>
          </div>

          {/* 3. 办案信息 */}
          <SectionLabel>{tt('modal.section.case')}</SectionLabel>
          <div className={css.fieldRow}>
            <label className={css.field}>
              <span className={css.fieldLabel}>{tt('modal.court')}</span>
              <input className={css.input} value={form.court} onChange={(e) => set('court', e.target.value)} placeholder={tt('modal.courtPlaceholder')} />
            </label>
            <label className={css.field}>
              <span className={css.fieldLabel}>{tt('modal.judge')}</span>
              <input className={css.input} value={form.judge} onChange={(e) => set('judge', e.target.value)} placeholder={tt('modal.judgePlaceholder')} />
            </label>
          </div>
          <div className={css.fieldRow}>
            <label className={css.field}>
              <span className={css.fieldLabel}>{tt('modal.filingDate')}</span>
              <input className={css.input} type="date" value={form.filingDate} onChange={(e) => set('filingDate', e.target.value)} />
            </label>
            <label className={css.field}>
              <span className={css.fieldLabel}>{tt('modal.ourSide')}</span>
              <select className={css.select} value={form.ourSide} onChange={(e) => set('ourSide', e.target.value)}>
                <option value="plaintiff">{tt('modal.sidePlaintiff')}</option>
                <option value="defendant">{tt('modal.sideDefendant')}</option>
              </select>
            </label>
          </div>

          {/* 4. 当事人 */}
          <SectionLabel>{tt('modal.section.parties')}</SectionLabel>
          <div className={css.fieldRow}>
            <label className={css.field}>
              <span className={css.fieldLabel}>{tt('modal.plaintiff')}</span>
              <input className={css.input} value={form.plaintiff} onChange={(e) => set('plaintiff', e.target.value)} placeholder={tt('modal.plaintiffPlaceholder')} />
            </label>
            <label className={css.field}>
              <span className={css.fieldLabel}>{tt('modal.defendant')}</span>
              <input className={css.input} value={form.defendant} onChange={(e) => set('defendant', e.target.value)} placeholder={tt('modal.defendantPlaceholder')} />
            </label>
          </div>

          {/* 5. 卷宗文件夹 */}
          <SectionLabel>{tt('modal.section.folder')}</SectionLabel>
          <div className={css.field}>
            <span className={css.fieldLabel}>{tt('modal.folder')}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <input className={css.input} value={form.folder} onChange={(e) => set('folder', e.target.value)} placeholder={tt('modal.folderPlaceholder')} />
              <button
                className={css.ghostBtn}
                type="button"
                style={{ flex: 'none', whiteSpace: 'nowrap' }}
                onClick={() => { void (async () => { const picked = await pickDirectoryPath(); if (picked !== null && picked !== '') set('folder', picked) })() }}
              >{tt('modal.folderPick')}</button>
            </div>
            <span className={css.fieldHint}>{tt('modal.folderHint')}</span>
          </div>

          {error !== '' && <div className={css.modalError}>{error}</div>}
        </div>

        <footer className={css.modalFooter}>
          <button className={css.ghostBtn} type="button" onClick={onClose} disabled={submitting}>{tt('modal.cancel')}</button>
          <button className={css.newCaseBtn} type="button" onClick={submit} disabled={submitting}>
            {submitting ? tt('modal.submitting') : tt('modal.submit')}
          </button>
        </footer>
      </div>
    </div>
  )
}

/** Re-export for the caller. */
export type { NewCaseInput as CaseFormData }
