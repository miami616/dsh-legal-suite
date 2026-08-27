/**
 * 三业务模块（诉讼 / 非诉 / 任务）风格适配 —— 与 0.5.0 会话排版风格呼应。
 *
 * 手法（借鉴 UI/UX 技能，色系保持 AgentLex 品牌 --lit-* 主题变量）：
 *   - 卡片：顶部主题色渐变细条 + hover 时 accent 边框与柔和彩色阴影，
 *     从「灰边死板」变成「活泼但不喧宾夺主」。
 *   - 详情页：section 卡片 accent 淡边框；sectionTitle 主题色左竖线；
 *     infoLabel 用 accent-strong 强调色。
 *   - 状态/标签：accent 边框点缀（不覆盖语义色背景）。
 *   - 移动端（≤767px）：卡片高度/列宽/间距收紧，统计条与标题行压缩，
 *     消除窄屏下的占位过大与溢出。
 *
 * 选择器锚定稳定 DOM：三模块面板容器 data-dsh-*-view + CSS Modules
 * 类后缀（hash_card / hash_section / hash_sectionTitle…，后缀稳定）。
 *
 * ⚠ 容器列表必须用 :is() 包裹后拼接后代选择器 —— 若写成裸的逗号列表
 * 再拼 ` ${CARD}`，前 N-1 个选择器会退化为「匹配视图容器本身」，
 * 把样式直接套在诉讼/非诉整个容器上导致页面错乱（0.5.1 事故教训）。
 */

const MODULES = ':is([data-dsh-litigation-view], [data-dsh-nonlitigation-view], [data-dsh-task-view])'

/** 卡片类后缀选择器（精确后缀，不误中 _cardBody / _cardFooter）。 */
const CARD = '[class$="_card"]'
const STATS = '[class$="_statsBar"]'
const SECTION = '[class$="_section"]'
const SECTION_TITLE = '[class$="_sectionTitle"]'
const SECTION_HEAD = '[class$="_sectionHead"]'
const INFO_LABEL = '[class$="_infoLabel"]'
const STATUS_PILL = '[class$="_statusPill"]'
const TAG_CHIP = '[class$="_tagChip"]'
const MASTHEAD = '[class$="_masthead"]'

export const BUSINESS_MODULES_CSS = `
/* ============ 三业务模块：卡片 / 详情页风格适配 ============ */

/* --- 边框整体加深一档（仅三模块作用域内提升 line 变量强度） --- */
${MODULES} {
  --lit-line: color-mix(in srgb, var(--lit-ink, #191b1f) 26%, transparent);
  --lit-line-strong: color-mix(in srgb, var(--lit-ink, #191b1f) 40%, transparent);
  --lit-line-subtle: color-mix(in srgb, var(--lit-ink, #191b1f) 14%, transparent);
}

/* --- 页面背景跟随新会话页（白→浅灰渐变）；warm 主题保持原纸底 --- */
html[data-agentlex-theme]:not([data-agentlex-theme='warm']) .agentlex-original-root,
html[data-agentlex-theme]:not([data-agentlex-theme='warm']) .agentlex-original-root [class*="bg-[var(--paper)]"] {
  background: linear-gradient(rgb(255, 255, 255) 0%, rgb(247, 247, 247) 100%) !important;
}

/* --- 卡片：顶部主题渐变细条 + 边框带色 --- */
${MODULES} ${CARD} {
  position: relative;
  background: color-mix(in srgb, var(--lit-accent, #b05e2d) 1.5%, var(--lit-paper-elevated, #ffffff));
  border-width: 1px;
  border-style: solid;
  border-color: color-mix(in srgb, var(--lit-accent, #b05e2d) 62%, var(--lit-line, rgba(0,0,0,0.16)));
}
${MODULES} ${CARD}::before {
  content: "";
  position: absolute;
  top: 12px;
  left: 0;
  bottom: 12px;
  width: 4px;
  border-radius: 0 4px 4px 0;
  background: linear-gradient(180deg, var(--lit-accent-strong, #b05e2d), var(--lit-accent-cool, var(--lit-accent, #2e6f5e)));
  pointer-events: none;
}
${MODULES} ${CARD}:hover,
${MODULES} ${CARD}:focus-within {
  border-color: color-mix(in srgb, var(--lit-accent, #b05e2d) 70%, var(--lit-line, rgba(0,0,0,0.12)));
  box-shadow: 0 8px 22px color-mix(in srgb, var(--lit-accent, #b05e2d) 16%, transparent);
}

/* --- 详情页：section 卡片 accent 淡边框 + 标题主题色竖线 --- */
${MODULES} ${SECTION} {
  border-width: 1px;
  border-style: solid;
  border-color: color-mix(in srgb, var(--lit-accent, #b05e2d) 55%, var(--lit-line, rgba(0,0,0,0.16)));
}
${MODULES} ${SECTION_TITLE} {
  border-left: 3px solid var(--lit-accent-strong, #b05e2d);
  padding-left: 9px;
  color: var(--lit-ink, #171310);
  font-weight: 750;
  font-size: 15px;
}
${MODULES} ${INFO_LABEL} {
  color: var(--lit-accent-strong, #b05e2d);
  font-weight: 600;
}

/* --- 状态 / 标签：accent 边框点缀（保留语义色背景） --- */
${MODULES} ${STATUS_PILL} {
  border: 1px solid color-mix(in srgb, var(--lit-accent, #b05e2d) 50%, transparent);
}
${MODULES} ${TAG_CHIP} {
  border: 1px solid color-mix(in srgb, var(--lit-accent-cool, #2e6f5e) 45%, transparent);
}

/* --- 详情页 masthead 分隔线带主题色 --- */
${MODULES} ${MASTHEAD} {
  border-bottom-color: color-mix(in srgb, var(--lit-accent, #b05e2d) 45%, transparent);
}

/* ============ 移动端适配（≤767px 窄屏） ============ */
@media (max-width: 767px) {
  /* 卡片：由内容决定高度，左侧 rail 收窄，标题紧凑 */
  ${MODULES} ${CARD} {
    min-height: 0;
    grid-template-columns: 44px minmax(0, 1fr);
  }
  ${MODULES} ${CARD}::before {
    top: 8px;
    bottom: 8px;
  }
  ${MODULES} ${STATS} {
    margin: 12px 12px 0;
    padding: 10px 14px;
    gap: 14px;
  }
  ${MODULES} ${SECTION} {
    padding: 14px 14px;
  }
  ${MODULES} ${SECTION_HEAD} {
    margin-bottom: 8px;
  }
  ${MODULES} ${SECTION_TITLE} {
    font-size: 12px;
    margin-bottom: 8px;
  }
}
`.trim()
