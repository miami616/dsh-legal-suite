/**
 * dsh-legal-suite/file-download — 工作区「文件」页顶部（打开方式旁）的下载按钮。
 *
 * 官方右边栏「文件」页的 `sidebar.right.tab.files.actions` 槽位，owner 传的是
 * 当前显示的**文件夹绝对路径**（工作区根或用户打开的目录）。点「下载」把整个
 * 文件夹打包成 zip 交给浏览器保存到当前设备——远程登录时落客户端本机。
 *
 * 打包在服务端用系统的 `zip` 命令完成，直接写 stdout，不落临时文件、不把整包
 * 读进内存；`node_modules` / `.git` 等依赖与版本库目录不打包（与服务端统计口径
 * 一致），并在点击前先做一次 HEAD/统计预检，过大或宿主无 zip 时用浮层提示。
 */
import { useCallback, useState, type ReactNode } from 'react'
import { Download, Loader2 } from 'lucide-react'
import {
  ensureDownloadStyle,
  formatBytes,
  showDownloadNotice,
  startBrowserDownload,
} from './browser-download.ts'

ensureDownloadStyle()

const CHECK_ROUTE = '/api/agentlex-workspace/folder-archive/check'
const ARCHIVE_ROUTE = '/api/agentlex-workspace/folder-archive'

interface ArchiveCheck {
  name?: string
  files?: number
  bytes?: number
  limit?: number
  zipAvailable?: boolean
}

/** One compact download control for the workspace files header. */
export function FilesArchiveAction({ absolutePath }: { absolutePath?: string }): ReactNode {
  const [busy, setBusy] = useState(false)

  const onClick = useCallback(() => {
    const root = absolutePath
    if (root === undefined || root === '' || busy) return
    setBusy(true)
    void (async () => {
      try {
        const query = new URLSearchParams({ root })
        const response = await fetch(`${CHECK_ROUTE}?${query.toString()}`, {
          credentials: 'same-origin',
          cache: 'no-store',
        })
        const payload = await response.json() as { success?: boolean; data?: ArchiveCheck; error?: string }
        if (payload.success !== true || payload.data === undefined) {
          throw new Error(payload.error ?? `无法读取文件夹信息（HTTP ${response.status}）`)
        }
        const info = payload.data
        if (info.zipAvailable === false) {
          throw new Error('宿主没有可用的 zip 命令，无法打包文件夹；可在文件上右键「下载」单个文件')
        }
        const bytes = info.bytes ?? 0
        const limit = info.limit ?? 0
        if (limit > 0 && bytes > limit) {
          throw new Error(`文件夹过大（${formatBytes(bytes)}），请在单个文件上右键「下载」`)
        }
        startBrowserDownload(`${ARCHIVE_ROUTE}?${new URLSearchParams({ root }).toString()}`)
        showDownloadNotice(
          `开始打包「${info.name ?? '文件夹'}」：${info.files ?? 0} 个文件，约 ${formatBytes(bytes)}`,
        )
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
      title="下载当前文件夹（zip，排除 node_modules/.git 等）到本机"
      aria-label="下载当前文件夹（zip）到本机"
      disabled={busy}
      onClick={onClick}
    >
      {busy ? <Loader2 size={14} aria-hidden /> : <Download size={14} aria-hidden />}
      <span>{busy ? '打包中' : '下载'}</span>
    </button>
  )
}
