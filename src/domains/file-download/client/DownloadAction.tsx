/**
 * dsh-legal-suite/file-download — browser half.
 *
 * 交付文件卡片（present 工具产出的 `deliverables.file.actions` 槽）与
 * 改动文件卡片（`deliverables.review.file.actions` 槽）上追加一个「下载」
 * 动作：按卡片自带的授权动作 URL 取出会话事件坐标，请求本套件的
 * /api/agentlex-download/* 通道，把文件保存到**浏览器所在设备**的下载
 * 目录。远程登录时保存的是客户端本机，而不是运行 DSH 的那台机器。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Download, Loader2, TriangleAlert } from 'lucide-react'

/** Coordinates carried by the owning card's authenticated action URL. */
interface ActionUrlProps {
  /** Owner-supplied authorized action URL (`/api/present.open?...` / `/api/changes.open?...`). */
  actionUrl?: string
  /** Host desktop availability; download deliberately ignores it. */
  available?: boolean
  /** Owner's own in-flight native-open gesture. */
  pending?: boolean
  /** Standard slot seat: the viewed Session. */
  sessionId?: string
}

type Phase = 'idle' | 'busy' | 'done' | 'error'

const STYLE_ID = 'agentlex-download-action-style'

/** One-time style sheet: visually matches the neighbouring 24px open control. */
function ensureStyle(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
.agentlex-download-action {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  margin-left: 6px;
  padding: 3px 6px;
  border: .5px solid var(--dsw-alias-border-l4, rgba(0, 0, 0, .16));
  border-radius: var(--dsw-radius-sm, 6px);
  background: transparent;
  color: var(--dsw-alias-label-primary, inherit);
  font-family: var(--dsw-font-family, inherit);
  font-size: 11px;
  line-height: 16px;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color .12s;
}
.agentlex-download-action:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, .06));
}
.agentlex-download-action:focus-visible {
  outline: 2px solid var(--dsw-alias-border-focus, currentColor);
  outline-offset: 1px;
}
.agentlex-download-action:disabled {
  cursor: default;
  color: var(--dsw-alias-label-secondary, inherit);
}
.agentlex-download-action[data-error='true'] {
  color: var(--dsw-alias-state-error, #d9534f);
}
.agentlex-download-action svg { flex: none; }
.agentlex-download-action[data-phase='busy'] svg { animation: agentlex-download-spin 1s linear infinite; }
@keyframes agentlex-download-spin { to { transform: rotate(360deg); } }
`
  document.head.appendChild(style)
}

ensureStyle()

/** Pull the file name out of an RFC 6266 Content-Disposition header. */
function filenameFrom(disposition: string): string | undefined {
  const extended = /filename\*=UTF-8''([^;]+)/i.exec(disposition)
  if (extended !== null) {
    try {
      return decodeURIComponent(extended[1].trim())
    } catch { /* fall through to the plain form */ }
  }
  const plain = /filename="([^"]*)"/i.exec(disposition) ?? /filename=([^;]+)/i.exec(disposition)
  const name = plain?.[1]?.trim()
  return name === undefined || name === '' ? undefined : name
}

/** Read the authenticated route query into the download query. */
function downloadUrl(route: string, actionUrl: string): string | undefined {
  try {
    const source = new URL(actionUrl, window.location.origin)
    const sessionId = source.searchParams.get('sessionId')
    const seq = source.searchParams.get('seq')
    const index = source.searchParams.get('index')
    if (sessionId === null || seq === null || index === null) return undefined
    const query = new URLSearchParams({ sessionId, seq, index })
    return `${route}?${query.toString()}`
  } catch {
    return undefined
  }
}

/** Save one response body through the browser's own download path. */
function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.rel = 'noopener'
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => { URL.revokeObjectURL(url) }, 30_000)
}

/**
 * One compact download control.
 *
 * @param props - owner action URL plus the route family this card belongs to.
 * @returns the button, or null while the owning card has no usable coordinates.
 */
function DownloadAction({ actionUrl, route }: ActionUrlProps & { route: string }): ReactNode {
  const [phase, setPhase] = useState<Phase>('idle')
  const [message, setMessage] = useState<string>('')
  const resetTimer = useRef<number | undefined>(undefined)

  useEffect(() => () => {
    if (resetTimer.current !== undefined) window.clearTimeout(resetTimer.current)
  }, [])

  const settle = useCallback((next: Phase, nextMessage: string) => {
    setPhase(next)
    setMessage(nextMessage)
    if (resetTimer.current !== undefined) window.clearTimeout(resetTimer.current)
    if (next === 'done' || next === 'error') {
      resetTimer.current = window.setTimeout(() => {
        setPhase('idle')
        setMessage('')
      }, next === 'done' ? 2000 : 5000)
    }
  }, [])

  const onClick = useCallback(() => {
    if (phase === 'busy' || actionUrl === undefined) return
    const url = downloadUrl(route, actionUrl)
    if (url === undefined) {
      settle('error', '这张文件卡片缺少会话坐标，无法下载')
      return
    }
    setPhase('busy')
    setMessage('')
    void (async () => {
      try {
        const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' })
        if (!response.ok) {
          let detail = `HTTP ${response.status}`
          try {
            const payload = await response.json() as { error?: unknown }
            if (typeof payload.error === 'string' && payload.error !== '') detail = payload.error
          } catch { /* non-JSON failure body */ }
          throw new Error(detail)
        }
        const name = filenameFrom(response.headers.get('content-disposition') ?? '') ?? 'download'
        saveBlob(await response.blob(), name)
        settle('done', `已下载 ${name}`)
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        settle('error', `下载失败：${detail}`)
      }
    })()
  }, [actionUrl, phase, route, settle])

  if (actionUrl === undefined) return null
  const label = phase === 'done' ? '已下载' : phase === 'error' ? '下载失败' : '下载'
  const title = phase === 'error'
    ? message
    : phase === 'done'
      ? message
      : '下载到本机（保存到当前设备的下载文件夹）'

  return (
    <button
      type="button"
      className="agentlex-download-action"
      data-phase={phase}
      data-error={phase === 'error' ? 'true' : undefined}
      title={title}
      aria-label={title}
      disabled={phase === 'busy'}
      onClick={onClick}
    >
      {phase === 'busy'
        ? <Loader2 size={14} aria-hidden />
        : phase === 'done'
          ? <Check size={14} aria-hidden />
          : phase === 'error'
            ? <TriangleAlert size={14} aria-hidden />
            : <Download size={14} aria-hidden />}
      <span>{label}</span>
    </button>
  )
}

/** Card action for `present` deliverables. */
export function PresentedDownloadAction(props: ActionUrlProps): ReactNode {
  return <DownloadAction {...props} route="/api/agentlex-download/presented" />
}

/** Card action for changed-file review rows. */
export function ChangedDownloadAction(props: ActionUrlProps): ReactNode {
  return <DownloadAction {...props} route="/api/agentlex-download/changed" />
}
