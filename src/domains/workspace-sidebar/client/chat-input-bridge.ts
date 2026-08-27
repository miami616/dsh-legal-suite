/**
 * chat-input-bridge.ts — DSH 会话输入框 DOM 桥（对话输入框桥接客户端模块）
 *
 * 用途：供工作区面板（WorkspacePanel / DirectoryPanel 等）把以下交互
 * 注入 DSH 外壳的会话输入框，实现原版 AgentLexNext 面板的目录/文件
 * 面板调用方语义（@引用文件、斜杠命令、引用选区转块引用等）：
 *   - insertReferences(paths)     光标处插入 `@p1 @p2`（空格分隔）
 *   - appendReferenceToken(token) 追加 `@token `（保证尾随空格）
 *   - insertSlashCommand(command) 光标处插入 `/command`
 *   - setValue(value)             整值替换 + 聚焦
 *   - quoteTextSelection()        选区（或当前全值）转 `> ` 块引用追加到末尾
 *   - focus()
 *
 * 来源语义：移植自原版 AgentLexNext 的 SimpleChatInputHandle imperative
 * 方法（原版直接操作内部 textarea：textareaRef + inputValueRef 镜像）。
 * DSH 外壳没有公开的输入 handle，这里改用「DOM 探测 + 光标操作」实现
 * 等价语义：
 *   1. 定位：一组 CSS 候选选择器逐个探测（锚定 [data-pane="conversation"]
 *      与 [data-conversation-scroll] 容器，未命中再回退 document 全量；
 *      顺带穿透 shadow DOM）；MutationObserver 监听 body 处理 React
 *      重渲染换节点 / shadow DOM 场景，缓存最近一次成功节点
 *      （get/set 幂等，失效自愈）。
 *   2. 光标：contenteditable 用 window.getSelection()+Range（优先
 *      document.execCommand('insertText')，失败回落手动 range
 *      deleteContents/insertNode）；textarea 用 selectionStart/End +
 *      原生 value setter（绕过 React 受控 value 追踪器）+ 手工拼接 +
 *      setSelectionRange（经 requestAnimationFrame/setTimeout 延后，
 *      保证 React 受控组件消化新值后再设光标）。
 *   3. 每次操作后派发 InputEvent('input', {bubbles: true, inputType:
 *      'insertText'})，触发 React onChange。
 *
 * 纯 DOM TypeScript（TS strict，ESM，isolatedModules）；不依赖 React，
 * 不 import 任何 App 内部组件。
 */

// ---------------------------------------------------------------------------
// 输入框身份判定
// ---------------------------------------------------------------------------

/** 候选 textarea / contenteditable 是否为可编辑输入框。 */
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

// ---------------------------------------------------------------------------
// 定位：候选选择器（按序探测，第一个命中即用）
// ---------------------------------------------------------------------------

/**
 * 候选清单。前段锚定 DSH 外壳的会话容器：
 *   [data-pane="conversation"] 与 [data-conversation-scroll]；
 * 后段为 document 全量回退（覆盖 textarea 与 contenteditable 两种形态）。
 */
const INPUT_SELECTORS: readonly string[] = [
  // ---- 锚定 [data-pane="conversation"] ----
  '[data-pane="conversation"] textarea[class*="composer"]',
  '[data-pane="conversation"] [class*="composer"] textarea',
  '[data-pane="conversation"] textarea[role="textbox"]',
  '[data-pane="conversation"] [contenteditable="true"][role="textbox"]',
  '[data-pane="conversation"] [class*="chatInput"] textarea',
  '[data-pane="conversation"] [class*="chatInput"] [contenteditable="true"]',
  '[data-pane="conversation"] [class*="inputArea"] textarea',
  '[data-pane="conversation"] [class*="inputArea"] [contenteditable="true"]',
  // ---- 锚定 [data-conversation-scroll]（滚动容器同区域的 composer）----
  '[data-conversation-scroll] textarea[class*="composer"]',
  '[data-conversation-scroll] [class*="composer"] textarea',
  '[data-conversation-scroll] textarea[role="textbox"]',
  '[data-conversation-scroll] [contenteditable="true"][role="textbox"]',
  '[data-conversation-scroll] [class*="chatInput"] textarea',
  '[data-conversation-scroll] [class*="inputArea"] textarea',
  // ---- document 全量回退 ----
  'textarea[class*="composer"]',
  '[class*="composer"] textarea',
  'textarea[role="textbox"]',
  '[class*="chatInput"] textarea',
  '[class*="inputArea"] textarea',
  'textarea[autocomplete="off"]',
  '[contenteditable="true"][role="textbox"]',
  '[class*="chatInput"] [contenteditable="true"]',
  '[class*="inputArea"] [contenteditable="true"]',
]

/** 在给定 root（Document 或 ShadowRoot）内按候选清单逐个探测。 */
function probeInRoot(root: Document | ShadowRoot): HTMLElement | null {
  for (const selector of INPUT_SELECTORS) {
    const el = root.querySelector<HTMLElement>(selector)
    if (el && isEditableInput(el)) return el
  }
  return null
}

/** 穿透 shadow DOM：递归查找挂着 shadowRoot 的元素并继续探测。 */
function probeShadowInput(root: Document | ShadowRoot, depth = 0): HTMLElement | null {
  if (depth > 6) return null
  const hosts = root.querySelectorAll<HTMLElement>('*')
  for (const host of hosts) {
    const shadow = host.shadowRoot
    if (!shadow) continue
    const direct = probeInRoot(shadow)
    if (direct) return direct
    const nested = probeShadowInput(shadow, depth + 1)
    if (nested) return nested
  }
  return null
}

function probeInput(): HTMLElement | null {
  return probeInRoot(document) ?? probeShadowInput(document)
}

// ---------------------------------------------------------------------------
// 缓存 + MutationObserver 自愈
// ---------------------------------------------------------------------------

let cachedInput: HTMLElement | null = null
let observer: MutationObserver | null = null
let healScheduled = false

/** get 幂等：缓存节点仍连接且可编辑即直接复用。 */
function cachedValid(): boolean {
  return cachedInput !== null && cachedInput.isConnected && isEditableInput(cachedInput)
}

function probeAndCache(): HTMLElement | null {
  cachedInput = probeInput()
  return cachedInput
}

/** 监听 body（子节点增删 / class、role、contenteditable 变动）以自愈。 */
function ensureObserver(): void {
  if (observer) return
  const root = document.body ?? document.documentElement
  if (!root) return
  observer = new MutationObserver(heal)
  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'role', 'contenteditable'],
  })
}

/**
 * 缓存失效时：若缓存已断开则清空；缓存为空时以 rAF 合并去抖重新探测，
 * 避免在每次 DOM 变动上做全量扫描（React 重渲染期间不要热循环）。
 */
function heal(): void {
  if (cachedInput && !cachedValid()) cachedInput = null
  if (cachedInput || healScheduled) return
  healScheduled = true
  const settle = (): void => {
    healScheduled = false
    if (!cachedInput) probeAndCache()
  }
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(settle)
  } else {
    setTimeout(settle, 0)
  }
}

/** 定位会话输入框：缓存优先，未命中则重新探测并缓存。 */
function find(): HTMLElement | null {
  if (cachedValid()) return cachedInput
  ensureObserver()
  return probeAndCache()
}

function requireInput(): HTMLElement {
  const el = find()
  if (!el) throw new Error('chat-input-bridge: 未找到 DSH 会话输入框（请先打开对话面板）')
  return el
}

// ---------------------------------------------------------------------------
// 写入与事件（React 受控组件安全）
// ---------------------------------------------------------------------------

/**
 * 原生 textarea value setter：绕过 React 的受控 value 追踪器，
 * 直接写入 DOM，随后用派发的 input 事件让 React onChange 收敛状态。
 */
const TEXTAREA_VALUE_SETTER: ((value: string) => void) | null =
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set ?? null

function applyTextareaValue(el: HTMLTextAreaElement, value: string): void {
  if (TEXTAREA_VALUE_SETTER) TEXTAREA_VALUE_SETTER.call(el, value)
  else el.value = value
}

/** 每次操作后派发 input 事件，驱动 React onChange。 */
function dispatchInput(el: HTMLElement, inputType = 'insertText'): void {
  let event: Event
  try {
    event = new InputEvent('input', { bubbles: true, composed: true, inputType })
  } catch {
    event = new Event('input', { bubbles: true })
  }
  el.dispatchEvent(event)
}

/**
 * 延后设置光标：rAF 优先、setTimeout 兜底（隐藏标签页 rAF 不触发），
 * 保证 React 受控组件先消化新 value 再定位光标；重复调用幂等。
 */
function scheduleCaret(el: HTMLTextAreaElement, position: number): void {
  const apply = (): void => {
    if (el.isConnected) el.setSelectionRange(position, position)
  }
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(apply)
  }
  setTimeout(apply, 0)
}

// ---------------------------------------------------------------------------
// contenteditable 光标工具
// ---------------------------------------------------------------------------

function getContenteditableText(el: HTMLElement): string {
  return el.textContent ?? ''
}

function placeCaretAtEnd(el: HTMLElement): void {
  const sel = window.getSelection()
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  sel?.removeAllRanges()
  sel?.addRange(range)
  el.focus({ preventScroll: true })
}

/** 光标位于 el 内时的选区 Range；无选区 / 选区在 el 外返回 null。 */
function selectionRangeIn(el: HTMLElement): Range | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) return null
  return sel.getRangeAt(0)
}

/** 光标之前的文本（用于「是否补前导空格」判定）。 */
function textBeforeCaret(el: HTMLElement): string {
  const range = selectionRangeIn(el)
  if (!range) return getContenteditableText(el)
  const prefix = document.createRange()
  prefix.setStart(el, 0)
  prefix.setEnd(range.startContainer, range.startOffset)
  return prefix.toString()
}

/** 手动 range 回落：删选区、插文本节点、光标落于插入文本之后。 */
function insertTextNodeManually(el: HTMLElement, text: string): void {
  const node = document.createTextNode(text)
  const range = selectionRangeIn(el)
  if (range) {
    range.deleteContents()
    range.insertNode(node)
    range.setStartAfter(node)
    range.setEndAfter(node)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
  } else {
    placeCaretAtEnd(el)
    el.appendChild(node)
    placeCaretAtEnd(el)
  }
}

/** 优先 execCommand('insertText')，失败回落手动 range。 */
function insertAtCaret(el: HTMLElement, text: string): void {
  el.focus({ preventScroll: true })
  if (!selectionRangeIn(el)) placeCaretAtEnd(el)
  let viaCommand = false
  try {
    viaCommand = document.execCommand('insertText', false, text)
  } catch {
    viaCommand = false
  }
  if (!viaCommand) insertTextNodeManually(el, text)
  // execCommand 成功时浏览器已原生派发 input；这里再补一发合成事件，
  // 保证手动路径也必然触发 React onChange（值与上轮一致，幂等）。
  dispatchInput(el)
}

// ---------------------------------------------------------------------------
// 插入语义（两种形态共用）
// ---------------------------------------------------------------------------

interface InsertOptions {
  trailingSpace?: boolean
  atEnd?: boolean
}

/** 前导空格按需（前缀非空且未以空白结尾）+ 可选尾随空格（「继续聊」UX）。 */
function buildInsertion(prefix: string, text: string, trailingSpace: boolean): string {
  const leading = prefix.length > 0 && !/\s$/.test(prefix) ? ' ' : ''
  return leading + text + (trailingSpace ? ' ' : '')
}

function insertContenteditable(el: HTMLElement, text: string, opts: InsertOptions): void {
  if (opts.atEnd) placeCaretAtEnd(el)
  const prefix = textBeforeCaret(el)
  const insertion = buildInsertion(prefix, text, opts.trailingSpace ?? false)
  insertAtCaret(el, insertion)
}

function insertTextarea(el: HTMLTextAreaElement, text: string, opts: InsertOptions): void {
  const value = el.value
  const pos = opts.atEnd ? value.length : (el.selectionStart ?? value.length)
  const end = opts.atEnd ? value.length : (el.selectionEnd ?? pos)
  const prefix = value.slice(0, pos)
  const insertion = buildInsertion(prefix, text, opts.trailingSpace ?? false)
  const caret = prefix.length + insertion.length
  applyTextareaValue(el, prefix + insertion + value.slice(end))
  dispatchInput(el)
  scheduleCaret(el, caret)
}

function insertIntoInput(el: HTMLElement, text: string, opts: InsertOptions = {}): void {
  if (text === '') return
  if (isTextarea(el)) insertTextarea(el, text, opts)
  else insertContenteditable(el, text, opts)
}

// ---------------------------------------------------------------------------
// 滚动到底（textarea 自身 + 会话滚动容器）
// ---------------------------------------------------------------------------

function scrollInputToBottom(el: HTMLElement): void {
  el.scrollTop = el.scrollHeight
  if (isTextarea(el)) return
  const container = el.closest('[data-conversation-scroll]') ?? el.closest('[data-pane="conversation"]')
  if (container) container.scrollTop = container.scrollHeight
  else el.scrollIntoView({ block: 'end', behavior: 'auto' })
}

// ---------------------------------------------------------------------------
// setValue / 选区块引用
// ---------------------------------------------------------------------------

function setValueImpl(el: HTMLElement, value: string): void {
  if (isTextarea(el)) {
    applyTextareaValue(el, value)
    dispatchInput(el)
    scheduleCaret(el, value.length)
    el.focus({ preventScroll: true })
  } else {
    // 纯文本替换；contenteditable 直接整值写入，再置光标于末尾并派发 input。
    el.textContent = value
    dispatchInput(el)
    placeCaretAtEnd(el)
    el.focus({ preventScroll: true })
  }
}

/** 读取选区文本；无选区时退回当前全值。 */
function readSelectedOrFullText(el: HTMLElement): string {
  if (isTextarea(el)) {
    const start = el.selectionStart ?? 0
    const end = el.selectionEnd ?? el.value.length
    const selected = el.value.slice(start, end)
    return selected.length > 0 ? selected : el.value
  }
  const sel = window.getSelection()
  const selected = sel && el.contains(sel.anchorNode) ? sel.toString() : ''
  return selected.length > 0 ? selected : getContenteditableText(el)
}

/** 逐行加 `> ` 前缀转块引用。 */
function quoteBlock(text: string): string {
  return text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
}

function quoteTextSelection(): void {
  const el = requireInput()
  const quoted = quoteBlock(readSelectedOrFullText(el))
  insertIntoInput(el, quoted, { trailingSpace: true, atEnd: true })
  scrollInputToBottom(el)
}

function focusInput(): void {
  const el = requireInput()
  el.focus({ preventScroll: true })
  if (isTextarea(el)) scheduleCaret(el, el.value.length)
  else placeCaretAtEnd(el)
}

/** 规范化引用 token：缺省补 `@` 前缀（传入已带 `@` 则原样保留）。 */
function normalizeReference(token: string): string {
  return token.startsWith('@') ? token : `@${token}`
}

// ---------------------------------------------------------------------------
// 模块级单例导出
// ---------------------------------------------------------------------------

export interface ChatInputBridgeMethods {
  /** 定位会话输入框（缓存优先，幂等；未找到返回 null）。 */
  find(): HTMLElement | null
  /**
   * 光标处插入 `@p1 @p2`（空格分隔，无尾随空格），光标落在引用串后；
   * 插入前若文本未以空白结尾则补一个前导空格。
   */
  insertReferences(paths: readonly string[]): void
  /** 追加 `@token ` 到输入框末尾（前导空格按需 + 保证尾随空格），光标置末尾并滚动到底。 */
  appendReferenceToken(token: string): void
  /** 光标处插入 `/command`，前后空格逻辑同 insertReferences。 */
  insertSlashCommand(command: string): void
  /** 整值替换 + 聚焦。 */
  setValue(value: string): void
  /** 读取输入框当前全文（textarea.value / contenteditable 文本）。 */
  getValue(): string
  /** 读取选区（无选区则当前全值）转 `> ` 块引用，追加到末尾（同 appendReferenceToken 约定）。 */
  quoteTextSelection(): void
  /** 聚焦输入框。 */
  focus(): void
}

export const chatInputBridge: ChatInputBridgeMethods = {
  find,
  insertReferences(paths: readonly string[]): void {
    if (paths.length === 0) return
    const text = paths.map(normalizeReference).join(' ')
    insertIntoInput(requireInput(), text, { trailingSpace: false, atEnd: false })
  },
  appendReferenceToken(token: string): void {
    if (!token) return
    const el = requireInput()
    insertIntoInput(el, normalizeReference(token), { trailingSpace: true, atEnd: true })
    scrollInputToBottom(el)
  },
  insertSlashCommand(command: string): void {
    if (!command) return
    const text = command.startsWith('/') ? command : `/${command}`
    insertIntoInput(requireInput(), text, { trailingSpace: false, atEnd: false })
  },
  setValue(value: string): void {
    setValueImpl(requireInput(), value)
  },
  getValue(): string {
    const el = requireInput()
    return isTextarea(el) ? el.value : getContenteditableText(el)
  },
  quoteTextSelection,
  focus: focusInput,
}