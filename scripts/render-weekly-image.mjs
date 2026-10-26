#!/usr/bin/env node
/**
 * 把「周报」（周一 本周重点工作 / 周五 本周总结）渲染成一张 PNG。
 *
 * 与每日提醒图片版同一套做法：HTML 模板 + 无头浏览器整页截图。
 * 数据由宿主写进 --data（周报 payload 结构化 JSON），保证图片与卡片同一口径。
 *
 * 用法：
 *   node scripts/render-weekly-image.mjs --data /tmp/weekly.json --out /tmp/weekly.png
 *   node scripts/render-weekly-image.mjs --data /tmp/weekly.json --html /tmp/weekly.html
 *
 * 依赖：playwright CLI 或 Google Chrome；都没有时退出码 1（调用方回退文字卡）。
 */

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

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
if (args.data === undefined) {
  console.error('缺少 --data（周报 payload JSON 路径）')
  process.exit(1)
}

const data = JSON.parse(readFileSync(resolve(String(args.data)), 'utf8'))
if (data.now !== undefined) data.now = Number(data.now)
const outPng = resolve(args.out ?? join(process.cwd(), 'docs/周报样张-图片版.png'))
const htmlPath = args.html !== undefined
  ? resolve(String(args.html))
  : join(mkdtempSync(join(tmpdir(), 'weekly-card-')), 'weekly.html')

const template = readFileSync(new URL('./weekly-card.template.html', import.meta.url), 'utf8')
writeFileSync(htmlPath, template.replace('/*__DATA__*/', JSON.stringify(data)), 'utf8')
console.log(`HTML: ${htmlPath}`)

const url = pathToFileURL(htmlPath).href
const rows = (data.sections || []).reduce((n, s) => n + (s.rows || []).length, 0)
const shot = spawnSync('playwright', [
  'screenshot',
  '--viewport-size', '1080,1200',
  '--full-page',
  '--wait-for-selector', '[data-ready="1"]',
  url,
  outPng,
], { stdio: 'inherit' })

if (shot.status === 0) {
  console.log(`PNG:  ${outPng}`)
  process.exit(0)
}

// Playwright 不可用时退回本机 Chrome（高度按行数估算，保证整页进视野）。
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const height = 1200 + rows * 160
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

console.error('截图失败：未找到可用的 playwright 或 Chrome。HTML 已产出，可手工截图。')
process.exit(1)
