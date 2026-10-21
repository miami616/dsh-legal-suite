/**
 * 中国法定节假日 / 调休工作日表（用于提醒是否发送）。
 *
 * 数据来源：国办发明电〔2025〕7号《国务院办公厅关于2026年部分节假日安排的通知》
 * https://www.gov.cn/zhengce/content/202511/content_7048922.htm
 *
 * 注意：
 *  - 这里只服务「提醒是否发」；**不用于**法定期限的末日顺延计算（期限引擎有自己的
 *    previousWorkday / rollForward 口径，改动会改变已办案件的届满日，必须单独评估）。
 *  - 2027 年安排尚未公布，先只把元旦当天列为假日，其余按周末判断；公布后补表即可。
 */

export interface WorkdayYear {
  /** 放假日期（含调休形成的连休）。 */
  holidays: string[]
  /** 调休上班的周末。 */
  makeupWorkdays: string[]
}

export const WORKDAY_CALENDAR: Record<number, WorkdayYear> = {
  2026: {
    holidays: [
      // 元旦：1/1–1/3
      '2026-01-01', '2026-01-02', '2026-01-03',
      // 春节：2/15–2/23
      '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19',
      '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
      // 清明：4/4–4/6
      '2026-04-04', '2026-04-05', '2026-04-06',
      // 劳动节：5/1–5/5
      '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
      // 端午：6/19–6/21
      '2026-06-19', '2026-06-20', '2026-06-21',
      // 中秋：9/25–9/27
      '2026-09-25', '2026-09-26', '2026-09-27',
      // 国庆：10/1–10/7
      '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05',
      '2026-10-06', '2026-10-07',
    ],
    makeupWorkdays: [
      '2026-01-04', // 周日上班
      '2026-02-14', '2026-02-28', // 春节调休
      '2026-05-09', // 劳动节调休
      '2026-09-20', '2026-10-10', // 中秋/国庆调休
    ],
  },
  2027: {
    // 2027 年安排未公布；先保证元旦当天不提醒，其余按周末。
    holidays: ['2027-01-01'],
    makeupWorkdays: [],
  },
}

/** 本地日期 YYYY-MM-DD。 */
export function ymd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** 解析 YYYY-MM-DD 为本地正午（避免时区/夏令时边界）。 */
export function parseYmd(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const d = new Date(`${value}T12:00:00`)
  return Number.isNaN(d.getTime()) ? undefined : d
}

/** 加减天数，返回 YYYY-MM-DD。 */
export function addDays(value: string, days: number): string {
  const d = parseYmd(value)
  if (d === undefined) return value
  d.setDate(d.getDate() + days)
  return ymd(d)
}

/** 是否周末。 */
export function isWeekend(value: string): boolean {
  const d = parseYmd(value)
  if (d === undefined) return false
  const day = d.getDay()
  return day === 0 || day === 6
}

/** 是否法定节假日/调休连休。 */
export function isHoliday(value: string): boolean {
  const year = Number(value.slice(0, 4))
  return WORKDAY_CALENDAR[year]?.holidays.includes(value) === true
}

/** 是否调休上班的周末。 */
export function isMakeupWorkday(value: string): boolean {
  const year = Number(value.slice(0, 4))
  return WORKDAY_CALENDAR[year]?.makeupWorkdays.includes(value) === true
}

/**
 * 是否工作日（提醒口径）：
 *  - 调休上班的周末 → 是；
 *  - 法定节假日 → 否；
 *  - 普通周末 → 否；
 *  - 其余 → 是。
 */
export function isWorkday(value: string): boolean {
  if (isMakeupWorkday(value)) return true
  if (isHoliday(value)) return false
  return !isWeekend(value)
}

/** 日期的日历状态，便于日志/设置页解释。 */
export function workdayStatus(value: string): 'workday' | 'weekend' | 'holiday' | 'makeup-workday' {
  if (isMakeupWorkday(value)) return 'makeup-workday'
  if (isHoliday(value)) return 'holiday'
  if (isWeekend(value)) return 'weekend'
  return 'workday'
}

/** 下一个工作日（从 value 的下一天开始找，不含当天）。 */
export function nextWorkday(value: string): string {
  let cursor = addDays(value, 1)
  for (let i = 0; i < 30; i++) {
    if (isWorkday(cursor)) return cursor
    cursor = addDays(cursor, 1)
  }
  return cursor
}

/** 上一个工作日（不含当天）。 */
export function previousWorkday(value: string): string {
  let cursor = addDays(value, -1)
  for (let i = 0; i < 30; i++) {
    if (isWorkday(cursor)) return cursor
    cursor = addDays(cursor, -1)
  }
  return cursor
}

/**
 * 从「明天」到「下一个工作日」之间的非工作日期（含首尾）。
 * 用于最后一个工作日把假期内的开庭/硬期限提前纳入摘要。
 */
export function holidayGap(today: string): string[] {
  if (!isWorkday(today)) return []
  const tomorrow = addDays(today, 1)
  if (isWorkday(tomorrow)) return []
  const next = nextWorkday(today)
  const dates: string[] = []
  let cursor = tomorrow
  while (cursor < next) {
    dates.push(cursor)
    cursor = addDays(cursor, 1)
  }
  return dates
}
