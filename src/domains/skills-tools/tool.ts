/**
 * 技能与工具 — 律师小工具的 agent 工具（legal_calc）。
 *
 * 与面板「小工具」选项卡共用同一份纯计算引擎（calc/），因此：
 *   • 会话里可以直接算（模型调用 legal_calc），结果与面板完全一致；
 *   • 纯本地计算，不落库、不联网、无副作用。
 *
 * action = 小工具 id；input = 该工具的参数对象（字段见 CALC_TOOLS 元数据）。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { CALC_TOOLS, renderResultText, runCalculator } from './calc/registry.ts'

/** 各 action 的输入字段说明（供模型构造 input）。 */
const ACTION_HINTS: Record<string, string> = {
  'litigation-fee': 'mode=acceptance/execution/preservation/other；caseType、amount（标的额，支持「100万」）、procedure、closing、otherType、inverse+targetFee（反算）',
  'lawyer-fee': 'mode=progressive/flat/hourly/risk；preset=market/shandong-2017/beijing-2018、amount、hours、hourlyRate、ratio',
  interest: 'principal、start、end（YYYY-MM-DD）、rateMode=lpr/fixed、term=1y/5y、multiplier、fixedRate、basis=365/360、convention',
  penalty: 'base、start、end、kind=daily/annual/monthly/lpr、dailyRate（日万分之几）、annualRate、monthlyRate、multiplier、contractDate',
  'delay-interest': 'debt、start、end、dailyRate（默认 1.75，日万分之）',
  period: 'baseDate、count、unit=day/month/year、startRule=next-day/same-day、extend、workdayMode、preset（法定期间预设 id）',
  'date-diff': 'start、end、convention',
  'rmb-uppercase': 'amount（数字或「100万」）',
}

const DESCRIPTION = [
  '律师常用小工具测算（纯本地计算，不落库）：诉讼费（受理费/执行费/保全费/申请费，含减半与反算）、',
  '律师费（分段累进/计件/计时/风险代理 18%-6% 上限）、利息（LPR 分段）、违约金（含 4 倍 LPR 对照）、',
  '迟延履行加倍利息（日万分之一点七五）、期限计算（上诉期/答辩期等预设、节假日顺延、工作日口径）、日期差、人民币金额大写。',
  `action 取值：${CALC_TOOLS.map((tool) => `${tool.id}（${tool.name}）`).join('；')}。`,
  'input 为参数对象，金额可写数字或「100万」，日期一律 YYYY-MM-DD。',
  '结果含 summary（主结果）、tables（分段明细）、notes（依据与口径）；涉及法定期限时提示用户复核。',
].join('\n')

/** 注册 legal_calc 工具（host 平面，默认 agent 会话可见）。 */
export function registerCalcTool(ctx: Context): () => void {
  return ctx.tools.register(defineTool({
    name: 'legal_calc',
    description: DESCRIPTION,
    parameters: {
      action: {
        type: 'string',
        required: true,
        description: `测算项 id：${CALC_TOOLS.map((tool) => tool.id).join(' / ')}`,
      },
      input: {
        type: 'json',
        description: `参数对象。${CALC_TOOLS.map((tool) => `${tool.id}: ${ACTION_HINTS[tool.id] ?? ''}`).join('；')}`,
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args: { action?: string; input?: unknown }): Promise<JsonValue> {
      const action = String(args?.action ?? '').trim()
      const input = (args?.input ?? {}) as Record<string, unknown>
      const result = runCalculator(action, input)
      return { ...result, text: renderResultText(result) } as unknown as JsonValue
    },
  }))
}
