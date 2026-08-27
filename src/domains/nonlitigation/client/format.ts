/** Shared date/amount formatting helpers for the non-litigation UI. */

export function todayStr(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

export function daysUntil(date: string | undefined): number {
  if (!date) return Infinity
  const now = new Date()
  const target = new Date(`${date}T00:00:00`)
  return Math.round((target.getTime() - now.getTime()) / 86400000)
}

export function timeAgo(iso: string | undefined): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diff = Date.now() - then
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min}分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}小时前`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}天前`
  const mon = Math.floor(day / 30)
  if (mon < 12) return `${mon}个月前`
  return `${Math.floor(mon / 12)}年前`
}

/** Count tasks across task groups by status. */
export function countTasks(record: {
  taskGroups?: Array<{ tasks?: Array<{ status?: string }> }>
}): { total: number; done: number } {
  let total = 0
  let done = 0
  for (const g of record.taskGroups ?? []) {
    for (const t of g.tasks ?? []) {
      total++
      if (t.status === 'done') done++
    }
  }
  return { total, done }
}

/** Service period end countdown (days). Returns relative day string for a date. */
export function periodDaysLeft(end: string | undefined): number | null {
  if (!end) return null
  return daysUntil(end)
}
