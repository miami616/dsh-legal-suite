/**
 * 律师小工具 — 文书辅助：人民币大写与金额校验。
 */
import { money, str } from './input.ts'
import { formatYuan, parseAmount, rmbUppercase } from './money.ts'
import type { CalcResult } from './types.ts'

/** 人民币大写转换（合同、诉状、票据场景）。 */
export function calcRmbUppercase(input: Record<string, unknown>): CalcResult {
  const raw = str(input, 'amount')
  const amount = raw === '' ? money(input, 'amount', Number.NaN) : parseAmount(raw)
  if (amount === null || !Number.isFinite(amount)) {
    return { title: '金额大写', summary: [], error: '请输入有效金额，如 1234567.89 或 100万。' }
  }
  const rounded = Math.round(amount * 100) / 100
  const jiao = Math.floor(Math.abs(Math.round(rounded * 100)) / 10) % 10
  const fen = Math.abs(Math.round(rounded * 100)) % 10
  const summary: CalcResult['summary'] = [
    { label: '人民币大写', value: rmbUppercase(rounded), emphasis: true },
    { label: '小写', value: `¥${formatYuan(rounded)}` },
    { label: '拆分', value: `${Math.floor(Math.abs(rounded))} 元 ${jiao} 角 ${fen} 分` },
  ]
  return {
    title: '金额大写',
    summary,
    notes: [
      '大写金额到「元」为止的，在「元」后写「整」；有分的不写「整」。',
      '合同、诉状中的金额建议「大写 + 小写」并列，并以大写为准。',
    ],
  }
}
