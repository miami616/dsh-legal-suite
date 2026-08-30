/**
 * Non-litigation panel — the plugin's main surface. Owns the data fetch +
 * registry-changed subscription and two-level navigation (project board →
 * detail), plus a secondary 常法服务 view and the new/delete/import flows.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProjectRecord, ServiceRecord } from '../store/types.ts'
import * as api from './api.ts'
import type { PanelController } from './controller.ts'
import { errorMessage, tt } from './i18n.ts'
import { ProjectBoard } from './components/ProjectBoard.tsx'
import { NewProjectModal, type NewProjectInput } from './components/NewProjectModal.tsx'
import { ProjectDetail } from './detail/ProjectDetail.tsx'
import { useIsMobile } from './use-mobile.ts'
import css from './panel.module.css'
import mobileCss from './mobile.module.css'

interface NonLitigationPanelProps {
  controller: PanelController
}

type View = 'projects' | 'services'

export function NonLitigationPanel({ controller }: NonLitigationPanelProps): React.JSX.Element {
  const mobile = useIsMobile()
  const [view, setView] = useState<View>('projects')
  const [projects, setProjects] = useState<ProjectRecord[]>([])
  const [services, setServices] = useState<ServiceRecord[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ProjectRecord | null>(null)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [loading, setLoading] = useState(true)
  /** 项目体检（projectId → 完整度/缺口/台账/建议），旁路数据。 */
  const [healthByProject, setHealthByProject] = useState<Map<string, api.ProjectHealthView>>(new Map())
  const bootedRef = useRef(false)

  const refresh = useCallback(async () => {
    try {
      const [reg, svc] = await Promise.all([api.readProjects(), api.listServices()])
      setProjects(Object.values(reg.projects))
      setServices(svc)
      setError('')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setLoading(false)
    }
    // 体检是只读旁路数据：失败只影响「完整度」提示，不能拖垮看板。
    try {
      const summary = await api.projectHealth() as { projects: api.ProjectHealthView[] }
      setHealthByProject(new Map(summary.projects.map((h) => [h.projectId, h])))
    } catch {
      /* 静默降级 */
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

  const handleNewProject = async (input: NewProjectInput): Promise<void> => {
    setSubmitting(true)
    try {
      const created = await api.registerProject({
        name: input.name,
        projectType: input.projectType,
        status: input.status,
        leadLawyer: input.leadLawyer,
        servicePeriod: { start: input.servicePeriodStart, end: input.servicePeriodEnd },
        serviceScope: input.serviceScope ? input.serviceScope.split(/[\s,，/]+/).filter(Boolean) : [],
        folder: input.folder,
      })
      setModalOpen(false)
      setSelectedProjectId(created.projectId)
      setView('projects')
      await refresh()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async (projectId: string): Promise<void> => {
    try {
      await api.deleteProject(projectId)
      if (selectedProjectId === projectId) setSelectedProjectId(null)
      setDeleteTarget(null)
      await refresh()
    } catch (err) {
      setError(errorMessage(err))
      setDeleteTarget(null)
    }
  }

  const handleImport = async (): Promise<void> => {
    setError('')
    setInfo('')
    try {
      const r = await api.importAgentLex()
      setInfo(tt('svc.done', { added: String(r.projectsAdded), updated: String(r.projectsUpdated), services: String(r.servicesImported) }))
      await refresh()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const selected = selectedProjectId === null ? undefined : projects.find((p) => p.projectId === selectedProjectId)
  const inDetail = selectedProjectId !== null && selected !== undefined

  return (
    <div className={`${css.panel} ${mobile ? mobileCss.panelMobile : ''}`}>
      <header className={`${css.header} ${mobile ? mobileCss.headerMobile : ''}`}>
        {inDetail && !mobile ? (
          <>
            <button className={css.backBtn} type="button" onClick={() => setSelectedProjectId(null)}>{tt('detail.back')}</button>
            <h1 className={css.title}>{selected!.name}</h1>
          </>
        ) : (
          <>
            <h1 className={css.title}>{tt('panel.title')}</h1>
            {!mobile && <span className={css.subtitle}>{tt('panel.subtitle')}</span>}
            {!mobile && (
              <div className={css.viewSwitch}>
                <button type="button" className={view === 'projects' ? `${css.viewSwitchBtn} ${css.viewSwitchBtnActive}` : css.viewSwitchBtn} onClick={() => setView('projects')}>{tt('service.projects')}</button>
                <button type="button" className={view === 'services' ? `${css.viewSwitchBtn} ${css.viewSwitchBtnActive}` : css.viewSwitchBtn} onClick={() => setView('services')}>{tt('service.services')}</button>
              </div>
            )}
          </>
        )}
        <button className={css.close} type="button" aria-label="Close" onClick={() => controller.close()}>✕</button>
      </header>

      {info !== '' && <div className={css.infoBar}>{info}</div>}
      {error !== '' && view === 'projects' && !inDetail && <div className={`${css.infoBar} ${css.infoBarError}`}>{error}</div>}

      {loading ? (
        <div className={css.body}><p className={css.muted}>…</p></div>
      ) : (
        <>
          <div className={css.body}>
            {!mobile && inDetail ? (
              <ProjectDetail record={selected!} onChange={refresh} />
            ) : view === 'projects' ? (
              <ProjectBoard
                projects={projects}
                healthByProject={healthByProject}
                searchQuery={searchQuery}
                onSearch={setSearchQuery}
                onOpenProject={setSelectedProjectId}
                onNewProject={() => setModalOpen(true)}
                onDeleteProject={(id) => { const p = projects.find((x) => x.projectId === id); if (p) setDeleteTarget(p) }}
                onImport={() => { void handleImport() }}
              />
            ) : (
              <ServicesView services={services} />
            )}
          </div>

          {mobile && inDetail && (
            <div className={mobileCss.drawerLayer}>
              <div className={mobileCss.drawerScrim} onClick={() => setSelectedProjectId(null)} />
              <div className={mobileCss.drawer} role="dialog" aria-modal="true">
                <header className={mobileCss.drawerHeader}>
                  <button className={css.backBtn} type="button" onClick={() => setSelectedProjectId(null)}>{tt('detail.back')}</button>
                  <h1 className={mobileCss.drawerTitle}>{selected!.name}</h1>
                  <button className={css.close} type="button" aria-label="Close" onClick={() => setSelectedProjectId(null)}>✕</button>
                </header>
                <div className={mobileCss.drawerBody}>
                  <ProjectDetail record={selected!} onChange={refresh} />
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {mobile && (
        <nav className={mobileCss.bottomNav}>
          <button
            className={`${mobileCss.navItem} ${view === 'projects' ? mobileCss.navItemActive : ''}`}
            type="button"
            onClick={() => { setView('projects'); setSelectedProjectId(null) }}
          >
            <span className={mobileCss.navIcon}>🗂</span>
            <span>{tt('mobile.nav.projects')}</span>
          </button>
          <button className={mobileCss.navPrimary} type="button" onClick={() => setModalOpen(true)}>
            <span aria-hidden>＋</span>
            <span>{tt('mobile.nav.newProject')}</span>
          </button>
          <button
            className={`${mobileCss.navItem} ${view === 'services' ? mobileCss.navItemActive : ''}`}
            type="button"
            onClick={() => { setView('services'); setSelectedProjectId(null) }}
          >
            <span className={mobileCss.navIcon}>🗄</span>
            <span>{tt('mobile.nav.services')}</span>
          </button>
        </nav>
      )}

      {modalOpen && (
        <NewProjectModal submitting={submitting} onSubmit={(input) => { void handleNewProject(input) }} onClose={() => setModalOpen(false)} />
      )}

      {deleteTarget !== null && (
        <div className={css.modalOverlay} onClick={() => setDeleteTarget(null)}>
          <div className={css.confirmBox} onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true">
            <p className={css.confirmText}>{tt('delete.confirm', { name: deleteTarget.name })}</p>
            <div className={css.confirmActions}>
              <button className={css.ghostBtn} type="button" onClick={() => setDeleteTarget(null)}>{tt('modal.cancel')}</button>
              <button className={css.dangerBtn} type="button" onClick={() => { void handleDelete(deleteTarget.projectId) }}>{tt('delete.confirmBtn')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ServicesView({ services }: { services: ServiceRecord[] }): React.JSX.Element {
  if (services.length === 0) {
    return <div className={css.svcWrap}><p className={css.svcEmpty}>暂无常法服务记录。</p></div>
  }
  return (
    <div className={css.svcWrap}>
      <div className={css.svcList}>
        {services.map((s) => (
          <div key={s.id} className={css.svcRow}>
            <span className={css.svcIcon}>🗂</span>
            <div className={css.svcBody}>
              <div className={css.svcName}>{s.name || s.id}</div>
              <div className={css.svcMeta}>
                {[s.kind, s.client, s.date].filter(Boolean).join(' · ') || (s.status ?? 'active')}
              </div>
            </div>
            <span className={`${css.badge} ${s.status === 'active' ? css['tone-accent'] : css['tone-neutral']}`}>{s.status ?? 'active'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
