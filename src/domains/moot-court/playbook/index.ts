/**
 * playbook 注册表 + 模式裁剪。
 *
 * 三种模式的阶段取舍：
 *   • auto / rehearsal：走 playbook 的完整阶段序列；
 *   • stress（文书压力测试）：不开全庭，只跑「材料审阅 → 攻击面推演 → 争点归纳 →
 *     评议」四段轻量阶段，直接产出攻击面报告，不生成判决书。
 *
 * 程序性话术（clerk 节点）在任何模式下都进 transcript，但**不调用模型**。
 */
import type { Mode, Procedure } from '../store/types.ts'
import type { Phase, ProcedurePlaybook } from './types.ts'
import { civilFirstPlaybook } from './civil-first.ts'
import { civilSecondPlaybook } from './civil-second.ts'
import { laborArbPlaybook } from './labor-arb.ts'
import { commercialArbPlaybook } from './commercial-arb.ts'

export type { Phase, ProcedurePlaybook, Turn } from './types.ts'

/** 全部 playbook。 */
export const PLAYBOOKS: Record<Procedure, ProcedurePlaybook> = {
  civil_first: civilFirstPlaybook,
  civil_second: civilSecondPlaybook,
  labor_arb: laborArbPlaybook,
  commercial_arb: commercialArbPlaybook,
}

/** 全部程序（向导列表顺序）。 */
export const PROCEDURES: Procedure[] = ['civil_first', 'civil_second', 'labor_arb', 'commercial_arb']

/** 取一个 playbook（未知程序抛错）。 */
export function getPlaybook(procedure: Procedure): ProcedurePlaybook {
  const pb = PLAYBOOKS[procedure]
  if (pb === undefined) throw new Error(`unknown procedure: ${procedure}`)
  return pb
}

/**
 * 压力测试（stress）模式专用阶段序列——对所有程序通用。
 * 不开展法庭调查与辩论，直接：材料审阅 → 攻击面推演 → 争点归纳 → 评议。
 */
export function buildStressPhases(pb: ProcedurePlaybook): Phase[] {
  const T = pb.title
  return [
    {
      id: 'stress_review',
      title: '材料审阅',
      kind: 'investigation',
      turns: [
        {
          actor: 'judge',
          roleLabel: pb.judgeLabel,
          kind: 'procedure',
          procedureText: `（文书压力测试模式：不开庭，由${pb.judgeLabel}与${pb.opponentLabel}方代理人分别审阅全部材料。本案类型：${T}）`,
        },
        {
          actor: 'judge',
          roleLabel: pb.judgeLabel,
          kind: 'speech',
          instruction:
            `你是本案的${pb.judgeLabel}。现在只审阅书面材料（不开庭），形成初步审查意见。要求：` +
            '①逐项检查当事人主体、程序要件、请求是否明确、是否超过时效或期限；' +
            '②逐组证据检查真实性、合法性、关联性以及证明力；' +
            '③指出材料中最薄弱、最容易被攻击的三处；' +
            '④指出材料中缺失但本案审理所必需的材料。600 字以内。',
          maxTokens: 2200,
        },
      ],
    },
    {
      id: 'stress_attack',
      title: '攻击面推演',
      kind: 'attack',
      turns: [
        {
          actor: 'opponent',
          roleLabel: `${pb.opponentLabel}方委托代理人`,
          kind: 'speech',
          needsRetrieval: true,
          instruction:
            `你是${pb.opponentLabel}方的委托代理人，立场与${pb.selfLabel}方对抗。现在以最强攻击姿态` +
            '推演你会如何打这场仗。要求：①列出你对对方材料的全部攻击点，按致命程度排序；' +
            '②每个攻击点写明攻击方式（程序抗辩、主体、时效、证据瑕疵、法律适用、计算方式等）；' +
            '③指出你会申请调查取证、鉴定或要求对方补充举证的事项；' +
            '④凡能对应到检索到的类案或法条的，明确引用。700 字以内。',
          maxTokens: 2600,
        },
        {
          actor: 'judge',
          roleLabel: pb.judgeLabel,
          kind: 'speech',
          instruction:
            `你是本案的${pb.judgeLabel}。对上述攻击点逐一给出裁判者视角的判断。要求：` +
            '①对每个攻击点判断「可能成立 / 存疑 / 难以成立」，并说明理由；' +
            '②指出哪些攻击点足以改变案件走向；③不得回避对己方不利的判断。500 字以内。',
          maxTokens: 2000,
        },
      ],
    },
    {
      id: 'stress_issues',
      title: '争点归纳',
      kind: 'issues',
      produces: 'issues',
      turns: [
        {
          actor: 'judge',
          roleLabel: pb.judgeLabel,
          kind: 'speech',
          needsRetrieval: true,
          instruction:
            `你是本案的${pb.judgeLabel}，基于全部书面材料归纳争议焦点。要求：①整理 3-6 个焦点；` +
            '②每个焦点写明我方主张与对方主张；③标注对应证据编号；' +
            '④按约定格式输出结构化争点（见系统指令中的 JSON 输出要求）。600 字以内。',
          maxTokens: 2200,
        },
      ],
    },
  ]
}

/**
 * 按模式取阶段序列。
 * @param pb - 程序剧本。
 * @param mode - 模拟模式。
 */
export function phasesFor(pb: ProcedurePlaybook, mode: Mode): Phase[] {
  if (mode === 'stress') return buildStressPhases(pb)
  return pb.phases.filter((p) => p.modes === undefined || p.modes.includes(mode))
}

/** 该模式下是否产出判决书（压力测试不产出）。 */
export function producesJudgment(mode: Mode): boolean {
  return mode !== 'stress'
}
