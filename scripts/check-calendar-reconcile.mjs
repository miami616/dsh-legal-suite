/**
 * Apple 日历「自动对账」判定自测（2026-10-15 回归）。
 *
 * 背景：日程进日历此前只依赖「写事项时派发一次事件」。派发丢失、或 osascript 瞬时
 * 失败（Calendar 忙 / 权限弹窗 / 20 秒超时 / 目标日历临时不可写）都会让这条日程
 * **永久**漏在日历外，且没有任何重试与提示——用户看到的「日程没有实时同步」。
 * 现在每 10 分钟跑一次**增量**对账，本脚本钉死它的判定：
 *   ① 该同步但映射里没有 → 补建；
 *   ② 映射里有、事项已删除 → 删事件；
 *   ③ 已经同步过的不重复建（零开销），单轮有上限；
 *   ④ 只是「日程过了 / 命中跳过词」而不再同步的，**不能**反过来删用户日历里的历史。
 *
 * 纯函数测试：不读盘、不碰真实 Apple 日历。
 * 用法：pnpm check:reconcile（先 tsc 编译，跑 lib/ 里的产物）
 */
import { planCalendarReconcile } from '../lib/domains/calendar-sync/reconcile.js'

let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name} ${extra}`) }
}

const item = (id) => ({ id, title: id, date: '2026-10-20' })

console.log('\nA. 补漏')
{
  const targets = [item('a'), item('b'), item('c')]
  const mapped = { b: { uid: 'U1', calendar: '工作' } }
  const plan = planCalendarReconcile({ targets, mapped, aliveIds: targets.map((t) => t.id) })
  ok('已同步的不再补建', plan.toCreate.map((t) => t.id).join(',') === 'a,c')
  ok('原样返回事项对象（还要用 title/date）', plan.toCreate[0].title === 'a')
  ok('没有可删的', plan.toRemove.length === 0)
}

console.log('\nB. 清理只认「事项已被删除」')
{
  const targets = [item('a')]
  // b：事项已删除；c：事项还在，只是规则上不再同步（例如日程过了 / 命中跳过词）
  const mapped = { a: { uid: 'U1' }, b: { uid: 'U2' }, c: { uid: 'U3' } }
  const plan = planCalendarReconcile({ targets, mapped, aliveIds: ['a', 'c'] })
  ok('事项已删除 → 删事件', plan.toRemove.join(',') === 'b', `实际 ${plan.toRemove.join(',')}`)
  ok('规则上不再同步但事项还在 → 不删', !plan.toRemove.includes('c'))
  ok('已同步且仍在 → 不补建', plan.toCreate.length === 0)
}

console.log('\nC. 单轮上限')
{
  const targets = Array.from({ length: 120 }, (_, i) => item(`x${i}`))
  const plan = planCalendarReconcile({ targets, mapped: {}, aliveIds: targets.map((t) => t.id), limit: 50 })
  ok('补建不超过 limit', plan.toCreate.length === 50, `实际 ${plan.toCreate.length}`)
  ok('limit=0 时一个都不建', planCalendarReconcile({ targets, mapped: {}, aliveIds: [], limit: 0 }).toCreate.length === 0)
}

console.log('\nD. 空转（正常情况）')
{
  const targets = [item('a'), item('b')]
  const mapped = { a: { uid: 'U1' }, b: { uid: 'U2' } }
  const plan = planCalendarReconcile({ targets, mapped, aliveIds: ['a', 'b'] })
  ok('无事可做 → 两边都是空（不产生 osascript 调用）', plan.toCreate.length === 0 && plan.toRemove.length === 0)
}

console.log(`\n通过 ${pass} / 失败 ${fail}`)
if (fail > 0) process.exit(1)
console.log('日历自动对账判定自测全部通过 ✓')
