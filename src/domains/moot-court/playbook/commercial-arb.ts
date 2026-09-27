/**
 * 商事仲裁 playbook。
 *
 * 程序骨架依据《仲裁法》与国内主要仲裁机构仲裁规则（贸仲 / 北仲 / 上仲口径
 * 近似模拟）：仲裁庭组成与管辖确认 → 开庭调查（陈述、答辩、举证质证）→
 * 争议焦点 → 辩论 → 最后陈述 → 评议 → 裁决。
 *
 * 商事仲裁与诉讼的关键差异已在引擎中内置：不公开审理、一裁终局、
 * 先确认仲裁协议效力与管辖权、组庭方式（独任/三人）与规则口径可选。
 */
import type { ProcedurePlaybook } from './types.ts'

export const commercialArbPlaybook: ProcedurePlaybook = {
  procedure: 'commercial_arb',
  title: '商事仲裁（仲裁庭审）',
  defaultTribunal: 'arb_panel',
  tribunals: ['arb_panel', 'arb_solo'],
  judgmentTitle: '仲裁裁决书',
  judgeLabel: '首席仲裁员',
  selfLabel: '申请人',
  opponentLabel: '被申请人',
  rules: ['cietac', 'bac', 'shiac', 'generic'],
  phases: [
    {
      id: 'opening',
      title: '开庭准备与管辖确认',
      kind: 'opening',
      modes: ['auto', 'rehearsal'],
      turns: [
        {
          actor: 'clerk',
          roleLabel: '秘书',
          kind: 'procedure',
          procedureText: '本案不公开审理。请仲裁庭入席。报告首席仲裁员，双方当事人及其代理人已到庭，本案开庭准备工作就绪。',
        },
        {
          actor: 'judge',
          roleLabel: '首席仲裁员',
          kind: 'speech',
          instruction:
            '你是本案首席仲裁员，宣布开庭。要求：①宣布仲裁庭组成人员与秘书、说明组庭方式；' +
            '②确认本案仲裁协议/仲裁条款的效力与仲裁庭管辖权，询问双方有无管辖权异议；' +
            '③核对当事人身份与代理人权限；④告知仲裁中的权利义务（申请回避、举证、辩论等），' +
            '询问是否申请回避；⑤说明本案不公开审理、一裁终局。300 字以内。',
          maxTokens: 1200,
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
          roleLabel: '首席仲裁员',
          kind: 'procedure',
          procedureText: '现在进行仲裁庭调查。首先由申请人陈述仲裁请求及所依据的事实和理由。',
        },
        {
          actor: 'self',
          roleLabel: '申请人及其委托代理人',
          kind: 'speech',
          instruction:
            '你是我方（申请人）的委托代理人。现在陈述仲裁请求与事实理由。要求：' +
            '①逐项列明仲裁请求（如支付货款/工程款、违约金、损害赔偿、解除合同、' +
            '继续履行等），涉及金额的给出计算方式；②按合同签订、履行、违约、' +
            '催告的时间顺序陈述事实；③明确指向合同条款依据。500 字以内。',
          maxTokens: 1800,
        },
        {
          actor: 'opponent',
          roleLabel: '被申请人及其委托代理人',
          kind: 'speech',
          needsRetrieval: true,
          instruction:
            '你是被申请人方委托代理人，立场与申请人对抗。现在进行答辩。要求：' +
            '①逐项回应仲裁请求，明确认可或否认；②提出抗辩事由（合同效力、履行抗辩、' +
            '违约责任条款过高请求调整、损失因果关系、抵销、时效、不可抗力等）；' +
            '③引用检索到的支持被申请人立场的类案与法条。要有真实对抗的攻击性。500 字以内。',
          maxTokens: 1800,
        },
        {
          actor: 'judge',
          roleLabel: '首席仲裁员',
          kind: 'speech',
          instruction:
            '你作为首席仲裁员归纳调查重点。要求：①确认双方无争议的事实与合同条款；' +
            '②指出需要查明的关键事实（履行情况、违约事实、损失范围、因果关系）；' +
            '③引导举证质证顺序。300 字以内。',
          maxTokens: 1000,
        },
        {
          actor: 'self',
          roleLabel: '申请人及其委托代理人',
          kind: 'speech',
          instruction:
            '你是我方（申请人）的委托代理人，现在举证。按证据目录逐组出示证据，' +
            '每组说明证据名称、证明对象与仲裁请求的对应关系；重点出示合同、' +
            '履行凭证、往来函件与损失证明。600 字以内。',
          maxTokens: 2000,
        },
        {
          actor: 'opponent',
          roleLabel: '被申请人及其委托代理人',
          kind: 'speech',
          needsRetrieval: true,
          instruction:
            '你是被申请人方委托代理人，现在逐组质证。要求：就真实性、合法性、关联性' +
            '逐组发表意见；指出证据形式与来源瑕疵、证明力不足；出示己方有利证据。' +
            '逐组对应，不得笼统概括。600 字以内。',
          maxTokens: 2000,
        },
        {
          actor: 'judge',
          roleLabel: '首席仲裁员',
          kind: 'speech',
          instruction:
            '你作为首席仲裁员进行阶段性归纳并向双方发问。要求：概括举证质证争议点，' +
            '提出 2-4 个针对性调查问题（合同条款理解、履行节点、损失计算依据等）。400 字以内。',
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
          roleLabel: '首席仲裁员',
          kind: 'procedure',
          procedureText: '现在归纳本案争议焦点。',
        },
        {
          actor: 'judge',
          roleLabel: '首席仲裁员',
          kind: 'speech',
          needsRetrieval: true,
          instruction:
            '你作为首席仲裁员归纳争议焦点。要求：①按「合同效力与解释→履行与违约认定→' +
            '责任范围与数额」的层次整理 3-6 个焦点；②写明双方对每个焦点的主张；' +
            '③标注对应证据编号；④按约定格式输出结构化争点（见系统指令中的 JSON 输出要求）。' +
            '600 字以内。',
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
          roleLabel: '首席仲裁员',
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
            '你是我方（申请人）的委托代理人，进行辩论。要求：围绕各焦点逐项论证，' +
            '论证结构为「合同依据/法律规定 → 事实与证据 → 对方抗辩为何不能成立 → 请求」；' +
            '引用必须来自检索清单。每轮 600 字以内。',
          maxTokens: 2400,
        },
        {
          actor: 'opponent',
          roleLabel: '被申请人及其委托代理人',
          kind: 'speech',
          repeat: -1,
          needsRetrieval: true,
          instruction:
            '你是被申请人方委托代理人，进行辩论。要求：逐点反驳申请人意见，' +
            '重点攻击合同解释、违约认定、损失范围与因果关系；' +
            '对违约金过高主张调减的要给出具体依据；引用支持被申请人的类案与法条。' +
            '保持对抗性。每轮 600 字以内。',
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
          roleLabel: '首席仲裁员',
          kind: 'procedure',
          procedureText: '辩论终结。现在由双方作最后陈述。',
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
          instruction: '你是被申请人方委托代理人，作最后陈述，200 字以内。',
        },
        {
          actor: 'judge',
          roleLabel: '首席仲裁员',
          kind: 'speech',
          instruction:
            '你作为首席仲裁员，询问双方是否愿意在仲裁庭主持下和解；' +
            '和解不成的，宣布审理终结、仲裁庭将依规则作出裁决。200 字以内。',
          maxTokens: 800,
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
          roleLabel: '首席仲裁员',
          kind: 'speech',
          needsRetrieval: true,
          instruction:
            '你作为首席仲裁员组织仲裁庭评议（完整心证）。要求：①逐项仲裁请求给出' +
            '「支持/部分支持/不予支持」的结论与理由；②说明证据采信情况；' +
            '③对每个焦点分列「对申请人有利」「对申请人不利」两面；④给出倾向性比例判断；' +
            '⑤说明一裁终局的法律后果。800 字以内。',
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
          roleLabel: '首席仲裁员',
          kind: 'procedure',
          procedureText: '现在宣布裁决。（宣读裁决书主文；本裁决为终局裁决，自作出之日起发生法律效力）',
        },
      ],
    },
  ],
  proceduralNotes: [
    '商事仲裁实行一裁终局：裁决作出后，当事人就同一纠纷再申请仲裁或向法院起诉的，不予受理。',
    '仲裁不公开进行；当事人协议公开的，可以公开，但涉及国家秘密的除外。',
    '撤销裁决的救济：当事人可在收到裁决书之日起 6 个月内向仲裁委所在地中级法院申请撤销；' +
      '不予执行的情形依《民事诉讼法》相关规定。',
    '本模拟按国内仲裁机构规则口径进行；涉外仲裁、临时仲裁、紧急仲裁员程序不在模拟范围。',
  ],
  requiredInputs: [
    { key: 'cause', label: '争议类型', code: 'MISSING_CAUSE', blocking: true },
    { key: 'parties', label: '当事人', code: 'MISSING_PARTIES', blocking: true },
    { key: 'claims', label: '仲裁请求', code: 'MISSING_CLAIMS', blocking: true },
    { key: 'facts', label: '事实与理由', code: 'MISSING_FACTS', blocking: false },
    { key: 'evidence', label: '证据目录', code: 'MISSING_EVIDENCE', blocking: false },
  ],
}
