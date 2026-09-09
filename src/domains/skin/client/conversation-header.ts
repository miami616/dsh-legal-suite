/**
 * AgentLex 会话页融合设计（conversation header harmonization）。
 *
 * 融合自 dsh-ui-harmonizer 0.8.3 的「单行标题 + 按钮胶囊族」设计：
 *
 * 1. header 单行化：把会话/轨迹切换的 tab 行「搬」进标题行（_titleCluster），
 *    header 折叠成一行；去掉官方默认的分隔线与伪元素装饰，header 用不透明
 *    表面 + z-21 抬升，压住右侧栏卡片从下方滑过。
 * 2. tabs 胶囊化：28px 胶囊（radius 14px）、13px/20px 字、默认
 *    bg-layer-1 底 + border-l2 边，激活态品牌蓝底 + 白字（#fff，不用
 *    --dsw-alias-label-primary-inverted——该 token 在暗色主题解析成近黑，
 *    蓝底黑字；#fff 明暗两主题都正确）。
 *
 * 与 harmonizer 的差异（共存卫生）：
 * - 不设 header 的 margin-right（harmonizer 的 max(var(--dsh-sidebar-width),
 *   90px) 是给 better-sidebar toggle cluster 留位，本套件不依赖 better-sidebar，
 *   设了会在无 toggle cluster 时留白；harmonizer 在时它的规则继续生效）。
 * - 全部规则门控在 html[data-agentlex-theme]（皮肤启用才生效，与
 *   CONVERSATION_TITLE_CSS 同款门控），皮肤关闭即整体还原。
 * - tabs 重定位带幂等检查（tabs 已在 titleCluster 内则跳过），与 harmonizer
 *   的 relocateTabs 并存不重复插入。
 *
 * 锚点全部是类名后缀匹配（_titleCluster/_headerActions/_tabs）+ data-slot，
 * 不依赖 CSS Modules 哈希，官方升级换哈希也不失效。
 */
/** 会话页融合设计 CSS（header 单行化 + tabs 胶囊化）。 */
export const CONVERSATION_HEADER_CSS = `
/* —— header 单行化：去分隔线/伪元素装饰，不透明表面 + z-21 抬升 —— */
html[data-agentlex-theme] [data-slot="conversation.session.header"] > header {
  border-bottom: none !important;
  padding: 12px 20px !important;
  z-index: 21;
  background: var(--dsw-alias-bg-base);
  position: relative;
}
html[data-agentlex-theme] [data-slot="conversation.session.header"] > header:after {
  content: none;
}
/* —— tabs 胶囊化：28px 胶囊族 —— */
html[data-agentlex-theme] [class$="_tabs"] {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 0 8px;
}
html[data-agentlex-theme] [class$="_tabs"] [class*="_tab"] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 28px;
  padding: 0 14px;
  border-radius: 14px;
  border: 1px solid var(--dsw-alias-border-l2, transparent);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  flex: none;
  font-size: 13px;
  line-height: 20px;
}
html[data-agentlex-theme] [class$="_tabs"] [class*="_tab"]:hover:not(:disabled):not([class*="_tabActive"]) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
html[data-agentlex-theme] [class$="_tabs"] [class*="_tabActive"],
html[data-agentlex-theme] [class$="_tabs"] [class*="_tab"][aria-selected="true"] {
  background: var(--dsw-alias-state-business-primary);
  color: #fff;
  border-color: transparent;
}
html[data-agentlex-theme] [class$="_tabs"] [class*="_tab"]:after {
  content: none;
}
`.trim()

/**
 * 挂载会话页融合设计的 DOM 控制：把 tabs 搬进标题行（单行化的关键）。
 * React 重渲染可能把 tabs 移回原位，用 MutationObserver 持续纠正。
 * 幂等：tabs 已在 titleCluster 内则跳过（与 harmonizer 并存不重复插入）。
 * @returns disposer 断开观察器。
 */
export function mountConversationHeader(): () => void {
  const relocateTabs = (): void => {
    const titleCluster = document.querySelector('[class$="_titleCluster"]')
    const actions = titleCluster?.querySelector('[class$="_headerActions"]')
    const tabs = document.querySelector('[data-slot="conversation.session.header"] [class$="_tabs"]')
    if (titleCluster === null || tabs === null) return
    if (tabs.parentElement === titleCluster) return
    const ref = actions !== undefined && actions !== null ? actions.nextSibling : null
    titleCluster.insertBefore(tabs, ref)
  }
  relocateTabs()
  const observer = new MutationObserver(relocateTabs)
  observer.observe(document.body, { childList: true, subtree: true })
  return () => observer.disconnect()
}
