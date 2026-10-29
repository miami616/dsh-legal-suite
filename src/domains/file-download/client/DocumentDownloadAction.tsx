/**
 * dsh-legal-suite/file-download — 文件预览头部的「下载」按钮。
 *
 * 官方右边栏的文档预览页（`sidebar.right.tab.document.actions` 槽位）owner 传
 * 的是**当前预览文件的绝对路径**。点「下载」把该文件以流式接口交给浏览器保存到
 * 当前设备——远程登录时落客户端本机。
 *
 * 复用已在跑的工作区流式路由，不新增 host 路由：前端把绝对路径拆成
 * root=dirname / path=basename（同时兼容 `/` 与 `\\` 分隔符）。
 */
import { useCallback, useState, type ReactNode } from 'react'
import { Download, Loader2 } from 'lucide-react'
import {
  ensureDownloadStyle,
  probeDownload,
  showDownloadNotice,
  startBrowserDownload,
} from './browser-download.ts'

ensureDownloadStyle()

const STREAM_ROUTE = '/api/agentlex-workspace/download-stream'

/** Split an absolute path into the directory and the file name. */
function splitPath(path: string): { root: string; name: string } | undefined {
  const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  if (slash < 0) return undefined
  const root = slash === 0 ? path.slice(0, 1) : path.slice(0, slash)
  const name = path.slice(slash + 1)
  if (root === '' || name === '') return undefined
  return { root, name }
}

/** One compact download control for the document-preview header. */
export function DocumentDownloadAction({ absolutePath }: { absolutePath?: string }): ReactNode {
  const [busy, setBusy] = useState(false)

  const onClick = useCallback(() => {
    if (absolutePath === undefined || absolutePath === '' || busy) return
    const parts = splitPath(absolutePath)
    if (parts === undefined) {
      showDownloadNotice('无法解析文件路径，下载失败', 'error')
      return
    }
    const url = `${STREAM_ROUTE}?${new URLSearchParams({ root: parts.root, path: parts.name }).toString()}`
    setBusy(true)
    void (async () => {
      try {
        const probe = await probeDownload(url)
        if (!probe.ok) throw new Error(probe.message)
        startBrowserDownload(url)
      } catch (error) {
        showDownloadNotice(error instanceof Error ? error.message : String(error), 'error')
      } finally {
        setBusy(false)
      }
    })()
  }, [absolutePath, busy])

  if (absolutePath === undefined || absolutePath === '') return null

  return (
    <button
      type="button"
      className="agentlex-download-action"
      data-phase={busy ? 'busy' : 'idle'}
      title="下载当前文件到本机"
      aria-label="下载当前文件到本机"
      disabled={busy}
      onClick={onClick}
    >
      {busy ? <Loader2 size={14} aria-hidden /> : <Download size={14} aria-hidden />}
      <span>下载</span>
    </button>
  )
}
