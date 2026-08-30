/**
 * 会话内文件/链接 → 侧边栏打开（Issue: 用 sidebar 打开）。
 *
 * 参考 better-sidebar 的行为：在会话里点击本地文件路径 / @引用 / 本地链接时，
 * 不再跳外部应用，而是打开工作区右边栏并定位/预览该文件。开关
 * `openReferencesInSidebar`（设置 → AgentLex 设置）关闭时不挂载本处理器。
 *
 * 只拦截「本地文件」形态：
 *   - a[href] 是 file://、绝对路径（/…、~/…、./…、../…）或带扩展名的相对路径；
 *   - 元素带 data-file-path / data-path / data-reference / data-file 属性。
 * 外部 http(s) 网页链接不拦截，仍正常新开。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { readSessionScope } from './session-scope.ts'

function tryParseUrl(href: string): URL | null {
  try {
    return new URL(href)
  } catch {
    return null
  }
}

/** 绝对化：~/ → HOME，/ → 原样，相对 → 拼到会话 cwd。 */
function resolvePath(raw: string, cwd: string): string {
  const trimmed = raw.trim()
  if (trimmed.startsWith('~/')) {
    const home = typeof process !== 'undefined' && process.env?.HOME ? process.env.HOME : ''
    return home ? `${home}/${trimmed.slice(2)}` : trimmed
  }
  if (trimmed.startsWith('/')) return trimmed
  const base = (cwd || '').replace(/[\\/]+$/, '')
  return base ? `${base}/${trimmed.replace(/^\.\//, '')}` : trimmed
}

const FILE_EXT = /\.[a-zA-Z0-9]{1,8}$/

/** 从点击目标解析出本地文件路径；不是本地文件返回 null。 */
function pathFromTarget(target: Element, cwd: string): string | null {
  // 1) 本地链接 / 路径形态的 <a href>
  const anchor = target.closest('a[href]')
  if (anchor !== null) {
    const href = anchor.getAttribute('href') ?? ''
    if (href === '') return null
    const url = tryParseUrl(href)
    if (url !== null) {
      if (url.protocol === 'file:') return decodeURIComponent(url.pathname)
      if (url.protocol === 'http:' || url.protocol === 'https:') return null // 网页链接不拦截
      return null
    }
    // 非 URL：绝对/相对文件路径
    if (/^(\/|~\/|\.{1,2}\/)/.test(href)) return resolvePath(href, cwd)
    if (FILE_EXT.test(href) && !/^[a-z]+:/i.test(href)) return resolvePath(href, cwd)
    return null
  }
  // 2) data-file-path / data-path 属性
  const pathed = target.closest('[data-file-path], [data-path]')
  if (pathed !== null) {
    const p = pathed.getAttribute('data-file-path') ?? pathed.getAttribute('data-path')
    if (p !== null && p.trim() !== '') return resolvePath(p, cwd)
  }
  // 3) @引用 chip（data-reference / data-file 属性）
  const ref = target.closest('[data-reference], [data-file]')
  if (ref !== null) {
    const p = ref.getAttribute('data-reference') ?? ref.getAttribute('data-file')
    if (p !== null && p.trim() !== '') return resolvePath(p, cwd)
  }
  return null
}

/** 会话 cwd（与 mount.tsx 的 readSessionScope 同源）。 */
function sessionCwd(ctx: ClientContext): string {
  return readSessionScope(ctx)?.cwd ?? ''
}

/** 路径 token 形态：绝对 /…、~/…、./…、../…、file:// 或带扩展名的相对路径。 */
function looksLikePath(token: string): boolean {
  if (/^(file:\/\/|\/|~\/|\.{1,2}\/)/.test(token)) return true
  return /\.[a-zA-Z0-9]{1,8}$/.test(token) && !/^[a-z]+:/i.test(token)
}

/**
 * 从点击坐标处的文本节点提取文件路径 token —— 支持「纯文本路径」：
 * AI 输出里的 /path/to/file.md、~/docs/合同.docx 等非链接文本，点击也能
 * 在侧栏定位/预览。用 caret 定位（caretRangeFromPoint）取点击点所在的
 * 文本片段，避免整段扫描误伤。
 */
function pathFromTextAt(event: MouseEvent, cwd: string): string | null {
  if (typeof document === 'undefined') return null
  let range: Range | null = null
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  }
  if (typeof document.caretRangeFromPoint === 'function') {
    range = document.caretRangeFromPoint(event.clientX, event.clientY)
  } else if (typeof doc.caretPositionFromPoint === 'function' && doc.caretPositionFromPoint !== undefined) {
    const pos = doc.caretPositionFromPoint(event.clientX, event.clientY)
    if (pos !== null) {
      const r = document.createRange()
      r.setStart(pos.offsetNode, pos.offset)
      range = r
    }
  }
  const node = range?.startContainer
  if (node === undefined || node === null || node.nodeType !== Node.TEXT_NODE) return null
  const text = (node as Text).data ?? ''
  const offset = range?.startOffset ?? 0
  // 按空白/常见标点切 token，取包含点击 offset 的那段
  const tokens = text.split(/[\s,，;；:："'“”()（）\[\]【】<>]/)
  let acc = 0
  for (const token of tokens) {
    if (offset >= acc && offset <= acc + token.length) {
      const trimmed = token.trim()
      if (trimmed === '') return null
      return looksLikePath(trimmed) ? resolvePath(trimmed, cwd) : null
    }
    acc += token.length + 1
  }
  return null
}

/**
 * 挂载会话链接拦截。返回 disposer。
 * 点击本地文件 → 打开面板 + 定位 + 预览。
 */
export function mountConversationLinkHandler(ctx: ClientContext): () => void {
  if (typeof document === 'undefined') return () => {}

  const onClick = (event: MouseEvent): void => {
    try {
      // 忽略右键 / 修饰键（Cmd/Ctrl 点击让用户自己决定）与面板内部点击。
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const target = event.target as Element | null
      if (target === null || !(target instanceof Element)) return
      if (target.closest('[data-agentlex-workspace-panel]') !== null) return

      const cwd = sessionCwd(ctx)
      let path = pathFromTarget(target, cwd)
      if (path === null) path = pathFromTextAt(event, cwd)
      if (path === null) return
      // 只拦截 md 文件（边栏预览）；其他文件/链接放行默认行为。
      if (!isMarkdownPath(path)) return

      event.preventDefault()
      event.stopPropagation()

      // 打开面板 + 定位/预览。解析路径（basename 会拼到工作区根）不存在时，
      // 退化为「按文件名在工作区下查找」——文件不在根目录（如
      // packages/xxx/CHANGELOG.md）也能打开预览；两步都落空才静默放行。
      void (async () => {
        let target = path
        if (!(await checkPathExists(target))) {
          const name = target.slice(Math.max(target.lastIndexOf('/'), target.lastIndexOf('\\')) + 1)
          const matches = await findByName(cwd, name)
          if (matches.length === 0) return
          target = matches[0]
        }
        window.dispatchEvent(new CustomEvent('agentlex-workspace:panel-open'))
        window.dispatchEvent(new CustomEvent('agentlex-workspace:reveal-request', {
          detail: { path: target, open: true },
        }))
      })()
    } catch (error) {
      // 任何异常都不能让点击「看起来没反应」：记录并放行默认行为。
      console.warn('[agentlex-workspace] link intercept failed:', error)
    }
  }

  // capture 阶段拦截，先于 React 的链接默认行为。
  document.addEventListener('click', onClick, true)
  return () => document.removeEventListener('click', onClick, true)
}

/** 宿主校验绝对路径是否存在（/api/agentlex-workspace/local-check）。 */
async function checkPathExists(path: string): Promise<boolean> {
  try {
    const res = await fetch('/api/agentlex-workspace/local-check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paths: [path] }),
    })
    const envelope = await res.json() as { success?: boolean; data?: { results?: Record<string, { exists?: boolean }> } }
    return envelope?.success === true && envelope.data?.results?.[path]?.exists === true
  } catch {
    return false
  }
}

/** 宿主按文件名在工作区下递归查找（/api/agentlex-workspace/find-by-name）。 */
async function findByName(root: string, name: string): Promise<string[]> {
  try {
    const res = await fetch('/api/agentlex-workspace/find-by-name', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root, name }),
    })
    const envelope = await res.json() as { success?: boolean; data?: { matches?: string[] } }
    return envelope?.success === true && Array.isArray(envelope.data?.matches) ? envelope.data.matches : []
  } catch {
    return []
  }
}

/** 是否 md 文件路径（.md / .markdown）。 */
function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path)
}

/** 用系统默认应用打开绝对路径（宿主 /open-path 路由）。 */
function openWithSystem(path: string): void {
  void fetch('/api/agentlex-workspace/open-path', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path, kind: 'default' }),
  }).catch(() => undefined)
}

/** 复制路径到剪贴板。 */
async function copyPath(path: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(path)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = path
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}

/**
 * 会话内文件/链接右键菜单：显示路径、用系统打开、复制路径、md 边栏预览。
 * 返回 disposer。
 */
export function mountConversationLinkContextMenu(ctx: ClientContext): () => void {
  if (typeof document === 'undefined') return () => {}

  let menu: HTMLDivElement | null = null

  const close = (): void => {
    menu?.remove()
    menu = null
  }

  const show = (x: number, y: number, path: string): void => {
    close()
    const el = document.createElement('div')
    el.dataset.agentlexLinkMenu = ''
    el.style.cssText = [
      'position:fixed', 'z-index:2147483000', 'min-width:220px', 'max-width:320px',
      'background:var(--dsw-alias-bg-layer-2, #fff)', 'border:1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.12))',
      'border-radius:10px', 'box-shadow:0 8px 24px rgba(0,0,0,.18)', 'padding:6px',
      'font:13px/1.5 system-ui, sans-serif', 'color:var(--dsw-alias-label-primary, #1a1a1a)',
    ].join(';')

    // 路径头（可选中复制）
    const head = document.createElement('div')
    head.style.cssText = 'padding:4px 8px 6px;border-bottom:1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06));margin-bottom:4px'
    const pathText = document.createElement('div')
    pathText.textContent = path
    pathText.style.cssText = 'font-size:11px;color:var(--dsw-alias-label-tertiary, #888);word-break:break-all;user-select:text'
    head.appendChild(pathText)
    el.appendChild(head)

    const item = (label: string, onClick: () => void): HTMLButtonElement => {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = label
      b.style.cssText = [
        'display:block', 'width:100%', 'text-align:left', 'padding:6px 8px', 'border:none',
        'background:none', 'border-radius:6px', 'cursor:pointer', 'font:inherit', 'color:inherit',
      ].join(';')
      b.addEventListener('mouseenter', () => { b.style.background = 'var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.05))' })
      b.addEventListener('mouseleave', () => { b.style.background = 'none' })
      b.addEventListener('click', () => { onClick(); close() })
      return b
    }

    el.appendChild(item('用系统打开', () => openWithSystem(path)))
    el.appendChild(item('复制路径', () => { void copyPath(path) }))
    if (isMarkdownPath(path)) {
      el.appendChild(item('在边栏预览', () => {
        window.dispatchEvent(new CustomEvent('agentlex-workspace:panel-open'))
        window.dispatchEvent(new CustomEvent('agentlex-workspace:reveal-request', { detail: { path, open: true } }))
      }))
    }

    document.body.appendChild(el)
    // 视口边缘防溢出
    const rect = el.getBoundingClientRect()
    const left = Math.min(x, window.innerWidth - rect.width - 8)
    const top = Math.min(y, window.innerHeight - rect.height - 8)
    el.style.left = `${Math.max(8, left)}px`
    el.style.top = `${Math.max(8, top)}px`
    menu = el
  }

  const onContextMenu = (event: MouseEvent): void => {
    try {
      const target = event.target as Element | null
      if (target === null || !(target instanceof Element)) return
      if (target.closest('[data-agentlex-workspace-panel]') !== null) return
      if (target.closest('[data-agentlex-link-menu]') !== null) return

      const cwd = sessionCwd(ctx)
      let path = pathFromTarget(target, cwd)
      if (path === null) path = pathFromTextAt(event, cwd)
      if (path === null) return

      event.preventDefault()
      show(event.clientX, event.clientY, path)
    } catch (error) {
      console.warn('[agentlex-workspace] link context menu failed:', error)
    }
  }

  const onDocClick = (): void => close()
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') close() }
  const onScroll = (): void => close()

  document.addEventListener('contextmenu', onContextMenu, true)
  document.addEventListener('click', onDocClick, true)
  document.addEventListener('keydown', onKey, true)
  window.addEventListener('scroll', onScroll, true)
  return () => {
    document.removeEventListener('contextmenu', onContextMenu, true)
    document.removeEventListener('click', onDocClick, true)
    document.removeEventListener('keydown', onKey, true)
    window.removeEventListener('scroll', onScroll, true)
    close()
  }
}
