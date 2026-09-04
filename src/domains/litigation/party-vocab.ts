/**
 * 当事人角色词表与阵营归一 —— 服务端唯一事实源。
 *
 * 业务模型（2026-09-04 与用户确认后重构）：
 *
 * 当事人成对出现，本质上分「两侧」：
 *   - A 侧（主动/控方/申请方）：原告、申请人、上诉人、申请执行人
 *   - B 侧（被动/辩方/被申请方）：被告、被申请人、被上诉人、被执行人
 *   - 第三人：独立（不属于任何一侧）
 *
 * 「我方/对方」不靠每行打 ourClient 标记（真实数据往往没有），而由案件的
 * `parties.ourSide` 决定我方所在侧：
 *   - ourSide ∈ {plaintiff, applicant, appellant, executionApplicant} → A 侧
 *   - ourSide ∈ {defendant, respondent, appellee, executionRespondent} → B 侧
 * 于是任何一行当事人，看它的角色落哪一侧：与我方同侧 = 我方；对侧 = 对方。
 * 同一个人可能跨程序出现多个称呼（一审原告 → 二审上诉人、仲裁申请人 →
 * 起诉后原告），它们都属于同一侧 → 同一主体合并为一行、保留多标签，绝不重复列。
 *
 * 硬规则：
 *   1. 角色取自 CANONICAL_ROLES（允许「第一被申请人」等序数/审级变体，
 *      canonicalRoleOf 归一识别）；
 *   2. parties.details 按「名字」去重合并：同名同主体只保留一行，role 并集进
 *      roles[]，主 role 优先取命中我方侧的角色（我方显示更准确）；
 *   3. 卡片「我方/对方」按侧查找：我方 = 与我方同侧的主体们，对方 = 对侧主体。
 *
 * 存储兼容：role 为字符串（前端下拉/徽章按字符串处理），roles[] 可选扩展。
 */

/** 当事人可选的规范角色（中文）。 */
export const CANONICAL_ROLES = [
  '原告', '被告',
  '申请人', '被申请人',
  '上诉人', '被上诉人',
  '申请执行人', '被执行人',
  '第三人',
] as const

export type CanonicalRole = typeof CANONICAL_ROLES[number]

/** 我方立场 key（ourSide 合法取值）。 */
export type OurSideKey =
  | 'plaintiff' | 'defendant' | 'applicant' | 'respondent'
  | 'appellant' | 'appellee'
  | 'executionApplicant' | 'executionRespondent'
  | 'unknown'

/** 侧：A=原告/申请人/上诉人/申请执行人；B=被告/被申请人/被上诉人/被执行人。 */
export type SideKey = 'A' | 'B' | ''

/** 规范角色 → 所在侧（第三人/未知 → ''）。 */
export const SIDE_OF_ROLE: Record<CanonicalRole | '', SideKey> = {
  原告: 'A', 申请人: 'A', 上诉人: 'A', 申请执行人: 'A',
  被告: 'B', 被申请人: 'B', 被上诉人: 'B', 被执行人: 'B',
  第三人: '',
  '': '',
}

/** ourSide key → 我方所在侧（unknown → ''）。 */
export const SIDE_OF_OURSIDE: Record<OurSideKey, SideKey> = {
  plaintiff: 'A', applicant: 'A', appellant: 'A', executionApplicant: 'A',
  defendant: 'B', respondent: 'B', appellee: 'B', executionRespondent: 'B',
  unknown: '',
}

/** English key / Chinese 标签 → canonical key（写路径归一化）。 */
const OUR_SIDE_ALIASES: Record<string, OurSideKey> = {
  plaintiff: 'plaintiff', 原告: 'plaintiff',
  applicant: 'applicant', 申请人: 'applicant',
  defendant: 'defendant', 被告: 'defendant',
  respondent: 'respondent', 被申请人: 'respondent',
  appellant: 'appellant', 上诉人: 'appellant',
  appellee: 'appellee', 被上诉人: 'appellee',
  executionApplicant: 'executionApplicant', 申请执行人: 'executionApplicant',
  executionRespondent: 'executionRespondent', 被执行人: 'executionRespondent',
  unknown: 'unknown', 待确认: 'unknown', '': 'unknown',
}

/** 每个 ourSide key 对应我方的主角色（卡片「我方」槽位默认标签）。 */
export const OUR_SIDE_PRIMARY_ROLE: Record<OurSideKey | '', CanonicalRole | ''> = {
  plaintiff: '原告',
  defendant: '被告',
  applicant: '申请人',
  respondent: '被申请人',
  appellant: '上诉人',
  appellee: '被上诉人',
  executionApplicant: '申请执行人',
  executionRespondent: '被执行人',
  unknown: '',
  '': '',
}

/** 我方主角色 → 对方主角色（卡片「对方」槽位标签）。 */
export const OPPOSITE_ROLE_OF: Record<CanonicalRole, CanonicalRole | ''> = {
  原告: '被告',
  被告: '原告',
  申请人: '被申请人',
  被申请人: '申请人',
  上诉人: '被上诉人',
  被上诉人: '上诉人',
  申请执行人: '被执行人',
  被执行人: '申请执行人',
  第三人: '',
}

/** 归一化任意 ourSide 值（English key 或中文标签）到规范 key。未知值 → ''。 */
export function normalizeOurSide(value: unknown): OurSideKey | '' {
  if (value === undefined || value === null) return ''
  const s = String(value).trim()
  return OUR_SIDE_ALIASES[s] ?? ''
}

/** 从角色串里提取规范角色名（「第一被申请人」→「被申请人」、「一审原告」→「原告」）。 */
export function canonicalRoleOf(role: string): CanonicalRole | '' {
  const r = role.trim()
  if ((CANONICAL_ROLES as readonly string[]).includes(r)) return r as CanonicalRole
  const stripped = r
    .replace(/^(一审|二审|再审|原审|终审|重审)/, '')
    .replace(/(第?[一二三四五六七八九十百\d]+)/, '')
  return (CANONICAL_ROLES as readonly string[]).includes(stripped) ? stripped as CanonicalRole : ''
}

/** 是否规范角色（含序数/审级变体）。 */
export function isCanonicalRole(role: string): boolean {
  return canonicalRoleOf(role) !== ''
}

/** 一个角色的「侧」：「第一被申请人」→ B；第三人/未知 → ''。 */
export function sideOfRole(role: string): SideKey {
  const canonical = canonicalRoleOf(role)
  return SIDE_OF_ROLE[canonical] ?? ''
}

/** 一串角色里是否含某侧角色。 */
export function hasSide(roles: string[], side: SideKey): boolean {
  if (side === '') return false
  return roles.some((r) => sideOfRole(r) === side)
}

/** 把角色串归一化展示（英文 legacy token → 中文；其余原样，不做臆断改写）。 */
export function normalizeRoleLabel(role: unknown): string {
  if (role === undefined || role === null) return ''
  const raw = String(role).trim()
  const EN_TO_ZH: Record<string, string> = {
    plaintiff: '原告', defendant: '被告', third_party: '第三人', agent: '代理人',
    applicant: '申请人', respondent: '被申请人',
    execution_applicant: '申请执行人', execution_respondent: '被执行人',
    executed_party: '被执行人',
  }
  const mapped = EN_TO_ZH[raw]
  if (mapped !== undefined) return mapped
  const camel = OUR_SIDE_ALIASES[raw]
  if (camel !== undefined && camel !== 'unknown') {
    return OUR_SIDE_PRIMARY_ROLE[camel] || raw
  }
  return raw
}

/** 规范化 roles 数组：去空、去重、英文 legacy 归中文；保留原文标签。 */
export function normalizeRoles(roles: unknown): string[] {
  if (!Array.isArray(roles)) return []
  const out: string[] = []
  for (const r of roles) {
    const label = normalizeRoleLabel(r)
    if (label === '') continue
    if (!out.includes(label)) out.push(label)
  }
  return out
}

/** 一个当事人行（宽松写入口）。 */
export interface PartyRowInput {
  name?: unknown
  role?: unknown
  roles?: unknown
  ourClient?: unknown
  [key: string]: unknown
}

/**
 * 按「名字」去重合并 parties.details：
 *  - 空名行保留原样（用户在输入中）；
 *  - 同名（同主体）多行合并为一行：角色并集进 roles[]，主 role 优先取命中
 *    我方侧的角色（我方显示用），否则取 roles 首个；我方标记 any 行 ourClient
 *    即置 true（兼容旧字段，但不再依赖它判定阵营）；
 *  - 地址/法代/信用代码/电话/律所等后写字段取首个非空。
 *
 * @param ourSideKey - 案件我方立场（决定我方侧，用于主角色择优）。
 */
export function dedupePartyDetails(
  details: Array<Record<string, unknown>> | undefined,
  ourSideKey: OurSideKey | '',
): { rows: Array<Record<string, unknown>>; changed: boolean } {
  const input = Array.isArray(details) ? details : []
  if (input.length === 0) return { rows: [], changed: false }

  const out: Array<Record<string, unknown>> = []
  const indexByName = new Map<string, number>()
  let changed = false
  const mySide = SIDE_OF_OURSIDE[ourSideKey as OurSideKey] ?? ''
  const nameOf = (v: unknown): string => (v === undefined || v === null ? '' : String(v).trim())

  for (const raw of input) {
    const row = { ...raw }
    const name = nameOf(row.name)
    if (name === '') {
      out.push(row)
      continue
    }
    const existingIdx = indexByName.get(name)

    if (existingIdx === undefined) {
      indexByName.set(name, out.length)
      const roles = normalizeRoles(row.role !== undefined ? [row.role] : row.roles)
      const primary = pickPrimaryRole(roles, mySide)
      out.push({
        ...row,
        name,
        role: primary,
        roles: dedupeKeep(roles, primary),
        ourClient: row.ourClient === true,
      })
      continue
    }

    // 同名同主体 → 合并。
    changed = true
    const existing = out[existingIdx]!
    const existingRoles = normalizeRoles(existing.roles !== undefined ? existing.roles : [existing.role])
    const rowRoles = normalizeRoles(row.role !== undefined ? [row.role] : row.roles)
    const merged = [...new Set([...existingRoles, ...rowRoles])]
    const primary = pickPrimaryRole(merged, mySide)
    existing.role = primary
    existing.roles = dedupeKeep(merged, primary)
    if (row.ourClient === true) existing.ourClient = true
    for (const field of ['address', 'legalRep', 'creditCode', 'phone', 'firm', 'email'] as const) {
      const v = row[field]
      if (v !== undefined && v !== null && String(v).trim() !== '' && existing[field] === undefined) {
        existing[field] = v
      }
    }
  }
  return { rows: out, changed }
}

/** 主角色选择：优先取命中我方侧的角色，否则 roles 首个。 */
function pickPrimaryRole(roles: string[], mySide: SideKey): string {
  if (roles.length === 0) return ''
  if (mySide !== '') {
    const hit = roles.find((r) => sideOfRole(r) === mySide)
    if (hit !== undefined) return hit
  }
  return roles[0]!
}

/** 去空 + 去重，但保序（主角色在数组内仍保留一份）。 */
function dedupeKeep(roles: string[], primary: string): string[] {
  const out: string[] = []
  for (const r of roles) {
    if (r === '') continue
    if (!out.includes(r)) out.push(r)
  }
  return out
}

/** 解析可能被序列化成 JSON 字符串的入参。 */
function tryParseObject(value: unknown): Record<string, unknown> | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
    try {
      const parsed = JSON.parse(trimmed) as unknown
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null
    } catch {
      return null
    }
  }
  return (typeof value === 'object' && !Array.isArray(value)) ? value as Record<string, unknown> : null
}

/**
 * 归一化一个 parties 块（写路径收口）：
 *  - parties.ourSide 中文/英文 → canonical key；
 *  - details 按名字去重合并（阵营见上）。
 */
export function normalizePartiesBlock(parties: unknown): Record<string, unknown> | undefined {
  const p = tryParseObject(parties)
  if (p === null) return undefined

  const out: Record<string, unknown> = { ...p }
  const sideValue = p.ourSide
  if (sideValue !== undefined && sideValue !== null && String(sideValue).trim() !== '') {
    const mapped = normalizeOurSide(sideValue)
    out.ourSide = mapped === '' ? 'unknown' : mapped
  }
  if (Array.isArray(p.details)) {
    const { rows, changed } = dedupePartyDetails(
      p.details as Array<Record<string, unknown>>,
      out.ourSide as OurSideKey,
    )
    if (changed || rows.length > 0) out.details = rows
    else delete out.details
  }
  return out
}

/** 单行当事人（读侧返回形状）。 */
export interface PartyRow {
  name: string
  /** 主角色（界面徽章/槽位展示）。 */
  role: string
  /** 全量角色标签（含序数/审级原文）。 */
  roles?: string[]
  ourClient?: boolean
  [key: string]: unknown
}

/** 归一一行当事人为 PartyRow（补 roles[] 兼容旧行只有 role）。 */
function toPartyRow(r: Record<string, unknown>): PartyRow {
  const roles = Array.isArray(r.roles)
    ? (r.roles as unknown[]).map((x) => String(x))
    : r.role === undefined || r.role === null
      ? []
      : [String(r.role)]
  return {
    name: String(r.name ?? ''),
    role: String(r.role ?? ''),
    roles,
    ourClient: r.ourClient === true,
    ...r,
  }
}

/**
 * 我方/对方判定（读侧核心）：
 *
 * 「我方」= 律所实际代理的那一方当事人，必须由显式标记指认（details 行的
 * ourClient:true，或 parties.ourClientName 对应行），绝不靠「侧」臆断——
 * 同一侧可能有多个主体（如劳动仲裁多个被申请人），律所往往只代理其中一个
 * （2026-09-04 用户纠正：003 有两个被申请人，律所只代理第一被申请人）。
 *
 * 行角色命中我方侧 = 我方；命中对侧 = 对方；都没命中（第三人/未知）= 中立方。
 * 但「我方主体列表」只认显式标记；无标记时退化为侧判定仅作展示兜底。
 */
export type RowCamp = 'ours' | 'theirs' | 'neutral'
export function campOfRow(row: PartyRow, mySide: SideKey): RowCamp {
  const roles = Array.isArray(row.roles) ? row.roles : row.role ? [row.role] : []
  if (hasSide(roles, mySide)) return 'ours'
  const opp = mySide === 'A' ? 'B' : mySide === 'B' ? 'A' : ''
  if (opp !== '' && hasSide(roles, opp)) return 'theirs'
  return 'neutral'
}

/** 我方当事人名（parties.ourClientName 或首行标记对应名；无 → undefined）。 */
export function ourClientNameOf(parties: Record<string, unknown> | undefined): string {
  if (!parties) return ''
  const direct = typeof parties.ourClientName === 'string' ? parties.ourClientName.trim() : ''
  if (direct !== '') return direct
  // 行标记兜底：ourClient === true 的行名（取第一个）。
  if (Array.isArray(parties.details)) {
    const marked = (parties.details as Array<Record<string, unknown>>).find((r) => r.ourClient === true)
    if (marked) return String(marked.name ?? '').trim()
  }
  return ''
}

/** 从 details 里取我方行：显式标记（ourClient:true）优先；无标记时若同侧恰好
 *  只有一位主体则取它（退化为侧判定），否则返回空（不臆断）。 */
export function findOurRows(
  details: Array<Record<string, unknown>> | undefined,
  ourSideKey: OurSideKey | '',
  parties?: Record<string, unknown>,
): PartyRow[] {
  const rows = Array.isArray(details) ? details.map(toPartyRow) : []
  // 1) 显式 ourClient 标记行（最高权威）。
  const marked = rows.filter((r) => r.ourClient === true)
  if (marked.length > 0) return marked
  // 2) parties.ourClientName 指认行。
  const ourName = parties !== undefined ? ourClientNameOf(parties) : ''
  if (ourName !== '') {
    const byName = rows.filter((r) => r.name === ourName)
    if (byName.length > 0) return byName
  }
  const mySide = SIDE_OF_OURSIDE[ourSideKey as OurSideKey] ?? ''
  // 3) 退化兜底：我方侧恰好只有一个主体 → 它就是（无歧义时可用）。
  if (mySide !== '') {
    const sameSide = rows.filter((r) => campOfRow(r, mySide) === 'ours')
    if (sameSide.length === 1) return sameSide
  }
  // 4) 仍无法确定 → 空（不臆断，交给 UI 显示“待确认”）。
  return []
}

/** 从 details 里取对方行（对侧主体；与是否我方标记无关）。 */
export function findTheirRows(
  details: Array<Record<string, unknown>> | undefined,
  ourSideKey: OurSideKey | '',
): PartyRow[] {
  const rows = Array.isArray(details) ? details.map(toPartyRow) : []
  const mySide = SIDE_OF_OURSIDE[ourSideKey as OurSideKey] ?? ''
  if (mySide === '') return []
  // 对方 = 对侧主体（排除我方标记行——若我方也被标了对侧角色，以标记为准不属于对方）。
  const ourNames = new Set(rows.filter((r) => r.ourClient === true).map((r) => r.name))
  return rows.filter((r) => campOfRow(r, mySide) === 'theirs' && !ourNames.has(r.name))
}

/** 我方主行（卡片「我方」槽位）；无确定我方 → undefined。 */
export function findOurPrimary(
  details: Array<Record<string, unknown>> | undefined,
  ourSideKey: OurSideKey | '',
  parties?: Record<string, unknown>,
): PartyRow | undefined {
  const ours = findOurRows(details, ourSideKey, parties)
  return ours.length > 0 ? ours[0]! : undefined
}
