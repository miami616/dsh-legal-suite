/**
 * Global CSS for the ideas sidebar-foot action button.
 *
 * 按钮由 footer-move.ts 移入 settingsArea（与「设置」同一行、靠右角落）。
 * 这里只负责按钮本身的紧凑图标样式。
 */
export const IDEAS_FOOTER_CSS = `
.agentlex-ideas-footer-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 30px;
  height: 30px;
  margin: 0 2px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 8px;
  color: var(--lit-ink-muted, #6f6156);
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
.agentlex-ideas-footer-action:hover {
  background: var(--lit-hover-bg, rgba(194, 109, 58, 0.07));
  color: var(--lit-ink, #1c1612);
}
.agentlex-ideas-footer-action[data-active='true'] {
  background: var(--lit-accent-subtle, rgba(194, 109, 58, 0.08));
  color: var(--lit-accent, #c26d3a);
}
.agentlex-ideas-footer-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
}
/* 折叠 rail：居中显示 */
.hHd-Xa_collapsed .agentlex-ideas-footer-action {
  justify-content: center;
}
`

/** 注入全局样式（幂等）。 */
export function injectIdeasFooterCss(): () => void {
  if (typeof document === 'undefined') return () => {}
  const tagId = 'agentlex-ideas-footer-css'
  if (document.querySelector(`style[data-agentlex-ideas-footer="${tagId}"]`) !== null) return () => {}
  const tag = document.createElement('style')
  tag.dataset.agentlexIdeasFooter = tagId
  tag.textContent = IDEAS_FOOTER_CSS
  document.head.appendChild(tag)
  return () => tag.remove()
}
