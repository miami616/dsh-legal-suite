/**
 * dsh-legal-suite/moot-court — 争点解析与报告合成。
 *
 * 输入来自两处：
 *   ① 裁判者在「争点归纳」阶段输出的结构化 JSON（issues）；
 *   ② 评议阶段的报告 JSON（倾向性结论、攻击线路、缺口、建议）。
 * 两者都可能因为模型输出不规范而解析失败——本模块的原则是**永不因解析失败
 * 而丢掉庭审**：解析不到结构化字段时回退为「从发言文本粗提」，并标注置信度。
 *
 * 检索锚定结果按争点回填 anchors；报告里同时固定写入程序性提示、模拟边界与
 * 免责声明（方案 §12 要求这三段是产物的一部分，不是附件）。
 */
import type { Citation, Dossier, Issue, MootGap, MootReport, MootSuggestion, AttackVector, TranscriptEntry, TrialSession } from '../store/types.ts'
import { MOOT_BOUNDARIES, MOOT_DISCLAIMER } from '../store/types.ts'
import type { ProcedurePlaybook } from '../playbook/types.ts'

/** 从裁判者发言里解析争点。 */
export function parseIssues(payload: unknown): Issue[] {
  if (payload === null || typeof payload !== 'object') return []
  const raw = (payload as { issues?: unknown }).issues
  if (!Array.isArray(raw)) return []
  const out: Issue[] = []
  raw.forEach((entry, index) => {
    if (entry === null || typeof entry !== 'object') return
    const item = entry as Record<string, unknown>
    const title = typeof item['title'] === 'string' && item['title'].trim() !== ''
      ? item['title'].trim()
      : typeof item['issue'] === 'string' ? item['issue'].trim() : ''
    if (title === '') return
    const strings = (value: unknown): string[] =>
      Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim()) : []
    out.push({
      id: typeof item['id'] === 'string' && item['id'] !== '' ? item['id'] : `issue-${index + 1}`,
      title,
      proCon: { us: strings(item['us'] ?? item['ours']), them: strings(item['them'] ?? item['theirs']) },
      evidenceRefs: strings(item['evidence'] ?? item['evidenceRefs']),
      anchors: { articles: [], cases: [] },
    })
  })
  return out.slice(0, 12)
}

/** 从评议发言里解析报告字段。 */
export interface ParsedReportFields {
  verdict?: { summary?: string; leaning?: string; usWinRate?: number; confidence?: string }
  scores?: Array<{ id?: string; title?: string; usWinRate?: number; confidence?: string; weakPoints?: string[] }>
  attackVectors?: AttackVector[]
  gaps?: MootGap[]
  suggestions?: MootSuggestion[]
}

export function parseReportFields(payload: unknown): ParsedReportFields {
  if (payload === null || typeof payload !== 'object') return {}
  const obj = payload as Record<string, unknown>
  const out: ParsedReportFields = {}

  const verdict = obj['verdict']
  if (verdict !== null && typeof verdict === 'object') {
    const v = verdict as Record<string, unknown>
    out.verdict = {
      ...(typeof v['summary'] === 'string' ? { summary: v['summary'] } : {}),
      ...(typeof v['leaning'] === 'string' ? { leaning: v['leaning'] } : {}),
      ...(typeof v['usWinRate'] === 'number' ? { usWinRate: v['usWinRate'] } : {}),
      ...(typeof v['confidence'] === 'string' ? { confidence: v['confidence'] } : {}),
    }
  }

  if (Array.isArray(obj['issues'])) {
    out.scores = (obj['issues'] as unknown[]).flatMap((entry) => {
      if (entry === null || typeof entry !== 'object') return []
      const item = entry as Record<string, unknown>
      const weakPoints = Array.isArray(item['weakPoints'])
        ? (item['weakPoints'] as unknown[]).filter((w): w is string => typeof w === 'string')
        : []
      return [{
        ...(typeof item['id'] === 'string' ? { id: item['id'] } : {}),
        ...(typeof item['title'] === 'string' ? { title: item['title'] } : {}),
        ...(typeof item['usWinRate'] === 'number' ? { usWinRate: item['usWinRate'] } : {}),
        ...(typeof item['confidence'] === 'string' ? { confidence: item['confidence'] } : {}),
        weakPoints,
      }]
    })
  }

  if (Array.isArray(obj['attackVectors'])) {
    out.attackVectors = (obj['attackVectors'] as unknown[]).flatMap((entry) => {
      if (entry === null || typeof entry !== 'object') return []
      const item = entry as Record<string, unknown>
      const point = typeof item['point'] === 'string' ? item['point'].trim() : ''
      if (point === '') return []
      const severity = item['severity']
      const source = item['source']
      return [{
        point: typeof item['detail'] === 'string' && item['detail'].trim() !== '' ? `${point}——${item['detail'].trim()}` : point,
        source: source === 'judge' ? 'judge' as const : 'opponent' as const,
        severity: severity === 'high' || severity === 'low' ? severity : 'medium' as const,
      }]
    })
  }

  if (Array.isArray(obj['gaps'])) {
    out.gaps = (obj['gaps'] as unknown[]).flatMap((entry) => {
      if (entry === null || typeof entry !== 'object') return []
      const item = entry as Record<string, unknown>
      const missing = typeof item['missing'] === 'string' ? item['missing'].trim() : ''
      if (missing === '') return []
      return [{
        ...(typeof item['issue'] === 'string' && item['issue'].trim() !== '' ? { issue: item['issue'].trim() } : {}),
        missing,
        reason: typeof item['reason'] === 'string' ? item['reason'] : '',
      }]
    })
  }

  if (Array.isArray(obj['suggestions'])) {
    out.suggestions = (obj['suggestions'] as unknown[]).flatMap((entry) => {
      if (entry === null || typeof entry !== 'object') return []
      const item = entry as Record<string, unknown>
      const title = typeof item['title'] === 'string' ? item['title'].trim() : ''
      if (title === '') return []
      const priority = item['priority']
      const kind = item['kind']
      return [{
        title,
        detail: typeof item['detail'] === 'string' ? item['detail'] : '',
        priority: priority === 'high' || priority === 'low' ? priority : 'medium' as const,
        kind: kind === 'evidence' || kind === 'document' ? kind : 'strategy' as const,
      }]
    })
  }

  return out
}

/** 从全部发言里粗提攻击线路（解析失败时的回退）。 */
function fallbackAttackVectors(entries: TranscriptEntry[]): AttackVector[] {
  const opponentLines = entries
    .filter((e) => e.actor === 'opponent' && e.kind === 'speech')
    .flatMap((e) => e.text.split(/(?<=[。；\n])/))
    .map((s) => s.trim())
    .filter((s) => s.length >= 12 && /不能成立|不予认可|缺乏依据|超过时效|主体不适格|证据不足|不应支持|应予驳回/.test(s))
    .slice(0, 8)
  return opponentLines.map((point) => ({ point, source: 'opponent' as const, severity: 'medium' as const }))
}

/** 置信度归一。 */
function confidenceOf(raw: string | undefined): 'high' | 'medium' | 'low' {
  return raw === 'high' || raw === 'low' ? raw : 'medium'
}

/** 倾向归一。 */
function leaningOf(raw: string | undefined): MootReport['verdict']['leaning'] {
  switch (raw) {
    case 'us': return 'us'
    case 'them': return 'them'
    case 'partial': return 'partial'
    default: return 'unclear'
  }
}

/** 报告合成输入。 */
export interface ReportInput {
  session: TrialSession
  playbook: ProcedurePlaybook
  dossier: Dossier
  issues: Issue[]
  entries: TranscriptEntry[]
  /** 评议阶段解析出的字段。 */
  fields: ParsedReportFields
  /** 检索锚定结果（按争点）。 */
  anchors: { byIssue: Record<string, { articles: Citation[]; cases: Citation[] }>; pool: Citation[]; degraded?: string }
  /** 检索是否启用。 */
  retrievalEnabled: boolean
  /** 金额测算结果（落进报告留痕）。 */
  calculations?: Array<{ action: string; input: string; summary: string; detail?: string }>
  /** 金额测算跳过原因（可选）。 */
  calcSkipped?: string
}

/**
 * 合成最终报告：把评议字段、检索锚定、程序提示、边界与免责固定拼接。
 */
export function buildReport(input: ReportInput): MootReport {
  const { session, playbook, issues, entries, fields, anchors } = input

  // 争点评分回填（按 id 或标题匹配）。
  const scoredIssues: Issue[] = issues.map((issue, index) => {
    const score = fields.scores?.find((s) =>
      (s.id !== undefined && s.id === issue.id) || (s.title !== undefined && s.title === issue.title),
    ) ?? fields.scores?.[index]
    const perIssue = anchors.byIssue[issue.id] ?? { articles: [], cases: [] }
    return {
      ...issue,
      anchors: perIssue,
      ...(score === undefined ? {} : {
        score: {
          usWinRate: Math.max(0, Math.min(100, Math.round(score.usWinRate ?? 50))),
          confidence: confidenceOf(score.confidence),
          weakPoints: score.weakPoints ?? [],
        },
      }),
    }
  })

  const winRate = Math.max(0, Math.min(100, Math.round(
    fields.verdict?.usWinRate
    ?? (scoredIssues.length > 0
      ? scoredIssues.reduce((sum, i) => sum + (i.score?.usWinRate ?? 50), 0) / scoredIssues.length
      : 50),
  )))

  const attackVectors = (fields.attackVectors !== undefined && fields.attackVectors.length > 0)
    ? fields.attackVectors
    : fallbackAttackVectors(entries)

  const proceduralNotes = [...playbook.proceduralNotes]
  if (input.calcSkipped !== undefined) proceduralNotes.push(`金额测算：${input.calcSkipped}`)

  const retrievalCitations = scoredIssues.reduce(
    (sum, i) => sum + i.anchors.articles.length + i.anchors.cases.length,
    0,
  )

  return {
    sessionId: session.id,
    procedure: session.procedure,
    mode: session.mode,
    generatedAt: new Date().toISOString(),
    verdict: {
      summary: fields.verdict?.summary
        ?? (session.mode === 'stress'
          ? '本次为文书压力测试，未生成裁判结论，请以攻击面与缺口清单为主。'
          : '评议未产出结构化结论，请结合争点评分与庭审记录自行判断。'),
      leaning: leaningOf(fields.verdict?.leaning),
      usWinRate: winRate,
      confidence: confidenceOf(fields.verdict?.confidence),
    },
    issues: scoredIssues,
    attackVectors,
    gaps: fields.gaps ?? [],
    suggestions: fields.suggestions ?? [],
    proceduralNotes,
    ...(input.calculations === undefined || input.calculations.length === 0
      ? {}
      : { calculations: input.calculations }),
    ...(input.calcSkipped === undefined ? {} : { calculationSkipped: input.calcSkipped }),
    boundaries: [...MOOT_BOUNDARIES],
    disclaimers: [MOOT_DISCLAIMER],
    retrieval: {
      enabled: input.retrievalEnabled,
      citations: retrievalCitations,
      ...(anchors.degraded === undefined ? {} : { degraded: anchors.degraded }),
    },
    budget: {
      tokensUsed: session.stats.tokensUsed,
      truncated: session.stats.truncated === true,
    },
  }
}
