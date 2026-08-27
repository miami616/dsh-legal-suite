/**
 * DirectoryPickerDialog — 目录切换弹层。
 *
 * 刚需场景：侧边栏「切换目录」。设计目标：
 *  - 远程端登录（非 loopback 浏览器）没有原生目录选择框可用，所以浏览与
 *    校验全部走宿主 HTTP 路由（/api/agentlex-workspace/dirs），任何端都能用；
 *  - 输入框可手输绝对路径（回车即校验并确认），也支持逐级浏览子目录
 *    （含隐藏目录，方便进入 ~/.dsh 等）、一键回上级 / 家目录；
 *  - 路径不存在或不是目录时给出明确错误，不静默失败。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, Check, Folder, FolderOpen, HardDrive, Home, Loader2, X } from 'lucide-react'

interface PickerDirsResult {
  path: string
  name: string
  parent: string | null
  exists: boolean
  error?: string
  dirs: string[]
}

export interface DirectoryPickerDialogProps {
  open: boolean
  initialPath: string
  onConfirm(path: string): void
  onCancel(): void
}

const FAILED: PickerDirsResult = { path: '', name: '', parent: null, exists: false, error: '目录服务不可用', dirs: [] }

async function loadDirs(path: string): Promise<PickerDirsResult> {
  try {
    const res = await fetch('/api/agentlex-workspace/dirs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path }),
    })
    const envelope = await res.json() as { success?: boolean; data?: PickerDirsResult }
    return envelope?.success === true && envelope.data ? envelope.data : FAILED
  } catch {
    return { ...FAILED, error: '无法访问目录服务' }
  }
}

/** "…/a/b" + "c" → "…/a/b/c"；保留 Windows 盘符语义（交给宿主 resolve）。 */
function joinPath(base: string, name: string): string {
  if (base.endsWith('/') || base.endsWith('\\')) return base + name
  return `${base}/${name}`
}

export default function DirectoryPickerDialog({ open, initialPath, onConfirm, onCancel }: DirectoryPickerDialogProps): ReactNode | null {
  const [path, setPath] = useState<string>(initialPath)
  const [dirs, setDirs] = useState<PickerDirsResult>({ ...FAILED, path: initialPath })
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const refresh = useCallback(async (target: string) => {
    setLoading(true)
    const result = await loadDirs(target)
    setPath(result.path || target)
    setDirs(result)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (open) {
      setPath(initialPath)
      void refresh(initialPath)
      // 打开后聚焦输入框，便于直接粘贴路径回车
      const timer = window.setTimeout(() => inputRef.current?.focus(), 80)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [open, initialPath, refresh])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  const goParent = (): void => {
    if (dirs.parent) void refresh(dirs.parent)
  }

  const goHome = (): void => {
    void refresh('')
  }

  const goRoot = (): void => {
    // 根目录：可看到 /Volumes（移动硬盘 / U 盘等挂载卷）
    void refresh('/')
  }

  const handleConfirm = (): void => {
    const target = path.trim()
    if (!target) return
    if (dirs.path === target && dirs.exists) {
      onConfirm(target)
      return
    }
    // 输入与当前浏览路径不一致时先校验再确认
    void loadDirs(target).then((result) => {
      if (result.exists) onConfirm(result.path)
      else setDirs(result)
    })
  }

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/30 p-4"
      data-agentlex-dir-picker
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div className="flex max-h-[70vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--paper-elevated)] shadow-lg">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-2.5">
          <span className="text-sm font-medium text-[var(--ink)]">切换目录</span>
          <button
            type="button"
            aria-label="关闭"
            onClick={onCancel}
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--ink-muted)] hover:bg-[var(--paper-inset)] hover:text-[var(--ink)]"
          >
            <X size={14} />
          </button>
        </div>

        {/* 路径输入 + 快捷键 */}
        <div className="border-b border-[var(--line)] px-4 py-3">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              title="家目录"
              aria-label="家目录"
              onClick={goHome}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-[var(--ink-muted)] hover:bg-[var(--paper-inset)] hover:text-[var(--ink)]"
            >
              <Home size={14} />
            </button>
            <button
              type="button"
              title="磁盘（含移动硬盘 /Volumes）"
              aria-label="磁盘"
              onClick={goRoot}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-[var(--ink-muted)] hover:bg-[var(--paper-inset)] hover:text-[var(--ink)]"
            >
              <HardDrive size={14} />
            </button>
            <button
              type="button"
              title="上一级"
              aria-label="上一级"
              disabled={!dirs.parent}
              onClick={goParent}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-[var(--ink-muted)] hover:bg-[var(--paper-inset)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ArrowLeft size={14} />
            </button>
            <input
              ref={inputRef}
              value={path}
              onChange={(e) => {
                setPath(e.target.value)
                if (e.target.value !== dirs.path) setDirs((d) => ({ ...d, exists: false, dirs: [] }))
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleConfirm()
                if (e.key === 'Escape') onCancel()
              }}
              placeholder="输入绝对路径，如 /Users/me/cases 或 C:\\cases"
              className="h-7 min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--paper)] px-2 text-xs text-[var(--ink)] outline-none focus:border-[var(--accent)]"
              spellCheck={false}
            />
          </div>
          {/* 状态行：路径校验 / 加载 / 错误 */}
          <div className="mt-1.5 flex min-h-4 items-center gap-1 px-1 text-[11px]">
            {loading ? (
              <span className="flex items-center gap-1 text-[var(--ink-muted)]"><Loader2 size={11} className="animate-spin" />加载中…</span>
            ) : dirs.error ? (
              <span className="text-[var(--error)]">该路径不可用：{dirs.error}</span>
            ) : dirs.exists ? (
              <span className="text-[var(--success)]">有效目录 · {dirs.dirs.length} 个子目录</span>
            ) : (
              <span className="text-[var(--ink-subtle)]">输入路径后回车校验</span>
            )}
          </div>
        </div>

        {/* 子目录浏览 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
          {dirs.dirs.length === 0 && !dirs.error ? (
            <div className="px-2 py-6 text-center text-xs text-[var(--ink-subtle)]">（没有子目录）</div>
          ) : (
            dirs.dirs.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => void refresh(joinPath(dirs.path, name))}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-[var(--ink)] hover:bg-[var(--paper-inset)]"
              >
                {name.startsWith('.') ? <FolderOpen size={13} className="shrink-0 text-[var(--ink-subtle)]" /> : <Folder size={13} className="shrink-0 text-[var(--accent-warm)]" />}
                <span className={`min-w-0 flex-1 truncate ${name.startsWith('.') ? 'text-[var(--ink-muted)]' : ''}`}>{name}</span>
              </button>
            ))
          )}
        </div>

        {/* 底部操作 */}
        <div className="flex items-center justify-end gap-2 border-t border-[var(--line)] px-4 py-2.5">
          <button
            type="button"
            onClick={onCancel}
            className="h-7 rounded-md px-3 text-xs text-[var(--ink-muted)] hover:bg-[var(--paper-inset)] hover:text-[var(--ink)]"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!path.trim()}
            className="flex h-7 items-center gap-1 rounded-md bg-[var(--accent)] px-3 text-xs font-medium text-[var(--on-accent)] hover:bg-[var(--accent-warm-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Check size={12} />
            使用此目录
          </button>
        </div>
      </div>
    </div>
  )
}
