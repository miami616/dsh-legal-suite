/**
 * 客户端设置作用域投影自测（2026-10-12 回归）。
 *
 * 背景：`aliasSettingsScope` 读快照时曾把**承载字段名**当逻辑名去算前缀，
 * 投影结果被清成 `{}`，设置页所有读取退回默认值——表现为
 * 「日程同步 Apple 日历」显示成关、下面的同步范围整块 pointer-events:none 点不动，
 * 而宿主里开关其实是 true。这里把投影/写入两个方向钉死。
 *
 * 用法：pnpm check:settings（先 tsc 编译，跑 lib/ 里的产物）
 */
import {
  prefixedField,
  unprefixedField,
  aliasSettingsScope,
  resolveClientSettings,
} from '../lib/shared/client-settings.js'

let pass = 0
let fail = 0
const eq = (name, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    pass++
  } else {
    fail++
    console.error(`✗ ${name}\n    实际 ${a}\n    期望 ${e}`)
  }
}

// ── 字段名双向映射 ──
eq('prefixedField', prefixedField('litigation', 'calendarSyncEnabled'), 'litigationCalendarSyncEnabled')
eq('prefixedField 首字母', prefixedField('nonlitigation', 'dataDir'), 'nonlitigationDataDir')
eq('unprefixedField', unprefixedField('litigation', 'litigationCalendarSyncEnabled'), 'calendarSyncEnabled')
eq('unprefixedField dataDir', unprefixedField('litigation', 'litigationDataDir'), 'dataDir')
eq('unprefixedField 无前缀原样', unprefixedField('litigation', 'mootCourtEnabled'), 'mootCourtEnabled')
eq('unprefixedField 前缀后非大写原样', unprefixedField('litigation', 'litigationlog'), 'litigationlog')
eq('unprefixedField 等于前缀原样', unprefixedField('litigation', 'litigation'), 'litigation')
eq(
  '往返一致',
  unprefixedField('litigation', prefixedField('litigation', 'calendarSyncTasks')),
  'calendarSyncTasks',
)

// ── 作用域包：读投影 + 写映射 ──
const hostValue = {
  litigationDataDir: '/Users/mee/.dsh/agentlex',
  litigationCalendarSyncEnabled: true,
  litigationCalendarName: '工作',
  litigationCalendarSyncEvents: true,
  litigationCalendarSyncTasks: false,
  mootCourtEnabled: false, // 非本域字段：原样保留
}
const writes = []
let current = { ...hostValue }
const raw = {
  getSnapshot: () => ({ status: 'ready', writable: true, revision: 1, value: { ...current } }),
  subscribe: () => () => {},
  set: (field, value) => {
    writes.push([field, value])
    current = { ...current, [field]: value }
  },
  unset: () => {},
}
const scoped = aliasSettingsScope(raw, (l) => prefixedField('litigation', l), (a) => unprefixedField('litigation', a))
const projected = scoped.getSnapshot().value

eq('投影 dataDir', projected.dataDir, '/Users/mee/.dsh/agentlex')
eq('投影 calendarSyncEnabled', projected.calendarSyncEnabled, true)
eq('投影 calendarName', projected.calendarName, '工作')
eq('投影 calendarSyncTasks', projected.calendarSyncTasks, false)
eq('投影保留非本域字段', projected.mootCourtEnabled, false)
eq('投影不再出现承载名', 'litigationCalendarSyncEnabled' in projected, false)

scoped.set('calendarSyncEnabled', false)
eq('写入走承载名', writes.at(-1), ['litigationCalendarSyncEnabled', false])
eq('写入后读回', scoped.getSnapshot().value.calendarSyncEnabled, false)

scoped.set('dataDir', '/tmp/x')
eq('数据目录写入走承载名', writes.at(-1), ['litigationDataDir', '/tmp/x'])

// ── 恒等映射（0.1.6 老路径）不破坏原值 ──
const identity = aliasSettingsScope(raw, (l) => l, (a) => a)
eq('恒等映射读回原样', identity.getSnapshot().value.litigationCalendarName, '工作')

// ── 非对象快照原样返回（作用域未就绪时）──
const empty = aliasSettingsScope({ getSnapshot: () => ({ status: 'pending' }), subscribe: () => () => {}, set: () => {}, unset: () => {} }, (l) => l, (a) => a)
eq('未就绪快照返回 undefined', empty.getSnapshot().value, undefined)

// ── resolveClientSettings：0.2.x 必须落在「宿主真正在服务的域命名空间」上 ──
// 回归：0.2.x 的宿主服务 agentlex-litigation / agentlex-legal-suite 这些**域命名空间**，
// 老写法固定 configForms.get('agentlex')（没人注册）→ status='unavailable'、value=undefined，
// 设置页主开关显示为关、同步范围整块 pointer-events:none 点不动、写入静默无效。
{
  const writes = []
  const makeForms = (servedNamespaces, values) => {
    const scopes = new Map()
    const scopeOf = (ns) => {
      if (!scopes.has(ns)) {
        const served = servedNamespaces.includes(ns)
        scopes.set(ns, {
          getSnapshot: () => (served ? { status: 'ready', value: values[ns] ?? {} } : { status: 'unavailable', value: undefined }),
          subscribe: () => () => {},
          set: (field, value) => { writes.push([ns, field, value]); return true },
          unset: (field) => { writes.push([ns, field, null]); return true },
        })
      }
      return scopes.get(ns)
    }
    const mirror = {
      getSnapshot: () => ({ view: { namespaces: servedNamespaces.map((ns) => ({ ns })) } }),
      subscribe: () => () => {},
    }
    return { get: scopeOf, describe: () => mirror }
  }
  const ctxOf = (forms) => ({ get: (name) => (name === 'configForms' ? forms : undefined) })

  // ① 0.2.x：域命名空间在服务 → 读它、用逻辑字段名（不做前缀映射）
  const modern = makeForms(['agentlex-litigation'], {
    'agentlex-litigation': { calendarSyncEnabled: true, calendarSyncEvents: true, calendarName: 'AgentLex日历' },
  })
  const modernBinding = resolveClientSettings(ctxOf(modern), 'agentlex-litigation', 'litigation')
  eq('0.2.x 读到宿主 true', modernBinding?.scope.getSnapshot().value?.calendarSyncEnabled, true)
  eq('0.2.x 读到目标日历', modernBinding?.scope.getSnapshot().value?.calendarName, 'AgentLex日历')
  modernBinding?.scope.set('calendarSyncEnabled', false)
  eq('0.2.x 写入落在域命名空间、字段名不带前缀', writes.at(-1), ['agentlex-litigation', 'calendarSyncEnabled', false])

  // ② 0.1.7：只服务合并条目 agentlex → 退回条目表单 + 前缀折叠
  const legacyEntry = makeForms(['agentlex'], {
    agentlex: { litigationCalendarSyncEnabled: true, litigationCalendarName: '工作' },
  })
  const legacyBinding = resolveClientSettings(ctxOf(legacyEntry), 'agentlex-litigation', 'litigation')
  eq('0.1.7 折叠回逻辑名', legacyBinding?.scope.getSnapshot().value?.calendarSyncEnabled, true)
  legacyBinding?.scope.set('calendarName', '个人')
  eq('0.1.7 写入带前缀', writes.at(-1), ['agentlex', 'litigationCalendarName', '个人'])

  // ③ 皮肤域（无前缀）：域命名空间在服务时字段名原样
  const skin = makeForms(['agentlex-legal-suite'], { 'agentlex-legal-suite': { centerCard: true } })
  const skinBinding = resolveClientSettings(ctxOf(skin), 'agentlex-legal-suite')
  eq('皮肤域读到宿主值', skinBinding?.scope.getSnapshot().value?.centerCard, true)
  skinBinding?.scope.set('centerCard', false)
  eq('皮肤域写入落在域命名空间', writes.at(-1), ['agentlex-legal-suite', 'centerCard', false])
}

console.log(`\n通过 ${pass} / 失败 ${fail}`)
if (fail > 0) process.exit(1)
console.log('客户端设置作用域投影自测全部通过 ✓')
