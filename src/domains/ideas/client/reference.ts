/**
 * 把想法以 `#idea-<id>` 引用令牌写入会话输入框。
 *
 * 复用 workspace-sidebar 的 chat-input-bridge（纯 DOM，无 React 依赖），
 * 保证输入框已有内容不被覆盖。令牌用 `#` 前缀（而非文件引用的 `@`），
 * 避免与 DSH 文件引用触发冲突。
 */
import { chatInputBridge } from '../../workspace-sidebar/client/chat-input-bridge.ts'

/** 由想法 id 生成唯一引用令牌。 */
export function ideaRefToken(ideaId: string): string {
  return `#idea-${ideaId.replace(/^idea-/, '')}`
}

/** 在输入框末尾追加引用令牌（保留已有内容）。 */
export function insertIdeaReference(ideaId: string): void {
  try {
    const current = chatInputBridge.getValue().trimEnd()
    const token = ideaRefToken(ideaId)
    chatInputBridge.setValue(current === '' ? token : `${current}\n${token}`)
    chatInputBridge.focus()
  } catch (error) {
    console.warn('[agentlex-ideas] insert reference failed:', error)
  }
}

/** 复制引用令牌到剪贴板。 */
export function copyIdeaReference(ideaId: string): Promise<void> {
  const token = ideaRefToken(ideaId)
  if (navigator.clipboard !== undefined) {
    return navigator.clipboard.writeText(token)
  }
  return new Promise((resolve, reject) => {
    try {
      const ta = document.createElement('textarea')
      ta.value = token
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      resolve()
    } catch (error) {
      reject(error)
    }
  })
}
