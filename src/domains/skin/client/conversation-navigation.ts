/**
 * 会话轨迹导航（TurnNavigator）美化与左右切换。
 *
 * DSH 原生 alpha3 在会话视图中新增了「轮次导航」（TurnNavigator，dsh-client-ui-chat
 * 包）：一条固定在右侧的短横轨道，标记每个用户回合，悬停显示预览卡。原生样式朴素，
 * 且固定在右侧不可切换。
 *
 * 本模块用叠加式方案把原生 TurnNavigator 改造成 dsh-codex-timeline 的视觉风格：
 *   1. 轨道透明 —— 去掉任何背景块/圆角/阴影（不画竖线，纯标记轨道）
 *   2. 标记细短横 —— 低对比短横，悬停变宽并形成 39/30/21/15px 分级波动（codex 风格）
 *   3. 预览卡 —— 沿用原生卡片外观（原生已是 10px 圆角/边框/阴影），
 *      内容用 JS 注入「位置 + 时间 + 状态 + 指标 + 两行摘要」匹配 codex-timeline
 *   4. 左右切换 —— 原生用 right 定位，覆盖为 left 即切到左侧；预览卡方向随之适配
 *
 * 数据源（关键）：
 *   原生 TurnNavigator 的预览卡已经渲染了 prompt（用户提问）与 response（模型回答），
 *   标记按钮带 aria-label（"Jump to turn N" / "Load and jump to turn N"）可读回合号。
 *   时间/状态/性能指标由会话数据源（conversation-turn-data.ts）提供，经 getTurnData
 *   注入到预览卡，匹配 codex-timeline 的卡片结构：
 *     - 位置：第 x / y 条
 *     - 时间：该轮开始时刻
 *     - 状态：进行中 / 已完成
 *     - 指标：TTFT · tok/s
 *     - 摘要：两行 prompt + 两行 answer
 *
 * 锚定策略（关键）：
 *   原生 TurnNavigator 的类名是 CSS Modules 哈希（如 eGxaPq_*），升级 DSH 会变化，
 *   不能依赖。但它的 `nav` 元素带 `aria-label`（英文 "Turn navigation" / 中文
 *   "轮次导航"），这是稳定的 DOM 锚点。注意会话区还有面包屑 nav[aria-label=
 *   "Session hierarchy"]，必须精确匹配。内部元素（scroller/marks/mark/preview）
 *   用结构选择器定位（:first-child、> div 等），不依赖哈希类名。
 *
 * 开关：由设置项 conversationNavEnabled 控制（true 启用美化 / false 恢复原生），
 * 位置由 conversationNavPosition 控制（'right' | 'left'）。
 */
import type { TurnPreviewData } from './conversation-turn-data.ts'
import { statusLabel } from './conversation-turn-data.ts'


/** 轨迹导航美化 + 左右切换规则。 */
export const CONVERSATION_NAV_CSS = `
/* ============ 轨道（nav.frame）：透明，去掉背景块/圆角/阴影 ============ */
[data-slot="conversation"] nav[aria-label="Turn navigation"],
[data-slot="conversation"] nav[aria-label="轮次导航"] {
  background: transparent !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  width: 28px;
}

/* ============ 标记（mark）：细短横，低对比，悬停变宽 ============ */
/* 原生 mark 按钮 pointer-events:none，悬停落在父级 markPosition 上，
 * 因此悬停/波动选择器都挂在 markPosition（结构选择器，哈希无关）。 */
[data-slot="conversation"] nav[aria-label="Turn navigation"] button::before,
[data-slot="conversation"] nav[aria-label="轮次导航"] button::before {
  width: 9px;
  height: 3px;
  background: var(--dsw-alias-label-tertiary, #aeb3bf);
  opacity: 0.32;
  border-radius: 2px;
  transition: opacity 0.12s, width 0.12s, background-color 0.12s;
}
[data-slot="conversation"] nav[aria-label="Turn navigation"] > div:first-child > div > div:hover button::before,
[data-slot="conversation"] nav[aria-label="轮次导航"] > div:first-child > div > div:hover button::before,
[data-slot="conversation"] nav[aria-label="Turn navigation"] > div:first-child > div > div:focus-within button::before,
[data-slot="conversation"] nav[aria-label="轮次导航"] > div:first-child > div > div:focus-within button::before {
  opacity: 0.9;
  width: 39px;
  background: var(--dsw-alias-label-primary, #191b1f);
}

/* ============ 分级波动（codex 风格）：悬停标记 39px，邻近 30/21/15px ============ */
/* 原生 markPosition 是 DOM 兄弟，用 :has() 做相邻波动（与哈希无关）。 */
[data-slot="conversation"] nav[aria-label="Turn navigation"] > div:first-child > div > div:has(+ div:hover) button::before,
[data-slot="conversation"] nav[aria-label="轮次导航"] > div:first-child > div > div:has(+ div:hover) button::before,
[data-slot="conversation"] nav[aria-label="Turn navigation"] > div:first-child > div > div:hover + div button::before,
[data-slot="conversation"] nav[aria-label="轮次导航"] > div:first-child > div > div:hover + div button::before {
  width: 30px;
}
[data-slot="conversation"] nav[aria-label="Turn navigation"] > div:first-child > div > div:has(+ div + div:hover) button::before,
[data-slot="conversation"] nav[aria-label="轮次导航"] > div:first-child > div > div:has(+ div + div:hover) button::before,
[data-slot="conversation"] nav[aria-label="Turn navigation"] > div:first-child > div > div:hover + div + div button::before,
[data-slot="conversation"] nav[aria-label="轮次导航"] > div:first-child > div > div:hover + div + div button::before {
  width: 21px;
}
[data-slot="conversation"] nav[aria-label="Turn navigation"] > div:first-child > div > div:has(+ div + div + div:hover) button::before,
[data-slot="conversation"] nav[aria-label="轮次导航"] > div:first-child > div > div:has(+ div + div + div:hover) button::before,
[data-slot="conversation"] nav[aria-label="Turn navigation"] > div:first-child > div > div:hover + div + div + div button::before,
[data-slot="conversation"] nav[aria-label="轮次导航"] > div:first-child > div > div:hover + div + div + div button::before {
  width: 15px;
}

/* ============ 当前回合：主文字色（非主题色），加粗但不过长 ============ */
/* 原生用 markActive 类标记当前回合（CSS Modules 后缀 _markActive），
 * 同时带 aria-current="true"。用类后缀匹配（哈希无关）。 */
[data-slot="conversation"] nav[aria-label="Turn navigation"] button[class$="_markActive"]::before,
[data-slot="conversation"] nav[aria-label="轮次导航"] button[class$="_markActive"]::before,
[data-slot="conversation"] nav[aria-label="Turn navigation"] button[aria-current="true"]::before,
[data-slot="conversation"] nav[aria-label="轮次导航"] button[aria-current="true"]::before {
  background: var(--dsw-alias-label-primary, #191b1f);
  opacity: 0.55;
  width: 9px;
  height: 3px;
}

/* ============ 预览卡：沿用原生样式（原生已是 10px 圆角/边框/阴影/内边距），
 * 不再覆盖背景色（保持原生 bg-layer-1），只增强内容布局。 ============ */

/* ============ 预览卡元信息行（JS 注入）：位置 + 时间 + 状态 ============ */
[data-slot="conversation"] nav[aria-label="Turn navigation"] [role="tooltip"] [data-agentlex-nav-meta],
[data-slot="conversation"] nav[aria-label="轮次导航"] [role="tooltip"] [data-agentlex-nav-meta] {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 5px;
  color: var(--dsw-alias-label-secondary, #5c6370);
  font-size: 12px;
  line-height: 18px;
}
[data-slot="conversation"] nav[aria-label="Turn navigation"] [role="tooltip"] [data-agentlex-nav-meta] strong,
[data-slot="conversation"] nav[aria-label="轮次导航"] [role="tooltip"] [data-agentlex-nav-meta] strong {
  color: var(--dsw-alias-label-primary, #191b1f);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
[data-slot="conversation"] nav[aria-label="Turn navigation"] [role="tooltip"] [data-agentlex-nav-time],
[data-slot="conversation"] nav[aria-label="轮次导航"] [role="tooltip"] [data-agentlex-nav-time] {
  font-variant-numeric: tabular-nums;
}
/* 状态颜色：与参考插件一致（进行中 brand / 已完成 success） */
[data-slot="conversation"] nav[aria-label="Turn navigation"] [role="tooltip"] [data-agentlex-nav-status],
[data-slot="conversation"] nav[aria-label="轮次导航"] [role="tooltip"] [data-agentlex-nav-status] {
  font-variant-numeric: tabular-nums;
}
[data-slot="conversation"] nav[aria-label="Turn navigation"] [role="tooltip"] [data-agentlex-nav-status="open"],
[data-slot="conversation"] nav[aria-label="轮次导航"] [role="tooltip"] [data-agentlex-nav-status="open"] {
  color: var(--dsw-alias-brand-primary, #4a6cf7);
}
[data-slot="conversation"] nav[aria-label="Turn navigation"] [role="tooltip"] [data-agentlex-nav-status="closed"],
[data-slot="conversation"] nav[aria-label="轮次导航"] [role="tooltip"] [data-agentlex-nav-status="closed"] {
  color: var(--dsw-alias-state-success-primary, #2e7d32);
}

/* ============ 预览卡性能指标行（JS 注入）：TTFT · tok/s ============ */
[data-slot="conversation"] nav[aria-label="Turn navigation"] [role="tooltip"] [data-agentlex-nav-metrics],
[data-slot="conversation"] nav[aria-label="轮次导航"] [role="tooltip"] [data-agentlex-nav-metrics] {
  color: var(--dsw-alias-label-secondary, #5c6370);
  font-size: 12px;
  line-height: 18px;
  margin-bottom: 4px;
  font-variant-numeric: tabular-nums;
}

/* ============ 预览卡 prompt/response：两行摘要（codex 风格） ============ */
[data-slot="conversation"] nav[aria-label="Turn navigation"] [role="tooltip"] > div:not([data-agentlex-nav-meta]):not([data-agentlex-nav-metrics]),
[data-slot="conversation"] nav[aria-label="轮次导航"] [role="tooltip"] > div:not([data-agentlex-nav-meta]):not([data-agentlex-nav-metrics]) {
  white-space: pre-line;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  line-height: 20px;
  display: -webkit-box;
  overflow: hidden;
}

/* ============ 左右切换：原生用 right 定位，覆盖为 left 即切到左侧 ============ */
[data-slot="conversation"] nav[aria-label="Turn navigation"][data-agentlex-nav="left"],
[data-slot="conversation"] nav[aria-label="轮次导航"][data-agentlex-nav="left"] {
  right: auto;
  left: calc(12px - (var(--dsh-composer-side-clearance, 16px) + 16px));
}
[data-slot="conversation"] nav[aria-label="Turn navigation"][data-agentlex-nav="right"],
[data-slot="conversation"] nav[aria-label="轮次导航"][data-agentlex-nav="right"] {
  left: auto;
  right: calc(12px - (var(--dsh-composer-side-clearance, 16px) + 16px));
}

/* ============ 预览卡方向适配：右侧轨道→预览卡在左；左侧轨道→预览卡在右 ============ */
/* 右侧轨道（默认）：预览卡在轨道左侧弹出（原生 right 定位） */
[data-slot="conversation"] nav[aria-label="Turn navigation"][data-agentlex-nav="right"] [role="tooltip"],
[data-slot="conversation"] nav[aria-label="轮次导航"][data-agentlex-nav="right"] [role="tooltip"] {
  right: calc(100% + 10px);
  left: auto;
}
/* 左侧轨道：预览卡在轨道右侧弹出（避免被左侧边栏遮住） */
[data-slot="conversation"] nav[aria-label="Turn navigation"][data-agentlex-nav="left"] [role="tooltip"],
[data-slot="conversation"] nav[aria-label="轮次导航"][data-agentlex-nav="left"] [role="tooltip"] {
  left: calc(100% + 10px);
  right: auto;
}

/* ============ 窄屏隐藏（与原生一致，避免挤占正文） ============ */
@media (max-width: 900px) {
  [data-slot="conversation"] nav[aria-label="Turn navigation"],
  [data-slot="conversation"] nav[aria-label="轮次导航"] {
    display: none;
  }
}
`.trim()

/** 轨迹导航位置：'right' 右侧（默认）| 'left' 左侧。 */
export type ConversationNavPosition = 'right' | 'left'

/**
 * 挂载轨迹导航控制：用 MutationObserver 监听 DOM，找到 TurnNavigator 的 `nav`
 * 元素并设置 `data-agentlex-nav` 属性，驱动 CSS 美化与左右切换；同时增强预览卡
 * 内容（注入元信息行：位置 + 时间 + 状态，以及性能指标行）。
 *
 * 数据源：
 *   - 回合号/总数：从标记按钮 aria-label 解析 + 统计标记数量
 *   - prompt/response：直接读取原生预览卡已渲染的文本
 *   - 时间/状态/指标：由 `getTurnData`（会话数据源）提供，匹配参考插件卡片结构
 *
 * @param position 当前轨迹导航位置（'right' | 'left'）
 * @param getTurnData 按回合号读取预览信息（时间/状态/指标）；无数据返回 undefined
 * @returns 清理函数（断开 observer）
 */
export function mountConversationNav(
  position: ConversationNavPosition,
  getTurnData: ((turn: number) => TurnPreviewData | undefined) | undefined = undefined,
): () => void {
  if (typeof document === 'undefined') return () => {}

  /** 当前悬停/聚焦的回合号（从标记 aria-label 解析），用于预览卡元信息行。 */
  let hoveredTurn: number | null = null
  /** 上次已增强的回合号（避免同一回合重复写 DOM）。 */
  let lastEnhancedTurn: number | null = null

  /** 找到会话区域内的 TurnNavigator nav 元素。 */
  const findNav = (): HTMLElement | null => {
    const conversation = document.querySelector('[data-slot="conversation"]')
    if (!conversation) return null
    // TurnNavigator 的 nav 带 aria-label（英文 "Turn navigation" / 中文 "轮次导航"）。
    // 注意：会话区域里还有别的 nav（如面包屑 "Session hierarchy"），必须精确匹配。
    const nav = conversation.querySelector(
      'nav[aria-label="Turn navigation"], nav[aria-label="轮次导航"]',
    )
    return nav instanceof HTMLElement ? nav : null
  }

  /** 给 nav 设置 data-agentlex-nav 属性。 */
  const apply = (): void => {
    const nav = findNav()
    if (nav === null) return
    nav.dataset.agentlexNav = position
  }

  /**
   * 从标记按钮的 aria-label 解析回合号。
   * 原生 aria-label 随 locale 变化：英文 "Jump to turn N" / "Load and jump to turn N"，
   * 中文 "跳转到第 N 轮" / "加载并跳转到第 N 轮"。两种都解析。
   * @param label aria-label 文本
   * @returns 回合号，解析失败返回 null
   */
  const parseTurnFromLabel = (label: string): number | null => {
    // 英文 "turn N" / 中文 "第 N 轮"
    const match = label.match(/turn\s+(\d+)/i) ?? label.match(/第\s*(\d+)\s*轮/)
    return match ? Number(match[1]) : null
  }

  /**
   * 增强预览卡：在 prompt 前维护元信息行（位置 + 时间 + 状态）与性能指标行。
   * 原生 preview 只有 prompt + response；React 复用同一 tooltip 元素，悬停切换时
   * 只更新 prompt/response 子节点，我们注入的元信息行需随之刷新。
   * 数据源：
   *   - 回合号/总数：从标记按钮读取，位置优先悬停标记（hoveredTurn）
   *   - 时间：由 readTurnTime 从 DOM 回合 timeStart 标记读取
   *   - 状态/指标：由 getTurnData（会话数据源）读取
   */
  const enhancePreview = (): void => {
    const nav = findNav()
    if (nav === null) return
    const preview = nav.querySelector('[role="tooltip"]')
    if (preview === null) return
    const promptEl = preview.firstElementChild
    // 若没有原始 prompt 子节点，则无法把元信息插在其前（可能尚未渲染出正文）。
    const hasPromptChild = promptEl !== null

    // 数据源：统计标记总数。
    const marks = nav.querySelectorAll('button')
    const total = marks.length

    // 回合号：优先用悬停/聚焦的标记，否则回退到 active 标记，再回退到最后一个。
    let currentTurn: number | null = hoveredTurn
    if (currentTurn === null) {
      for (const mark of marks) {
        const isActive = mark.getAttribute('aria-current') === 'true'
          || (typeof mark.className === 'string' && mark.className.includes('_markActive'))
        if (isActive) {
          currentTurn = parseTurnFromLabel(mark.getAttribute('aria-label') ?? '')
          break
        }
      }
    }
    if (currentTurn === null && total > 0) {
      const last = marks[total - 1]
      currentTurn = parseTurnFromLabel(last.getAttribute('aria-label') ?? '')
    }

    // 同一回合重复触发（React 流式/观察器频繁回调）时跳过，避免冗余 DOM 写。
    if (currentTurn === lastEnhancedTurn) return
    lastEnhancedTurn = currentTurn

    // 从会话数据源读本轮预览信息（状态/指标）；时间从 DOM 回合标记读取。
    const previewData = currentTurn !== null ? getTurnData?.(currentTurn) : undefined
    const turnTime = readTurnTime(currentTurn, marks)

    // 复用已有元信息行，否则新建；内容按当前回合刷新。
    let meta = preview.querySelector<HTMLDivElement>('[data-agentlex-nav-meta]')
    if (meta === null) {
      meta = document.createElement('div')
      meta.dataset.agentlexNavMeta = ''
      if (hasPromptChild) preview.insertBefore(meta, promptEl)
      else preview.appendChild(meta)
    }
    // 只重建 strong 位置 + 时间 + 状态（避免累积旧 span）。
    meta.textContent = ''
    const strong = document.createElement('strong')
    if (currentTurn !== null && total > 0) {
      strong.textContent = `第 ${currentTurn} / ${total} 条`
    } else if (currentTurn !== null) {
      strong.textContent = `第 ${currentTurn} 条`
    } else {
      strong.textContent = '回合'
    }
    meta.appendChild(strong)
    // 时间（优先 DOM 回合标记，其次数据源）
    const timeText = turnTime || (previewData && previewData.time) || ''
    if (timeText !== '') {
      const time = document.createElement('span')
      time.dataset.agentlexNavTime = ''
      time.textContent = timeText
      meta.appendChild(time)
    }
    // 状态
    if (previewData && previewData.status !== 'unknown') {
      const status = document.createElement('span')
      status.dataset.agentlexNavStatus = previewData.status
      status.textContent = statusLabel(previewData.status)
      meta.appendChild(status)
    }

    // 性能指标行（在元信息行之后、prompt 之前）：复用/新建并刷新。
    let metricsEl = preview.querySelector<HTMLDivElement>('[data-agentlex-nav-metrics]')
    const metricsText = (previewData && previewData.metrics) || ''
    if (metricsText !== '') {
      if (metricsEl === null) {
        metricsEl = document.createElement('div')
        metricsEl.dataset.agentlexNavMetrics = ''
        preview.insertBefore(metricsEl, meta.nextSibling ?? promptEl)
      }
      metricsEl.textContent = metricsText
    } else if (metricsEl !== null) {
      metricsEl.remove()
    }
  }

  /**
   * 从会话 DOM 的回合 timeStart 标记读取某回合开始时间。
   * DSH 会话正文为每个回合渲染 timeStart（如 "12:31"），按回合顺序排列；
   * 与轨迹导航 mark 数组按回合号一一对应（round N ↔ 第 N 个 timeStart）。
   * @param turn 回合号（1-based）
   * @param marks 已收集的标记按钮（用于推算总数兜底）
   * @returns "HH:MM"；无法定位返回空串
   */
  const readTurnTime = (turn: number | null, marks: NodeListOf<HTMLButtonElement>): string => {
    if (turn === null) return ''
    const conversation = document.querySelector('[data-slot="conversation"]')
    if (!conversation) return ''
    const timeStarts = conversation.querySelectorAll('[class*="timeStart"], [class*="time-start"]')
    const idx = turn - 1
    if (idx < 0 || idx >= timeStarts.length) return ''
    const text = (timeStarts[idx].textContent ?? '').trim()
    return text
  }

  /**
   * 监听轨迹导航的 hover/focus，记录当前悬停/聚焦的回合号。
   * 原生 mark 按钮 pointer-events:none，无法直接收 pointerenter；改为在 nav 上监听
   * pointermove，用 elementFromPoint 找到指针下的 markPosition，再读其按钮 aria-label。
   */
  const bindMarkHover = (): void => {
    const nav = findNav()
    if (nav === null) return
    if (nav.dataset.agentlexNavHoverBound === '1') return
    nav.dataset.agentlexNavHoverBound = '1'
    nav.addEventListener('pointermove', (event) => {
      const x = event.clientX
      const y = event.clientY
      const target = document.elementFromPoint(x, y)
      // 向上找最近的 markPosition（含 button 的 div）。
      let el: Element | null = target
      for (let i = 0; el && i < 6; i++) {
        const btn = el.querySelector('button')
        if (btn) {
          hoveredTurn = parseTurnFromLabel(btn.getAttribute('aria-label') ?? '')
          break
        }
        el = el.parentElement
      }
    })
    nav.addEventListener('pointerleave', () => {
      hoveredTurn = null
    })
    // 聚焦：标记按钮 tab 到时可读 aria-label。
    const marks = nav.querySelectorAll('button')
    for (const mark of marks) {
      if (mark.dataset.agentlexNavBound === '1') continue
      mark.dataset.agentlexNavBound = '1'
      mark.addEventListener('focus', () => {
        hoveredTurn = parseTurnFromLabel(mark.getAttribute('aria-label') ?? '')
      })
    }
  }

  apply()
  bindMarkHover()
  enhancePreview()

  // 监听 DOM 变化：TurnNavigator 是 React 渲染的，会话切换/加载时 nav 会重建，
  // 悬停切换时 tooltip 内容以 textContent 更新（characterData），需一并监听。
  const observer = new MutationObserver(() => {
    apply()
    bindMarkHover()
    enhancePreview()
  })
  observer.observe(document.body, { childList: true, characterData: true, subtree: true })

  return () => observer.disconnect()
}
