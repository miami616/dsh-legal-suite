/**
 * dsh-legal-suite — 法律事务 DSH 套件（单插件合包版）。
 *
 * 本包是「真·单插件」：cordis.patch.yml 只插入一个 entry（agentlex），
 * 由本聚合插件在 apply 内用 ctx.plugin() 嵌套挂载各业务域（诉讼/非诉/任务/
 * 皮肤/技能与工具）与套件自身。等价于旧版 6 个独立 entry 的运行时行为：
 * 每个子域获得独立 fiber，各自的 settings section、路由、agent preset
 * 注册互不干扰。
 *
 * 配置：为兼容旧版各 entry 的独立设置分区，各子域仍以独立 settings
 * namespace 注册（agentlex-litigation / agentlex-nonlitigation /
 * agentlex-task / agentlex-legal-suite），本层只负责装配，不吞并配置。
 */
import type { Context } from '@deepseek-ai/cordis'
import z from 'schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import * as suite from './suite.ts'
import * as litigation from './domains/litigation/index.ts'
import * as nonlitigation from './domains/nonlitigation/index.ts'
import * as task from './domains/task/index.ts'
import * as skin from './domains/skin/index.ts'
import * as workspaceSidebar from './domains/workspace-sidebar/index.ts'
import * as skillsTools from './domains/skills-tools/index.ts'
import * as memo from './domains/memo/index.ts'
import * as push from './domains/push/index.ts'
import * as item from './domains/item/index.ts'

export const name = 'dsh-legal-suite'

/**
 * 并集注入：子域（诉讼/非诉/任务/技能与工具）需要 webServer + systemPrompt
 * + tools，皮肤与套件需要 webServer。声明并集让 cordis 在全部服务就绪后
 * 再 apply。
 */
export const inject = ['webServer', 'systemPrompt', 'tools', 'settings']

/** 聚合配置：保留套件级开关（enabled），子域各自仍走独立设置分区。 */
export interface Config {
  enabled?: boolean
  /**
   * Agent-preset 模式：只挂载指定业务域的 scoped tool（agent 会话内使用），
   * 不挂任何 host 路由/stores/皮肤。取值 'litigation' | 'nonlitigation'。
   */
  agentPreset?: 'litigation' | 'nonlitigation'
}

export const Config: Schemastery<Schemastery.ObjectS<Config>, Config> = z.object({
  enabled: z.boolean().default(true),
  agentPreset: z.union(['litigation', 'nonlitigation']).required(false),
})

/**
 * 挂载全部业务域。每个子域通过 ctx.plugin() 嵌套挂载——cordis 为每个
 * 子域创建独立 fiber（与旧 6-entry 布局等价），settings / 路由 /
 * agent preset 的注册互不冲突；fiber reload 时每个子域按自己的 token
 * 重建 surface。
 */
export function apply(ctx: Context, config: Config = {}): void {
  if (config.enabled === false) return

  // Agent-preset 平面：只挂载指定域的 scoped tool（不注册 host 表面）。
  if (config.agentPreset === 'litigation') {
    ctx.plugin(litigation, { agentPreset: true })
    return
  }
  if (config.agentPreset === 'nonlitigation') {
    ctx.plugin(nonlitigation, { agentPreset: true })
    return
  }

  // 套件自身（/api/agentlex-suite/config、/api/agentlex/read 聚合、preset 安装）。
  ctx.plugin(suite, {})
  // 诉讼域（案件/任务树/时间轴/日程/期限提醒 + 诉讼管家 preset）。
  ctx.plugin(litigation, {})
  // 非诉域（项目/合同/研究/常法）。
  ctx.plugin(nonlitigation, {})
  // 任务域（独立任务 + 跨插件统一任务视图）。
  ctx.plugin(task, {})
  // 皮肤域（AgentLex 主题/品牌/工作台设置页；与套件共用设置分区，各自 fiber 隔离）。
  ctx.plugin(skin, {})
  // 工作区右边栏域（会话工作区右侧面板：文件树/搜索/预览/终端/引用联动；
  // 由桌面端 app renderer 移植，client 经双 renderer 解析打包）。
  ctx.plugin(workspaceSidebar, {})
  // 技能与工具域（技能落盘 ~/.dsh/skills + MCP 热加载，CRUD 路由）。
  ctx.plugin(skillsTools, {})
  // 备忘录域（随手记/标签/归档 + 会话 # 引用自动补全，host 存储 + 工具）。
  ctx.plugin(memo, {})
  // 期限 IM 推送域（关键日期快到期 → dsh-im 主动投递；定时复用 dsh-timer-agent）。
  ctx.plugin(push, {})
  // 统一事项域（事件+任务统一模型，items.json；诉讼/非诉/任务管理共用）。
  ctx.plugin(item, {})
}
