#!/usr/bin/env node
/**
 * 客户端包静态校验（构建产物级冒烟）。
 *
 * 覆盖三件事：
 *   ① `client/client.js` 能被 V8 **编译**（截断/损坏的产物在浏览器里是白屏，
 *      构建成功不代表 tarball 里那份没被截断）；
 *   ② 加载器契约完好（`window.__ModuleLoader__.load({id: "dsh-legal-suite", factory})`
 *      且 factory 末尾 `return module.exports`）——契约不对加载器就静默不挂载；
 *   ③ 各聚合域标记齐备（新增域没挂进 bundle 会在这里被抓到）。
 *
 * 已知边界：本脚本**不执行** factory，覆盖不到「模块顶层 throw」——那类问题需要
 * 真实 DOM，请在浏览器里打开实例复验（见 docs/模拟法庭-设计方案.md §13）。
 *
 * 用法：node scripts/verify-client-load.mjs [--expect=字符串]...
 */
import fs from 'node:fs'
import vm from 'node:vm'

const bundlePath = 'client/client.js'
if (!fs.existsSync(bundlePath)) {
  console.error(`verify-client-load: 找不到 ${bundlePath} —— 先跑 pnpm build`)
  process.exit(1)
}
const code = fs.readFileSync(bundlePath, 'utf8')

// ① 编译校验。
try {
  new vm.Script(code, { filename: bundlePath })
} catch (error) {
  console.error(`verify-client-load: 产物无法编译 —— ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}

// ② 加载器契约。
const problems = []
if (!code.includes('window.__ModuleLoader__.load(')) problems.push('缺少 __ModuleLoader__.load 横幅')
if (!/id:\s*"dsh-legal-suite"/.test(code)) problems.push('横幅里的插件 id 不是 dsh-legal-suite')
if (!/return module\.exports;/.test(code)) problems.push('缺少 factory 的 return module.exports')

// ③ 聚合域标记（含新增域；漏挂即失败）。
// 只放**客户端**产物该有的标记：host 工具（如 legal_calc、moot_court）不在 bundle 里。
const expected = [
  'data-dsh-litigation-entry',
  'data-dsh-nonlitigation-entry',
  'data-dsh-taskboard-entry',
  'data-dsh-moot-entry',
  'agentlex-moot-court',
  'agentlex-memo',
  'agentlex-workspace-sidebar',
]
const absent = expected.filter((needle) => !code.includes(needle))
if (absent.length > 0) problems.push(`缺少聚合标记：${absent.join(', ')}`)

// 额外的 --expect=… 断言（部署脚本用它确认某轮改动真的进了产物）。
for (const arg of process.argv.slice(2)) {
  const needle = arg.startsWith('--expect=') ? arg.slice('--expect='.length) : arg
  if (needle !== '' && !code.includes(needle)) problems.push(`缺少 --expect 串：${needle}`)
}

if (problems.length > 0) {
  console.error(`verify-client-load: ${problems.join('；')}`)
  process.exit(1)
}

console.log(
  `verify-client-load ok: 编译通过、加载器契约完好、聚合标记 ${expected.length} 项齐备 ` +
  `(${(code.length / 1024 / 1024).toFixed(1)} MB)`,
)
