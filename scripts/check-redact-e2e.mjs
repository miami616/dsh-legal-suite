#!/usr/bin/env node
/**
 * 脱敏端到端检查（打运行中的测试宿主，默认 3081）。
 *
 * 用法：
 *   node scripts/check-redact-e2e.mjs                 # 默认 http://127.0.0.1:3081
 *   node scripts/check-redact-e2e.mjs 3082            # 换端口
 *   BASE=http://127.0.0.1:3081 node scripts/check-redact-e2e.mjs
 *
 * 前置：测试 profile 已装本包并起着（docs/dev-test-flow.md）。
 * 语料：全部合成（假姓名/测试号/公开测试身份证号），不含任何真实案件信息。
 */
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const arg = process.argv[2] ?? ''
const BASE = process.env.BASE ?? (arg === '' ? 'http://127.0.0.1:3081' : `http://127.0.0.1:${arg}`)
const API = `${BASE}/api/agentlex-redact`
const SCOPE = 'e2e-check'
const MASKED_SCOPE = 'e2e-check-masked'

const results = []
function check(name, cond, detail = '') {
  results.push({ name, ok: Boolean(cond), detail })
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `   <- ${detail}`}`)
}

async function call(path, payload, method) {
  const init = { method: method ?? (payload === undefined ? 'GET' : 'POST'), headers: { accept: 'application/json' } }
  if (payload !== undefined) {
    init.headers['content-type'] = 'application/json'
    init.body = JSON.stringify(payload)
  }
  const response = await fetch(`${API}/${path}`, init)
  return await response.json()
}

/** 清掉上次测试残留的映射（幂等）。 */
async function reset() {
  const file = join(homedir(), '.dsh', 'agentlex', 'redact', 'mappings', `${SCOPE}.json`)
  const masked = join(homedir(), '.dsh', 'agentlex', 'redact', 'mappings', `${MASKED_SCOPE}.json`)
  await Promise.all([file, masked].map((path) => import('node:fs/promises').then((fs) => fs.rm(path, { force: true }))))
}

const TEXT = '原告张三，被告某某科技有限公司，案号（2026）鲁01民初1234号，电话13812345678，身份证11010519491231002X，银行卡6228480123456789（账号）。'

console.log(`目标：${BASE}\n`)
await reset()

// 0) 健康
{
  const r = await call('health')
  check('路由存活 /health', r.success === true && r.data?.status === 'ready', JSON.stringify(r))
}

// 1) 词条（自定义，用于验证词典层）
{
  const r = await call('terms', {
    scope: SCOPE,
    terms: [
      { value: '张三', kind: 'person', note: '原告' },
      { value: '某某科技有限公司', kind: 'org' },
      { value: '（2026）鲁01民初1234号', kind: 'caseNumber' },
    ],
  })
  check('词条写入', r.success === true && r.data.added.length === 3, JSON.stringify(r))
}

// 2) scan：只预检，不落盘
{
  const r = await call('scan', { scope: SCOPE, text: TEXT })
  const report = r.data?.report
  check('scan 命中 6 处（人名/机构/案号/手机/身份证/银行账号）', report?.totalHits === 6, JSON.stringify(report?.byKind))
  check('scan 读到案件库词条（非空）', (r.data?.lexiconCount ?? 0) > 0, String(r.data?.lexiconCount))
  const exists = await stat(join(homedir(), '.dsh', 'agentlex', 'redact', 'mappings', `${SCOPE}.json`)).then(() => true, () => false)
  check('scan 不产生映射文件', exists === false)
}

// 3) redact（reversible）
let redacted = ''
{
  const r = await call('redact', { scope: SCOPE, mode: 'reversible', text: TEXT })
  redacted = r.data?.text ?? ''
  console.log(`\n      脱敏结果：${redacted}\n`)
  check('人名 → 张某', redacted.includes('张某'))
  check('机构 → 机构A', redacted.includes('机构A'))
  check('案号 → 案号A', redacted.includes('案号A'))
  check('手机 → 138****5678', redacted.includes('138****5678'))
  check('身份证 → 110***********002X', redacted.includes('110***********002X'))
  check('银行账号 → 6228********6789', redacted.includes('6228********6789'))
  check('原文全部消失', !redacted.includes('张三') && !redacted.includes('某某科技') && !redacted.includes('13812345678'))
  const mode = await stat(join(homedir(), '.dsh', 'agentlex', 'redact', 'mappings', `${SCOPE}.json`))
    .then((info) => info.mode & 0o777, () => -1)
  check('映射表权限 0600', mode === 0o600, `mode=${mode === -1 ? '不存在' : mode.toString(8)}`)
}

// 4) restore：往返必须逐字一致
{
  const r = await call('restore', { scope: SCOPE, text: redacted })
  check('restore 往返逐字一致', r.data?.text === TEXT, r.data?.text)
  check('restore 无残留/歧义', r.data?.missing.length === 0 && r.data?.ambiguous.length === 0, JSON.stringify(r.data))
}

// 5) masked：对外模式，不可还原
{
  const r1 = await call('redact', { scope: MASKED_SCOPE, mode: 'masked', text: '原告张三' })
  check('masked 标记不可还原', r1.data?.restorable === false)
  const r2 = await call('restore', { scope: MASKED_SCOPE, text: r1.data?.text ?? '' })
  check('masked 之后 restore 被拒', r2.success === false, JSON.stringify(r2))
}

// 6) 启发层：只报告不替换
{
  const r = await call('redact', { scope: SCOPE, text: '被告：王小明到庭。' })
  check('启发候选进报告', r.data?.report?.candidates?.length === 1, JSON.stringify(r.data?.report?.candidates))
  check('启发不替换正文', (r.data?.text ?? '').includes('王小明'), r.data?.text)
}

// 7) 配置读改
{
  const r1 = await call('config', { heuristic: false }, 'PUT')
  const r2 = await call('config')
  check('config 可读改', r1.data?.heuristic === false && r2.data?.heuristic === false)
  const r3 = await call('config', { heuristic: true }, 'PUT')
  check('config 复原', r3.data?.heuristic === true)
}

const failed = results.filter((item) => !item.ok)
console.log(`\n通过 ${results.length - failed.length} / ${results.length}`)
if (failed.length > 0) {
  console.log('\n失败项：')
  for (const item of failed) console.log(`  x ${item.name}  ${item.detail}`)
  process.exit(1)
}
console.log('脱敏端到端检查全部通过')
console.log(`\n提示：本次测试写入的映射在 ~/.dsh/agentlex/redact/mappings/${SCOPE}.json 与 ${MASKED_SCOPE}.json，可删。`)
