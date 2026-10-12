/**
 * dsh-legal-suite — browser half（合包版）。
 *
 * 单 client bundle 聚合 5 个域的浏览器端：诉讼面板 / 非诉面板 / 任务面板 /
 * 皮肤（主题+品牌+工作台设置页）。每个域沿用自己的 client apply——
 * 注册自己的 locale、sidebar entry、panel 挂载与 SSE 刷新通道；皮肤域负责
 * 主题 token 覆盖与 AgentLex 品牌槽位。
 *
 * inject 并集：slots + locale + sessions（业务面板）、theme + inputTriggers +
 * workspaces（皮肤/工具域）。cordis 按并集等待全部客户端服务就绪后执行本 apply。
 *
 * ⚠ 设置服务**不进 inject**：0.1.6 叫 `settingsScope`、0.1.7-alpha.1 起改名
 * `configForms`，把任一个写进必需注入表都会让另一代整包 pending 不加载。改由
 * `resolveClientSettings` 走 root-first 运行时解析（shared/client-settings.ts）。
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { apply as applyLitigation } from '../domains/litigation/client/index.ts'
import { apply as applyNonlitigation } from '../domains/nonlitigation/client/index.ts'
import { apply as applyTask } from '../domains/task/client/index.ts'
import { apply as applySkin } from '../domains/skin/client/index.ts'
import { apply as applyWorkspaceSidebar } from '../domains/workspace-sidebar/client/index.tsx'
import { apply as applySkillsTools } from '../domains/skills-tools/client/index.tsx'
import { apply as applyMemo } from '../domains/memo/client/index.tsx'
import { apply as applyMootCourt } from '../domains/moot-court/client/index.tsx'
import { apply as applyRedact } from '../domains/redact/client/index.tsx'

export const name = 'dsh-legal-suite'

/** 全部客户端域所需注入的并集。设置服务两代同名，一律走运行时解析。 */
export const inject = ['slots', 'locale', 'sessions', 'theme', 'inputTriggers', 'workspaces']

/**
 * 挂载全部客户端域。各域独立管理自己的挂载/卸载（fiber effect 与
 * module-toggles 订阅），调用顺序与旧 6-entry 布局一致：业务面板先行，
 * 皮肤最后应用全局样式。
 */
export function apply(ctx: ClientContext): void {
  applyLitigation(ctx)
  applyNonlitigation(ctx)
  applyTask(ctx)
  applySkin(ctx)
  applyWorkspaceSidebar(ctx)
  applySkillsTools(ctx)
  applyMemo(ctx)
  applyMootCourt(ctx)
  applyRedact(ctx)
}
