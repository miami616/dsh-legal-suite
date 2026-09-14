/**
 * 律师小工具 — 日期工具（纯函数，本地时区，YYYY-MM-DD 为唯一外部格式）。
 *
 * 节假日表覆盖 2025–2026（国务院办公厅放假通知），用于：
 *   • 期间届满日遇法定休假日的顺延（民诉法第八十五条）；
 *   • 「工作日」口径的内部排期换算（非法定口径，仅作提前量参考）。
 */

export const DAY_MS = 24 * 60 * 60 * 1000

/** 2025 年法定休假（休息日）——国办发明电〔2024〕7 号。 */
const HOLIDAYS_2025 = [
  '2025-01-01',
  '2025-01-28', '2025-01-29', '2025-01-30', '2025-01-31', '2025-02-01', '2025-02-02', '2025-02-03', '2025-02-04',
  '2025-04-04', '2025-04-05', '2025-04-06',
  '2025-05-01', '2025-05-02', '2025-05-03', '2025-05-04', '2025-05-05',
  '2025-05-31', '2025-06-01', '2025-06-02',
  '2025-10-01', '2025-10-02', '2025-10-03', '2025-10-04', '2025-10-05', '2025-10-06', '2025-10-07', '2025-10-08',
]

/** 2025 年调休上班日（周末但为工作日）。 */
const WORKDAYS_2025 = ['2025-01-26', '2025-02-08', '2025-04-27', '2025-09-28', '2025-10-11']

/** 2026 年法定休假（休息日）——国办发明电〔2025〕7 号。 */
const HOLIDAYS_2026 = [
  '2026-01-01', '2026-01-02', '2026-01-03',
  '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
  '2026-04-04', '2026-04-05', '2026-04-06',
  '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
  '2026-06-19', '2026-06-20', '2026-06-21',
  '2026-09-25', '2026-09-26', '2026-09-27',
  '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07',
]

/** 2026 年调休上班日。 */
const WORKDAYS_2026 = ['2026-01-04', '2026-02-14', '2026-02-28', '2026-05-09', '2026-09-20', '2026-10-10']

const HOLIDAY_SET = new Set<string>([...HOLIDAYS_2025, ...HOLIDAYS_2026])
const WORKDAY_SET = new Set<string>([...WORKDAYS_2025, ...WORKDAYS_2026])

/** 节假日数据覆盖的年份（超出范围只按周末判断）。 */
export const HOLIDAY_YEARS = [2025, 2026]

/** 解析 YYYY-MM-DD（或 YYYY/MM/DD）为本地日期；非法返回 null。 */
export function parseDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : startOfDay(value)
  const text = String(value ?? '').trim()
  if (text === '') return null
  const m = text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/)
  if (m === null) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
  return date
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function today(): Date {
  return startOfDay(new Date())
}

/** 格式化为 YYYY-MM-DD。 */
export function formatDate(date: Date): string {
  const y = String(date.getFullYear()).padStart(4, '0')
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 中文日期（2026年9月13日）。 */
export function formatDateCn(date: Date): string {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

const WEEKDAYS_CN = ['日', '一', '二', '三', '四', '五', '六']

/** 星期几（周日）。 */
export function weekdayCn(date: Date): string {
  return `星期${WEEKDAYS_CN[date.getDay()] ?? ''}`
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

/** 加月（对应日不存在时取月末，民诉法期间的「到期月对应日」规则）。 */
export function addMonths(date: Date, months: number): Date {
  const year = date.getFullYear()
  const month = date.getMonth() + months
  const day = date.getDate()
  const lastDay = new Date(year, month + 1, 0).getDate()
  return new Date(year, month, Math.min(day, lastDay))
}

export function addYears(date: Date, years: number): Date {
  return addMonths(date, years * 12)
}

/** 相差天数（b - a，按自然日）。 */
export function diffDays(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY_MS)
}

export function isHoliday(date: Date): boolean {
  return HOLIDAY_SET.has(formatDate(date))
}

export function isAdjustedWorkday(date: Date): boolean {
  return WORKDAY_SET.has(formatDate(date))
}

/** 周末（未考虑调休）。 */
export function isWeekend(date: Date): boolean {
  const day = date.getDay()
  return day === 0 || day === 6
}

/** 休息日：法定休假 ∪ 周末 − 调休上班日。 */
export function isRestDay(date: Date): boolean {
  if (isAdjustedWorkday(date)) return false
  if (isHoliday(date)) return true
  return isWeekend(date)
}

export function isWorkday(date: Date): boolean {
  return !isRestDay(date)
}

/** 下一个工作日（含当日：当日是工作日则返回当日）。 */
export function nextWorkday(date: Date): Date {
  let cursor = startOfDay(date)
  for (let i = 0; i < 400; i += 1) {
    if (isWorkday(cursor)) return cursor
    cursor = addDays(cursor, 1)
  }
  return cursor
}

/** 两个日期之间的工作日数（含尾不含头，用于期间换算）。 */
export function countWorkdays(from: Date, to: Date): number {
  let count = 0
  let cursor = startOfDay(from)
  const end = startOfDay(to)
  while (cursor.getTime() < end.getTime()) {
    if (isWorkday(cursor)) count += 1
    cursor = addDays(cursor, 1)
  }
  return count
}

/** 从 from 起（不含 from）数 n 个工作日的最后一个工作日。 */
export function addWorkdays(from: Date, n: number): Date {
  let cursor = startOfDay(from)
  let left = n
  let guard = 0
  while (left > 0 && guard < 4000) {
    cursor = addDays(cursor, 1)
    if (isWorkday(cursor)) left -= 1
    guard += 1
  }
  return cursor
}

/** 今天的 YYYY-MM-DD。 */
export function todayString(): string {
  return formatDate(today())
}
