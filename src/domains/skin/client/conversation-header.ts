/**
 * AgentLex 会话页融合设计（conversation header harmonization）。
 *
 * 1. header 单行化：把会话视图切换（对话 / 轨迹 / 记忆系统）的 tab 行「搬」进
 *    标题行（_titleCluster），header 折叠成一行；去掉官方默认的分隔线换成一根
 *    极轻的 hairline，header 用不透明表面 + z-21 抬升，压住右侧栏卡片从下方滑过。
 * 2. tabs 紧凑分段控件：整组是一块 10px 圆角的浅色托盘（inset 1px 描边，
 *    3px 内衬、2px 间隙），每个 tab 是 26px 高、7px 圆角的胶囊（13px 字、
 *    左右 12px 内衬）；激活态是白底 + 一道 inset 描边 + 极轻投影，文字回到
 *    label-primary；未激活态透明底、label-secondary。整组宽度从原来的
 *    290px 收到约 190px。
 *
 * 两个容易踩的坑（都实测过，改动时别退回去）：
 * - header 元素的 DOM 关系是 `header > [data-slot="conversation.session.header"]`，
 *   即 slot 挂在 header **里面**，不是包着 header。所以只能用
 *   `[class$="_header"]:has(> [data-slot="conversation.session.header"])`
 *   选中会话页 header；早期写的 `[data-slot=…] > header` 永远匹配不到，
 *   header 一直是原生 76px 高、带分隔线（这就是「松散」的来源之一）。
 * - `_tabs` 的宽度不能收窄成内容宽：harness 用它做溢出预算
 *   （`Math.max(1, Math.floor((row.clientWidth - 48) / 120))`），宽度一收，
 *   预算变 1，除第一个 tab 外全被塞进「…」菜单。所以只改 gap / margin /
 *   padding / 换行，`width:100%` 与 flex 保持原生。
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
 * 锚点全部是类名后缀匹配（_titleCluster/_headerActions/_tabs/_viewTabs/_tab）
 * + data-slot，不依赖 CSS Modules 哈希，官方升级换哈希也不失效。
 * sidebar.css.ts 里还有一组 `[role="tab"]` 规则，那是给右侧面板的页签用的；
 * 会话视图 tab 也带 role="tab"，所以这里的规则必须比那组更具体（多一层
 * `[data-slot="conversation.session.header"]`）才能稳定胜出。
 */
/** 会话页融合设计 CSS（header 单行化 + 视图切换紧凑分段控件）。 */
export const CONVERSATION_HEADER_CSS = `
/* —— header 单行化：一根极轻的分隔线，不透明表面 + z-21 抬升 —— */
html[data-agentlex-theme] [class$="_header"]:has(> [data-slot="conversation.session.header"]) {
  border-bottom: 1px solid var(--dsw-alias-border-l1) !important;
  min-height: 56px;
  padding: 10px 20px !important;
  z-index: 21;
  background: var(--dsw-alias-bg-base);
  position: relative;
}
html[data-agentlex-theme] [class$="_header"]:has(> [data-slot="conversation.session.header"])::after {
  content: none;
}

/* —— tab 行：只调间距，宽度留给 harness 算溢出预算 —— */
html[data-agentlex-theme] [data-slot="conversation.session.header"] [class$="_tabs"] {
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 6px;
  margin: 0 0 0 14px;
  padding: 0;
}

/* —— 分段控件托盘 —— */
html[data-agentlex-theme] [data-slot="conversation.session.header"] [class$="_tabs"] [class$="_viewTabs"] {
  display: inline-flex;
  align-items: center;
  flex-wrap: nowrap;
  gap: 2px;
  padding: 3px;
  border: 0;
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-3);
  box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l1);
}

/* —— 分段：26px 胶囊 —— */
html[data-agentlex-theme] [data-slot="conversation.session.header"] [class$="_tabs"] [class$="_viewTabs"] button[class*="_tab"] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 26px;
  min-height: 26px;
  margin: 0;
  padding: 0 12px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 13px;
  font-weight: 500;
  line-height: 1;
  letter-spacing: 0;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease, box-shadow 120ms ease;
}
/* 文字节点本身别再吃「胶囊」样式（它带 _tabLabel，会命中 [class*="_tab"]） */
html[data-agentlex-theme] [data-slot="conversation.session.header"] [class$="_tabs"] [class$="_viewTabs"] [class*="_tabLabel"] {
  display: block;
  max-width: none;
  overflow: visible;
  height: auto;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font-size: 13px;
  font-weight: inherit;
  line-height: 1;
}
html[data-agentlex-theme] [data-slot="conversation.session.header"] [class$="_tabs"] [class$="_viewTabs"] button[class*="_tab"]:hover:not([class*="_tabActive"]):not([aria-selected="true"]) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
html[data-agentlex-theme] [data-slot="conversation.session.header"] [class$="_tabs"] [class$="_viewTabs"] button[class*="_tabActive"],
html[data-agentlex-theme] [data-slot="conversation.session.header"] [class$="_tabs"] [class$="_viewTabs"] button[class*="_tab"][aria-selected="true"] {
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font-weight: 600;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08), inset 0 0 0 1px var(--dsw-alias-border-l2);
}
html[data-agentlex-theme] [data-slot="conversation.session.header"] [class$="_tabs"] [class$="_viewTabs"] button[class*="_tab"]:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}
/* 原生 tab 的下划线指示器：分段控件里不再需要 */
html[data-agentlex-theme] [data-slot="conversation.session.header"] [class$="_tabs"] [class$="_viewTabs"] button[class*="_tab"]::after {
  content: none;
}

/* —— 溢出「…」按钮与托盘等高、同中心线 —— */
html[data-agentlex-theme] [data-slot="conversation.session.header"] [class$="_viewsMore"] {
  width: 26px;
  height: 26px;
  margin-top: 0;
  border-radius: 7px;
}

/* —— 深色：托盘更沉、胶囊更亮，保持「托盘凹陷、激活浮起」的同一个方向 ——
   DSH 把深色标记打在 body 上（body.setAttribute("data-ds-dark-theme")），不是 html。 */
html[data-agentlex-theme] body[data-ds-dark-theme] [data-slot="conversation.session.header"] [class$="_tabs"] [class$="_viewTabs"] {
  background: var(--dsw-alias-bg-layer-2);
}
html[data-agentlex-theme] body[data-ds-dark-theme] [data-slot="conversation.session.header"] [class$="_tabs"] [class$="_viewTabs"] button[class*="_tabActive"],
html[data-agentlex-theme] body[data-ds-dark-theme] [data-slot="conversation.session.header"] [class$="_tabs"] [class$="_viewTabs"] button[class*="_tab"][aria-selected="true"] {
  background: var(--dsw-alias-bg-layer-1);
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
