/**
 * 律师小工具 — 金额解析 / 格式化 / 人民币大写。
 */

const DIGITS = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖']
const UNITS = ['', '拾', '佰', '仟']
const SECTIONS = ['', '万', '亿', '万亿']

/** 解析金额：支持 1,234,567.89 / 100万 / 1.5亿 / ￥1234。非法返回 null。 */
export function parseAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  let text = String(value ?? '').trim()
  if (text === '') return null
  text = text.replace(/[￥¥,\s元]/g, '')
  let multiplier = 1
  if (text.endsWith('亿')) {
    multiplier = 100000000
    text = text.slice(0, -1)
  } else if (text.endsWith('万')) {
    multiplier = 10000
    text = text.slice(0, -1)
  } else if (text.endsWith('千')) {
    multiplier = 1000
    text = text.slice(0, -1)
  }
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null
  const num = Number(text) * multiplier
  return Number.isFinite(num) ? num : null
}

/** 千分位格式化（默认 2 位小数，去掉无意义的 .00）。 */
export function formatYuan(value: number, decimals = 2): string {
  const fixed = value.toFixed(decimals)
  const [intPart = '0', decPart] = fixed.split('.')
  const sign = intPart.startsWith('-') ? '-' : ''
  const digitsOnly = sign === '' ? intPart : intPart.slice(1)
  const grouped = digitsOnly.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const body = decPart === undefined ? grouped : `${grouped}.${decPart}`
  return `${sign}${body}`
}

/** 金额（元，2 位小数）+ 千分位。 */
export function yuan(value: number): string {
  return `¥${formatYuan(Math.round(value * 100) / 100)}`
}

/** 把「元」金额折算成中文大写（支持到万亿位，负数加「负」）。 */
export function rmbUppercase(value: number): string {
  if (!Number.isFinite(value)) return ''
  const negative = value < 0
  let num = Math.abs(value)
  // 四舍五入到分
  num = Math.round(num * 100) / 100
  const intPart = Math.floor(num)
  const cents = Math.round((num - intPart) * 100)
  const jiao = Math.floor(cents / 10)
  const fen = cents % 10

  let text = intToChinese(intPart)
  if (text === '') text = '零'
  text = `${text}元`
  if (jiao === 0 && fen === 0) text = `${text}整`
  else {
    if (jiao > 0) text = `${text}${DIGITS[jiao]}角`
    else if (intPart > 0) text = `${text}零`
    if (fen > 0) text = `${text}${DIGITS[fen]}分`
  }
  return negative ? `负${text}` : text
}

/** 整数部分转中文大写（内部用）。 */
function intToChinese(value: number): string {
  if (value === 0) return '零'
  const sections: number[] = []
  let rest = value
  while (rest > 0) {
    sections.push(rest % 10000)
    rest = Math.floor(rest / 10000)
  }
  let out = ''
  let zeroPending = false
  for (let i = sections.length - 1; i >= 0; i -= 1) {
    const section = sections[i] as number
    const sectionText = sectionToChinese(section)
    if (section === 0) {
      if (out !== '') zeroPending = true
      continue
    }
    if (out !== '' && (zeroPending || section < 1000)) out += '零'
    out += `${sectionText}${SECTIONS[i] ?? ''}`
    zeroPending = false
  }
  return out
}

function sectionToChinese(section: number): string {
  let out = ''
  let zeroPending = false
  const digits = [Math.floor(section / 1000) % 10, Math.floor(section / 100) % 10, Math.floor(section / 10) % 10, section % 10]
  for (let i = 0; i < 4; i += 1) {
    const digit = digits[i] as number
    const unit = UNITS[3 - i] ?? ''
    if (digit === 0) {
      if (out !== '') zeroPending = true
      continue
    }
    if (zeroPending) {
      out += '零'
      zeroPending = false
    }
    out += `${DIGITS[digit]}${unit}`
  }
  return out
}

/** 中文数字（小写，用于「十五日」这类表述）。 */
export function chineseNumber(value: number): string {
  const cn = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九']
  if (value < 10) return cn[value] ?? String(value)
  if (value === 10) return '十'
  if (value < 20) return `十${cn[value - 10] ?? ''}`
  if (value < 100) {
    const tens = Math.floor(value / 10)
    const ones = value % 10
    return `${cn[tens] ?? ''}十${ones === 0 ? '' : cn[ones] ?? ''}`
  }
  return String(value)
}
