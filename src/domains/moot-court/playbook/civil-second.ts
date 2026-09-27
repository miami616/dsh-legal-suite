/**
 * 民事二审 playbook。
 *
 * 程序骨架依据《民事诉讼法》第二审程序：二审应当围绕上诉请求进行审理
 * （不告不理），故审理范围在开庭准备后由合议庭明确限定，争议焦点即上诉理由。
 * 输入必须包含一审裁判文书与上诉请求（见 requiredInputs）。
 */
import type { ProcedurePlaybook } from './types.ts'

export const civilSecondPlaybook: ProcedurePlaybook = {
  procedure: 'civil_second',
  title: '民事二审（开庭审理）',
  defaultTribunal: 'collegial',
  tribunals: ['collegial'],
  judgmentTitle: '民事判决书（二审）',
  judgeLabel: '审判长',
  selfLabel: '上诉人',
  opponentLabel: '被上诉人',
  phases: [
    {
      id: 'opening',
      title: '开庭准备',
      kind: 'opening',
      modes: ['auto', 'rehearsal'],
      turns: [
        {
          actor: 'clerk',
          roleLabel: '书记员',
          kind: 'procedure',
          procedureText: '现在宣布法庭纪律。全体起立，请审判长、审判员入庭。报告审判长，双方当事人及其诉讼代理人已到庭，法庭准备工作就绪，可以开庭。',
        },
        {
          actor: 'judge',
          roleLabel: '审判长',
          kind: 'speech',
          instruction:
            '你作为二审合议庭审判长，宣布开庭。要求：①宣布本案为二审案件、说明二审审理的对象是' +
            '一审判决认定事实与适用法律是否正确；②告知合议庭组成、告知二审当事人的诉讼权利义务；' +
            '③询问是否申请回避。200 字以内。',
          maxTokens: 800,
        },
      ],
    },
    {
      id: 'investigation',
      title: '法庭调查',
      kind: 'investigation',
      modes: ['auto', 'rehearsal'],
      turns: [
        {
          actor: 'judge',
          roleLabel: '审判长',
          kind: 'procedure',
          procedureText: '现在进行法庭调查。二审应当围绕上诉请求进行审理。首先由上诉人宣读上诉请求及理由。',
        },
        {
          actor: 'judge',
          roleLabel: '审判长',
          kind: 'procedure',
          procedureText: '（合议庭明确本案二审审理范围：仅就上诉请求所涉事实与法律问题进行审查，未上诉部分不属于本案审理范围。）',
        },
        {
          actor: 'self',
          roleLabel: '上诉人及其委托诉讼代理人',
          kind: 'speech',
          instruction:
            '你是我方（上诉人）的委托诉讼代理人。现在宣读上诉请求及理由。要求：' +
            '①逐项列明上诉请求（请求撤销/改判的具体内容）；②针对一审判决指出其认定事实错误之处、' +
            '适用法律错误之处、程序违法之处，逐条对应一审判决的具体段落或说理；' +
            '③明确提出二审应当如何处理。紧扣上诉状内容，不作超出上诉请求的主张。500 字以内。',
          maxTokens: 1800,
        },
        {
          actor: 'opponent',
          roleLabel: '被上诉人及其委托诉讼代理人',
          kind: 'speech',
          needsRetrieval: true,
          instruction:
            '你是被上诉人方委托诉讼代理人。现在进行二审答辩。要求：' +
            '①逐项回应上诉请求，主张一审判决认定事实清楚、适用法律正确、程序合法；' +
            '②针对上诉人的每一处攻击给出反驳，指出其上诉理由不能成立的具体原因；' +
            '③引用检索到的支持一审裁判思路的类案与法条。要有真实对抗的攻击性。500 字以内。',
          maxTokens: 1800,
        },
        {
          actor: 'judge',
          roleLabel: '审判长',
          kind: 'speech',
          instruction:
            '你作为二审审判长，归纳本案二审的审查重点（即上诉理由所指向的问题）。要求：' +
            '①逐条归纳上诉理由，形成审查清单；②指出哪些上诉理由有事实依据、哪些缺乏依据；' +
            '③如有二审新证据，指出需要质证的范围。300 字以内。',
          maxTokens: 1000,
        },
        {
          actor: 'self',
          roleLabel: '上诉人及其委托诉讼代理人',
          kind: 'speech',
          needsRetrieval: true,
          instruction:
            '你是我方（上诉人）的委托诉讼代理人。现在进行二审举证：出示二审新证据或以书面材料' +
            '指出一审卷宗中未被正确评价的证据。要求：逐项说明证据名称、证明对象、' +
            '为何属于二审新证据或为何一审认定不当。如无新证据，也要指出一审证据评价中的错误。' +
            '500 字以内。',
          maxTokens: 1800,
        },
        {
          actor: 'opponent',
          roleLabel: '被上诉人及其委托诉讼代理人',
          kind: 'speech',
          needsRetrieval: true,
          instruction:
            '你是被上诉人方委托诉讼代理人。现在对上诉人出示的二审证据或证据评价意见进行质证。' +
            '要求：逐项就真实性、合法性、关联性发表意见；指出是否属于二审新证据、' +
            '是否应当准许、是否足以推翻一审认定。逐项对应。500 字以内。',
          maxTokens: 1800,
        },
      ],
    },
    {
      id: 'issues',
      title: '争议焦点归纳',
      kind: 'issues',
      produces: 'issues',
      turns: [
        {
          actor: 'judge',
          roleLabel: '审判长',
          kind: 'procedure',
          procedureText: '现在归纳本案二审争议焦点。二审争议焦点即上诉请求所涉问题。',
        },
        {
          actor: 'judge',
          roleLabel: '审判长',
          kind: 'speech',
          needsRetrieval: true,
          instruction:
            '你作为二审审判长归纳争议焦点。要求：①每条上诉理由对应的争议焦点单独成项；' +
            '②每个焦点写清上诉人的主张与被上诉人的主张；③聚焦「一审认定是否错误」这一核心问题；' +
            '④按约定格式输出结构化争点（见系统指令中的 JSON 输出要求）。600 字以内。',
          maxTokens: 2200,
        },
      ],
    },
    {
      id: 'debate',
      title: '法庭辩论',
      kind: 'debate',
      turns: [
        {
          actor: 'judge',
          roleLabel: '审判长',
          kind: 'procedure',
          procedureText: '现在进入法庭辩论。请各方围绕上诉请求与争议焦点发表辩论意见。',
        },
        {
          actor: 'self',
          roleLabel: '上诉人及其委托诉讼代理人',
          kind: 'speech',
          repeat: -1,
          needsRetrieval: true,
          instruction:
            '你是我方（上诉人）的委托诉讼代理人，进行法庭辩论。要求：围绕各审查焦点逐项论证' +
            '一审判决的错误，论证结构为「一审认定的内容 → 错误所在 → 法律与类案依据 → 应当如何改判」；' +
            '对一审有利己方的认定也要明确主张维持。引用必须来自检索清单。每轮 600 字以内。',
          maxTokens: 2400,
        },
        {
          actor: 'opponent',
          roleLabel: '被上诉人及其委托诉讼代理人',
          kind: 'speech',
          repeat: -1,
          needsRetrieval: true,
          instruction:
            '你是被上诉人方委托诉讼代理人，进行法庭辩论。要求：逐点反驳上诉人的辩论意见，' +
            '强调一审判决的正确性与稳定性，引用支持维持原判的类案与法条；' +
            '攻击上诉人论证中的事实与法律漏洞。每轮 600 字以内。',
          maxTokens: 2400,
        },
      ],
    },
    {
      id: 'closing',
      title: '最后陈述',
      kind: 'closing',
      modes: ['auto', 'rehearsal'],
      turns: [
        {
          actor: 'judge',
          roleLabel: '审判长',
          kind: 'procedure',
          procedureText: '法庭辩论终结。现在由各方作最后陈述。',
        },
        {
          actor: 'self',
          roleLabel: '上诉人及其委托诉讼代理人',
          kind: 'speech',
          instruction: '你是我方（上诉人）的委托诉讼代理人，作最后陈述，200 字以内。',
        },
        {
          actor: 'opponent',
          roleLabel: '被上诉人及其委托诉讼代理人',
          kind: 'speech',
          instruction: '你是被上诉人方委托诉讼代理人，作最后陈述，200 字以内。',
        },
      ],
    },
    {
      id: 'deliberation',
      title: '评议',
      kind: 'deliberation',
      turns: [
        {
          actor: 'judge',
          roleLabel: '审判长',
          kind: 'speech',
          needsRetrieval: true,
          instruction:
            '你作为二审合议庭审判长进行评议（完整心证）。要求：逐条上诉理由给出「上诉理由能否成立」' +
            '的结论与理由；说明一审认定事实是否清楚、适用法律是否正确、程序是否合法；' +
            '对每个焦点分列「对上诉人有利」「对上诉人不利」两面；给出倾向性比例判断。800 字以内。',
          maxTokens: 3000,
        },
      ],
    },
    {
      id: 'judgment',
      title: '宣判',
      kind: 'judgment',
      produces: 'judgment',
      turns: [
        {
          actor: 'clerk',
          roleLabel: '书记员',
          kind: 'procedure',
          procedureText: '全体起立。',
        },
        {
          actor: 'judge',
          roleLabel: '审判长',
          kind: 'procedure',
          procedureText: '现在宣判。（宣读二审判决主文：维持原判、依法改判或发回重审，并告知本判决为终审判决）',
        },
      ],
    },
  ],
  proceduralNotes: [
    '民事二审审理范围以上诉请求为限，未上诉部分不予审查（不告不理）。',
    '二审审理期限：判决上诉案件 3 个月，裁定上诉案件 30 日（《民事诉讼法》第 183 条口径）。',
    '二审判决为终审判决；对二审判决不服的救济途径为申请再审或检察监督，不是上诉。',
    '本模拟按开庭审理进行；二审对事实清楚的案件可以不开庭，径行判决。',
  ],
  requiredInputs: [
    { key: 'cause', label: '案由', code: 'MISSING_CAUSE', blocking: true },
    { key: 'parties', label: '当事人', code: 'MISSING_PARTIES', blocking: true },
    { key: 'appealGrounds', label: '上诉请求与理由', code: 'MISSING_APPEAL_GROUNDS', blocking: true },
    { key: 'priorJudgment', label: '一审裁判文书', code: 'MISSING_FIRST_INSTANCE_JUDGMENT', blocking: true },
    { key: 'evidence', label: '证据目录', code: 'MISSING_EVIDENCE', blocking: false },
  ],
}
