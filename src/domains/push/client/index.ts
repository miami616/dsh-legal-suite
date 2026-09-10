/**
 * Browser-half entry for dsh-legal-suite/push.
 *
 * 2026-09-10：期限提醒设置块已并入「AgentLex 设置」页的「日程与提醒」分区
 * （settings-section.tsx 直接渲染 PushSettings），不再注册独立的
 * agentlex.workbench.item 槽位。本入口保留为空 apply，避免挂载链改动。
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'

/** Required services. */
export const inject = ['slots']

/**
 * Mount the push client surfaces.
 * @param ctx - client root context.
 */
export function apply(_ctx: ClientContext): void {
  // 期限提醒设置已并入设置页「日程与提醒」分区，此处无独立挂载。
}
