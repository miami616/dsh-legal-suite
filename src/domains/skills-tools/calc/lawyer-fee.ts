/**
 * 律师小工具 — 律师费测算（参考）。
 *
 * 重要口径（2026-09 核实）：
 *   • 2019 年国家放开律师服务收费后，多数省份政府指导价文件已失效
 *     （山东省发改委 2025-09 答复：《鲁价费发〔2017〕70 号》已失效，不再作为收费依据），
 *     律师费原则上实行市场调节价，由律所与委托人协商，律所标准向律协备案并公示。
 *   • 本测算给的是「常见区间/历史指导价参考」，不是收费依据；实际以律所备案标准与委托合同为准。
 *   • 风险代理上限：《关于进一步规范律师服务收费的意见》（司发通〔2021〕87 号）第三条第（六）项，
 *     分档 18% / 15% / 12% / 9% / 6%；并禁止刑事诉讼、行政诉讼、国家赔偿、群体性诉讼、
 *     婚姻继承，以及请求社会保险待遇、最低生活保障、赡养费、抚养费、扶养费、抚恤金、
 *     救济金、工伤赔偿、劳动报酬的案件实行风险代理。
 */
import { money, num, oneOf, str } from './input.ts'
import { yuan } from './money.ts'
import type { CalcResult } from './types.ts'

interface FeeTier {
  from: number
  to: number
  low: number
  high: number
  label: string
}

interface FeePreset {
  id: string
  name: string
  /** 基础服务费区间（涉及财产关系案件）。 */
  baseLow: number
  baseHigh: number
  /** 不涉及财产关系案件的计件区间。 */
  flatLow: number
  flatHigh: number
  tiers: FeeTier[]
  note: string
}

const TIER = (from: number, to: number, low: number, high: number, label: string): FeeTier => ({ from, to, low, high, label })

export const LAWYER_FEE_PRESETS: FeePreset[] = [
  {
    id: 'shandong-2017',
    name: '山东 · 2017 指导价（已失效，历史参考）',
    baseLow: 1000,
    baseHigh: 2000,
    flatLow: 800,
    flatHigh: 10000,
    tiers: [
      TIER(10000, 100000, 0.05, 0.06, '1万–10万元部分'),
      TIER(100000, 1000000, 0.04, 0.05, '10万–100万元部分'),
      TIER(1000000, 5000000, 0.03, 0.04, '100万–500万元部分'),
      TIER(5000000, 10000000, 0.02, 0.03, '500万–1000万元部分'),
      TIER(10000000, 50000000, 0.01, 0.02, '1000万–5000万元部分'),
      TIER(50000000, Number.POSITIVE_INFINITY, 0.005, 0.01, '5000万元以上部分'),
    ],
    note: '《鲁价费发〔2017〕70 号》有效期至 2022-05-31；山东省发改委 2025-09 明确该文件已失效，仅作历史参考。',
  },
  {
    id: 'beijing-2018',
    name: '北京 · 政府指导价参考',
    baseLow: 0,
    baseHigh: 0,
    flatLow: 3000,
    flatHigh: 10000,
    tiers: [
      TIER(0, 100000, 0.08, 0.12, '10万元以下部分'),
      TIER(100000, 1000000, 0.05, 0.07, '10万–100万元部分'),
      TIER(1000000, 10000000, 0.03, 0.05, '100万–1000万元部分'),
      TIER(10000000, 100000000, 0.01, 0.03, '1000万–1亿元部分'),
      TIER(100000000, Number.POSITIVE_INFINITY, 0.005, 0.01, '1亿元以上部分'),
    ],
    note: '北京地区民事诉讼政府指导价参考区间；请以律所备案公示标准为准。',
  },
  {
    id: 'market',
    name: '常见市场区间（协商参考）',
    baseLow: 5000,
    baseHigh: 20000,
    flatLow: 5000,
    flatHigh: 30000,
    tiers: [
      TIER(0, 100000, 0.08, 0.12, '10万元以下部分'),
      TIER(100000, 1000000, 0.06, 0.09, '10万–100万元部分'),
      TIER(1000000, 5000000, 0.05, 0.07, '100万–500万元部分'),
      TIER(5000000, 10000000, 0.04, 0.06, '500万–1000万元部分'),
      TIER(10000000, 50000000, 0.03, 0.05, '1000万–5000万元部分'),
      TIER(50000000, Number.POSITIVE_INFINITY, 0.01, 0.03, '5000万元以上部分'),
    ],
    note: '市场协商常见区间，非法定标准，仅供报价与预算参考。',
  },
]

export function findPreset(id: string): FeePreset {
  return LAWYER_FEE_PRESETS.find((p) => p.id === id) ?? (LAWYER_FEE_PRESETS[2] as FeePreset)
}

/** 风险代理上限（司发通〔2021〕87 号分档）。 */
export const RISK_TIERS = [
  { from: 0, to: 1000000, rate: 0.18, label: '不足 100 万元部分' },
  { from: 1000000, to: 5000000, rate: 0.15, label: '100 万–500 万元部分' },
  { from: 5000000, to: 10000000, rate: 0.12, label: '500 万–1000 万元部分' },
  { from: 10000000, to: 50000000, rate: 0.09, label: '1000 万–5000 万元部分' },
  { from: 50000000, to: Number.POSITIVE_INFINITY, rate: 0.06, label: '5000 万元以上部分' },
]

/** 风险代理禁止适用的案件类型。 */
export const RISK_FORBIDDEN = [
  '刑事诉讼案件', '行政诉讼案件', '国家赔偿案件', '群体性诉讼案件', '婚姻继承案件',
  '请求社会保险待遇、最低生活保障待遇', '赡养费、抚养费、扶养费', '抚恤金、救济金',
  '工伤赔偿', '劳动报酬',
]

export function riskCapFee(amount: number): { total: number; rows: Array<{ label: string; part: number; rate: number; fee: number }> } {
  const rows: Array<{ label: string; part: number; rate: number; fee: number }> = []
  let total = 0
  for (const tier of RISK_TIERS) {
    if (amount <= tier.from) break
    const top = Math.min(amount, tier.to)
    const part = top - tier.from
    const fee = part * tier.rate
    rows.push({ label: tier.label, part, rate: tier.rate, fee })
    total += fee
  }
  return { total, rows }
}

/** 按标的额分段累进（含基础服务费）。 */
function progressiveFee(amount: number, preset: FeePreset): { low: number; high: number; rows: Array<{ label: string; part: number; low: number; high: number }> } {
  const rows: Array<{ label: string; part: number; low: number; high: number }> = []
  let low = preset.baseLow
  let high = preset.baseHigh
  for (const tier of preset.tiers) {
    if (amount <= tier.from) break
    const top = Math.min(amount, tier.to)
    const part = top - tier.from
    rows.push({ label: tier.label, part, low: part * tier.low, high: part * tier.high })
    low += part * tier.low
    high += part * tier.high
  }
  return { low, high, rows }
}

export function calcLawyerFee(input: Record<string, unknown>): CalcResult {
  const mode = oneOf(input, 'mode', ['progressive', 'flat', 'hourly', 'risk'] as const, 'progressive')
  const summary: CalcResult['summary'] = []
  const tables: CalcResult['tables'] = []
  const notes: string[] = []

  if (mode === 'progressive') {
    const amount = money(input, 'amount', 0)
    if (amount <= 0) return { title: '律师费测算', summary: [], error: '按标的额计费请填写争议标的额。' }
    const preset = findPreset(str(input, 'preset', 'market'))
    const { low, high, rows } = progressiveFee(amount, preset)
    summary.push({ label: '律师费参考区间', value: `${yuan(low)} ～ ${yuan(high)}`, emphasis: true })
    summary.push({ label: '折算比例', value: `${((low / amount) * 100).toFixed(2)}% ～ ${((high / amount) * 100).toFixed(2)}%`, hint: '含基础服务费' })
    summary.push({ label: '计费标准', value: preset.name })
    tables.push({
      caption: '分段累进明细',
      columns: ['分段', '计入金额', '下限费率', '上限费率', '下限小计', '上限小计'],
      rows: rows.map((r) => {
        const tier = preset.tiers.find((t) => t.label === r.label)
        return [
          r.label,
          yuan(r.part),
          tier === undefined ? '—' : `${(tier.low * 100).toFixed(1)}%`,
          tier === undefined ? '—' : `${(tier.high * 100).toFixed(1)}%`,
          yuan(r.low),
          yuan(r.high),
        ]
      }),
    })
    if (preset.baseLow > 0) {
      summary.push({ label: '每件基础服务费', value: `${yuan(preset.baseLow)} ～ ${yuan(preset.baseHigh)}`, hint: '已计入上述区间' })
    }
    notes.push(preset.note)
    notes.push('2019 年起律师服务收费原则上实行市场调节价，由律所与委托人协商；律所标准应向律协备案并公示，不得超备案标准收费（司发通〔2021〕87 号）。')
    notes.push('诉讼费、保全费、鉴定费、差旅费等代垫费用不计入律师服务费，由委托人另行支付。')
    notes.push('本测算为参考区间，实际以委托代理合同约定为准。')
    return { title: '律师费测算 · 按标的额分段累进', summary, tables, notes }
  }

  if (mode === 'flat') {
    const preset = findPreset(str(input, 'preset', 'market'))
    const low = str(input, 'feeLow') === '' ? preset.flatLow : num(input, 'feeLow', preset.flatLow)
    const high = str(input, 'feeHigh') === '' ? preset.flatHigh : num(input, 'feeHigh', preset.flatHigh)
    summary.push({ label: '计件收费参考区间', value: `${yuan(Math.min(low, high))} ～ ${yuan(Math.max(low, high))}`, emphasis: true, hint: '不涉及财产关系的案件' })
    summary.push({ label: '计费标准', value: preset.name })
    notes.push(preset.note)
    notes.push('计件收费一般适用于不涉及财产关系的法律事务；复杂、疑难案件可在标准之上协商。')
    return { title: '律师费测算 · 计件收费', summary, notes }
  }

  if (mode === 'hourly') {
    const hours = num(input, 'hours', 0)
    const rate = num(input, 'hourlyRate', 1000)
    if (hours <= 0) return { title: '律师费测算', summary: [], error: '计时收费请填写工作小时数。' }
    const fee = hours * rate
    summary.push({ label: '计时收费合计', value: yuan(fee), emphasis: true })
    summary.push({ label: '计算结果', value: `${hours} 小时 × ${yuan(rate)}/小时` })
    notes.push('计时收费不足一小时的按一小时计；办理法律事务的旅途时间通常折半计算。')
    notes.push('常见区间约 100–3000 元/小时（各省历史指导价 100–2000 元/小时），实际以律所备案标准为准。')
    return { title: '律师费测算 · 计时收费', summary, notes }
  }

  // mode === 'risk'
  const amount = money(input, 'amount', 0)
  const ratio = num(input, 'ratio', 0)
  const forbidden = str(input, 'caseKind')
  if (amount <= 0) return { title: '律师费测算', summary: [], error: '风险代理请填写标的额（实现债权或减免债务金额）。' }
  const { total: cap, rows } = riskCapFee(amount)
  summary.push({ label: '风险代理收费上限', value: yuan(cap), emphasis: true, hint: `占标的额 ${((cap / amount) * 100).toFixed(2)}%` })
  if (ratio > 0) {
    const fee = amount * (ratio / 100)
    summary.push({ label: `约定比例 ${ratio}% 对应金额`, value: yuan(fee), hint: fee > cap ? '超过法定上限部分不受支持' : '未超上限' })
  }
  tables.push({
    caption: '分段上限明细（司发通〔2021〕87 号）',
    columns: ['分段', '计入金额', '上限比例', '上限金额'],
    rows: rows.map((r) => [r.label, yuan(r.part), `${(r.rate * 100).toFixed(0)}%`, yuan(r.fee)]),
  })
  notes.push('风险代理各环节收取的服务费（含基础费用）合计不得超过上述分档上限。')
  notes.push(`禁止风险代理的案件：${RISK_FORBIDDEN.join('、')}。`)
  if (forbidden !== '') notes.push(`你标注的案件类型为「${forbidden}」，请先核对是否属于禁止风险代理范围。`)
  notes.push('风险代理须签订专门书面合同，并就含义、禁止范围、最高收费限额作醒目提示。')
  return { title: '律师费测算 · 风险代理上限', summary, tables, notes }
}
