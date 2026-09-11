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
import { i18n as rendererI18n } from '@/i18n'
import { queryBinding, type WorkspaceBinding } from './bindings.ts'
import { pickDirectoryPath } from '../../../shared/folder-picker.ts'

export interface WorkspacePanelProps {
  /** Current DSH session id; absent while in no-session mode. */
  sessionId?: string
  /** Session workspace cwd (from the sessions feed). */
  cwd?: string
  /**
   * Preferred tree root when the session is bound to a case/project folder
   * (official right sidebar tab: 案件/项目卷宗文件夹优先于会话工作区打开).
   * The real `cwd` stays reachable through「回到工作区」.
   */
  preferredRoot?: string | null
  /**
   * 树根优先落在会话绑定的案件/项目卷宗文件夹上（官方右边栏 tab 用）。
   * 默认 false —— 自绘面板保持「跟随会话工作区、案件文件夹需手动切」的旧语义。
   */
  preferBindingFolder?: boolean
  /**
   * 精简工具条（右边栏 tab 用）：只留「搜索 / 切换目录 / 返回卷宗」，
   * 不带「案件·项目」跳转 chip、也不带无谓的「回到工作区」。
   */
  minimalChrome?: boolean
  /**
   * 文件打开交给 DSH 原生预览（我们插件不再自带预览）。给了它，树里的
   * 文件点击/回车一律回调它，内置预览弹层不再渲染。
   */
  onOpenFileNative?: (absolutePath: string) => void
  /**
   * 「返回卷宗」时清掉外部的根覆盖（详情页「在侧边栏打开」定向过来的目录）。
   * 只切 rootSource 是不够的 —— 覆盖还在，auto 会又把根解析回那个目录。
   */
  onClearPreferredRoot?: () => void
}

/** 把树里的相对路径拼成绝对路径（已经是绝对路径就原样返回）。 */
function toAbsolute(root: string, path: string): string {
  if (path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)) return path
  const base = root.replace(/[\\/]+$/, '')
  return base === '' ? path : `${base}/${path.replace(/^\.\//, '')}`
}

function baseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const at = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return at === -1 ? trimmed : trimmed.slice(at + 1)
}

/**
 * 把卷宗面板的语言钉到**中文**。
 *
 * 起因：面板自带的右键菜单走 vendored i18n，其初始语言取 `navigator.language`
 * （或 DSH 应用语言）—— 只要环境是英文，同一个右边栏里就会出现「卷宗面板菜单
 * = 英文、原生树菜单 = 中文」两套并存（用户 2026-09-11 反馈「两种右键菜单不
 * 一致」）。AgentLex 这套业务界面本来就是中文产品（诉讼/非诉/任务面板全部
 * 硬编码中文），这里统一跟随产品语言，两处菜单才真正一致。
 */
function useAppLocale(): void {
  useEffect(() => {
    if (rendererI18n.language !== 'zh-CN') void rendererI18n.changeLanguage('zh-CN')
  }, [])
}

export function WorkspacePanel({ sessionId, cwd, preferredRoot = null, preferBindingFolder = false, minimalChrome = false, onOpenFileNative, onClearPreferredRoot }: WorkspacePanelProps): ReactNode {
  useAppLocale()
  const [refreshTick, setRefreshTick] = useState(0)
  // 根目录来源：auto = 绑定卷宗优先（preferredRoot）否则会话工作区；
  // workspace = 用户显式回到会话工作区；manual = 用户手选目录。
  const [rootSource, setRootSource] = useState<'auto' | 'workspace' | 'manual'>('auto')
  const [manualPath, setManualPath] = useState('')

  // 案件/项目绑定（当前会话 ↔ case/project folder）
  const [binding, setBinding] = useState<WorkspaceBinding | null>(null)
  // 绑定查询是否已落定（preferBindingFolder 时先等它，避免先渲染会话工作区
  // 再跳到卷宗文件夹的闪动）。
  const [bindingChecked, setBindingChecked] = useState(false)

  // ── 文件搜索开关（按钮在工具条，状态传给 DirectoryPanel）──
  const [searchMode, setSearchMode] = useState(false)

  // 外部 reveal 请求（案件详情页「在侧边栏打开」、会话文件/链接点击 → 树内定位 + 可选预览）
  const [externalRevealRequest, setExternalRevealRequest] = useState<{ id: number; path: string; open?: boolean } | null>(null)
  const revealIdRef = useRef(0)

  const treeStateRef = useRef<{ openPaths: Set<string>; directoryInfo: null }>({ openPaths: new Set(), directoryInfo: null })

  // ── 根目录解析：auto 时绑定卷宗 / preferredRoot 优先，否则跟随会话 cwd ──
  const bindingRoot = binding !== null && binding.folder !== null && binding.folder !== '' ? binding.folder : null
  const autoRoot = preferredRoot !== null && preferredRoot !== ''
    ? preferredRoot
    : (preferBindingFolder && bindingRoot !== null ? bindingRoot : (cwd ?? ''))
  const currentRoot = rootSource === 'manual'
    ? manualPath
    : rootSource === 'workspace'
      ? (cwd ?? '')
      : autoRoot
  /** 根被钉在了别的目录（详情页「在侧边栏打开」定向 / 用户手动切换）。 */
  const canReturnToCase = (preferredRoot !== null && preferredRoot !== '') || rootSource !== 'auto'

  // ── 绑定查询：会话绑定到案件/项目时拿到其文件夹 ──
  useEffect(() => {
    let active = true
    if (!sessionId) {
      setBinding(null)
      setBindingChecked(true)
      return
    }
    const load = (): void => {
      void queryBinding(sessionId).then((found) => {
        if (active) {
          setBinding(found)
          setBindingChecked(true)
        }
      })
    }
    load()
    // 绑定关系可能在本页打开之后建立（如刚建会话并绑案）——监听注册表变化重查。
    window.addEventListener('agentlex:registry-changed', load)
    window.addEventListener('agentlex:session-bound', load)
    return () => {
      active = false
      window.removeEventListener('agentlex:registry-changed', load)
      window.removeEventListener('agentlex:session-bound', load)
    }
  }, [sessionId])

  const handleConfirmRoot = useCallback((path: string) => {
    setRootSource('manual')
    setManualPath(path)
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

  // preferBindingFolder：先等绑定查询落定，避免「会话工作区 → 卷宗文件夹」闪动。
  if (preferBindingFolder && !bindingChecked) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-sm text-[var(--ink-muted)]">
        正在解析案件卷宗…
      </div>
    )
  }

  if (!sessionId || !currentRoot) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-sm text-[var(--ink-muted)]">
        当前会话还没有工作区目录
      </div>
    )
  }

  // 标题跟随**当前根**：绑定卷宗与当前根一致时用案件名（更好读），否则用目录名。
  // （之前只要是绑定案件就恒显案件名，切换目录后标题不变。）
  const currentBase = baseName(currentRoot)
  const rootLabel = binding !== null && binding.folder !== null && currentRoot === binding.folder
    ? binding.name
    : (currentBase === '' ? '工作区' : currentBase)

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
            {/* minimalChrome：不带「案件/项目」跳转 chip 与「回到工作区」这类
                与当前卷宗无关的按钮（用户明确要求精简）。 */}
            {!minimalChrome && binding !== null && binding.folder !== null && (
              <button
                type="button"
                onClick={() => { setRootSource('auto'); setRefreshTick((t) => t + 1) }}
                title={`打开${binding.kind === 'case' ? '案件卷宗' : '项目'}文件夹：${binding.folder}`}
                className={`mr-0.5 rounded px-1.5 py-0.5 text-[10px] transition-colors hover:bg-[var(--paper-inset)] ${
                  currentRoot === binding.folder ? 'bg-[var(--paper-inset)] text-[var(--accent-warm)]' : 'text-[var(--ink-muted)]'
                }`}
              >
                {binding.kind === 'case' ? '案件' : '项目'}
              </button>
            )}
            {!minimalChrome && cwd !== '' && currentRoot !== cwd && (
              <button
                type="button"
                onClick={() => { setRootSource('workspace'); setRefreshTick((t) => t + 1) }}
                className="flex h-6 items-center rounded px-1.5 text-xs text-[var(--ink-muted)] transition-colors hover:bg-[var(--paper-inset)] hover:text-[var(--ink)]"
                title={`回到会话工作区：${cwd}`}
              >
                回到工作区
              </button>
            )}
            {/* 覆盖来自外部（详情页「在侧边栏打开」）时，给一个回到本会话卷宗的入口 */}
            {minimalChrome && canReturnToCase && (
              <button
                type="button"
                onClick={() => { onClearPreferredRoot?.(); setRootSource('auto'); setRefreshTick((t) => t + 1) }}
                className="flex h-6 items-center rounded px-1.5 text-xs text-[var(--ink-muted)] transition-colors hover:bg-[var(--paper-inset)] hover:text-[var(--ink)]"
                title="回到本会话绑定的卷宗"
              >
                返回卷宗
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
            /* ⚠ 只有「自动跟随」时才把绑定卷宗交给 DirectoryPanel 做 case/workspace
               切换；用户手动选了目录或外部定向之后必须交 null，否则 DirectoryPanel
               的 effectiveRoot 会被 caseFolder 顶回去 —— 这正是「切换目录没反应」
               的根因。minimalChrome 下也不给（那一档已经藏了根切换）。 */
            caseFolder={!minimalChrome && rootSource === 'auto' && binding?.kind === 'case' ? binding.folder : null}
            caseName={binding?.kind === 'case' ? binding.name : null}
            bindingKind={binding?.kind ?? null}
            projectDisplayName={rootLabel}
            projectIcon={undefined}
            hideRootSwitcher={minimalChrome}
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
            /* 原生预览：内部弹层靠 onFilePreviewExternal 关闭，实际打开走
               onOpenFileNative。⚠ DirectoryPanel 给的 node.path 是**相对树根**的
               路径（官方 workspace_files 的树就是这样），这里必须先拼成绝对路径，
               否则原生预览会到会话工作区里找一个不存在的同名文件。 */
            onFilePreviewExternal={onOpenFileNative === undefined ? undefined : (data) => onOpenFileNative(toAbsolute(currentRoot, data.path))}
            onOpenFileNative={onOpenFileNative === undefined ? undefined : (path) => onOpenFileNative(toAbsolute(currentRoot, path))}
          />
        </div>
        </ErrorBoundary>
      </div>
      </ImagePreviewProvider>
    </ToastProvider>
  )
}
