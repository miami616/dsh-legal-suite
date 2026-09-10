/**
 * AgentLex 圆角卡片（rounded center-column card）。
 *
 * 融合自 dsh-ui-harmonizer 0.8.3 的「圆角卡片」设计（分面绘制模型），
 * 但使用独立类名（agentlex-* / html.agentlex-center-card-on），与
 * harmonizer 的 enhc-center-card-on 互不干扰，可独立开关。
 *
 * 模型：DSH 主内容区是平铺的 --dsw-alias-bg-base 填充，没有真正的卡片面。
 * 本模块非侵入地加「圆角卡片」chrome，不碰任何 harness 源码：
 *
 * - SESSION HEADER（z-21 最高元素）画卡片顶边：inset box-shadow hairline
 *   （不占布局高度，避免 1px 边框把 header 撑高错位）+ 18px 左上圆角，
 *   所以卡片视觉上「包住」header，且没有任何东西能盖住它。
 * - 一个绝对定位的透明盒子（z-20，低于 header 的 21）只投
 *   --dsw-shadow-lv3 阴影（含左侧溢出到侧栏的投影），无边框/圆角 →
 *   无双重描边，header 也不会裁掉阴影。
 * - 无会话 header 的路由（如 trajectory）回退为经典自绘卡片
 *   （border-top + 圆角 + 阴影）。
 *
 * 可见性由 html.agentlex-center-card-on 类控制（设置项翻转），盒子常驻
 * 挂载做几何跟踪，类翻转即开即关。所有副作用归 fiber disposer。
 *
 * 注：harmonizer 用 shell.overlay 槽挂盒子，但当前 harness 的 slots 包
 * （0.1.5-alpha.1）SlotMap 无该槽，故改为手动挂 body + ResizeObserver，
 * 效果等价（绝对定位 + 视口坐标对齐中列）。
 */
/** 圆角卡片 CSS：html.agentlex-center-card-on 门控（独立于 harmonizer）。 */
export const CENTER_CARD_CSS = `
html.agentlex-center-card-on div:has(>:is([data-slot="conversation"], [data-slot="main.conversation"])) {
  border-radius: 18px 0 0;
}
html.agentlex-center-card-on .agentlex-center-card {
  display: block;
}
.agentlex-center-card {
  box-sizing: border-box;
  border-top: 1px solid var(--dsw-alias-border-l2);
  box-shadow: var(--dsw-shadow-lv3);
  pointer-events: none;
  background: transparent;
  border-bottom: none;
  border-left: none;
  border-right: none;
  border-radius: 18px 0 0;
  display: none;
}
html.agentlex-center-card-on .agentlex-center-card-wrapped {
  border-top: none;
  border-radius: 0;
  box-shadow: -20px 10px 36px -18px #0000001c, 0 -10px 26px -16px #0000000f, 16px 26px 42px -22px #00000014;
}
html.agentlex-center-card-on [data-slot="conversation.session.header"] > header {
  box-shadow: inset 0 1px 0 var(--dsw-alias-border-l2);
  border-radius: 18px 0 0;
}
`.trim()

/** 卡片顶边比列顶低 1px，让投影在视口内渲染（贴顶会被裁掉）。 */
const TOP_SHIM = 1

/**
 * 找中列元素：AppFrame 把会话槽包在 div.centerCol 里，槽出口（wrapper 是
 * display:contents）是它的直接 DOM 子节点——哈希无关的稳定接缝。
 */
function findCenterColumn(): HTMLElement | null {
  const slot = document.querySelector(':is([data-slot="conversation"], [data-slot="main.conversation"])')
  if (slot === null) return null
  return slot.parentElement
}

/**
 * 挂载圆角卡片 chrome：一个绝对定位的透明盒子对齐中列，投阴影。
 * 几何用 ResizeObserver（侧栏拖拽/折叠、详情列开合、窗口缩放都触发）+
 * 400ms 慢速 settle 轮询兜底（中列晚挂载时也能跟上）。wrapped 每次测量
 * 重估，路由切换（会话 ↔ trajectory）≤400ms 内翻转绘制模式。
 * @returns disposer 断开观察器并移除盒子。
 */
export function mountCenterCard(): () => void {
  const el = document.createElement('div')
  el.className = 'agentlex-center-card'
  el.style.position = 'absolute'
  el.style.zIndex = '20'
  el.style.pointerEvents = 'none'
  document.body.appendChild(el)

  let timer: number | null = null
  let observed: HTMLElement | null = null
  const observer = new ResizeObserver(measure)

  function measure(): void {
    const col = findCenterColumn()
    if (col === null) return
    if (col !== observed) {
      if (observed !== null) observer.unobserve(observed)
      observer.observe(col)
      observed = col
    }
    const r = col.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return
    const wrapped = document.querySelector("[data-slot='conversation.session.header'] > header") !== null
    el.classList.toggle('agentlex-center-card-wrapped', wrapped)
    el.style.left = `${r.left}px`
    el.style.top = `${r.top + TOP_SHIM}px`
    el.style.width = `${r.width}px`
    el.style.height = `${Math.max(r.height - TOP_SHIM, 0)}px`
  }

  measure()
  window.addEventListener('resize', measure)
  timer = window.setInterval(measure, 400)

  return () => {
    observer.disconnect()
    window.removeEventListener('resize', measure)
    if (timer !== null) window.clearInterval(timer)
    el.remove()
  }
}
