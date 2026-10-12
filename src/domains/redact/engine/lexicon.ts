/**
 * 词典层（层②）：白名单精确匹配 + 假名分配。
 *
 * 匹配口径：
 *   - **全词精确**，不做子串泛化（「山东广播电视台」命中，不给「电视台」单开词条）；
 *   - **长词优先**（先占区间），同长按值排序，保证确定性；
 *   - 被长词完全覆盖的短词**不占区间、也不分配假名**（不留幽灵映射）；
 *   - 规则层已占区间（occupied）**不回扫**。
 */
import type { LexiconEntry, Span } from './types.ts'
import { isAliasKind } from './types.ts'
import { maskForKind } from './rules.ts'
import { assignAliases, type AliasCandidate } from './pseudonym.ts'
import type { MappingEntity } from '../store/types.ts'

export interface LexiconResult {
  spans: Span[]
  created: Array<{ original: string; alias: string; kind: string }>
  /** 既有映射 + 本次新增（调用方落盘）。 */
  entities: Record<string, MappingEntity>
}

function overlapsAny(spans: readonly Span[], start: number, end: number): boolean {
  for (const span of spans) {
    if (start < span.end && end > span.start) return true
  }
  return false
}

/**
 * 按 scope 选词条。
 *   - scope 为具体案件/项目 id：该 scope 的词条 + 全局自定义词条；
 *   - scope 为 'global'（调用方未给案件上下文）：使用全库词条——没有案件可窄化时，
 *     白名单全名匹配的误伤风险很低，比「只认全局词条」有用得多；
 *   - crossScope=true：即使给了案件 id 也并入全库词条（v1.1 可选开关）。
 */
export function selectEntries(
  entries: readonly LexiconEntry[],
  scope: string,
  crossScope = false,
): LexiconEntry[] {
  if (scope === 'global' || crossScope) return [...entries]
  return entries.filter((entry) => entry.scopes.includes(scope) || entry.scopes.includes('global'))
}

/**
 * 跑词典层：找出文本中实际占得住的词条 → 分配假名/掩码 → 产出命中区间。
 * @param occupied - 规则层已占区间（词典命中不得与其重叠）。
 */
export function collectLexiconSpans(
  text: string,
  entries: readonly LexiconEntry[],
  existing: Readonly<Record<string, MappingEntity>>,
  occupied: readonly Span[],
  now: string,
): LexiconResult {
  // 同一个值可能来自多处（当事人 + 法定代表人），合并为一条。
  const byValue = new Map<string, LexiconEntry>()
  for (const entry of entries) {
    const prev = byValue.get(entry.value)
    if (prev === undefined) byValue.set(entry.value, entry)
    else if (prev.note === undefined && entry.note !== undefined) byValue.set(entry.value, { ...prev, note: entry.note })
  }

  // 长词优先排序（同长按值，确定）。
  const ordered = [...byValue.values()]
    .filter((entry) => entry.value.length >= 2 && text.includes(entry.value))
    .sort((a, b) => {
      if (a.value.length !== b.value.length) return b.value.length - a.value.length
      if (a.value === b.value) return 0
      return a.value < b.value ? -1 : 1
    })

  // 先占区间：被长词完全覆盖的短词拿不到任何区间，因而不参与假名分配。
  const occupiedSpans: Span[] = [...occupied]
  const occurrences = new Map<string, Array<[number, number]>>()
  for (const entry of ordered) {
    let from = 0
    for (;;) {
      const index = text.indexOf(entry.value, from)
      if (index < 0) break
      const end = index + entry.value.length
      if (overlapsAny(occupiedSpans, index, end)) { from = index + 1; continue }
      const ranges = occurrences.get(entry.value) ?? []
      ranges.push([index, end])
      occurrences.set(entry.value, ranges)
      occupiedSpans.push({
        start: index, end, matched: entry.value, kind: entry.kind,
        replacement: '', origin: 'lexicon', source: entry.source,
      })
      from = end
    }
  }

  // 只给「真的会被替换」的实体分配假名——池序号不被无关/被覆盖的实体搅动。
  const candidates: AliasCandidate[] = ordered
    .filter((entry) => (occurrences.get(entry.value)?.length ?? 0) > 0 && isAliasKind(entry.kind))
    .map((entry) => ({ value: entry.value, kind: entry.kind }))
  const assignment = assignAliases(candidates, existing)

  const entities: Record<string, MappingEntity> = { ...existing }
  for (const item of assignment.created) {
    const entry = byValue.get(item.original)
    entities[item.original] = {
      alias: item.alias,
      kind: item.kind,
      source: entry?.source ?? 'lexicon',
      ...(entry?.note === undefined ? {} : { note: entry.note }),
      createdAt: now,
    }
  }

  const spans: Span[] = []
  for (const entry of ordered) {
    const ranges = occurrences.get(entry.value)
    if (ranges === undefined || ranges.length === 0) continue
    const stored = existing[entry.value]?.alias
    const replacement = stored ?? (isAliasKind(entry.kind)
      ? assignment.aliasByValue.get(entry.value) ?? entry.value
      : maskForKind(entry.kind, entry.value))
    if (entities[entry.value] === undefined) {
      entities[entry.value] = {
        alias: replacement,
        kind: entry.kind,
        source: entry.source,
        ...(entry.note === undefined ? {} : { note: entry.note }),
        createdAt: now,
      }
    }
    for (const [start, end] of ranges) {
      spans.push({
        start, end, matched: entry.value, kind: entry.kind,
        replacement, origin: 'lexicon', source: entry.source,
      })
    }
  }

  return { spans, created: assignment.created, entities }
}
