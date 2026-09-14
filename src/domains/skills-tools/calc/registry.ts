/**
 * 律师小工具 — 目录与调度（UI 表单、agent 工具共用同一份元数据与实现）。
 *
 * 纯计算：不读写磁盘、不访问网络、不落库（$DSH_HOME 无副作用）。
 */
import { calcDelayInterest, calcInterest, calcPenalty } from './interest.ts'
import { LAWYER_FEE_PRESETS, calcLawyerFee } from './lawyer-fee.ts'
import { calcLitigationFee } from './litigation-fee.ts'
import { calcRmbUppercase } from './misc.ts'
import { PERIOD_PRESETS, calcDateDiff, calcPeriod } from './period.ts'
import type { CalcParam, CalcResult, CalcToolMeta } from './types.ts'

const p = (param: CalcParam): CalcParam => param

const BASIS_LITIGATION = '《诉讼费用交纳办法》第十三条至第十八条'
const BASIS_LAWYER = '《律师服务收费管理办法》/ 司发通〔2021〕87 号 / 各省指导价（多为参考）'

/** 全部小工具（顺序即卡片顺序）。 */
export const CALC_TOOLS: CalcToolMeta[] = [
  {
    id: 'litigation-fee',
    name: '诉讼费测算',
    group: '费用测算',
    desc: '案件受理费分段累计、执行费、保全费、支付令等申请费，支持减半与反算。',
    basis: BASIS_LITIGATION,
    icon: 'scale',
    params: [
      p({
        key: 'mode', label: '测算类型', type: 'select', default: 'acceptance', display: 'segment',
        options: [
          { value: 'acceptance', label: '案件受理费' },
          { value: 'execution', label: '执行申请费' },
          { value: 'preservation', label: '保全申请费' },
          { value: 'other', label: '其他申请费' },
        ],
      }),
      p({
        key: 'caseType', label: '案件类型', type: 'select', default: '财产案件',
        showWhen: { key: 'mode', in: ['acceptance'] },
        options: [
          { value: '财产案件', label: '财产案件（按标的额分段）' },
          { value: '离婚', label: '离婚案件' },
          { value: '人格权', label: '人格权案件' },
          { value: '其他非财产', label: '其他非财产案件' },
          { value: '知识产权', label: '知识产权案件' },
          { value: '劳动争议', label: '劳动争议案件' },
          { value: '行政-商标专利海事', label: '行政 · 商标专利海事' },
          { value: '行政-其他', label: '行政 · 其他' },
        ],
      }),
      p({
        key: 'amount', label: '标的额 / 金额', type: 'amount', default: 1000000, unit: '元',
        placeholder: '可写 1000000 或 100万',
        hint: '财产案件填诉讼请求金额；执行/保全填执行或保全财产数额；支付令填债权额；破产填破产财产总额',
      }),
      p({ key: 'inverse', label: '由受理费反算标的额', type: 'boolean', default: false, showWhen: { key: 'mode', in: ['acceptance'] } }),
      p({ key: 'targetFee', label: '已知受理费', type: 'amount', default: 13800, unit: '元', showWhen: { key: 'inverse', in: ['true'] } }),
      p({ key: 'ipHasAmount', label: '知识产权案件有争议金额', type: 'boolean', default: true, showWhen: { key: 'caseType', in: ['知识产权'] } }),
      p({
        key: 'baseFee', label: '基准金额覆盖', type: 'amount', unit: '元',
        hint: '离婚 50–300 / 人格权 100–500 / 其他非财产 50–100 / 知产 500–1000 / 管辖权异议 50–100，留空取上限',
      }),
      p({
        key: 'procedure', label: '审理程序', type: 'select', default: '普通程序', display: 'segment', showWhen: { key: 'mode', in: ['acceptance'] },
        options: [{ value: '普通程序', label: '普通程序' }, { value: '简易程序', label: '简易程序（减半）' }],
      }),
      p({
        key: 'closing', label: '结案方式', type: 'select', default: '判决', display: 'segment', showWhen: { key: 'mode', in: ['acceptance'] },
        options: [{ value: '判决', label: '判决' }, { value: '调解', label: '调解（减半）' }, { value: '撤诉', label: '撤诉（减半）' }],
      }),
      p({
        key: 'otherType', label: '申请费类型', type: 'select', default: '支付令', showWhen: { key: 'mode', in: ['other'] },
        options: [
          { value: '支付令', label: '支付令（受理费 1/3）' },
          { value: '公示催告', label: '公示催告（100 元）' },
          { value: '撤销仲裁裁决', label: '撤销仲裁裁决/确认仲裁协议效力（400 元）' },
          { value: '破产', label: '破产案件（减半，封顶 30 万）' },
          { value: '管辖权异议', label: '管辖权异议（50–100 元）' },
        ],
      }),
    ],
  },
  {
    id: 'lawyer-fee',
    name: '律师费测算',
    group: '费用测算',
    desc: '按标的额分段累进区间、计件、计时，以及风险代理分段上限（18%/15%/12%/9%/6%）。',
    basis: BASIS_LAWYER,
    icon: 'handshake',
    params: [
      p({
        key: 'mode', label: '收费方式', type: 'select', default: 'progressive', display: 'segment',
        options: [
          { value: 'progressive', label: '按标的额分段累进' },
          { value: 'flat', label: '计件收费' },
          { value: 'hourly', label: '计时收费' },
          { value: 'risk', label: '风险代理上限' },
        ],
      }),
      p({
        key: 'preset', label: '计费标准', type: 'select', default: 'market',
        showWhen: { key: 'mode', in: ['progressive', 'flat'] },
        options: LAWYER_FEE_PRESETS.map((preset) => ({ value: preset.id, label: preset.name })),
      }),
      p({ key: 'amount', label: '争议标的额', type: 'amount', default: 1000000, unit: '元', showWhen: { key: 'mode', in: ['progressive', 'risk'] }, placeholder: '可写 100万' }),
      p({ key: 'feeLow', label: '计件下限', type: 'amount', unit: '元', showWhen: { key: 'mode', in: ['flat'] }, placeholder: '留空取标准下限' }),
      p({ key: 'feeHigh', label: '计件上限', type: 'amount', unit: '元', showWhen: { key: 'mode', in: ['flat'] }, placeholder: '留空取标准上限' }),
      p({ key: 'hours', label: '工作小时数', type: 'number', default: 20, unit: '小时', showWhen: { key: 'mode', in: ['hourly'] } }),
      p({ key: 'hourlyRate', label: '小时费率', type: 'number', default: 1000, unit: '元/小时', showWhen: { key: 'mode', in: ['hourly'] } }),
      p({ key: 'ratio', label: '约定风险代理比例', type: 'number', unit: '%', showWhen: { key: 'mode', in: ['risk'] }, placeholder: '如 10' }),
      p({ key: 'caseKind', label: '案件类型备注', type: 'text', showWhen: { key: 'mode', in: ['risk'] }, placeholder: '如 刑事附带民事 / 婚姻继承', hint: '用于提示是否属于禁止风险代理范围' }),
    ],
  },
  {
    id: 'interest',
    name: '利息测算（LPR）',
    group: '利息与违约金',
    desc: '按 1 年期/5 年期以上 LPR 分段计息，支持倍数、365/360 口径与起止日期间。',
    basis: '全国银行间同业拆借中心 LPR 月度报价（2019-08-20 起）',
    icon: 'percent',
    params: [
      p({ key: 'principal', label: '本金', type: 'amount', default: 1000000, unit: '元', placeholder: '可写 100万' }),
      p({ key: 'start', label: '起算日', type: 'date' }),
      p({ key: 'end', label: '截止日', type: 'date' }),
      p({
        key: 'rateMode', label: '利率方式', type: 'select', default: 'lpr', display: 'segment',
        options: [{ value: 'lpr', label: 'LPR（分段）' }, { value: 'fixed', label: '固定年利率' }],
      }),
      p({ key: 'term', label: 'LPR 品种', type: 'select', default: '1y', display: 'segment', showWhen: { key: 'rateMode', in: ['lpr'] }, options: [{ value: '1y', label: '1 年期' }, { value: '5y', label: '5 年期以上' }] }),
      p({ key: 'multiplier', label: 'LPR 倍数', type: 'number', default: 1, unit: '倍', showWhen: { key: 'rateMode', in: ['lpr'] }, hint: '如 1.5 / 4（民间借贷上限）' }),
      p({ key: 'fixedRate', label: '年利率', type: 'number', default: 3.85, unit: '%', showWhen: { key: 'rateMode', in: ['fixed'] } }),
      p({ key: 'basis', label: '日计息基数', type: 'select', default: '365', display: 'segment', options: [{ value: '365', label: '365 天/年' }, { value: '360', label: '360 天/年' }] }),
      p({ key: 'convention', label: '天数口径', type: 'select', default: 'exclude-end', display: 'segment', options: [{ value: 'exclude-end', label: '算头不算尾' }, { value: 'include-end', label: '算头算尾' }] }),
    ],
  },
  {
    id: 'penalty',
    name: '违约金测算',
    group: '利息与违约金',
    desc: '日万分之、年/月利率、LPR 倍数四种口径，并对照 4 倍 LPR 与 1.5 倍 LPR 上限。',
    basis: '民间借贷司法解释（4 倍 LPR）/ 民法典合同编通则解释第六十五条（超损失 30%）',
    icon: 'alert',
    params: [
      p({ key: 'base', label: '计收基数', type: 'amount', default: 1000000, unit: '元', placeholder: '欠付金额 / 本金' }),
      p({ key: 'start', label: '起算日', type: 'date' }),
      p({ key: 'end', label: '截止日', type: 'date' }),
      p({
        key: 'kind', label: '计费方式', type: 'select', default: 'daily', display: 'segment',
        options: [
          { value: 'daily', label: '日万分之' },
          { value: 'annual', label: '年利率' },
          { value: 'monthly', label: '月利率' },
          { value: 'lpr', label: 'LPR 倍数' },
        ],
      }),
      p({ key: 'dailyRate', label: '日万分之几', type: 'number', default: 5, unit: '万分之', showWhen: { key: 'kind', in: ['daily'] }, hint: '日万分之五填 5' }),
      p({ key: 'annualRate', label: '年利率', type: 'number', default: 12, unit: '%', showWhen: { key: 'kind', in: ['annual'] } }),
      p({ key: 'monthlyRate', label: '月利率', type: 'number', default: 1, unit: '%', showWhen: { key: 'kind', in: ['monthly'] } }),
      p({ key: 'multiplier', label: 'LPR 倍数', type: 'number', default: 1.5, unit: '倍', showWhen: { key: 'kind', in: ['lpr'] } }),
      p({ key: 'term', label: 'LPR 品种', type: 'select', default: '1y', display: 'segment', showWhen: { key: 'kind', in: ['lpr'] }, options: [{ value: '1y', label: '1 年期' }, { value: '5y', label: '5 年期以上' }] }),
      p({ key: 'contractDate', label: '合同成立日（4 倍 LPR 基准）', type: 'date', hint: '留空按起算日' }),
      p({ key: 'basis', label: '日计息基数', type: 'select', default: '365', display: 'segment', options: [{ value: '365', label: '365 天/年' }, { value: '360', label: '360 天/年' }] }),
      p({ key: 'convention', label: '天数口径', type: 'select', default: 'exclude-end', display: 'segment', options: [{ value: 'exclude-end', label: '算头不算尾' }, { value: 'include-end', label: '算头算尾' }] }),
    ],
  },
  {
    id: 'delay-interest',
    name: '迟延履行加倍利息',
    group: '利息与违约金',
    desc: '执行阶段加倍部分债务利息：未清偿金钱债务 × 日万分之一点七五 × 迟延天数。',
    basis: '法释〔2014〕8 号第一条',
    icon: 'hourglass',
    params: [
      p({ key: 'debt', label: '未清偿金钱债务', type: 'amount', default: 1000000, unit: '元', placeholder: '不含一般债务利息' }),
      p({ key: 'start', label: '起算日（履行期届满次日）', type: 'date' }),
      p({ key: 'end', label: '截止日（实际清偿日）', type: 'date' }),
      p({ key: 'dailyRate', label: '日利率', type: 'number', default: 1.75, unit: '万分之', hint: '法定为日万分之一点七五' }),
      p({ key: 'convention', label: '天数口径', type: 'select', default: 'exclude-end', display: 'segment', options: [{ value: 'exclude-end', label: '算头不算尾' }, { value: 'include-end', label: '算头算尾' }] }),
    ],
  },
  {
    id: 'period',
    name: '期限计算',
    group: '期限与日期',
    desc: '起算日 + 期间 → 届满日，支持上诉期/答辩期/执行期等预设、节假日顺延与工作日口径。',
    basis: '《民事诉讼法》第八十五条及民诉法解释；节假日依国办发明电〔2025〕7 号等',
    icon: 'clock',
    params: [
      p({
        key: 'preset', label: '法定期间预设', type: 'select', default: '',
        options: [{ value: '', label: '自定义' }, ...PERIOD_PRESETS.map((item) => ({ value: item.id, label: item.label }))],
      }),
      p({ key: 'baseDate', label: '基准日（送达日 / 收到日）', type: 'date' }),
      p({ key: 'count', label: '期间长度', type: 'number', default: 15 }),
      p({ key: 'unit', label: '单位', type: 'select', default: 'day', display: 'segment', options: [{ value: 'day', label: '日' }, { value: 'month', label: '月' }, { value: 'year', label: '年' }] }),
      p({ key: 'startRule', label: '起算方式', type: 'select', default: 'next-day', display: 'segment', options: [{ value: 'next-day', label: '次日起算（法定）' }, { value: 'same-day', label: '当日起算' }] }),
      p({ key: 'extend', label: '末日遇休假日顺延', type: 'boolean', default: true }),
      p({ key: 'workdayMode', label: '按工作日计算（内部排期口径）', type: 'boolean', default: false, showWhen: { key: 'unit', in: ['day'] } }),
    ],
  },
  {
    id: 'date-diff',
    name: '日期差计算',
    group: '期限与日期',
    desc: '两个日期之间的自然日、工作日、周数，用于期间核算与排期。',
    basis: '自然日 = 日历日；工作日扣除周末与法定节假日',
    icon: 'range',
    params: [
      p({ key: 'start', label: '起始日期', type: 'date' }),
      p({ key: 'end', label: '结束日期', type: 'date' }),
      p({ key: 'convention', label: '天数口径', type: 'select', default: 'exclude-end', display: 'segment', options: [{ value: 'exclude-end', label: '算头不算尾' }, { value: 'include-end', label: '算头算尾' }] }),
    ],
  },
  {
    id: 'rmb-uppercase',
    name: '金额大写',
    group: '文书辅助',
    desc: '人民币金额转中文大写（壹佰贰拾叁万元整），合同与诉状常用。',
    basis: '《正确填写票据和结算凭证的基本规定》大写规范',
    icon: 'text',
    params: [
      p({ key: 'amount', label: '金额', type: 'amount', default: 1234567.89, unit: '元', placeholder: '如 1234567.89 或 100万' }),
    ],
  },
]

/** 工具分组顺序。 */
export const CALC_GROUPS = ['费用测算', '利息与违约金', '期限与日期', '文书辅助']

const RUNNERS: Record<string, (input: Record<string, unknown>) => CalcResult> = {
  'litigation-fee': calcLitigationFee,
  'lawyer-fee': calcLawyerFee,
  interest: calcInterest,
  penalty: calcPenalty,
  'delay-interest': calcDelayInterest,
  period: calcPeriod,
  'date-diff': calcDateDiff,
  'rmb-uppercase': calcRmbUppercase,
}

export function findCalcTool(id: string): CalcToolMeta | undefined {
  return CALC_TOOLS.find((tool) => tool.id === id)
}

/** 执行一次测算（未知 id 返回错误结果，不抛异常）。 */
export function runCalculator(id: string, input: Record<string, unknown> = {}): CalcResult {
  const runner = RUNNERS[id]
  if (runner === undefined) {
    return { title: '小工具', summary: [], error: `未知工具：${id}（可用：${CALC_TOOLS.map((t) => t.id).join(' / ')}）` }
  }
  try {
    return runner(input)
  } catch (error) {
    return { title: findCalcTool(id)?.name ?? '小工具', summary: [], error: `测算失败：${String((error as Error)?.message ?? error)}` }
  }
}

/** 把 CalcResult 压成给模型的纯文本（agent 工具 render 用）。 */
export function renderResultText(result: CalcResult): string {
  const lines: string[] = [`【${result.title}】`]
  if (result.error !== undefined) {
    lines.push(`错误：${result.error}`)
    return lines.join('\n')
  }
  for (const row of result.summary) {
    lines.push(`${row.label}：${row.value}${row.hint === undefined ? '' : `（${row.hint}）`}`)
  }
  for (const table of result.tables ?? []) {
    if (table.caption !== undefined) lines.push(`\n${table.caption}`)
    lines.push(table.columns.join(' | '))
    for (const row of table.rows) lines.push(row.join(' | '))
  }
  if ((result.notes ?? []).length > 0) {
    lines.push('')
    for (const note of result.notes ?? []) lines.push(`· ${note}`)
  }
  return lines.join('\n')
}

export * from './types.ts'
