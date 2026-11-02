/**
 * 宿主「全局面板」桥（DSH 0.2.1+ 的 ctx.layout）。
 *
 * 背景：0.2.1 起侧边栏上「插件市场 / 自动化任务 / MediaHub / 更多」这些入口是宿主的
 * **全局面板**——点一行调用 `ctx.layout.selectPanel(id)`，中间列渲染该面板（main 槽），
 * 侧栏那一行随之高亮（`activePanelId`）。
 *
 * 本套件的面板（诉讼/非诉/任务/技能与工具/模拟法庭）是挂在会话列上的覆盖层，并用
 * CSS 把 centerCol 的其它子节点隐藏。两个机制叠在一起会死锁：
 *
 *  1. 打开套件面板时宿主并不知情，`activePanelId` 还是上一次选中的插件面板——侧栏
 *     高亮是假的，看上去「插件市场」是选中态；
 *  2. 用户再点那一行，`selectPanel(同一个 id)` 不产生状态变化，壳不重渲染；套件的
 *     覆盖层又不关闭 → 点了毫无反应，只能先点「新建任务」把壳的选择清掉再点。
 *
 * 这里把两边接上：
 *  - `clearShellPanel()`：套件面板打开时把宿主面板选择清成 null（高亮与真实视图一致，
 *    也让「再点同一行」重新变成一次有效状态变化）；
 *  - `onShellPanelChange()`：用户点了任意全局面板时回调，套件面板据此自行关闭，把
 *    中间列交还给宿主。
 *
 * 跨版本兼容：宿主 0.1.x 的 `layout` 只有 toggleSidebar/openDetails/closeDetails，
 * 这里全部按能力探测，缺 `selectPanel` / `panelInfo` 时整条链路静默降级为无操作。
 */
import { serviceOf } from './dsh-services.ts'

/** 宿主面板选择的只读面（结构等价于宿主的 HostObservable<PanelInfo>）。 */
interface PanelInfoFace {
  activePanelId?: unknown
}

/** `ctx.layout` 的能力子集：只声明本模块真的会用的两项。 */
interface LayoutFace {
  selectPanel?: (panelId: string | null) => void
  panelInfo?: {
    getSnapshot?: () => PanelInfoFace | undefined
    subscribe?: (listener: () => void) => unknown
  }
}

type PanelChangeListener = (panelId: string | null) => void

/** 已绑定的 layout 服务（可能晚到，由 retry 补绑）。 */
let layout: LayoutFace | undefined
/** 最近一次观察到的宿主面板 id（null = 会话视图）。 */
let lastPanelId: string | null = null
/** 面板变化订阅者。 */
const listeners = new Set<PanelChangeListener>()
/** 是否已经启动绑定流程（幂等）。 */
let binding = false
/** 绑定重试定时器。 */
let retryTimer: ReturnType<typeof setTimeout> | undefined
/** 重试次数上限（~30s；宿主 layout 服务通常在毫秒级就绪）。 */
const RETRY_LIMIT = 40

/** 读当前宿主面板 id；不是字符串（含 null/undefined）一律当作「会话视图」。 */
function currentPanelId(): string | null {
  try {
    const id = layout?.panelInfo?.getSnapshot?.()?.activePanelId
    return typeof id === 'string' && id !== '' ? id : null
  } catch {
    return null
  }
}

/** 通知订阅者（订阅者异常不得打断其他订阅者）。 */
function emit(panelId: string | null): void {
  for (const listener of listeners) {
    try {
      listener(panelId)
    } catch (error) {
      console.warn('[agentlex] shell panel listener failed:', error)
    }
  }
}

/** 挂上宿主 layout 服务并订阅其面板选择变化。 */
function attach(candidate: LayoutFace | undefined): void {
  if (candidate === undefined) return
  layout = candidate
  lastPanelId = currentPanelId()
  const panelInfo = candidate.panelInfo
  if (panelInfo?.subscribe === undefined) return
  try {
    panelInfo.subscribe(() => {
      const next = currentPanelId()
      if (next === lastPanelId) return
      lastPanelId = next
      emit(next)
    })
  } catch (error) {
    console.warn('[agentlex] shell panel subscribe failed:', error)
  }
}

/**
 * 启动绑定（幂等）：先立即解析 `layout`，取不到就退避重试。
 * @param ctx - 任意 cordis 客户端上下文（各域的 apply 里拿到的那个）。
 */
export function initShellPanelBridge(ctx: unknown): void {
  if (binding) return
  binding = true
  let attempts = 0
  const tryBind = (): void => {
    if (layout !== undefined) return
    const candidate = serviceOf<LayoutFace>(ctx, 'layout')
    if (candidate !== undefined && (candidate.selectPanel !== undefined || candidate.panelInfo !== undefined)) {
      attach(candidate)
      return
    }
    attempts += 1
    if (attempts >= RETRY_LIMIT) return
    retryTimer = setTimeout(tryBind, attempts < 8 ? 150 : 1000)
    // 客户端的定时器不得阻止页面卸载判定。
    ;(retryTimer as unknown as { unref?: () => void }).unref?.()
  }
  tryBind()
}

/** 停止绑定重试（模块卸载时用；面板状态本身没有需要回收的资源）。 */
export function disposeShellPanelBridge(): void {
  if (retryTimer !== undefined) clearTimeout(retryTimer)
  retryTimer = undefined
  binding = false
  layout = undefined
}

/**
 * 清掉宿主上已选中的全局面板（回到会话视图）。
 *
 * 套件面板打开时调用：不这么做的话宿主仍认为某个插件面板处于选中态，侧栏高亮是
 * 假的，而且再点同一行不会有任何状态变化。
 */
export function clearShellPanel(): void {
  if (layout?.selectPanel === undefined) return
  if (currentPanelId() === null) return
  try {
    layout.selectPanel(null)
  } catch (error) {
    console.warn('[agentlex] clearing shell panel failed:', error)
  }
}

/**
 * 订阅宿主面板选择变化。回调只在该值**真的变化**时触发。
 * @param listener - 收到新的面板 id（null 表示回到会话视图）。
 * @returns 取消订阅函数。
 */
export function onShellPanelChange(listener: PanelChangeListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
