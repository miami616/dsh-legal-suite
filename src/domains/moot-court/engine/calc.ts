/**
 * dsh-legal-suite/moot-court — 金额测算桥（legal_calc）。
 *
 * 方案 §7：判决书中的金额一律由引擎用 `legal_calc` 的返回值回填，禁止模型口算。
 *
 * 本模块从案件快照里提取可测算要素（标的额、日期），调用 legal_calc 的
 * 诉讼费 / 利息 / 违约金 / 迟延履行加倍利息 四项，把结果渲染成模型可读的
 * 「测算清单」注入到裁判者的上下文里。金额无法提取时不测算，并在报告里说明。
 */
import type { Context } from '@deepseek-ai/cordis'
import { callTool, listToolNames } from './tool-call.ts'
import type { Dossier } from '../store/types.ts'

/** 一项测算结果。 */
export interface CalcItem {
  /** 测算项 id（legal_calc 的 action）。 */
  action: string
  /** 输入摘要（人类可读，用于报告与审计）。 */
  input: string
  /** 主结果一行（如「案件受理费：¥5,902.00」）。 */
  summary: string
  /** 完整测算文本（含分段累计明细；legal_calc 的 text 字段原样保留）。 */
  detail?: string
  /** 依据与口径说明。 */
  notes?: string[]
}

/**
 * legal_calc 的真实返回结构（2026-09-24 实测）：
 * `{ title, summary: [{label, value, emphasis}], tables, notes, text }`。
 * `text` 是已经渲染好的人类可读全文（含分段明细），模型与留痕都用它。
 */
interface CalcEnvelope {
  title?: unknown
  summary?: unknown
  tables?: unknown
  notes?: unknown
  text?: unknown
  message?: unknown
}

/** 把 summary 数组渲染成一行文本。 */
function renderSummaryLine(env: CalcEnvelope): string {
  if (Array.isArray(env.summary)) {
    const parts = env.summary.flatMap((entry) => {
      if (entry === null || typeof entry !== 'object') return []
      const item = entry as Record<string, unknown>
      const label = typeof item['label'] === 'string' ? item['label'] : ''
      const value = typeof item['value'] === 'string' ? item['value'] : String(item['value'] ?? '')
      if (value === '') return []
      return [label === '' ? value : `${label}：${value}`]
    })
    if (parts.length > 0) return parts.join('；')
  }
  if (typeof env.title === 'string') return env.title
  return ''
}

/** 从金额文本里取出判决书可直接引用的数额（去货币符号、去 .00）。 */
function normalizeMoney(value: string): string | undefined {
  const match = /([\d,]+(?:\.\d+)?)/.exec(value)
  if (match === null) return undefined
  const raw = match[1]!
  return raw.includes('.') ? raw.replace(/\.0+$/, '') : raw
}

/** 测算汇总。 */
export interface CalcBlock {
  items: CalcItem[]
  /** 渲染好的模型可读文本。 */
  text: string
  /** 未测算原因（无金额要素等）。 */
  skipped?: string
  /**
   * 案件受理费的确定**数额**（如「5,902」，不带单位）。
   * 判决书里的 `{{FEE}}` 占位符由引擎替换成这个数额——不能依赖模型自觉引用，
   * 否则等于把金额交给模型口算。不带单位是刻意的：模型常写成
   * 「案件受理费{{FEE}}元」，回填值若自带「元」就会出现「元元」。
   */
  feeAmount?: string
}

/** 金额（元）。 */
function parseAmount(raw: string, unit: string): number | undefined {
  const value = Number(raw.replace(/,/g, ''))
  if (!Number.isFinite(value) || value <= 0) return undefined
  return unit.startsWith('万') ? value * 10000 : value
}

/**
 * 从文本里提取金额（取最大值作为标的额估计）。
 * 支持「12,345.67 元」「12万元」「12.5万元」。
 */
export function extractAmounts(text: string): number[] {
  const out: number[] = []
  const re = /(\d[\d,]*(?:\.\d+)?)\s*(万元|元)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const amount = parseAmount(match[1] ?? '', match[2] ?? '元')
    if (amount !== undefined) out.push(amount)
  }
  return out
}

/** 从文本里提取日期（归一为 yyyy-MM-dd）。 */
export function extractDates(text: string): string[] {
  const out: string[] = []
  const iso = text.match(/\d{4}-\d{1,2}-\d{1,2}/g) ?? []
  for (const d of iso) {
    const [y, m, day] = d.split('-').map((s) => Number(s))
    if (y === undefined || m === undefined || day === undefined) continue
    out.push(`${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
  }
  const cn = text.match(/\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日/g) ?? []
  for (const d of cn) {
    const m = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/.exec(d)
    if (m === null) continue
    out.push(`${m[1]}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[3])).padStart(2, '0')}`)
  }
  return [...new Set(out)].sort()
}

/** 取 legal_calc 工具名（缺省约定）。 */
function calcToolName(ctx: Context): string | undefined {
  const names = listToolNames(ctx)
  const exact = names.find((n) => n === 'legal_calc')
  if (exact !== undefined) return exact
  return names.find((n) => n.endsWith('legal_calc') || n.includes('legal_calc'))
}

/** 调一次 legal_calc。 */
async function runCalc(
  ctx: Context,
  toolName: string,
  action: string,
  input: Record<string, unknown>,
  inputSummary: string,
  signal: AbortSignal,
): Promise<CalcItem | undefined> {
  const result = await callTool(ctx, toolName, { action, input }, signal)
  if (!result.ok) return undefined
  const env = result.value as CalcEnvelope | undefined
  if (env === undefined || env === null) return undefined
  const summary = renderSummaryLine(env)
  if (summary === '') return undefined
  return {
    action,
    input: inputSummary,
    summary,
    ...(typeof env.text === 'string' && env.text.trim() !== '' ? { detail: env.text.trim() } : {}),
    ...(Array.isArray(env.notes) ? { notes: env.notes.map((n) => String(n)) } : {}),
  }
}

/**
 * 依据案件快照构建测算清单。
 * @param ctx - host 上下文。
 * @param dossier - 案件快照。
 * @param signal - 取消信号。
 */
export async function buildCalcBlock(ctx: Context, dossier: Dossier, signal: AbortSignal): Promise<CalcBlock> {
  const toolName = calcToolName(ctx)
  if (toolName === undefined) {
    return { items: [], text: '', skipped: 'legal_calc 工具未注册（技能与工具域未启用），本次未做金额测算' }
  }

  const corpus = [dossier.claims.join('\n'), dossier.facts ?? '', dossier.priorJudgment ?? ''].join('\n')
  const amounts = extractAmounts(corpus)
  const dates = extractDates(corpus)
  const items: CalcItem[] = []

  const principal = amounts.length > 0 ? Math.max(...amounts) : undefined

  // ① 案件受理费（财产案件标的额）。
  if (principal !== undefined) {
    const item = await runCalc(
      ctx, toolName, 'litigation-fee',
      { mode: 'acceptance', caseType: '财产案件', amount: principal },
      `标的额 ${principal} 元`, signal,
    )
    if (item !== undefined) items.push(item)
  }

  // ② 利息（LPR）：需要本金 + 起止日期。
  const mentionsInterest = /利息|逾期付款|资金占用/.test(corpus)
  if (mentionsInterest && principal !== undefined && dates.length >= 1) {
    const start = dates[0]!
    const end = dates.length >= 2 ? dates[dates.length - 1]! : dates[0]!
    const item = await runCalc(
      ctx, toolName, 'interest',
      { principal, start, end, rateMode: 'lpr' },
      `本金 ${principal} 元，${start} 至 ${end}，按 LPR`, signal,
    )
    if (item !== undefined) items.push(item)
  }

  // ③ 违约金：需要明确约定比例时才测算（避免臆造）。
  const mentionsPenalty = /违约金/.test(corpus)
  if (mentionsPenalty && principal !== undefined) {
    const rateMatch = /(\d+(?:\.\d+)?)\s*(?:‰|千分之|万分之)/.exec(corpus)
    const kind = rateMatch === null ? 'annual' : 'lpr'
    const item = await runCalc(
      ctx, toolName, 'penalty',
      kind === 'annual'
        ? { base: principal, kind: 'annual', annualRate: 0.06045 }
        : { base: principal, kind: 'lpr', multiplier: 1 },
      `基数 ${principal} 元${kind === 'annual' ? '，参照年利率 6.045% 口径' : '，按 LPR 口径'}`, signal,
    )
    if (item !== undefined) items.push(item)
  }

  // ④ 迟延履行加倍利息：执行阶段口径，仅在有生效裁判日期且主张时测算。
  const mentionsDelay = /迟延履行|加倍部分债务利息/.test(corpus)
  if (mentionsDelay && principal !== undefined && dates.length >= 2) {
    const item = await runCalc(
      ctx, toolName, 'delay-interest',
      { debt: principal, start: dates[0]!, end: dates[dates.length - 1]! },
      `债务 ${principal} 元，${dates[0]} 至 ${dates[dates.length - 1]}`, signal,
    )
    if (item !== undefined) items.push(item)
  }

  if (items.length === 0) {
    return {
      items: [],
      text: '',
      skipped: amounts.length === 0
        ? '材料中未提取到明确金额，本次未做金额测算'
        : '材料金额不足以确定测算口径（缺少起止日期或约定比例），本次未做金额测算',
    }
  }

  const lines: string[] = ['（以下金额均由 legal_calc 测算，判决书必须直接采用不得自行计算）']
  items.forEach((item, index) => {
    lines.push(`${index + 1}. 【${item.action}】${item.input}`)
    // detail 是 legal_calc 渲染好的全文（含分段明细），直接给模型，避免只喂一行摘要。
    lines.push(item.detail === undefined ? `   结果：${item.summary}` : item.detail.split('\n').map((l) => `   ${l}`).join('\n'))
    if (item.notes !== undefined && item.notes.length > 0) {
      lines.push(`   · 口径：${item.notes.join('；')}`)
    }
  })
  // 受理费数额交给判决书做占位符回填（确定性，不依赖模型引用）。
  const feeItem = items.find((item) => item.action === 'litigation-fee')
  const feeAmount = feeItem === undefined ? undefined : normalizeMoney(feeItem.summary)
  return {
    items,
    text: lines.join('\n'),
    ...(feeAmount === undefined ? {} : { feeAmount }),
  }
}
