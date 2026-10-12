/**
 * 启发层（层③）：锚点识别「词典没覆盖」的人名候选，**默认只报告、不替换**。
 *
 * 为什么只报告：启发式必然有误报，误报一旦进正文就是不可逆的破坏。让候选先
 * 进报告，律师确认后用 `terms_add` 入自定义词典，下次脱敏由层②精确命中——
 * 误报永不污染正文，且词典越用越准。
 */
import type { HeuristicCandidate, Span } from './types.ts'

/**
 * 角色锚点 + 紧随其后的 2–4 字中文名。
 *
 * 注意**不能**要求人名后是非中文：实务文书写「被告：王小明到庭」「原告张三诉…」，
 * 名字后面常常直接跟中文动词。改为贪婪取 2–4 字后在 `trimTrailing` 里裁掉尾部的
 * 常见虚词/动词（报告层只报不替，宁可多报也不漏报）。
 */
const ANCHOR = /(原告|被告|上诉人|被上诉人|申请人|被申请人|第三人|法定代表人|委托诉讼代理人|诉讼代理人|代理人|负责人|审判长|审判员|书记员|证人|委托人|被执行人|申请执行人)[：:\s]{0,3}([\u4e00-\u9fa5]{2,4})/g

/** 紧跟人名出现的常见虚词/动词（贪婪捕获后裁掉）。 */
const TRAILING = new Set([
  '到', '说', '称', '辩', '诉', '是', '的', '了', '与', '和', '向', '为', '及', '或',
  '等', '已', '未', '不', '没', '有', '在', '将', '被', '把', '从', '对', '给', '让',
  '使', '因', '由', '于', '自', '至', '后', '前', '中', '内', '外', '上', '下', '又',
  '也', '都', '就', '还', '则', '且', '但', '而', '并', '系', '应', '须', '可', '能',
  '会', '要', '想', '认', '提', '交', '出', '去', '来', '诉', '请', '求', '主', '张',
])

/** 裁掉贪婪多吃的尾部虚词/动词。 */
export function trimTrailing(name: string): string {
  let value = name
  while (value.length > 2 && TRAILING.has(value[value.length - 1]!)) {
    value = value.slice(0, -1)
  }
  return value
}

/** 锚点后常见的非人名（法律文书固定表述），避免噪声候选。 */
const STOP = new Set([
  '意见', '答辩', '陈述', '代理', '律师', '本院', '事实', '请求', '辩称', '认为',
  '主张', '证据', '材料', '清单', '情况', '信息', '电话', '地址', '姓名', '身份',
  '上诉', '起诉', '申请', '执行', '判决', '裁定', '理由', '部分', '内容', '事项',
])

/** 打码展示：王**（首字保留，避免报告本身泄露全名）。 */
export function displayCandidate(name: string): string {
  return `${name.slice(0, 1)}${'*'.repeat(Math.max(2, name.length - 1))}`
}

export function collectCandidates(
  text: string,
  options: { exclude?: ReadonlySet<string>; occupied?: readonly Span[] } = {},
): HeuristicCandidate[] {
  const exclude = options.exclude ?? new Set<string>()
  const occupied = options.occupied ?? []
  const counts = new Map<string, { count: number; anchor: string }>()
  for (;;) {
    const match = ANCHOR.exec(text)
    if (match === null) break
    const anchor = match[1] ?? ''
    const name = trimTrailing(match[2] ?? '')
    if (name.length < 2 || STOP.has(name) || exclude.has(name)) continue
    const start = match.index
    const end = start + match[0].length
    if (occupied.some((span) => start < span.end && end > span.start)) continue
    const prev = counts.get(name)
    if (prev === undefined) counts.set(name, { count: 1, anchor })
    else prev.count += 1
  }
  return [...counts.entries()]
    .map(([name, meta]) => ({ display: displayCandidate(name), anchor: meta.anchor, count: meta.count, value: name }))
    .sort((a, b) => b.count - a.count || (a.display < b.display ? -1 : 1))
    .slice(0, 50)
}
