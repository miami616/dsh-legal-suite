/**
 * 官方原生文件树的右键功能（备忘 #30）。
 *
 * 官方右边栏自带的「文件」页（原生文件树）保持原样：这里**只做事件代理**，
 * 在 `document` 的 capture 阶段接管 `contextmenu`，且只认官方树自己的锚点
 * （`[data-files-state="tree"]` 与 `li[data-files-entry][data-files-path]`）——
 * 不改写官方 DOM、不重渲染它的树。
 *
 * ⚠ 外观必须与「案件卷宗」面板（DirectoryPanel 的 ContextMenu）**完全一致**
 * （用户 2026-09-11 反馈「原生 dsh 文件树的右键为什么和卷宗面板的右键不一致，
 * 卷宗那套可以吗？」）：同一套 `--paper-elevated / --line / --ink / --error`
 * 设计令牌、同样的圆角/描边/投影/hover、同样的中文菜单项与 lucide 图标。
 * 所以这里用 React + lucide 渲染，而不是手写 DOM 样式。
 *
 * ⚠ 独立成文件：这段逻辑原本内联在 official-sidebar.tsx 里，两次被区间替换
 * 误删导致插件整包加载失败（`mountNativeTreeContextMenu is not defined`）。
 */
import { useEffect, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  AtSign, Copy, ExternalLink, Eye, FilePlus, FolderOpen, FolderPlus,
  Pencil, RefreshCw, Trash2,
} from 'lucide-react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { chatInputBridge } from './chat-input-bridge.ts'

/** 官方原生文件树的树容器。 */
const NATIVE_TREE_SELECTOR = '[data-files-state="tree"]'
/** 官方原生文件树的一行（li 上带绝对路径）。 */
const NATIVE_ROW_SELECTOR = 'li[data-files-entry][data-files-path]'

/** 宿主 JSON 信封。 */
interface Envelope<T> {
  success?: boolean
  data?: T
  error?: string
}

/** POST 一个 agentlex-workspace 路由，返回 data（失败返回 undefined）。 */
async function postWorkspace<T>(path: string, body: Record<string, unknown>): Promise<T | undefined> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    })
    const envelope = await res.json() as Envelope<T>
    if (envelope.success !== true) {
      if (typeof envelope.error === 'string' && envelope.error !== '') {
        console.warn('[agentlex-workspace] 右键操作失败:', envelope.error)
      }
      return undefined
    }
    return envelope.data
  } catch (error) {
    console.warn('[agentlex-workspace] 右键操作请求失败:', error)
    return undefined
  }
}

/** 相对树根的路径（原生行给的是绝对路径）。 */
function toRelative(root: string, absolute: string): string {
  const base = root.replace(/[\\/]+$/, '')
  if (base !== '' && absolute.startsWith(`${base}/`)) return absolute.slice(base.length + 1)
  return absolute
}

/** 让原生树重新列目录（点它自己的刷新控件；找不到就直接 no-op）。 */
function reloadNativeTree(root: Element | null): void {
  const button = (root ?? document).querySelector<HTMLButtonElement>('[data-files-reload]')
  button?.click()
}

/** 复制文本到剪贴板（带 execCommand 回退）。 */
async function copyPlainText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    return
  } catch { /* 回退 */ }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    document.execCommand('copy')
    area.remove()
  } catch { /* 忽略 */ }
}

/** 菜单项（与 DirectoryPanel 的 ContextMenuItem 同形）。 */
interface MenuItem {
  label?: string
  icon?: ReactNode
  danger?: boolean
  separator?: boolean
  onClick?: () => void
}

/**
 * 菜单本体 —— 与「案件卷宗」面板的 ContextMenu 用**同一套类名**，
 * 保证两处右键长得一模一样。
 */
function TreeMenu({ x, y, items, onClose }: {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}): ReactNode {
  const [pos, setPos] = useState({ left: x, top: y })
  useEffect(() => {
    const el = document.getElementById('agentlex-tree-menu')
    if (el === null) return
    const rect = el.getBoundingClientRect()
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)),
    })
  }, [x, y])

  return (
    <div
      id="agentlex-tree-menu"
      data-agentlex-tree-menu=""
      className="fixed min-w-[160px] rounded-xl border border-[var(--line)] bg-[var(--paper-elevated)] py-1.5 shadow-lg backdrop-blur"
      style={{ left: pos.left, top: pos.top, zIndex: 2147483000 }}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }}
    >
      {items.map((item, index) =>
        item.separator === true ? (
          <div key={index} className="my-1 border-t border-[var(--line)]" />
        ) : (
          <button
            key={index}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { item.onClick?.(); onClose() }}
            className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm transition-colors ${item.danger === true
              ? 'text-[var(--error)] hover:bg-[var(--error-bg)]'
              : 'text-[var(--ink)] hover:bg-[var(--paper-inset)]'}`}
          >
            {item.icon !== undefined && <span className="h-4 w-4">{item.icon}</span>}
            <span>{item.label}</span>
          </button>
        ),
      )}
    </div>
  )
}

/** 一个输入弹层（新建 / 重命名共用），同样沿用面板的视觉。 */
function PromptDialog({ x, y, title, initial, confirmLabel, onConfirm, onClose }: {
  x: number
  y: number
  title: string
  initial: string
  confirmLabel: string
  onConfirm: (value: string) => void
  onClose: () => void
}): ReactNode {
  const [value, setValue] = useState(initial)
  const submit = (): void => {
    const trimmed = value.trim()
    if (trimmed === '') return
    onConfirm(trimmed)
    onClose()
  }
  return (
    <div
      id="agentlex-tree-menu"
      data-agentlex-tree-menu=""
      className="fixed w-[320px] rounded-xl border border-[var(--line)] bg-[var(--paper-elevated)] p-3 shadow-lg backdrop-blur"
      style={{ left: Math.max(8, x - 160), top: Math.max(8, y), zIndex: 2147483000 }}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }}
    >
      <div className="mb-2 text-xs text-[var(--ink-muted)]">{title}</div>
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit()
          if (e.key === 'Escape') onClose()
        }}
        className="mb-2 w-full rounded-md border border-[var(--line)] bg-[var(--paper)] px-2 py-1.5 text-sm text-[var(--ink)] outline-none"
      />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose}
          className="rounded-md px-2.5 py-1 text-xs text-[var(--ink-muted)] hover:bg-[var(--paper-inset)]">取消</button>
        <button type="button" onClick={submit}
          className="rounded-md bg-[var(--accent-warm)] px-2.5 py-1 text-xs text-[var(--on-accent)]">{confirmLabel}</button>
      </div>
    </div>
  )
}

/** 删除确认弹层。 */
function ConfirmDialog({ x, y, label, onConfirm, onClose }: {
  x: number
  y: number
  label: string
  onConfirm: () => void
  onClose: () => void
}): ReactNode {
  return (
    <div
      id="agentlex-tree-menu"
      data-agentlex-tree-menu=""
      className="fixed w-[300px] rounded-xl border border-[var(--line)] bg-[var(--paper-elevated)] p-3 shadow-lg backdrop-blur"
      style={{ left: Math.max(8, x - 150), top: Math.max(8, y), zIndex: 2147483000 }}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }}
    >
      <div className="mb-1 text-sm text-[var(--ink)]">确认删除「{label}」？</div>
      <div className="mb-2 text-xs text-[var(--ink-muted)]">删除后不可恢复。</div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose}
          className="rounded-md px-2.5 py-1 text-xs text-[var(--ink-muted)] hover:bg-[var(--paper-inset)]">取消</button>
        <button type="button" onClick={() => { onConfirm(); onClose() }}
          className="rounded-md bg-[var(--error)] px-2.5 py-1 text-xs text-white">删除</button>
      </div>
    </div>
  )
}

/**
 * 挂载官方原生文件树的右键菜单。
 *
 * @param ctx - 客户端上下文（仅为与其它挂载点保持同一签名/生命周期）。
 * @returns disposer。
 */
export function mountNativeTreeContextMenu(ctx: ClientContext): () => void {
  if (typeof document === 'undefined') return () => {}

  let host: HTMLDivElement | null = null
  let root: Root | null = null

  const close = (): void => {
    root?.unmount()
    root = null
    host?.remove()
    host = null
  }

  const render = (node: ReactNode): void => {
    close()
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    root.render(node)
  }

  const showRowMenu = (x: number, y: number, row: Element, root_: string, absolute: string): void => {
    const isDir = row.getAttribute('data-files-entry') === 'directory'
    const relative = toRelative(root_, absolute)
    const name = absolute.slice(absolute.lastIndexOf('/') + 1)
    const refresh = (): void => reloadNativeTree(row.closest(NATIVE_TREE_SELECTOR))
    const icon = (node: ReactNode): ReactNode => node

    const prompt = (title: string, initial: string, confirmLabel: string, run: (value: string) => void): void => {
      render(<PromptDialog x={x} y={y} title={title} initial={initial} confirmLabel={confirmLabel}
        onConfirm={run} onClose={close} />)
    }

    const items: MenuItem[] = isDir
      ? [
          { label: '新建文件', icon: icon(<FilePlus className="h-4 w-4" />), onClick: () => prompt('新建文件', '未命名.md', '创建', (v) => { void postWorkspace('/api/agentlex-workspace/create-file', { root: root_, parentDir: relative, name: v }).then(() => setTimeout(refresh, 200)) }) },
          { label: '新建文件夹', icon: icon(<FolderPlus className="h-4 w-4" />), onClick: () => prompt('新建文件夹', '新建文件夹', '创建', (v) => { void postWorkspace('/api/agentlex-workspace/create-folder', { root: root_, parentDir: relative, name: v }).then(() => setTimeout(refresh, 200)) }) },
          { separator: true },
          { label: '引用', icon: icon(<AtSign className="h-4 w-4" />), onClick: () => chatInputBridge.appendReferenceToken(`@${absolute.replace(/\\/g, '/')}`) },
          { label: '打开所在文件夹', icon: icon(<FolderOpen className="h-4 w-4" />), onClick: () => { void postWorkspace('/api/agentlex-workspace/open-path', { path: absolute, kind: 'finder' }) } },
          { label: '复制文件夹路径', icon: icon(<Copy className="h-4 w-4" />), onClick: () => { void copyPlainText(absolute) } },
          { label: '复制相对路径', icon: icon(<Copy className="h-4 w-4" />), onClick: () => { void copyPlainText(relative) } },
          { separator: true },
          { label: '重命名', icon: icon(<Pencil className="h-4 w-4" />), onClick: () => prompt('重命名', name, '重命名', (v) => { void postWorkspace('/api/agentlex-workspace/rename', { root: root_, oldPath: relative, newName: v }).then(() => setTimeout(refresh, 200)) }) },
          { label: '删除', icon: icon(<Trash2 className="h-4 w-4" />), danger: true, onClick: () => render(<ConfirmDialog x={x} y={y} label={name} onClose={close} onConfirm={() => { void postWorkspace('/api/agentlex-workspace/delete', { root: root_, path: relative }).then(() => setTimeout(refresh, 200)) }} />) },
          { separator: true },
          { label: '刷新', icon: icon(<RefreshCw className="h-4 w-4" />), onClick: refresh },
        ]
      : [
          { label: '预览', icon: icon(<Eye className="h-4 w-4" />), onClick: () => { window.dispatchEvent(new CustomEvent('agentlex-workspace:reveal-request', { detail: { path: absolute } })) } },
          { label: '引用', icon: icon(<AtSign className="h-4 w-4" />), onClick: () => chatInputBridge.appendReferenceToken(`@${absolute.replace(/\\/g, '/')}`) },
          { label: '打开', icon: icon(<ExternalLink className="h-4 w-4" />), onClick: () => { void postWorkspace('/api/agentlex-workspace/open-path', { path: absolute, kind: 'default' }) } },
          { label: '打开所在文件夹', icon: icon(<FolderOpen className="h-4 w-4" />), onClick: () => { void postWorkspace('/api/agentlex-workspace/open-path', { path: absolute, kind: 'finder' }) } },
          { separator: true },
          { label: '复制文件路径', icon: icon(<Copy className="h-4 w-4" />), onClick: () => { void copyPlainText(absolute) } },
          { label: '复制相对路径', icon: icon(<Copy className="h-4 w-4" />), onClick: () => { void copyPlainText(relative) } },
          { separator: true },
          { label: '重命名', icon: icon(<Pencil className="h-4 w-4" />), onClick: () => prompt('重命名', name, '重命名', (v) => { void postWorkspace('/api/agentlex-workspace/rename', { root: root_, oldPath: relative, newName: v }).then(() => setTimeout(refresh, 200)) }) },
          { label: '删除', icon: icon(<Trash2 className="h-4 w-4" />), danger: true, onClick: () => render(<ConfirmDialog x={x} y={y} label={name} onClose={close} onConfirm={() => { void postWorkspace('/api/agentlex-workspace/delete', { root: root_, path: relative }).then(() => setTimeout(refresh, 200)) }} />) },
        ]

    render(<TreeMenu x={x} y={y} items={items} onClose={close} />)
  }

  const showRootMenu = (x: number, y: number, tree: Element, root_: string): void => {
    const refresh = (): void => reloadNativeTree(tree)
    const prompt = (title: string, initial: string, confirmLabel: string, run: (value: string) => void): void => {
      render(<PromptDialog x={x} y={y} title={title} initial={initial} confirmLabel={confirmLabel}
        onConfirm={run} onClose={close} />)
    }
    render(<TreeMenu x={x} y={y} onClose={close} items={[
      { label: '新建文件', icon: <FilePlus className="h-4 w-4" />, onClick: () => prompt('新建文件', '未命名.md', '创建', (v) => { void postWorkspace('/api/agentlex-workspace/create-file', { root: root_, parentDir: '', name: v }).then(() => setTimeout(refresh, 200)) }) },
      { label: '新建文件夹', icon: <FolderPlus className="h-4 w-4" />, onClick: () => prompt('新建文件夹', '新建文件夹', '创建', (v) => { void postWorkspace('/api/agentlex-workspace/create-folder', { root: root_, parentDir: '', name: v }).then(() => setTimeout(refresh, 200)) }) },
      { separator: true },
      { label: '复制根路径', icon: <Copy className="h-4 w-4" />, onClick: () => { void copyPlainText(root_) } },
      { label: '打开所在文件夹', icon: <FolderOpen className="h-4 w-4" />, onClick: () => { void postWorkspace('/api/agentlex-workspace/open-path', { path: root_, kind: 'finder' }) } },
      { separator: true },
      { label: '刷新', icon: <RefreshCw className="h-4 w-4" />, onClick: refresh },
    ]} />)
  }

  const onContextMenu = (event: MouseEvent): void => {
    try {
      const target = event.target as Element | null
      if (target === null || !(target instanceof Element)) return
      if (target.closest('[data-agentlex-tree-menu]') !== null) return

      // 只接管**官方原生文件树**：其它区域（含 AgentLex 自己的树）原样放行。
      const tree = target.closest(NATIVE_TREE_SELECTOR)
      if (tree === null) return
      const rootPath = tree.getAttribute('data-files-root') ?? ''
      if (rootPath === '') return

      const row = target.closest(NATIVE_ROW_SELECTOR)
      event.preventDefault()
      event.stopPropagation()

      if (row === null) {
        showRootMenu(event.clientX, event.clientY, tree, rootPath)
        return
      }
      const absolute = row.getAttribute('data-files-path') ?? ''
      if (absolute === '') return
      showRowMenu(event.clientX, event.clientY, row, rootPath, absolute)
    } catch (error) {
      console.warn('[agentlex-workspace] 原生树右键菜单失败:', error)
    }
  }

  const onDocClick = (event: MouseEvent): void => {
    const target = event.target as Element | null
    if (target instanceof Element && target.closest('[data-agentlex-tree-menu]') !== null) return
    close()
  }
  const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') close() }
  const onScroll = (): void => close()

  document.addEventListener('contextmenu', onContextMenu, true)
  document.addEventListener('mousedown', onDocClick, true)
  document.addEventListener('keydown', onKey, true)
  window.addEventListener('scroll', onScroll, true)
  return () => {
    document.removeEventListener('contextmenu', onContextMenu, true)
    document.removeEventListener('mousedown', onDocClick, true)
    document.removeEventListener('keydown', onKey, true)
    window.removeEventListener('scroll', onScroll, true)
    close()
    void ctx
  }
}
