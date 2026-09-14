/**
 * 律师小工具 — 期限计算与日期差。
 *
 * 期间规则（《民事诉讼法》第八十五条及民诉法解释）：
 *   • 期间开始的时和日，不计算在期间内（自次日起算）；
 *   • 期间以月、年计算的，到期月的对应日为期间的最后一日；没有对应日的，月末为最后一日；
 *   • 期间届满的最后一日是法定休假日的，以法定休假日结束的次日为期间届满的日期。
 *
 * 法定期间预设仅作排期参考，具体以现行法律、司法解释与受诉法院要求为准。
 */
import {
  addDays, addMonths, addWorkdays, addYears, countWorkdays, diffDays, formatDate, formatDateCn,
  isWorkday, nextWorkday, parseDate, startOfDay, today, weekdayCn,
} from './date.ts'
import { bool, num, oneOf, str } from './input.ts'
import type { CalcResult } from './types.ts'

export interface PeriodPreset {
  id: string
  label: string
  count: number
  unit: 'day' | 'month' | 'year'
  basis: string
}

/** 常用法定期间（排期参考）。 */
export const PERIOD_PRESETS: PeriodPreset[] = [
  { id: 'appeal-judgment', label: '民事上诉期 · 判决 15 日', count: 15, unit: 'day', basis: '民诉法第一百七十一条：判决书送达之日起 15 日内' },
  { id: 'appeal-order', label: '民事上诉期 · 裁定 10 日', count: 10, unit: 'day', basis: '民诉法第一百七十一条：裁定书送达之日起 10 日内' },
  { id: 'appeal-criminal', label: '刑事上诉期 10 日', count: 10, unit: 'day', basis: '刑诉法第二百三十条：判决 10 日、裁定 5 日' },
  { id: 'defense', label: '答辩期 15 日', count: 15, unit: 'day', basis: '民诉法第一百二十八条：被告收到起诉状副本之日起 15 日内' },
  { id: 'evidence', label: '一审举证期限（不少于 15 日）', count: 15, unit: 'day', basis: '民诉法解释第九十九条：一审普通程序不少于 15 日，以举证通知书为准' },
  { id: 'retrial', label: '申请再审 6 个月', count: 6, unit: 'month', basis: '民诉法第二百一十二条：判决、调解书生效之日起 6 个月内' },
  { id: 'enforce', label: '申请执行 2 年', count: 2, unit: 'year', basis: '民诉法第二百四十六条：申请执行的期间为 2 年' },
  { id: 'arb-limitation', label: '劳动仲裁时效 1 年', count: 1, unit: 'year', basis: '劳动争议调解仲裁法第二十七条：仲裁时效 1 年' },
  { id: 'arb-sue', label: '不服劳动仲裁裁决起诉 15 日', count: 15, unit: 'day', basis: '劳动争议调解仲裁法第五十条：收到裁决书之日起 15 日内' },
  { id: 'preserve-sue', label: '诉前保全后起诉 30 日', count: 30, unit: 'day', basis: '民诉法第一百零四条：诉前保全后 30 日内不起诉的，解除保全' },
  { id: 'admin-review', label: '行政复议申请 60 日', count: 60, unit: 'day', basis: '行政复议法：知道行政行为之日起 60 日内' },
  { id: 'admin-suit', label: '行政诉讼起诉 6 个月', count: 6, unit: 'month', basis: '行政诉讼法第四十六条：知道行政行为之日起 6 个月内' },
  { id: 'state-compensation', label: '国家赔偿请求 2 年', count: 2, unit: 'year', basis: '国家赔偿法第三十九条：2 年内提出' },
  { id: 'case-filing', label: '立案审查 7 日', count: 7, unit: 'day', basis: '民诉法第一百二十六条：符合条件的 7 日内立案' },
]

function nthWorkday(from: Date, n: number): Date {
  if (n <= 1) return isWorkday(from) ? from : nextWorkday(from)
  let cursor = startOfDay(from)
  let counted = isWorkday(cursor) ? 1 : 0
  let guard = 0
  while (counted < n && guard < 4000) {
    cursor = addDays(cursor, 1)
    if (isWorkday(cursor)) counted += 1
    guard += 1
  }
  return cursor
}

/** 期限计算。 */
export function calcPeriod(input: Record<string, unknown>): CalcResult {
  const base = parseDate(str(input, 'baseDate', formatDate(today())))
  if (base === null) return { title: '期限计算', summary: [], error: '基准日格式应为 YYYY-MM-DD。' }
  const count = Math.round(num(input, 'count', 15))
  if (count <= 0) return { title: '期限计算', summary: [], error: '期间长度必须大于 0。' }
  const unit = oneOf(input, 'unit', ['day', 'month', 'year'] as const, 'day')
  const startRule = oneOf(input, 'startRule', ['next-day', 'same-day'] as const, 'next-day')
  const extend = bool(input, 'extend', true)
  const workdayMode = bool(input, 'workdayMode', false) && unit === 'day'
  const presetId = str(input, 'preset', '')
  const preset = PERIOD_PRESETS.find((p) => p.id === presetId)
  const notes: string[] = []

  const start = startRule === 'next-day' ? addDays(base, 1) : base
  let last: Date
  let rawLast: Date
  if (workdayMode) {
    last = nthWorkday(start, count)
    rawLast = last
  } else if (unit === 'day') {
    last = addDays(start, count - 1)
    rawLast = last
  } else if (unit === 'month') {
    last = addMonths(start, count)
    rawLast = last
  } else {
    last = addYears(start, count)
    rawLast = last
  }

  let extended = false
  if (extend && !workdayMode && !isWorkday(last)) {
    const extendedTo = nextWorkday(last)
    if (extendedTo.getTime() !== last.getTime()) {
      extended = true
      last = extendedTo
    }
  }

  const unitLabel = unit === 'day' ? '日' : unit === 'month' ? '个月' : '年'
  const todayDate = today()
  const remaining = diffDays(todayDate, last)
  const summary: CalcResult['summary'] = [
    { label: '期间届满日', value: `${formatDate(last)}（${weekdayCn(last)}）`, emphasis: true },
    { label: '起算日', value: `${formatDate(start)}（${weekdayCn(start)}）`, hint: startRule === 'next-day' ? '基准日的次日' : '基准日当日' },
    { label: '基准日', value: `${formatDate(base)}（${weekdayCn(base)}）` },
    { label: '期间', value: `${count} ${unitLabel}${workdayMode ? '（工作日口径）' : ''}` },
  ]
  if (extended) {
    summary.push({
      label: '顺延说明',
      value: `原届满日 ${formatDate(rawLast)}（${weekdayCn(rawLast)}）为休假日，顺延至 ${formatDate(last)}`,
    })
  } else if (!workdayMode) {
    summary.push({ label: '顺延说明', value: isWorkday(rawLast) ? '届满日为工作日，未顺延' : '已关闭顺延（按原届满日）' })
  }
  summary.push({
    label: remaining >= 0 ? '距届满还有' : '已届满',
    value: remaining >= 0 ? `${remaining} 天` : `${Math.abs(remaining)} 天`,
    hint: `相对今天 ${formatDate(todayDate)}`,
  })

  notes.push('期间开始的日不计算在期间内，自次日起算（《民事诉讼法》第八十五条）。')
  notes.push('以月、年计算的，到期月的对应日为期间的最后一日；没有对应日的，月末为最后一日。')
  notes.push('期间届满的最后一日是法定休假日的，以休假日结束的次日为届满日；本工具内置 2025–2026 年节假日表（国办发明电〔2024〕7 号、〔2025〕7 号）。')
  if (workdayMode) notes.push('「工作日口径」非法定期间口径，仅用于内部排期与提前量换算。')
  if (preset !== undefined) notes.push(`法定期间依据：${preset.basis}（以现行法律与受诉法院要求为准）。`)
  return { title: '期限计算', summary, notes }
}

/** 日期差计算。 */
export function calcDateDiff(input: Record<string, unknown>): CalcResult {
  const start = parseDate(str(input, 'start', formatDate(today())))
  const end = parseDate(str(input, 'end', formatDate(today())))
  if (start === null || end === null) return { title: '日期差计算', summary: [], error: '起止日期格式应为 YYYY-MM-DD。' }
  const includeEnd = oneOf(input, 'convention', ['exclude-end', 'include-end'] as const, 'exclude-end') === 'include-end'
  const natural = diffDays(start, end) + (includeEnd ? 1 : 0)
  const workdays = countWorkdays(start, end) + (includeEnd && isWorkday(end) ? 1 : 0)
  const weeks = Math.floor(Math.abs(natural) / 7)
  const restDays = natural - workdays

  const summary: CalcResult['summary'] = [
    { label: '自然日天数', value: `${natural} 天`, emphasis: true },
    { label: '工作日天数', value: `${workdays} 天`, hint: '扣除周末与法定节假日（含调休上班）' },
    { label: '其中休息日', value: `${restDays} 天` },
    { label: '约合周数', value: `${weeks} 周${Math.abs(natural) % 7 === 0 ? '' : ` ${Math.abs(natural) % 7} 天`}` },
    { label: '区间', value: `${formatDateCn(start)} 至 ${formatDateCn(end)}`, hint: includeEnd ? '算头算尾' : '算头不算尾' },
  ]
  return {
    title: '日期差计算',
    summary,
    notes: ['自然日用于法定期限核算；工作日口径用于内部排期（节假日表覆盖 2025–2026）。'],
  }
}
