/**
 * dsh-legal-suite/moot-court — 案件快照构建。
 *
 * 方案 §3：从诉讼案件系统取输入时**一次性复制快照**进会话目录，此后模拟过程
 * 与卷宗完全解耦——案件后续改动不影响回放与判决一致性。本模块只**读**案件
 * 登记（case-registry.json）与卷宗里的《案件信息.md》，不写回、不产生卷宗文件。
 *
 * 解析策略：`案件信息.md` 的结构由诉讼域维护（`## 章节` + markdown 表格），这里
 * 按章节标题做保守抽取，抽不到就回退到案件登记字段，绝不臆造内容。
 */
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { Dossier, DossierEvidence, DossierParty, Procedure } from '../store/types.ts'

/** 案件登记中我们需要的字段（宽松类型：登记结构由诉讼域拥有）。 */
interface RawCase {
  caseId?: string
  name?: string
  cause?: string
  court?: string
  caseNumber?: string
  level?: string
  status?: string
  folder?: string
  summary?: string
  ourSide?: string
  parties?: {
    ourSide?: string
    details?: Array<{ name?: string; role?: string; ourClient?: boolean; roles?: string[] }>
  }
}

/** 向导用的案件摘要。 */
export interface CaseBrief {
  caseId: string
  name: string
  cause?: string
  level?: string
  status?: string
  court?: string
  ourSide?: string
  ourRole?: string
  theirRole?: string
  folder?: string
  hasCaseInfo: boolean
}

/** ourSide key → 我方主角色标签。 */
const OUR_SIDE_ROLE: Record<string, string> = {
  plaintiff: '原告',
  applicant: '申请人',
  appellant: '上诉人',
  executionApplicant: '申请执行人',
  defendant: '被告',
  respondent: '被申请人',
  appellee: '被上诉人',
  executionRespondent: '被执行人',
}

/** A 侧（主动方）角色。 */
const SIDE_A = new Set(['原告', '申请人', '上诉人', '申请执行人'])
/** B 侧（被动方）角色。 */
const SIDE_B = new Set(['被告', '被申请人', '被上诉人', '被执行人'])

/** 对手角色：按我方所在侧取对侧的主角色。 */
const OPPOSITE_ROLE: Record<string, string> = {
  原告: '被告', 被告: '原告',
  申请人: '被申请人', 被申请人: '申请人',
  上诉人: '被上诉人', 被上诉人: '上诉人',
}

/** 读案件登记文件。 */
async function readRegistry(litigationDir: string): Promise<{ cases: Record<string, RawCase> }> {
  try {
    const raw = await readFile(join(litigationDir, 'case-registry.json'), 'utf8')
    const parsed = JSON.parse(raw) as { cases?: Record<string, RawCase> }
    return { cases: parsed.cases ?? {} }
  } catch {
    return { cases: {} }
  }
}

/** 判断卷宗里是否有《案件信息.md》。 */
async function hasCaseInfoFile(folder: string | undefined): Promise<boolean> {
  if (folder === undefined || folder === '') return false
  try {
    const info = await stat(join(folder, '案件信息.md'))
    return info.isFile()
  } catch {
    return false
  }
}

/** 读《案件信息.md》（缺失返回 undefined）。 */
export async function readCaseInfo(folder: string | undefined): Promise<string | undefined> {
  if (folder === undefined || folder === '') return undefined
  try {
    return await readFile(join(folder, '案件信息.md'), 'utf8')
  } catch {
    return undefined
  }
}

/** 列出案件（向导第一步）。 */
export async function listCases(litigationDir: string): Promise<CaseBrief[]> {
  const { cases } = await readRegistry(litigationDir)
  const out: CaseBrief[] = []
  for (const [caseId, raw] of Object.entries(cases)) {
    if (raw === undefined) continue
    const ourRole = OUR_SIDE_ROLE[raw.ourSide ?? raw.parties?.ourSide ?? ''] ?? ''
    out.push({
      caseId,
      name: raw.name ?? caseId,
      ...(raw.cause === undefined ? {} : { cause: raw.cause }),
      ...(raw.level === undefined ? {} : { level: raw.level }),
      ...(raw.status === undefined ? {} : { status: raw.status }),
      ...(raw.court === undefined ? {} : { court: raw.court }),
      ...(raw.ourSide === undefined ? {} : { ourSide: raw.ourSide }),
      ...(ourRole === '' ? {} : { ourRole }),
      ...(ourRole === '' || OPPOSITE_ROLE[ourRole] === undefined ? {} : { theirRole: OPPOSITE_ROLE[ourRole] }),
      ...(raw.folder === undefined ? {} : { folder: raw.folder }),
      hasCaseInfo: await hasCaseInfoFile(raw.folder),
    })
  }
  return out.sort((a, b) => a.caseId.localeCompare(b.caseId))
}

/** 按 `## 标题` 切分 markdown 章节。 */
function sectionsOf(markdown: string): Array<{ title: string; body: string }> {
  const lines = markdown.split('\n')
  const out: Array<{ title: string; body: string }> = []
  let current: { title: string; body: string[] } | undefined
  for (const line of lines) {
    const heading = /^##\s+(.*)$/.exec(line.trim())
    if (heading !== null) {
      if (current !== undefined) out.push({ title: current.title, body: current.body.join('\n') })
      current = { title: (heading[1] ?? '').trim(), body: [] }
      continue
    }
    current?.body.push(line)
  }
  if (current !== undefined) out.push({ title: current.title, body: current.body.join('\n') })
  return out
}

/** 在章节里找标题含关键字的章节。 */
function findSection(sections: Array<{ title: string; body: string }>, keywords: string[]): string | undefined {
  for (const section of sections) {
    if (keywords.some((k) => section.title.includes(k))) return section.body
  }
  return undefined
}

/** 解析 markdown 表格为二维数组（跳过分隔行）。 */
function parseTable(body: string): string[][] {
  const rows: string[][] = []
  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('|')) continue
    if (/^\|[\s:|-]+\|$/.test(trimmed)) continue
    const cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim())
    if (cells.length > 0) rows.push(cells)
  }
  return rows
}

/** 从文本抽取「- 」或「1. 」列表项。 */
function parseListItems(body: string): string[] {
  const out: string[] = []
  for (const line of body.split('\n')) {
    const match = /^\s*(?:[-*+]|\d+[.、)])\s*(.+)$/.exec(line)
    if (match === null) continue
    const text = (match[1] ?? '').replace(/\*\*/g, '').trim()
    if (text !== '' && text.length <= 300) out.push(text)
  }
  return out
}

/** 从卷宗 markdown 抽取当事人。 */
function partiesFromSection(body: string, ourRole: string): DossierParty[] {
  const rows = parseTable(body)
  const out: DossierParty[] = []
  for (const row of rows) {
    const role = (row[0] ?? '').replace(/\s/g, '')
    const name = (row[1] ?? '').replace(/[*`]/g, '').trim()
    if (role === '' || name === '' || role.includes('角色')) continue
    const rawRole = role.replace(/（.*?）|\(.*?\)/g, '')
    const ourClient = rawRole === ourRole
      || /我方客户|我方当事人|✓|✅/.test(row[row.length - 1] ?? '')
    out.push({ name, role: rawRole === '' ? role : rawRole, ourClient })
  }
  return out.slice(0, 12)
}

/** 从卷宗 markdown 抽取证据。 */
function evidenceFromMarkdown(sections: Array<{ title: string; body: string }>): DossierEvidence[] {
  const body = findSection(sections, ['证据', '举证'])
  if (body === undefined) return []
  const rows = parseTable(body)
  const out: DossierEvidence[] = []
  for (const row of rows) {
    const no = (row[0] ?? '').replace(/[*`]/g, '').trim()
    const name = (row[1] ?? '').replace(/[*`]/g, '').trim()
    if (no === '' || name === '' || /证据名称|序号/.test(no)) continue
    const purpose = (row[2] ?? '').replace(/[*`]/g, '').trim()
    out.push({ no, name, ...(purpose === '' ? {} : { purpose }) })
  }
  if (out.length > 0) return out.slice(0, 60)
  return parseListItems(body)
    .map((item, index) => ({ no: String(index + 1), name: item }))
    .slice(0, 60)
}

/** 从案情概要章节里抽诉请句。 */
function claimsFromText(text: string): string[] {
  const out: string[] = []
  for (const sentence of text.split(/(?<=[。\n])/)) {
    // 去掉 markdown 强调符与列表符号（`- `、`* `、`1. `），避免把符号带进请求项。
    const clean = sentence
      .replace(/^[\s>*+-]+/, '')
      .replace(/^\d+[.、)]\s*/, '')
      .replace(/[*`>]/g, '')
      .trim()
    if (clean === '' || clean.length > 300) continue
    if (/请求(判令|裁决|确认|解除|支付|返还|赔偿|撤销|改判)|诉请|仲裁请求/.test(clean)) out.push(clean)
  }
  return [...new Set(out)].slice(0, 10)
}

/** 快照构建的可覆盖字段（向导里用户可改）。 */
export interface DossierOverrides {
  claims?: string[]
  facts?: string
  brief?: string
  evidence?: DossierEvidence[]
  priorJudgment?: string
  appealGrounds?: string[]
  materials?: Array<{ name: string; note?: string }>
}

/**
 * 构建案件快照。
 * @param litigationDir - 诉讼域数据目录（含 case-registry.json）。
 * @param caseId - 案件编号。
 * @param procedure - 拟采用的程序（决定是否要求一审判决书等）。
 * @param overrides - 向导里的用户覆盖。
 */
export async function buildDossier(
  litigationDir: string,
  caseId: string,
  procedure: Procedure,
  overrides: DossierOverrides = {},
): Promise<Dossier> {
  const { cases } = await readRegistry(litigationDir)
  const raw = cases[caseId]
  const sources: string[] = []

  const markdown = raw === undefined ? undefined : await readCaseInfo(raw.folder)
  if (raw !== undefined) sources.push('诉讼案件登记（case-registry.json）')
  if (markdown !== undefined) sources.push('卷宗《案件信息.md》')

  const sections = markdown === undefined ? [] : sectionsOf(markdown)
  const ourRole = OUR_SIDE_ROLE[raw?.ourSide ?? raw?.parties?.ourSide ?? ''] ?? ''
  const theirRole = ourRole === '' ? '' : OPPOSITE_ROLE[ourRole] ?? ''

  const partiesSection = findSection(sections, ['当事人', '双方'])
  let parties: DossierParty[] = partiesSection === undefined ? [] : partiesFromSection(partiesSection, ourRole)
  if (parties.length === 0 && raw?.parties?.details !== undefined) {
    // 回退：用登记里的当事人 + 阵营判断（同侧判定依据角色所属侧）。
    const ourSide = raw.parties.ourSide ?? raw.ourSide ?? ''
    const ourIsA = ['plaintiff', 'applicant', 'appellant', 'executionApplicant'].includes(ourSide)
    parties = raw.parties.details.slice(0, 12).map((d) => {
      const role = (d.role ?? d.roles?.[0] ?? '').trim()
      const inA = SIDE_A.has(role)
      const inB = SIDE_B.has(role)
      const ourClient = d.ourClient === true || (ourIsA ? inA : inB)
      return { name: (d.name ?? '').trim(), role, ourClient }
    }).filter((p) => p.name !== '')
    if (parties.length > 0) sources.push('登记当事人')
  }

  const summarySection = findSection(sections, ['案情', '事实', '基本案情'])
  const factsRaw = overrides.facts ?? summarySection ?? raw?.summary ?? ''
  const facts = factsRaw.length > 6000 ? `${factsRaw.slice(0, 6000)}…` : factsRaw

  const requestSection = findSection(sections, ['诉请', '诉讼请求', '仲裁请求', '请求事项'])
  const claims = overrides.claims !== undefined && overrides.claims.length > 0
    ? overrides.claims
    : (requestSection === undefined ? claimsFromText(factsRaw) : parseListItems(requestSection))
  if (claims.length > 0 && overrides.claims === undefined) sources.push('从《案件信息.md》抽取请求事项')

  const evidence = overrides.evidence !== undefined && overrides.evidence.length > 0
    ? overrides.evidence
    : evidenceFromMarkdown(sections)

  const dossier: Dossier = {
    ...(raw?.caseId === undefined && caseId === '' ? {} : { caseId: raw?.caseId ?? caseId }),
    ...(raw?.name === undefined ? {} : { caseName: raw.name }),
    ...(raw?.cause === undefined ? {} : { cause: raw.cause }),
    ...(raw?.court === undefined ? {} : { court: raw.court }),
    ...(raw?.caseNumber === undefined ? {} : { caseNumber: raw.caseNumber }),
    ...(raw?.level === undefined ? {} : { level: raw.level }),
    ...(ourRole === '' ? {} : { ourRole }),
    ...(theirRole === '' ? {} : { theirRole }),
    claims: claims.slice(0, 20),
    ...(facts === '' ? {} : { facts }),
    ...(overrides.brief === undefined || overrides.brief.trim() === '' ? {} : { brief: overrides.brief }),
    parties,
    evidence,
    ...(overrides.priorJudgment === undefined || overrides.priorJudgment.trim() === ''
      ? {}
      : { priorJudgment: overrides.priorJudgment }),
    ...(overrides.appealGrounds === undefined || overrides.appealGrounds.length === 0
      ? {}
      : { appealGrounds: overrides.appealGrounds }),
    materials: overrides.materials ?? [],
    builtAt: new Date().toISOString(),
    sources,
  }

  // 二审：未显式提供一审文书时，尝试把卷宗里的《案件信息.md》相关章节作为摘要。
  if (procedure === 'civil_second' && dossier.priorJudgment === undefined && markdown !== undefined) {
    const prior = findSection(sections, ['一审', '原审', '判决'])
    if (prior !== undefined) {
      dossier.priorJudgment = prior.length > 6000 ? `${prior.slice(0, 6000)}…` : prior
      dossier.sources = [...dossier.sources, '一审情况（自《案件信息.md》抽取）']
    }
  }

  return dossier
}

/** 手工庭审（不挂案件）的空快照。 */
export function emptyDossier(overrides: DossierOverrides = {}): Dossier {
  return {
    claims: overrides.claims ?? [],
    ...(overrides.facts === undefined ? {} : { facts: overrides.facts }),
    ...(overrides.brief === undefined ? {} : { brief: overrides.brief }),
    parties: [],
    evidence: overrides.evidence ?? [],
    ...(overrides.priorJudgment === undefined ? {} : { priorJudgment: overrides.priorJudgment }),
    ...(overrides.appealGrounds === undefined ? {} : { appealGrounds: overrides.appealGrounds }),
    materials: overrides.materials ?? [],
    builtAt: new Date().toISOString(),
    sources: ['手工填写'],
  }
}

/**
 * 材料就绪度检查（方案：prepare dry-run）。
 * @returns missing（按 playbook.requiredInputs 判定）与 warnings。
 */
export function checkReadiness(
  dossier: Dossier,
  requiredInputs: Array<{ key: string; label: string; code: string; blocking: boolean }>,
): { ready: boolean; missing: Array<{ key: string; label: string; code: string; blocking: boolean }>; warnings: string[] } {
  const present = (key: string): boolean => {
    switch (key) {
      case 'cause': return (dossier.cause ?? '').trim() !== ''
      case 'claims': return dossier.claims.length > 0
      case 'parties': return dossier.parties.length > 0
      case 'facts': return (dossier.facts ?? '').trim() !== ''
      case 'evidence': return dossier.evidence.length > 0
      case 'priorJudgment': return (dossier.priorJudgment ?? '').trim() !== ''
      case 'appealGrounds': return (dossier.appealGrounds ?? []).length > 0
      default: return true
    }
  }
  const missing = requiredInputs.filter((input) => !present(input.key))
  const warnings: string[] = []
  if ((dossier.brief ?? '').trim() === '') {
    warnings.push('未填写我方策略简报：单方预演的针对性会下降（裁判者与对方仅按材料推演）。')
  }
  if (dossier.evidence.length > 0 && dossier.claims.length > 0) {
    // 提示证据与请求的明显不匹配（数量悬殊时）。
    if (dossier.claims.length > dossier.evidence.length * 3) {
      warnings.push('证据条目明显少于请求项数，建议补充证据目录后再开庭。')
    }
  }
  if (dossier.materials.length === 0 && dossier.evidence.length === 0) {
    warnings.push('既未提供证据目录，也未勾选案件材料，庭审将主要围绕请求与事实展开。')
  }
  return { ready: missing.every((m) => !m.blocking), missing, warnings }
}
