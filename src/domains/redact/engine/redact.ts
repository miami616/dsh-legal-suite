/**
 * 脱敏管线：规则层 → 词典层 → 启发层（只报告）→ 区间替换 → 报告聚合。
 *
 * 纯函数：不碰 I/O。映射表的读写与落盘由上层（store/tools/routes）负责。
 */
import type {
  EntityKind, KindStat, LexiconEntry, RedactMode, RedactOutcome, RedactReport, Span,
} from './types.ts'
import { KIND_LABELS, isAliasKind } from './types.ts'
import { collectRuleSpans } from './rules.ts'
import { collectLexiconSpans, selectEntries } from './lexicon.ts'
import { collectCandidates } from './heuristic.ts'
import type { MappingDoc, MappingEntity } from '../store/types.ts'

export interface RedactInput {
  text: string
  /** 案件/项目 id，或 'global'（无案件上下文时用全库词条）。 */
  scope: string
  mode: RedactMode
  /** 案件词典（已由 lexicon-source 汇总，含自定义词条）。 */
  entries: readonly LexiconEntry[]
  /** 既有映射（同 scope 重复脱敏时保证假名稳定）。 */
  existing?: Readonly<Record<string, MappingEntity>>
  /** 既有映射是否仍可还原（masked 一经使用即永久 false）。 */
  restorable?: boolean
  /** 金额是否打码（默认 false）。 */
  maskAmounts?: boolean
  /** 是否跑启发层候选（默认 true）。 */
  heuristic?: boolean
  /** 是否并入全库词条（给了案件 id 也跨案匹配，默认 false）。 */
  crossScope?: boolean
  now?: string
}

/** 唯一值按出现次数统计打码样例。 */
function summarize(spans: readonly Span[]): KindStat[] {
  const byKind = new Map<string, { count: number; samples: Set<string> }>()
  for (const span of spans) {
    let bucket = byKind.get(span.kind)
    if (bucket === undefined) { bucket = { count: 0, samples: new Set<string>() }; byKind.set(span.kind, bucket) }
    bucket.count += 1
    if (bucket.samples.size < 5) bucket.samples.add(span.replacement)
  }
  return [...byKind.entries()]
    .map(([kind, bucket]) => ({
      kind,
      label: KIND_LABELS[kind as keyof typeof KIND_LABELS] ?? kind,
      count: bucket.count,
      samples: [...bucket.samples],
    }))
    .sort((a, b) => b.count - a.count || (a.kind < b.kind ? -1 : 1))
}

export function redactText(input: RedactInput): RedactOutcome {
  const now = input.now ?? new Date().toISOString()
  const existing = input.existing ?? {}
  const text = input.text
  const scope = input.scope

  // 层①：确定性规则（校验位/上下文门）。
  const ruleSpans = collectRuleSpans(text, { maskAmounts: input.maskAmounts === true })

  // 层②：案件词典（按 scope 选词条 → 白名单精确匹配 → 假名/掩码）。
  const entries = selectEntries(input.entries, scope, input.crossScope === true)
  const lex = collectLexiconSpans(text, entries, existing, ruleSpans, now)

  // 区间替换：按起点排序（同起点长者优先），从前往后拼接、跳过交叠。
  const spans = [...ruleSpans, ...lex.spans].sort((a, b) => a.start - b.start || b.end - a.end)
  let out = ''
  let cursor = 0
  const appliedSpans: Span[] = []
  for (const span of spans) {
    if (span.start < cursor) continue
    out += text.slice(cursor, span.start) + span.replacement
    cursor = span.end
    appliedSpans.push(span)
  }
  out += text.slice(cursor)

  // 映射：规则命中与词典命中都要登记（reversible 才谈得上还原）。
  const entities: Record<string, MappingEntity> = { ...existing }
  const createdEntities: Record<string, MappingEntity> = {}
  for (const span of ruleSpans) {
    if (entities[span.matched] !== undefined) continue
    const record: MappingEntity = {
      alias: span.replacement,
      kind: span.kind,
      source: `rule:${span.ruleId ?? ''}`,
      createdAt: now,
    }
    entities[span.matched] = record
    createdEntities[span.matched] = record
  }
  for (const [value, record] of Object.entries(lex.entities)) {
    if (existing[value] !== undefined) continue
    entities[value] = record
    createdEntities[value] = record
  }

  // 层③：只报告候选（排除已知词条，避免把已处理的当新候选）。
  const candidates = input.heuristic === false
    ? []
    : collectCandidates(text, {
      exclude: new Set(entries.map((entry) => entry.value)),
      occupied: [...ruleSpans, ...lex.spans],
    })

  // 提示：假名与原文撞名（还原/阅读理解都可能歧义）。
  const warnings: string[] = []
  for (const item of lex.created) {
    if (text.includes(item.alias)) {
      warnings.push(`假名「${item.alias}」在原文中已出现，正文可能产生歧义（建议改名或人工核对）`)
    }
  }

  const report: RedactReport = {
    mode: input.mode,
    scope,
    totalHits: appliedSpans.length,
    byKind: summarize(appliedSpans),
    candidates,
    newAliases: [...lex.created],
    warnings,
    restorable: (input.restorable ?? true) && input.mode === 'reversible',
  }
  return { text: out, spans, report, entities: { ...entities, ...createdEntities } }
}

/**
 * 未登记在映射里的假名/掩码（还原时提示人工处理）。
 *
 * 口径：在**输入文本**（脱敏后待还原的文本）上扫，且排除「某某」这类连写——
 * 否则原文里正常的「某某科技有限公司」会被误报成残留假名。
 * 命中映射的假名不算 missing（它们马上就会被还原）。
 */
function detectMissing(text: string, known: ReadonlySet<string>): Array<{ alias: string; count: number }> {
  // 已知判定用**包含关系**：掩码/假名的正则常只截到一部分（如身份证掩码
  // 110***********002X 会被截成 110***********002），精确相等会误报。
  const isKnownToken = (token: string): boolean => {
    if (known.has(token)) return true
    for (const alias of known) {
      if (alias.includes(token) || token.includes(alias)) return true
    }
    return false
  }
  const patterns = [
    // 「姓+某」（排除连写「某某」）
    /(?<!某)[\u4e00-\u9fa5]某\d*(?!某)/g,
    /(?:机构|项目|案件|案号|地址|实体)[A-Z]{1,3}/g,
    /\d{2,4}\*{3,}\d{0,4}[0-9A-Za-z]?/g,
    /[A-Za-z]\*{3}@[A-Za-z0-9.-]+/g,
  ]
  const counts = new Map<string, number>()
  for (const pattern of patterns) {
    for (;;) {
      const match = pattern.exec(text)
      if (match === null) break
      if (isKnownToken(match[0])) continue
      counts.set(match[0], (counts.get(match[0]) ?? 0) + 1)
    }
  }
  return [...counts.entries()].map(([alias, count]) => ({ alias, count })).sort((a, b) => b.count - a.count)
}

/**
 * 按映射生成「假名 → 原名」的还原区间（文本与 docx 共用）。
 * 多对一（同掩码撞车）记入 ambiguous，交由调用方报告，不硬猜。
 */
export function collectRestoreSpans(
  text: string,
  mapping: MappingDoc,
): { spans: Span[]; ambiguous: string[] } {
  if (!mapping.restorable) {
    throw new Error('该 scope 的映射已在 masked（对外）模式下使用过，按设计不可还原；请用 reversible 模式重新脱敏')
  }
  const reverse = new Map<string, string>()
  const ambiguous = new Set<string>()
  for (const [original, entity] of Object.entries(mapping.entities)) {
    if (entity.alias === original) continue
    const current = reverse.get(entity.alias)
    if (current !== undefined && current !== original) { ambiguous.add(entity.alias); continue }
    reverse.set(entity.alias, original)
  }
  const spans: Span[] = []
  for (const alias of [...reverse.keys()].sort((a, b) => b.length - a.length)) {
    if (ambiguous.has(alias)) continue
    const original = reverse.get(alias)!
    let from = 0
    for (;;) {
      const index = text.indexOf(alias, from)
      if (index < 0) break
      const end = index + alias.length
      if (spans.some((span) => index < span.end && end > span.start)) { from = index + 1; continue }
      spans.push({
        start: index, end, matched: alias, kind: 'custom',
        replacement: original, origin: 'lexicon', source: 'restore',
      })
      from = end
    }
  }
  return { spans, ambiguous: [...ambiguous] }
}

/** 可还原映射的反向表（alias → original），多对一时记为歧义。 */
export function restoreText(text: string, mapping: MappingDoc): {
  text: string
  restored: number
  missing: Array<{ alias: string; count: number }>
  ambiguous: string[]
} {
  if (!mapping.restorable) {
    throw new Error('该 scope 的映射已在 masked（对外）模式下使用过，按设计不可还原；请用 reversible 模式重新脱敏')
  }
  const { spans, ambiguous } = collectRestoreSpans(text, mapping)
  const known = new Set(spans.map((span) => span.matched))
  const missing = detectMissing(text, known)
  let out = ''
  let cursor = 0
  for (const span of spans.sort((a, b) => a.start - b.start)) {
    if (span.start < cursor) continue
    out += text.slice(cursor, span.start) + span.replacement
    cursor = span.end
  }
  out += text.slice(cursor)
  return { text: out, restored: spans.length, missing, ambiguous }
}

/** 仅保留别名类实体（masked 模式落盘用：掩码类原文不留档）。 */
export function aliasKindEntitiesOnly(
  entities: Readonly<Record<string, MappingEntity>>,
): Record<string, MappingEntity> {
  const out: Record<string, MappingEntity> = {}
  for (const [value, entity] of Object.entries(entities)) {
    if (isAliasKind(entity.kind as EntityKind)) out[value] = entity
  }
  return out
}
