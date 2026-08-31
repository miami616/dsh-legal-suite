/**
 * mount.tsx — 备忘录域浏览器端挂载。
 *
 * 三块：
 *   1. 浮动入口按钮（可拖拽调整位置，持久化 localStorage）。
 *   2. 备忘录弹窗面板（MemoPanel）。
 *   3. 会话输入框 `#` 自动补全弹层（memo-suggest）。
 * 全部 body 锚定 + createRoot 渲染，样式经 MEMO_CSS 注入并跟随 DSH 主题。
 */
import { createRoot, type Root } from 'react-dom/client'
import React from 'react'
import { MemoPanel } from './MemoPanel.tsx'
import { MEMO_CSS } from './memo.css.ts'
import {
  findComposer,
  readComposerText,
  readCaret,
  parseTrigger,
  caretPosition,
  replaceToken,
  normalizeRef,
  subscribeComposer,
} from './memo-input-bridge.ts'
import { memoApi } from './memo-api.ts'
import type { MemoItem } from '../store/types.ts'

const STORAGE_POS = 'agentlex-memo:pos'

function readStorage(key: string, fallback: string): string {
  try { return localStorage.getItem(key) ?? fallback } catch { return fallback }
}
function writeStorage(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* noop */ }
}

/** 把 memo 图标做成按钮 innerHTML。 */
function memoIconSvg(size = 22): string {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`
}

export function mountMemo(ctx: unknown): () => void {
  if (typeof document === 'undefined') return () => {}

  // ---- 注入样式 ----
  if (document.querySelector('style[data-agentlex-memo-css]') === null) {
    const tag = document.createElement('style')
    tag.dataset.agentlexMemoCss = '1'
    tag.textContent = MEMO_CSS
    document.head.appendChild(tag)
  }
  const removeCss = (): void => { document.querySelector('style[data-agentlex-memo-css]')?.remove() }

  let floatBtn: HTMLButtonElement | null = null
  let panelHost: HTMLDivElement | null = null
  let panelRoot: Root | null = null
  let suggestHost: HTMLDivElement | null = null
  let suggestRoot: Root | null = null
  let panelOpen = false
  let suggestVisible = false
  let suppressUntil = 0
  let suggestMemos: MemoItem[] = []
  let trigger = { hashIndex: 0, token: '' }
  let selIndex = 0
  /** 由 MemoPanel 写入，封装「带自动保存的关闭」。遮罩点击复用。 */
  const memoRequestClose = React.createRef<(() => void) | null>()

  /** 浮动按钮初始位置（右下角，可按需拖拽调整）。 */
  const readPos = (): { x: number; y: number } => {
    const raw = readStorage(STORAGE_POS, '')
    if (raw !== '') {
      const [x, y] = raw.split(',').map(Number)
      if (Number.isFinite(x) && Number.isFinite(y)) return { x, y }
    }
    return { x: window.innerWidth - 76, y: window.innerHeight - 84 }
  }

  const renderFloat = (): void => {
    if (floatBtn) {
      const pos = readPos()
      floatBtn.style.left = `${pos.x}px`
      floatBtn.style.top = `${pos.y}px`
    }
  }

  const buildFloat = (): void => {
    if (floatBtn !== null) return
    floatBtn = document.createElement('button')
    floatBtn.type = 'button'
    floatBtn.className = 'memo-float'
    floatBtn.dataset.agentlexMemoFloat = 'true'
    floatBtn.dataset.agentlexMemoRoot = 'true'
    floatBtn.setAttribute('aria-label', '备忘录')
    floatBtn.title = '备忘录'
    floatBtn.innerHTML = memoIconSvg()
    const pos = readPos()
    const size = 46
    floatBtn.style.cssText = [
      'position: fixed; z-index: 2147483005;',
      `left: ${pos.x}px; top: ${pos.y}px;`,
      'width: 46px; height: 46px; border-radius: 50%;',
      'display: flex; align-items: center; justify-content: center;',
      'border: 0; cursor: pointer;',
      // 视觉（颜色/背景/阴影/过渡）全部交给 .memo-float CSS 规则：
      // 默认透明灰图标，hover 才显强调色。
      'touch-action: none;',
    ].join(' ')
    // 拖拽：用「按下点」到「抬起点」的位移判断是拖动还是点击。
    // 关键：浏览器在 pointerup 之后才派发 click，若在 onUp 里直接清掉 dragging
    // 标志，纯拖动结束时 click 会误触发打开面板。改为记录按下起点并累计位移，
    // 只有位移超过阈值才算「拖拽」，否则视为「点击」。
    const DRAG_THRESHOLD = 6 // px；超过即判定为拖动，忽略随后的 click。
    let pressing = false
    let moved = false
    let downX = 0
    let downY = 0
    let offX = 0
    let offY = 0
    const onDown = (e: PointerEvent): void => {
      pressing = true
      moved = false
      downX = e.clientX
      downY = e.clientY
      offX = e.clientX - floatBtn!.getBoundingClientRect().left
      offY = e.clientY - floatBtn!.getBoundingClientRect().top
      floatBtn!.style.transition = 'none'
      e.preventDefault()
    }
    const onMove = (e: PointerEvent): void => {
      if (!pressing || !floatBtn) return
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > DRAG_THRESHOLD) moved = true
      const x = Math.min(window.innerWidth - size, Math.max(0, e.clientX - offX))
      const y = Math.min(window.innerHeight - size, Math.max(0, e.clientY - offY))
      floatBtn.style.left = `${x}px`
      floatBtn.style.top = `${y}px`
      writeStorage(STORAGE_POS, `${Math.round(x)},${Math.round(y)}`)
    }
    const onUp = (): void => {
      if (!pressing) return
      pressing = false
      // 清掉拖拽期间的内联 transition，交还给 .memo-float 的 CSS 过渡。
      floatBtn!.style.transition = ''
    }
    const onClick = (): void => {
      // 位移超过阈值说明刚才是纯拖动，不打开面板。
      if (moved) return
      togglePanel()
    }
    floatBtn.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    floatBtn.addEventListener('click', onClick)
    document.body.appendChild(floatBtn)
  }

  const togglePanel = (): void => {
    if (panelOpen) closePanel()
    else openPanel()
  }

  const openPanel = (): void => {
    if (panelOpen) return
    panelOpen = true
    buildPanel()
  }

  const closePanel = (): void => {
    panelOpen = false
    panelRoot?.unmount()
    panelRoot = null
    if (panelHost) { panelHost.remove(); panelHost = null }
  }

  /**
   * 居中浮层弹窗 + 全屏半透明遮罩。
   *  - 点击空白遮罩（不是面板本身）→ 关闭（MemoPanel 的 onClose 内部会先自动
   *    保存未提交草稿，再真正 requestClose）。
   */
  const buildPanel = (): void => {
    if (panelHost === null) {
      panelHost = document.createElement('div')
      panelHost.dataset.agentlexMemoPanelRoot = 'true'
      panelHost.style.cssText = 'position: fixed; inset: 0; z-index: 2147483006; pointer-events: none;'
      document.body.appendChild(panelHost)
    }
    if (panelRoot === null) {
      panelRoot = createRoot(panelHost)
    }
    const overlayStyle: React.CSSProperties = {
      position: 'fixed',
      inset: 0,
      zIndex: 2147483006,
      background: 'rgb(0 0 0 / 0.32)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      pointerEvents: 'auto',
    }
    panelRoot?.render(
      React.createElement(
        'div',
        {
          className: 'memo-overlay',
          'data-agentlex-memo-root': true,
          style: overlayStyle,
          onMouseDown: (e: React.MouseEvent) => {
            // 点遮罩本身（即空白处）关闭；有挂载的 requestClose 则走带自动保存的关闭。
            if (e.target === e.currentTarget) {
              const rc = memoRequestClose.current
              if (rc) rc()
              else closePanel()
            }
          },
        },
        React.createElement(
          React.StrictMode,
          null,
          React.createElement(MemoPanel, { onClose: closePanel, requestCloseRef: memoRequestClose }),
        ),
      ),
    )
  }

  // ---- # 自动补全 ----
  const renderSuggest = (): void => {
    if (!suggestVisible) {
      if (suggestRoot) { suggestRoot.unmount(); suggestRoot = null }
      if (suggestHost) { suggestHost.style.display = 'none' }
      return
    }
    if (suggestHost === null) {
      suggestHost = document.createElement('div')
      suggestHost.dataset.agentlexMemoSuggest = 'true'
      document.body.appendChild(suggestHost)
    }
    if (suggestRoot === null) suggestRoot = createRoot(suggestHost)
    const el = findComposer()
    const pos = el ? caretPosition(el) : null
    if (pos) {
      suggestHost.style.position = 'fixed'
      suggestHost.style.left = `${Math.min(pos.x, window.innerWidth - 340)}px`
      suggestHost.style.top = `${Math.min(pos.y + 6, window.innerHeight - 40)}px`
      suggestHost.style.zIndex = '2147483010'
      suggestHost.style.display = 'block'
    }
    suggestRoot.render(
      React.createElement(
        'div',
        { className: 'memo-suggest' },
        suggestMemos.length > 0
          ? [
              React.createElement('div', { className: 'memo-suggest__head', key: 'head' }, '引用备忘'),
              ...suggestMemos.slice(0, 8).map((m, i) =>
                React.createElement('button', {
                  type: 'button',
                  key: m.id,
                  className: `memo-suggest__item${i === selIndex ? ' memo-suggest__item--sel' : ''}`,
                  onMouseDown: (e: React.MouseEvent) => {
                    e.preventDefault()
                    commitSuggestion(m.ref)
                  },
                }, [
                  React.createElement('span', { className: 'memo-suggest__ref', key: 'r' }, `#${m.ref}`),
                  React.createElement('span', { className: 'memo-suggest__txt', key: 't' }, m.content.slice(0, 40)),
                  ...(m.tags.slice(0, 2).map((t) => React.createElement('span', { className: 'memo-suggest__tag', key: t }, t))),
                ]),
              ),
            ]
          : [
              React.createElement('div', { className: 'memo-suggest__head', key: 'head' }, '未找到匹配备忘'),
            ],
        React.createElement('button', {
          type: 'button',
          className: 'memo-suggest__item memo-suggest__new',
          key: 'new',
          onMouseDown: (e: React.MouseEvent) => { e.preventDefault(); onCreateNew() },
        }, '＋ 新建备忘…'),
      ),
    )
  }

  const commitSuggestion = (ref: string): void => {
    const el = findComposer()
    if (!el) return
    const text = readComposerText(el)
    const caret = readCaret(el)
    const trig = parseTrigger(text, caret)
    const end = trig ? caret : caret
    const start = trig ? trig.hashIndex : caret
    try {
      replaceToken(el, start, end, `${normalizeRef(ref)} `)
    } catch { /* 非致命 */ }
    hideSuggest()
    // 抑制紧随而来的 input/selectionchange 回调重新弹层。
    suppressUntil = Date.now() + 600
  }

  const onCreateNew = (): void => {
    hideSuggest()
    openPanel()
  }

  const hideSuggest = (): void => {
    suggestVisible = false
    renderSuggest()
  }

  const onComposerChange = (el: HTMLElement): void => {
    if (Date.now() < suppressUntil) return
    const text = readComposerText(el)
    const caret = readCaret(el)
    const trig = parseTrigger(text, caret)
    // 光标处是合法的 `#token` 起点（# 位于行首/空白后）→ 加载匹配并展示；
    // 否则关闭弹层。
    if (trig !== null) {
      void loadSuggestions(trig)
    } else {
      hideSuggest()
    }
  }

  const loadSuggestions = async (trig: { hashIndex: number; token: string }): Promise<void> => {
    trigger = trig
    selIndex = 0
    try {
      const all = await memoApi.list()
      const token = trig.token.toLowerCase()
      const matches = all
        .filter((m) => m.status === 'active')
        .filter((m) => (token === '' ? true : m.ref.includes(token) || m.content.toLowerCase().includes(token) || m.tags.some((t) => t.includes(token))))
        .slice(0, 8)
      suggestMemos = matches
      // 只有光标附近文本与触发词一致时才展示。
      const el = findComposer()
      const text = el ? readComposerText(el) : ''
      const caret = el ? readCaret(el) : 0
      const cur = parseTrigger(text, caret)
      if (cur === null || cur.hashIndex !== trigger.hashIndex || cur.token !== token) return
      suggestVisible = true
      renderSuggest()
    } catch {
      /* 网络失败不扰 */
    }
  }

  const disposeSuggest = subscribeComposer(onComposerChange)

  // 键盘导航：方向键在建议中移动；Enter 提交；Esc 关闭。
  const onKeyDown = (e: KeyboardEvent): void => {
    if (!suggestVisible) { selIndex = 0; return }
    if (e.key === 'ArrowDown') { e.preventDefault(); selIndex = Math.min(suggestMemos.length - 1, selIndex + 1); renderSuggest() }
    else if (e.key === 'ArrowUp') { e.preventDefault(); selIndex = Math.max(0, selIndex - 1); renderSuggest() }
    else if (e.key === 'Enter' && suggestMemos[selIndex]) { e.preventDefault(); e.stopPropagation(); commitSuggestion(suggestMemos[selIndex].ref) }
    else if (e.key === 'Escape') { hideSuggest() }
  }
  document.addEventListener('keydown', onKeyDown, true)

  // ---- 构建 & 自愈 ----
  const observer = new MutationObserver(renderFloat)
  observer.observe(document.body, { childList: true, subtree: true })

  buildFloat()
  renderFloat()

  return () => {
    observer.disconnect()
    document.removeEventListener('keydown', onKeyDown, true)
    disposeSuggest()
    closePanel()
    hideSuggest()
    suggestRoot?.unmount(); suggestRoot = null
    suggestHost?.remove(); suggestHost = null
    floatBtn?.remove(); floatBtn = null
    removeCss()
  }
}
