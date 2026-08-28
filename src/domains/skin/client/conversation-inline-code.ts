/**
 * 行内代码断行优化（Issue: 长路径/标识符被 justify 在任意字符处劈开）。
 *
 * 根因：行内代码改成 display:inline 后能在行内换行，但纯 CSS 没有「在斜杠处断行」
 * 的能力，overflow-wrap 只能在任意字符处断——于是 ~/a/b/c.ts 会在某目录名中间被劈开，
 * 读起来很怪。
 *
 * 做法：在会话区行内代码（:not(pre) > code）的文本里，于分隔符 `/ . _ -` 之后注入
 * <wbr>（零宽换行机会）。浏览器优先在这些自然边界断行，长路径就断在 `/` 上，而不是
 * 把一个目录名从中间劈开。
 *
 * 跟随 conversationJustify（两端对齐）开关挂载：只有两端对齐时才需要（原子盒跳行 +
 * justify 拉散的根因场景）。
 *
 * 流式安全：DSH 逐字流式渲染，code 元素的文本会持续增长。用 WeakMap 记录每个 code 上次
 * 处理过的 textContent，内容变了才重做（先清掉上次注入的 wbr、按当前文本重建），保证
 * 流式过程中逐渐补齐断行机会且不重复插入。MutationObserver 回调用 rAF 合并，避免高频抖动。
 */

/** 可断行的分隔符：路径斜杠、点（扩展名/版本号）、连字符/下划线（标识符）。 */
const SEPARATORS = /([/._-])/g

const lastText = new WeakMap<Element, string>()

/** 按当前文本重建 code 内容：分隔符后各插一个 <wbr class="agl-wbr">。 */
function splitWithWbr(el: Element, text: string): void {
  const frag = document.createDocumentFragment()
  let last = 0
  SEPARATORS.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = SEPARATORS.exec(text)) !== null) {
    if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)))
    frag.appendChild(document.createTextNode(m[0]))
    const wbr = document.createElement('wbr')
    wbr.className = 'agl-wbr'
    frag.appendChild(wbr)
    last = m.index + 1
  }
  if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)))
  el.textContent = ''
  if (frag.childNodes.length > 0) el.appendChild(frag)
}

/** 处理会话区内所有未处理/内容变化的行内代码。 */
function processInlineCode(root: ParentNode): void {
  const codes = root.querySelectorAll(
    '[data-slot="conversation"] [class$="_body"] :not(pre) > code',
  )
  codes.forEach((el) => {
    const text = el.textContent ?? ''
    if (lastText.get(el) === text) return
    // 清掉上次注入的 wbr（内容已变，按需重建）
    el.querySelectorAll('wbr.agl-wbr').forEach((w) => w.remove())
    splitWithWbr(el, text)
    lastText.set(el, text)
  })
}

/**
 * 挂载行内代码 <wbr> 注入器。返回一个卸载函数（断开 observer）。
 * 无 document（SSR/非浏览器）时返回空函数。
 */
export function injectInlineCodeWbr(): () => void {
  if (typeof document === 'undefined' || document.body === null) return () => {}

  processInlineCode(document)

  let frame = 0
  const schedule = (): void => {
    if (frame !== 0) return
    const run = (): void => {
      frame = 0
      processInlineCode(document)
    }
    frame = 1
    if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(run)
    else setTimeout(run, 16)
  }

  const observer = new MutationObserver(() => schedule())
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })

  return () => {
    observer.disconnect()
    if (frame !== 0) frame = 0
  }
}
