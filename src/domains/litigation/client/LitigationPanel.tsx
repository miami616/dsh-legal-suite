/**
 * Litigation panel — the plugin's main surface. Owns the data fetch +
 * registry-changed subscription and the two-level navigation (board →
 * detail). The detail view is stubbed here and filled in M3.
 *
 * Cross-plugin visibility: the center-column takeover lives in mount.tsx;
 * this component only renders content.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CaseRecord, TimelineEvent } from '../store/types.ts'
import * as api from './api.ts'
import type { PanelController } from './controller.ts'
import { errorMessage, tt } from './i18n.ts'
import { CaseBoard } from './components/CaseBoard.tsx'
import { NewCaseModal, type NewCaseInput } from './components/NewCaseModal.tsx'
import { CaseDetailPage } from './detail/CaseDetailPage.tsx'
import { ImportModal } from './ImportModal.tsx'
import { useIsMobile } from './use-mobile.ts'
import css from './panel.module.css'
import mobileCss from './mobile.module.css'

interface LitigationPanelProps {
  controller: PanelController
  /** Opens the 诉讼管家 system agent session (optional case context). */
  launchManager: (opts?: { context?: string; onLaunched?: (sessionId: string) => void }) => Promise<string | undefined>
  /** Opens a bound case folder in the better-sidebar. */
  openCaseFolder?: (folder: string) => void
}

export function LitigationPanel({ controller, launchManager, openCaseFolder }: LitigationPanelProps): React.JSX.Element {
  const mobile = useIsMobile()
  const [cases, setCases] = useState<CaseRecord[]>([])
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<CaseRecord | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [launching, setLaunching] = useState(false)
  /** 案件体检（caseId → 完整度/缺口/建议），旁路数据，取不到则为空表。 */
  const [healthByCase, setHealthByCase] = useState<Map<string, api.CaseHealthView>>(new Map())
  const bootedRef = useRef(false)

  const refresh = useCallback(async () => {
    try {
      const [registry, events] = await Promise.all([api.readRegistry(), api.listEvents()])
      setCases(Object.values(registry.cases))
      setTimelineEvents(events)
      setError('')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
    // 体检是只读的旁路数据：失败只影响「完整度」提示，绝不能拖垮看板，
    // 因此单独发起且不参与上面的 try/finally。
    try {
      const summary = await api.caseHealth() as { cases: api.CaseHealthView[] }
      setHealthByCase(new Map(summary.cases.map((h) => [h.caseId, h])))
    } catch {
      /* 体检不可用时静默降级，不打扰用户 */
    }
  }, [])

  useEffect(() => {
    if (bootedRef.current) return
    bootedRef.current = true
    void refresh()
  }, [refresh])

  // Live refresh: the host emits agentlex:registry-changed on every write.
  // The client-runtime bridges host events into the browser; we listen on
  // the plugin window via a CustomEvent the bridge forwards. Fallback: refetch
  // on window focus (covers bridges that don't forward custom events).
  useEffect(() => {
    const onChanged = (): void => { void refresh() }
    window.addEventListener('agentlex:registry-changed', onChanged)
    const onFocus = (): void => { void refresh() }
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('agentlex:registry-changed', onChanged)
      window.removeEventListener('focus', onFocus)
    }
  }, [refresh])

  const handleNewCase = async (input: NewCaseInput): Promise<void> => {
    setSubmitting(true)
    try {
      const created = await api.registerCase({
        name: input.name,
        type: input.type,
        cause: input.cause,
        court: input.court,
        judge: input.judge,
        level: input.level,
        claimAmount: input.claimAmount,
        filingDate: input.filingDate || undefined,
        ourSide: input.ourSide,
        folder: input.folder || undefined,
        parties: {
          plaintiff: input.plaintiff || undefined,
          defendant: input.defendant || undefined,
          ourSide: input.ourSide,
          details: [
            ...(input.plaintiff ? [{ name: input.plaintiff, role: '原告' }] : []),
            ...(input.defendant ? [{ name: input.defendant, role: '被告' }] : []),
          ],
        },
      })
      setModalOpen(false)
      setSelectedCaseId(created.caseId)
      await refresh()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (caseId: string): Promise<void> => {
    try {
      await api.deleteCase(caseId)
      if (selectedCaseId === caseId) setSelectedCaseId(null)
      setDeleteTarget(null)
      await refresh()
    } catch (err) {
      setError(errorMessage(err))
      setDeleteTarget(null)
    }
  }

  const selected = selectedCaseId === null ? undefined : cases.find((c) => c.caseId === selectedCaseId)

  const handleLaunchManager = async (context?: string): Promise<void> => {
    if (launching) return
    setLaunching(true)
    try {
      const sessionId = await launchManager({
        ...(context !== undefined ? { context } : {}),
        onLaunched: () => { /* panel closes below */ },
      })
      if (sessionId !== undefined) {
        // Hand the center column back to the system conversation UI.
        controller.close()
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLaunching(false)
    }
  }

  const detailOpen = selectedCaseId !== null && selected !== undefined

  return (
    <div className={`${css.panel} ${mobile ? mobileCss.panelMobile : ''}`}>
      <header className={`${css.header} ${mobile ? mobileCss.headerMobile : ''}`}>
        {selectedCaseId === null || mobile ? (
          <>
            <h1 className={css.title}>{tt('panel.title')}</h1>
            {!mobile && <span className={css.subtitle}>{tt('panel.subtitle')}</span>}
            {!mobile && (
              <button
                className={css.agentToggle}
                type="button"
                onClick={() => { void handleLaunchManager() }}
                disabled={launching}
                title={tt('agent.launchHint')}
              >
                ⚖ {launching ? '…' : tt('agent.title')}
              </button>
            )}
          </>
        ) : (
          <>
            <button className={css.backBtn} type="button" onClick={() => setSelectedCaseId(null)}>← {tt('detail.back')}</button>
            <h1 className={css.title}>{selected?.name ?? selectedCaseId}</h1>
          </>
        )}
        <button className={css.close} type="button" aria-label="Close" onClick={() => controller.close()}>✕</button>
      </header>

      {loading ? (
        <div className={css.body}><p className={css.healthLabel}>{tt('panel.health')}: …</p></div>
      ) : error !== '' && cases.length === 0 ? (
        <div className={css.body}><p className={css.healthBad}>{error}</p></div>
      ) : (
        <>
          <div className={css.body}>
            {!mobile && detailOpen ? (
              <CaseDetailPage
                record={selected}
                events={timelineEvents.filter((e) => e.caseId === selected.caseId)}
                onChange={refresh}
                onOpenAgent={(context) => { void handleLaunchManager(context) }}
                onOpenFolder={openCaseFolder}
              />
            ) : (
              <CaseBoard
                cases={cases}
                timelineEvents={timelineEvents}
                healthByCase={healthByCase}
                searchQuery={searchQuery}
                onSearch={setSearchQuery}
                onOpenCase={setSelectedCaseId}
                onNewCase={() => setModalOpen(true)}
                onDeleteCase={(id) => { const c = cases.find((x) => x.caseId === id); if (c) setDeleteTarget(c) }}
                onImport={() => setImportOpen(true)}
              />
            )}
          </div>

          {mobile && detailOpen && (
            <div className={mobileCss.drawerLayer}>
              <div className={mobileCss.drawerScrim} onClick={() => setSelectedCaseId(null)} />
              <div className={mobileCss.drawer} role="dialog" aria-modal="true">
                <header className={mobileCss.drawerHeader}>
                  <button className={css.backBtn} type="button" onClick={() => setSelectedCaseId(null)}>← {tt('detail.back')}</button>
                  <h1 className={mobileCss.drawerTitle}>{selected.name}</h1>
                  <button className={css.close} type="button" aria-label="Close" onClick={() => setSelectedCaseId(null)}>✕</button>
                </header>
                <div className={mobileCss.drawerBody}>
                  <CaseDetailPage
                    record={selected}
                    events={timelineEvents.filter((e) => e.caseId === selected.caseId)}
                    onChange={refresh}
                    onOpenAgent={(context) => { void handleLaunchManager(context) }}
                    onOpenFolder={openCaseFolder}
                  />
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {mobile && (
        <nav className={mobileCss.bottomNav}>
          <button
            className={`${mobileCss.navItem} ${!detailOpen ? mobileCss.navItemActive : ''}`}
            type="button"
            onClick={() => setSelectedCaseId(null)}
          >
            <span className={mobileCss.navIcon}>⚖</span>
            <span>{tt('mobile.nav.cases')}</span>
          </button>
          <button className={mobileCss.navPrimary} type="button" onClick={() => setModalOpen(true)}>
            <span aria-hidden>＋</span>
            <span>{tt('mobile.nav.new')}</span>
          </button>
          <button
            className={mobileCss.navItem}
            type="button"
            onClick={() => { void handleLaunchManager() }}
            disabled={launching}
          >
            <span className={mobileCss.navIcon}>🤖</span>
            <span>{tt('mobile.nav.agent')}</span>
          </button>
        </nav>
      )}

      {modalOpen && (
        <NewCaseModal submitting={submitting} onSubmit={(input) => { void handleNewCase(input) }} onClose={() => setModalOpen(false)} />
      )}

      {importOpen && (
        <ImportModal onDone={() => { void refresh() }} onClose={() => setImportOpen(false)} />
      )}

      {deleteTarget !== null && (
        <div className={css.modalOverlay} onClick={() => setDeleteTarget(null)}>
          <div className={css.confirmBox} onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true">
            <p className={css.confirmText}>{tt('detail.deleteConfirm', { name: deleteTarget.name })}</p>
            <div className={css.confirmActions}>
              <button className={css.ghostBtn} type="button" onClick={() => setDeleteTarget(null)}>{tt('modal.cancel')}</button>
              <button className={css.dangerBtn} type="button" onClick={() => { void handleDelete(deleteTarget.caseId) }}>{tt('detail.deleteCase')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
