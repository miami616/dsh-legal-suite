#!/usr/bin/env node
/**
 * 周报图片版自测：渲染 PNG → 上传 → 图片卡 → 与「本周重点工作 / 本周总结」接线。
 *
 * 全程临时目录 + 拦截 fetch（不真的发飞书）。
 * 渲染需要本机有 playwright 或 Chrome；两者都没有时跳过渲染相关用例并明确提示。
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPushStore, createRunStateStore } from '../lib/domains/push/store/push-config.js'
import { runReminderTick } from '../lib/domains/push/push.js'
import { renderWeeklyImage, cleanupWeeklyImage } from '../lib/domains/push/weekly-image.js'
import { sendWeeklyImageCard } from '../lib/domains/push/feishu-card.js'

let pass = 0
let fail = 0
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}${extra !== '' ? `  (${extra})` : ''}`) }
}

/** 2026-10-19（周一，第 43 周）10:00。 */
const NOW = new Date(2026, 9, 19, 10, 0, 0).getTime()
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const day = (offset) => ymd(new Date(2026, 9, 19 + offset))

/** 一份典型「本周重点工作」payload（数据虚构）。 */
function payload(kind = 'plan') {
  return {
    kind,
    weekKey: '2026-W43',
    rangeLabel: '10月19日 – 10月25日',
    weekLabel: '2026 年第 43 周',
    worst: 'critical',
    total: 3,
    sections: [
      { title: '本周硬节点', rows: [
        { label: '开庭 · 第3法庭', when: '10/21 周三 09:30', caseName: '2026-001 甲方与乙方买卖合同纠纷', tag: '还剩 2 天', tagColor: 'red', severity: 'critical' },
        { label: '上诉期届满', when: '10/23 周五', caseName: '2026-002 丙方与丁方民间借贷纠纷', tag: '还剩 4 天', tagColor: 'grey', severity: 'critical' },
      ] },
      { title: '本周要推进', rows: [
        { label: '提交证据', when: '10/22 周四', caseName: '2026-001 甲方与乙方买卖合同纠纷', severity: 'normal' },
      ] },
    ],
  }
}

/* ------------------------- 1. 渲染 ------------------------- */

console.log('== 1. 渲染 PNG ==')
const hasBrowser = (() => {
  if (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')) return true
  const paths = (process.env.PATH ?? '').split(':')
  return paths.some((p) => existsSync(join(p, 'playwright')))
})()

let png
if (!hasBrowser) {
  console.log('  ! 本机没有 playwright / Chrome，跳过渲染用例')
} else {
  png = await renderWeeklyImage(payload('plan'), NOW)
  const size = statSync(png).size
  check('渲染出 PNG 文件', existsSync(png), png)
  check('PNG 体积合理（>50KB，说明有真实内容）', size > 50_000, `${size} bytes`)
  const head = readFileSync(png).subarray(0, 8)
  check('文件头是 PNG 魔数', head[0] === 0x89 && head.toString('latin1', 1, 4) === 'PNG', head.toString('hex'))

  const reviewPng = await renderWeeklyImage(payload('review'), NOW)
  check('「本周总结」也能渲染', existsSync(reviewPng) && statSync(reviewPng).size > 50_000)
  await cleanupWeeklyImage(reviewPng)
}

/* ------------------------- 2. 图片卡 ------------------------- */

console.log('== 2. 上传 + 图片卡 ==')
const base = mkdtempSync(join(tmpdir(), 'weekly-image-'))
const dir = join(base, 'push')
mkdirSync(dir, { recursive: true })
mkdirSync(join(base, 'integrations', 'dsh-feishu'), { recursive: true })
writeFileSync(join(base, 'integrations', 'dsh-feishu', 'config.json'), JSON.stringify({
  bots: [{ appId: 'cli_test', secretRef: 'feishu_test_secret', ownerOpenIds: ['ou_test_owner'] }],
}))
writeFileSync(join(base, '.credentials.yaml'), 'refs:\n  feishu_test_secret: test-secret-value\n')
process.env.DSH_HOME = base

const originalFetch = globalThis.fetch
const calls = { upload: 0, messages: [] }
let uploadFails = false
globalThis.fetch = async (url, options) => {
  if (String(url).includes('/auth/v3/tenant_access_token/internal')) {
    return new Response(JSON.stringify({ code: 0, tenant_access_token: 't' }), { status: 200 })
  }
  if (String(url).includes('/im/v1/images')) {
    calls.upload += 1
    if (uploadFails) return new Response(JSON.stringify({ code: 99991400, msg: 'no permission' }), { status: 400 })
    return new Response(JSON.stringify({ code: 0, data: { image_key: `img_${calls.upload}` } }), { status: 200 })
  }
  if (String(url).includes('/im/v1/messages')) {
    calls.messages.push(JSON.parse(String(options?.body ?? '{}')).content)
    return new Response(JSON.stringify({ code: 0, msg_id: `m${calls.messages.length}` }), { status: 200 })
  }
  return originalFetch(url, options)
}

if (png !== undefined) {
  await sendWeeklyImageCard(png, payload('plan'), { titlePrefix: '哈喽！' })
  const card = JSON.parse(calls.messages[calls.messages.length - 1] ?? '{}')
  check('发出一条消息（图片卡，不是图文两条）', calls.messages.length === 1 && calls.upload === 1)
  check('卡片标题是「本周重点工作」', card?.header?.title?.content === '哈喽！ 本周重点工作', JSON.stringify(card?.header))
  check('卡片内嵌上传后的图片', card?.elements?.some((e) => e.tag === 'img' && e.img_key === 'img_1') === true)
  check('图片卡页脚标明可放大', JSON.stringify(card).includes('点开图片可放大'))

  uploadFails = true
  let rejected = false
  try {
    await sendWeeklyImageCard(png, payload('plan'))
  } catch (error) {
    rejected = /image upload/.test(String(error))
  }
  check('上传失败时抛错（调用方才能回退文字卡）', rejected)
  uploadFails = false
} else {
  console.log('  ! 无浏览器，跳图片卡内嵌用例')
}

/* ------------------------- 3. 接线：周一/周五走图片 ------------------------- */

console.log('== 3. 接线：imageMode 开时周报走图片 ==')
const lit = join(base, 'litigation')
mkdirSync(lit, { recursive: true })
mkdirSync(join(base, 'items'), { recursive: true })
writeFileSync(join(lit, 'case-registry.json'), JSON.stringify({ registryVersion: '1.0', cases: {} }))
writeFileSync(join(base, 'items', 'items.json'), JSON.stringify({
  registryVersion: '1.0',
  items: [
    { id: 't1', ownerId: '', type: 'task', title: '提交证据', date: day(1), status: 'pending' },
    { id: 'h1', ownerId: '', type: 'event', title: '开庭', date: day(1), time: '09:00', status: 'pending' },
  ],
}))
const store = createPushStore(join(base, 'push'))
const stateStore = createRunStateStore(join(base, 'push'))
const dirs = { litigation: lit, nonlitigation: lit, tasks: lit }
const cfg = { enabled: true, pushTime: '08:30', smartLead: true, preciseReminder: true, includeConsequence: true, imageMode: true }

if (hasBrowser) {
  const before = { upload: calls.upload, messages: calls.messages.length }
  const r = await runReminderTick(dirs, cfg, store, stateStore, { now: new Date(2026, 9, 19, 8, 35).getTime() })
  check('周一档期发出「本周重点工作」', r.kind === 'weekly-plan' && r.pushed > 0, JSON.stringify(r))
  check('走的是图片上传（而不是直接发文字卡）', calls.upload === before.upload + 1, `uploads=${calls.upload - before.upload}`)
  const card = JSON.parse(calls.messages[calls.messages.length - 1] ?? '{}')
  check('周一卡是图片卡且含图片', card?.elements?.some((e) => e.tag === 'img') === true)
  check('只发一条消息', calls.messages.length === before.messages + 1, `messages=${calls.messages.length - before.messages}`)

  const beforeReview = { upload: calls.upload, messages: calls.messages.length }
  const review = await runReminderTick(dirs, cfg, store, stateStore, { now: new Date(2026, 9, 23, 16, 35).getTime(), mode: 'weekly-review' })
  check('周五档期发出「本周总结与下周重点」', review.kind === 'weekly-review' && review.pushed > 0, JSON.stringify(review))
  check('结算卡同样走图片', calls.upload === beforeReview.upload + 1)
  const reviewCard = JSON.parse(calls.messages[calls.messages.length - 1] ?? '{}')
  check('总结卡是图片卡', reviewCard?.elements?.some((e) => e.tag === 'img') === true)
} else {
  console.log('  ! 无浏览器，跳过接线用例')
}

/* ------------------------- 4. 关掉图片模式仍走文字 ------------------------- */

console.log('== 4. imageMode 关时仍是文字卡 ==')
const base2 = mkdtempSync(join(tmpdir(), 'weekly-image-off-'))
const lit2 = join(base2, 'litigation')
mkdirSync(lit2, { recursive: true })
mkdirSync(join(base2, 'items'), { recursive: true })
writeFileSync(join(lit2, 'case-registry.json'), JSON.stringify({ registryVersion: '1.0', cases: {} }))
writeFileSync(join(base2, 'items', 'items.json'), JSON.stringify({
  registryVersion: '1.0',
  items: [{ id: 'h1', ownerId: '', type: 'event', title: '开庭', date: day(1), time: '09:00', status: 'pending' }],
}))
const store2 = createPushStore(join(base2, 'push'))
const state2 = createRunStateStore(join(base2, 'push'))
const beforeText = { upload: calls.upload, messages: calls.messages.length }
const off = await runReminderTick({ litigation: lit2, nonlitigation: lit2, tasks: lit2 }, { ...cfg, imageMode: false }, store2, state2, { now: new Date(2026, 9, 19, 8, 35).getTime() })
check('关掉图片模式后仍发周报', off.kind === 'weekly-plan' && off.pushed > 0, JSON.stringify(off))
check('不触发图片上传', calls.upload === beforeText.upload)
const textCard = JSON.parse(calls.messages[calls.messages.length - 1] ?? '{}')
check('文字卡含「本周硬节点」', JSON.stringify(textCard).includes('本周硬节点'))

globalThis.fetch = originalFetch
rmSync(base, { recursive: true, force: true })
rmSync(base2, { recursive: true, force: true })
if (png !== undefined) await cleanupWeeklyImage(png)

console.log(`\n${pass} passed, ${fail} failed`)
if (fail > 0) process.exit(1)
