/**
 * dsh-legal-suite 浏览器端适配核对脚本。
 *
 * 依赖 playwright-core（不下载浏览器，直接驱动本机 Chrome）：
 *   mkdir -p /tmp/pw && cd /tmp/pw && npm init -y && npm i playwright-core
 *   cp <repo>/scripts/verify-web.mjs /tmp/pw/ && cd /tmp/pw && node verify-web.mjs <port> <token> [label]
 *
 * 断言：composer [data-lexical-editor]、中心列 [class*="centerCol"]、4 个侧边栏入口、
 *       style[data-agentlex-skin]、面板 [data-dsh-litigation-view] 挂载与 data-dsh-litigation-active、
 *       console.error / pageerror 为 0。token 在 dsh 启动日志的 dsh web: URL 里。
 */
/**
 * dsh-legal-suite 适配验证脚本（alpha / rc.2 通用）。
 * 用法：node verify.mjs <port> <token> [label]
 */
import { chromium } from 'playwright-core'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const port = process.argv[2] ?? '3082'
const token = process.argv[3] ?? ''
const label = process.argv[4] ?? `port-${port}`
const url = `http://127.0.0.1:${port}/?token=${token}`

const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const consoleErrors = []
const pageErrors = []
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300))
})
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)))

const report = { label, port, steps: {} }

await page.goto(url, { waitUntil: 'domcontentloaded' })
try {
  await page.waitForSelector('[data-lexical-editor]', { timeout: 25000 })
  report.steps.composer = 'ok'
} catch {
  report.steps.composer = 'missing'
}
await page.waitForTimeout(3500)

report.anchors = await page.evaluate(() => {
  const q = (s) => !!document.querySelector(s)
  const n = (s) => document.querySelectorAll(s).length
  return {
    lexicalEditor: n('[data-lexical-editor]'),
    centerCol: q('[class*="centerCol"]'),
    paneConversation: q('[data-pane="conversation"]'),
    sidebarCol: q('[class*="sidebarCol"]'),
    newSession: q('[class*="newSession"]'),
    titleCluster: q('[class$="_titleCluster"]'),
    convHeaderTabs: q('[data-slot="conversation.session.header"] [class$="_tabs"]'),
    conversationSlot: n('[data-slot="conversation"], [data-slot="main.conversation"]'),
    bodyClass: n('[class$="_body"]'),
  }
})

report.pluginEntries = await page.evaluate(() => ({
  litigation: !!document.querySelector('[data-dsh-litigation-entry]'),
  nonlitigation: !!document.querySelector('[data-dsh-nonlitigation-entry]'),
  task: !!document.querySelector('[data-dsh-task-entry]'),
  skills: !!document.querySelector('[data-agentlex-skills-entry]'),
  skinStyles: document.querySelectorAll('style[data-agentlex-skin]').length,
  brandText: (document.body.innerText.match(/AgentLex|超级律师助理|诉讼案件|非诉项目|任务中心/g) ?? []).slice(0, 8),
}))

// 打开诉讼面板，验证 DOM 挂载 + 会话列共存
try {
  await page.evaluate(() => document.querySelector('[data-dsh-litigation-entry]')?.click())
  await page.waitForTimeout(2500)
  report.panel = await page.evaluate(() => {
    const view = document.querySelector('[data-dsh-litigation-view]')
    const st = view ? getComputedStyle(view) : null
    return {
      exists: !!view,
      visible: st ? st.display !== 'none' && st.visibility !== 'hidden' : false,
      activeAttr: document.documentElement.hasAttribute('data-dsh-litigation-active'),
      innerTextHead: view ? view.innerText.slice(0, 120) : '',
      conversationColumnAlive: !!document.querySelector('[class*="centerCol"], [data-pane="conversation"]'),
    }
  })
} catch (e) {
  report.panel = { error: String(e).slice(0, 200) }
}

// composer 排版契约（皮肤域 CSS 覆盖是否生效）
report.composerStyle = await page.evaluate(() => {
  const p = document.querySelector('[data-lexical-editor] p')
  if (!p) return null
  const st = getComputedStyle(p)
  return { margin: st.margin, textAlign: st.textAlign, letterSpacing: st.letterSpacing, fontSize: st.fontSize, lineHeight: st.lineHeight }
})

report.consoleErrors = consoleErrors.slice(0, 12)
report.pageErrors = pageErrors.slice(0, 6)

await page.screenshot({ path: `/tmp/pw/shot-${port}.png`, fullPage: false })
await browser.close()
console.log(JSON.stringify(report, null, 2))
