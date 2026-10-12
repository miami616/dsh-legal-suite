/**
 * 脱敏编排层：工具（tools.ts）/ HTTP 路由（routes.ts）/ 命令行（scripts/redact-file.mjs）共用。
 *
 * 两种输入形态：
 *   文本 —— text 直接进引擎；
 *   文件 —— .docx 走「unzip → 改 XML → zip」出**保格式副本**，.pdf/.txt/图片走取文后出脱敏文本。
 * 两种输出形态：脱敏（可还原 / 对外单向）与还原（把假名换回真名，含未还原清单）。
 *
 * 所有识别与替换在本机完成，不联网、不上传。
 */
import { writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { EntityKind, KindStat, LexiconEntry, RedactMode, RedactReport } from './engine/types.ts'
import { aliasKindEntitiesOnly, collectRestoreSpans, redactText, restoreText } from './engine/redact.ts'
import { applySpansToPart, type DocxPart } from './docx.ts'
import { extractText, kindOf, outputPathFor, readDocxParts, writeDocxCopy } from './extract.ts'
import type { LexiconDirs } from './lexicon-source.ts'
import { collectLexiconEntries } from './lexicon-source.ts'
import type { RedactStore } from './store/redact-store.ts'
import { assertScope } from './store/redact-store.ts'

export interface ServiceDeps {
  store: RedactStore
  dirs: LexiconDirs
  /** 脱敏数据目录（报告映射表路径用）。 */
  dataDir: string
}

export interface RedactRequest {
  /** 直接输入文本。 */
  text?: string
  /** 或输入文件路径（.docx / .pdf / .txt / .md / 图片）。 */
  path?: string
  scope?: string
  mode?: RedactMode
  /** 输出路径（默认同目录 <原名>.redacted<ext>）。 */
  outPath?: string
  crossScope?: boolean
  maskAmounts?: boolean
  heuristic?: boolean
  /** false=只算不落盘（scan / 试算用）。 */
  save?: boolean
  /** true=候选带上原文（**仅本机界面**；agent 工具不传）。 */
  reveal?: boolean
  /** true=响应里回吐脱敏文本（界面展示用；大文件自动截断到 40 万字）。 */
  includeText?: boolean
}

export interface CandidateView { display: string; anchor: string; count: number; value?: string }
export interface ReportView extends Omit<RedactReport, 'candidates'> {
  candidates: CandidateView[]
}

function toReportView(report: RedactReport, reveal?: boolean): ReportView {
  return {
    ...report,
    candidates: report.candidates.map((candidate): CandidateView => ({
      display: candidate.display,
      anchor: candidate.anchor,
      count: candidate.count,
      ...(reveal === true ? { value: candidate.value } : {}),
    })),
  }
}

export interface RedactResponse {
  scope: string
  mode: RedactMode
  /** 文本输入回吐脱敏文本；文件输入默认不回吐（includeText=true 时回吐）。 */
  text?: string
  /** 主产物路径：docx → 保格式副本；其它 → 脱敏文本。 */
  outPath?: string
  /** 全部产物（docx 会同时给 .docx 与 .txt）。 */
  outPaths: string[]
  mappingPath: string
  restorable: boolean
  report: ReportView
  /** 取文/写回的口径说明（让用户知道用的是哪条链路）。 */
  notes: string[]
}

export interface ScanResponse {
  scope: string
  lexiconCount: number
  report: ReportView
  notes: string[]
}

/** 合并多个 part 的报告。 */
function mergeReports(target: RedactReport, source: RedactReport): RedactReport {
  const byKind = new Map<string, KindStat>()
  for (const stat of [...target.byKind, ...source.byKind]) {
    const prev = byKind.get(stat.kind)
    if (prev === undefined) byKind.set(stat.kind, { ...stat, samples: [...stat.samples] })
    else {
      prev.count += stat.count
      for (const sample of stat.samples) if (prev.samples.length < 5 && !prev.samples.includes(sample)) prev.samples.push(sample)
    }
  }
  const candidates = [...target.candidates]
  for (const candidate of source.candidates) {
    if (!candidates.some((item) => item.display === candidate.display)) candidates.push(candidate)
  }
  return {
    ...target,
    totalHits: target.totalHits + source.totalHits,
    byKind: [...byKind.values()].sort((a, b) => b.count - a.count),
    candidates,
    newAliases: [...target.newAliases, ...source.newAliases.filter((item) => !target.newAliases.some((other) => other.alias === item.alias))],
    warnings: [...new Set([...target.warnings, ...source.warnings])],
    restorable: target.restorable && source.restorable,
  }
}

function emptyReport(scope: string, mode: RedactMode, restorable: boolean): RedactReport {
  return { mode, scope, totalHits: 0, byKind: [], candidates: [], newAliases: [], warnings: [], restorable }
}

/** 合并案件库词条与自定义词条（自定义词条带各自 scope）。 */
export async function loadEntries(deps: ServiceDeps, scope: string): Promise<LexiconEntry[]> {
  const terms = await deps.store.listTerms(scope)
  const custom: LexiconEntry[] = [
    ...terms.global.map((term) => ({ value: term.value, kind: term.kind, scopes: ['global'], source: 'custom', note: term.note })),
    ...terms.caseTerms.map((term) => ({ value: term.value, kind: term.kind, scopes: [scope], source: 'custom', note: term.note })),
  ]
  return await collectLexiconEntries(deps.dirs, custom)
}

async function resolveText(request: RedactRequest): Promise<{ text: string; note: string }> {
  if (request.text !== undefined && request.text !== '') return { text: request.text, note: '文本输入' }
  if (request.path !== undefined && request.path !== '') {
    const extracted = await extractText(request.path)
    return { text: extracted.text, note: extracted.note }
  }
  throw new Error('需要 text（直接文本）或 path（文件路径）之一')
}

/** 试算/预检：跑引擎但不落盘、不回吐正文。 */
export async function runScan(deps: ServiceDeps, request: RedactRequest): Promise<ScanResponse> {
  const scope = assertScope(request.scope ?? 'global')
  const config = await deps.store.readConfig()
  const entries = await loadEntries(deps, scope)
  const { text, note } = await resolveText(request)
  const existing = await deps.store.readMapping(scope)
  const outcome = redactText({
    text,
    scope,
    mode: 'reversible',
    entries,
    existing: existing?.entities,
    restorable: existing?.restorable ?? true,
    maskAmounts: request.maskAmounts ?? config.maskAmounts,
    heuristic: request.heuristic ?? config.heuristic,
    crossScope: request.crossScope ?? config.crossScope,
  })
  return {
    scope,
    lexiconCount: entries.length,
    report: toReportView(outcome.report, request.reveal),
    notes: [note],
  }
}

/** 正式脱敏：落盘映射（按模式），文件输入写产物。 */
export async function runRedact(deps: ServiceDeps, request: RedactRequest): Promise<RedactResponse> {
  const scope = assertScope(request.scope ?? 'global')
  const mode: RedactMode = request.mode === 'masked' ? 'masked' : 'reversible'
  const config = await deps.store.readConfig()
  const entries = await loadEntries(deps, scope)
  const existing = await deps.store.readMapping(scope)
  const engineOptions = {
    scope,
    mode,
    entries,
    restorable: existing?.restorable ?? true,
    maskAmounts: request.maskAmounts ?? config.maskAmounts,
    heuristic: request.heuristic ?? config.heuristic,
    crossScope: request.crossScope ?? config.crossScope,
  } as const

  const notes: string[] = []
  let report: RedactReport = emptyReport(scope, mode, engineOptions.restorable)
  let entities = existing?.entities ?? {}
  let redactedText = ''
  const outPaths: string[] = []
  let outPath: string | undefined

  // ---- 文件输入：docx 走保格式写回；其它类型出脱敏文本 ----
  if ((request.text === undefined || request.text === '') && request.path !== undefined && request.path !== '') {
    const path = request.path
    const kind = kindOf(path)
    if (kind === 'docx') {
      const parts: DocxPart[] = await readDocxParts(path)
      const edited = new Map<string, string>()
      const texts: string[] = []
      for (const part of parts) {
        if (part.text.trim() === '') { texts.push(part.text); continue }
        const outcome = redactText({ ...engineOptions, text: part.text, existing: entities })
        entities = outcome.entities
        report = mergeReports(report, outcome.report)
        const applied = applySpansToPart(part, outcome.spans)
        if (applied.skipped.length > 0) {
          report = { ...report, warnings: [...report.warnings, `${part.name}: ${applied.skipped.length} 处命中跨段落，未能写回（请在文本模式核对）`] }
        }
        edited.set(part.name, applied.xml)
        texts.push(outcome.text)
      }
      redactedText = texts.join('\n\n')
      const docxOut = request.outPath !== undefined && request.outPath.trim() !== ''
        ? request.outPath
        : outputPathFor(path, '.redacted.docx')
      if (request.save !== false) {
        await writeDocxCopy(path, docxOut, edited)
        outPaths.push(docxOut)
        outPath = docxOut
        const textOut = outputPathFor(path, '.redacted.txt')
        await writeFile(textOut, redactedText, 'utf8')
        outPaths.push(textOut)
      }
      notes.push(`docx 保格式写回（改了 ${edited.size} 个文本区：正文/页眉/脚注/批注）`)
      notes.push('同时输出脱敏纯文本（.redacted.txt），可直接喂给模型')
    } else {
      const extracted = await extractText(path)
      notes.push(extracted.note)
      const outcome = redactText({ ...engineOptions, text: extracted.text, existing: entities })
      entities = outcome.entities
      report = mergeReports(report, outcome.report)
      redactedText = outcome.text
      if (request.save !== false) {
        const textOut = request.outPath !== undefined && request.outPath.trim() !== ''
          ? request.outPath
          : outputPathFor(path, '.redacted.txt')
        await writeFile(textOut, redactedText, 'utf8')
        outPaths.push(textOut)
        outPath = textOut
      }
      if (kind === 'pdf') notes.push('PDF 只出脱敏文本（本机不无损改写 PDF 版式）')
    }
  } else {
    // ---- 文本输入 ----
    const text = request.text ?? ''
    const outcome = redactText({ ...engineOptions, text, existing: entities })
    entities = outcome.entities
    report = mergeReports(report, outcome.report)
    redactedText = outcome.text
    notes.push('文本输入')
  }

  // ---- 落盘映射 ----
  let mappingPath = ''
  if (request.save !== false) {
    const toPersist = mode === 'masked' ? aliasKindEntitiesOnly(entities) : entities
    const doc = await deps.store.writeMapping({ scope, mode, restorable: report.restorable, entities: toPersist })
    mappingPath = join(deps.dataDir, 'mappings', `${doc.scope}.json`)
  }

  const wantText = request.text !== undefined && request.text !== ''
  const includeText = wantText || request.includeText === true
  return {
    scope,
    mode,
    ...(includeText ? { text: redactedText.slice(0, 400_000) } : {}),
    ...(outPath === undefined ? {} : { outPath }),
    outPaths,
    mappingPath,
    restorable: report.restorable,
    report: toReportView(report, request.reveal),
    notes,
  }
}

export interface RestoreResponse {
  scope: string
  text?: string
  outPath?: string
  outPaths: string[]
  restored: number
  missing: Array<{ alias: string; count: number }>
  ambiguous: string[]
  notes: string[]
}

/** 还原：仅 reversible 映射可用；支持文本与文件（docx 也能写回保格式副本）。 */
export async function runRestore(deps: ServiceDeps, request: RedactRequest): Promise<RestoreResponse> {
  const scope = assertScope(request.scope ?? 'global')
  const mapping = await deps.store.readMapping(scope)
  if (mapping === undefined) throw new Error(`没有找到 scope=${scope} 的映射表，无法还原`)

  const notes: string[] = []
  const outPaths: string[] = []
  let outPath: string | undefined
  let restored = 0
  let missing: Array<{ alias: string; count: number }> = []
  const ambiguous: string[] = []
  let resultText = ''

  if ((request.text === undefined || request.text === '') && request.path !== undefined && request.path !== '') {
    const path = request.path
    if (kindOf(path) === 'docx') {
      const parts = await readDocxParts(path)
      const edited = new Map<string, string>()
      const texts: string[] = []
      for (const part of parts) {
        if (part.text.trim() === '') { texts.push(part.text); continue }
        const collected = collectRestoreSpans(part.text, mapping)
        restored += collected.spans.length
        ambiguous.push(...collected.ambiguous)
        const applied = applySpansToPart(part, collected.spans)
        edited.set(part.name, applied.xml)
        // 还原后的文本
        let text = ''
        let cursor = 0
        for (const span of [...collected.spans].sort((a, b) => a.start - b.start)) {
          if (span.start < cursor) continue
          text += part.text.slice(cursor, span.start) + span.replacement
          cursor = span.end
        }
        texts.push(text + part.text.slice(cursor))
      }
      resultText = texts.join('\n\n')
      const docxOut = request.outPath !== undefined && request.outPath.trim() !== ''
        ? request.outPath
        : outputPathFor(path, '.restored.docx')
      await writeDocxCopy(path, docxOut, edited)
      outPaths.push(docxOut)
      outPath = docxOut
      notes.push('docx 保格式还原')
    } else {
      const extracted = await extractText(path)
      notes.push(extracted.note)
      const outcome = restoreText(extracted.text, mapping)
      resultText = outcome.text
      restored = outcome.restored
      missing = outcome.missing
      ambiguous.push(...outcome.ambiguous)
      const textOut = request.outPath !== undefined && request.outPath.trim() !== ''
        ? request.outPath
        : outputPathFor(path, '.restored.txt')
      await writeFile(textOut, resultText, 'utf8')
      outPaths.push(textOut)
      outPath = textOut
    }
  } else {
    const outcome = restoreText(request.text ?? '', mapping)
    resultText = outcome.text
    restored = outcome.restored
    missing = outcome.missing
    ambiguous.push(...outcome.ambiguous)
    notes.push('文本还原')
  }

  const wantText = request.text !== undefined && request.text !== ''
  const includeText = wantText || request.includeText === true
  return {
    scope,
    ...(includeText ? { text: resultText.slice(0, 400_000) } : {}),
    ...(outPath === undefined ? {} : { outPath }),
    outPaths,
    restored,
    missing,
    ambiguous: [...new Set(ambiguous)],
    notes,
  }
}

/** 词条/映射/配置的读取面（工具与路由共用）。 */
export async function readTermsAndMappings(deps: ServiceDeps, scope?: string): Promise<{
  terms: { global: Array<{ value: string; kind: EntityKind; note?: string }>; caseTerms: Array<{ value: string; kind: EntityKind; note?: string }> }
  mappingScopes: string[]
}> {
  const terms = await deps.store.listTerms(scope)
  return {
    terms: {
      global: terms.global.map(({ value, kind, note }) => ({ value, kind, ...(note === undefined ? {} : { note }) })),
      caseTerms: terms.caseTerms.map(({ value, kind, note }) => ({ value, kind, ...(note === undefined ? {} : { note }) })),
    },
    mappingScopes: await deps.store.listMappingScopes(),
  }
}

/** 批量：目录内所有可处理文件逐个脱敏（整卷对外提供用）。 */
export async function runRedactDirectory(
  deps: ServiceDeps,
  request: RedactRequest & { dir: string },
): Promise<{ scope: string; mode: RedactMode; results: Array<{ file: string; outPaths: string[]; hits: number; error?: string }>; notes: string[] }> {
  const { listProcessable } = await import('./extract.ts')
  const { dir, ...options } = request
  const scope = assertScope(options.scope ?? 'global')
  const mode: RedactMode = options.mode === 'masked' ? 'masked' : 'reversible'
  const files = await listProcessable(dir)
  const results: Array<{ file: string; outPaths: string[]; hits: number; error?: string }> = []
  for (const file of files) {
    try {
      const result = await runRedact(deps, { ...options, path: file, text: undefined })
      results.push({ file: basename(file), outPaths: result.outPaths, hits: result.report.totalHits })
    } catch (error) {
      results.push({ file: basename(file), outPaths: [], hits: 0, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return { scope, mode, results, notes: [`批量处理 ${files.length} 个文件（跳过不支持的类型）`, '同一归属共用一张映射表，假名跨文件一致'] }
}
