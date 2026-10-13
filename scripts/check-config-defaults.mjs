/**
 * 合包层默认值一致性自测（2026-10-13 回归：日历不同步）。
 *
 * 背景：`src/index.ts` 的聚合 Config 是**唯一**被 harness loader 校验的表；
 * 各业务域拿到的 Config 是 `xxxConfigOf()` 用对象字面量**直接构造**出来的，
 * 不会再过一次域自己的 schema。于是「域里写了 default、聚合层漏了默认值」
 * 这种组合会让域里的 default 永远不生效，运行时读到 undefined——
 * 0.2.18 的 `litigationCalendarSyncEvents` 就是这么把 Apple 日历同步整条废掉的
 * （规则判定成 disabled → 自动同步和手动「立即同步」一条都不进日历，
 * 而设置页显示的还是「宿主 true」，极难自查）。
 *
 * 本脚本机械地钉死这条不变量：**对每一对「聚合字段 → 域字段」，
 * 空配置下两边的解析结果必须一致**（都 undefined，或同一个值）。
 * 它从 src/index.ts 里现场抽映射表，所以以后新增字段、改名、漏默认值都会被抓到。
 *
 * 用法：pnpm check:defaults（先 tsc 编译，跑 lib/ 里的产物）
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = readFileSync(join(ROOT, 'src/index.ts'), 'utf8')

/** 从 `function xxxConfigOf(config: Config): domain.Config { return { 域字段: config.聚合字段, ... } }` 抽映射。 */
function pairsFrom(fnName) {
  const body = new RegExp(`function ${fnName}\\(config: Config\\)[^{]*\\{([\\s\\S]*?)\\n\\}`, 'm')
    .exec(SRC)?.[1] ?? ''
  return [...body.matchAll(/^\s*(\w+):\s*config\.(\w+),/gm)].map((m) => ({ dom: m[1], agg: m[2] }))
}

/** 从 `registerDomainConfig(NS, () => ({ 域字段: (getLiveConfig() as unknown as Config).聚合字段 }))` 抽映射。 */
function inlinePairs(nsVar) {
  const body = new RegExp(
    `registerDomainConfig\\(${nsVar}\\.\\w+,[\\s\\S]*?=> \\(\\{([\\s\\S]*?)\\}\\)\\)`,
    'm',
  ).exec(SRC)?.[1] ?? ''
  // 只认「域字段: (getLiveConfig() as unknown as Config).聚合字段」。末尾逗号可有可无：
  // 单行写法 `({ dataDir: (getLiveConfig() ...).memoDataDir })` 没有逗号，闭合花括号
  // 也在捕获体之外，所以不能靠后置分隔符判断。
  return [...body.matchAll(/(\w+):\s*\(?getLiveConfig\(\) as unknown as Config\)?\.(\w+)/g)]
    .map((m) => ({ dom: m[1], agg: m[2] }))
}

/**
 * 需要比对的分组：聚合映射函数 / 内联注册 → lib/domains/<mod>/index.js 的 Config。
 * 挂载点见 src/index.ts 的 mountDomains()。
 */
const GROUPS = [
  { name: 'litigation', mod: 'litigation', pairs: pairsFrom('litigationConfigOf') },
  { name: 'nonlitigation', mod: 'nonlitigation', pairs: inlinePairs('nonlitigation') },
  { name: 'task', mod: 'task', pairs: inlinePairs('task') },
  { name: 'skin', mod: 'skin', pairs: pairsFrom('skinConfigOf') },
  { name: 'memo', mod: 'memo', pairs: inlinePairs('memo') },
  { name: 'push', mod: 'push', pairs: inlinePairs('push') },
  { name: 'mootCourt', mod: 'moot-court', pairs: pairsFrom('mootCourtConfigOf') },
  { name: 'redact', mod: 'redact', pairs: pairsFrom('redactConfigOf') },
]

/** volatile 字段解析出来是 { get() } 包装，取值要拆一层。 */
const unwrap = (value) => (value !== null && typeof value === 'object' && typeof value.get === 'function'
  ? value.get()
  : value)

const aggregate = (await import(join(ROOT, 'lib/index.js'))).Config({})

let pass = 0
let fail = 0
let pairs = 0

for (const group of GROUPS) {
  if (group.pairs.length === 0) {
    fail++
    console.error(`✗ ${group.name}: 没抽到映射对——src/index.ts 的映射写法变了？脚本需要同步更新。`)
    continue
  }
  let domain
  try {
    domain = (await import(join(ROOT, `lib/domains/${group.mod}/index.js`))).Config({})
  } catch (error) {
    fail++
    console.error(`✗ ${group.name}: 无法解析域 schema —— ${error.message}`)
    continue
  }
  console.log(`  ${group.name}: ${group.pairs.length} 对`)
  for (const pair of group.pairs) {
    pairs++
    const a = unwrap(aggregate[pair.agg])
    const d = unwrap(domain[pair.dom])
    if (a === undefined && d !== undefined) {
      fail++
      console.error(
        `✗ ${group.name}.${pair.dom}：聚合层 ${pair.agg} 缺默认值\n`
        + `    聚合解析结果 ${JSON.stringify(a)} / 域默认 ${JSON.stringify(d)}\n`
        + `    → 域的 default 不会生效，请在 src/index.ts 的聚合 schema 里补 default(${JSON.stringify(d)})`,
      )
    } else if (a !== undefined && d !== undefined && typeof a !== 'object' && a !== d) {
      fail++
      console.error(
        `✗ ${group.name}.${pair.dom}：聚合默认值与域默认值不一致（${JSON.stringify(a)} vs ${JSON.stringify(d)}）`,
      )
    } else {
      pass++
    }
  }
}

console.log(`\n比对 ${pairs} 对映射，通过 ${pass} / 失败 ${fail}`)
if (fail > 0) process.exit(1)
console.log('合包层默认值与各业务域一致 ✓')
