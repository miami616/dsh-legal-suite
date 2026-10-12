/**
 * 假名分配（层②命名器）：别名池 + 冲突消解 + 跨次稳定。
 *
 * 规则（与设计方案一致）：
 *   - 自然人：姓 + 「某」（张玉军 → 张某）；同案冲突加序号（张某2、张某3）；
 *   - 机构/项目/案件名/案号/地址/自定义：前缀 + 字母（机构A、机构B…，A..Z→AA）；
 *   - 已有映射优先：同一 scope 重复脱敏时，原实体假名不变，只追加新实体。
 *
 * 分配只依赖「本次实际命中的实体集合 + 既有映射」，与词典无关，故结果确定。
 */
import type { EntityKind } from './types.ts'
import type { MappingEntity } from '../store/types.ts'

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** 0→A、25→Z、26→AA（Excel 列名式）。 */
export function letterAt(index: number): string {
  let n = index + 1
  let out = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    out = LETTERS[rem]! + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

/** 非自然人别名前缀。 */
const KIND_PREFIX: Partial<Record<EntityKind, string>> = {
  org: '机构',
  project: '项目',
  caseName: '案件',
  caseNumber: '案号',
  address: '地址',
  custom: '实体',
}

/**
 * 假名最终形态：案号用【案号A】括起来——正文里「案号【案号A】」比「案号案号A」
 * 可读，也更容易被模型原样保留（还原时不走样）。
 */
export function formatAlias(kind: EntityKind, base: string, index: number): string {
  const raw = `${base}${letterAt(index)}`
  return kind === 'caseNumber' ? `【${raw}】` : raw
}

/** 候选实体的假名基名（自然人取姓氏）。 */
export function aliasBaseOf(kind: EntityKind, value: string): string {
  if (kind === 'person') return `${value.slice(0, 1)}某`
  return `${KIND_PREFIX[kind] ?? '实体'}`
}

export interface AliasCandidate {
  value: string
  kind: EntityKind
}

export interface AliasAssignment {
  /** 原值 → 假名。 */
  aliasByValue: Map<string, string>
  /** 本次新分配的假名。 */
  created: Array<{ original: string; alias: string; kind: string }>
  /** 每个类别的已占用假名（含既有映射）。 */
  takenByKind: Map<EntityKind, Set<string>>
}

/** 稳定排序：先类别，再原值（避免依赖 ICU localeCompare）。 */
function compareCandidates(a: AliasCandidate, b: AliasCandidate): number {
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1
  if (a.value === b.value) return 0
  return a.value < b.value ? -1 : 1
}

/**
 * 给候选实体分配稳定假名。
 * @param candidates - 本次实际命中的别名类实体（调用方需先按出现与否过滤）。
 * @param existing - 既有映射实体表（原值 → { alias, kind }）。
 */
export function assignAliases(
  candidates: readonly AliasCandidate[],
  existing: Readonly<Record<string, MappingEntity>>,
): AliasAssignment {
  const aliasByValue = new Map<string, string>()
  const takenByKind = new Map<EntityKind, Set<string>>()
  const created: Array<{ original: string; alias: string; kind: string }> = []

  const takenOf = (kind: EntityKind): Set<string> => {
    let set = takenByKind.get(kind)
    if (set === undefined) { set = new Set<string>(); takenByKind.set(kind, set) }
    return set
  }

  // 既有映射先占位（同 scope 的旧假名绝不复用给别的实体）。
  for (const [original, entity] of Object.entries(existing)) {
    const kind = entity.kind as EntityKind
    takenOf(kind).add(entity.alias)
    aliasByValue.set(original, entity.alias)
  }

  for (const candidate of [...candidates].sort(compareCandidates)) {
    if (aliasByValue.has(candidate.value)) continue
    const taken = takenOf(candidate.kind)
    let alias: string
    if (candidate.kind === 'person') {
      const base = aliasBaseOf(candidate.kind, candidate.value)
      alias = base
      let n = 2
      while (taken.has(alias)) { alias = `${base}${n}`; n += 1 }
    } else {
      const base = aliasBaseOf(candidate.kind, candidate.value)
      let i = 0
      alias = formatAlias(candidate.kind, base, i)
      while (taken.has(alias)) { i += 1; alias = formatAlias(candidate.kind, base, i) }
    }
    taken.add(alias)
    aliasByValue.set(candidate.value, alias)
    created.push({ original: candidate.value, alias, kind: candidate.kind })
  }

  return { aliasByValue, created, takenByKind }
}
