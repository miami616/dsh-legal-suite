/**
 * AgentLex → plugin import.
 *
 * Reads ~/.myagents/agentlex/case-registry.json + case-timeline.json
 * READ-ONLY (the Rust locked core owns those files; we never write to them)
 * and merges into the plugin's own store. Idempotent by caseId: re-running
 * updates existing cases and adds new ones, never duplicates.
 *
 * Type normalization: legacy/agent-written type strings map to the 7
 * canonical labels (see client/case-taxonomy.ts — mirrored here as the
 * source of truth for the host-side import).
 */

import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CaseRecord, TimelineEvent } from '../store/types.ts'
import type { CaseStore } from '../store/case-store.ts'
import type { TimelineStore } from '../store/timeline-store.ts'

/* ---------------------------------- taxonomy -------------------------------- */

const CANONICAL = new Set(['民商', '刑事', '行政', '劳动争议', '知识产权', '执行', '其他'])

const TYPE_ALIASES: Record<string, string> = {
  '民商': '民商', '民事': '民商', '商事': '民商', '民商事': '民商', '民事诉讼': '民商',
  '民事纠纷': '民商', '商事争议': '民商', '刑事辩护': '刑事', '刑事附带民事': '刑事',
  '行政诉讼': '行政', '劳动争议': '劳动争议', '劳动纠纷': '劳动争议', '劳动仲裁': '劳动争议',
  '知识产权纠纷': '知识产权', '商事仲裁': '民商', '仲裁': '民商', '执行异议': '执行',
  '破产': '民商', '破产清算': '民商',
}

/** Normalize a stored type to a canonical label (other on unknown). */
export function normalizeCaseType(type: string | undefined | null): string {
  if (!type) return '其他'
  const t = type.trim()
  if (CANONICAL.has(t)) return t
  if (TYPE_ALIASES[t]) return TYPE_ALIASES[t]
  if (/劳动/.test(t)) return '劳动争议'
  if (/仲裁/.test(t) && !/商事/.test(t)) return '劳动争议'
  return '其他'
}

/* ----------------------------------- source -------------------------------- */

export interface ImportSource {
  registryPath: string
  timelinePath: string
}

/** Locate the AgentLex data dir from a base path (default ~/.myagents/agentlex). */
export function defaultSourcePath(): string {
  const home = process.env[process.platform === 'win32' ? 'USERPROFILE' : 'HOME'] ?? '.'
  return join(home, '.myagents', 'agentlex')
}

async function fileExists(path: string): Promise<boolean> {
  try { await access(path); return true } catch { return false }
}

/** Read + validate the source registry and timeline documents. */
export async function readAgentLexData(
  sourceDir: string,
): Promise<{ cases: CaseRecord[]; events: TimelineEvent[] }> {
  const registryPath = join(sourceDir, 'case-registry.json')
  const timelinePath = join(sourceDir, 'case-timeline.json')
  if (!(await fileExists(registryPath))) {
    throw new Error(`AgentLex 数据目录不存在或缺少 case-registry.json: ${sourceDir}`)
  }
  const registry = JSON.parse(await readFile(registryPath, 'utf8')) as { cases?: Record<string, CaseRecord> }
  if (registry.cases === undefined || typeof registry.cases !== 'object') {
    throw new Error(`case-registry.json 格式异常（缺少 cases）: ${registryPath}`)
  }
  const cases = Object.values(registry.cases).filter((c): c is CaseRecord => c !== null && typeof c === 'object')

  let events: TimelineEvent[] = []
  if (await fileExists(timelinePath)) {
    const timeline = JSON.parse(await readFile(timelinePath, 'utf8')) as { events?: TimelineEvent[] }
    events = Array.isArray(timeline.events) ? timeline.events : []
  }
  return { cases, events }
}

/* ---------------------------------- import --------------------------------- */

export interface ImportResult {
  added: number
  updated: number
  skipped: number
  eventsImported: number
  /** caseIds whose events were skipped (no matching case in source/import). */
  detail: string[]
}

/** A case id from the source that should be skipped (e.g. drafts). */
function isSkippable(c: CaseRecord): boolean {
  return c.caseId === undefined || c.caseId === '' || /^draft-/.test(c.caseId)
}

/** Merge one source case into the plugin store (create or update, idempotent). */
async function importCase(store: CaseStore, source: CaseRecord): Promise<'added' | 'updated'> {
  const existing = await store.readCase(source.caseId)
  const normalized: Record<string, unknown> = {
    caseId: source.caseId,
    name: source.name ?? `案件 ${source.caseId}`,
    type: normalizeCaseType(source.type),
    cause: source.cause,
    status: source.status,
    court: source.court,
    judge: source.judge,
    level: source.level,
    caseNumber: source.caseNumber,
    claimAmount: source.claimAmount,
    filingDate: source.filingDate,
    ourSide: source.ourSide,
    parties: source.parties,
    keyDates: source.keyDates ?? [],
    taskGroups: source.taskGroups ?? [],
    folder: source.folder,
    summary: source.summary,
    alias: source.alias,
    instances: source.instances,
    fee: source.fee,
    retainerUnit: source.retainerUnit,
    tags: source.tags ?? [],
    archived: source.archived,
    boundSessions: source.boundSessions ?? [],
    linkedContracts: source.linkedContracts ?? [],
    linkedResearch: source.linkedResearch ?? [],
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  }
  if (existing === undefined) {
    await store.registerCase(normalized)
    return 'added'
  }
  await store.updateCase(source.caseId, normalized)
  return 'updated'
}

/** Import all source events that belong to an imported case → 统一事项（event）。 */
async function importEvents(itemStore: import('../../item/store/item-store.ts').ItemStore, events: TimelineEvent[], validCaseIds: Set<string>): Promise<{ imported: number; skipped: number }> {
  let imported = 0
  let skipped = 0
  for (const e of events) {
    if (e.caseId === undefined || !validCaseIds.has(e.caseId)) { skipped++; continue }
    await itemStore.upsertItem({
      id: e.id,
      ownerId: e.caseId,
      ownerName: e.caseName,
      type: 'event',
      title: e.title || '',
      date: e.date,
      time: e.time,
      detail: e.detail,
      remindRules: e.remindRules,
    })
    imported++
  }
  return { imported, skipped }
}

/**
 * Run the import.
 * @param caseStore - plugin case store (destination).
 * @param itemStore - 统一事项 store（destination：events + tasks）。
 * @param sourceDir - AgentLex data directory (source; read-only).
 * @returns counts.
 */
export async function importFromAgentLex(
  caseStore: CaseStore,
  itemStore: import('../../item/store/item-store.ts').ItemStore,
  sourceDir: string,
): Promise<ImportResult> {
  const { cases, events } = await readAgentLexData(sourceDir)

  let added = 0
  let updated = 0
  let skipped = 0
  const validCaseIds = new Set<string>()
  const detail: string[] = []

  for (const c of cases) {
    if (isSkippable(c)) { skipped++; continue }
    const outcome = await importCase(caseStore, c)
    if (outcome === 'added') added++
    else updated++
    validCaseIds.add(c.caseId)
  }

  const { imported: eventsImported, skipped: eventsSkipped } = await importEvents(itemStore, events, validCaseIds)
  if (eventsSkipped > 0) detail.push(`${eventsSkipped} 个时间轴事件因无对应案件而跳过`)

  return { added, updated, skipped, eventsImported, detail }
}
