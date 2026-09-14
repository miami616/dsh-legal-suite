/**
 * 律师小工具 — 贷款市场报价利率（LPR）历史表 + 分段取数。
 *
 * 数据来源：中国人民银行授权全国银行间同业拆借中心公布，
 * 中国银行「贷款市场报价利率（LPR）」页面转录的完整月度报价
 * （2019-08-20 新机制首期 → 2026-08-20）。每月 20 日（遇节假日顺延）报价，
 * 报价在下一次发布前有效。
 *
 * 2019-08-20 之前无 LPR：按中国人民银行同期同档次贷款基准利率取值
 * （1 年期 4.35%、5 年以上 4.90%，2015-10-24 起施行）。
 */

/** 一期报价：[生效日, 1年期%, 5年期以上%]。 */
export type LprQuote = [string, number, number]

export const LPR_QUOTES: LprQuote[] = [
  ['2019-08-20', 4.25, 4.85],
  ['2019-09-20', 4.20, 4.85],
  ['2019-10-21', 4.20, 4.85],
  ['2019-11-20', 4.15, 4.80],
  ['2019-12-20', 4.15, 4.80],
  ['2020-01-20', 4.15, 4.80],
  ['2020-02-20', 4.05, 4.75],
  ['2020-03-20', 4.05, 4.75],
  ['2020-04-20', 3.85, 4.65],
  ['2020-05-20', 3.85, 4.65],
  ['2020-06-22', 3.85, 4.65],
  ['2020-07-20', 3.85, 4.65],
  ['2020-08-20', 3.85, 4.65],
  ['2020-09-21', 3.85, 4.65],
  ['2020-10-20', 3.85, 4.65],
  ['2020-11-20', 3.85, 4.65],
  ['2020-12-21', 3.85, 4.65],
  ['2021-01-20', 3.85, 4.65],
  ['2021-02-22', 3.85, 4.65],
  ['2021-03-22', 3.85, 4.65],
  ['2021-04-20', 3.85, 4.65],
  ['2021-05-20', 3.85, 4.65],
  ['2021-06-21', 3.85, 4.65],
  ['2021-07-20', 3.85, 4.65],
  ['2021-08-20', 3.85, 4.65],
  ['2021-09-22', 3.85, 4.65],
  ['2021-10-20', 3.85, 4.65],
  ['2021-11-22', 3.85, 4.65],
  ['2021-12-20', 3.80, 4.65],
  ['2022-01-20', 3.70, 4.60],
  ['2022-02-21', 3.70, 4.60],
  ['2022-03-21', 3.70, 4.60],
  ['2022-04-20', 3.70, 4.60],
  ['2022-05-20', 3.70, 4.45],
  ['2022-06-20', 3.70, 4.45],
  ['2022-07-20', 3.70, 4.45],
  ['2022-08-22', 3.65, 4.30],
  ['2022-09-20', 3.65, 4.30],
  ['2022-10-20', 3.65, 4.30],
  ['2022-11-21', 3.65, 4.30],
  ['2022-12-20', 3.65, 4.30],
  ['2023-01-20', 3.65, 4.30],
  ['2023-02-20', 3.65, 4.30],
  ['2023-03-20', 3.65, 4.30],
  ['2023-04-20', 3.65, 4.30],
  ['2023-05-22', 3.65, 4.30],
  ['2023-06-20', 3.55, 4.20],
  ['2023-07-20', 3.55, 4.20],
  ['2023-08-21', 3.45, 4.20],
  ['2023-09-20', 3.45, 4.20],
  ['2023-10-20', 3.45, 4.20],
  ['2023-11-20', 3.45, 4.20],
  ['2023-12-20', 3.45, 4.20],
  ['2024-01-22', 3.45, 4.20],
  ['2024-02-20', 3.45, 3.95],
  ['2024-03-20', 3.45, 3.95],
  ['2024-04-22', 3.45, 3.95],
  ['2024-05-20', 3.45, 3.95],
  ['2024-06-20', 3.45, 3.95],
  ['2024-07-22', 3.35, 3.85],
  ['2024-08-20', 3.35, 3.85],
  ['2024-09-20', 3.35, 3.85],
  ['2024-10-21', 3.10, 3.60],
  ['2024-11-20', 3.10, 3.60],
  ['2024-12-20', 3.10, 3.60],
  ['2025-01-20', 3.10, 3.60],
  ['2025-02-20', 3.10, 3.60],
  ['2025-03-20', 3.10, 3.60],
  ['2025-04-21', 3.10, 3.60],
  ['2025-05-20', 3.00, 3.50],
  ['2025-06-20', 3.00, 3.50],
  ['2025-07-21', 3.00, 3.50],
  ['2025-08-20', 3.00, 3.50],
  ['2025-09-22', 3.00, 3.50],
  ['2025-10-20', 3.00, 3.50],
  ['2025-11-20', 3.00, 3.50],
  ['2025-12-22', 3.00, 3.50],
  ['2026-01-20', 3.00, 3.50],
  ['2026-02-24', 3.00, 3.50],
  ['2026-03-20', 3.00, 3.50],
  ['2026-04-20', 3.00, 3.50],
  ['2026-05-20', 3.00, 3.50],
  ['2026-06-22', 3.00, 3.50],
  ['2026-07-20', 3.00, 3.50],
  ['2026-08-20', 3.00, 3.50],
]

/** 表内最后一期报价日期 + 利率（用于「当前 LPR」显示与默认值）。 */
export const LPR_LATEST: LprQuote = LPR_QUOTES[LPR_QUOTES.length - 1] as LprQuote

/** 2019-08-20 前的贷款基准利率（1 年期 / 5 年以上）。 */
export const BENCHMARK_BEFORE_LPR = { oneYear: 4.35, fiveYear: 4.90 }

/** 期限品种。 */
export type LprTerm = '1y' | '5y'

function quoteRate(quote: LprQuote, term: LprTerm): number {
  return term === '1y' ? quote[1] : quote[2]
}

/**
 * 取某日有效的 LPR（年化百分数）。
 * 2019-08-20 之前返回同期贷款基准利率。
 */
export function lprOn(date: string, term: LprTerm = '1y'): number {
  if (date < (LPR_QUOTES[0] as LprQuote)[0]) {
    return term === '1y' ? BENCHMARK_BEFORE_LPR.oneYear : BENCHMARK_BEFORE_LPR.fiveYear
  }
  let rate = quoteRate(LPR_QUOTES[0] as LprQuote, term)
  for (const quote of LPR_QUOTES) {
    if (quote[0] <= date) rate = quoteRate(quote, term)
    else break
  }
  return rate
}

/** 最近一次报价（含当日）的生效日与利率。 */
export function lprQuoteOn(date: string, term: LprTerm = '1y'): { since: string; rate: number } {
  if (date < (LPR_QUOTES[0] as LprQuote)[0]) {
    return { since: '2015-10-24', rate: term === '1y' ? BENCHMARK_BEFORE_LPR.oneYear : BENCHMARK_BEFORE_LPR.fiveYear }
  }
  let since = (LPR_QUOTES[0] as LprQuote)[0]
  let rate = quoteRate(LPR_QUOTES[0] as LprQuote, term)
  for (const quote of LPR_QUOTES) {
    if (quote[0] <= date) {
      since = quote[0]
      rate = quoteRate(quote, term)
    } else break
  }
  return { since, rate }
}

/**
 * 把 [from, to]（含头不含尾）按 LPR 报价切分为若干区间。
 * @returns 每段 { from, to, rate, since }：to 为该段最后一日（含），rate 为年化百分数。
 */
export function lprSegments(from: string, to: string, term: LprTerm = '1y'): Array<{ from: string; to: string; rate: number; since: string }> {
  const segments: Array<{ from: string; to: string; rate: number; since: string }> = []
  if (from >= to) return segments
  let cursor = from
  let guard = 0
  while (cursor < to && guard < 1000) {
    const { since, rate } = lprQuoteOn(cursor, term)
    // 该利率的失效点：下一次报价生效日
    let nextSince: string | null = null
    for (const quote of LPR_QUOTES) {
      if (quote[0] > since) {
        nextSince = quote[0]
        break
      }
    }
    const segEndExclusive = nextSince !== null && nextSince < to ? nextSince : to
    segments.push({ from: cursor, to: segEndExclusive, rate, since })
    cursor = segEndExclusive
    guard += 1
  }
  return segments
}
