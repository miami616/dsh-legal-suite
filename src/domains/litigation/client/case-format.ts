/**
 * Formatting helpers for the case board — mirrors AgentLex caseFormat intent
 * (amount, dates, time-ago) without importing AgentLex's Tailwind coupling.
 */

/** 【】wrapped placeholder text (【尚未立案】/【待确认】…) is not real info. */
export function isPlaceholder(value: string | number | undefined | null): boolean {
  if (value === undefined || value === null) return false
  return /^【.+】$/.test(String(value).trim())
}

/** Parse a claim-amount string into a number (handles "1,000,000" / "10万"). */
export function parseAmountValue(value: string | number | undefined | null): number {
  if (value === undefined || value === null || value === '') return 0
  const trimmed = String(value).replace(/[,\s]/g, '')
  const match = /^([0-9.]+)\s*(万|亿)?/.exec(trimmed)
  if (!match) return 0
  let n = Number(match[1])
  if (match[2] === '万') n *= 10_000
  if (match[2] === '亿') n *= 100_000_000
  return n
}

/** Format a number as a compact amount string with 万/亿 units. */
export function formatAmount(value: number): string {
  if (!Number.isFinite(value) || value === 0) return ''
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(2)}亿`
  if (value >= 10_000) return `${(value / 10_000).toFixed(value >= 1_000_000 ? 0 : 1)}万`
  return value.toLocaleString('zh-CN')
}

/** Today's date as YYYY-MM-DD (local). */
export function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Whole days from today to a YYYY-MM-DD date (negative = past). */
export function daysUntil(date: string): number {
  const today = new Date(todayStr()).getTime()
  const target = new Date(`${date}T00:00:00`).getTime()
  return Math.round((target - today) / 86_400_000)
}

/** "3天后 / 今天 / 昨天 / 5天前" style relative label. */
export function relativeDays(date: string): string {
  const diff = daysUntil(date)
  if (diff > 0) return `${diff}天后`
  if (diff === 0) return '今天'
  if (diff === -1) return '昨天'
  return `${-diff}天前`
}

/** Localized date label: YYYY-MM-DD → "2026-03-01" (kept machine-readable). */
export function formatDate(date: string | number | undefined | null): string {
  if (date === undefined || date === null || date === '') return ''
  return String(date).slice(0, 10)
}

/** "x分钟前 / x小时前 / x天前" from an ISO timestamp. */
export function timeAgo(iso: string | undefined | null): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return ''
  const diff = Date.now() - then
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes}分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}天前`
  return new Date(iso).toLocaleDateString('zh-CN')
}
