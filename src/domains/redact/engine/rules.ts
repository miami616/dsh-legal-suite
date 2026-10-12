/**
 * 脱敏规则层（层①）：正则 + 校验位/上下文约束 + 确定性掩码。
 *
 * 设计原则「零误报优先」：
 *   - 身份证/统一社会信用代码必须过**官方校验位**（GB 11643 / GB 32100），
 *     随机数字串几乎不可能通过，误报率≈0；
 *   - 银行账号只在「账号/卡号/开户」等上下文窗口内启用（16–19 位纯数字与
 *     身份证、案号、金额高度混淆，无上下文一律不动）；
 *   - 金额默认**不打码**（多为案件要素，打了材料就不可用），由配置开启。
 *
 * 本层只做「确定的、可解释的」替换，绝不猜测。
 */
import type { EntityKind, Span } from './types.ts'

export interface Rule {
  /** 稳定 id（报告/审计用）。 */
  id: string
  kind: EntityKind
  label: string
  /** 必须带 g 标志。 */
  pattern: RegExp
  /** 校验函数：返回 false 即不算命中。 */
  validate?: (value: string) => boolean
  /** 掩码函数（确定性，可经映射还原）。 */
  mask: (value: string) => string
  /** 命中处前后窗口内必须出现其中之一（上下文门）。 */
  requireContext?: string[]
  /** 上下文半径（默认 24 字）。 */
  contextRadius?: number
  /** 可选规则：默认关闭，需配置开启（如金额）。 */
  optional?: boolean
}

/* ------------------------------------------------------------------ 校验位 */

/** GB 11643 身份证校验位权重与映射。 */
const ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2] as const
const ID_CHECK = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'] as const

/** 18 位身份证号合法性：格式 + 出生日期真实存在 + 校验位。 */
export function isValidIdCard(value: string): boolean {
  if (!/^\d{17}[\dXx]$/.test(value)) return false
  const year = Number(value.slice(6, 10))
  const month = Number(value.slice(10, 12))
  const day = Number(value.slice(12, 14))
  const nowYear = new Date().getFullYear()
  if (year < 1900 || year > nowYear) return false
  if (month < 1 || month > 12 || day < 1 || day > 31) return false
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return false
  let sum = 0
  for (let i = 0; i < 17; i += 1) sum += Number(value[i]) * ID_WEIGHTS[i]!
  return ID_CHECK[sum % 11] === value[17]!.toUpperCase()
}

/** GB 32100 统一社会信用代码字符集（去掉 I O S V Z）。 */
const CC_CHARS = '0123456789ABCDEFGHJKLMNPQRTUWXY'
const CC_WEIGHTS = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28] as const

/** 18 位统一社会信用代码合法性（校验位）。 */
export function isValidCreditCode(value: string): boolean {
  if (!/^[0-9A-HJ-NP-RT-UW-Y]{18}$/.test(value)) return false
  let sum = 0
  for (let i = 0; i < 17; i += 1) {
    const idx = CC_CHARS.indexOf(value[i]!)
    if (idx < 0) return false
    sum += idx * CC_WEIGHTS[i]!
  }
  const check = 31 - (sum % 31)
  const expected = check === 31 ? '0' : CC_CHARS[check]!
  return expected === value[17]
}

/* -------------------------------------------------------------------- 掩码 */

/** 保留前 3 后 4，中间打码（身份证/护照等 11 位以上值）。 */
export function maskKeep3Last4(value: string): string {
  if (value.length <= 7) return '*'.repeat(value.length)
  return `${value.slice(0, 3)}${'*'.repeat(value.length - 7)}${value.slice(-4)}`
}

/** 保留前 4 后 4（18 位代码/账号）。 */
export function maskKeep4Last4(value: string): string {
  if (value.length <= 8) return '*'.repeat(value.length)
  return `${value.slice(0, 4)}${'*'.repeat(value.length - 8)}${value.slice(-4)}`
}

/** 手机号：138****5678。 */
export function maskPhone(value: string): string {
  if (value.length !== 11) return maskKeep3Last4(value)
  return `${value.slice(0, 3)}****${value.slice(-4)}`
}

/** 邮箱：a***@domain。 */
export function maskEmail(value: string): string {
  const at = value.indexOf('@')
  if (at <= 0) return '***'
  const local = value.slice(0, at)
  const domain = value.slice(at)
  return `${local.slice(0, 1)}***${domain}`
}

/** 金额：保留头两位，其余打码（¥12***）。 */
export function maskAmount(value: string): string {
  const digits = value.replace(/[^\d]/g, '')
  if (digits.length <= 2) return '***'
  const head = value.slice(0, Math.min(2, value.length))
  return `${head}${'*'.repeat(Math.max(3, digits.length - 2))}`
}

/* -------------------------------------------------------------------- 规则 */

/**
 * 规则顺序即优先级：先登记的规则先占区间（重叠时后来者让位）。
 * 身份证（强校验）先于信用代码：18 位纯数字且过身份证校验必是身份证。
 * 账号类必须带上下文，且放在身份证/信用代码之后兜剩余。
 */
export const RULES: readonly Rule[] = [
  {
    id: 'idcard',
    kind: 'idCard',
    label: '身份证号',
    pattern: /(?<![0-9A-Za-z])\d{17}[\dXx](?![0-9A-Za-z])/g,
    validate: isValidIdCard,
    mask: maskKeep3Last4,
  },
  {
    id: 'creditcode',
    kind: 'creditCode',
    label: '统一社会信用代码',
    pattern: /(?<![0-9A-Za-z])[0-9A-HJ-NP-RT-UW-Y]{18}(?![0-9A-Za-z])/g,
    validate: isValidCreditCode,
    mask: maskKeep4Last4,
  },
  {
    id: 'phone-mobile',
    kind: 'phone',
    label: '手机号',
    pattern: /(?<!\d)1[3-9]\d{9}(?!\d)/g,
    mask: maskPhone,
  },
  {
    id: 'bank-account',
    kind: 'bankAccount',
    label: '银行账号',
    pattern: /(?<!\d)\d{16,19}(?!\d)/g,
    requireContext: ['银行', '账号', '帐号', '卡号', '账户', '开户', '支行'],
    contextRadius: 24,
    mask: maskKeep4Last4,
  },
  {
    id: 'email',
    kind: 'email',
    label: '邮箱',
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    mask: maskEmail,
  },
  {
    id: 'passport',
    kind: 'passport',
    label: '护照号',
    pattern: /(?<![0-9A-Za-z])[EGDSPH][0-9]{8}(?![0-9A-Za-z])/g,
    mask: maskKeep3Last4,
  },
  {
    id: 'amount',
    kind: 'amount',
    label: '金额',
    pattern: /(?:[¥￥]\s?\d[\d,]*(?:\.\d+)?)|(?:\d[\d,]*(?:\.\d+)?\s*(?:元|万元))/g,
    mask: maskAmount,
    optional: true,
  },
] as const

/** 判断两区间是否重叠。 */
function overlaps(spans: readonly Span[], start: number, end: number): boolean {
  for (const span of spans) {
    if (start < span.end && end > span.start) return true
  }
  return false
}

/** 跑规则层，返回命中区间（不含与已占区间重叠的部分）。 */
export function collectRuleSpans(text: string, options: { maskAmounts?: boolean } = {}): Span[] {
  const spans: Span[] = []
  for (const rule of RULES) {
    if (rule.optional === true && options.maskAmounts !== true) continue
    const flags = rule.pattern.flags.includes('g') ? rule.pattern.flags : `${rule.pattern.flags}g`
    const re = new RegExp(rule.pattern.source, flags)
    for (;;) {
      const match = re.exec(text)
      if (match === null) break
      const value = match[0]
      if (value.length === 0) { re.lastIndex += 1; continue }
      const start = match.index
      const end = start + value.length
      if (rule.validate !== undefined && !rule.validate(value)) continue
      if (rule.requireContext !== undefined) {
        const radius = rule.contextRadius ?? 24
        const window = text.slice(Math.max(0, start - radius), Math.min(text.length, end + radius))
        if (!rule.requireContext.some((word) => window.includes(word))) continue
      }
      if (overlaps(spans, start, end)) continue
      spans.push({
        start, end, matched: value, kind: rule.kind,
        replacement: rule.mask(value), origin: 'rule', ruleId: rule.id,
      })
    }
  }
  return spans
}

/** 按类别取确定性掩码（词典层命中结构性数据时用，如当事人电话）。 */
export function maskForKind(kind: EntityKind, value: string): string {
  switch (kind) {
    case 'phone': return maskPhone(value)
    case 'idCard': return maskKeep3Last4(value)
    case 'creditCode': return maskKeep4Last4(value)
    case 'bankAccount': return maskKeep4Last4(value)
    case 'email': return maskEmail(value)
    case 'passport': return maskKeep3Last4(value)
    case 'amount': return maskAmount(value)
    default: return value
  }
}
