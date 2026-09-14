/**
 * 律师小工具 — 利息 / 违约金 / 迟延履行加倍利息测算。
 *
 * 依据：
 *   • 《最高人民法院关于审理民间借贷案件适用法律若干问题的规定》（2020-08-20 修正）：
 *     利率上限为合同成立时一年期 LPR 的 4 倍；逾期利率、违约金、其他费用之和同样受限。
 *   • 《最高人民法院关于适用〈民法典〉合同编通则若干问题的解释》第六十五条：
 *     约定违约金超过造成损失的 30%，一般可认定为「过分高于造成的损失」。
 *   • 《最高人民法院关于执行程序中计算迟延履行期间的债务利息适用法律若干问题的解释》
 *     （法释〔2014〕8 号）第一条：加倍部分债务利息 = 未清偿金钱债务 × 日万分之一点七五 × 迟延天数。
 */
import { addDays, diffDays, formatDate, parseDate, todayString } from './date.ts'
import { bool, money, num, oneOf, str } from './input.ts'
import { lprOn, lprSegments, type LprTerm } from './lpr.ts'
import { formatYuan, yuan } from './money.ts'
import type { CalcResult } from './types.ts'

type Term = LprTerm

function resolveRange(input: Record<string, unknown>): { start: Date; end: Date } | { error: string } {
  const start = parseDate(str(input, 'start', todayString()))
  const end = parseDate(str(input, 'end', todayString()))
  if (start === null) return { error: '起算日格式应为 YYYY-MM-DD。' }
  if (end === null) return { error: '截止日格式应为 YYYY-MM-DD。' }
  if (end.getTime() < start.getTime()) return { error: '截止日不得早于起算日。' }
  return { start, end }
}

/** 计息天数（算头不算尾为默认口径）。 */
function dayCount(start: Date, end: Date, includeEnd: boolean): number {
  const exclusive = includeEnd ? addDays(end, 1) : end
  return Math.max(0, diffDays(start, exclusive))
}

function basisOf(input: Record<string, unknown>): 365 | 360 {
  return num(input, 'basis', 365) === 360 ? 360 : 365
}

/** 利息测算（LPR 分段 / 固定利率）。 */
export function calcInterest(input: Record<string, unknown>): CalcResult {
  const principal = money(input, 'principal', 0)
  if (principal <= 0) return { title: '利息测算', summary: [], error: '请填写计息本金。' }
  const range = resolveRange(input)
  if ('error' in range) return { title: '利息测算', summary: [], error: range.error }
  const { start, end } = range
  const includeEnd = oneOf(input, 'convention', ['exclude-end', 'include-end'] as const, 'exclude-end') === 'include-end'
  const basis = basisOf(input)
  const rateMode = oneOf(input, 'rateMode', ['lpr', 'fixed'] as const, 'lpr')
  const term = oneOf(input, 'term', ['1y', '5y'] as const, '1y') as Term
  const multiplier = num(input, 'multiplier', 1)
  const notes: string[] = []
  const tables: CalcResult['tables'] = []

  const endExclusive = formatDate(includeEnd ? addDays(end, 1) : end)
  const startStr = formatDate(start)

  if (rateMode === 'fixed') {
    const rate = num(input, 'fixedRate', 0)
    const days = dayCount(start, end, includeEnd)
    const interest = principal * (rate / 100) / basis * days
    return {
      title: '利息测算 · 固定利率',
      summary: [
        { label: '利息合计', value: yuan(interest), emphasis: true },
        { label: '计息天数', value: `${days} 天`, hint: `${startStr} 起算，年利率 ${rate}%，按 ${basis} 天/年` },
        { label: '本息合计', value: yuan(principal + interest) },
      ],
      notes: ['日利率 = 年利率 ÷ ' + basis + '；口径为' + (includeEnd ? '算头算尾' : '算头不算尾') + '。'],
    }
  }

  const segments = lprSegments(startStr, endExclusive, term)
  if (segments.length === 0) {
    return { title: '利息测算 · LPR', summary: [], error: '起止日区间内没有可用的计息天数。' }
  }
  const rows: string[][] = []
  let total = 0
  let totalDays = 0
  for (const segment of segments) {
    const segFrom = parseDate(segment.from) as Date
    const segTo = parseDate(segment.to) as Date
    const days = Math.max(0, diffDays(segFrom, segTo))
    if (days <= 0) continue
    const rate = segment.rate * multiplier
    const interest = principal * (rate / 100) / basis * days
    total += interest
    totalDays += days
    rows.push([
      `${segment.from} 至 ${formatDate(addDays(segTo, -1))}`,
      `${days}`,
      `${segment.rate}%${multiplier === 1 ? '' : ` × ${multiplier}`}`,
      `${formatYuan((rate / 100 / basis) * 10000, 4)}`,
      yuan(interest),
    ])
  }
  tables.push({
    caption: `LPR 分段计息（${term === '1y' ? '1 年期' : '5 年期以上'}${multiplier === 1 ? '' : ` × ${multiplier}`}）`,
    columns: ['区间', '天数', '年利率', '日利率（万分之）', '利息'],
    rows,
  })
  const summary: CalcResult['summary'] = [
    { label: '利息合计', value: yuan(total), emphasis: true },
    { label: '计息天数', value: `${totalDays} 天`, hint: `${startStr} 至 ${formatDate(end)}，${includeEnd ? '算头算尾' : '算头不算尾'}，按 ${basis} 天/年` },
    { label: '本息合计', value: yuan(principal + total) },
    { label: '利率口径', value: `${term === '1y' ? '1 年期 LPR' : '5 年期以上 LPR'}${multiplier === 1 ? '' : ` 的 ${multiplier} 倍`}` },
  ]
  if (startStr < '2019-08-20') {
    notes.push('2019-08-20 之前无 LPR，已按中国人民银行同期同档次贷款基准利率计算（1 年期 4.35%、5 年以上 4.90%）。')
  }
  notes.push('LPR 表为全国银行间同业拆借中心月度报价（2019-08-20 起），按各段实际适用利率分段累加。')
  notes.push('民间借贷利率司法保护上限为合同成立时一年期 LPR 的 4 倍；本测算不自动封顶，请自行核对。')
  notes.push('日计息基数司法实践有 365 与 360 两种口径，本测算按 ' + basis + ' 天/年，可在参数中切换。')
  return { title: '利息测算 · LPR 分段', summary, tables, notes }
}

/** 违约金测算（日万分之 / 年利率 / 月利率 / LPR 倍数 + 上限参考）。 */
export function calcPenalty(input: Record<string, unknown>): CalcResult {
  const base = money(input, 'base', 0)
  if (base <= 0) return { title: '违约金测算', summary: [], error: '请填写计收基数（欠付金额 / 本金）。' }
  const range = resolveRange(input)
  if ('error' in range) return { title: '违约金测算', summary: [], error: range.error }
  const { start, end } = range
  const includeEnd = oneOf(input, 'convention', ['exclude-end', 'include-end'] as const, 'exclude-end') === 'include-end'
  const basis = basisOf(input)
  const kind = oneOf(input, 'kind', ['daily', 'annual', 'monthly', 'lpr'] as const, 'daily')
  const days = dayCount(start, end, includeEnd)
  const startStr = formatDate(start)
  const terms: string[] = []
  const notes: string[] = []
  let amount = 0
  const tables: CalcResult['tables'] = []

  if (kind === 'daily') {
    const rate = num(input, 'dailyRate', 5)
    amount = base * (rate / 10000) * days
    terms.push(`日万分之 ${rate}（日利率 ${(rate / 100).toFixed(4)}%）`)
  } else if (kind === 'annual') {
    const rate = num(input, 'annualRate', 0)
    amount = base * (rate / 100) / basis * days
    terms.push(`年利率 ${rate}%（按 ${basis} 天/年）`)
  } else if (kind === 'monthly') {
    const rate = num(input, 'monthlyRate', 0)
    const dailyRate = rate / 100 / 30
    amount = base * dailyRate * days
    terms.push(`月利率 ${rate}%（按 30 天/月折日）`)
  } else {
    const multiplier = num(input, 'multiplier', 1)
    const term = oneOf(input, 'term', ['1y', '5y'] as const, '1y') as Term
    const endExclusive = formatDate(includeEnd ? addDays(end, 1) : end)
    const segments = lprSegments(startStr, endExclusive, term)
    const rows: string[][] = []
    for (const segment of segments) {
      const segFrom = parseDate(segment.from) as Date
      const segTo = parseDate(segment.to) as Date
      const segDays = Math.max(0, diffDays(segFrom, segTo))
      if (segDays <= 0) continue
      const rate = segment.rate * multiplier
      const part = base * (rate / 100) / basis * segDays
      amount += part
      rows.push([`${segment.from} 至 ${formatDate(addDays(segTo, -1))}`, `${segDays}`, `${rate}%`, yuan(part)])
    }
    tables.push({ caption: 'LPR 分段计算', columns: ['区间', '天数', '年利率', '小计'], rows })
    terms.push(`${term === '1y' ? '1 年期' : '5 年期以上'} LPR 的 ${multiplier} 倍`)
  }

  const contractDate = str(input, 'contractDate', startStr)
  const lprAtContract = lprOn(contractDate, '1y')
  const cap4 = base * ((lprAtContract * 4) / 100) / basis * days
  const ref15 = base * ((lprAtContract * 1.5) / 100) / basis * days
  const ref195 = ref15 * 1.3

  const summary: CalcResult['summary'] = [
    { label: '违约金 / 逾期利息', value: yuan(amount), emphasis: true },
    { label: '计收基数', value: yuan(base) },
    { label: '天数与口径', value: `${days} 天`, hint: `${startStr} 至 ${formatDate(end)}，${includeEnd ? '算头算尾' : '算头不算尾'}` },
    { label: '计费方式', value: terms.join('；') },
  ]
  summary.push({
    label: '是否超过 4 倍 LPR（民间借贷上限）',
    value: amount > cap4 ? `超过（上限约 ${yuan(cap4)}）` : `未超过（上限约 ${yuan(cap4)}）`,
    hint: `合同成立日 ${contractDate} 一年期 LPR ${lprAtContract}%`,
  })
  notes.push('4 倍 LPR 上限仅适用于民间借贷：约定利率、逾期利率、违约金、其他费用之和均不得超过合同成立时一年期 LPR 的 4 倍。')
  notes.push(`参考值：同期 1.5 倍 LPR ≈ ${yuan(ref15)}；1.5 倍 LPR 上浮 30% ≈ ${yuan(ref195)}（违约金过分高于损失的常见裁量参考）。`)
  notes.push('非借贷合同（买卖、租赁、承揽等）的违约金不以 4 倍 LPR 为标准，应以实际损失为基础，兼顾合同履行情况、过错程度、预期利益综合判断；约定超过损失 30% 一般可认定为过分高于损失（合同编通则解释第六十五条）。')
  return { title: '违约金测算', summary, tables, notes }
}

/** 迟延履行期间的加倍部分债务利息（法释〔2014〕8 号）。 */
export function calcDelayInterest(input: Record<string, unknown>): CalcResult {
  const debt = money(input, 'debt', 0)
  if (debt <= 0) return { title: '迟延履行加倍利息', summary: [], error: '请填写尚未清偿的金钱债务金额。' }
  const range = resolveRange(input)
  if ('error' in range) return { title: '迟延履行加倍利息', summary: [], error: range.error }
  const { start, end } = range
  const includeEnd = oneOf(input, 'convention', ['exclude-end', 'include-end'] as const, 'exclude-end') === 'include-end'
  const ratePerDay = num(input, 'dailyRate', 1.75) // 万分之
  const days = dayCount(start, end, includeEnd)
  const amount = debt * (ratePerDay / 10000) * days

  return {
    title: '迟延履行加倍利息 · 加倍部分债务利息',
    summary: [
      { label: '加倍部分债务利息', value: yuan(amount), emphasis: true },
      { label: '计算基数', value: yuan(debt), hint: '未清偿的生效法律文书确定的金钱债务（不含一般债务利息）' },
      { label: '迟延天数', value: `${days} 天`, hint: `${formatDate(start)} 至 ${formatDate(end)}，${includeEnd ? '算头算尾' : '算头不算尾'}` },
      { label: '日利率', value: `万分之 ${ratePerDay}` },
    ],
    notes: [
      '计算公式：加倍部分债务利息 = 未清偿金钱债务 × 日万分之一点七五 × 迟延履行期间（法释〔2014〕8 号第一条）。',
      '自生效法律文书确定的履行期间届满之日起算；分期履行的，自每次履行期间届满之日起算；未确定履行期间的，自法律文书生效之日起算。',
      '一般债务利息另按生效法律文书确定的方法计算（本工具未计入）。',
      '被执行人财产不足清偿全部债务的，先清偿生效法律文书确定的金钱债务，再清偿加倍部分债务利息。',
      '非因被执行人申请而中止/暂缓执行、再审中止执行的期间，不计算加倍部分债务利息。',
    ],
  }
}

/** 是否为「日万分之」口径的显式标记（供 UI 提示）。 */
export function isDailyPenalty(input: Record<string, unknown>): boolean {
  return bool(input, 'dailyFlag', false)
}
