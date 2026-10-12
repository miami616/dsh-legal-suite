/**
 * dsh-legal-suite/redact — browser half。
 *
 * 界面形态：**并入「技能与工具 → 小工具」**（分组「隐私与脱敏」，卡片「文书脱敏」），
 * 由 skills-tools 域在面板内直接渲染 RedactPanel；本域不再单独挂浮动图标。
 *
 * 本入口只负责注入面板样式（一次），并跟随设置页「文书脱敏」总开关。
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { REDACT_CSS } from './redact.css.ts'

export const name = 'dsh-legal-suite/redact'

const STYLE_ATTR = 'data-agentlex-redact-css'

/** 注入面板样式（幂等；卸载时移除）。 */
export function injectRedactCss(): () => void {
  if (typeof document === 'undefined') return () => {}
  if (document.querySelector(`style[${STYLE_ATTR}]`) === null) {
    const tag = document.createElement('style')
    tag.setAttribute(STYLE_ATTR, '1')
    tag.textContent = REDACT_CSS
    document.head.appendChild(tag)
  }
  return () => { document.querySelector(`style[${STYLE_ATTR}]`)?.remove() }
}

export function apply(ctx: ClientContext): void {
  const disposeCss = injectRedactCss()
  ctx.effect(() => () => disposeCss(), 'dsh-legal-suite/redact: styles')
}
