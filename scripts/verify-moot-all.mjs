#!/usr/bin/env node
/**
 * 一键跑完模拟法庭全部验收用例（并行，默认并发 3）。
 *
 * 用例彼此独立（各自建/删自己的会话），只有 writeback 会往案件任务树里写任务，
 * 与其它用例无冲突。每个用例都是**完整实跑庭审**，串行要 1–2 小时，并行后
 * 取决于最慢的一个。
 *
 * 用法：node scripts/verify-moot-all.mjs [--concurrency=3] [--only=basics,citations]
 */
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit === undefined ? fallback : hit.split('=').slice(1).join('=')
}
const concurrency = Math.max(1, Number(arg('concurrency', '3')) || 3)
const only = arg('only', '')
const ALL = ['basics', 'citations', 'money', 'interrupt', 'appellate', 'labor', 'arbitration', 'writeback', 'rehearsal', 'tool', 'experimental']
const cases = only === '' ? ALL : only.split(',').map((s) => s.trim()).filter((s) => s !== '')

/** 跑一个用例，捕获输出与退出码。 */
function runCase(name) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(here, `verify-moot-${name}.mjs`)], { cwd: join(here, '..') })
    let out = ''
    child.stdout.on('data', (d) => { out += d.toString() })
    child.stderr.on('data', (d) => { out += d.toString() })
    const started = Date.now()
    child.on('close', (code) => resolve({ name, code, out, ms: Date.now() - started }))
  })
}

console.log(`模拟法庭验收：${cases.length} 个用例，并发 ${concurrency}\n`)
const results = []
const queue = [...cases]
const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
  for (;;) {
    const name = queue.shift()
    if (name === undefined) return
    const started = Date.now()
    process.stdout.write(`… ${name} 开跑\n`)
    const result = await runCase(name)
    results.push(result)
    const tail = result.out.trim().split('\n').slice(-1)[0] ?? ''
    const mark = result.code === 0 ? '✅ PASS' : '❌ FAIL'
    console.log(`${mark} ${name}（${((Date.now() - started) / 1000).toFixed(0)}s）${result.code === 0 ? '' : `\n${tail}`}`)
  }
})
await Promise.all(workers)

const failed = results.filter((r) => r.code !== 0)
console.log(`\n汇总：${results.length - failed.length}/${results.length} 通过`)
if (failed.length > 0) {
  console.log('\n失败用例输出尾部：')
  for (const f of failed) console.log(`\n--- ${f.name} ---\n${f.out.trim().split('\n').slice(-12).join('\n')}`)
  process.exit(1)
}
