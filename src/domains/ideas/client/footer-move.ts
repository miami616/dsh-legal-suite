/**
 * 把「想法」底部按钮从 footerActions 槽位移入 settingsArea 行，
 * 使其与「设置」按钮同一行、靠右角落对齐。
 *
 * sidebar.footer.action 槽位默认渲染在 footerActions（设置上方独立一行），
 * 无法与设置对齐。这里用 MutationObserver 把按钮移动到 settingsArea 内、
 * 设置触发按钮之前，保证视觉上与设置平行。
 */
import { injectIdeasFooterCss } from './footer-css.ts'

const IDEAS_BTN = 'button[data-agentlex-ideas-footer]'
const SETTINGS_AREA = '.hHd-Xa_settingsArea, [data-slot="sidebar.settings"]'
const SETTINGS_TRIGGER = '.hHd-Xa_settingsArea button, [data-slot="sidebar.settings"] button'

/** 把想法按钮移入 settingsArea（幂等）。 */
function moveIntoSettingsArea(): void {
  const btn = document.querySelector<HTMLElement>(IDEAS_BTN)
  if (btn === null) return
  const area = document.querySelector<HTMLElement>(SETTINGS_AREA)
  if (area === null) return
  // 已在 settingsArea 内则不动。
  if (area.contains(btn)) return
  const trigger = area.querySelector<HTMLElement>(SETTINGS_TRIGGER)
  if (trigger !== null) {
    // 触发按钮可能嵌套在 [data-slot] 容器内，需插到与 trigger 同父的位置。
    const anchor = trigger.parentElement ?? area
    anchor.insertBefore(btn, trigger)
  } else {
    area.appendChild(btn)
  }
}

/** 挂载：注入样式 + 持续把按钮移入 settingsArea。 */
export function mountIdeasFooter(): () => void {
  if (typeof document === 'undefined') return () => {}
  const disposeCss = injectIdeasFooterCss()
  moveIntoSettingsArea()
  const observer = new MutationObserver(() => moveIntoSettingsArea())
  observer.observe(document.body, { childList: true, subtree: true })
  return () => {
    observer.disconnect()
    disposeCss()
  }
}
