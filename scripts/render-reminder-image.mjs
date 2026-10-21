#!/usr/bin/env node
/**
 * 把「今日提醒」渲染成一张 PNG：HTML 模板 → 无头浏览器截图。
 *
 * 为什么用 HTML 而不是 PIL/Canvas：
 *  - 版式用 CSS 调，行高、字体、换行、分隔线都可控；
 *  - 同一份模板既能截图，也能在浏览器里直接打开预览；
 *  - 后续接飞书图片消息时，只需要把这里产出的 PNG 上传。
 *
 * 用法：
 *   node scripts/render-reminder-image.mjs
 *   node scripts/render-reminder-image.mjs --now "2026-10-21 08:00" --out /tmp/today.png
 *   node scripts/render-reminder-image.mjs --html /tmp/today.html   # 同时保留可打开的 HTML
 *
 * 依赖：playwright CLI（本机已装）或 Google Chrome。都没有时只产出 HTML。
 */

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createPushStore } from '../lib/domains/push/store/push-config.js'
import { previewReminderPlan } from '../lib/domains/push/push.js'

/** 解析 --key value / --flag。 */
function argsOf(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next
      i++
    } else {
      out[key] = true
    }
  }
  return out
}

const args = argsOf(process.argv.slice(2))
const home = process.env.DSH_HOME ?? join(process.env.HOME ?? '.', '.dsh')
const dataDir = join(home, 'agentlex')
const outPng = resolve(args.out ?? join(process.cwd(), 'docs/提醒样张-图片版.png'))
const htmlPath = args.html !== undefined ? resolve(String(args.html)) : join(mkdtempSync(join(tmpdir(), 'reminder-card-')), 'reminder.html')
let now = args.now !== undefined ? new Date(String(args.now).replace(' ', 'T')).getTime() : Date.now()

if (Number.isNaN(now)) {
  console.error(`无法解析 --now：${String(args.now)}（示例：2026-10-21 08:00）`)
  process.exit(1)
}

const cfg = await createPushStore(join(dataDir, 'push')).readConfig()
// --data：宿主把「本次实际要推的条目」写成 JSON 传进来，保证图片与卡片同一口径；
// 不传时按当前时间生成一份预览。
const injected = args.data !== undefined
  ? JSON.parse(readFileSync(resolve(String(args.data)), 'utf8'))
  : undefined
const preview = injected ?? await previewReminderPlan({
  litigation: join(dataDir, 'litigation'),
  nonlitigation: join(dataDir, 'nonlitigation'),
  tasks: join(dataDir, 'tasks'),
}, cfg, now)
if (injected?.now !== undefined) now = Number(injected.now)

const template = readFileSync(new URL('./reminder-card.template.html', import.meta.url), 'utf8')
// --compact：一屏概览（今日全列，明日/提前各最多 3 条，其余只给计数）。
let items = preview.items
let suppressed = { ...preview.suppressed }
if (args.compact === true) {
  const caps = { overdue: 2, today_critical: 2, today: 99, tomorrow: 3, ahead: 3 }
  const used = {}
  const kept = []
  for (const item of items) {
    const n = used[item.section] ?? 0
    if (n < (caps[item.section] ?? 3)) {
      kept.push(item)
      used[item.section] = n + 1
    }
  }
  suppressed = { ...suppressed, capped: preview.items.length - kept.length }
  items = kept
}
const data = {
  now,
  total: preview.total,
  items,
  suppressed,
  pushTime: cfg.pushTime ?? '09:00',
  kind: injected?.kind ?? 'digest',
}
const html = template.replace('/*__DATA__*/', JSON.stringify(data))
writeFileSync(htmlPath, html, 'utf8')
console.log(`HTML: ${htmlPath}`)

const url = pathToFileURL(htmlPath).href
const shot = spawnSync('playwright', [
  'screenshot',
  '--viewport-size', `1080,${data.kind === 'intraday' ? 640 : 1200}`,
  '--full-page',
  '--wait-for-selector', '[data-ready="1"]',
  url,
  outPng,
], { stdio: 'inherit' })

if (shot.status === 0) {
  console.log(`PNG:  ${outPng}`)
  process.exit(0)
}

// Playwright 不可用时退回本机 Chrome（高度按条目数估算，保证整页进视野）。
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const height = 1200 + data.items.length * 150
const chromeShot = spawnSync(chrome, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  `--window-size=1080,${height}`,
  `--screenshot=${outPng}`,
  url,
], { stdio: 'inherit' })

if (chromeShot.status === 0) {
  console.log(`PNG:  ${outPng}（Chrome headless）`)
  process.exit(0)
}

console.error('截图失败：未找到可用的 playwright 或 Chrome。HTML 已产出，可直接打开手工截图。')
process.exit(1)
