/**
 * Original AgentLex unified task management module mounted inside the DSH
 * plugin.
 *
 * POC replacement for the simplified TaskPanel: mounts the original
 * TaskManager.tsx (统一任务管理/日历) directly. Data flows through the DSH
 * adapter; "open case" navigation is not wired yet.
 */
import { useEffect } from 'react'
import { ImagePreviewProvider } from '@/context/ImagePreviewContext'
import { ToastProvider } from '@/components/Toast'
import TaskManager from '@/pages/TaskManager'
import '@/i18n'
import { injectOriginalStyles } from '../../../shared/original-styles'

export function OriginalTaskPanel(): React.JSX.Element {
  useEffect(() => {
    injectOriginalStyles()
  }, [])

  return (
    <ImagePreviewProvider>
      <ToastProvider>
        <div
          className="agentlex-original-root"
          data-theme-id="myagents-default"
          data-color-scheme="light"
          style={{ height: '100%', width: '100%', overflow: 'hidden', background: 'var(--paper, #faf6ee)' }}
        >
          <TaskManager
            isActive
            onOpenCase={() => { /* POC: cross-module case jump not wired yet */ }}
          />
        </div>
      </ToastProvider>
    </ImagePreviewProvider>
  )
}
