/**
 * dsh-legal-suite/moot-court — 判决书 / 裁决书分段生成。
 *
 * 方案 §6：判决不能一次性糊出来，按裁判文书的自然段落分段生成，段间共享同一份
 * 上下文（案件快照 + 争点 + 庭审记录 + 检索清单 + 金额测算）。首部与尾部由引擎
 * 按裁判文书规范硬编码拼装，只有「本院查明 / 本院认为 / 判项」三段进模型。
 *
 * 引用约束：每段都把 citation pool 作为唯一可引来源注入；生成后再做一次
 * `citationsGrounded` 合规检查，把越界引用记入返回值（不删除正文，保持可读性，
 * 由报告提示律师复核）。
 */
import type { Citation, Dossier, Issue, TranscriptEntry, TrialSession } from '../store/types.ts'
import { MOOT_DISCLAIMER } from '../store/types.ts'
import type { ProcedurePlaybook } from '../playbook/types.ts'
import type { LlmGateway, ModelRoute } from './llm.ts'
import { buildTranscriptContext } from './roles.ts'
import { caseContextBlock, judgeSystem, judgmentSegmentsContract } from '../prompts/roles.ts'
import { citationsGrounded, renderCitationPool } from './retrieval.ts'

/** 判决生成输入。 */
export interface JudgmentInput {
  gateway: LlmGateway
  session: TrialSession
  playbook: ProcedurePlaybook
  dossier: Dossier
  issues: Issue[]
  entries: TranscriptEntry[]
  pool: Citation[]
  /** 金额测算文本（legal_calc 结果）。 */
  calcText?: string
  /**
   * 案件受理费的确定金额（legal_calc 结果）。
   * 判项里的 `{{FEE}}` 占位符由引擎替换成该值——金额不允许由模型口算。
   */
  feeAmount?: string
  route?: ModelRoute
  signal: AbortSignal
  /** 检索降级说明（未完成法条/类案锚定时写入文书末尾，提示可检验性下降）。 */
  retrievalNote?: string
  /** 每完成一段回调（用于前端进度与 transcript 记录）。 */
  onSegment?: (name: string, text: string) => void | Promise<void>
}

/** 判决生成结果。 */
export interface JudgmentResult {
  markdown: string
  calls: number
  tokens: number
  /** 引用合规性问题（越界引用清单）。 */
  foreignCitations: string[]
}

/** 段任务定义。 */
interface Segment {
  name: string
  instruction: string
  maxTokens: number
}

/** 构造分段任务。 */
function segmentsFor(playbook: ProcedurePlaybook, mode: string): Segment[] {
  if (mode === 'stress') return []
  return [
    {
      name: '本院查明',
      instruction:
        '撰写「本院查明」段落。要求：①按时间顺序叙述经审理查明的事实；②只写有证据支持的事实，' +
        '对有争议的事实写明各方主张与本院采信结论；③对不予采信的证据与主张简要说明理由；' +
        '④不使用「原告称」这类转述式表述作为查明结论。不超过 1200 字。',
      maxTokens: 3000,
    },
    {
      name: '本院认为',
      instruction:
        '撰写「本院认为」段落。要求：①逐争点说理，每个争点使用「关于……问题，本院认为……」的' +
        '结构；②每个争点必须写明支持与不支持的理由，并引用检索清单中的法条与类案；' +
        '③对对方的核心抗辩逐一回应；④金额部分直接采用系统给出的测算结果，不得自行计算。' +
        '不超过 2000 字。',
      maxTokens: 5000,
    },
    {
      name: '判项',
      instruction:
        `撰写${playbook.judgmentTitle}的判决主文与诉讼费用负担部分。要求：①主文逐项对应诉讼/仲裁请求，` +
        '表述为「一、……；二、……」；②支持多少写多少，不予支持的明确写「驳回其他诉讼请求」；' +
        '③诉讼费/仲裁费负担按裁判结果分配；**案件受理费的金额必须原样写成 `{{FEE}}` 占位符**' +
        '（由系统用测算结果回填，不要改写、不要自行计算、不要省略）；④不写说理。不超过 600 字。',
      maxTokens: 2200,
    },
  ]
}

/** 首部（硬编码，遵循裁判文书规范）。 */
function buildHead(playbook: ProcedurePlaybook, dossier: Dossier, session: TrialSession): string {
  const lines: string[] = []
  lines.push(`# ${dossier.court ?? '（模拟）'}${playbook.judgmentTitle}`)
  lines.push('')
  lines.push(`（模拟文书 · 案件编号 ${dossier.caseNumber ?? dossier.caseId ?? session.id}）`)
  lines.push('')
  const partyLines = dossier.parties.map((p) => {
    const suffix = p.ourClient ? '（我方当事人）' : ''
    return `- ${p.role}：${p.name}${suffix}`
  })
  if (partyLines.length > 0) {
    lines.push('**当事人**')
    lines.push(...partyLines)
    lines.push('')
  }
  lines.push(`**案由/争议类型**：${dossier.cause ?? '未载明'}`)
  if (dossier.ourRole !== undefined) lines.push(`**我方角色**：${dossier.ourRole}`)
  lines.push(`**审理程序**：${playbook.title}（${session.tribunal === 'single' ? '独任' : session.tribunal === 'collegial' ? '合议庭' : session.tribunal === 'arb_solo' ? '独任仲裁庭' : '三人仲裁庭'}）`)
  if (dossier.claims.length > 0) {
    lines.push('')
    lines.push('**请求事项**')
    dossier.claims.forEach((claim, index) => lines.push(`${index + 1}. ${claim}`))
  }
  lines.push('')
  lines.push('---')
  lines.push('')
  return lines.join('\n')
}

/** 尾部（救济途径 + 锚定说明 + 免责，硬编码）。 */
function buildFoot(playbook: ProcedurePlaybook, session: TrialSession, retrievalNote?: string): string {
  const lines: string[] = []
  lines.push('')
  lines.push('---')
  lines.push('')
  switch (session.procedure) {
    case 'civil_first':
      lines.push('如不服本判决，可在判决书送达之日起十五日内向本院递交上诉状，并按对方当事人的人数提出副本，上诉于上一级人民法院。')
      break
    case 'civil_second':
      lines.push('本判决为终审判决。')
      lines.push('')
      lines.push('当事人对本判决不服的，可以依法申请再审或向人民检察院申请检察建议、抗诉。')
      break
    case 'labor_arb':
      lines.push('当事人对本裁决不服的，可自收到本裁决书之日起十五日内向人民法院提起诉讼；期满不起诉的，本裁决书即发生法律效力。')
      lines.push('')
      lines.push('属于终局裁决情形的，用人单位不得向人民法院提起诉讼，可以依法申请撤销。')
      break
    case 'commercial_arb':
      lines.push('本裁决为终局裁决，自作出之日起发生法律效力。')
      break
    default:
      break
  }
  if (playbook.judgmentTitle === '仲裁裁决书') {
    lines.push('')
    lines.push('（模拟文书：仲裁员签名、仲裁委员会盖章栏从略）')
  }
  lines.push('')
  lines.push('---')
  lines.push('')
  if (retrievalNote !== undefined && retrievalNote !== '') {
    lines.push(`> **锚定说明**：本次模拟未完成类案/法条锚定（原因：${retrievalNote}）。` +
      '本判决的法条与类案依据未经检索校验，结论的可检验性下降，请以现行有效法律与真实类案复核。')
    lines.push('')
  }
  lines.push(`> **${MOOT_DISCLAIMER}**`)
  return lines.join('\n')
}

/** 生成一个段落。 */
async function generateSegment(
  input: JudgmentInput,
  segment: Segment,
  headText: string,
): Promise<{ text: string; tokens: number }> {
  const { session, playbook, dossier, issues, entries, pool, gateway } = input
  const systemParts = [
    judgeSystem(playbook, session),
    judgmentSegmentsContract(playbook),
  ]
  const userParts = [
    caseContextBlock(dossier),
    '## 争议焦点',
    issues.length === 0
      ? '（无结构化争点，请按庭审记录自行归纳）'
      : issues.map((i, idx) => `${idx + 1}. ${i.title}`).join('\n'),
    '## 检索清单（引用只能来自此清单）',
    renderCitationPool(pool),
    '## 庭审记录',
    buildTranscriptContext(entries),
  ]
  if (input.calcText !== undefined && input.calcText !== '') {
    userParts.push('## 金额测算结果（必须直接采用）', input.calcText)
  }
  userParts.push('## 已生成的前序段落', headText === '' ? '（无）' : headText.slice(-3000))
  userParts.push('## 本段任务', segment.instruction)

  const result = await gateway.generate({
    system: systemParts.join('\n\n'),
    messages: [{ role: 'user', content: userParts.join('\n\n') }],
    ...(input.route === undefined ? {} : { route: input.route }),
    maxTokens: segment.maxTokens,
    temperature: 0.25,
    signal: input.signal,
  })
  return { text: result.text, tokens: result.tokens }
}

/**
 * 段落清洗：标题与救济告知由**引擎统一生成**，模型若自写就会重复、口径还可能不一致。
 * 处理三件事：
 *   ① 去掉段首的重复标题行（模型常自己写「## 本院查明」，否则会出现两次）；
 *   ② 去掉「判决如下：」这类引导语（引擎已加段落标题）；
 *   ③ 去掉模型自写的上诉权/终局性告知行（尾部有规范版本）。
 */
function sanitizeSegment(text: string, name: string): string {
  let out = text.trim()
  const lines = out.split('\n')
  // ① 段首连续标题行（含与段名相同或不同的标题）。
  while (lines.length > 0 && /^#{1,6}\s*\S.*$/.test((lines[0] ?? '').trim())) lines.shift()
  out = lines.join('\n').trim()
  // ② 引导语。
  out = out.replace(/^(判决|裁决)如下[：:]\s*/, '')
  // ③ 模型自写的救济告知（按行剔除，避免与引擎尾部重复）。
  const kept = out.split('\n').filter((line) => {
    const t = line.trim()
    if (t === '') return true
    return !/如不服本(判决|裁决)|本判决为终审|本裁决为终局|本裁决书即发生法律效力|可(自|在)收到本裁决书之日起十五日内/.test(t)
  })
  const cleaned = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  // 段名相同的标题若仍残留一行，兜底再去一次。
  return cleaned.replace(new RegExp(`^#{1,6}\\s*${name}\\s*$`, 'm'), '').trim()
}

/**
 * 生成完整判决书/裁决书（首部 + 三段 + 尾部）。
 * 压力测试模式（segments 为空）不产出判决书，返回空串。
 */
export async function generateJudgment(input: JudgmentInput): Promise<JudgmentResult> {
  const head = buildHead(input.playbook, input.dossier, input.session)
  const segments = segmentsFor(input.playbook, input.session.mode)
  if (segments.length === 0) {
    return { markdown: '', calls: 0, tokens: 0, foreignCitations: [] }
  }

  const body: string[] = []
  let calls = 0
  let tokens = 0
  let accumulated = head

  for (const segment of segments) {
    if (input.signal.aborted) break
    const { text, tokens: used } = await generateSegment(input, segment, accumulated)
    calls += 1
    tokens += used
    const clean = sanitizeSegment(text, segment.name)
    const block = `## ${segment.name}\n\n${clean}`
    body.push(block)
    accumulated = `${accumulated}\n\n${block}`
    if (input.onSegment !== undefined) await input.onSegment(segment.name, clean)
  }

  let markdown = [head, ...body, buildFoot(input.playbook, input.session, input.retrievalNote)].join('\n')

  // 金额回填（确定性）：把判项里的 {{FEE}} 换成 legal_calc 的受理费结果。
  // 模型若没写占位符，则由引擎追加「诉讼费用负担（测算）」段——保证判决书中的
  // 受理费数字一定有测算依据，而不是模型口算的结果。
  const fee = input.feeAmount
  if (fee !== undefined && fee !== '') {
    if (markdown.includes('{{FEE}}')) {
      // 只替换数额，单位由占位符周围的上下文提供；顺带归一可能出现的「元元」
      // （模型写成「{{FEE}}元」而回填值不含单位，正常不会重复，这里只是兜底）。
      markdown = markdown.split('{{FEE}}').join(fee)
      markdown = markdown.replace(/元\s*元/g, '元').replace(/\s+元/g, ' 元')
    } else {
      const note = `\n---\n\n**诉讼费用负担（legal_calc 测算）**：案件受理费 ${fee} 元；具体分担依判决主文处理。\n`
      const idx = markdown.lastIndexOf('\n---\n')
      markdown = idx < 0 ? `${markdown}\n${note}` : `${markdown.slice(0, idx)}${note}${markdown.slice(idx)}`
    }
  }

  const check = citationsGrounded(markdown, input.pool)
  return { markdown, calls, tokens, foreignCitations: check.foreign }
}
