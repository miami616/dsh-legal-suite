/**
 * Case-folder sidebar tab for dsh-better-sidebar.
 *
 * Registers the tab type `agentlex:case-folder` that shows a bound case
 * folder as a browsable tree with the SAME look, colors and interactions as
 * the native 文件 tab (dsh-better-sidebar's own explorer): a search box with
 * refresh, 34px hover-filled rows with the primitives' folder/file icons,
 * the hover @文件 reference pill, and a right-click context menu (open in a
 * new tab / download / copy relative & absolute path / open in the system
 * app). The tree is served by the litigation host's own
 * `/api/agentlex-case/folder-*` routes, so it works for folders outside the
 * DSH workspace (the common litigation layout).
 *
 * A path-less tab (opened from the tab strip's + menu) renders a folder
 * picker: the cases with bound folders plus a free-form path input. Picking
 * one consumes the picker tab and opens a dedicated folder tab (unique id),
 * so several case folders can sit side by side and the next + click starts
 * a fresh picker.
 *
 * File opening mirrors the native explorer: text-like files open in the
 * better-sidebar's own editor tab (its fs.read accepts absolute paths
 * outside the workspace); images stay in-tab (the native media route only
 * serves files under the session cwd); everything else opens in the system
 * app through the host's open-path route.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import * as api from './api.ts'
import { CASE_FOLDER_TAB_TYPE, getBetterSidebar, type BetterSidebarTabComponentProps } from './better-sidebar.tsx'
import {
  CaseCodeIcon, CaseCopyIcon, CaseDownloadIcon, CaseFolderCloseIcon, CaseFolderOpenIcon, CaseRefreshIcon,
} from './case-folder-icons.tsx'
import css from './case-folder-tab.module.css'

const PREVIEWABLE_EXT = /\.(txt|md|json|js|mjs|cjs|ts|tsx|jsx|css|html?|ya?ml|yml|xml|csv|log|ini|conf|sh|py|java|c|cpp|h|hpp)$/i
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i

/** Unique tab id (multi-folder tabs need distinct ids). */
function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
}

function baseName(path: string): string {
  const cleaned = path.replace(/[\\/]+$/, '')
  const parts = cleaned.split(/[\\/]/)
  return parts[parts.length - 1] || cleaned
}

function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && typeof navigator.clipboard?.writeText === 'function') {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => false)
  }
  return Promise.resolve(false)
}

/** One row of the right-click menu (kept as plain data; rendered fixed). */
interface MenuRow {
  id: string
  label: string
  icon: ReactNode
}

/** The open context menu: the row it belongs to plus the cursor position. */
interface OpenMenu {
  node: api.FolderTreeNode
  rows: MenuRow[]
  x: number
  y: number
}

export function CaseFolderTab({ ctx, scope, tab, onReferenceFile }: BetterSidebarTabComponentProps): ReactNode {
  const root = tab.path ?? ''
  const [tree, setTree] = useState<api.FolderTreeResult | null>(null)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [dirChildren, setDirChildren] = useState<Record<string, api.FolderTreeNode[]>>({})
  const [refreshTick, setRefreshTick] = useState(0)
  const [copiedPath, setCopiedPath] = useState<string | null>(null)
  const [menu, setMenu] = useState<OpenMenu | null>(null)
  const [preview, setPreview] = useState<{ name: string; content: string; size: number } | null>(null)
  const [imagePreview, setImagePreview] = useState<{ name: string; dataUrl: string } | null>(null)

  // Search state (mirrors the native tree panel's debounce + flat results).
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ matches: string[]; truncated: boolean } | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)

  // Folder-picker state for a path-less tab.
  const [cases, setCases] = useState<Array<{ caseId: string; name: string; folder: string }>>([])
  const [pathDraft, setPathDraft] = useState('')
  const [bindError, setBindError] = useState('')

  /* ── Tree loading ─────────────────────────────────────────────────── */

  useEffect(() => {
    let cancelled = false
    setTree(null)
    setError('')
    setExpanded(new Set())
    setDirChildren({})
    setResults(null)
    setSearchError(null)
    setPreview(null)
    setImagePreview(null)
    if (!root) return
    api.folderTree(root)
      .then((result) => { if (!cancelled) setTree(result) })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof Error ? err.message : String(err)) })
    return () => { cancelled = true }
  }, [root, refreshTick])

  /* ── Picker data (bound case folders) ─────────────────────────────── */

  useEffect(() => {
    if (root !== '') return
    let cancelled = false
    api.readRegistry()
      .then((registry) => {
        if (cancelled) return
        const rows = Object.values(registry.cases)
          .filter((c) => typeof c.folder === 'string' && c.folder !== '')
          .map((c) => ({ caseId: c.caseId, name: c.name, folder: c.folder as string }))
        rows.sort((a, b) => a.name.localeCompare(b.name))
        setCases(rows)
      })
      .catch((err: unknown) => { if (!cancelled) setBindError(err instanceof Error ? err.message : String(err)) })
    return () => { cancelled = true }
  }, [root])

  /* ── Search (debounced, server-side walk like the native tree) ────── */

  const needle = query.trim()
  useEffect(() => {
    if (needle === '' || root === '') {
      setResults(null)
      setSearchError(null)
      return
    }
    let cancelled = false
    const timer = window.setTimeout(() => {
      api.folderSearch(root, needle)
        .then((found) => { if (!cancelled) { setResults(found); setSearchError(null) } })
        .catch((err: unknown) => {
          if (cancelled) return
          setResults(null)
          setSearchError(err instanceof Error ? err.message : String(err))
        })
    }, 300)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [root, needle])

  /* ── Directory expansion (lazy per level, like the native tree) ────── */

  const toggleDir = useCallback(async (node: api.FolderTreeNode) => {
    if (!root) return
    if (node.loaded === false && !dirChildren[node.path]) {
      try {
        const result = await api.folderExpand(root, node.path)
        setDirChildren((prev) => ({ ...prev, [node.path]: result.children }))
        setExpanded((prev) => { const next = new Set(prev); next.add(node.path); return next })
      } catch (err) {
        console.warn('[case-folder-tab] expand failed:', err)
      }
      return
    }
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(node.path)) next.delete(node.path)
      else next.add(node.path)
      return next
    })
  }, [root, dirChildren])

  /* ── Open a file (native editor for text; in-tab for images; OS else) ── */

  const openFile = useCallback(async (node: api.FolderTreeNode) => {
    if (!root) return
    const fullPath = node.path ? `${root}/${node.path}` : root
    const sidebar = getBetterSidebar(ctx)
    if (PREVIEWABLE_EXT.test(node.name)) {
      if (sidebar) {
        // The native editor tab reads absolute paths outside the workspace.
        sidebar.openFile(scope, fullPath, node.name)
        return
      }
      try {
        const result = await api.filePreview(root, node.path)
        setPreview({ name: result.name, content: result.content, size: result.size })
      } catch (err) {
        console.warn('[case-folder-tab] preview failed:', err)
      }
      return
    }
    if (IMAGE_EXT.test(node.name)) {
      try {
        const result = await api.fileDownload(root, node.path)
        setImagePreview({ name: result.name, dataUrl: `data:${result.mimeType};base64,${result.data}` })
      } catch (err) {
        console.warn('[case-folder-tab] image open failed:', err)
      }
      return
    }
    try {
      await api.openPath(root, node.path, 'default')
    } catch (err) {
      console.warn('[case-folder-tab] open failed:', err)
    }
  }, [root, ctx, scope])

  const openAbsolute = useCallback((absolute: string): void => {
    const sidebar = getBetterSidebar(ctx)
    if (sidebar) {
      sidebar.openFile(scope, absolute, baseName(absolute))
      return
    }
    void api.openPath(absolute, undefined, 'default')
  }, [ctx, scope])

  /* ── Clipboard helper with the native transient "已复制" label ─────── */

  const copyPath = useCallback((text: string, key: string): void => {
    void copyText(text).then((ok) => {
      if (!ok) return
      setCopiedPath(key)
      window.setTimeout(() => {
        setCopiedPath((current) => (current === key ? null : current))
      }, 1200)
    })
  }, [])

  /* ── Context menu ─────────────────────────────────────────────────── */

  const relativeOf = (node: api.FolderTreeNode): string => (node.path ? node.path : '')
  const absoluteOf = (node: api.FolderTreeNode): string => (node.path ? `${root}/${node.path}` : root)

  const openRowMenu = (event: React.MouseEvent, node: api.FolderTreeNode): void => {
    event.preventDefault()
    event.stopPropagation()
    const rows: MenuRow[] = []
    const isFile = node.type === 'file'
    if (isFile) {
      if (PREVIEWABLE_EXT.test(node.name)) {
        rows.push({ id: 'open-new-tab', label: '在新 Tab 中打开', icon: <CaseCodeIcon size={14} /> })
      }
      rows.push({ id: 'download', label: '下载', icon: <CaseDownloadIcon size={14} /> })
      rows.push({ id: 'open-system', label: '在系统应用中打开', icon: <CaseCodeIcon size={14} /> })
      rows.push({ id: 'sep', label: '', icon: null })
      rows.push({ id: 'copy-relative', label: '复制相对地址', icon: <CaseCopyIcon size={14} /> })
      rows.push({ id: 'copy-absolute', label: '复制绝对地址', icon: <CaseCopyIcon size={14} /> })
    } else {
      rows.push({ id: 'copy-relative', label: '复制相对地址', icon: <CaseCopyIcon size={14} /> })
      rows.push({ id: 'copy-absolute', label: '复制绝对地址', icon: <CaseCopyIcon size={14} /> })
    }
    setMenu({ node, rows, x: event.clientX, y: event.clientY })
  }

  useEffect(() => {
    if (menu === null) return
    const close = (): void => setMenu(null)
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') close() }
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const runMenu = useCallback(async (node: api.FolderTreeNode, id: string) => {
    if (id === 'open-new-tab') {
      const sidebar = getBetterSidebar(ctx)
      const fullPath = absoluteOf(node)
      if (sidebar) sidebar.openFile(scope, fullPath, node.name)
      return
    }
    if (id === 'open-system') {
      try { await api.openPath(root, node.path, 'default') } catch (err) { console.warn('[case-folder-tab] open failed:', err) }
      return
    }
    if (id === 'download') {
      try {
        const result = await api.fileDownload(root, node.path)
        const bytes = atob(result.data)
        const arr = new Uint8Array(bytes.length)
        for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
        const blob = new Blob([arr], { type: result.mimeType })
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = result.name
        anchor.style.display = 'none'
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        URL.revokeObjectURL(url)
      } catch (err) {
        console.warn('[case-folder-tab] download failed:', err)
      }
      return
    }
    if (id === 'copy-relative') copyPath(relativeOf(node), relativeOf(node))
    if (id === 'copy-absolute') copyPath(absoluteOf(node), absoluteOf(node))
  }, [root, ctx, scope, copyPath, absoluteOf, relativeOf])

  /* ── Picker bind: consume the picker tab, open a dedicated folder tab ── */

  const bind = useCallback((folder: string, title: string): void => {
    const cleaned = folder.trim().replace(/[\\/]+$/, '')
    if (cleaned === '') return
    const sidebar = getBetterSidebar(ctx)
    if (!sidebar) return
    sidebar.closeTab(tab.id, scope)
    sidebar.openTab(
      { type: CASE_FOLDER_TAB_TYPE, id: `${CASE_FOLDER_TAB_TYPE}:${uid()}`, title, path: cleaned },
      scope,
    )
  }, [ctx, scope, tab.id])

  /* ── Tree row rendering ─────────────────────────────────────────────── */

  const rowRefButton = (refKey: string, absolute: string): ReactNode => (
    copiedPath === refKey
      ? <span className={css.rowCopied}>已复制</span>
      : (
        <button
          type="button"
          className={css.rowRef}
          aria-label="引用文件"
          title="引用文件"
          onClick={(event) => {
            event.stopPropagation()
            onReferenceFile?.(absolute)
          }}
        >
          @文件
        </button>
      )
  )

  const renderNodes = (nodes: api.FolderTreeNode[], depth: number): ReactNode =>
    nodes.map((node) => {
      const isDir = node.type === 'dir'
      const absolute = absoluteOf(node)
      if (isDir) {
        const hasFetched = Boolean(dirChildren[node.path])
        const isExpanded = hasFetched || expanded.has(node.path)
        const children = hasFetched ? dirChildren[node.path] : (node.children ?? [])
        return (
          <div key={node.id}>
            <div
              role="button"
              tabIndex={0}
              className={css.row + ' ' + css.rowDir}
              style={{ paddingLeft: 6 + depth * 22 }}
              onClick={() => { void toggleDir(node) }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  void toggleDir(node)
                }
              }}
              onContextMenu={(event) => { openRowMenu(event, node) }}
              title={absolute}
            >
              <span className={css.rowIcon}>{isExpanded ? <CaseFolderOpenIcon size={14} /> : <CaseFolderCloseIcon size={14} />}</span>
              <span className={css.rowName}>{node.name}</span>
              {node.loaded === false && !hasFetched && <span className={css.rowMeta}>…</span>}
              {rowRefButton(node.path, absolute)}
            </div>
            {isExpanded && children.length > 0 && renderNodes(children, depth + 1)}
          </div>
        )
      }
      return (
        <div key={node.id}>
          <div
            role="button"
            tabIndex={0}
            className={css.row}
            style={{ paddingLeft: 6 + depth * 22 }}
            title={absolute}
            onClick={() => { void openFile(node) }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                void openFile(node)
              }
            }}
            onContextMenu={(event) => { openRowMenu(event, node) }}
          >
            <span className={css.rowIcon}><CaseCodeIcon size={14} /></span>
            <span className={css.rowName}>{node.name}</span>
            {rowRefButton(node.path, absolute)}
          </div>
        </div>
      )
    })

  /* ── Path-less state: the folder picker ─────────────────────────────── */

  if (root === '') {
    return (
      <div className={css.tab}>
        <div className={css.body}>
          <div className={css.picker}>
            <div className={css.pickerTitle}>案件文件夹</div>
            <div className={css.pickerHint}>从已绑定案件中选择卷宗文件夹，或输入文件夹绝对路径。</div>
            <div className={css.pickerInputRow}>
              <input
                className={css.pickerInput}
                value={pathDraft}
                spellCheck={false}
                placeholder="输入文件夹绝对路径，如 /Users/me/案件/张三诉李四"
                onChange={(event) => { setPathDraft(event.currentTarget.value) }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    bind(pathDraft.trim(), baseName(pathDraft.trim()))
                  }
                }}
              />
              <button
                type="button"
                className={css.pickerButton}
                disabled={pathDraft.trim() === ''}
                onClick={() => bind(pathDraft.trim(), baseName(pathDraft.trim()))}
              >
                打开
              </button>
            </div>
            {bindError !== '' && <div className={css.hint + ' ' + css.error}>{bindError}</div>}
            <div className={css.pickerGroup}>已绑定案件文件夹</div>
            {cases.length === 0 ? (
              <div className={css.hint}>暂无已绑定文件夹的案件，请先在「诉讼案件」中为案件绑定文件夹。</div>
            ) : (
              cases.map((c) => (
                <div
                  key={c.caseId}
                  role="button"
                  tabIndex={0}
                  className={css.row + ' ' + css.rowDir}
                  title={c.folder}
                  onClick={() => bind(c.folder, `${c.name} · 卷宗`)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      bind(c.folder, `${c.name} · 卷宗`)
                    }
                  }}
                >
                  <span className={css.rowIcon}><CaseFolderOpenIcon size={14} /></span>
                  <span className={css.rowName}>{c.name}</span>
                  <span className={css.pickerSub}>{c.folder}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    )
  }

  /* ── The tree state (native file-tab look) ─────────────────────────── */

  const searching = needle !== ''

  return (
    <div className={css.tab}>
      <div className={css.searchRow}>
        <input
          className={css.searchInput}
          value={query}
          placeholder="按文件名搜索…"
          spellCheck={false}
          onChange={(event) => { setQuery(event.currentTarget.value) }}
        />
        <button
          type="button"
          className={css.iconButton}
          aria-label="刷新"
          title="刷新"
          onClick={() => { setRefreshTick((tick) => tick + 1) }}
        >
          <CaseRefreshIcon size={14} />
        </button>
      </div>
      <div className={css.body}>
        {searching ? (
          <>
            {searchError !== null && <div className={css.hint + ' ' + css.error}>{searchError}</div>}
            {searchError === null && results === null && <div className={css.hint}>搜索中…</div>}
            {searchError === null && results !== null && results.matches.length === 0 && (
              <div className={css.hint}>无匹配文件</div>
            )}
            {searchError === null && results !== null && results.matches.map((rel) => (
              <button
                key={rel}
                type="button"
                className={css.searchResult}
                title={rel}
                onClick={() => { openAbsolute(`${root}/${rel}`) }}
              >
                {rel}
              </button>
            ))}
            {searchError === null && results?.truncated === true && (
              <div className={css.hint}>结果过多，仅显示部分匹配</div>
            )}
          </>
        ) : error !== '' ? (
          <div className={css.hint + ' ' + css.error}>无法读取文件夹：{error}</div>
        ) : tree === null ? (
          <div className={css.hint}>读取文件夹…</div>
        ) : (
          <>
            <div
              role="button"
              tabIndex={0}
              className={css.row + ' ' + css.rowDir}
              style={{ paddingLeft: 6 }}
              title={root}
              onContextMenu={(event) => {
                event.preventDefault()
                event.stopPropagation()
                copyPath(root, 'root-absolute')
              }}
            >
              <span className={css.rowIcon}><CaseFolderOpenIcon size={14} /></span>
              <span className={css.rowName}>{baseName(root)}</span>
              <span className={css.rowMeta}>{tree.summary.totalFiles + tree.summary.totalDirs} 项</span>
              {rowRefButton('root-absolute', root)}
            </div>
            {(tree.tree.children ?? []).length === 0 ? (
              <div className={css.hint}>（空文件夹）</div>
            ) : (
              renderNodes(tree.tree.children ?? [], 0)
            )}
          </>
        )}
      </div>

      {/* The shared right-click menu, positioned at the cursor. */}
      {menu !== null && (
        <div
          className={css.menu}
          style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - menu.rows.length * 31 - 20) }}
          onClick={(event) => event.stopPropagation()}
        >
          {menu.rows.map((row) => (
            row.id === 'sep' ? <div key={row.id} className={css.menuSeparator} />
              : (
                <button
                  key={row.id}
                  type="button"
                  className={css.menuItem}
                  onClick={() => {
                    const node = menu.node
                    setMenu(null)
                    void runMenu(node, row.id)
                  }}
                >
                  <span className={css.menuItemIcon}>{row.icon}</span>
                  {row.label}
                </button>
              )
          ))}
        </div>
      )}

      {preview !== null && (
        <div className={css.modalOverlay} onClick={() => setPreview(null)}>
          <div className={css.modalBox} onClick={(event) => event.stopPropagation()}>
            <div className={css.modalHead}>
              <span className={css.modalTitle}>{preview.name}</span>
              <span className={css.rowMeta}>{preview.size} B</span>
              <button type="button" className={css.modalClose} onClick={() => setPreview(null)} aria-label="关闭">✕</button>
            </div>
            <pre className={css.modalPre}>{preview.content}</pre>
          </div>
        </div>
      )}

      {imagePreview !== null && (
        <div className={css.modalOverlay} onClick={() => setImagePreview(null)}>
          <div className={css.modalBox} onClick={(event) => event.stopPropagation()}>
            <div className={css.modalHead}>
              <span className={css.modalTitle}>{imagePreview.name}</span>
              <button type="button" className={css.modalClose} onClick={() => setImagePreview(null)} aria-label="关闭">✕</button>
            </div>
            <div className={css.modalImage}>
              <img src={imagePreview.dataUrl} alt={imagePreview.name} style={{ maxWidth: '100%', maxHeight: '60vh' }} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
