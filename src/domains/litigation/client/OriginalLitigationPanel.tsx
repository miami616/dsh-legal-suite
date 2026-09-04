/**
 * Original AgentLex litigation module mounted inside the DSH plugin.
 *
 * This is the POC replacement for the simplified LitigationPanel: instead of
 * re-implementing a case board, it mounts the ORIGINAL CaseManager +
 * CaseDetailPage components directly. The original components read/write via
 * the DSH adapter (`/api/agentlex/*`), and the DSH session launcher maps the
 * "诉讼管家" button to a real DSH conversation.
 */
import { useCallback, useEffect, useState } from 'react'
import { ImagePreviewProvider } from '@/context/ImagePreviewContext'
import { ToastProvider } from '@/components/Toast'
import CaseManager from '@/pages/CaseManager'
import { useAgentLex, type CaseEntry } from '@/hooks/useAgentLex'
import '@/i18n'
import { injectOriginalStyles } from '../../../shared/original-styles'
import type { PanelController } from './controller.ts'

interface OriginalLitigationPanelProps {
  /** Opens a DSH 诉讼管家 conversation (and usually closes this panel). */
  launchManager: (opts?: { context?: string; caseName?: string; existingSessionId?: string; onLaunched?: (sessionId: string) => void }) => Promise<string | undefined>
  /** Called by the mount layer when the panel should hand the center column back. */
  onClose: () => void
  /** Opens a bound case folder in the better-sidebar (optional integration). */
  openCaseFolder?: (folder: string, title?: string, sessionId?: string) => void
  /** Resolves the DSH workspace archive set — archived sessions are never
   *  offered as historical sessions nor auto-reused. */
  getArchivedSessionIds?: () => Promise<Set<string>>
  /** Panel controller, used to receive external "open this case" requests. */
  controller?: PanelController
  /**
   * Case id preselected when the panel first renders (the conversation-view
   * tab opens straight on the bound case's detail — same page the plugin
   * shows when clicking the case in its board).
   */
  initialSelectedCaseId?: string | null
}

export function OriginalLitigationPanel({ launchManager, onClose, openCaseFolder, getArchivedSessionIds, controller, initialSelectedCaseId = null }: OriginalLitigationPanelProps): React.JSX.Element {
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(initialSelectedCaseId)
  const { bindSession } = useAgentLex()

  useEffect(() => {
    injectOriginalStyles()
  }, [])

  // External entry points (e.g. the session-header "案件详情" button) ask the
  // panel to open a specific case through the controller's pendingCaseId.
  useEffect(() => {
    if (!controller) return
    const applyPending = (): void => {
      const pending = controller.getSnapshot().pendingCaseId
      if (pending !== null) {
        setSelectedCaseId(pending)
        controller.consumePendingCaseId()
      }
    }
    applyPending()
    return controller.subscribe(applyPending)
  }, [controller])

  const handleOpenCaseAgent = useCallback(() => {
    void launchManager({ onLaunched: onClose })
  }, [launchManager, onClose])

  const handleOpenCaseSession = useCallback((caseEntry: CaseEntry, sessionId?: string, intake = false, bindingKey?: string) => {
    // Open a specific historical session the user picked from the dropdown.
    // A stale pick that was archived in the DSH workspace falls through to a
    // brand-new session instead.
    const openExisting = (id: string): void => {
      void launchManager({
        existingSessionId: id,
        onLaunched: (sid) => {
          if (sid && caseEntry.folder) openCaseFolder?.(caseEntry.folder, caseEntry.name, sid)
          onClose()
        },
      })
    }
    // 新建会话 / no bound sessions → ALWAYS create a new session, never
    // silently reuse a historical one.
    const createNew = (): void => {
      // Build an intake/normal message matching the original desktop app.
      const context = intake && caseEntry.folder
        ? [
            `## 新建案件 — 请补全信息`,
            ``,
            `- 案件编号: ${caseEntry.caseId}`,
            `- 案件名称: ${caseEntry.name}`,
            `- 案件类型: ${caseEntry.type}`,
            `- 案件文件夹: ${caseEntry.folder}`,
            caseEntry.caseNumber ? `- 法院案号: ${caseEntry.caseNumber}` : '',
            caseEntry.court ? `- 管辖法院: ${caseEntry.court}` : '',
            caseEntry.parties?.plaintiff ? `- 原告: ${caseEntry.parties.plaintiff}` : '',
            caseEntry.parties?.defendant ? `- 被告: ${caseEntry.parties.defendant}` : '',
            ``,
            `请按流程补全信息：信息不完整先读卷宗逐项用工具补全，已完善则询问下一步。`,
          ].filter(Boolean).join('\n')
        : caseEntry.caseId
          ? `案件「${caseEntry.name}」已就绪。案件编号：${caseEntry.caseId}；案件文件夹：\`${caseEntry.folder}\`。请告诉我需要做什么。`
          : undefined
      void launchManager({
        context,
        caseName: caseEntry.name,
        onLaunched: async (sid) => {
          if (sid && caseEntry.caseId) {
            try {
              await bindSession(caseEntry.caseId, sid, `案件: ${caseEntry.name}`, bindingKey ?? 'litigation')
            } catch (error) {
              console.warn('[agentlex-litigation] bindSession failed:', error)
            }
          }
          if (sid && caseEntry.folder) openCaseFolder?.(caseEntry.folder, caseEntry.name, sid)
          onClose()
        },
      })
    }
    if (sessionId) {
      const archived = getArchivedSessionIds?.() ?? Promise.resolve(new Set<string>())
      void archived
        .then((ids) => (ids.has(sessionId) ? createNew() : openExisting(sessionId)))
        .catch(() => openExisting(sessionId))
      return
    }
    createNew()
  }, [launchManager, bindSession, onClose, openCaseFolder, getArchivedSessionIds])

  return (
    <ImagePreviewProvider>
      <ToastProvider>
        <div className="agentlex-original-root" data-theme-id="myagents-default" data-color-scheme="light" style={{ height: '100%', width: '100%', overflow: 'hidden', background: 'var(--paper, #faf6ee)' }}>
          <CaseManager
            isActive
            selectedCaseId={selectedCaseId}
            onSelectCase={setSelectedCaseId}
            onOpenCaseSession={handleOpenCaseSession}
            onOpenCaseFolder={openCaseFolder}
            getArchivedSessionIds={getArchivedSessionIds}
            onCaseRegistered={() => { /* navigation handled internally by CaseManager */ }}
            trafficInset={0}
            hasDockedSession={false}
            dockedSessionTitle=""
            onCloseDockedSession={() => {}}
            onMoveDockedToWorkspace={() => {}}
            onOpenCalendar={() => { window.dispatchEvent(new CustomEvent('agentlex:open-task-panel')) }}
            onOpenCaseAgent={handleOpenCaseAgent}
          />
        </div>
      </ToastProvider>
    </ImagePreviewProvider>
  )
}
