/**
 * dsh-legal-suite/file-download — browser half entry.
 *
 * Contributes the「下载」action to both file-card surfaces the conversation
 * renders: deliveries (`present`) and changed-file review rows. Registration
 * waits for the slot declaration through `slots.inject` (harness 0.2.x) and
 * falls back to a bounded retry on older compositions where the slot has not
 * been declared yet. A composition without the deliverables plugin simply
 * never mounts the control.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { ChangedDownloadAction, PresentedDownloadAction } from './DownloadAction.tsx'

export const name = 'dsh-legal-suite/file-download'

/** The two card surfaces, each with its own host route family. */
const SURFACES: Array<{ slot: string; id: string; component: unknown }> = [
  { slot: 'deliverables.file.actions', id: 'agentlex-download-presented', component: PresentedDownloadAction },
  { slot: 'deliverables.review.file.actions', id: 'agentlex-download-changed', component: ChangedDownloadAction },
]

/** Minimal view of the runtime slot service we use; the real types live in the host's renderer package. */
interface SlotService {
  inject?(key: string, callback: () => () => void): (() => void) | undefined
  register(spec: Record<string, unknown>, component: unknown): () => void
}

export function apply(ctx: ClientContext): void {
  const slots = ctx.slots as unknown as SlotService | undefined
  if (slots === undefined) return

  const disposers: Array<() => void> = []
  const timers: number[] = []

  for (const { slot, id, component } of SURFACES) {
    const register = (): (() => void) => slots.register({ name: slot, id, order: 10 }, component)
    try {
      if (typeof slots.inject === 'function') {
        const injected = slots.inject(slot, register)
        if (injected !== undefined) {
          disposers.push(injected)
          continue
        }
      }
    } catch (error) {
      console.warn(`[agentlex-download] ${slot} inject failed:`, error)
    }

    // Older harness: the declaring plugin may mount after us; retry a few
    // seconds until the slot exists, then give up quietly.
    let attempts = 0
    let dispose: (() => void) | undefined
    const attempt = (): void => {
      if (dispose !== undefined) return
      try {
        dispose = register()
        disposers.push(dispose)
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error)
        if (!text.includes('is not declared') || attempts >= 20) {
          if (attempts >= 20) console.warn(`[agentlex-download] ${slot} not declared after retries`)
          return
        }
        attempts += 1
        timers.push(window.setTimeout(attempt, 500))
      }
    }
    attempt()
  }

  ctx.effect(() => () => {
    for (const timer of timers.splice(0)) window.clearTimeout(timer)
    for (const dispose of disposers.splice(0)) {
      try { dispose() } catch { /* already disposed */ }
    }
  }, 'dsh-legal-suite/file-download: slot entries')
}
