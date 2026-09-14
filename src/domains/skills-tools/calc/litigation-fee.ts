/**
 * 律师小工具 — 诉讼费用测算。
 *
 * 依据：《诉讼费用交纳办法》（国务院令第 481 号，2007-04-01 施行）
 *   第十三条 案件受理费（财产案件分段累计 / 非财产案件 / 知产 / 劳动 / 行政）；
 *   第十四条 申请费（执行、保全、支付令、公示催告、撤销仲裁裁决、破产、海事）；
 *   第十五条 调解结案或撤诉减半；
 *   第十六条 适用简易程序减半；
 *   第十八条 反诉、有独立请求权第三人请求合并审理的分别减半。
 * 幅度标准（如离婚 50–300 元）由省级政府在幅度内定，测算取上限为默认值，可手动覆盖。
 */
import { money, num, oneOf, str, bool } from './input.ts'
import { yuan } from './money.ts'
import type { CalcResult } from './types.ts'

interface PropertyTier {
  from: number
  to: number
  rate: number
  flat?: number
  label: string
}

/** 财产案件受理费分段（第十三条第一项）。 */
export const PROPERTY_TIERS: PropertyTier[] = [
  { from: 0, to: 10000, rate: 0, flat: 50, label: '不超过1万元' },
  { from: 10000, to: 100000, rate: 0.025, label: '1万–10万元部分' },
  { from: 100000, to: 200000, rate: 0.02, label: '10万–20万元部分' },
  { from: 200000, to: 500000, rate: 0.015, label: '20万–50万元部分' },
  { from: 500000, to: 1000000, rate: 0.01, label: '50万–100万元部分' },
  { from: 1000000, to: 2000000, rate: 0.009, label: '100万–200万元部分' },
  { from: 2000000, to: 5000000, rate: 0.008, label: '200万–500万元部分' },
  { from: 5000000, to: 10000000, rate: 0.007, label: '500万–1000万元部分' },
  { from: 10000000, to: 20000000, rate: 0.006, label: '1000万–2000万元部分' },
  { from: 20000000, to: Number.POSITIVE_INFINITY, rate: 0.005, label: '2000万元以上部分' },
]

export interface PropertyFeeRow {
  label: string
  part: number
  rate: number
  fee: number
}

/** 财产案件受理费（分段累计）。 */
export function propertyAcceptanceFee(amount: number): { total: number; rows: PropertyFeeRow[] } {
  const rows: PropertyFeeRow[] = []
  let total = 0
  for (const tier of PROPERTY_TIERS) {
    if (amount <= tier.from) break
    const top = Math.min(amount, tier.to)
    const part = top - tier.from
    const fee = tier.flat !== undefined ? tier.flat : part * tier.rate
    rows.push({ label: tier.label, part, rate: tier.rate, fee })
    total += fee
  }
  return { total, rows }
}

/** 由受理费反算标的额（费用单调不减，取最小标的额）。 */
export function propertyAmountFromFee(fee: number): number | null {
  if (!Number.isFinite(fee) || fee < 50) return null
  if (fee === 50) return 10000
  let low = 10000
  let high = 1_000_000_000_000
  for (let i = 0; i < 100; i += 1) {
    const mid = (low + high) / 2
    if (propertyAcceptanceFee(mid).total >= fee) high = mid
    else low = mid
  }
  return Math.round(high)
}

/** 执行申请费（第十四条第一项）。 */
export function executionFee(amount: number): { total: number; rows: PropertyFeeRow[] } {
  const tiers: PropertyTier[] = [
    { from: 0, to: 10000, rate: 0, flat: 50, label: '不超过1万元' },
    { from: 10000, to: 500000, rate: 0.015, label: '1万–50万元部分' },
    { from: 500000, to: 5000000, rate: 0.01, label: '50万–500万元部分' },
    { from: 5000000, to: 10000000, rate: 0.005, label: '500万–1000万元部分' },
    { from: 10000000, to: Number.POSITIVE_INFINITY, rate: 0.001, label: '1000万元以上部分' },
  ]
  return accumulate(amount, tiers)
}

/** 保全申请费（第十四条第二项，最高 5000 元）。 */
export function preservationFee(amount: number): { total: number; rows: PropertyFeeRow[]; capped: boolean } {
  const tiers: PropertyTier[] = [
    { from: 0, to: 1000, rate: 0, flat: 30, label: '不超过1000元或不涉及财产数额' },
    { from: 1000, to: 100000, rate: 0.01, label: '1000元–10万元部分' },
    { from: 100000, to: Number.POSITIVE_INFINITY, rate: 0.005, label: '10万元以上部分' },
  ]
  const { total, rows } = accumulate(amount, tiers)
  const capped = total > 5000
  return { total: Math.min(total, 5000), rows, capped }
}

function accumulate(amount: number, tiers: PropertyTier[]): { total: number; rows: PropertyFeeRow[] } {
  const rows: PropertyFeeRow[] = []
  let total = 0
  for (const tier of tiers) {
    if (amount <= tier.from) break
    const top = Math.min(amount, tier.to)
    const part = top - tier.from
    const fee = tier.flat !== undefined ? tier.flat : part * tier.rate
    rows.push({ label: tier.label, part, rate: tier.rate, fee })
    total += fee
  }
  return { total, rows }
}

/** 非财产案件/其他案件受理费（不含减半）。 */
function nonPropertyFee(caseType: string, amount: number, baseFee: number | null): { fee: number; rows: PropertyFeeRow[] } {
  const rows: PropertyFeeRow[] = []
  switch (caseType) {
    case '离婚': {
      const base = baseFee ?? 300
      rows.push({ label: '离婚案件每件（法定幅度 50–300 元，取上限）', part: 0, rate: 0, fee: base })
      if (amount > 200000) {
        const fee = (amount - 200000) * 0.005
        rows.push({ label: '财产分割超过 20 万元的部分（0.5%）', part: amount - 200000, rate: 0.005, fee })
      }
      return { fee: rows.reduce((sum, r) => sum + r.fee, 0), rows }
    }
    case '人格权': {
      const base = baseFee ?? 500
      rows.push({ label: '人格权案件每件（法定幅度 100–500 元，取上限）', part: 0, rate: 0, fee: base })
      if (amount > 50000) {
        const mid = Math.min(amount, 100000) - 50000
        if (mid > 0) rows.push({ label: '赔偿金额 5 万–10 万元部分（1%）', part: mid, rate: 0.01, fee: mid * 0.01 })
        if (amount > 100000) {
          const high = amount - 100000
          rows.push({ label: '赔偿金额 10 万元以上部分（0.5%）', part: high, rate: 0.005, fee: high * 0.005 })
        }
      }
      return { fee: rows.reduce((sum, r) => sum + r.fee, 0), rows }
    }
    case '其他非财产': {
      const base = baseFee ?? 100
      rows.push({ label: '其他非财产案件每件（法定幅度 50–100 元，取上限）', part: 0, rate: 0, fee: base })
      return { fee: base, rows }
    }
    case '劳动争议': {
      rows.push({ label: '劳动争议案件每件 10 元', part: 0, rate: 0, fee: 10 })
      return { fee: 10, rows }
    }
    case '行政-商标专利海事': {
      rows.push({ label: '商标、专利、海事行政案件每件 100 元', part: 0, rate: 0, fee: 100 })
      return { fee: 100, rows }
    }
    case '行政-其他': {
      rows.push({ label: '其他行政案件每件 50 元', part: 0, rate: 0, fee: 50 })
      return { fee: 50, rows }
    }
    default: {
      const base = baseFee ?? 100
      rows.push({ label: '非财产案件每件（取上限，可手动覆盖）', part: 0, rate: 0, fee: base })
      return { fee: base, rows }
    }
  }
}

const CASE_TYPES = [
  '财产案件', '离婚', '人格权', '其他非财产', '知识产权', '劳动争议',
  '行政-商标专利海事', '行政-其他',
] as const

const OTHER_TYPES = ['支付令', '公示催告', '撤销仲裁裁决', '破产', '管辖权异议'] as const

/** 诉讼费测算主入口。 */
export function calcLitigationFee(input: Record<string, unknown>): CalcResult {
  const mode = oneOf(input, 'mode', ['acceptance', 'execution', 'preservation', 'other'] as const, 'acceptance')
  const amount = money(input, 'amount', 0)
  const notes: string[] = []
  const summary: CalcResult['summary'] = []
  const tables: CalcResult['tables'] = []

  if (mode === 'acceptance') {
    const caseType = oneOf(input, 'caseType', CASE_TYPES, '财产案件')
    const baseFeeRaw = str(input, 'baseFee')
    const baseFee = baseFeeRaw === '' ? null : num(input, 'baseFee', 0)
    const inverse = bool(input, 'inverse', false)

    if (inverse) {
      const targetFee = money(input, 'targetFee', 0)
      const reversed = propertyAmountFromFee(targetFee)
      if (reversed === null) {
        return { title: '诉讼费测算 · 受理费反算', summary: [], error: '受理费低于 50 元，无法反算标的额（财产案件受理费最低 50 元）。' }
      }
      summary.push({ label: '对应标的额（约）', value: yuan(reversed), emphasis: true })
      summary.push({ label: '校验：该标的额受理费', value: yuan(propertyAcceptanceFee(reversed).total) })
      notes.push('受理费 50 元对应标的额不超过 1 万元。')
      notes.push('依据：《诉讼费用交纳办法》第十三条第一项（分段累计）。')
      return { title: '诉讼费测算 · 受理费反算', summary, notes }
    }

    if (caseType !== '财产案件' && !Number.isFinite(amount)) {
      // 非财产类金额可缺省
    }
    if (amount < 0) {
      return { title: '诉讼费测算', summary: [], error: '标的额不能为负数。' }
    }

    let rawFee = 0
    if (caseType === '财产案件') {
      if (amount <= 0) return { title: '诉讼费测算', summary: [], error: '财产案件请填写诉讼请求的金额或价额。' }
      const { total, rows } = propertyAcceptanceFee(amount)
      rawFee = total
      tables.push({
        caption: '分段累计明细',
        columns: ['分段', '计入金额', '费率', '小计'],
        rows: rows.map((r) => [r.label, yuan(r.part), r.rate === 0 ? '每件 50 元' : `${(r.rate * 100).toFixed(1)}%`, yuan(r.fee)]),
      })
    } else if (caseType === '知识产权') {
      const hasAmount = amount > 0 && bool(input, 'ipHasAmount', amount > 0)
      if (hasAmount) {
        const { total, rows } = propertyAcceptanceFee(amount)
        rawFee = total
        tables.push({
          caption: '知识产权案件（有争议金额，按财产案件标准）分段明细',
          columns: ['分段', '计入金额', '费率', '小计'],
          rows: rows.map((r) => [r.label, yuan(r.part), r.rate === 0 ? '每件 50 元' : `${(r.rate * 100).toFixed(1)}%`, yuan(r.fee)]),
        })
      } else {
        const base = baseFee ?? 1000
        rawFee = base
        tables.push({ caption: '没有争议金额', columns: ['项目', '金额'], rows: [['每件（法定幅度 500–1000 元，取上限）', yuan(base)]] })
      }
    } else {
      const result = nonPropertyFee(caseType, amount, baseFee)
      rawFee = result.fee
      tables.push({
        caption: '费用构成',
        columns: ['项目', '计入金额', '费率', '小计'],
        rows: result.rows.map((r) => [r.label, r.part === 0 ? '—' : yuan(r.part), r.rate === 0 ? '—' : `${(r.rate * 100).toFixed(1)}%`, yuan(r.fee)]),
      })
    }

    const procedure = oneOf(input, 'procedure', ['普通程序', '简易程序'] as const, '普通程序')
    const closing = oneOf(input, 'closing', ['判决', '调解', '撤诉'] as const, '判决')
    const simplified = procedure === '简易程序'
    const settled = closing !== '判决'
    const halved = simplified || settled
    const finalFee = halved ? rawFee / 2 : rawFee

    summary.push({ label: '案件受理费', value: yuan(finalFee), emphasis: true })
    if (halved) {
      summary.push({ label: '未减半金额', value: yuan(rawFee) })
      summary.push({
        label: '减半依据',
        value: [simplified ? '简易程序（第十六条）' : '', settled ? `${closing}结案（第十五条）` : ''].filter(Boolean).join(' + '),
      })
      notes.push('依《诉讼费用交纳办法》第十五、十六条，不重复减半（同时满足简易程序与调解结案的仍只减半一次）。')
    }
    notes.push('反诉、有独立请求权第三人提出与本案有关的诉讼请求并合并审理的，依第十八条分别减半交纳。')
    notes.push('依据：《诉讼费用交纳办法》第十三条。幅度标准由省级政府在幅度内规定，本测算取上限，可手动覆盖。')
    notes.push('本结果为规则测算参考，实际以受诉法院核定金额为准。')
    return { title: '诉讼费测算 · 案件受理费', summary, tables, notes }
  }

  if (mode === 'execution') {
    if (amount <= 0) {
      summary.push({ label: '执行申请费（无执行金额）', value: yuan(500), emphasis: true })
      notes.push('没有执行金额或者价额的，每件交纳 50 元至 500 元；测算取上限 500 元。')
    } else {
      const { total, rows } = executionFee(amount)
      summary.push({ label: '执行申请费', value: yuan(total), emphasis: true })
      tables.push({
        caption: '分段累计明细',
        columns: ['分段', '计入金额', '费率', '小计'],
        rows: rows.map((r) => [r.label, yuan(r.part), r.rate === 0 ? '每件 50 元' : `${(r.rate * 100).toFixed(1)}%`, yuan(r.fee)]),
      })
      notes.push('申请执行费由被执行人负担，申请执行时不预交（《诉讼费用交纳办法》第二十条）。')
    }
    notes.push('依据：《诉讼费用交纳办法》第十四条第一项。')
    return { title: '诉讼费测算 · 执行申请费', summary, tables, notes }
  }

  if (mode === 'preservation') {
    if (amount <= 0) {
      summary.push({ label: '保全申请费（不涉及财产数额）', value: yuan(30), emphasis: true })
      notes.push('财产数额不超过 1000 元或者不涉及财产数额的，每件交纳 30 元。')
    } else {
      const { total, rows, capped } = preservationFee(amount)
      summary.push({ label: '保全申请费', value: yuan(total), emphasis: true })
      if (capped) summary.push({ label: '提示', value: '已适用 5000 元封顶', hint: '按分段累计为 ' + yuan(rows.reduce((s, r) => s + r.fee, 0)) })
      tables.push({
        caption: '分段累计明细',
        columns: ['分段', '计入金额', '费率', '小计'],
        rows: rows.map((r) => [r.label, yuan(r.part), r.rate === 0 ? '每件 30 元' : `${(r.rate * 100).toFixed(1)}%`, yuan(r.fee)]),
      })
      notes.push('当事人申请保全措施交纳的费用最多不超过 5000 元。')
    }
    notes.push('依据：《诉讼费用交纳办法》第十四条第二项。')
    return { title: '诉讼费测算 · 保全申请费', summary, tables, notes }
  }

  // mode === 'other'
  const otherType = oneOf(input, 'otherType', OTHER_TYPES, '支付令')
  switch (otherType) {
    case '支付令': {
      const base = amount > 0 ? amount : money(input, 'amount', 0)
      const target = base > 0 ? base : num(input, 'baseAmount', 0)
      if (target <= 0) return { title: '诉讼费测算 · 其他申请费', summary: [], error: '支付令请填写债权标的额。' }
      const fee = propertyAcceptanceFee(target).total / 3
      summary.push({ label: '支付令申请费', value: yuan(fee), emphasis: true })
      summary.push({ label: '财产案件受理费', value: yuan(propertyAcceptanceFee(target).total), hint: '按标的额分段累计' })
      notes.push('依法申请支付令的，比照财产案件受理费标准的 1/3 交纳（第十四条第三项）。')
      break
    }
    case '公示催告':
      summary.push({ label: '公示催告申请费', value: yuan(100), emphasis: true })
      notes.push('依法申请公示催告的，每件交纳 100 元（第十四条第四项）。')
      break
    case '撤销仲裁裁决':
      summary.push({ label: '申请费', value: yuan(400), emphasis: true })
      notes.push('申请撤销仲裁裁决或者认定仲裁协议效力的，每件交纳 400 元（第十四条第五项）。')
      break
    case '破产': {
      if (amount <= 0) return { title: '诉讼费测算 · 其他申请费', summary: [], error: '破产案件请填写破产财产总额。' }
      const half = propertyAcceptanceFee(amount).total / 2
      const fee = Math.min(half, 300000)
      summary.push({ label: '破产案件申请费', value: yuan(fee), emphasis: true })
      if (half > 300000) summary.push({ label: '提示', value: '已适用 30 万元封顶', hint: `减半后为 ${yuan(half)}` })
      notes.push('破产案件依据破产财产总额计算，按照财产案件受理费标准减半交纳，最高不超过 30 万元（第十四条第六项）。')
      break
    }
    case '管辖权异议': {
      const base = str(input, 'baseFee') === '' ? 100 : num(input, 'baseFee', 100)
      summary.push({ label: '管辖权异议申请费（异议不成立）', value: yuan(base), emphasis: true, hint: '法定幅度 50–100 元，取上限' })
      notes.push('当事人提出案件管辖权异议，异议不成立的，每件交纳 50 元至 100 元（第十三条第六项）。')
      break
    }
  }
  notes.push('依据：《诉讼费用交纳办法》第十四条。')
  return { title: '诉讼费测算 · 其他申请费', summary, tables, notes }
}
