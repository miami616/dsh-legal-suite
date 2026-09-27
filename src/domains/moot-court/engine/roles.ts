/**
 * dsh-legal-suite/moot-court — 提示词组装（三段式）。
 *
 * 每次角色发言都由三段组成：
 *   ① 人格卡（prompts/roles.ts）+ 模式说明 + 通用规则；
 *   ② 庭审上下文：案件快照 + 已归纳争点 + 庭审记录窗口（尾部原文 + 早期摘要）；
 *   ③ 当期指令：playbook 给的 instruction（本阶段该说什么）。
 *
 * 上下文窗口策略（token 硬控）：尾部 K 条发言保留原文，更早的发言压缩成
 * 「角色：首句…」的摘要行；结构化争点与证据目录始终完整保留。
 */
import type { Citation, Dossier, Issue, TranscriptEntry, TrialSession } from '../store/types.ts'
import type { ProcedurePlaybook, Turn } from '../playbook/types.ts'
import {
  COMMON_RULES,
  ISSUES_JSON_CONTRACT,
  REPORT_JSON_CONTRACT,
  caseContextBlock,
  judgeSystem,
  modeBrief,
  opponentSystem,
  selfSystem,
} from '../prompts/roles.ts'

/** 上下文预算（字符数，约 4k-6k token）。 */
const TAIL_ENTRIES = 8
const TAIL_CHARS = 7000
const DIGEST_CHARS = 2400
const SINGLE_ENTRY_MAX = 1600

/** 一次发言要发的请求。 */
export interface TurnPrompt {
  system: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  /** 本 turn 期望的最大输出 token。 */
  maxTokens: number
  /** 采样温度。 */
  temperature: number
}

/** 组装上下文需要的材料。 */
export interface PromptInput {
  session: TrialSession
  playbook: ProcedurePlaybook
  dossier: Dossier
  turn: Turn
  /** 全部庭审记录（升序）。 */
  entries: TranscriptEntry[]
  /** 已归纳的争点。 */
  issues: Issue[]
  /** 检索清单（citation pool）。 */
  pool: Citation[]
  /** 金额测算结果（legal_calc 输出，渲染好的文本）。 */
  calcText?: string
  /** 单方预演：律师刚刚输入的我方发言。 */
  userInput?: string
}

/** 角色 → 系统人格卡。 */
function personaOf(input: PromptInput): string {
  const { session, playbook, turn } = input
  const header = [`# 角色：${turn.roleLabel}`, modeBrief(session.mode, session.procedure)].join('\n')
  let persona: string
  switch (turn.actor) {
    case 'judge':
      persona = judgeSystem(playbook, session)
      break
    case 'opponent':
      persona = opponentSystem(playbook)
      break
    case 'self':
      persona = selfSystem(playbook)
      break
    default:
      persona = [...COMMON_RULES].join('\n')
  }
  return `${header}\n\n${persona}`
}

/** 单条发言渲染（超过上限时截断）。 */
function renderEntry(entry: TranscriptEntry): string {
  const text = entry.text.length > SINGLE_ENTRY_MAX ? `${entry.text.slice(0, SINGLE_ENTRY_MAX)}…` : entry.text
  return `【${entry.phaseTitle}】${entry.roleLabel}：${text}`
}

/**
 * 构造庭审记录上下文：尾部原文 + 早期摘要。
 * @param entries - 全部记录（升序）。
 */
export function buildTranscriptContext(entries: TranscriptEntry[]): string {
  if (entries.length === 0) return '（庭审尚未开始，你是第一位发言者。）'
  const tail = entries.slice(-TAIL_ENTRIES)
  const head = entries.slice(0, Math.max(0, entries.length - TAIL_ENTRIES))

  const parts: string[] = []
  if (head.length > 0) {
    const digest: string[] = []
    let used = 0
    for (const entry of head) {
      const line = `- 【${entry.phaseTitle}】${entry.roleLabel}：${entry.text.replace(/\s+/g, ' ').slice(0, 90)}`
      if (used + line.length > DIGEST_CHARS) break
      digest.push(line)
      used += line.length
    }
    parts.push('## 庭审记录（早期摘要）', digest.join('\n'))
  }
  parts.push('## 庭审记录（最近发言，按时间顺序）')
  let used = 0
  const rendered: string[] = []
  for (const entry of [...tail].reverse()) {
    const text = renderEntry(entry)
    if (used + text.length > TAIL_CHARS) break
    rendered.unshift(text)
    used += text.length
  }
  parts.push(rendered.length === 0 ? '（略）' : rendered.join('\n\n'))
  return parts.join('\n')
}

/** 争点块。 */
function buildIssuesBlock(issues: Issue[]): string {
  if (issues.length === 0) return '## 已归纳争议焦点\n（尚未归纳；若本阶段正是归纳争点，请你完成归纳。）'
  const lines = ['## 已归纳争议焦点']
  issues.forEach((issue, index) => {
    lines.push(`${index + 1}. ${issue.title}`)
    if (issue.proCon.us.length > 0) lines.push(`   - 我方主张：${issue.proCon.us.join('；')}`)
    if (issue.proCon.them.length > 0) lines.push(`   - 对方主张：${issue.proCon.them.join('；')}`)
    if (issue.evidenceRefs.length > 0) lines.push(`   - 关联证据：${issue.evidenceRefs.join('、')}`)
  })
  return lines.join('\n')
}

/** 检索清单块。 */
function buildPoolBlock(pool: Citation[]): string {
  if (pool.length === 0) {
    return '## 检索清单\n（本次未取得检索结果：引用法条或类案时请标注「（无对应检索结果）」，不要虚构。）'
  }
  const lines = ['## 检索清单（引用只能来自此清单）']
  pool.slice(0, 24).forEach((c, index) => {
    const tag = c.kind === 'article' ? '法条' : '类案'
    const bits = [`[${index + 1}] ${tag}｜${c.ref}`]
    if (c.title !== undefined && c.title !== c.ref) bits.push(`标题：${c.title}`)
    if (c.source !== undefined) bits.push(`出处：${c.source}`)
    if (c.summary !== undefined) bits.push(`摘要：${c.summary}`)
    lines.push(bits.join('　'))
  })
  return lines.join('\n')
}

/**
 * 生成一次角色发言的完整请求。
 * @param input - 上下文材料。
 */
export function buildTurnPrompt(input: PromptInput): TurnPrompt {
  const { turn, session } = input
  const systemParts = [personaOf(input)]
  if (turn.actor === 'judge' && input.turn.instruction?.includes('JSON 输出要求')) {
    systemParts.push(ISSUES_JSON_CONTRACT)
  }
  if (turn.actor === 'judge' && input.turn.instruction?.includes('弱环节')) {
    systemParts.push(REPORT_JSON_CONTRACT)
  }

  const userParts: string[] = [
    caseContextBlock(input.dossier),
    buildIssuesBlock(input.issues),
    buildPoolBlock(input.pool),
    buildTranscriptContext(input.entries),
  ]
  if (input.calcText !== undefined && input.calcText !== '') {
    userParts.push('## 金额测算结果（必须直接采用，不得自行口算）', input.calcText)
  }
  if (input.userInput !== undefined && input.userInput !== '') {
    userParts.push('## 律师本人的我方发言（本轮由律师本人作出）', input.userInput)
  }
  userParts.push('## 本阶段指令', turn.instruction ?? '按你的角色与当前程序阶段作出适当发言。')

  const maxTokens = turn.maxTokens ?? Math.min(session.config.maxTokensPerTurn, 2400)
  const temperature = turn.actor === 'opponent' ? session.config.opponentTemperature : 0.3

  return {
    system: systemParts.join('\n\n'),
    messages: [{ role: 'user', content: userParts.join('\n\n') }],
    maxTokens,
    temperature,
  }
}

/** 拆出文本里的最后一个 JSON 代码块。 */
export function extractJsonBlock(text: string): unknown {
  const matches = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)]
  for (const match of matches.reverse()) {
    const body = match[1]?.trim()
    if (body === undefined || body === '') continue
    try {
      return JSON.parse(body)
    } catch {
      continue
    }
  }
  // 没有围栏时尝试直接解析整段。
  const start = text.indexOf('{')
  if (start >= 0) {
    try {
      return JSON.parse(text.slice(start))
    } catch {
      return undefined
    }
  }
  return undefined
}

/** 从发言中剥离 JSON 代码块，保留人类可读的发言正文。 */
export function stripJsonBlock(text: string): string {
  return text.replace(/```(?:json)?\s*[\s\S]*?```/gi, '').trim()
}
