/**
 * AgentLex workspace right panel — split-view shell（文件视图）。
 *
 * 布局（由 mount.tsx 提供原生第 4 轨列容器，本组件只渲染列内内容）：
 *   ┌ 工具条（搜索 / 案件标记 / 回到工作区 / 切换目录）┐
 *   └ DirectoryPanel（文件树；自身头部含 工作区↔案件 根切换）┘
 *
 * 目录自动同步：每 10s 静默重载文件树（保持展开状态），外部改动无需手动刷新。
 * 终端 / 浏览器视图已按需求移除（v0.4.0 起）。
 * 四件套（@引用 / 引用文件 / 引用选区 / 斜杠命令）经 chatInputBridge 注入
 * DSH 会话输入框；案件/项目文件夹联动经 bindings.ts 由宿主 API 决议。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Search } from 'lucide-react'
import { ToastProvider } from '@/components/Toast'
import { ImagePreviewProvider } from './ImagePreviewContext.tsx'
import { ErrorBoundary } from './ErrorBoundary.tsx'
import DirectoryPanel from './DirectoryPanel.tsx'
import { chatInputBridge } from './chat-input-bridge.ts'
import { queryBinding, type WorkspaceBinding } from './bindings.ts'
import { pickDirectoryPath } from '../../../shared/folder-picker.ts'

export interface WorkspacePanelProps {
  /** Current DSH session id; absent while in no-session mode. */
  sessionId?: string
  /** Session workspace cwd (from the sessions feed). */
  cwd?: string
}

function baseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const at = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return at === -1 ? trimmed : trimmed.slice(at + 1)
}

export function WorkspacePanel({ sessionId, cwd }: WorkspacePanelProps): ReactNode {
  const [manualRoot, setManualRoot] = useState<string | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)
  const [currentRoot, setCurrentRoot] = useState<string>(cwd ?? '')

  // 案件/项目绑定（当前会话 ↔ case/project folder）
  const [binding, setBinding] = useState<WorkspaceBinding | null>(null)

  // ── 文件搜索开关（按钮在工具条，状态传给 DirectoryPanel）──
  const [searchMode, setSearchMode] = useState(false)

  // 外部 reveal 请求（案件详情页「在侧边栏打开」、会话文件/链接点击 → 树内定位 + 可选预览）
  const [externalRevealRequest, setExternalRevealRequest] = useState<{ id: number; path: string; open?: boolean } | null>(null)
  const revealIdRef = useRef(0)

  const treeStateRef = useRef<{ openPaths: Set<string>; directoryInfo: null }>({ openPaths: new Set(), directoryInfo: null })

  // ── 根目录：跟随会话 cwd，除非用户手动切换（保留原语义）──
  useEffect(() => {
    if (manualRoot === null && cwd) setCurrentRoot(cwd)
  }, [cwd, manualRoot])

  // ── 绑定查询：会话绑定到案件/项目时拿到其文件夹 ──
  useEffect(() => {
    let active = true
    if (!sessionId) {
      setBinding(null)
      return
    }
    void queryBinding(sessionId).then((found) => {
      if (active) setBinding(found)
    })
    return () => { active = false }
  }, [sessionId])

  const handleConfirmRoot = useCallback((path: string) => {
    setManualRoot(path)
    setCurrentRoot(path)
    setRefreshTick((t) => t + 1)
  }, [])

  // ── 切换目录：优先弹宿主系统原生目录选择框（本机 loopback 时可用）。
  //    pickDirectoryPath() 内部已处理「原生不可用（远程/SSH/非 loopback）时
  //    自动退回应用内浏览框」，因此这里拿到路径就用、拿不到（取消/已弹框）
  //    就不再额外打开应用内弹层，避免两个选择界面叠加。──
  const handleSwitchDirectory = useCallback(async (): Promise<void> => {
    const picked = await pickDirectoryPath(currentRoot)
    if (picked !== null && picked !== '') {
      handleConfirmRoot(picked)
    }
  }, [currentRoot, handleConfirmRoot])

  const bumpRefresh = useCallback(() => setRefreshTick((t) => t + 1), [])

  // ── 目录自动同步（事件驱动，零轮询开销） ──
  // 宿主对工作区根挂内核级 fs.watch，变更防抖 600ms 后经 SSE 推送；
  // 客户端收到事件才静默重载一次（最小间隔 3s 兜底防事件风暴），无变化零流量。
  // 旧宿主没有 /fs-events 路由时 EventSource 会报错——直接关闭退化为手动同步。
  useEffect(() => {
    if (!currentRoot) return undefined
    let lastReload = 0
    let closed = false
    const es = new EventSource(`/api/agentlex-workspace/fs-events?root=${encodeURIComponent(currentRoot)}`)
    es.onmessage = () => {
      if (closed || document.visibilityState !== 'visible') return
      const now = Date.now()
      if (now - lastReload < 3000) return
      lastReload = now
      setRefreshTick((t) => t + 1)
    }
    es.onerror = () => {
      // 旧宿主（无该路由）或断连：关闭，避免重连循环空转。
      closed = true
      es.close()
    }
    return () => {
      closed = true
      es.close()
    }
  }, [currentRoot])

  // ── 外部 reveal 事件（`agentlex-workspace:reveal-request`）──
  useEffect(() => {
    const onReveal = (e: Event): void => {
      const detail = (e as CustomEvent<{ path: string; open?: boolean }>).detail
      if (!detail?.path) return
      revealIdRef.current += 1
      setExternalRevealRequest({ id: revealIdRef.current, path: detail.path, open: detail.open })
    }
    window.addEventListener('agentlex-workspace:reveal-request', onReveal)
    return () => window.removeEventListener('agentlex-workspace:reveal-request', onReveal)
  }, [])

  // ── 四件套 → 会话输入框 ──
  const handleInsertReference = useCallback((paths: string[]) => {
    chatInputBridge.insertReferences(paths)
  }, [])

  const handleQuoteFile = useCallback((path: string) => {
    chatInputBridge.appendReferenceToken(`@${path.replace(/\\/g, '/')}`)
  }, [])

  const handleQuoteSelection = useCallback((path: string, startLine: number, endLine: number) => {
    const token = startLine === endLine
      ? `@${path.replace(/\\/g, '/')}#L${startLine}`
      : `@${path.replace(/\\/g, '/')}#L${startLine}-L${endLine}`
    chatInputBridge.appendReferenceToken(token)
  }, [])

  const handleInsertSlashCommand = useCallback((command: string) => {
    chatInputBridge.insertSlashCommand(command)
  }, [])

  if (!sessionId || !currentRoot) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-sm text-[var(--ink-muted)]">
        当前会话还没有工作区目录
      </div>
    )
  }

  const rootLabel = binding?.kind === 'case' ? binding.name : (baseName(currentRoot) === '' ? '工作区' : baseName(currentRoot))

  return (
    <ToastProvider>
      <ImagePreviewProvider>
      <div className="flex h-full flex-col overflow-hidden bg-[var(--paper-elevated)]" data-agentlex-workspace-root>
        <ErrorBoundary title="工作区内容加载出错">
        {/* 工具条：搜索 + 案件标记 + 回到工作区 + 切换目录（目录自动同步，无手动刷新）。
            pr-12 给视口右上角的收缩按钮留出空间，避免重叠。 */}
        <div className="flex h-9 flex-shrink-0 items-center gap-1 border-b border-[var(--line)] pl-2 pr-14" data-agentlex-workspace-views>
          <button
            type="button"
            onClick={() => setSearchMode((v) => !v)}
            title={searchMode ? '关闭搜索' : '文件搜索'}
            aria-label={searchMode ? '关闭搜索' : '文件搜索'}
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors ${
              searchMode
                ? 'bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-warm-hover)]'
                : 'text-[var(--ink-muted)] hover:bg-[var(--paper-inset)] hover:text-[var(--ink)]'
            }`}
          >
            <Search className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1" />
          <div className="flex flex-shrink-0 items-center gap-0.5">
            {binding?.kind === 'case' && binding.folder !== null && (
              <span className="mr-0.5 rounded bg-[var(--paper-inset)] px-1.5 py-0.5 text-[10px] text-[var(--accent-warm)]">案件</span>
            )}
            {/* 手动切换过目录时，提供一键回到会话工作区 */}
            {manualRoot !== null && cwd !== '' && manualRoot !== cwd && (
              <button
                type="button"
                onClick={() => { setManualRoot(null); setCurrentRoot(cwd); setRefreshTick((t) => t + 1) }}
                className="flex h-6 items-center rounded px-1.5 text-xs text-[var(--ink-muted)] transition-colors hover:bg-[var(--paper-inset)] hover:text-[var(--ink)]"
                title={`回到会话工作区：${cwd}`}
              >
                回到工作区
              </button>
            )}
            <button
              type="button"
              onClick={() => void handleSwitchDirectory()}
              className="flex h-6 items-center rounded px-1.5 text-xs text-[var(--ink-muted)] transition-colors hover:bg-[var(--paper-inset)] hover:text-[var(--ink)]"
              title="切换目录"
            >
              切换目录
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col" data-agentlex-workspace-views-file>
          <DirectoryPanel
            agentDir={currentRoot}
            caseFolder={binding?.kind === 'case' ? binding.folder : null}
            caseName={binding?.kind === 'case' ? binding.name : null}
            bindingKind={binding?.kind ?? null}
            projectDisplayName={rootLabel}
            projectIcon={undefined}
            provider={undefined}
            providers={undefined}
            onProviderChange={undefined}
            onCollapse={undefined}
            onOpenConfig={undefined}
            refreshTrigger={refreshTick}
            persistedTreeStateRef={treeStateRef as never}
            onRefreshAll={bumpRefresh}
            searchActive={searchMode}
            isTauriDragActive={false}
            onInsertReference={handleInsertReference}
            onQuoteFile={handleQuoteFile}
            onQuoteSelection={handleQuoteSelection}
            externalRevealRequest={externalRevealRequest}
            onExternalRevealHandled={(id) => {
              if (externalRevealRequest?.id === id) setExternalRevealRequest(null)
            }}
            enabledAgents={undefined}
            enabledSkills={undefined}
            enabledCommands={undefined}
            globalSkillFolderNames={undefined}
            onInsertSlashCommand={handleInsertSlashCommand}
            onOpenSettings={undefined}
            onSyncSkillToGlobal={undefined}
            onFilePreviewExternal={undefined}
          />
        </div>
        </ErrorBoundary>
      </div>
      </ImagePreviewProvider>
    </ToastProvider>
  )
}
