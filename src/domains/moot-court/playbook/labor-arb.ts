/**
 * 劳动仲裁 playbook。
 *
 * 程序骨架依据《劳动争议调解仲裁法》：申请与受理 → 开庭审理（仲裁庭调查、
 * 举证质证、辩论）→ **调解（必走步骤）** → 裁决。
 *
 * 与民事诉讼的两处关键差异已在引擎中内置：
 *   1. 仲裁庭在辩论后必须先行调解；调解不成的才作出裁决。
 *   2. 审限为 45 日，案情复杂需要延期的经批准可延长 15 日；部分裁决为终局裁决。
 */
import type { ProcedurePlaybook } from './types.ts'

export const laborArbPlaybook: ProcedurePlaybook = {
  procedure: 'labor_arb',
  title: '劳动仲裁（仲裁庭审）',
  defaultTribunal: 'arb_solo',
  tribunals: ['arb_solo', 'arb_panel'],
  judgmentTitle: '仲裁裁决书',
  judgeLabel: '仲裁员',
  selfLabel: '申请人',
  opponentLabel: '被申请人',
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
          procedureText: '现在宣布仲裁庭纪律。请仲裁员入席。报告仲裁员，双方当事人及其委托代理人已到庭，本案开庭准备工作就绪。',
        },
        {
          actor: 'judge',
          roleLabel: '仲裁员',
          kind: 'speech',
          instruction:
            '你是本案劳动争议仲裁庭的仲裁员（独任或首席），宣布开庭。要求：' +
            '①宣布仲裁庭组成人员与书记员、说明本案受理依据；②核对双方当事人身份与委托代理权限；' +
            '③告知当事人在仲裁中的权利与义务（申请回避、举证、辩论、申请调解等）；' +
            '④询问是否申请回避。200 字以内。',
          maxTokens: 800,
        },
      ],
    },
    {
      id: 'investigation',
      title: '仲裁庭调查',
      kind: 'investigation',
      modes: ['auto', 'rehearsal'],
      turns: [
        {
          actor: 'judge',
          roleLabel: '仲裁员',
          kind: 'procedure',
          procedureText: '现在进行仲裁庭调查。首先由申请人陈述仲裁请求及事实理由。',
        },
        {
          actor: 'self',
          roleLabel: '申请人及其委托代理人',
          kind: 'speech',
          instruction:
            '你是我方（申请人，通常为劳动者一方）的委托代理人。现在陈述仲裁请求与事实理由。' +
            '要求：①逐项列明仲裁请求（如工资差额、加班费、未签劳动合同二倍工资、经济补偿/赔偿金、' +
            '工伤保险待遇等），每一项给出具体金额与计算方式；②按时间顺序陈述入职、履行、' +
            '争议发生的经过；③明确指出劳动关系存续期间、离职时间与离职原因。500 字以内。',
          maxTokens: 1800,
        },
        {
          actor: 'opponent',
          roleLabel: '被申请人及其委托代理人',
          kind: 'speech',
          needsRetrieval: true,
          instruction:
            '你是被申请人（用人单位）方委托代理人，立场与申请人对抗。现在进行答辩。要求：' +
            '①逐项回应仲裁请求，明确认可或否认；②提出抗辩事由（劳动关系性质、时效、' +
            '工资已付、自愿离职、劳动者过错、规章制度依据、计算基数错误等）；' +
            '③引用检索到的支持用人单位立场的类案与法条。要有真实对抗的攻击性。500 字以内。',
          maxTokens: 1800,
        },
        {
          actor: 'judge',
          roleLabel: '仲裁员',
          kind: 'speech',
          instruction:
            '你作为仲裁员归纳本阶段调查重点。要求：①确认双方无争议的事实；' +
            '②指出需要重点查明的事实（劳动关系存续、工资标准、加班事实、解除原因等）；' +
            '③引导举证质证顺序。300 字以内。',
          maxTokens: 1000,
        },
        {
          actor: 'self',
          roleLabel: '申请人及其委托代理人',
          kind: 'speech',
          instruction:
            '你是我方（申请人）的委托代理人，现在举证。按证据目录逐组出示证据，' +
            '每组说明证据名称、证明对象与请求的对应关系；劳动争议案件中' +
            '注意强调由用人单位掌握的考勤、工资发放记录等证据的举证责任分配。600 字以内。',
          maxTokens: 2000,
        },
        {
          actor: 'opponent',
          roleLabel: '被申请人及其委托代理人',
          kind: 'speech',
          needsRetrieval: true,
          instruction:
            '你是被申请人（用人单位）方委托代理人，现在逐组质证。要求：就真实性、合法性、' +
            '关联性逐组发表意见；指出证据形式瑕疵与证明力问题；对己方掌握的有利证据予以出示说明。' +
            '逐组对应，不得笼统概括。600 字以内。',
          maxTokens: 2000,
        },
        {
          actor: 'judge',
          roleLabel: '仲裁员',
          kind: 'speech',
          instruction:
            '你作为仲裁员进行阶段性归纳并向双方发问。要求：概括举证质证争议点，' +
            '提出 2-4 个针对性调查问题（工资构成、加班审批、解除程序等）。400 字以内。',
          maxTokens: 1200,
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
          roleLabel: '仲裁员',
          kind: 'procedure',
          procedureText: '现在归纳本案争议焦点。',
        },
        {
          actor: 'judge',
          roleLabel: '仲裁员',
          kind: 'speech',
          needsRetrieval: true,
          instruction:
            '你作为仲裁员归纳争议焦点。要求：①按请求项目逐项整理争议焦点（每项请求对应的' +
            '事实与法律争议单独成项）；②写明双方对每个焦点的主张；③标注对应证据编号；' +
            '④按约定格式输出结构化争点（见系统指令中的 JSON 输出要求）。600 字以内。',
          maxTokens: 2200,
        },
      ],
    },
    {
      id: 'debate',
      title: '仲裁庭辩论',
      kind: 'debate',
      turns: [
        {
          actor: 'judge',
          roleLabel: '仲裁员',
          kind: 'procedure',
          procedureText: '现在进行仲裁庭辩论。请双方围绕争议焦点发表辩论意见。',
        },
        {
          actor: 'self',
          roleLabel: '申请人及其委托代理人',
          kind: 'speech',
          repeat: -1,
          needsRetrieval: true,
          instruction:
            '你是我方（申请人）的委托代理人，进行辩论。要求：围绕各项请求逐项论证，' +
            '给出「请求依据 + 事实证据 + 金额计算方式 + 结论」的完整链条；' +
            '主动回应对方关于时效、自愿离职、已支付等抗辩；引用必须来自检索清单。每轮 600 字以内。',
          maxTokens: 2400,
        },
        {
          actor: 'opponent',
          roleLabel: '被申请人及其委托代理人',
          kind: 'speech',
          repeat: -1,
          needsRetrieval: true,
          instruction:
            '你是被申请人（用人单位）方委托代理人，进行辩论。要求：逐点反驳申请人意见，' +
            '重点攻击计算基数、时效、事实认定与法律适用；引用支持用人单位的类案与法条。' +
            '保持对抗性。每轮 600 字以内。',
          maxTokens: 2400,
        },
      ],
    },
    {
      id: 'mediation',
      title: '调解',
      kind: 'mediation',
      turns: [
        {
          actor: 'judge',
          roleLabel: '仲裁员',
          kind: 'procedure',
          procedureText: '仲裁庭辩论终结。根据《劳动争议调解仲裁法》的规定，仲裁庭在作出裁决前应当先行调解。现在征询双方调解意愿。',
        },
        {
          actor: 'judge',
          roleLabel: '仲裁员',
          kind: 'speech',
          needsRetrieval: true,
          instruction:
            '你作为仲裁员主持调解。要求：①说明仲裁庭对本案的基本判断（哪一方主张更有依据）；' +
            '②给出一个具体的调解方案（含各项请求的大致金额区间与给付方式、期限）；' +
            '③分别对双方晓以利弊：调解结案可以缩短周期、避免诉讼与执行成本；' +
            '④询问双方是否接受调解方案。400 字以内。',
          maxTokens: 1200,
        },
        {
          actor: 'self',
          roleLabel: '申请人及其委托代理人',
          kind: 'speech',
          instruction:
            '你是我方（申请人）的委托代理人，表明对调解方案的态度。要求：' +
            '①明确接受、部分接受或拒绝；②如不接受，说明己方可以让步的底线与条件；' +
            '③如接受，明确给付金额、期限与违约责任。200 字以内。',
        },
        {
          actor: 'opponent',
          roleLabel: '被申请人及其委托代理人',
          kind: 'speech',
          instruction:
            '你是被申请人（用人单位）方委托代理人，表明对调解方案的态度。要求：' +
            '①明确接受、部分接受或拒绝；②说明可以接受的给付上限与分期方案；' +
            '③如拒绝，说明理由。200 字以内。',
        },
        {
          actor: 'judge',
          roleLabel: '仲裁员',
          kind: 'speech',
          instruction:
            '你作为仲裁员，根据双方刚才的态度宣布调解结果：调解成立则确认调解协议内容；' +
            '调解不成的，宣布调解终结、仲裁庭将依法作出裁决。200 字以内。',
          maxTokens: 800,
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
          roleLabel: '仲裁员',
          kind: 'procedure',
          procedureText: '现在由双方作最后陈述。',
        },
        {
          actor: 'self',
          roleLabel: '申请人及其委托代理人',
          kind: 'speech',
          instruction: '你是我方（申请人）的委托代理人，作最后陈述，200 字以内。',
        },
        {
          actor: 'opponent',
          roleLabel: '被申请人及其委托代理人',
          kind: 'speech',
          instruction: '你是被申请人（用人单位）方委托代理人，作最后陈述，200 字以内。',
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
          roleLabel: '仲裁员',
          kind: 'speech',
          needsRetrieval: true,
          instruction:
            '你作为仲裁员进行评议（完整心证）。要求：①逐项仲裁请求给出「予以支持/部分支持/' +
            '不予支持」的结论与理由；②说明采信的证据与不予采信的主张；③对每个焦点分列' +
            '「对申请人有利」「对申请人不利」两面；④给出倾向性比例判断；' +
            '⑤说明本案是否属于终局裁决情形。800 字以内。',
          maxTokens: 3000,
        },
      ],
    },
    {
      id: 'judgment',
      title: '裁决',
      kind: 'judgment',
      produces: 'judgment',
      turns: [
        {
          actor: 'judge',
          roleLabel: '仲裁员',
          kind: 'procedure',
          procedureText: '现在宣布裁决。（宣读裁决书主文，告知不服裁决的救济途径与期限）',
        },
      ],
    },
  ],
  proceduralNotes: [
    '劳动仲裁审限：应当自受理仲裁申请之日起 45 日内结束；案情复杂需要延期的，经批准可以延长 15 日。',
    '仲裁庭在作出裁决前应当先行调解；调解不成的，应当及时作出裁决。',
    '追索劳动报酬、工伤医疗费、经济补偿或赔偿金，不超过当地月最低工资标准 12 个月金额的争议，' +
      '以及因执行国家劳动标准在工作时间、休息休假、社会保险等方面发生的争议，仲裁裁决为终局裁决（用人单位不得起诉）。',
    '对非终局裁决不服的，当事人可以自收到裁决书之日起 15 日内向人民法院提起诉讼。',
  ],
  requiredInputs: [
    { key: 'cause', label: '争议类型', code: 'MISSING_CAUSE', blocking: true },
    { key: 'parties', label: '当事人', code: 'MISSING_PARTIES', blocking: true },
    { key: 'claims', label: '仲裁请求', code: 'MISSING_CLAIMS', blocking: true },
    { key: 'facts', label: '事实经过', code: 'MISSING_FACTS', blocking: false },
    { key: 'evidence', label: '证据目录', code: 'MISSING_EVIDENCE', blocking: false },
  ],
}
