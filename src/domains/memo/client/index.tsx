/**
 * dsh-legal-suite/memo — browser half.
 *
 * 挂载可拖拽浮动入口按钮 + 备忘录弹窗面板 + 会话输入框 `#` 自动补全。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { mountMemo } from './mount.tsx'

export const name = 'dsh-legal-suite/memo'

export function apply(ctx: ClientContext): void {
  let disposeMemo: (() => void) | null = null
  let memoEnabled = true

  const sync = (): void => {
    if (memoEnabled) {
      if (disposeMemo === null) disposeMemo = mountMemo(ctx)
    } else {
      disposeMemo?.()
      disposeMemo = null
    }
  }

  const onToggles = (e: Event): void => {
    const detail = (e as CustomEvent<Record<string, unknown>>).detail ?? {}
    if (typeof detail.memoEnabled === 'boolean') memoEnabled = detail.memoEnabled
    sync()
  }
  window.addEventListener('agentlex:toggles-changed', onToggles)
  sync()

  ctx.effect(() => () => {
    window.removeEventListener('agentlex:toggles-changed', onToggles)
    disposeMemo?.()
    disposeMemo = null
  }, 'dsh-legal-suite/memo: entry')
}
