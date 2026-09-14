/**
 * 律师小工具（calc）验证脚本 —— 断言全部计算规则与口径。
 *
 * 覆盖：诉讼费（受理费/执行费/保全费/申请费/减半/反算）、律师费（分段/计件/计时/风险代理上限）、
 * 利息（LPR 分段/固定/口径）、违约金（日万分之/LPR 上限对照）、迟延履行加倍利息、
 * 期限（次日起算/月年对应日/节假日顺延/工作日口径）、日期差、人民币大写。
 *
 * 数据全部来自公开规则（《诉讼费用交纳办法》、司发通〔2021〕87 号、法释〔2014〕8 号、
 * LPR 月度报价、国办发明电〔2024〕7 号 /〔2025〕7 号），断言值均为手工核算的确定值。
 *
 * 用法：pnpm build && node scripts/verify-calculators.mjs
 */
import {
  propertyAcceptanceFee, executionFee, preservationFee, propertyAmountFromFee, calcLitigationFee,
} from '../lib/domains/skills-tools/calc/litigation-fee.js'
import { calcLawyerFee, riskCapFee } from '../lib/domains/skills-tools/calc/lawyer-fee.js'
import { calcInterest, calcPenalty, calcDelayInterest } from '../lib/domains/skills-tools/calc/interest.js'
import { calcPeriod, calcDateDiff } from '../lib/domains/skills-tools/calc/period.js'
import { calcRmbUppercase } from '../lib/domains/skills-tools/calc/misc.js'
import { rmbUppercase, parseAmount, formatYuan } from '../lib/domains/skills-tools/calc/money.js'
import { lprOn, lprSegments, LPR_QUOTES } from '../lib/domains/skills-tools/calc/lpr.js'
import { runCalculator, CALC_TOOLS } from '../lib/domains/skills-tools/calc/registry.js'
import { registerCalcTool } from '../lib/domains/skills-tools/tool.js'

let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass += 1; console.log(`  ✅ ${name}`) }
  else { fail += 1; console.log(`  ❌ ${name} ${extra}`) }
}
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol
const val = (result, label) => result.summary.find((r) => r.label.includes(label))?.value ?? ''
const numOf = (s) => Number(String(s).replace(/[^\d.-]/g, ''))

/* ─────────── A. 诉讼费 ─────────── */
console.log('\nA. 诉讼费测算（《诉讼费用交纳办法》）')
ok('受理费 1 万以下 = 50 元', propertyAcceptanceFee(5000).total === 50)
ok('受理费 10 万 = 2300 元', propertyAcceptanceFee(100000).total === 2300)
ok('受理费 100 万 = 13800 元', propertyAcceptanceFee(1000000).total === 13800)
ok('受理费 200 万 = 22800 元', propertyAcceptanceFee(2000000).total === 22800)
ok('受理费 500 万 = 46800 元', propertyAcceptanceFee(5000000).total === 46800)
ok('受理费 1000 万 = 81800 元', propertyAcceptanceFee(10000000).total === 81800)
ok('受理费 2000 万 = 141800 元', propertyAcceptanceFee(20000000).total === 141800)
ok('执行费 50 万 = 7400 元', executionFee(500000).total === 7400)
ok('保全费 10 万 = 1020 元', preservationFee(100000).total === 1020)
ok('保全费 100 万封顶 5000 元', preservationFee(1000000).total === 5000 && preservationFee(1000000).capped)
ok('反算：受理费 2300 → 标的额 10 万', propertyAmountFromFee(2300) === 100000)
ok('反算：受理费 50 → 1 万', propertyAmountFromFee(50) === 10000)
ok('反算：低于 50 元返回 null', propertyAmountFromFee(20) === null)

{
  const simplified = calcLitigationFee({ mode: 'acceptance', caseType: '财产案件', amount: 1000000, procedure: '简易程序' })
  ok('简易程序减半：13800 → 6900', numOf(val(simplified, '案件受理费')) === 6900)
  const settled = calcLitigationFee({ mode: 'acceptance', caseType: '财产案件', amount: 1000000, closing: '调解' })
  ok('调解结案减半：13800 → 6900', numOf(val(settled, '案件受理费')) === 6900)
  const both = calcLitigationFee({ mode: 'acceptance', caseType: '财产案件', amount: 1000000, procedure: '简易程序', closing: '撤诉' })
  ok('简易+撤诉不重复减半（仍 6900）', numOf(val(both, '案件受理费')) === 6900)
  const labor = calcLitigationFee({ mode: 'acceptance', caseType: '劳动争议' })
  ok('劳动争议每件 10 元', numOf(val(labor, '案件受理费')) === 10)
  const divorce = calcLitigationFee({ mode: 'acceptance', caseType: '离婚', amount: 500000 })
  ok('离婚：300 + (50万-20万)×0.5% = 1800', numOf(val(divorce, '案件受理费')) === 1800)
  const personality = calcLitigationFee({ mode: 'acceptance', caseType: '人格权', amount: 200000 })
  ok('人格权：500 + 5万×1% + 10万×0.5% = 1500', numOf(val(personality, '案件受理费')) === 1500)
  const ip = calcLitigationFee({ mode: 'acceptance', caseType: '知识产权', amount: 0, ipHasAmount: false })
  ok('知产无争议金额 = 1000 元', numOf(val(ip, '案件受理费')) === 1000)
  const exec = calcLitigationFee({ mode: 'execution', amount: 1000000 })
  ok('执行费 100 万 = 50 + 49万×1.5% + 50万×1% = 12400', numOf(val(exec, '执行申请费')) === 12400)
  const pres = calcLitigationFee({ mode: 'preservation', amount: 200000 })
  ok('保全费 20 万 = 30 + 9.9万×1% + 10万×0.5% = 1520', numOf(val(pres, '保全申请费')) === 1520)
  const order = calcLitigationFee({ mode: 'other', otherType: '支付令', amount: 1000000 })
  ok('支付令 = 受理费 1/3 = 4600', numOf(val(order, '支付令申请费')) === 4600)
  const bankrupt = calcLitigationFee({ mode: 'other', otherType: '破产', amount: 10000000 })
  ok('破产 1000 万 = 受理费减半 40900', numOf(val(bankrupt, '破产案件申请费')) === 40900)
  const bankruptCap = calcLitigationFee({ mode: 'other', otherType: '破产', amount: 200000000 })
  ok('破产封顶 30 万', numOf(val(bankruptCap, '破产案件申请费')) === 300000)
  const inverse = calcLitigationFee({ mode: 'acceptance', inverse: true, targetFee: 13800 })
  ok('反算受理费 13800 → 标的额 100 万', numOf(val(inverse, '对应标的额')) === 1000000)
}

/* ─────────── B. 律师费 ─────────── */
console.log('\nB. 律师费测算（司法部/发改委规范 + 市场参考）')
ok('风险代理上限 88 万 = 158400（18%）', riskCapFee(880000).total === 158400)
ok('风险代理上限 188 万 = 312000（18% + 15%）', riskCapFee(1880000).total === 312000)
ok('风险代理上限 588 万 = 885600（18/15/12%）', riskCapFee(5880000).total === 885600)
{
  const progressive = calcLawyerFee({ mode: 'progressive', preset: 'market', amount: 1000000 })
  ok('市场参考 100 万下限 = 5000 + 8% + 9×6% = 67000', val(progressive, '律师费参考区间').includes('67,000'))
  ok('市场参考 100 万上限 = 20000 + 12% + 9×9% = 113000', val(progressive, '律师费参考区间').includes('113,000'))
  const shandong = calcLawyerFee({ mode: 'progressive', preset: 'shandong-2017', amount: 1000000 })
  ok('山东 2017 参考区间（1000~2000 基础 + 5~6% + 4~5%）', val(shandong, '律师费参考区间').includes('41,500') && val(shandong, '律师费参考区间').includes('52,400'))
  const flat = calcLawyerFee({ mode: 'flat', preset: 'market' })
  ok('计件区间 5000~30000', val(flat, '计件收费参考区间').includes('5,000') && val(flat, '计件收费参考区间').includes('30,000'))
  const hourly = calcLawyerFee({ mode: 'hourly', hours: 20, hourlyRate: 1000 })
  ok('计时：20h × 1000 = 20000', numOf(val(hourly, '计时收费合计')) === 20000)
  const risk = calcLawyerFee({ mode: 'risk', amount: 1880000, ratio: 18 })
  ok('风险代理 188 万上限 312000', numOf(val(risk, '风险代理收费上限')) === 312000)
  ok('风险代理超限提示', risk.notes.some((n) => n.includes('禁止风险代理')) && risk.summary.some((r) => r.hint === '超过法定上限部分不受支持'))
}

/* ─────────── C. LPR 与利息 ─────────── */
console.log('\nC. LPR 与利息测算')
ok('LPR 表最后一期 2026-08-20 = 3.0% / 3.5%', LPR_QUOTES[LPR_QUOTES.length - 1][0] === '2026-08-20' && LPR_QUOTES[LPR_QUOTES.length - 1][1] === 3.0)
ok('2026-09-01 一年期 LPR = 3.0%', lprOn('2026-09-01', '1y') === 3.0)
ok('2024-03-01 一年期 LPR = 3.45%', lprOn('2024-03-01', '1y') === 3.45)
ok('2019-01-01（无 LPR）取贷款基准利率 4.35%', lprOn('2019-01-01', '1y') === 4.35)
ok('2020-05-01 五年期以上 LPR = 4.65%', lprOn('2020-05-01', '5y') === 4.65)
{
  const segments = lprSegments('2024-01-01', '2025-01-01', '1y')
  const days = segments.reduce((sum, s) => sum + (Date.parse(s.to) - Date.parse(s.from)) / 86400000, 0)
  ok('LPR 分段天数合计 = 366（2024 闰年）', days === 366, `实际 ${days}`)
  ok('分段切点落在报价日（首段 2024-01-22）', segments[0].to === '2024-01-22' && segments[0].rate === 3.45)
}
{
  const fixed = calcInterest({ principal: 1000000, start: '2024-01-01', end: '2025-01-01', rateMode: 'fixed', fixedRate: 3.65, basis: '365' })
  ok('固定利率 3.65% × 366 天 = 36600', near(numOf(val(fixed, '利息合计')), 36600, 1))
  const lpr = calcInterest({ principal: 1000000, start: '2026-01-01', end: '2026-04-11', rateMode: 'lpr', term: '1y', basis: '365' })
  ok('LPR 利息（2026 全部 3.0%）：100 天 ≈ 8219.18', near(numOf(val(lpr, '利息合计')), 1000000 * 0.03 / 365 * 100, 1))
  ok('LPR 计息天数 = 100', val(lpr, '计息天数').startsWith('100'))
  const includeEnd = calcInterest({ principal: 1000000, start: '2026-01-01', end: '2026-04-11', rateMode: 'lpr', convention: 'include-end' })
  ok('算头算尾天数 = 101', val(includeEnd, '计息天数').startsWith('101'))
  const basis360 = calcInterest({ principal: 1000000, start: '2026-01-01', end: '2026-04-11', rateMode: 'fixed', fixedRate: 3, basis: '360' })
  ok('360 口径利息更大（×365/360）', numOf(val(basis360, '利息合计')) > numOf(val(lpr, '利息合计')))
}

/* ─────────── D. 违约金与迟延履行利息 ─────────── */
console.log('\nD. 违约金与迟延履行加倍利息')
{
  const daily = calcPenalty({ base: 1000000, start: '2026-01-01', end: '2026-04-11', kind: 'daily', dailyRate: 5 })
  ok('日万分之五 × 100 天 × 100 万 = 50000', near(numOf(val(daily, '违约金')), 50000, 1))
  ok('对照 4 倍 LPR 提示「超过」', val(daily, '是否超过 4 倍 LPR').startsWith('超过'))
  const lprCase = calcPenalty({ base: 1000000, start: '2026-01-01', end: '2026-04-11', kind: 'lpr', multiplier: 1.5 })
  ok('1.5 倍 LPR（3.0%）× 100 天 = 12328.77', near(numOf(val(lprCase, '违约金')), 1000000 * 0.045 / 365 * 100, 1))
  ok('未超过 4 倍 LPR', val(lprCase, '是否超过 4 倍 LPR').startsWith('未超过'))
  const delay = calcDelayInterest({ debt: 1000000, start: '2026-01-01', end: '2026-04-11' })
  ok('加倍部分债务利息 100 万 × 0.0175% × 100 天 = 17500', near(numOf(val(delay, '加倍部分债务利息')), 17500, 1))
}

/* ─────────── E. 期限与日期差 ─────────── */
console.log('\nE. 期限计算与日期差（含节假日顺延）')
{
  const appeal = calcPeriod({ baseDate: '2026-09-01', count: 15, unit: 'day', startRule: 'next-day', extend: true })
  ok('送达 9/1 次日起 15 日 → 2026-09-16', val(appeal, '期间届满日').startsWith('2026-09-16'))
  ok('起算日为 2026-09-02', val(appeal, '起算日').startsWith('2026-09-02'))
  const extension = calcPeriod({ baseDate: '2026-09-18', count: 15, unit: 'day', startRule: 'next-day', extend: true })
  ok('届满日落在国庆假期 → 顺延至 2026-10-08', val(extension, '期间届满日').startsWith('2026-10-08'), val(extension, '期间届满日'))
  ok('顺延说明已给出', val(extension, '顺延说明').includes('顺延'))
  const noExtend = calcPeriod({ baseDate: '2026-09-18', count: 15, unit: 'day', startRule: 'next-day', extend: false })
  ok('关闭顺延 → 2026-10-03', val(noExtend, '期间届满日').startsWith('2026-10-03'))
  const months = calcPeriod({ baseDate: '2026-09-01', count: 6, unit: 'month', startRule: 'next-day', extend: true })
  ok('6 个月（到期月对应日）→ 2027-03-02', val(months, '期间届满日').startsWith('2027-03-02'), val(months, '期间届满日'))
  const workday = calcPeriod({ baseDate: '2026-09-11', count: 5, unit: 'day', startRule: 'next-day', workdayMode: true })
  ok('第 5 个工作日（跳过周末）→ 2026-09-18', val(workday, '期间届满日').startsWith('2026-09-18'), val(workday, '期间届满日'))
  const diff = calcDateDiff({ start: '2026-09-01', end: '2026-09-30' })
  ok('9/1 → 9/30 自然日 29 天', val(diff, '自然日天数').startsWith('29'))
  ok('工作日 21 天（含 9/20 调休上班、扣 9/25 中秋）', val(diff, '工作日天数').startsWith('21'), val(diff, '工作日天数'))
}

/* ─────────── F. 金额与调度 ─────────── */
console.log('\nF. 金额大写与工具调度')
ok('大写 1234567.89', rmbUppercase(1234567.89) === '壹佰贰拾叁万肆仟伍佰陆拾柒元捌角玖分', rmbUppercase(1234567.89))
ok('大写 1000000 → 壹佰万元整', rmbUppercase(1000000) === '壹佰万元整', rmbUppercase(1000000))
ok('大写 100000 → 壹拾万元整', rmbUppercase(100000) === '壹拾万元整', rmbUppercase(100000))
ok('大写 100.05 → 壹佰元零伍分', rmbUppercase(100.05) === '壹佰元零伍分', rmbUppercase(100.05))
ok('大写 0.5 → 零元伍角', rmbUppercase(0.5) === '零元伍角', rmbUppercase(0.5))
ok('解析「100万」= 1000000', parseAmount('100万') === 1000000)
ok('格式化 1234567.89 → 1,234,567.89', formatYuan(1234567.89) === '1,234,567.89')
{
  const rmb = calcRmbUppercase({ amount: '1234567.89' })
  ok('小工具：金额大写返回大写结果', val(rmb, '人民币大写') === '壹佰贰拾叁万肆仟伍佰陆拾柒元捌角玖分')
  ok('未知工具返回错误而非抛异常', runCalculator('nope', {}).error !== undefined)
  ok('8 个小工具全部可执行', CALC_TOOLS.length === 8 && CALC_TOOLS.every((t) => runCalculator(t.id, { amount: 100000, base: 100000, principal: 100000, debt: 100000, baseDate: '2026-09-01', start: '2026-01-01', end: '2026-03-01' }).error === undefined))
  ok('参数元数据完整（每件至少 1 个参数）', CALC_TOOLS.every((t) => t.params.length > 0 && t.name !== '' && t.basis !== ''))
}

/* ─────────── G. legal_calc agent 工具 ─────────── */
console.log('\nG. legal_calc agent 工具注册与执行')
{
  let tool = null
  const fakeCtx = { tools: { register(t) { tool = t; return () => {} } } }
  const dispose = registerCalcTool(fakeCtx)
  ok('registerCalcTool 注册了 legal_calc', tool !== null && tool.name === 'legal_calc')
  ok('工具描述含 action 清单', typeof tool?.description === 'string' && tool.description.includes('litigation-fee') && tool.description.includes('period'))
  ok('工具参数声明 action（必填）+ input', tool?.parameters?.properties?.action?.type === 'string' && Array.isArray(tool?.parameters?.required) && tool.parameters.required.includes('action') && tool?.parameters?.properties?.input !== undefined)
  ok('disposer 可调用', typeof dispose === 'function')
  const out = await tool.execute({ action: 'litigation-fee', input: { mode: 'acceptance', caseType: '财产案件', amount: 1000000 } })
  ok('execute 返回 13,800.00 结果', JSON.stringify(out).includes('13,800.00'))
  ok('execute 附带 text 摘要', typeof out.text === 'string' && out.text.includes('案件受理费') && out.text.includes('诉讼费用交纳办法'))
  const bad = await tool.execute({ action: 'nope', input: {} })
  ok('未知 action 返回 error 而非抛异常', typeof bad.error === 'string' && bad.error.includes('未知工具'))
}

console.log(`\n${fail === 0 ? '✅ 全部通过' : '❌ 存在失败'}：${pass} 通过 / ${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)