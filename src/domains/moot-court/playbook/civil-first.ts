/**
 * 民事一审（普通程序）playbook。
 *
 * 程序骨架依据《民事诉讼法》一审普通程序庭审流程：
 *   开庭准备 → 法庭调查（陈述/答辩/举证质证/询问）→ 争议焦点归纳 →
 *   法庭辩论 → 最后陈述 → （法院调解，可选）→ 评议 → 宣判。
 *
 * 硬编码程序话术（clerk）只承担程序性内容：核对当事人、宣布纪律、告知权利、
 * 宣布进入各阶段。实体发言全部进模型。
 */
import type { ProcedurePlaybook } from './types.ts'

export const civilFirstPlaybook: ProcedurePlaybook = {
  procedure: 'civil_first',
  title: '民事一审（普通程序）',
  defaultTribunal: 'collegial',
  tribunals: ['collegial', 'single'],
  judgmentTitle: '民事判决书',
  judgeLabel: '审判长',
  selfLabel: '原告',
  opponentLabel: '被告',
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
          procedureText: '现在宣布法庭纪律：到庭人员应当服从法庭指挥，遵守法庭规则，不得喧哗、吵闹；未经法庭许可，不得录音、录像、摄影；不得随意走动和进入审判区。全体起立，请审判长、审判员入庭。',
        },
        {
          actor: 'clerk',
          roleLabel: '书记员',
          kind: 'procedure',
          procedureText: '报告审判长，当事人及其诉讼代理人已到庭，法庭准备工作就绪，可以开庭。',
        },
        {
          actor: 'judge',
          roleLabel: '审判长',
          kind: 'procedure',
          procedureText: '现在核对当事人身份。原告及其委托诉讼代理人、被告及其委托诉讼代理人是否到庭？请各方报告基本情况。（核对当事人身份、告知当事人诉讼权利义务、询问是否申请回避）',
        },
        {
          actor: 'judge',
          roleLabel: '审判长',
          kind: 'speech',
          instruction:
            '你作为审理本案的审判长，宣布开庭并主持开庭准备。依次：①宣布本案案由与开庭依据；' +
            '②告知合议庭组成人员与书记员姓名，告知当事人诉讼权利义务（申请回避、举证、辩论、最后陈述等）；' +
            '③询问各方是否申请回避。语言规范、条理清晰，200 字以内。不要在此阶段讨论实体问题。',
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
          procedureText: '现在进行法庭调查。首先由原告陈述诉讼请求及所依据的事实和理由。',
        },
        {
          actor: 'self',
          roleLabel: '原告及其委托诉讼代理人',
          kind: 'speech',
          instruction:
            '你是我方（原告）的委托诉讼代理人。现在进行法庭调查第一项：宣读并陈述诉讼请求、' +
            '所依据的事实与理由。要求：直接围绕已提交的诉状与证据，逐项列明诉讼请求，' +
            '事实陈述按时间顺序、只讲能落到证据上的事实，不夸大、不作情绪化表达。' +
            '不要预先辩论法律适用（留待辩论阶段）。400 字以内。',
        },
        {
          actor: 'opponent',
          roleLabel: '被告及其委托诉讼代理人',
          kind: 'speech',
          needsRetrieval: true,
          instruction:
            '你是被告方委托诉讼代理人，立场是与原告对抗。现在针对原告的起诉进行答辩。' +
            '要求：①逐项指出对哪些诉讼请求予以认可、哪些予以否认；②提出自己的抗辩事由' +
            '（权利障碍、债务消灭、时效、责任限制、程序抗辩等）；③凡能对应到检索到的类案或法条的，' +
            '明确引用。这是你第一次发言，必须展现出真实对抗中的攻击性，不要温和化处理。500 字以内。',
          maxTokens: 1600,
        },
        {
          actor: 'judge',
          roleLabel: '审判长',
          kind: 'speech',
          instruction:
            '你作为审判长，在听取诉称与辩称后归纳本阶段法庭调查的重点。要求：' +
            '①指出哪些事实各方无争议、可以确认；②指出哪些事实存在争议、属于本阶段调查重点；' +
            '③按顺序引导举证质证。不要对实体结论表态。300 字以内。',
          maxTokens: 1000,
        },
        {
          actor: 'self',
          roleLabel: '原告及其委托诉讼代理人',
          kind: 'speech',
          instruction:
            '你是我方（原告）的委托诉讼代理人。现在进行举证：按证据目录逐组出示证据，' +
            '对每组证据说明「证据名称 + 证明对象 + 与诉讼请求的对应关系」。' +
            '按证据编号逐条陈述，不得遗漏证据目录中的任何一组；对方可能逐组质证，' +
            '所以要为每组证据给出清晰的证明逻辑。600 字以内。',
          maxTokens: 2000,
        },
        {
          actor: 'opponent',
          roleLabel: '被告及其委托诉讼代理人',
          kind: 'speech',
          needsRetrieval: true,
          instruction:
            '你是被告方委托诉讼代理人。现在对我方（原告/申请人）出示的每一组证据逐组质证。' +
            '对每组证据分别就真实性、合法性、关联性发表意见，并说明是否认可其证明目的；' +
            '指出证据形式瑕疵、来源瑕疵、证明力不足、与待证事实缺乏关联等具体问题。' +
            '逐组对应，不得笼统概括；对己方有利的类案/法条要明确引用。600 字以内。',
          maxTokens: 2000,
        },
        {
          actor: 'judge',
          roleLabel: '审判长',
          kind: 'speech',
          instruction:
            '你作为审判长，对刚才的举证质证进行阶段性归纳，并就尚不清楚的事实向各方发问。' +
            '要求：①概括各方对每组证据的争议点；②提出 2-4 个针对性的调查问题（针对事实模糊之处）；' +
            '③表明对证据采信的态度留待评议，不在本阶段作最终认定。400 字以内。',
          maxTokens: 1200,
        },
        {
          actor: 'self',
          roleLabel: '原告及其委托诉讼代理人',
          kind: 'speech',
          optional: true,
          instruction:
            '你是原告方委托诉讼代理人，回答审判长提出的调查问题，并补充说明庭前遗漏的关键事实。' +
            '只回答审判长实际问到的问题，不作无关扩张。300 字以内。',
        },
        {
          actor: 'opponent',
          roleLabel: '被告及其委托诉讼代理人',
          kind: 'speech',
          optional: true,
          instruction:
            '你是被告方委托诉讼代理人，回答审判长提出的调查问题，并补充有利于己方的事实。' +
            '只回答审判长实际问到的问题。300 字以内。',
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
          procedureText: '现在归纳本案争议焦点。',
        },
        {
          actor: 'judge',
          roleLabel: '审判长',
          kind: 'speech',
          needsRetrieval: true,
          instruction:
            '你作为审判长归纳本案争议焦点。要求：①按「权利义务关系—责任承担—数额计算」的层次' +
            '整理出 3-6 个争议焦点，每个焦点一句话表述；②每个焦点分别写明我方主张与对方主张；' +
            '③指出每个焦点对应的证据编号；④不得遗漏庭审中实际出现的争议。' +
            '最后按约定格式输出结构化争点（见系统指令中的 JSON 输出要求）。600 字以内。',
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
          procedureText: '现在进入法庭辩论。请各方围绕本案争议焦点发表辩论意见。',
        },
        {
          actor: 'self',
          roleLabel: '原告及其委托诉讼代理人',
          kind: 'speech',
          repeat: -1,
          needsRetrieval: true,
          instruction:
            '你是我方（原告）的委托诉讼代理人，现在进行法庭辩论。要求：' +
            '①围绕争议焦点逐项论述，每一个焦点都给出「法律依据 + 事实与证据 + 结论」的完整论证；' +
            '②主动回应对方在调查与质证阶段提出的抗辩，不要回避己方薄弱点，而是给出化解方案；' +
            '③引用必须来自检索到的法条与类案清单，不得凭空引用。每轮 600 字以内。',
          maxTokens: 2400,
        },
        {
          actor: 'opponent',
          roleLabel: '被告及其委托诉讼代理人',
          kind: 'speech',
          repeat: -1,
          needsRetrieval: true,
          instruction:
            '你是被告方委托诉讼代理人，现在进行法庭辩论。要求：' +
            '①针对我方（原告）刚才的辩论意见逐点反驳，指出其法律适用错误、事实认定偏差、证据不足；' +
            '②围绕争议焦点提出对己方最有利的解释路径，并引用检索到的支持性类案与法条；' +
            '③持续保持攻击性，不留情面地指出对方论证漏洞。每轮 600 字以内。',
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
          roleLabel: '原告及其委托诉讼代理人',
          kind: 'speech',
          instruction:
            '你是我方（原告）的委托诉讼代理人，作最后陈述。要求：简明扼要重申核心请求与最关键的理由，' +
            '不作新的论证扩张，200 字以内。',
        },
        {
          actor: 'opponent',
          roleLabel: '被告及其委托诉讼代理人',
          kind: 'speech',
          instruction:
            '你是被告方委托诉讼代理人，作最后陈述。要求：简明重申己方核心主张，200 字以内。',
        },
        {
          actor: 'judge',
          roleLabel: '审判长',
          kind: 'speech',
          instruction:
            '你作为审判长，询问各方是否同意调解。当事人均同意调解的可以当庭调解，' +
            '一方不同意的即不再调解。简短说明并宣布休庭。（本案为对抗性模拟，' +
            '如调解不成，直接宣布休庭、择期宣判。）300 字以内。',
          maxTokens: 1000,
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
            '你作为审判长，现在进行合议庭评议（本段不对外公开，但需要完整心证）。要求：' +
            '①逐争点给出心证结论：「对本院认为…，理由…」；②明确说明采信了哪些证据、' +
            '为何不采信对方的哪些主张；③对每个争点同时写明「对原告有利之处」与「对原告不利之处」；' +
            '④给出各争点的倾向性比例判断。必须逐一回应全部争议焦点。800 字以内。',
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
          procedureText: '现在宣判。（宣读判决书主文，告知上诉权利、上诉期限与上诉法院）',
        },
      ],
    },
  ],
  proceduralNotes: [
    '民事一审审理期限：普通程序 6 个月，经批准可延长（《民事诉讼法》第 152 条口径）。',
    '不服一审判决的上诉期为判决书送达之日起 15 日，裁定为 10 日。',
    '本模拟按普通程序开庭审理；适用简易程序、小额诉讼程序的案件流程与审限不同。',
  ],
  requiredInputs: [
    { key: 'cause', label: '案由', code: 'MISSING_CAUSE', blocking: true },
    { key: 'parties', label: '当事人', code: 'MISSING_PARTIES', blocking: true },
    { key: 'claims', label: '诉讼请求', code: 'MISSING_CLAIMS', blocking: true },
    { key: 'facts', label: '事实与理由', code: 'MISSING_FACTS', blocking: false },
    { key: 'evidence', label: '证据目录', code: 'MISSING_EVIDENCE', blocking: false },
  ],
}
