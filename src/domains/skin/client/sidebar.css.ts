/**
 * AgentLex Codex 风格边栏 CSS（v0.5）。
 *
 * 设计来源：借鉴 dsh-codex-ui 的边栏设计语言——60px 头部、36px 菜单行、
 * 32px 工作区树行、8px 圆角、柔和 hover 底，但**不替换 DSH 原生
 * sidebar 插槽**：只对原生侧栏 DOM 做样式覆盖，因此诉讼/非诉/任务入口、
 * 其他插件注入、原生宽度拖拽与折叠行为全部保留。
 *
 * v0.5 变更：侧栏整形规则全部以 `div[class*="frame"]:not([data-sidebar-collapsed])`
 * 门控——边栏折叠（窄轨道）时整形完全不生效，原生折叠布局完整接管
 * （logoRow 高度、newSession 图标按钮、工作区树图标模式等），展开时恢复。
 *
 * 门控：全部规则挂在 `html[data-agentlex-theme]`（七套主题都会设置该属性），
 * 因此结构规则对所有主题生效；颜色一律引用 dsw token 与 --alx-* 变量。
 * 同时保留不改变边栏的全局修饰：会话气泡圆角、代码块描边、新会话 Hero。
 */

export const AGENTLEX_SIDEBAR_CSS = `
/* ═══ 边栏容器：主题底色 + 极轻下沉渐变（折叠态保留，无碍） ═══ */
html[data-agentlex-theme] [data-pane="sidebar"],
html[data-agentlex-theme] [class*="sidebarCol"] {
  background: var(--dsw-specific-sidebar-fill);
  background-image: linear-gradient(180deg,
    rgba(255, 255, 255, 0.30) 0%,
    rgba(255, 255, 255, 0) 110px,
    rgba(0, 0, 0, 0.015) 100%);
}
html[data-agentlex-theme] body[data-ds-dark-theme] [data-pane="sidebar"],
html[data-agentlex-theme] body[data-ds-dark-theme] [class*="sidebarCol"] {
  background-image: linear-gradient(180deg,
    rgba(255, 255, 255, 0.02) 0%,
    rgba(255, 255, 255, 0) 110px,
    rgba(0, 0, 0, 0.05) 100%);
}

/* ═══ 头部：Codex 60px 品牌区（仅展开态） ═══ */
html[data-agentlex-theme] div[class*="frame"]:not([data-sidebar-collapsed]) [class*="logoRow"] {
  height: 60px;
  padding: 8px 10px 8px 8px;
  margin-bottom: 2px;
  gap: 6px;
  position: relative;
}
html[data-agentlex-theme] div[class*="frame"]:not([data-sidebar-collapsed]) [class*="logoRow"]::after {
  content: '';
  position: absolute;
  left: 10px; right: 10px; bottom: -1px;
  height: 1px;
  background: linear-gradient(90deg,
    var(--dsw-alias-border-l2) 0%,
    var(--dsw-alias-border-l1) 60%,
    transparent 100%);
  opacity: 0.7;
  pointer-events: none;
}
html[data-agentlex-theme] div[class*="frame"]:not([data-sidebar-collapsed]) [class*="brandIdentity"] {
  height: auto;
  min-height: 40px;
  gap: 6px;
}
html[data-agentlex-theme] div[class*="frame"]:not([data-sidebar-collapsed]) [class*="brandMark"] {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
html[data-agentlex-theme] div[class*="frame"]:not([data-sidebar-collapsed]) [class*="brandMark"] svg {
  border-radius: 9px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.10), 0 1px 2px rgba(0, 0, 0, 0.06);
}
html[data-agentlex-theme] div[class*="frame"]:not([data-sidebar-collapsed]) [class*="brandName"] {
  height: auto;
  line-height: 1.2;
}

/* 原生 newSession 隐藏（仅展开态；折叠态恢复原生图标按钮） */
html[data-agentlex-theme] div[class*="frame"]:not([data-sidebar-collapsed]) [class*="newSession"] {
  display: none !important;
}

/* ═══ 折叠态：窄轨道下隐藏注入的菜单组（新建任务 / AgentLex / 子项），
   避免宽布局溢出错位；其余整形规则因 :not([data-sidebar-collapsed]) 门控
   自动失效，原生折叠布局完整接管 ═══ */
html[data-agentlex-theme] div[class*="frame"][data-sidebar-collapsed] button[data-agentlex-new-session],
html[data-agentlex-theme] div[class*="frame"][data-sidebar-collapsed] button[data-agentlex-group],
html[data-agentlex-theme] div[class*="frame"][data-sidebar-collapsed] [data-agentlex-group-items],
html[data-agentlex-theme] div[class*="frame"][data-sidebar-collapsed] button[data-agentlex-skills-entry] {
  display: none !important;
}

/* ═══ 新任务按钮（sidebar-group.ts 注入）：Codex dcu-menu 排版，无背景，与 AgentLex 并列 ═══ */
html[data-agentlex-theme] button[data-agentlex-new-session] {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  align-items: center;
  column-gap: 6px;
  width: calc(100% - 12px);
  min-height: 30px;
  margin: 16px 6px 1px;
  padding: 0 2px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 15px;
  font-weight: 600;
  line-height: 20px;
  cursor: pointer;
  text-align: left;
  transition: background-color 120ms ease, color 120ms ease;
}
html[data-agentlex-theme] button[data-agentlex-new-session]:hover {
  background: var(--dsw-specific-sidebar-nav-item-hover);
  color: var(--dsw-alias-label-primary);
}
/* 图标：20px 固定列内 16px 图标，贴左对齐垂直居中（codex .dcu-menu-icon） */
html[data-agentlex-theme] button[data-agentlex-new-session] > svg {
  width: 15px;
  height: 15px;
  justify-self: start;
  opacity: 0.9;
}

/* ═══ AgentLex 扩展折叠菜单（sidebar-group.ts 注入）：Codex dcu-menu 排版 ═══ */
html[data-agentlex-theme] button[data-agentlex-group] {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  align-items: center;
  column-gap: 6px;
  width: calc(100% - 12px);
  min-height: 30px;
  margin: 1px 6px 2px;
  padding: 0 2px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 15px;
  font-weight: 600;
  line-height: 20px;
  cursor: pointer;
  text-align: left;
  transition: background-color 120ms ease;
}
html[data-agentlex-theme] button[data-agentlex-group]:hover {
  background: var(--dsw-specific-sidebar-nav-item-hover);
}
html[data-agentlex-theme] button[data-agentlex-group] > svg {
  width: 15px;
  height: 15px;
  justify-self: start;
  opacity: 0.9;
}
html[data-agentlex-theme] button[data-agentlex-group] .agentlex-group-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
html[data-agentlex-theme] button[data-agentlex-group] .agentlex-group-caret {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  justify-self: end;
  color: var(--dsw-alias-label-tertiary);
  transition: transform 160ms ease;
}
html[data-agentlex-theme] button[data-agentlex-group][aria-expanded="true"] .agentlex-group-caret {
  transform: rotate(90deg);
}

/* 子项容器：Codex dcu-extension-items 排版（缩进 15px + 容器 6px），网格折叠动画 */
html[data-agentlex-theme] [data-agentlex-group-items] {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 200ms ease;
  margin: 0 0 3px 15px;
}
html[data-agentlex-theme] [data-agentlex-group-items][data-open="true"] {
  grid-template-rows: 1fr;
}
html[data-agentlex-theme] [data-agentlex-group-items] > div {
  overflow: hidden;
  min-height: 0;
}

/* ═══ 组内业务入口（诉讼 / 非诉 / 任务）：Codex dcu-extension-items 子项，图标单色
    （显式 height/覆盖各域 panel.module.css 的 .entry{height:40px}——侧栏行
    复用了面板导航样式，导致块比大类菜单行还大、间距松；此处收紧为 26px 密排，
    字号 14px 仅比大类 15px 小一档） ═══ */
html[data-agentlex-theme] [data-agentlex-group-items] button[data-dsh-litigation-entry],
html[data-agentlex-theme] [data-agentlex-group-items] button[data-dsh-nonlitigation-entry],
html[data-agentlex-theme] [data-agentlex-group-items] button[data-dsh-task-entry] {
  position: relative;
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  align-items: center;
  column-gap: 6px;
  width: 100%;
  height: 26px;
  min-height: 26px;
  padding: 0 4px;
  margin: 0;
  border: 0;
  border-radius: 7px;
  background: transparent;
  /* 子项文字色：比大类（label-primary）浅一档（label-secondary），
     既与大类区分开、又不至于太淡 */
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 14px;
  font-weight: 600;
  line-height: 20px;
  cursor: pointer;
  text-align: left;
  transition: background-color 120ms ease, color 120ms ease;
}
/* 行间距：5px（比大类按钮的 1px/2px 上下边距节奏略松，三个子项视觉上
   更分明）。
   必须 !important：同文件基础规则 button[...]{margin:0} 的特异性
   （3 个属性）高于后继选择器（2 个属性），不加 !important 会被永久压掉，
   表现为 10→20→30px 改了几轮界面毫无变化。 */
html[data-agentlex-theme] [data-agentlex-group-items] > div > button + button {
  margin-top: 5px !important;
}
/* 图标：单色（无主题色块），20px 列内 15px 图标 */
html[data-agentlex-theme] [data-agentlex-group-items] button[data-dsh-litigation-entry] > span:first-child,
html[data-agentlex-theme] [data-agentlex-group-items] button[data-dsh-nonlitigation-entry] > span:first-child,
html[data-agentlex-theme] [data-agentlex-group-items] button[data-dsh-task-entry] > span:first-child {
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  width: 18px;
  height: 18px;
  /* 图标与文字同色（label-secondary，比大类浅一档） */
  color: var(--dsw-alias-label-secondary) !important;
  background: transparent !important;
  transition: color 120ms ease;
}
html[data-agentlex-theme] [data-agentlex-group-items] button[data-dsh-litigation-entry] > span:first-child svg,
html[data-agentlex-theme] [data-agentlex-group-items] button[data-dsh-nonlitigation-entry] > span:first-child svg,
html[data-agentlex-theme] [data-agentlex-group-items] button[data-dsh-task-entry] > span:first-child svg {
  display: block;
  width: 14px;
  height: 14px;
  flex: none;
}
html[data-agentlex-theme] [data-agentlex-group-items] button[data-dsh-litigation-entry]:hover,
html[data-agentlex-theme] [data-agentlex-group-items] button[data-dsh-nonlitigation-entry]:hover,
html[data-agentlex-theme] [data-agentlex-group-items] button[data-dsh-task-entry]:hover {
  background: var(--dsw-specific-sidebar-nav-item-hover);
  color: var(--dsw-alias-label-primary);
}
html[data-agentlex-theme] [data-agentlex-group-items] button[data-dsh-litigation-entry]:hover > span:first-child,
html[data-agentlex-theme] [data-agentlex-group-items] button[data-dsh-nonlitigation-entry]:hover > span:first-child,
html[data-agentlex-theme] [data-agentlex-group-items] button[data-dsh-task-entry]:hover > span:first-child {
  color: var(--dsw-alias-label-primary) !important;
}
/* 激活：软底 + 加粗（无色块、无左条） */
html[data-agentlex-theme] [data-agentlex-group-items] button[data-dsh-litigation-entry][data-active="true"],
html[data-agentlex-theme] [data-agentlex-group-items] button[data-dsh-nonlitigation-entry][data-active="true"],
html[data-agentlex-theme] [data-agentlex-group-items] button[data-dsh-task-entry][data-active="true"] {
  background: var(--dsw-specific-sidebar-nav-item-active-bg);
  color: var(--dsw-alias-label-primary);
  font-weight: 600;
  box-shadow: none;
}
html[data-agentlex-theme] [data-agentlex-group-items] button[data-dsh-litigation-entry][data-active="true"] > span:first-child,
html[data-agentlex-theme] [data-agentlex-group-items] button[data-dsh-nonlitigation-entry][data-active="true"] > span:first-child,
html[data-agentlex-theme] [data-agentlex-group-items] button[data-dsh-task-entry][data-active="true"] > span:first-child {
  color: var(--dsw-alias-label-primary) !important;
}
html[data-agentlex-theme] [data-agentlex-group-items] button[data-dsh-litigation-entry] > span:last-child,
html[data-agentlex-theme] [data-agentlex-group-items] button[data-dsh-nonlitigation-entry] > span:last-child,
html[data-agentlex-theme] [data-agentlex-group-items] button[data-dsh-task-entry] > span:last-child {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
html[data-agentlex-theme] [data-agentlex-group-items] button[data-dsh-litigation-entry]:focus-visible,
html[data-agentlex-theme] [data-agentlex-group-items] button[data-dsh-nonlitigation-entry]:focus-visible,
html[data-agentlex-theme] [data-agentlex-group-items] button[data-dsh-task-entry]:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}

/* ═══ 小节头：与频道/定时 rail 头部（ima-head / dsh-st-*）字号统一
    —— 保持 36px 原生行高、去掉延展发丝线，避免与工作区 searchSlot 的
    flex:1 抢空间导致图标错位（仅展开态） ═══ */
html[data-agentlex-theme] div[class*="frame"]:not([data-sidebar-collapsed]) [class*="sectionHeader"] {
  height: 36px;
  margin-top: 8px !important;
  margin-bottom: 4px;
  padding: 4px 8px 0 4px;
  border-top: 0;
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
}
html[data-agentlex-theme] div[class*="frame"]:not([data-sidebar-collapsed]) [class*="sectionLabel"],
html[data-agentlex-theme] div[class*="frame"]:not([data-sidebar-collapsed]) [data-pane="sidebar"] [class*="groupLabel"],
html[data-agentlex-theme] div[class*="frame"]:not([data-sidebar-collapsed]) [data-pane="sidebar"] [class*="headLabel"] {
  font-size: 13px !important;
  font-weight: 500 !important;
  letter-spacing: 0.03em;
  color: var(--dsw-alias-label-tertiary) !important;
}

/* 工作区底部分割线（柔和淡出，仅展开态）；底部留白加大让工作区整体上移，
   不至于贴到窗口下缘 */
html[data-agentlex-theme] div[class*="frame"]:not([data-sidebar-collapsed]) [class*="regionArea"] {
  border-bottom: 0;
  margin-bottom: 16px;
  padding-bottom: 4px;
  position: relative;
}
html[data-agentlex-theme] div[class*="frame"]:not([data-sidebar-collapsed]) [class*="regionArea"]::after {
  content: '';
  position: absolute;
  left: 10px; right: 10px; bottom: 0;
  height: 1px;
  background: linear-gradient(90deg, var(--dsw-alias-border-l2), transparent 90%);
  pointer-events: none;
}

/* ═══ 工作区树：项目 32px 粗体 / 会话 32px 半粗，8px 圆角，柔和 hover（仅展开态） ═══ */
html[data-agentlex-theme] div[class*="frame"]:not([data-sidebar-collapsed]) [class*="projectRow"] {
  height: 32px;
  padding: 0 10px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  line-height: 32px;
}
html[data-agentlex-theme] div[class*="frame"]:not([data-sidebar-collapsed]) [class*="sessionRow"] {
  height: 32px;
  padding: 0 10px 0 6px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  line-height: 32px;
  transition: background-color 110ms ease;
}
html[data-agentlex-theme] div[class*="frame"]:not([data-sidebar-collapsed]) [class*="sessionRow"] :where(a, span, div, p, h1, h2, h3, h4, h5, h6, button) {
  font-size: inherit !important;
  font-weight: inherit !important;
  color: var(--dsw-alias-label-secondary) !important;
}
html[data-agentlex-theme] div[class*="frame"]:not([data-sidebar-collapsed]) [class*="sessionRow"]:hover :where(a, span, div, p, h1, h2, h3, h4, h5, h6, button) {
  color: var(--dsw-alias-label-primary) !important;
}
html[data-agentlex-theme] div[class*="frame"]:not([data-sidebar-collapsed]) [class*="sessionRow"] > svg,
html[data-agentlex-theme] div[class*="frame"]:not([data-sidebar-collapsed]) [class*="sessionRow"] svg {
  width: 13px;
  height: 13px;
}
html[data-agentlex-theme] div[class*="frame"]:not([data-sidebar-collapsed]) [class*="sessionRow"]:hover {
  background: var(--dsw-specific-sidebar-nav-item-hover);
}
html[data-agentlex-theme] div[class*="frame"]:not([data-sidebar-collapsed]) [class*="flatList"] > * + *,
html[data-agentlex-theme] div[class*="frame"]:not([data-sidebar-collapsed]) [class*="searchTree"] > [role='treeitem'] + [role='treeitem'],
html[data-agentlex-theme] div[class*="frame"]:not([data-sidebar-collapsed]) [class*="groupSection"] > * + * {
  margin-top: 2px;
}

/* 未读圆点：7px 圆形，品牌强调色（仅展开态） */
html[data-agentlex-theme] div[class*="frame"]:not([data-sidebar-collapsed]) [class*="sessionRow"] [class*="unread"],
html[data-agentlex-theme] div[class*="frame"]:not([data-sidebar-collapsed]) [class*="projectRow"] [class*="unread"] {
  width: 7px !important;
  height: 7px !important;
  border-radius: 50% !important;
  background: var(--dsw-alias-state-business-primary) !important;
}

/* ═══ 频道 / 定时轨道统一（与任务树一致的视觉，仅展开态）═══
   im-connect（频道）与 dsh-automation（定时）通过包裹官方任务树
   在侧栏插入 rail（类名前缀 ima-* / dsh-st-*）。这里把侧栏内的
   列表行 / 卡片统一成任务树同款：32px 行、8px 圆角、柔和 hover、
   同一字号与文字层级。限定在侧栏容器内，不影响对话区与设置页。 */
html[data-agentlex-theme] div[class*="frame"]:not([data-sidebar-collapsed]) [data-pane="sidebar"] .ima-list,
html[data-agentlex-theme] div[class*="frame"]:not([data-sidebar-collapsed]) [data-pane="sidebar"] .dsh-st-group,
html[data-agentlex-theme] div[class*="frame"]:not([data-sidebar-collapsed]) [data-pane="sidebar"] [class*="dsh-st-list"] {
  padding: 2px 6px;
}
html[data-agentlex-theme] div[class*="frame"]:not([data-sidebar-collapsed]) [data-pane="sidebar"] .ima-card,
html[data-agentlex-theme] div[class*="frame"]:not([data-sidebar-collapsed]) [data-pane="sidebar"] .ima-chip,
html[data-agentlex-theme] div[class*="frame"]:not([data-sidebar-collapsed]) [data-pane="sidebar"] .dsh-st-card,
html[data-agentlex-theme] div[class*="frame"]:not([data-sidebar-collapsed]) [data-pane="sidebar"] .dsh-st-chip {
  min-height: 32px;
  border-radius: 8px;
  padding: 0 10px;
  border: 0;
  background: transparent !important;
  color: var(--dsw-alias-label-secondary);
  font-size: 14px;
  font-weight: 500;
  line-height: 32px;
  transition: background-color 110ms ease, color 110ms ease;
}
html[data-agentlex-theme] div[class*="frame"]:not([data-sidebar-collapsed]) [data-pane="sidebar"] .ima-card:hover,
html[data-agentlex-theme] div[class*="frame"]:not([data-sidebar-collapsed]) [data-pane="sidebar"] .ima-chip:hover,
html[data-agentlex-theme] div[class*="frame"]:not([data-sidebar-collapsed]) [data-pane="sidebar"] .dsh-st-card:hover,
html[data-agentlex-theme] div[class*="frame"]:not([data-sidebar-collapsed]) [data-pane="sidebar"] .dsh-st-chip:hover {
  background: var(--dsw-specific-sidebar-nav-item-hover) !important;
  color: var(--dsw-alias-label-primary);
}
html[data-agentlex-theme] div[class*="frame"]:not([data-sidebar-collapsed]) [data-pane="sidebar"] .ima-head,
html[data-agentlex-theme] div[class*="frame"]:not([data-sidebar-collapsed]) [data-pane="sidebar"] [class*="dsh-st-n-head-label"],
html[data-agentlex-theme] div[class*="frame"]:not([data-sidebar-collapsed]) [data-pane="sidebar"] .dsh-st-heading {
  font-size: 12px !important;
  font-weight: 500 !important;
  letter-spacing: 0.03em;
  color: var(--dsw-alias-label-tertiary) !important;
}
html[data-agentlex-theme] div[class*="frame"]:not([data-sidebar-collapsed]) [data-pane="sidebar"] .ima-badge {
  background: var(--dsw-alias-state-business-primary) !important;
  color: var(--dsw-alias-label-primary-inverted) !important;
}

/* 行图标统一：16px 图标 + 20px 图标列（任务树与频道/定时一致，仅展开态） */
html[data-agentlex-theme] div[class*="frame"]:not([data-sidebar-collapsed]) [data-pane="sidebar"] [class*="projectRow"] svg,
html[data-agentlex-theme] div[class*="frame"]:not([data-sidebar-collapsed]) [data-pane="sidebar"] [class*="sessionRow"] svg,
html[data-agentlex-theme] div[class*="frame"]:not([data-sidebar-collapsed]) [data-pane="sidebar"] .ima-card svg,
html[data-agentlex-theme] div[class*="frame"]:not([data-sidebar-collapsed]) [data-pane="sidebar"] .ima-chip svg,
html[data-agentlex-theme] div[class*="frame"]:not([data-sidebar-collapsed]) [data-pane="sidebar"] .dsh-st-card svg,
html[data-agentlex-theme] div[class*="frame"]:not([data-sidebar-collapsed]) [data-pane="sidebar"] .dsh-st-chip svg {
  width: 16px !important;
  height: 16px !important;
  flex: none;
  margin-right: 4px;
}

/* ═══ 右侧标签页（对话/轨迹）：分段控件 ═══ */
html[data-agentlex-theme] [role="tablist"] {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-3);
  border: 1px solid var(--dsw-alias-border-l1);
}
html[data-agentlex-theme] [role="tab"] {
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  padding: 5px 14px;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease, box-shadow 120ms ease;
}
html[data-agentlex-theme] [role="tab"]:hover {
  color: var(--dsw-alias-label-primary);
}
html[data-agentlex-theme] [role="tab"][aria-selected="true"] {
  background: var(--dsw-specific-bubble);
  color: var(--dsw-specific-sidebar-nav-item-active-accent);
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.10);
}

/* ═══ 会话气泡与输入区 ═══ */
html[data-agentlex-theme] [class*="bubble"] {
  border-radius: 14px;
  border: 1px solid var(--dsw-alias-border-l1);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}
/* 注意：不要在 composer* 容器上统一加 :focus-within 边框/光环——
   composer 类名在嵌套的多个容器上都会出现，会叠出好几圈线条。 */
/* 代码块描边与圆角统一 */
html[data-agentlex-theme] pre[class*="code"],
html[data-agentlex-theme] [class*="codeBlock"] {
  border-radius: 10px;
}

/* ═══ 新会话 Hero ═══ */
html[data-agentlex-theme] [class*="headlineText"],
html[data-agentlex-theme] [class*="previewBadge"] {
  display: none !important;
}
html[data-agentlex-theme] [class*="headline"]:not([class*="headlineText"]):not([class*="previewBadge"]) {
  display: flex !important;
  justify-content: center;
  align-items: center;
  gap: 12px;
  grid-template-columns: none !important;
}

/* 渐变文字保留静态观感；不再用 background-position 无限动画——
   background-clip: text 上的背景位移动画在 Blink 里每帧重绘文字，
   常驻空会话页时持续占用 ~50% 单核 CPU（实测）。 */
html[data-agentlex-theme] .agentlex-hero-greeting {
  font-weight: 600;
  background: linear-gradient(90deg,
    var(--dsw-alias-label-primary) 0%,
    var(--dsw-alias-label-secondary) 30%,
    var(--alx-accent) 50%,
    var(--dsw-alias-label-secondary) 70%,
    var(--dsw-alias-label-primary) 100%);
  background-size: 200% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: transparent;
}
@supports not ((-webkit-background-clip: text) or (background-clip: text)) {
  html[data-agentlex-theme] .agentlex-hero-greeting {
    color: var(--dsw-alias-label-primary);
    -webkit-text-fill-color: currentColor;
    background: none;
    animation: none;
  }
}
html[data-agentlex-theme] .agentlex-hero-meta {
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}
html[data-agentlex-theme] .agentlex-hero-subtitle {
  font-weight: 500;
  letter-spacing: 0.01em;
  color: var(--dsw-alias-label-secondary);
}

/* ── 设置页：边栏主题色、内容区纯白（对齐模块主页的层次方式） ──
 * 面板容器 = overlay 内以 _panel 结尾的唯一大面板；背景走 DSH bg-base
 * （pure 下为白，dark 自动为深色），不再用灰蓝的 module-platform 底。 */
html[data-agentlex-theme] div[class$="_overlay"] > div[class$="_panel"] {
  background: var(--dsw-alias-bg-base, #ffffff);
}
`
