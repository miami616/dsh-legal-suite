/**
 * 案件词典源（层②数据供给）：从诉讼/非诉 registry 抽出可精确匹配的敏感实体。
 *
 * 这是本插件做脱敏的**独门优势**——当事人、法定代表人、案号、法官、法院、
 * 代理机构本来就登记在案件库里，白名单精确匹配比任何通用 NER 都准。
 *
 * 只读、容错：registry 不存在或字段缺失一律跳过，绝不因某案数据脏而整体失败。
 * 与 store 解耦（直接读 JSON 文件），不实例化各域 CaseStore，避免跨域副作用。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { EntityKind, LexiconEntry } from './engine/types.ts'

export interface LexiconDirs {
  /** 诉讼数据目录（含 case-registry.json）。 */
  litigationDir?: string
  /** 非诉数据目录（含 project-registry.json、services/registry.json）。 */
  nonlitigationDir?: string
}

/** 无效值（占位符/空值）不当实体。 */
const NOISE = new Set(['', '-', '—', '/', '无', '不详', '未知', '待定', 'n/a', 'na', 'null'])

/** 机构名后缀（命中即判为机构，避免把公司当自然人取姓氏）。 */
const ORG_SUFFIX = /(公司|集团|企业|厂|店|中心|学院|大学|学校|医院|银行|事务所|协会|基金会|委员会|研究院|研究所|电视台|广播|报社|杂志社|出版社|政府|管理局|局|厅|部|委|办公室|站|馆|社|会|台|院|所|行|司|处|科|队|团|支部|街道|镇|村|委员会)$/

/** 名字是否像机构（而非自然人）。 */
export function looksLikeOrg(name: string): boolean {
  const value = name.trim()
  if (ORG_SUFFIX.test(value)) return true
  // 中文自然人姓名通常 2–4 字；超长且无自然人特征（点/星号）判机构。
  return value.replace(/[·•.]/g, '').length >= 8
}

/** 是否值得作为实体（过滤占位符与过短值）。 */
function usable(value: unknown, minLength = 2): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed.length < minLength) return undefined
  if (NOISE.has(trimmed.toLowerCase())) return undefined
  return trimmed
}

/** 按常见分隔符拆出多个当事人名（「甲、乙」/「甲 乙」/「甲；乙」）。 */
export function splitNames(value: string): string[] {
  return value
    .split(/[、,，;；/|]+/)
    .map((part) => part.trim())
    .filter((part) => usable(part) !== undefined)
}

/** 自然人/机构自动归类。 */
function kindOfName(name: string): EntityKind {
  return looksLikeOrg(name) ? 'org' : 'person'
}

/**
 * 自定义词条缺省类别推断：像人名的进人名池（张某），像机构的进机构池（机构A），
 * 其余归 custom（实体A）。不指定 kind 时避免把「李四」这种名字分到「实体A」。
 */
export function inferKind(value: string): EntityKind {
  const trimmed = value.trim()
  if (looksLikeOrg(trimmed)) return 'org'
  if (/^[\u4e00-\u9fa5·]{2,4}$/.test(trimmed)) return 'person'
  return 'custom'
}

async function readJson(file: string): Promise<unknown | undefined> {
  try {
    const raw = await readFile(file, 'utf8')
    return JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** 小工具：追加一条词条（同名同类别去重，scopes 合并）。 */
function push(
  bag: Map<string, LexiconEntry>,
  value: string | undefined,
  kind: EntityKind,
  scope: string,
  source: string,
  note?: string,
): void {
  if (value === undefined) return
  const key = `${kind}\u0000${value}`
  const existing = bag.get(key)
  if (existing !== undefined) {
    if (!existing.scopes.includes(scope)) existing.scopes.push(scope)
    return
  }
  bag.set(key, { value, kind, scopes: [scope], source, ...(note === undefined ? {} : { note }) })
}

/** 从诉讼案件 registry 抽词条。 */
function collectLitigation(registry: unknown, bag: Map<string, LexiconEntry>): void {
  const doc = asRecord(registry)
  const cases = asRecord(doc?.cases)
  if (cases === undefined) return
  for (const raw of Object.values(cases)) {
    const record = asRecord(raw)
    if (record === undefined) continue
    const scope = usable(record.caseId, 1) ?? ''
    if (scope === '') continue
    push(bag, usable(record.name), 'caseName', scope, 'litigation.case')
    push(bag, usable(record.caseNumber, 3), 'caseNumber', scope, 'litigation.case')
    push(bag, usable(record.court), 'org', scope, 'litigation.case', '受理法院')
    push(bag, usable(record.judge), 'person', scope, 'litigation.case', '承办法官')
    push(bag, usable(record.judgePhone, 7), 'phone', scope, 'litigation.case', '法官电话')
    for (const alias of asArray(record.alias)) {
      push(bag, usable(alias), 'caseName', scope, 'litigation.case', '案件别称')
    }
    const parties = asRecord(record.parties)
    if (parties === undefined) continue
    for (const side of ['plaintiff', 'defendant']) {
      const value = usable(parties[side])
      if (value === undefined) continue
      for (const name of splitNames(value)) push(bag, name, kindOfName(name), scope, 'litigation.party')
    }
    for (const rawDetail of asArray(parties.details)) {
      const detail = asRecord(rawDetail)
      if (detail === undefined) continue
      const name = usable(detail.name)
      if (name !== undefined) push(bag, name, kindOfName(name), scope, 'litigation.party', usable(detail.role, 1))
      push(bag, usable(detail.legalRep), 'person', scope, 'litigation.party', '法定代表人')
      push(bag, usable(detail.firm), 'org', scope, 'litigation.party', '代理机构')
      push(bag, usable(detail.address, 4), 'address', scope, 'litigation.party', '当事人地址')
      push(bag, usable(detail.creditCode, 8), 'creditCode', scope, 'litigation.party', '统一社会信用代码')
      push(bag, usable(detail.phone, 7), 'phone', scope, 'litigation.party', '当事人电话')
    }
  }
}

/** 从非诉项目/服务 registry 抽词条。 */
function collectNonlitigation(projects: unknown, services: unknown, bag: Map<string, LexiconEntry>): void {
  const projectDoc = asRecord(projects)
  const projectMap = asRecord(projectDoc?.projects)
  if (projectMap !== undefined) {
    for (const raw of Object.values(projectMap)) {
      const record = asRecord(raw)
      if (record === undefined) continue
      const scope = usable(record.projectId, 1) ?? ''
      if (scope === '') continue
      push(bag, usable(record.name), 'project', scope, 'nonlitigation.project')
      push(bag, usable(record.leadLawyer), 'person', scope, 'nonlitigation.project', '牵头律师')
    }
  }
  const serviceDoc = asRecord(services)
  const serviceMap = asRecord(serviceDoc?.services)
  if (serviceMap === undefined) return
  for (const raw of Object.values(serviceMap)) {
    const record = asRecord(raw)
    if (record === undefined) continue
    const scope = usable(record.id, 1) ?? 'global'
    const client = usable(record.client)
    if (client !== undefined) push(bag, client, kindOfName(client), scope, 'nonlitigation.service', '客户')
  }
}

/**
 * 汇总全部词条（诉讼 + 非诉 + 调用方附加的自定义词条）。
 * 任何一路读取失败都只是少一部分词条，不影响整体。
 */
export async function collectLexiconEntries(
  dirs: LexiconDirs,
  extra: readonly LexiconEntry[] = [],
): Promise<LexiconEntry[]> {
  const bag = new Map<string, LexiconEntry>()
  for (const entry of extra) push(bag, entry.value, entry.kind, entry.scopes[0] ?? 'global', entry.source, entry.note)

  if (dirs.litigationDir !== undefined && dirs.litigationDir !== '') {
    collectLitigation(await readJson(join(dirs.litigationDir, 'case-registry.json')), bag)
  }
  if (dirs.nonlitigationDir !== undefined && dirs.nonlitigationDir !== '') {
    const projects = await readJson(join(dirs.nonlitigationDir, 'project-registry.json'))
    const services = await readJson(join(dirs.nonlitigationDir, 'services', 'registry.json'))
    collectNonlitigation(projects, services, bag)
  }
  return [...bag.values()]
}
