/**
 * Original AgentLex non-litigation module mounted inside the DSH plugin.
 *
 * POC replacement for the simplified NonLitigationPanel: mounts the original
 * NonLitigationManager + NonLitigationDetailPage directly. Data flows through
 * the DSH adapter (`/api/agentlex/*`); project-service session launch is
 * stubbed for now.
 */
import { useCallback, useEffect, useState } from 'react'
import { ImagePreviewProvider } from '@/context/ImagePreviewContext'
import { ToastProvider } from '@/components/Toast'
import NonLitigationManager from '@/pages/NonLitigationManager'
import { useAgentLex } from '@/hooks/useAgentLex'
import '@/i18n'
import { injectOriginalStyles } from '../../../shared/original-styles'

export interface OriginalNonLitigationPanelProps {
  launchManager: (opts?: { context?: string; projectName?: string; existingSessionId?: string; onLaunched?: (sessionId: string) => void }) => Promise<string | undefined>
  onClose: () => void
  /** Resolves the DSH workspace archive set — archived sessions are never
   *  offered as historical sessions nor auto-reused. */
  getArchivedSessionIds?: () => Promise<Set<string>>
}

export function OriginalNonLitigationPanel({ launchManager, onClose, getArchivedSessionIds }: OriginalNonLitigationPanelProps): React.JSX.Element {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const { projects, bindProjectSession } = useAgentLex()

  useEffect(() => {
    injectOriginalStyles()
  }, [])

  // The caller only invokes this for a NEW session (existing picks go through
  // the detail page's own quick-launch path) — always create, never silently
  // reuse a historical session.
  const handleStartProjectService = useCallback((projectId: string, _typeId: string, message: string) => {
    const project = projects.find((p) => p.projectId === projectId)
    void launchManager({
      context: message || `请帮我处理项目 ${project?.name ?? projectId}`,
      projectName: project?.name,
      onLaunched: async (sessionId) => {
        if (sessionId && projectId) {
          try {
            await bindProjectSession(projectId, sessionId, `项目: ${project?.name ?? projectId}`, _typeId)
          } catch (error) {
            console.warn('[agentlex-nonlitigation] bindProjectSession failed:', error)
          }
        }
        onClose()
      },
    })
  }, [launchManager, bindProjectSession, projects, onClose])

  return (
    <ImagePreviewProvider>
      <ToastProvider>
        <div
          className="agentlex-original-root"
          data-theme-id="myagents-default"
          data-color-scheme="light"
          style={{ height: '100%', width: '100%', overflow: 'hidden', background: 'var(--paper, #faf6ee)' }}
        >
          <NonLitigationManager
            isActive
            onLaunchSteward={() => { void launchManager({ onLaunched: () => onClose() }) }}
            selectedProjectId={selectedProjectId}
            onSelectProject={setSelectedProjectId}
            onStartProjectService={handleStartProjectService}
            getArchivedSessionIds={getArchivedSessionIds}
            trafficInset={0}
            hasDockedSession={false}
            dockedSessionTitle=""
            onCloseDockedSession={() => {}}
            onMoveDockedToWorkspace={() => {}}
            onOpenCalendar={() => {}}
          />
        </div>
      </ToastProvider>
    </ImagePreviewProvider>
  )
}
