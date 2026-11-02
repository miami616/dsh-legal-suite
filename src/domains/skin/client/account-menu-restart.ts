/**
 * 账号菜单里的「重启 DSH」入口。
 *
 * 为什么走 DOM 注入而不是 slots：底部头像弹出的账号菜单由宿主的
 * `@deepseek-ai/dsh-client-ui-settings-account` 渲染，它**没有对外声明任何槽位**
 * （设置 / 意见反馈 / 退出登录 三项写死在自己的组件里），第三方插件无法用
 * `ctx.slots.register` 往里加一行。这里在菜单出现时克隆「退出登录」那一行的 DOM
 * ——连宿主自己的 class 一起复制，所以宿主换主题、换类名前缀也不会掉样式——
 * 在它上方插入一行「重启 DSH」。
 *
 * 重启动作走套件已有的宿主端点 `POST /api/agentlex-case/plugin-restart`
 * （`src/domains/litigation/updater.ts` 的 `restartDshProcess`）：常规 CLI 模式下
 * 派生一个参数相同的 detached 子进程接管，再退出当前进程；随后本模块轮询宿主
 * 恢复并刷新页面，让浏览器加载新版本的客户端 bundle。
 */
import { errorMessage } from '../../../shared/error-message.ts'

/** 账号菜单容器（宿主 Menu 原语渲染出的 portal 根）。 */
const MENU_SELECTOR = 'div[role="menu"]'
/** 菜单项按钮。 */
const ITEM_SELECTOR = 'button[role="menuitem"]'
/** 用来作为克隆模板的那一项（菜单最末项）。 */
const TEMPLATE_LABEL = '退出登录'
/** 新插入项的标签。 */
const RESTART_LABEL = '重启 DSH'
/** 标记：避免重复插入 / 便于清理。 */
const ITEM_ATTR = 'data-agentlex-restart-menu-item'
/** 重启端点（沿用插件更新链路里的自重启）。 */
const RESTART_ENDPOINT = '/api/agentlex-case/plugin-restart'
/** 给宿主进程留出的退出时间，之后才开始探测它是否回来。 */
const REVIVE_GRACE_MS = 2600
/** 探测恢复的上限；超时提示用户手工重启。 */
const REVIVE_TIMEOUT_MS = 45000

/** 重启请求的响应信封（宿主统一格式）。 */
interface Envelope {
  success?: boolean
  data?: { ok?: boolean; scheduled?: boolean }
  error?: string
}

/** 极简 sleep。 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/* ───────────────────────────── toast ───────────────────────────── */

let toastElement: HTMLDivElement | undefined

/**
 * 在视口底部显示一条提示（幂等：重复调用只改文案）。
 * @param text - 提示文案。
 * @param tone - neutral 进行中 / error 失败。
 */
function showToast(text: string, tone: 'neutral' | 'error' = 'neutral'): void {
  if (typeof document === 'undefined') return
  if (toastElement === undefined || !toastElement.isConnected) {
    const element = document.createElement('div')
    element.setAttribute('data-agentlex-toast', '')
    element.setAttribute('role', 'status')
    element.style.cssText = [
      'position:fixed',
      'left:50%',
      'bottom:34px',
      'transform:translateX(-50%)',
      'z-index:2147483000',
      'max-width:min(560px,calc(100vw - 48px))',
      'padding:11px 18px',
      'border-radius:12px',
      'box-shadow:0 12px 34px rgba(0,0,0,.20)',
      'font:500 13px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif',
      'text-align:center',
      'pointer-events:none',
      'transition:opacity .18s ease',
    ].join(';')
    document.body.appendChild(element)
    toastElement = element
  }
  toastElement.textContent = text
  toastElement.style.background = tone === 'error'
    ? 'var(--dsw-alias-state-error-primary, #c4320a)'
    : 'var(--dsw-alias-bg-elevated, #1f1f1f)'
  toastElement.style.color = tone === 'error'
    ? '#ffffff'
    : 'var(--dsw-alias-label-primary-inverted, #ffffff)'
  toastElement.style.border = '1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.10))'
}

/** 收起提示。 */
function hideToast(): void {
  toastElement?.remove()
  toastElement = undefined
}

/* ─────────────────────────── 重启流程 ─────────────────────────── */

/** 请求宿主自重启；失败抛出带宿主原因的 Error。 */
async function requestHostRestart(): Promise<void> {
  const response = await fetch(RESTART_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: '{}',
  })
  if (response.status === 501) {
    throw new Error('宿主未挂载重启能力（plugin restart not mounted）')
  }
  let envelope: Envelope
  try {
    envelope = await response.json() as Envelope
  } catch {
    throw new Error(`宿主返回了非 JSON 响应（${response.status}）`)
  }
  if (envelope.success !== true) throw new Error(envelope.error ?? `重启请求失败（${response.status}）`)
  if (envelope.data?.ok === false) throw new Error('宿主拒绝了重启请求')
}

/** 轮询宿主是否已经回来；回来后刷新页面加载新版本客户端。 */
async function waitForHostAndReload(): Promise<boolean> {
  await sleep(REVIVE_GRACE_MS)
  const deadline = Date.now() + REVIVE_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const response = await fetch('/', { method: 'GET', cache: 'no-store' })
      if (response.ok) {
        window.location.reload()
        return true
      }
    } catch {
      /* 宿主还在重启，继续等 */
    }
    await sleep(900)
  }
  return false
}

/** 「重启 DSH」的完整交互：确认 → 请求 → 提示 → 等待恢复 → 刷新。 */
async function restartHost(): Promise<void> {
  const confirmed = window.confirm('重启 DeepSeek Harness？正在运行的任务会被中断，重启完成后页面会自动刷新。')
  if (!confirmed) return
  showToast('正在重启 DeepSeek Harness…')
  try {
    await requestHostRestart()
  } catch (error) {
    showToast(`重启失败：${errorMessage(error)}`, 'error')
    setTimeout(() => hideToast(), 6000)
    return
  }
  const revived = await waitForHostAndReload()
  if (!revived) {
    showToast('重启后未能连上宿主：请在终端重新启动 dsh', 'error')
    setTimeout(() => hideToast(), 12000)
  }
}

/* ─────────────────────────── 菜单注入 ─────────────────────────── */

/** 菜单项文字（去掉快捷键等附属节点的空白）。 */
function itemLabel(item: HTMLElement): string {
  return (item.textContent ?? '').replace(/\s+/g, '')
}

/** 在账号菜单里找到「退出登录」那一项。 */
function findTemplateItem(menu: HTMLElement): HTMLButtonElement | undefined {
  for (const item of menu.querySelectorAll<HTMLButtonElement>(ITEM_SELECTOR)) {
    if (item.closest(`[${ITEM_ATTR}]`) !== null) continue
    if (itemLabel(item) === TEMPLATE_LABEL) return item
  }
  return undefined
}

/** 重启图标（16×16，描边继承 currentColor，与宿主菜单图标同规格）。 */
function createRestartIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('width', '16')
  svg.setAttribute('height', '16')
  svg.setAttribute('viewBox', '0 0 16 16')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('stroke-width', '1.3')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', 'M13 8a5 5 0 1 1-1.72-3.79')
  path.setAttribute('stroke', 'currentColor')
  path.setAttribute('stroke-linecap', 'round')
  path.setAttribute('stroke-linejoin', 'round')
  const head = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  head.setAttribute('d', 'M13.2 2.6v2.6h-2.6')
  head.setAttribute('stroke', 'currentColor')
  head.setAttribute('stroke-linecap', 'round')
  head.setAttribute('stroke-linejoin', 'round')
  svg.append(path, head)
  return svg
}

/**
 * 克隆「退出登录」那一行，改造成「重启 DSH」并插在它上面。
 * @param template - 克隆模板（菜单项按钮）。
 * @returns 插入的容器，失败返回 undefined。
 */
function insertRestartItem(template: HTMLButtonElement): HTMLElement | undefined {
  const wrap = template.parentElement
  const list = wrap?.parentElement
  if (wrap === null || wrap === undefined || list === null || list === undefined) return undefined
  const clone = wrap.cloneNode(true) as HTMLElement
  clone.setAttribute(ITEM_ATTR, '')
  const button = clone.querySelector<HTMLButtonElement>('button')
  if (button === null) return undefined
  button.removeAttribute('aria-keyshortcuts')
  button.removeAttribute('aria-expanded')
  button.removeAttribute('aria-haspopup')
  button.removeAttribute('aria-checked')
  button.style.pointerEvents = 'auto'
  // 文案：只改标签节点，别动图标/快捷键容器。
  const labelNode = [...button.querySelectorAll('span')].find((node) => (node.textContent ?? '').replace(/\s+/g, '') === TEMPLATE_LABEL)
  if (labelNode !== undefined) labelNode.textContent = RESTART_LABEL
  else button.setAttribute('aria-label', RESTART_LABEL)
  // 图标：换成本模块自己的重启图形。
  const iconSlot = button.querySelector('svg')?.parentElement
  if (iconSlot !== null && iconSlot !== undefined) {
    iconSlot.replaceChildren(createRestartIcon())
  } else if (labelNode !== undefined) {
    labelNode.parentElement?.prepend(createRestartIcon())
  }
  button.addEventListener('click', (event) => {
    event.preventDefault()
    // 菜单自身没有这一项，点完把菜单收起来（宿主 Menu 用 Esc 关闭）。
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    void restartHost()
  })
  list.insertBefore(clone, wrap)
  return clone
}

/** 扫描页面上的账号菜单；缺「重启 DSH」就补上。 */
function syncMenus(): void {
  for (const menu of document.querySelectorAll<HTMLElement>(MENU_SELECTOR)) {
    if (menu.querySelector(`[${ITEM_ATTR}]`) !== null) continue
    const template = findTemplateItem(menu)
    if (template === undefined) continue
    try {
      insertRestartItem(template)
    } catch (error) {
      console.warn('[agentlex-skin] account menu restart item failed:', error)
    }
  }
}

/**
 * 挂载「重启 DSH」菜单项（观察账号菜单的开合）。
 * @returns 卸载函数：断开观察器并清掉已插入的项与提示。
 */
export function mountAccountMenuRestart(): () => void {
  if (typeof document === 'undefined') return () => {}
  syncMenus()
  const observer = new MutationObserver(() => { syncMenus() })
  observer.observe(document.body, { childList: true, subtree: true })
  return () => {
    observer.disconnect()
    for (const node of document.querySelectorAll(`[${ITEM_ATTR}]`)) node.remove()
    hideToast()
  }
}
