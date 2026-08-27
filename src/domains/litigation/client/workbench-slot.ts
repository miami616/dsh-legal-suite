/**
 * agentlex.workbench.item —— 套件内设置槽位契约。
 *
 * 由 dsh-skin 的「AgentLex 设置」设置页拥有：该页把每个注册项渲染为页面内
 * 的一个设置块（块标题取 options.label），与 settings.section 的平铺页面不同，
 * 它不占用顶层设置导航。litigation 在此放置「插件版本与更新」（版本检测 +
 * 一键更新）。
 *
 * 声明归属与 settings 域一致：SlotMap 的运行时声明由拥有页面的一方
 * （dsh-skin）merge；消费方（litigation）做同形 declare module 合并，使
 * 两边的 register / entries 调用都能通过 typecheck，运行时不产生任何依赖。
 */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'agentlex.workbench.item': {
      kind: 'list'
      scope: 'root'
      owner: AgentLexWorkbenchItemOwnerProps
    }
  }

  interface AgentLexWorkbenchItemOwnerProps {
    /** Marker field: workbench item owner props are intentionally empty. */
    children?: never
  }
}

export {}