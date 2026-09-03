/**
 * agentlex.workbench.item —— 套件内设置槽位契约。
 *
 * 由 dsh-skin 的「AgentLex 设置」设置页拥有；litigation 在此放置「插件版本与更新」，
 * push 在此放置「IM 推送」。声明归属与 settings 域一致：SlotMap 的运行时声明由
 * 拥有页面的一方（dsh-skin）merge；消费方（push）做同形 declare module 合并，
 * 使 register 调用通过 typecheck，运行时不产生任何依赖。
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
