/**
 * 官方右边栏（@deepseek-ai/dsh-client-ui-sidebar-right）接入层（备忘 #30）。
 *
 * ⚠ 定位（用户 2026-09-10 两次纠正后定稿）：**只用官方原生文件树，绝不把
 * AgentLex 自研的文件树（DirectoryPanel / WorkspacePanel）搬进右边栏。**
 * 本模块只在原生树之上做两件事：
 *
 *   1. **右键功能**：在原生文件树的行/空白区挂 AgentLex 的右键菜单 ——
 *      新建文件 / 新建文件夹 / 重命名 / 删除 / 用默认应用打开 / 在 Finder 中
 *      显示 / 复制路径 / 复制相对路径 / 插入 @引用 / 刷新。事件代理挂在
 *      document（capture），只认官方树自己的锚点
 *      `[data-files-state="tree"]` 与 `li[data-files-entry][data-files-path]`，
 *      不改写官方 DOM、不重渲染它的树。
 *   2. **首次打开宽度收窄**：官方默认是窗宽的 45%，见
 *      {@link installPreferredRightbarWidth}。
 *
 * 「自动打开案件文件夹」不在这里做，而是**走会话工作区**：官方原生「文件」
 * 树的根 = 该会话的工作区（`sessions.byId[id].cwd`，DSH 没有换根接口），所以
 * 从案件/项目详情页开管家会话时，我们把**卷宗文件夹作为会话工作区**
 * （见 litigation / nonlitigation 的 launch-manager）—— 打开右边栏，原生树
 * 天然就是该案卷宗。这样右边栏永远只有一套树（官方的）。
 *
 * 依赖是**可选**的：服务缺席（旧 harness / 未装官方右边栏）时本模块返回
 * null，调用方退回自绘面板；`ctx.get` 是免 inject 的服务读取。
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { mountNativeTreeContextMenu } from './native-tree-menu.tsx'
import { WorkspacePanel } from './WorkspacePanel.tsx'
import { ErrorBoundary } from './ErrorBoundary.tsx'
import { ThemeRuntimeProvider } from '@/theme'

/** 「案件卷宗」tab 类型在 tab 系统里的唯一身份，同时是正文注册用的 key。 */
export const CASE_FILES_ID = 'dsh-legal-suite/case-files'
/** 「案件卷宗」tab 的 kind（官方 `files` 归官方，我们不接管）。 */
export const CASE_FILES_KIND = 'agentlex-case-files'

/** 官方 tab 类型注册表（最小结构面）。 */
interface SidebarRightTabRegistryLike {
  register(definition: {
    id: string
    kind: string
    title: (address: string) => string
    guide?: ReadonlyArray<{ order: number; title: () => string; description?: () => string }>
  }): () => void
}

/**
 * 右边栏**自适应宽度**（备忘 #30 第 3 条）。
 *
 * 官方默认是「窗宽的 45%」（`RIGHTBAR_DEFAULT_RATIO = 0.45`，1600px 窗口 =
 * 720px）：光看文件树太宽，而看文件（原生预览/文本）又太窄。这里按**当前
 * 活动 tab 是什么**自适应：
 *   - 树类 tab（官方 `Files`、我们的「案件卷宗」）→ {@link NARROW_WIDTH}；
 *   - 预览/编辑类 tab（原生文档预览等）→ 视口的一半（夹在 {@link WIDE_MIN}–
 *     {@link WIDE_MAX} 之间）。
 *
 * 实现：官方没有暴露 `setRightbar`，宽度只在 layout store 里，所以复用官方
 * **拖拽把手**合成 `pointerdown → pointermove → pointerup`，让它的 store 正常
 * 写下宽度（含 clamp）。
 *
 * ⚠ 两个坑（都实测踩过）：
 *   ① 把手把位移施加在 store 的**偏好宽度**上，而 `getBoundingClientRect()` 读的
 *      是**渲染宽度**——面板宽度有 CSS 过渡，中途读会偏小（实测 440 vs 720），
 *      据此算 delta 会拖不到位。故必须**等宽度稳定**（连续两帧一致）再拖，并在
 *      拖后校验重试。
 *   ② 用户一旦亲手拖过把手，就**交还控制权**（本次页面加载内不再自动调宽），
 *      否则「我刚拖好又被自动改回去」。
 */
const NARROW_WIDTH = 380
/** 预览/编辑类 tab 的目标宽度区间。 */
const WIDE_MIN = 560
const WIDE_MAX = 1040
/** 与目标的余量：差得不多就不动，避免抖动。 */
const WIDTH_TOLERANCE = 24
/** 树类 tab 的标题（非它们 → 视为预览/编辑类）。 */
const TREE_TAB_TITLES = new Set(['Files', '文件', '案件卷宗'])

/** 官方右边栏导航控制器（最小结构面）。 */
interface SidebarRightControllerLike {
  openTab(kind: string, options?: Record<string, unknown>): void
  /** 打开资源地址（原生文件预览/文本查看器由注册表认领）。 */
  openResource?(address: string, options?: Record<string, unknown>): void
  isExpanded(): boolean
  toggleExpanded(): void
  /** 当前活动 tab（用于「只添加不抢焦点」时把焦点还回去）。 */
  active?(): { id: string } | undefined
  /** 聚焦某个 tab（同上）。 */
  focus?(tabId: string): void
}

/* ------------------------------------------------------------------ *
 * 「案件卷宗」tab
 * ------------------------------------------------------------------ */

/** 视线内的浅/深色（与 mount.tsx 的自绘面板同源）。 */
function useAppearanceMode(): 'light' | 'dark' {
  const read = (): 'light' | 'dark' => (
    typeof document !== 'undefined' && document.documentElement.getAttribute('data-color-scheme') === 'dark'
      ? 'dark'
      : 'light'
  )
  const [mode, setMode] = useState<'light' | 'dark'>(read)
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const next = read()
      setMode((prev) => (prev === next ? prev : next))
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-color-scheme'] })
    return () => observer.disconnect()
  }, [])
  return mode
}

/**
 * 会话 feed 的最小结构面（读 cwd）。
 *
 * 注：官方原生「文件」树的根 = **会话工作区**，DSH 没有给插件换根的接口
 * （会话工作区在建会话时写死）。所以案件卷宗只能在我们自己的这套里显示，
 * 绝不能去改会话工作区。
 */
interface SessionsLike {
  list?: {
    getSnapshot?: () => { current?: string; byId?: Record<string, { cwd?: string } | undefined> } | undefined
  }
}

/** 显式指定的卷宗根（案件/项目详情页「在侧边栏打开」带来）。 */
const folderOverride: { value: string | null; listeners: Set<() => void> } = {
  value: null,
  listeners: new Set(),
}

function setFolderOverride(path: string | null): void {
  const next = path !== null && path !== '' ? path : null
  if (folderOverride.value === next) return
  folderOverride.value = next
  for (const listener of folderOverride.listeners) listener()
}

function useFolderOverride(): string | null {
  const [value, setValue] = useState(folderOverride.value)
  useEffect(() => {
    const listener = (): void => setValue(folderOverride.value)
    folderOverride.listeners.add(listener)
    listener()
    return () => { folderOverride.listeners.delete(listener) }
  }, [])
  return value
}

/**
 * DSH 原生文件的资源地址（与官方 sidebar-files 的 `fileAddressFor` 同构）。
 * 绝对路径直接作为 path 段：宿主 workspaceFiles 文档写明「absolute path or
 * path relative to the workspace root; files outside it are allowed」。
 */
export function fileAddress(sessionId: string | undefined, absolutePath: string): string {
  const normalized = absolutePath.replace(/\\/g, '/')
  const path = normalized.split('/').map((segment) => encodeURIComponent(segment)).join('/')
  const session = sessionId === undefined || sessionId === '' ? '' : encodeURIComponent(sessionId)
  return `dsh-resource://file/session/${session}/${path}`
}

/** 会话的工作区路径（案件卷宗视图里「回到工作区」用）。 */
const ctxRef: { current: ClientContext } = { current: undefined as unknown as ClientContext }

function useSessionCwd(sessionId: string | undefined): string {
  const [cwd, setCwd] = useState('')
  useEffect(() => {
    if (!sessionId) {
      setCwd('')
      return undefined
    }
    const sessions = ctxRef.current?.get('sessions') as SessionsLike | undefined
    const read = (): void => {
      let next = ''
      try {
        next = sessions?.list?.getSnapshot?.()?.byId?.[sessionId]?.cwd ?? ''
      } catch {
        next = ''
      }
      setCwd((prev) => (prev === next ? prev : next))
    }
    read()
    const timer = window.setInterval(read, 3000)
    return () => window.clearInterval(timer)
  }, [sessionId])
  return cwd
}

/**
 * 解析「在侧边栏打开 / 会话文件链接」给的路径，拿到磁盘上真实存在的那个：
 *   1. 原样（已是绝对路径且存在）；
 *   2. 否则按**文件名**在会话绑定的案件/项目卷宗里找（会话正文里常只写
 *      `案件信息.md`，按会话工作区解析会指到数据目录去）；
 *   3. 再退回会话工作区里按文件名找；
 *   4. 都找不到就用原路径（让下游按原样处理）。
 */
async function resolveRevealPath(ctx: ClientContext, raw: string): Promise<string> {
  if (await pathExists(raw)) return raw
  const name = raw.slice(Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\')) + 1)
  if (name === '') return raw
  let sessionId = ''
  try {
    sessionId = (ctx.get('sessions') as SessionsLike | undefined)?.list?.getSnapshot?.()?.current ?? ''
  } catch {
    sessionId = ''
  }
  const roots: string[] = []
  try {
    const { queryBinding } = await import('./bindings.ts')
    const binding = sessionId === '' ? null : await queryBinding(sessionId)
    if (binding?.folder != null && binding.folder !== '') roots.push(binding.folder)
  } catch { /* 无绑定 */ }
  try {
    const cwd = (ctx.get('sessions') as SessionsLike | undefined)?.list?.getSnapshot?.()?.byId?.[sessionId]?.cwd ?? ''
    if (cwd !== '') roots.push(cwd)
  } catch { /* 无 cwd */ }
  for (const root of roots) {
    const matches = await findByName(root, name)
    const exact = matches.find((m) => m.endsWith(`/${name}`) || m === name)
    if (exact !== undefined) return exact
  }
  return raw
}

/** 宿主校验绝对路径是否存在（/api/agentlex-workspace/local-check）。 */
async function pathExists(path: string): Promise<boolean> {
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

/**
 * 「案件卷宗」tab 的正文 —— 与自绘面板**同一套渲染层与主题层**，因此外观
 * 与我们自己的右边栏完全一致（此前漏了 `ThemeRuntimeProvider`，落回 vendored
 * 默认皮肤，才出现「套进来就变样／背景发黄」）。
 *
 * 树根：显式覆盖（详情页「在侧边栏打开」）> 会话绑定的案件/项目卷宗 > 会话工作区。
 * 工具条只留必要项（搜索 / 切换目录 / 返回卷宗），不携带无关按钮。
 */
function CaseFilesTabBody({ sessionId }: { sessionId?: string }): ReactNode {
  const cwd = useSessionCwd(sessionId)
  const override = useFolderOverride()
  const appearanceMode = useAppearanceMode()
  // 文件打开一律走 DSH 原生预览（我们插件不再自带预览能力）。
  const openNativeFile = useCallback((absolutePath: string): void => {
    // 文件以 **DSH 原生预览**打开，并**停靠在右侧面板**里（不用浮动弹窗）。
    try {
      const sidebarRight = ctxRef.current?.get('sidebarRight') as SidebarRightControllerLike | undefined
      sidebarRight?.openResource?.(fileAddress(sessionId, absolutePath))
    } catch (error) {
      console.warn('[agentlex-workspace] 打开原生预览失败:', error)
    }
  }, [sessionId])
  return (
    <ThemeRuntimeProvider
      selection={{ themeId: 'myagents-default', appearanceMode }}
      persistBootstrapSnapshot={false}
      syncNativeWindowBackground={false}
    >
      <ErrorBoundary title="案件卷宗加载出错">
        <WorkspacePanel
          sessionId={sessionId}
          cwd={cwd}
          preferredRoot={override}
          preferBindingFolder
          minimalChrome
          onOpenFileNative={openNativeFile}
          onClearPreferredRoot={() => setFolderOverride(null)}
        />
      </ErrorBoundary>
    </ThemeRuntimeProvider>
  )
}

/**
 * 在官方右边栏的**控件簇**（`_stripChrome`：全屏 / 折叠按钮所在处）里常驻一枚
 * 「案件卷宗」图标按钮（备忘 #30 第 4 条 + 用户反馈「四个字放那不叫按钮、
 * 位置也不合适」）。
 *
 * 做法：28×28 图标按钮 + folder 图标 + title 悬浮提示，插进**官方控件簇**
 * （而不是插在 tab 胶囊之间 —— 那样看着像多了一个 tab）。只追加我们自己的
 * 节点、不改官方 DOM 结构；React 重建后由 body 观察者 + 低频兜底自愈。
 *
 * @param open - 点击时打开/聚焦「案件卷宗」tab。
 * @returns disposer。
 */
function mountCaseTabButton(open: () => void): () => void {
  if (typeof document === 'undefined') return () => {}

  /** 与官方 iconButton 同尺寸的 folder 图标（16 视窗、1.5 描边）。 */
  const FOLDER_ICON = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.9 4.2a1.3 1.3 0 0 1 1.3-1.3h2.6l1.4 1.6h5.6a1.3 1.3 0 0 1 1.3 1.3v6.1a1.3 1.3 0 0 1-1.3 1.3H3.2a1.3 1.3 0 0 1-1.3-1.3z"/><path d="M1.9 6.4h12.2"/></svg>'

  let button: HTMLButtonElement | null = null
  let observer: MutationObserver | null = null
  let retry: number | undefined
  let interval: number | undefined
  let attempts = 0
  let disposed = false

  /** 官方右边栏的 tab 条（会话区也有同名 `_tabStrip`，必须按列限定）。 */
  const locateStrip = (): HTMLElement | null => {
    const column = document.querySelector<HTMLElement>('[class*="rightbarCol"]')
    return column?.querySelector<HTMLElement>('[class*="_tabStrip"]') ?? null
  }

  const ensure = (): void => {
    if (disposed) return
    const strip = locateStrip()
    if (strip === null) {
      attempts += 1
      if (attempts < 60) retry = window.setTimeout(ensure, 500)
      return
    }
    attempts = 0
    if (observer === null) {
      observer = new MutationObserver(() => { window.requestAnimationFrame(ensure) })
      observer.observe(document.body, { childList: true, subtree: true })
      interval = window.setInterval(ensure, 2000)
    }
    // 优先放进官方控件簇；没有控件簇时退回 tab 条末尾。
    const host = strip.querySelector<HTMLElement>('[class*="_stripChrome"]') ?? strip
    if (button !== null && button.isConnected && button.parentElement === host) return

    button?.remove()
    button = document.createElement('button')
    button.type = 'button'
    button.dataset.agentlexCaseTab = ''
    button.title = '案件卷宗'
    button.setAttribute('aria-label', '案件卷宗')
    // 与官方 _iconButton 同尺寸/同交互：28×28、圆角、hover 淡底。
    button.style.cssText = [
      'flex:none', 'display:inline-flex', 'align-items:center', 'justify-content:center',
      'width:28px', 'height:28px', 'padding:0', 'border:0', 'border-radius:6px',
      'background:transparent', 'cursor:pointer',
      'color:var(--dsw-alias-label-tertiary, #8a8a94)',
      'transition:background-color 120ms ease, color 120ms ease',
    ].join(';')
    button.innerHTML = FOLDER_ICON
    button.addEventListener('mouseenter', () => {
      button!.style.background = 'var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06))'
      button!.style.color = 'var(--dsw-alias-label-primary, #1a1a1a)'
    })
    button.addEventListener('mouseleave', () => {
      button!.style.background = 'transparent'
      button!.style.color = 'var(--dsw-alias-label-tertiary, #8a8a94)'
    })
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      open()
    })
    if (host === strip) strip.appendChild(button)
    else host.insertBefore(button, host.firstChild)
  }

  ensure()

  return () => {
    disposed = true
    if (retry !== undefined) window.clearTimeout(retry)
    if (interval !== undefined) window.clearInterval(interval)
    observer?.disconnect()
    button?.remove()
    button = null
  }
}

/**
 * 自适应宽度控制器。
 *
 * 目标：**打开右边栏时宽度直接就是对的**（树窄 / 预览宽），不要「先按官方
 * 默认 45% 撑开、再缩进」的闪烁。
 *
 * ⚠ **绝不直接改 frame 的 grid**：宽度只由官方把手的 drag 写进它的 store。
 * 曾为了消掉「首开先按官方 45% 撑开」那一帧，直接把目标宽度写到 frame 的
 * inline `gridTemplateColumns` 上占位 —— 一旦官方 store 没提交，就留下一个
 * 官方不知情的轨道，会话区被挤爆、边栏像覆盖层一样压上来（用户 2026-09-11
 * 实测到的事故）。宁可首帧按官方宽度闪一下，也不越过官方改布局。
 *
 * 用一个**逐帧 settle 循环**统一驱动（比事件/观察者组合稳得多）：
 *   - 宽度 > 0（已展开）且与目标差得远 → 有把手就 drag，没把手就盖 inline；
 *   - 宽度 == 目标 → 收工、摘掉无过渡属性（用户拖拽恢复动画）；
 *   - 超过 1.2s 仍未收敛 → 强制收工，绝不留副作用。
 *
 * 用户亲手拖过把手 → 本次页面加载内不再自动调宽。
 */
function installAdaptiveRightbarWidth(
  sidebarRight: SidebarRightControllerLike,
): { dispose: () => void; refresh: (width?: number) => void; arm: () => void } {
  if (typeof document === 'undefined') return { dispose: () => {}, refresh: () => {}, arm: () => {} }

  let frame: HTMLElement | null = null
  let handle: HTMLElement | null = null
  let observer: MutationObserver | null = null
  let findRetry: number | undefined
  let settleRaf: number | undefined
  let fuse: number | undefined
  let watchTimer: number | undefined
  let findAttempts = 0
  let disposed = false
  let userTookOver = false
  /** 本次「展开」的目标宽度（refresh 时确定）。 */
  let desired: number | null = null
  let settling = false
  /**
   * 上一次收敛完成的时间。
   *
   * 收敛刚完成时，官方 tab 条的「活动 tab」标记可能还没跟上（刚打开的预览
   * tab 尚未写上 active 类），此时若立刻按活动 tab 重新推断，会误判成树类
   * 把宽度又缩回去（实测 800 → 380）。冷却期内不自动重推。
   */
  let settledAt = 0

  /** 官方三列网格容器（收起态也存在）。 */
  const resolveFrame = (): HTMLElement | null => {
    if (frame !== null && frame.isConnected) return frame
    frame = document.querySelector<HTMLElement>('[class*="_frame"]')
    return frame
  }

  /** 官方右边栏把手（**仅展开时存在**）。 */
  const resolveHandle = (): HTMLElement | null => {
    if (handle !== null && handle.isConnected) return handle
    handle = document.querySelector<HTMLElement>('[data-side="rightbar"]')
    if (handle !== null && handle.dataset.agentlexWatched !== '1') {
      handle.dataset.agentlexWatched = '1'
      handle.addEventListener('pointerdown', onUserPointerDown, true)
    }
    return handle
  }

  /** 当前正常轨道里的右边栏宽度（px）；收起/全屏时为 0。 */
  const currentWidth = (): number => {
    const el = resolveFrame()
    if (el === null) return 0
    if (el.hasAttribute('data-rightbar-fullscreen')) return 0
    const column = el.children[2] as HTMLElement | undefined
    const width = column?.getBoundingClientRect().width ?? 0
    return width > 0 && width < 4 ? 0 : width
  }

  /** 视口宽度。 */
  const viewportWidth = (): number => resolveFrame()?.getBoundingClientRect().width ?? window.innerWidth

  /** 当前活动 tab 标题（必须限定在右边栏列内：会话 tab 条也有 _tabActive）。 */
  const activeTabTitle = (): string => {
    const column = resolveFrame()?.querySelector<HTMLElement>('[class*="rightbarCol"]')
    return (column?.querySelector<HTMLElement>('[class*="_tabActive"]')?.innerText ?? '').trim()
  }

  /**
   * 目标宽度：树类 tab → 窄；预览/编辑类 → 视口一半（560–1040）。
   *
   * 再按**当前窗口实际能给的空间**夹一次（官方 `computeColumns` 里中心列最少
   * 保留 400px）：否则窗口窄时目标永远达不到，settle 循环会白转满保险丝时间。
   */
  const computeTarget = (): number => {
    const raw = desired ?? (() => {
      const title = activeTabTitle()
      if (title === '' || TREE_TAB_TITLES.has(title)) return NARROW_WIDTH
      return Math.max(WIDE_MIN, Math.min(WIDE_MAX, Math.round(viewportWidth() * 0.5)))
    })()
    const el = resolveFrame()
    const sidebarPx = Number.parseFloat((el?.style.gridTemplateColumns ?? '').split(' ')[0] ?? '') || 280
    const available = (el?.getBoundingClientRect().width ?? window.innerWidth) - sidebarPx - 400
    if (available <= 0) return raw
    // 官方下限是 300px；给不了就按能给的最大值收敛。
    return Math.max(300, Math.min(raw, Math.floor(available)))
  }

  /** 用把手自己的 drag 流程把宽度写进官方 store（合成 pointer 事件）。 */
  const dragTo = (target: number): void => {
    const h = resolveHandle()
    if (h === null) return
    const rect = h.getBoundingClientRect()
    const startX = rect.left + 2
    const y = rect.top + Math.min(240, Math.max(20, rect.height / 2))
    const make = (type: string, clientX: number, buttons: number): PointerEvent => new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true,
      pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons,
      clientX, clientY: y,
    })
    // 把手在面板左缘：向左拖 = 变窄，故位移 = 当前宽 - 目标宽。
    const delta = currentWidth() - target
    h.dataset.agentlexSelfDrag = '1'
    h.dispatchEvent(make('pointerdown', startX, 1))
    h.dispatchEvent(make('pointermove', startX + delta, 1))
    h.dispatchEvent(make('pointerup', startX + delta, 0))
    window.setTimeout(() => { delete h.dataset.agentlexSelfDrag }, 0)
  }

  /** 用户真的按在把手上（非我们合成）→ 停止自动调宽。 */
  function onUserPointerDown(this: HTMLElement): void {
    if (this.dataset.agentlexSelfDrag === '1') return
    userTookOver = true
    stopSettle()
    disarmInstant()
  }

  /** 关掉宽度过渡（官方属性）——避免中间宽度被动画播出来。 */
  const armInstant = (): void => {
    resolveFrame()?.setAttribute('data-rightbar-instant', '')
  }

  /** 恢复过渡（我们调完了）。 */
  const disarmInstant = (): void => {
    if (fuse !== undefined) { window.clearTimeout(fuse); fuse = undefined }
    resolveFrame()?.removeAttribute('data-rightbar-instant')
  }

  const stopSettle = (): void => {
    settling = false
    if (settleRaf !== undefined) { cancelAnimationFrame(settleRaf); settleRaf = undefined }
  }

  /** 逐帧收敛：没到位就继续调，到位/超时收工。 */
  const settle = (): void => {
    if (disposed || userTookOver) { stopSettle(); disarmInstant(); return }
    const target = computeTarget()
    const width = currentWidth()
    if (width > 0) {
      if (Math.abs(width - target) <= WIDTH_TOLERANCE) {
        desired = null
        settledAt = Date.now()
        stopSettle()
        disarmInstant()
        return
      }
      // ⚠ 宽度**只能**由官方把手写进它的 store。曾试图直接改 frame 的
      //    inline gridTemplateColumns 来消掉首帧，结果在 store 未提交时留下
      //    一个官方不知情的轨道 → 会话区被挤爆 / 边栏盖在会话上。
      //    宁可首帧闪一下官方默认宽度，也绝不越过官方改布局。
      if (resolveHandle() === null) { desired = null; stopSettle(); disarmInstant(); return }
      dragTo(target)
    }
    settleRaf = requestAnimationFrame(settle)
  }

  const startSettle = (): void => {
    if (disposed || userTookOver || settling) return
    settling = true
    armInstant()
    if (fuse !== undefined) window.clearTimeout(fuse)
    // 保险丝：无论如何 1.2s 后收工并恢复过渡，绝不留副作用。
    fuse = window.setTimeout(() => { desired = null; stopSettle(); disarmInstant() }, 1200)
    settleRaf = requestAnimationFrame(settle)
  }

  /**
   * 右边栏即将展开 / 活动 tab 变了：定下目标宽度并开始收敛。
   * @param width - 明确目标（树=窄 / 预览=宽）；省略则按当前活动 tab 推断。
   */
  const refresh = (width?: number): void => {
    if (disposed || userTookOver) return
    desired = width ?? null
    findAttempts = 0
    if (findRetry !== undefined) window.clearTimeout(findRetry)
    findRetry = window.setTimeout(startSettle, 30)
  }

  /**
   * 立刻开始收敛（点官方展开按钮时在 capture 阶段抢先调用）。
   *
   * ⚠ 延后**一帧**再跑：`panel-open` 与 `reveal-request` 是同一个任务里成对
   * 派发的，先到的 panel-open 只 arm、还没拿到 reveal 给的目标宽度；若这里同步
   * 收敛，会先按「当前活动 tab」算出树宽（380）缩一下，下一帧才被纠正成预览宽
   * （800）。等一帧，refresh() 已经把目标写好了，一次到位。
   */
  const arm = (): void => {
    if (disposed || userTookOver) return
    startSettle()
  }

  // 观察官方 frame：宽度写入（展开）与 tab 切换都会改它 / 它的 tab 条。
  const attachObserver = (): void => {
    const el = resolveFrame()
    if (el === null) {
      findAttempts += 1
      if (findAttempts < 60) findRetry = window.setTimeout(attachObserver, 500)
      return
    }
    if (observer === null) {
      observer = new MutationObserver(() => {
        // 活动 tab 变了（树 ↔ 预览）→ 重新收敛到新目标；刚收敛完的冷却期内
        // 不重推（此时官方 tab 条的活动标记可能还没落定）。
        if (!settling && !userTookOver && currentWidth() > 0 && Date.now() - settledAt > 600) startSettle()
      })
      observer.observe(el, { attributes: true, attributeFilter: ['style', 'data-rightbar-fullscreen'] })
      const strip = el.querySelector('[class*="_tabStrip"]')
      if (strip !== null) observer.observe(strip, { attributes: true, subtree: true, attributeFilter: ['class'] })
    }
  }
  attachObserver()

  /**
   * 轻量轮询：活动 tab 变了就把宽度收敛到新目标（树↔预览自适应）。
   *
   * 为什么不只用 MutationObserver：官方 tab 条在增删 tab 时会被整体重建，
   * 挂在旧节点上的观察者随之失效（实测「点文件开了预览 tab、宽度却停在树宽」）。
   * 每 400ms 做一次「读活动 tab + 比较宽度」几乎零成本，但足够稳。
   */
  watchTimer = window.setInterval(() => {
    if (disposed || userTookOver || settling) return
    if (currentWidth() <= 0) return
    if (Date.now() - settledAt < 600) return
    if (Math.abs(currentWidth() - computeTarget()) > WIDTH_TOLERANCE) startSettle()
  }, 400)

  return {
    refresh,
    arm,
    dispose: () => {
      disposed = true
      if (findRetry !== undefined) window.clearTimeout(findRetry)
      if (watchTimer !== undefined) window.clearInterval(watchTimer)
      stopSettle()
      disarmInstant()
      handle?.removeEventListener('pointerdown', onUserPointerDown, true)
      observer?.disconnect()
    },
  }
}

/**
 * 挂载官方右边栏接入：
 *   - 官方原生「文件」页保持原样（我们只在它上面挂右键菜单）；
 *   - 「案件卷宗」作为独立 tab（我们自己的渲染层 + 主题层，外观与自绘右边栏一致），
 *     会话绑定案件 / 项目时自动带上，也能被「在侧边栏打开」定向到任意卷宗；
 *   - 首次打开宽度收窄。
 *
 * 依赖是**可选**的：服务缺席（旧 harness）时返回 null，调用方退回自绘面板。
 *
 * @param ctx - 客户端上下文。
 * @returns disposer；不可用时为 null。
 */
export interface OfficialSidebarOptions {
  /** 「自动打开案件卷宗」：会话绑定案件/项目时，右边栏自动带上卷宗面板。 */
  autoOpenCaseTab?: boolean
}

export function mountOfficialSidebarFiles(ctx: ClientContext, options: OfficialSidebarOptions = {}): (() => void) | null {
  const autoOpenCaseTab = options.autoOpenCaseTab !== false
  const sidebarRight = ctx.get('sidebarRight') as SidebarRightControllerLike | undefined
  const tabs = ctx.get('sidebarRightTabs') as SidebarRightTabRegistryLike | undefined
  if (sidebarRight === undefined || tabs === undefined) return null

  ctxRef.current = ctx

  let disposeType: (() => void) | undefined
  try {
    disposeType = tabs.register({
      id: CASE_FILES_ID,
      kind: CASE_FILES_KIND,
      title: () => '案件卷宗',
      // 刻意**不给引导入口**：官方默认页按「引导入口数」决议——官方 Files 自带
      // 1 个入口 = 默认页是原生文件树；我们再加一个入口会让默认页退化成引导罗盘。
    })
  } catch (error) {
    console.warn('[agentlex-workspace] 案件卷宗 tab 类型注册失败:', error)
    return null
  }

  let disposeBody: (() => void) | undefined
  try {
    const slots = ctx.slots as unknown as {
      register: (options: Record<string, unknown>, component: unknown) => () => void
    }
    disposeBody = slots.register(
      { name: 'sidebar.right.pane.tab', key: CASE_FILES_ID },
      CaseFilesTabBody as never,
    )
  } catch (error) {
    console.warn('[agentlex-workspace] 案件卷宗 tab 正文注册失败:', error)
    disposeType?.()
    return null
  }

  const widthControl = installAdaptiveRightbarWidth(sidebarRight)

  /** 展开右边栏（原生「文件」树就在里面）。 */
  const ensureExpanded = (): void => {
    try {
      if (!sidebarRight.isExpanded()) sidebarRight.toggleExpanded()
    } catch {
      // 没有挂载的会话停靠面（hero 页 / 未选中会话）——忽略。
    }
  }

  /** 打开（或聚焦）「案件卷宗」tab。 */
  const openCaseTab = (): void => {
    // 树类 tab → 窄（在展开前就把宽度定下来）。
    widthControl.refresh(NARROW_WIDTH)
    ensureExpanded()
    try {
      sidebarRight.openTab(CASE_FILES_KIND, {})
    } catch {
      // 无停靠面时忽略。
    }
  }

  /** 直接打开某个绝对路径的 DSH 原生预览（我们不再有自带预览）。 */
  /** 预览/编辑类 tab 的目标宽度（与自适应控制器同一套区间）。 */
  const previewWidthFor = (): number => {
    const viewport = document.querySelector<HTMLElement>('[class*="_frame"]')?.getBoundingClientRect().width ?? window.innerWidth
    return Math.max(WIDE_MIN, Math.min(WIDE_MAX, Math.round(viewport * 0.5)))
  }

  const openNativeResource = (sessionId: string, absolutePath: string): void => {
    try {
      sidebarRight.openResource?.(fileAddress(sessionId, absolutePath))
    } catch (error) {
      console.warn('[agentlex-workspace] 打开原生预览失败:', error)
    }
  }

  /**
   * 把「案件卷宗」静默加进 tab 条：先记当前 active，开完把焦点还回去 ——
   * 绑定案件只是「顺手带上卷宗」，不抢原生「文件」页的焦点。
   */
  const addCaseTabQuietly = (): void => {
    let previousId: string | undefined
    try {
      previousId = sidebarRight.active?.()?.id
    } catch {
      previousId = undefined
    }
    try {
      sidebarRight.openTab(CASE_FILES_KIND, {})
      if (previousId !== undefined) sidebarRight.focus?.(previousId)
    } catch {
      // 无停靠面时忽略。
    }
  }

  // 会话绑定案件/项目 + 右边栏已展开 → 自动带上卷宗 tab（每个会话一次）。
  // 但**「在侧边栏打开」正在打开某个文件时不要抢**：用户要的是直接开那个文件，
  // 不是先冒出卷宗面板（原话「为什么先打开案件卷宗，然后再打开 md」）。
  let revealInFlight = false
  const sessions = ctx.get('sessions') as SessionsLike | undefined
  const addedFor = new Set<string>()
  let syncing = false
  let lastSessionId = ''
  const syncBoundTab = (): void => {
    if (!autoOpenCaseTab || revealInFlight) return
    let sessionId = ''
    try {
      sessionId = sessions?.list?.getSnapshot?.()?.current ?? ''
    } catch {
      sessionId = ''
    }
    if (sessionId !== lastSessionId) {
      lastSessionId = sessionId
      setFolderOverride(null) // 换会话 → 上一案卷宗的显式覆盖失效
    }
    if (sessionId === '' || addedFor.has(sessionId) || syncing) return
    let expanded = false
    try {
      expanded = sidebarRight.isExpanded()
    } catch {
      expanded = false
    }
    if (!expanded) return
    syncing = true
    void import('./bindings.ts')
      .then(async ({ queryBinding }) => {
        const binding = await queryBinding(sessionId)
        if (binding !== null && binding.folder !== null && binding.folder !== '') {
          addedFor.add(sessionId)
          addCaseTabQuietly()
        }
      })
      .catch(() => undefined)
      .finally(() => { syncing = false })
  }
  let unsubscribeSessions: (() => void) | undefined
  try {
    unsubscribeSessions = sessions?.list?.subscribe?.(syncBoundTab)
  } catch {
    unsubscribeSessions = undefined
  }

  // 右边栏开合体现在官方 frame 的属性上——观察它，展开时补一次绑定检查。
  let frameObserver: MutationObserver | null = null
  let frameRetry: number | undefined
  let frameAttempts = 0
  const watchFrame = (): void => {
    const frame = document.querySelector<HTMLElement>("[class*='_frame']")
    if (frame === null) {
      frameAttempts += 1
      if (frameAttempts < 40) frameRetry = window.setTimeout(watchFrame, 500)
      return
    }
    frameObserver = new MutationObserver(syncBoundTab)
    frameObserver.observe(frame, { attributes: true, attributeFilter: ['data-rightbar-collapsed'] })
  }
  watchFrame()

  const onPanelOpen = (): void => {
    // ⚠ 只 arm、**不 refresh**：`panel-open` 与 `reveal-request` 是成对派发的
    // （会话里点文件、详情页「在侧边栏打开」），若这里 refresh() 会把目标重置成
    // 「按当前活动 tab 推断」= 树=窄，抢在 reveal 的宽目标之前先缩一次
    // —— 实测就是这样先 720→380 再 380→800。arm() 不设目标，交给随后的
    // reveal/refresh 决定；单发 panel-open 时按当前 tab 推断也仍然正确。
    widthControl.arm()
    ensureExpanded()
    window.setTimeout(syncBoundTab, 300)
  }

  /**
   * 显式请求一个具体路径（详情页「在侧边栏打开」/ 会话右键「在侧边栏打开」）：
   *   - **目录** → 设成卷宗面板的树根，再打开 tab；
   *   - **文件** → 打开它**所在的目录**并把文件本身送进 DSH 原生预览
   *     （把文件当树根会得到一个空树，用户看不到东西）。
   * 路径不是绝对路径时（会话里常见的裸文件名 `案件信息.md`），先在会话绑定的
   * 案件/项目卷宗里按文件名找，再退回会话工作区。
   */
  /**
   * 显式请求一个具体路径（详情页 / 会话右键「在侧边栏打开」）：
   *   - **目录** → 设为卷宗面板的树根并聚焦它；
   *   - **文件** → **立即**打开 DSH 原生预览（聚焦），并把所在目录静默补成卷宗
   *     面板的根（不抢焦点）。
   *
   * ⚠ 曾经的写法是「先开卷宗面板 → 等 1 秒 → 再开文件」，用户看到的是两段式：
   * 先闪一下卷宗面板，文件才慢一步出来。现在文件预览直接开、卷宗面板静默加，
   * 一步到位、没有等待。
   */
  const onReveal = (event: Event): void => {
    const detail = (event as CustomEvent<{ path?: string; open?: boolean; replayed?: boolean }>).detail
    if (detail === undefined || detail.path === undefined || detail.replayed === true) return
    revealInFlight = true
    window.setTimeout(() => { revealInFlight = false }, 2500)
    // 同步先定宽：拿到路径解析结果前就已经知道「像不像文件」，避免 panel-open
    // 那一侧先按树宽收一下、随后才被纠正（异步解析会晚 10–50ms）。
    if (/\.[A-Za-z0-9]{1,10}$/.test(detail.path)) widthControl.refresh(previewWidthFor())
    void (async () => {
      const resolved = await resolveRevealPath(ctx, detail.path)
      const lastSlash = resolved.lastIndexOf('/')
      const isFileLike = /\.[A-Za-z0-9]{1,10}$/.test(resolved)
      let sessionId = ''
      try {
        sessionId = (ctx.get('sessions') as SessionsLike | undefined)?.list?.getSnapshot?.()?.current ?? ''
      } catch {
        sessionId = ''
      }
      if (isFileLike && lastSlash > 0) {
        // 文件：**只开文件预览**，不顺手开卷宗面板。
        // （之前会先把「案件卷宗」开出来再切走，用户看到「先开卷宗、再开 md」。
        //  卷宗根仍然记下来，用户下次点卷宗 tab 时就是正确的目录。）
        setFolderOverride(resolved.slice(0, lastSlash))
        // 开的是文件预览 → 宽（展开前就定好，避免先按原生 45% 再收/撑）。
        widthControl.refresh(previewWidthFor())
        ensureExpanded()
        openNativeResource(sessionId, resolved)
        return
      }
      setFolderOverride(resolved)
      openCaseTab()
    })()
  }

  window.addEventListener('agentlex-workspace:panel-open', onPanelOpen)
  window.addEventListener('agentlex-workspace:reveal-request', onReveal)

  // 官方「展开右边栏」按钮在自己的会话头角落里 —— 在 capture 阶段抢先禁掉宽度
  // 过渡，这样面板出现的第一帧就是目标宽度（不是先按原生 45% 撑开）。
  const onCaptureClick = (event: MouseEvent): void => {
    const target = event.target as Element | null
    if (target === null || !(target instanceof Element)) return
    if (target.closest("[data-slot='conversation.session.header.corner']") !== null) widthControl.arm()
    if (target.closest('[data-agentlex-case-tab]') !== null) widthControl.arm()
  }
  document.addEventListener('click', onCaptureClick, true)

  const disposeContextMenu = mountNativeTreeContextMenu(ctx)
  // 「案件卷宗」按钮常驻 tab 条：tab 被关掉后还能一键打开（备忘 #30 第 4 条）。
  const disposeCaseButton = mountCaseTabButton(openCaseTab)

  return () => {
    window.removeEventListener('agentlex-workspace:panel-open', onPanelOpen)
    window.removeEventListener('agentlex-workspace:reveal-request', onReveal)
    document.removeEventListener('click', onCaptureClick, true)
    if (frameRetry !== undefined) window.clearTimeout(frameRetry)
    frameObserver?.disconnect()
    unsubscribeSessions?.()
    disposeContextMenu()
    disposeCaseButton()
    widthControl.dispose()
    disposeBody?.()
    disposeType?.()
  }
}
