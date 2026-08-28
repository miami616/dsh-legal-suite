/**
 * Ideas — 侧边栏底部「想法」图标按钮（sidebar.footer.action 槽位）。
 *
 * 渲染在 DSH 侧边栏底部、与「设置」平行，靠右角落的紧凑图标按钮，
 * 点击打开「想法」弹窗。宽侧栏与折叠 rail 均只显示灯泡图标。
 * 打开动作由 index.ts 的 document 捕获监听（data-agentlex-ideas-footer）桥接。
 */
import type { SidebarFooterActionOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { tt } from './i18n.ts'

function BulbIcon({ size = 16 }: { size?: number }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-4 10.5c.8.7 1.2 1.7 1.4 2.5h5.2c.2-.8.6-1.8 1.4-2.5A6 6 0 0 0 12 3Z"/>
    </svg>
  )
}

export interface IdeasFooterActionProps extends SidebarFooterActionOwnerProps {
  [key: string]: unknown
}

export function IdeasFooterAction(_props: IdeasFooterActionProps): React.JSX.Element {
  return (
    <button
      type="button"
      className="agentlex-ideas-footer-action"
      data-agentlex-ideas-footer
      aria-label={tt('entry.label')}
      title={tt('entry.tooltip')}
    >
      <span className="agentlex-ideas-footer-icon"><BulbIcon size={16} /></span>
    </button>
  )
}
