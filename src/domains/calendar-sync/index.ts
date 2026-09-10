/**
 * Apple 日历同步（calendar-sync）——日程建立时自动写入 Apple Calendar。
 *
 * 机制（参考 smart-calendar 的 AppleScript 方案）：用 osascript 直接调用
 * macOS 原生日历应用创建事件，iCloud 自动同步到所有 Apple 设备。
 * 纯 Node child_process + AppleScript，零第三方依赖。
 *
 * 幂等：itemId → Apple 事件 uid 的映射存 $DSH_HOME/agentlex/calendar-sync-map.json，
 * 事件更新时按 uid 更新 Apple 事件（不重复创建），删除时按 uid 删除。
 *
 * 权限：首次调用会触发 macOS「自动化」权限弹窗，需在 系统设置 → 隐私与安全性
 * → 自动化 里授权宿主进程控制 Calendar。
 */
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'

/** 同步映射文件（itemId → { uid, calendar }）。 */
function mapPath(): string {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'agentlex', 'calendar-sync-map.json')
}

interface SyncMapEntry {
  uid: string
  calendar: string
}

function readMap(): Record<string, SyncMapEntry> {
  try {
    const p = mapPath()
    if (!existsSync(p)) return {}
    const raw = JSON.parse(readFileSync(p, 'utf8')) as Record<string, string | SyncMapEntry>
    // 兼容旧格式（纯 uid 字符串）→ 迁移为 { uid, calendar }。
    const out: Record<string, SyncMapEntry> = {}
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === 'string') out[k] = { uid: v, calendar: '' }
      else out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

function writeMap(map: Record<string, SyncMapEntry>): void {
  try {
    const p = mapPath()
    mkdirSync(join(p, '..'), { recursive: true })
    writeFileSync(p, JSON.stringify(map, null, 2), 'utf8')
  } catch (error) {
    console.warn('[calendar-sync] 映射文件写入失败:', error instanceof Error ? error.message : String(error))
  }
}

/** AppleScript 字符串转义：双引号与反斜杠。 */
function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

/** 单条 osascript 超时（毫秒）。Calendar 被 TCC 权限弹窗/繁忙阻塞时进程会挂起，
 *  无超时会让整个手动同步永久 pending——超时后 kill 子进程按失败返回。 */
const OSASCRIPT_TIMEOUT_MS = 20_000

/** 执行 osascript，返回 stdout 首行（去空白）；失败返回 null。 */
function runOsascript(script: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn('osascript', ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      console.warn('[calendar-sync] osascript 超时，已终止进程（Calendar 可能被权限弹窗或繁忙阻塞）')
      try { child.kill('SIGKILL') } catch { /* 进程已退出 */ }
      resolve(null)
    }, OSASCRIPT_TIMEOUT_MS)
    const finish = (value: string | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    child.stdout.on('data', (d: Buffer) => { out += d.toString() })
    child.stderr.on('data', (d: Buffer) => { err += d.toString() })
    child.on('error', (e) => {
      console.warn('[calendar-sync] osascript 启动失败:', e.message)
      finish(null)
    })
    child.on('close', (code) => {
      if (code !== 0) {
        // Calendar 未运行（-600）→ 先拉起应用再重试一次（smart-calendar 同款兜底）。
        if (err.includes('-600')) {
          spawn('open', ['-a', 'Calendar'], { stdio: 'ignore' })
          setTimeout(() => {
            const retry = spawn('osascript', ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] })
            let rOut = ''
            let rErr = ''
            let rSettled = false
            const rTimer = setTimeout(() => {
              if (rSettled) return
              rSettled = true
              try { retry.kill('SIGKILL') } catch { /* 进程已退出 */ }
              finish(null)
            }, OSASCRIPT_TIMEOUT_MS)
            const rFinish = (value: string | null): void => {
              if (rSettled) return
              rSettled = true
              clearTimeout(rTimer)
              finish(value)
            }
            retry.stdout.on('data', (d: Buffer) => { rOut += d.toString() })
            retry.stderr.on('data', (d: Buffer) => { rErr += d.toString() })
            retry.on('close', (rCode) => {
              if (rCode !== 0) {
                console.warn(`[calendar-sync] osascript 重试失败（${rCode}）: ${rErr.trim().slice(0, 200)}`)
                rFinish(null)
              } else {
                rFinish(rOut.trim().split('\n')[0] ?? null)
              }
            })
          }, 1500)
        } else {
          console.warn(`[calendar-sync] osascript 退出码 ${code}: ${err.trim().slice(0, 200)}`)
          finish(null)
        }
      } else {
        finish(out.trim().split('\n')[0] ?? null)
      }
    })
  })
}

export interface CalendarSyncInput {
  /** 业务条目 id（itemId / eventId / taskId），用于幂等映射。 */
  itemId: string
  /** 事件标题（如「开庭 - 2026-042 星微案」）。 */
  title: string
  /** 日期 yyyy-MM-dd。 */
  date: string
  /** 具体时间 HH:mm（可选；无则全天事件）。 */
  time?: string
  /** 描述（案件名/备注等）。 */
  detail?: string
  /** 目标日历名（默认「工作」）。 */
  calendarName?: string
}

/**
 * 创建或更新 Apple 日历事件（幂等：按 itemId 映射 uid）。
 * @returns 成功返回 Apple 事件 uid，失败返回 null。
 */
export async function syncEventToAppleCalendar(input: CalendarSyncInput): Promise<string | null> {
  const cal = input.calendarName ?? '个人'
  const map = readMap()
  const existing = map[input.itemId]

  // 目标日历切换（用户反馈 2026-09-09：同步到哪个日历应可选）：既有事件若在别的
  // 日历，先删旧再按新日历重建（并清 map 条目走新建分支），避免事件留在旧日历、
  // map 却指向新日历导致错位。
  if (existing !== undefined && existing.uid !== '' && existing.calendar !== '' && existing.calendar !== cal) {
    await removeAppleCalendarEvent(input.itemId)
    delete map[input.itemId]
    writeMap(map)
    return syncEventToAppleCalendar({ ...input, itemId: input.itemId })
  }

  // 结束时间：有 time 则 +1 小时；无 time 全天事件。
  // 注意：全天事件的 end 必须用「当天 23:59:59」而不是「次日 00:00:00」——
  // 带 description 字段时 Apple 会把 end=次日 00:00:00 显示为次日 23:59:59，
  // 事件横跨两天（用户实测反馈 2026-09-09）；end=当天 23:59:59 则正常显示一天。
  const startDate = input.time ? `${input.date} ${input.time}:00` : `${input.date} 00:00:00`
  const endDate = input.time
    ? endTimeOf(input.date, input.time)
    : `${input.date} 23:59:59`

  const props = [
    `summary:"${esc(input.title)}"`,
    `start date:date "${startDate}"`,
    `end date:date "${endDate}"`,
    `description:"${esc(input.detail ?? '')}"`,
    // 显式设置 allday：有 time 时 false（更新分支必须显式清除，否则事件从全天
    // 更新为带时间后 allday 状态残留，仍显示全天——用户反馈 2026-09-09）。
    `allday event:${input.time ? 'false' : 'true'}`,
  ]

  let script: string
  if (existing !== undefined && existing.uid !== '') {
    // 更新既有 Apple 事件（AppleScript 的 uid 查询必须指定日历，全局查询会失败）。
    // 注意：不能批量 set properties——Apple 对全天事件批量更新时 start/end 会被
    // 忽略（实测 2026-09-09：allday=true 的事件 set properties 后时间不变）。
    // 必须逐条 set，且先设 allday 再设 start/end（顺序敏感）。
    const calRef = existing.calendar !== '' ? existing.calendar : cal
    script = `
tell application "Calendar"
  try
    set ev to first event of (first calendar whose name is "${esc(calRef)}") whose uid is "${esc(existing.uid)}"
    set summary of ev to "${esc(input.title)}"
    set description of ev to "${esc(input.detail ?? '')}"
    set allday event of ev to ${input.time ? 'false' : 'true'}
    set start date of ev to date "${startDate}"
    set end date of ev to date "${endDate}"
    return uid of ev
  on error
    return "NOT_FOUND"
  end try
end tell`
  } else {
    // 新建
    script = `
tell application "Calendar"
  set targetCal to first calendar whose name is "${esc(cal)}"
  set newEvent to make new event at end of events of targetCal with properties {${props.join(', ')}}
  return uid of newEvent
end tell`
  }

  const uid = await runOsascript(script)
  if (uid === null || uid === 'NOT_FOUND') {
    // 更新失败（事件被删或日历名变化）→ 重建
    if (existing !== undefined && uid === 'NOT_FOUND') {
      delete map[input.itemId]
      writeMap(map)
      return syncEventToAppleCalendar(input)
    }
    return null
  }
  map[input.itemId] = { uid, calendar: cal }
  writeMap(map)
  return uid
}

/** 删除 Apple 日历事件（按 itemId 映射）。 */
export async function removeAppleCalendarEvent(itemId: string): Promise<void> {
  const map = readMap()
  const entry = map[itemId]
  if (entry === undefined || entry.uid === '') return
  const calRef = entry.calendar !== '' ? entry.calendar : '个人'
  const script = `
tell application "Calendar"
  try
    set ev to first event of (first calendar whose name is "${esc(calRef)}") whose uid is "${esc(entry.uid)}"
    delete ev
  end try
end tell`
  await runOsascript(script)
  delete map[itemId]
  writeMap(map)
}

/** 列出 Apple 日历里的全部日历名（供设置页选择同步目标，用户反馈 2026-09-09：
 *  同步到的日历应可选而不是写死；只返回可写日历，排除订阅/只读日历）。
 *  runOsascript 只返回 stdout 首行，这里用 | 分隔符把列表压成单行。 */
export async function listAppleCalendars(): Promise<string[]> {
  const script = `
tell application "Calendar"
  set out to ""
  repeat with c in calendars
    set canWrite to (writable of c)
    if canWrite then
      set out to out & (name of c) & "|"
    end if
  end repeat
  return out
end tell`
  const raw = await runOsascript(script)
  if (raw === null || raw === '') return []
  return raw.split('|').map((s) => s.trim()).filter((s) => s !== '')
}

/** HH:mm + 1 小时 → "yyyy-MM-dd HH:mm:00"。 */
function endTimeOf(date: string, time: string): string {
  const [h, m] = time.split(':').map(Number)
  const d = new Date(`${date}T00:00:00`)
  d.setHours(h + 1, m, 0, 0)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:00`
}

/** yyyy-MM-dd + n 天。 */
function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
