/**
 * 日程类型（TimelineEvent.type）的标题兜底推断。
 *
 * 为什么需要：统一事项（items.json）里 kind 是可选字段。关键日期搬家、手工
 * 登记、部分工具调用都只写了 type=event 而没写 kind，服务端映射就只能落到
 * `case_event`。下游（未来日程的红色预警、今日事项的紧急标记、飞书提醒阶梯）
 * 全靠 type 判断「这是不是开庭/上诉期」，一旦落到 case_event 就永远不预警。
 *
 * 用户在 2026-10-20 直接反馈过这个后果：21 号开庭既不显示时间也不标红，19 号
 * 已过去的开庭却红着（后者是「今天」被冻结在前一天导致的两个 bug 叠加）。
 *
 * 规则与渲染层 vendor/panel-ui/renderer/hooks/useAgentLex.ts 的 inferEventType
 * 保持一致：**两处必须同步**，否则客户端与服务端对同一条日程的类型判断会打架。
 * 「送达 / 收到 ×××」优先于「开庭」——「收到开庭传票与答辩通知书」是送达事件。
 */
export type InferredEventType =
  | 'hearing'
  | 'service'
  | 'evidence_deadline'
  | 'defense_deadline'
  | 'appeal_deadline'
  | 'retrial_deadline'
  | 'limitation_expiry'
  | 'deadline'
  | 'filing_deadline'
  | 'filing'
  | 'case_event'

/** 按标题推断日程类型；认不出时返回 `case_event`。 */
export function inferEventType(title: string | undefined): InferredEventType {
  const text = (title ?? '').trim()
  if (text === '') return 'case_event'
  if (text.includes('送达') || text.startsWith('收到')) return 'service'
  // 缴费期限先于「上诉」判断：「预交上诉费期限」是交钱的日子，不是上诉期。
  if (text.includes('预交') || text.includes('缴款') || text.includes('缴费') || text.includes('交纳')) return 'deadline'
  if (text.includes('开庭') || text.includes('庭审') || text.includes('出庭')) return 'hearing'
  if (text.includes('举证')) return 'evidence_deadline'
  if (text.includes('答辩')) return 'defense_deadline'
  if (text.includes('上诉')) return 'appeal_deadline'
  if (text.includes('再审')) return 'retrial_deadline'
  if (text.includes('时效') || text.includes('审限')) return 'limitation_expiry'
  if (text.includes('立案') && text.includes('截止')) return 'filing_deadline'
  // 「届满」= 真正的期限：判决履行期限、保全期限、起诉期等。
  if (text.includes('届满')) return 'deadline'
  if (text.includes('立案') || text.includes('起诉')) return 'filing'
  return 'case_event'
}

/**
 * 日程类型决议：显式 kind 优先，其次标题推断，最后按事项 type 兜底。
 *
 * @param kind 事项自带 kind（0.2.11 起 upsert_event 落库）
 * @param title 事项标题
 * @param itemType 事项 type（event / both / task / keydate）
 */
export function resolveEventType(
  kind: string | undefined,
  title: string | undefined,
  itemType: string | undefined,
): string {
  if (kind !== undefined && kind !== '') return kind
  const inferred = inferEventType(title)
  if (inferred !== 'case_event') return inferred
  return itemType === 'both' ? 'hearing' : 'case_event'
}
