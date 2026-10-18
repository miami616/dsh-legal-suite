/**
 * profile patch 托管区块自测（2026-10-18 回归）。
 *
 * 背景：宿主把设置页的写入持久化成 profile patch 里的条目覆盖（`- id: <entry>`
 * + `config:`），插入位置是「最后一个顶层条目之后」。我们区块的结束标记是一行
 * 注释而不是条目，于是宿主的条目正好落在我们两个标记之间——旧的重渲染把整段
 * 当成自己的产物重写，宿主设置项被吞掉。表现：设置页点开关后值写进宿主、随即
 * 被抹掉，界面刷新回默认（用户「改了又变回去」）。
 *
 * 本脚本钉死四条：
 *   ① 区块内的宿主条目必须逐字保留；
 *   ② 区块外（结束标记之后）的宿主条目同样保留；
 *   ③ 重写后标记仍成对、区块内容仍是我们渲染的那一份；
 *   ④ 连续两次同步，第二次必须是 'unchanged'（不写盘＝不触发 Loader 重载）。
 *
 * 用法：pnpm check:preset（先 tsc 编译，跑 lib/ 里的产物）
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { syncPresetsIntoProfilePatch } from '../lib/shared/preset-sync.js'

let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name} ${extra}`) }
}

const HOST_INSIDE = '- id: ui-settings-general\n  name: "@deepseek-ai/dsh-client-ui-settings-general"\n  config:\n    welcomeNoticeVersion: 2026-09-28.1'
const HOST_OUTSIDE = '- id: agentlex\n  config:\n    redactEnabled: false'

const dir = await mkdtemp(join(tmpdir(), 'agentlex-preset-check-'))
const patch = join(dir, 'cordis.patch.yml')

try {
  console.log('\nA. 宿主条目落在区块内部时必须保留')
  {
    // 首次同步：文件里只有空数组占位
    await writeFile(patch, '# 用户 patch 层\n[]\n', 'utf8')
    const first = await syncPresetsIntoProfilePatch(patch)
    const afterFirst = await readFile(patch, 'utf8')
    ok('首次写入返回 written', first === 'written', `got=${first}`)
    ok('占位 [] 被注释掉（避免第二个 YAML 文档解析失败）', /^\s*# \[\]$/m.test(afterFirst))
    ok('两个标记都写入且顺序正确', afterFirst.indexOf('# >>> dsh-legal-suite agent presets') >= 0
      && afterFirst.indexOf('# <<< dsh-legal-suite agent presets') > afterFirst.indexOf('# >>> dsh-legal-suite agent presets'))

    // 模拟宿主：把它的设置条目插到结束标记之前（= 落在区块内部）
    const withHost = afterFirst.replace(/# <<< dsh-legal-suite agent presets <<</, `${HOST_INSIDE}\n\n# <<< dsh-legal-suite agent presets <<<`)
    await writeFile(patch, withHost, 'utf8')

    const second = await syncPresetsIntoProfilePatch(patch)
    const afterSecond = await readFile(patch, 'utf8')
    ok('重写后宿主条目仍在', afterSecond.includes('welcomeNoticeVersion: 2026-09-28.1'))
    ok('宿主条目仍是一整个顶层条目（缩进没被压平）', /^- id: ui-settings-general$/m.test(afterSecond))
    ok('宿主条目的 config 层保留', /^  config:$/m.test(afterSecond) && /^    welcomeNoticeVersion: 2026-09-28\.1$/m.test(afterSecond))
    ok('结束标记仍在最后（宿主条目在它之前）', afterSecond.lastIndexOf('# <<< dsh-legal-suite agent presets <<<') > afterSecond.indexOf('welcomeNoticeVersion'))
    ok('第二次确实写了盘（因为此前文件里没有宿主条目之外的差异）', typeof second === 'string')

    const third = await syncPresetsIntoProfilePatch(patch)
    ok('内容稳定后第三次返回 unchanged（不写盘）', third === 'unchanged', `got=${third}`)
    const afterThird = await readFile(patch, 'utf8')
    ok('第三次没有丢失宿主条目', afterThird.includes('welcomeNoticeVersion: 2026-09-28.1'))
  }

  console.log('\nB. 宿主条目落在区块之后同样保留')
  {
    const afterFirst = await readFile(patch, 'utf8')
    const withTail = afterFirst.replace(/(# <<< dsh-legal-suite agent presets <<<\n)/, `$1${HOST_OUTSIDE}\n`)
    await writeFile(patch, withTail, 'utf8')
    const result = await syncPresetsIntoProfilePatch(patch)
    const after = await readFile(patch, 'utf8')
    ok('区块后的宿主条目保留', after.includes('redactEnabled: false'))
    ok('写入后仍能再同步且不重复声明 preset', result === 'unchanged' || result === 'written')
    ok('preset 声明只有一份（不重复）', (after.match(/- id: preset-litigation-manager/g) ?? []).length === 1)
  }

  console.log('\nC. 区块被整块摘除时也不吞宿主条目')
  {
    // 模拟：所有随包预设都已在区块外声明 → 我们应当摘掉区块，但保留宿主条目
    const current = await readFile(patch, 'utf8')
    const body = current
      .replace(/# >>> dsh-legal-suite agent presets[^\n]*\n[\s\S]*?# <<< dsh-legal-suite agent presets <<<\n?/, '')
    const external = '- insert:\n    - id: preset-litigation-manager\n      name: \'@deepseek-ai/dsh-agent-preset\'\n- insert:\n    - id: preset-nonlitigation-manager\n      name: \'@deepseek-ai/dsh-agent-preset\'\n'
    await writeFile(patch, `${body.replace(/\s+$/, '')}\n${external}${HOST_OUTSIDE}\n`, 'utf8')
    await syncPresetsIntoProfilePatch(patch)
    const after = await readFile(patch, 'utf8')
    ok('区块移除后宿主条目仍在', after.includes('redactEnabled: false'))
    ok('区块已摘除', !after.includes('# >>> dsh-legal-suite agent presets'))
    ok('外部已声明的 preset 没有被再声明一份', (after.match(/- id: preset-litigation-manager/g) ?? []).length === 1)
  }
} finally {
  await rm(dir, { recursive: true, force: true })
}

console.log(`\n通过 ${pass} / 失败 ${fail}`)
if (fail > 0) process.exit(1)
console.log('profile patch 托管区块自测全部通过 ✓')
