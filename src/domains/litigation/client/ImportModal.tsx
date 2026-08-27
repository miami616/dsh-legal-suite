/**
 * Import modal — imports cases + timeline from ~/.myagents/agentlex
 * (read-only source) into the plugin store. Shows the result summary.
 */
import { useState } from 'react'
import * as api from './api.ts'
import { errorMessage, tt } from './i18n.ts'
import css from './components/board.module.css'

interface ImportModalProps {
  onDone: () => void
  onClose: () => void
}

export function ImportModal({ onDone, onClose }: ImportModalProps): React.JSX.Element {
  const [sourceDir, setSourceDir] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<api.ImportResult | null>(null)
  const [error, setError] = useState('')

  const run = async (): Promise<void> => {
    setRunning(true)
    setError('')
    try {
      const res = await api.importAgentLex(sourceDir.trim() === '' ? undefined : sourceDir.trim())
      setResult(res)
      onDone()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className={css.modalOverlay} onClick={onClose}>
      <div className={css.modal} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={tt('import.title')}>
        <header className={css.modalHeader}>
          <h2 className={css.modalTitle}>{tt('import.title')}</h2>
          <button className={css.closeBtn} type="button" onClick={onClose} aria-label={tt('modal.close')}>✕</button>
        </header>

        <div className={css.modalBody}>
          {result === null ? (
            <>
              <p className={css.importHint}>{tt('import.hint')}</p>
              <label className={css.field}>
                <span className={css.fieldLabel}>{tt('import.sourceDir')}</span>
                <input className={css.input} value={sourceDir} onChange={(e) => setSourceDir(e.target.value)} placeholder={tt('import.sourcePlaceholder')} />
              </label>
              {error !== '' && <div className={css.modalError}>{error}</div>}
            </>
          ) : (
            <div className={css.importResult}>
              <p className={css.importSummary}>
                {tt('import.result', { added: String(result.added), updated: String(result.updated), events: String(result.eventsImported) })}
              </p>
              {result.skipped > 0 && <p className={css.importMuted}>{tt('import.skipped', { skipped: String(result.skipped) })}</p>}
              {result.detail.map((d, i) => <p key={i} className={css.importMuted}>{d}</p>)}
              <button className={css.newCaseBtn} type="button" onClick={onClose}>{tt('import.done')}</button>
            </div>
          )}
        </div>

        {result === null && (
          <footer className={css.modalFooter}>
            <button className={css.ghostBtn} type="button" onClick={onClose} disabled={running}>{tt('modal.cancel')}</button>
            <button className={css.newCaseBtn} type="button" onClick={() => { void run() }} disabled={running}>
              {running ? tt('import.running') : tt('import.run')}
            </button>
          </footer>
        )}
      </div>
    </div>
  )
}
