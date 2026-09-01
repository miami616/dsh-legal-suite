/**
 * memo-input-bridge.ts — 会话输入框 `#` 备忘录引用桥（浏览器端）。
 *
 * 复用 dsh-legal-suite workspace-sidebar 的 chat-input-bridge DOM 定位策略：
 *   1. 用候选 CSS 选择器定位 DSH 会话 composer（contenteditable / textarea 两种
 *      形态；穿透 shadow DOM；MutationObserver 自愈）。
 *   2. 监听 composer 的 input/beforeinput，在光标处探测 `#` 触发词：
 *      `#` + 跟随的词（\w / CJK）即触发自动补全弹层。
 *   3. 提供 insertToken(ref, replaceFrom) 把 `#...` 替换为完整的 `#ref `。
 *
 * 与 chat-input-bridge 不同：这里需要「读」光标偏移与「写」替换的对称能力，
 * 而非只做末尾/光标追加。
 */

import type { MemoItem } from '../store/types.ts'

// ---------------------------------------------------------------------------
// 定位（与 chat-input-bridge 同一套策略）
// ---------------------------------------------------------------------------

function isEditableInput(el: HTMLElement): boolean {
  return (
    el instanceof HTMLTextAreaElement ||
    el.isContentEditable ||
    el.getAttribute('role') === 'textbox' ||
    el.getAttribute('contenteditable') === 'true'
  )
}

function isTextarea(el: HTMLElement): el is HTMLTextAreaElement {
  return el instanceof HTMLTextAreaElement
}

const INPUT_SELECTORS: readonly string[] = [
  // Lexical 富文本：记忆中的稳定锚点 data-lexical-editor
  '[data-pane="conversation"] [contenteditable="true"][data-lexical-editor="true"]',
  '[data-pane="conversation"] [data-lexical-editor="true"]',
  '[data-pane="conversation"] [class*="composer"] [contenteditable="true"]',
  '[data-pane="conversation"] textarea[class*="composer"]',
  '[data-pane="conversation"] [class*="composer"] textarea',
  '[data-pane="conversation"] [contenteditable="true"][role="textbox"]',
  '[data-conversation-scroll] [contenteditable="true"][data-lexical-editor="true"]',
  '[data-conversation-scroll] [class*="composer"] [contenteditable="true"]',
  '[data-conversation-scroll] textarea[class*="composer"]',
  '[data-conversation-scroll] [class*="composer"] textarea',
  '[contenteditable="true"][data-lexical-editor="true"]',
  '[class*="composer"] [contenteditable="true"]',
  'textarea[class*="composer"]',
  '[role="textbox"][contenteditable="true"]',
]

function probeInRoot(root: Document | ShadowRoot): HTMLElement | null {
  for (const selector of INPUT_SELECTORS) {
    const el = root.querySelector<HTMLElement>(selector)
    if (el && isEditableInput(el)) return el
  }
  return null
}

function probeShadow(root: Document | ShadowRoot, depth = 0): HTMLElement | null {
  if (depth > 6) return null
  for (const host of root.querySelectorAll<HTMLElement>('*')) {
    const shadow = host.shadowRoot
    if (!shadow) continue
    const direct = probeInRoot(shadow)
    if (direct) return direct
    const nested = probeShadow(shadow, depth + 1)
    if (nested) return nested
  }
  return null
}

function probeInput(): HTMLElement | null {
  return probeInRoot(document) ?? probeShadow(document)
}

let cachedInput: HTMLElement | null = null
let observer: MutationObserver | null = null
let healing = false

function cachedValid(): boolean {
  return cachedInput !== null && cachedInput.isConnected && isEditableInput(cachedInput)
}

function heal(): void {
  if (cachedInput && !cachedValid()) cachedInput = null
  if (cachedInput || healing) return
  healing = true
  const settle = (): void => {
    healing = false
    if (cachedInput === null) cachedInput = probeInput()
  }
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(settle)
  else setTimeout(settle, 0)
}

function ensureObserver(): void {
  if (observer) return
  const root = document.body ?? document.documentElement
  if (!root) return
  observer = new MutationObserver(heal)
  observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'role', 'contenteditable'] })
}

export function findComposer(): HTMLElement | null {
  if (cachedValid()) return cachedInput
  ensureObserver()
  cachedInput = probeInput()
  return cachedInput
}

// ---------------------------------------------------------------------------
// 光标 / 文本
// ---------------------------------------------------------------------------

/** 读 contenteditable 内光标（或选区起始）相对文本整体偏移。 */
function contenteditableCaretOffset(el: HTMLElement): number {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) return (el.textContent ?? '').length
  const range = sel.getRangeAt(0)
  const prefix = document.createRange()
  prefix.setStart(el, 0)
  prefix.setEnd(range.startContainer, range.startOffset)
  return prefix.toString().length
}

/** 读整个输入框文本。 */
export function readComposerText(el: HTMLElement): string {
  return isTextarea(el) ? el.value : (el.textContent ?? '')
}

/** 读光标偏移（0 为开头）。 */
export function readCaret(el: HTMLElement): number {
  if (isTextarea(el)) return el.selectionStart ?? 0
  return contenteditableCaretOffset(el)
}

/**
 * 解析光标前的触发词。返回 `#token` 片段：当光标前的最后一个 `#` 位于
 * 行首或前导空白之后，且其后紧跟可继续输入的词字时生效。返回 null 表示
 * 不该弹补全。
 */
export function parseTrigger(text: string, caret: number): { hashIndex: number; token: string } | null {
  const before = text.slice(0, caret)
  const hashIndex = before.lastIndexOf('#')
  if (hashIndex === -1) return null
  // `#` 必须是「行首 或 前导空白之后」，避免命中 #tag 之外的普通井号语境。
  if (hashIndex > 0 && !/\s/.test(before[hashIndex - 1])) return null
  const after = text.slice(hashIndex + 1, caret)
  // token 只允许词字/中英/数字/连字符/下划线。
  if (!/^[A-Za-z0-9_\-\u4e00-\u9fff]*$/.test(after)) return null
  return { hashIndex, token: after.toLowerCase() }
}

// ---------------------------------------------------------------------------
// 写入（替换 `#...` 为完整引用）
// ---------------------------------------------------------------------------

const TEXTAREA_VALUE_SETTER: ((value: string) => void) | null =
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set ?? null

function dispatchInput(el: HTMLElement): void {
  let event: Event
  try {
    event = new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText' })
  } catch {
    event = new Event('input', { bubbles: true })
  }
  el.dispatchEvent(event)
}

function scheduleCaret(el: HTMLTextAreaElement, pos: number): void {
  const apply = (): void => { if (el.isConnected) el.setSelectionRange(pos, pos) }
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(apply)
  setTimeout(apply, 0)
}

/** 写 textarea 值（绕过 React 受控 setter）并派发 input。 */
function writeTextarea(el: HTMLTextAreaElement, value: string): void {
  if (TEXTAREA_VALUE_SETTER) TEXTAREA_VALUE_SETTER.call(el, value)
  else el.value = value
  dispatchInput(el)
}

/**
 * 把一个文本偏移段替换为 reference，兼容 textarea 与 Lexical contenteditable。
 *
 * Lexical 由内部 editorState 驱动 DOM，外部直接改 textContent / execCommand
 * 都会被其协调回写覆盖。Lexical 监听原生 `beforeinput`：对可编辑选区派发
 * `inputType: "insertText"` + `data` 时，它会在 beforeinput 里 handleInput
 * 并 preventDefault，自行为选区替换文本并收敛内部状态（实测生效）。因此
 * contenteditable 统一走「全选 → dispatch beforeinput(insertText, data)」；
 * 若监听方未拦截（dispatchEvent 返回 true 且未 preventDefault），再退化用
 * execCommand / textContent 兜底。
 */
export function replaceToken(el: HTMLElement, start: number, end: number, reference: string): void {
  el.focus({ preventScroll: true })
  if (isTextarea(el)) {
    const text = readComposerText(el)
    const next = `${text.slice(0, start)}${reference}${text.slice(end)}`
    writeTextarea(el, next)
    scheduleCaret(el, start + reference.length)
    return
  }
  // contenteditable（Lexical）：按偏移拼出完整新文本，全选后派发 beforeinput。
  const text = readComposerText(el)
  const next = `${text.slice(0, start)}${reference}${text.slice(end)}`
  const sel = window.getSelection()
  const range = document.createRange()
  range.selectNodeContents(el)
  sel?.removeAllRanges()
  sel?.addRange(range)
  let handled = false
  try {
    const bi = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: next })
    // dispatchEvent 返回 false = 监听的 Lexical preventDefault 了，即它自己处理了替换。
    handled = !el.dispatchEvent(bi)
  } catch { handled = false }
  if (!handled) {
    let ok = false
    try { ok = document.execCommand('insertText', false, next) } catch { ok = false }
    if (!ok) {
      el.textContent = next
      dispatchInput(el)
    }
  }
  dispatchInput(el)
  // 光标放到末尾（引用之后）。
  try {
    const p = document.createRange()
    p.selectNodeContents(el)
    p.collapse(false)
    const s2 = window.getSelection()
    s2?.removeAllRanges()
    s2?.addRange(p)
  } catch { /* 非致命 */ }
}

/**
 * 光标附近的像素位置（用于定位补全弹层）。textarea 返回行/列近似，contenteditable
 * 用 Range.getBoundingClientRect；探测失败返回 null（弹层退回视口右下）。
 */
export function caretPosition(el: HTMLElement): { x: number; y: number } | null {
  if (!isTextarea(el)) {
    try {
      const sel = window.getSelection()
      if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
        const rect = sel.getRangeAt(0).getBoundingClientRect()
        if (rect.width > 0 || rect.height > 0) {
          return { x: rect.left, y: rect.bottom }
        }
      }
    } catch {
      /* noop */
    }
    return null
  }
  // textarea 近似：按行高估算行列。
  const pos = el.selectionStart ?? 0
  const before = el.value.slice(0, pos)
  const lines = before.split('\n')
  const line = lines.length - 1
  const col = lines[line]?.length ?? 0
  const rect = el.getBoundingClientRect()
  const lineHeight = parseInt(getComputedStyle(el).lineHeight || '20', 10) || 20
  return { x: rect.left + Math.min(col * 8, rect.width - 60), y: rect.top + (line + 1) * lineHeight + 8 }
}

export function isTextAreaInput(el: HTMLElement): boolean {
  return isTextarea(el)
}

// 与 chat-input-bridge 的 token 归一化约定一致：`#` 短引用
export function normalizeRef(token: string): string {
  return token.startsWith('#') ? token : `#${token}`
}

// ---------------------------------------------------------------------------
// 事件订阅：composer 变化即回调
// ---------------------------------------------------------------------------

/** 订阅 composer input / 光标移动，驱动 # 补全重算。返回取消订阅函数。 */
export function subscribeComposer(listener: (el: HTMLElement) => void): () => void {
  const handler = (): void => {
    const el = findComposer()
    if (el) listener(el)
  }
  const onSelectionChange = (): void => {
    const el = findComposer()
    if (el && el.contains(window.getSelection()?.anchorNode ?? null)) listener(el)
  }
  document.addEventListener('input', handler, true)
  document.addEventListener('selectionchange', onSelectionChange)
  return () => {
    document.removeEventListener('input', handler, true)
    // 关键：selectionchange 也必须移除，否则 memo 关闭后监听泄漏，
    // 输入框光标一动仍会触发 # 补全重算（表现为"关了备忘开关 # 还乱"）。
    document.removeEventListener('selectionchange', onSelectionChange)
  }
}

// ---------------------------------------------------------------------------
// 引用 token 的插入（供面板「引用到会话」按钮复用）
// ---------------------------------------------------------------------------

/** 追加 `#ref ` 到 composer 末尾并聚焦。 */
export function appendReferenceToComposer(ref: string): void {
  const el = findComposer()
  if (!el) return
  const refToken = normalizeRef(ref)
  if (isTextarea(el)) {
    const value = el.value
    const prev = value.length > 0 && !/\s$/.test(value) ? ' ' : ''
    const next = `${value}${prev}${refToken} `
    writeTextarea(el, next)
    scheduleCaret(el, next.length)
    el.focus({ preventScroll: true })
    return
  }
  // contenteditable：把光标移到末尾，用 beforeinput(insertText) 追加（Lexical 收敛）。
  el.focus({ preventScroll: true })
  const sel2 = window.getSelection()
  const range2 = document.createRange()
  range2.selectNodeContents(el)
  range2.collapse(false)
  sel2?.removeAllRanges()
  sel2?.addRange(range2)
  const prefix = (el.textContent ?? '').length > 0 ? ' ' : ''
  const insert = `${prefix}${refToken} `
  let handled = false
  try {
    const bi = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: insert })
    handled = !el.dispatchEvent(bi)
  } catch { handled = false }
  if (!handled) {
    let ok = false
    try { ok = document.execCommand('insertText', false, insert) } catch { ok = false }
    if (!ok) {
      el.textContent = `${el.textContent ?? ''}${insert}`
      dispatchInput(el)
    }
  }
  dispatchInput(el)
  el.focus({ preventScroll: true })
}
