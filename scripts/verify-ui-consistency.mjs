/**
 * 前端结构一致性静态验证 —— 只覆盖「看不见但删了会出事」的约束。
 *
 * ⚠ 只断言结构与接线，**不断言任何视觉/配色/圆角设计**（那些是产品决定，
 *   2026-09-10 走过一轮被否掉的设计，不该被脚本锁死）。
 *
 * 起因：2026-09-10 事故——按「未引用类名」脚本剪枝 panel.module.css，把不含类名的
 * 全局激活规则（`[data-dsh-*-view]{display:none}` / `html[data-dsh-*-active] … {display:block}`
 * / `:root{--lit-*}`）当死代码删了，三个面板全部点不开。跑一次 1 秒：
 *   node scripts/verify-ui-consistency.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
let failures = 0
const check = (name, cond, extra = '') => {
  const ok = Boolean(cond)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
  if (!ok) failures++
}
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

const DOMAINS = [
  { key: 'litigation', view: 'data-dsh-litigation-view', active: 'data-dsh-litigation-active', panel: 'Litigation' },
  { key: 'nonlitigation', view: 'data-dsh-nonlitigation-view', active: 'data-dsh-nonlitigation-active', panel: 'NonLitigation' },
  { key: 'task', view: 'data-dsh-task-view', active: 'data-dsh-task-active', panel: 'Task' },
]

console.log('── 1. 面板激活规则（事故防线，删了面板点不开）──')
for (const d of DOMAINS) {
  const css = read(`src/domains/${d.key}/client/panel.module.css`)
  check(`${d.key}: [${d.view}] 存在`, css.includes(`[${d.view}]`))
  check(`${d.key}: 激活时 display:block`, new RegExp(`html\\[${d.active}\\][^{]*\\[${d.view}\\]\\s*\\{[^}]*display:\\s*block`).test(css))
  check(`${d.key}: 激活时隐藏会话列`, new RegExp(`html\\[${d.active}\\][^{]*\\[data-pane='conversation'\\]`).test(css) || new RegExp(`html\\[${d.active}\\][^{]*centerCol`).test(css))
  check(`${d.key}: --lit-* token 块仍在`, css.includes('--lit-ink') && css.includes('--lit-paper'))
}

console.log('\n── 2. 只保留 vendor 原版面板（无原生重复实现）──')
const DEAD = [
  'src/domains/task/client/TaskPanel.tsx',
  'src/domains/task/client/TaskDetailDrawer.tsx',
  'src/domains/task/client/mobile.module.css',
  'src/domains/task/client/use-mobile.ts',
  'src/domains/nonlitigation/client/board.module.css',
  'src/domains/litigation/client/detail/tasktree.module.css',
  'src/domains/litigation/client/detail/timeline.module.css',
  'src/domains/litigation/client/case-format.ts',
  'src/domains/litigation/client/party.ts',
]
for (const f of DEAD) check(`已删除 ${f}`, !existsSync(join(ROOT, f)))
for (const d of DOMAINS) {
  const src = read(`src/domains/${d.key}/client/Original${d.panel}Panel.tsx`)
  check(`${d.key}: 挂载 vendor @/pages/*`, src.includes("from '@/pages/"))
}
check('sidebar-entry-core 已并为共享一份', existsSync(join(ROOT, 'src/shared/sidebar-entry-core.ts')))
const copies = ['litigation', 'task', 'nonlitigation', 'skills-tools', 'skin']
  .filter((d) => existsSync(join(ROOT, `src/domains/${d}/client/sidebar-entry-core.ts`)))
check('各域不再各留一份 sidebar-entry-core', copies.length === 0, copies.join(','))

console.log('\n── 3. 深色模式接线（浅色下零差异，深色下不再「深卡片 + 深字」）──')
check('共享 color-scheme 模块存在', existsSync(join(ROOT, 'src/shared/color-scheme.ts')))
for (const d of DOMAINS) {
  const src = read(`src/domains/${d.key}/client/Original${d.panel}Panel.tsx`)
  check(`${d.key}: 使用 useColorScheme()`, src.includes('useColorScheme'))
  check(`${d.key}: 未写死 data-color-scheme="light"`, !src.includes('data-color-scheme="light"'))
}
const skin = read('src/domains/skin/client/index.ts')
check('皮肤 applyLitVars 认 body 上的深色属性', skin.includes('isDarkScheme') && skin.includes('observe(document.body'))

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)
