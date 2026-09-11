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
import { useColorScheme } from '../../../shared/color-scheme.ts'

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
  // Follow the DSH palette (the vendored theme owns the dark token set).
  const scheme = useColorScheme()

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

  // 「在侧边栏打开」项目卷宗：走与诉讼侧同一条通道 ——
  // agentlex-workspace:panel-open（展开右边栏）+ reveal-request（把该目录设为
  // 「案件卷宗」tab 的根并打开）。官方右边栏缺席时由自绘面板接住。
  const handleOpenProjectFolder = useCallback((folder: string) => {
    // 先 reveal（决定右边栏宽度），再 panel-open。
    window.dispatchEvent(new CustomEvent('agentlex-workspace:reveal-request', { detail: { path: folder } }))
    window.dispatchEvent(new CustomEvent('agentlex-workspace:panel-open'))
  }, [])

  return (
    <ImagePreviewProvider>
      <ToastProvider>
        <div
          className="agentlex-original-root"
          data-theme-id="myagents-default"
          data-color-scheme={scheme}
          style={{ height: '100%', width: '100%', overflow: 'hidden', background: 'var(--paper, #faf6ee)' }}
        >
          <NonLitigationManager
            isActive
            onLaunchSteward={() => { void launchManager({ onLaunched: () => onClose() }) }}
            selectedProjectId={selectedProjectId}
            onSelectProject={setSelectedProjectId}
            onStartProjectService={handleStartProjectService}
            onOpenProjectFolder={handleOpenProjectFolder}
            getArchivedSessionIds={getArchivedSessionIds}
            trafficInset={0}
            hasDockedSession={false}
            dockedSessionTitle=""
            onCloseDockedSession={() => {}}
            onMoveDockedToWorkspace={() => {}}
            onOpenCalendar={() => { window.dispatchEvent(new CustomEvent('agentlex:open-task-panel')) }}
          />
        </div>
      </ToastProvider>
    </ImagePreviewProvider>
  )
}
