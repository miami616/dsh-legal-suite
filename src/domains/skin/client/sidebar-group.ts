/**
 * AgentLex 侧栏组注入：自绘新会话药丸按钮 + AgentLex 扩展折叠菜单。
 *
 * 借鉴 dsh-codex-ui 的「扩展」折叠菜单结构（菜单按钮 + caret + 子项区）：
 *  - 新任务按钮为无背景文字菜单行（与 codex-ui 的「新任务」一致），
 *    与「AgentLex」菜单项并列；原生 newSession 按钮保留原样但被 CSS
 *    隐藏，点击时转发给原生按钮；
 *  - 「AgentLex」菜单项（带 caret）展开后收纳诉讼/非诉/任务三个入口行
 *    （由各模块插件注入），折叠状态持久化到 localStorage。
 *
 * 全部为 DOM 注入（不碰 sidebar 插槽），随皮肤开关卸载；入口行被移入
 * 子项区后仍在原生侧栏 root 内，各插件自愈逻辑不会重复插入。
 */

export const AGENTLEX_GROUP_ATTR = 'data-agentlex-group'
export const AGENTLEX_GROUP_ITEMS_ATTR = 'data-agentlex-group-items'
export const AGENTLEX_NEW_SESSION_ATTR = 'data-agentlex-new-session'

/** 组内入口行顺序（诉讼 / 非诉 / 任务；技能与工具为组外兄弟行，不收纳）。 */
const ENTRY_SELECTORS = [
  '[data-dsh-litigation-entry]',
  '[data-dsh-nonlitigation-entry]',
  '[data-dsh-task-entry]',
] as const

const STORAGE_KEY = 'agentlex-skin:group-open'

const CHAT_ICON = '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.8 3h10.4a1 1 0 0 1 1 1v6.2a1 1 0 0 1-1 1H7.4L4 13.8v-2.6H2.8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/></svg>'
const GRID_ICON = '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="2.5" y="2.5" width="4.6" height="4.6" rx="1.1"/><rect x="8.9" y="2.5" width="4.6" height="4.6" rx="1.1"/><rect x="2.5" y="8.9" width="4.6" height="4.6" rx="1.1"/><rect x="8.9" y="8.9" width="4.6" height="4.6" rx="1.1"/></svg>'
const CARET_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 4 4 4-4 4"/></svg>'

/** 原生侧栏 root（与 sidebar-entry-core 同一套探测）。 */
function sidebarRoot(): HTMLElement | undefined {
  const column = document.querySelector<HTMLElement>('[data-pane="sidebar"], [class*="sidebarCol"]')
  if (column === null) return undefined
  const logoOwner = column.querySelector<HTMLElement>('[class*="logoRow"]')?.parentElement
  return logoOwner ?? (column.firstElementChild as HTMLElement | undefined)
}

/**
 * 注入新会话药丸按钮 + AgentLex 折叠菜单，并持续把三个业务入口行
 * 收纳进菜单子项区。
 * @returns disposer 移除全部注入的 DOM 与观察器。
 */
export function mountAgentLexSidebarGroup(): () => void {
  if (typeof document === 'undefined') return () => {}
  if (document.querySelector(`[${AGENTLEX_GROUP_ATTR}]`) !== null) return () => {}

  // ── 新会话药丸按钮（点击转发给原生按钮，保留原生行为） ──
  const newSession = document.createElement('button')
  newSession.type = 'button'
  newSession.setAttribute(AGENTLEX_NEW_SESSION_ATTR, '')
  newSession.setAttribute('aria-label', '新建任务')
  newSession.innerHTML = CHAT_ICON + '<span>新建任务</span>'
  newSession.addEventListener('click', () => {
    document.querySelector<HTMLButtonElement>('[class*="newSession"]')?.click()
  })

  // ── AgentLex 折叠菜单：按钮 + caret + 子项容器 ──
  const open = (() => {
    try { return localStorage.getItem(STORAGE_KEY) !== '0' } catch { return true }
  })()
  const group = document.createElement('button')
  group.type = 'button'
  group.setAttribute(AGENTLEX_GROUP_ATTR, '')
  group.setAttribute('aria-expanded', String(open))
  // 插件模组名统一全大写（AGENTLEX）。
  group.innerHTML = GRID_ICON + '<span class="agentlex-group-label">AGENTLEX</span>'
  const caret = document.createElement('span')
  caret.className = 'agentlex-group-caret'
  caret.innerHTML = CARET_ICON
  caret.setAttribute('aria-hidden', 'true')
  group.appendChild(caret)

  const inner = document.createElement('div')
  inner.className = 'agentlex-group-inner'
  const items = document.createElement('div')
  items.setAttribute(AGENTLEX_GROUP_ITEMS_ATTR, '')
  items.dataset.open = String(open)
  items.appendChild(inner)
  group.addEventListener('click', () => {
    const next = items.dataset.open !== 'true'
    items.dataset.open = String(next)
    group.setAttribute('aria-expanded', String(next))
    try { localStorage.setItem(STORAGE_KEY, next ? '1' : '0') } catch { /* ignore */ }
  })

  // ── 等待侧栏 root 出现后插入（品牌区之后） ──
  let root: HTMLElement | undefined
  let placed = false

  // ── 把三个业务入口行持续收纳进子项区，并固定顺序（诉讼→非诉→任务） ──
  // 限流闸：第三方插件（实测 dsh-session-surgeon）也会观察并改写侧边栏
  // DOM——其插回操作会触发本观察器，本函数的移动又反过来触发对方，形成
  // 「移动→触发→移动」的高频互殴（实测主线程 100% 卡死）。每次真实移动
  // 后 400ms 内不再移动，切断反馈环；互殴平息后最后一次移动仍会收敛。
  let lastCollectMoveAt = 0
  const collect = (): void => {
    if (!inner.isConnected) return
    const now = Date.now()
    if (now - lastCollectMoveAt < 400) return
    let moved = false
    for (const selector of ENTRY_SELECTORS) {
      const el = document.querySelector<HTMLElement>(selector)
      // 收纳：只移动「不在 inner」的入口行（appendChild 会触发 mutation）
      if (el !== null && el.parentElement !== inner) {
        inner.appendChild(el)
        moved = true
      }
    }
    // 固定顺序（幂等）：仅在「当前位置不正确」时移动——
    // appendChild/insertBefore 对已存在的子节点也是一次 DOM 改动，
    // 无条件调用会不断触发本观察器，造成「移动→触发→移动」死循环。
    for (let i = 0; i < ENTRY_SELECTORS.length && i < inner.children.length; i++) {
      const el = document.querySelector<HTMLElement>(ENTRY_SELECTORS[i])
      if (el !== null && el.parentElement === inner && inner.children[i] !== el) {
        inner.insertBefore(el, inner.children[i])
        moved = true
      }
    }
    if (moved) lastCollectMoveAt = now
  }

  const tryPlace = (): void => {
    if (root !== undefined && !root.isConnected) { root = undefined; placed = false }
    if (placed) {
      // 折叠/展开时原生 React 会重建侧栏 DOM，注入元素可能被移走/丢失；
      // 元素不在 DOM 内则重新插入（并重新收纳入口行，恢复图标样式）。
      if (root !== undefined && root.contains(newSession) && root.contains(group) && root.contains(items)) {
        collect()
        return
      }
      placed = false
    }
    // 与 collect 共用限流节奏：元素被第三方插件移走/重建时，重新插入同样
    // 会触发对方观察器——300ms 内不重复插入，避免高频互殴。
    if (Date.now() - lastCollectMoveAt < 300) return
    root ??= sidebarRoot()
    if (root === undefined) return
    const logoRow = root.querySelector<HTMLElement>('[class*="logoRow"]')
    const anchor = logoRow?.nextElementSibling ?? root.firstElementChild
    if (anchor === null || anchor === undefined) return
    root.insertBefore(newSession, anchor)
    newSession.after(group)
    group.after(items)
    placed = true
    lastCollectMoveAt = Date.now()
    collect()
  }
  const waitObserver = new MutationObserver(tryPlace)
  waitObserver.observe(document.body, { childList: true, subtree: true })

  const collectObserver = new MutationObserver(collect)
  collectObserver.observe(document.body, { childList: true, subtree: true })

  tryPlace()

  // ── 启动期兜底轮询：三个业务入口行由各域插件异步渲染，可能晚于本组
  //    插入才出现在 DOM 里。MutationObserver 虽能感知，但 400ms 限流闸在
  //    入口行密集出现时会把后续移动压掉，导致子项长时间停留在「技能和
  //    工具」下方、甚至要手动点击分组才归位。这里在挂载后前 6 秒内每
  //    200ms 主动 collect() 一次，确保入口行一出现就尽快收进 AGENTLEX 组；
  //    6 秒后停止轮询，交给 MutationObserver 常态接管。──
  const settleTimer = window.setInterval(() => {
    if (!inner.isConnected) return
    collect()
  }, 200)
  window.setTimeout(() => window.clearInterval(settleTimer), 6000)

  return () => {
    window.clearInterval(settleTimer)
    waitObserver.disconnect()
    collectObserver.disconnect()
    newSession.remove()
    group.remove()
    items.remove()
  }
}