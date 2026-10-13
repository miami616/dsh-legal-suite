/**
 * Apple 日历同步：日历切换 / 失败回滚自测（2026-10-13 回归）。
 *
 * 背景：`syncEventToAppleCalendar` 原本在「目标日历变了」时**先删旧事件、再清 map
 * 条目、然后递归重建**。只要新日历不存在（改名/删除/设置里填错/暂时不可写），
 * 重建就返回 null——用户日历里那条事件已经被删掉了，map 也没了，日程凭空消失
 * 且没有任何提示。2026-10-13 实测复现（测试实例指向一个不存在的日历，
 * 8 条真实日程被删）。现改为「先在新日历建好，成功才删旧的」。
 *
 * 本脚本用一个假的 osascript 执行器（内存里的假日历）跑这几条路径，**不碰真实
 * Apple 日历、也不碰真实 map**（DSH_HOME 指向临时目录）。
 *
 * 用法：pnpm check:calendar（先 tsc 编译，跑 lib/ 里的产物）
 */
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const HOME = mkdtempSync(join(tmpdir(), 'agentlex-calendar-check-'))
process.env.DSH_HOME = HOME

const { syncEventToAppleCalendar, removeAppleCalendarEvent, setOsascriptRunner } =
  await import('../lib/domains/calendar-sync/index.js')

let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`) }
  else { fail++; console.log(`  ❌ ${name} ${extra}`) }
}

/* ─────────── 假日历世界 + 假执行器 ─────────── */
/** calendarName → (uid → title) */
const calendars = new Map()
let uidSeq = 0
const uidOf = () => `UID-${++uidSeq}`
const totalEvents = () => [...calendars.values()].reduce((n, m) => n + m.size, 0)
const findByUid = (uid) => {
  for (const [name, events] of calendars) if (events.has(uid)) return { name, events }
  return undefined
}

setOsascriptRunner(async (script) => {
  const nameIn = (re) => re.exec(script)?.[1]

  // 删除：delete ev
  if (script.includes('delete ev')) {
    const uid = nameIn(/whose uid is "([^"]*)"/)
    const hit = uid === undefined ? undefined : findByUid(uid)
    if (hit !== undefined) hit.events.delete(uid)
    return 'ok'
  }
  // 新建：make new event（日历不存在 → 真实 osascript 非 0 退出 → null）
  if (script.includes('make new event')) {
    const cal = nameIn(/first calendar whose name is "([^"]*)"/)
    if (cal === undefined || !calendars.has(cal)) return null
    const uid = uidOf()
    calendars.get(cal).set(uid, nameIn(/summary:"([^"]*)"/) ?? '')
    return uid
  }
  // 更新既有事件（按 uid 定位；找不到返回 NOT_FOUND）
  const calRef = nameIn(/first calendar whose name is "([^"]*)"/)
  const uid = nameIn(/whose uid is "([^"]*)"/)
  if (calRef === undefined || uid === undefined || !calendars.get(calRef)?.has(uid)) return 'NOT_FOUND'
  calendars.get(calRef).set(uid, nameIn(/set summary of ev to "([^"]*)"/) ?? '')
  return uid
})

const mapPath = join(HOME, 'agentlex', 'calendar-sync-map.json')
const readMap = () => (existsSync(mapPath) ? JSON.parse(readFileSync(mapPath, 'utf8')) : {})
const item = (title, calendarName) => ({
  itemId: 'item-1', title, date: '2026-10-21', time: '09:00', detail: '测试', calendarName,
})

console.log('\nA. 新建')
calendars.set('工作', new Map())
const uid1 = await syncEventToAppleCalendar(item('开庭', '工作'))
ok('新建返回 uid', typeof uid1 === 'string' && uid1 !== '')
ok('事件落在目标日历', calendars.get('工作').size === 1)
ok('map 写入 uid + 日历名', readMap()['item-1']?.uid === uid1 && readMap()['item-1']?.calendar === '工作')

console.log('\nB. 同日历更新（幂等，不重复建）')
const uid2 = await syncEventToAppleCalendar(item('开庭（改）', '工作'))
ok('复用同一个 uid', uid2 === uid1)
ok('事件数没有增加', totalEvents() === 1, `实际 ${totalEvents()}`)
ok('标题已更新', calendars.get('工作').get(uid1) === '开庭（改）')

console.log('\nC. 切到存在的另一个日历：先建后删，旧日历清空')
calendars.set('个人', new Map())
const uid3 = await syncEventToAppleCalendar(item('开庭', '个人'))
ok('返回新 uid', typeof uid3 === 'string' && uid3 !== uid1)
ok('新日历有 1 条', calendars.get('个人').size === 1)
ok('旧日历已清空', calendars.get('工作').size === 0)
ok('map 指向新日历', readMap()['item-1']?.calendar === '个人' && readMap()['item-1']?.uid === uid3)

console.log('\nD. 切到不存在的日历（本次回归）：必须原样保留，不能删旧')
const uid4 = await syncEventToAppleCalendar(item('开庭', '__不存在的日历__'))
ok('返回 null（失败）', uid4 === null, `实际 ${JSON.stringify(uid4)}`)
ok('★ 旧事件仍在「个人」', calendars.get('个人').size === 1)
ok('★ map 条目仍在且仍指向「个人」', readMap()['item-1']?.calendar === '个人' && readMap()['item-1']?.uid === uid3)
ok('没有产生半成品：事件总数仍为 1', totalEvents() === 1, `实际 ${totalEvents()}`)

console.log('\nE. 删除路径')
await removeAppleCalendarEvent('item-1')
ok('事件被删除', totalEvents() === 0)
ok('map 条目被清除', readMap()['item-1'] === undefined)

setOsascriptRunner(null)
rmSync(HOME, { recursive: true, force: true })

console.log(`\n通过 ${pass} / 失败 ${fail}`)
if (fail > 0) process.exit(1)
console.log('日历切换/失败回滚自测全部通过 ✓')
