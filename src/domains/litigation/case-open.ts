/**
 * 建案起点节点：收案事件（纪年史的头）。
 *
 * 每个诉讼案子从收案开始纪年——建案即自动落一个「收案」事件
 * （kind='engagement'，date=建案日，status=done：已发生节点进时间轴、
 * 不进关键日程）。幂等：同案件已有同名事件则跳过（重复建案/补录不重复）。
 *
 * 工具层（register_case）与路由层（/api/agentlex-case/register-case）共用，
 * 保证无论入口（管家工具 / UI / HTTP）都打同一个起点。
 */

import type { ItemStore } from '../item/store/item-store.ts'

export async function ensureCaseOpenEvent(
  itemStore: ItemStore | undefined,
  caseId: string,
  opts: { name?: string; date?: string } = {},
): Promise<boolean> {
  if (itemStore === undefined) return false
  const items = await itemStore.listItems(caseId)
  if (items.some((i) => i.type !== 'task' && i.type !== 'keydate' && i.title === '收案')) return false
  await itemStore.upsertItem({
    ownerId: caseId,
    ownerType: 'litigation',
    type: 'event',
    kind: 'engagement',
    title: '收案',
    date: opts.date ?? new Date().toISOString().slice(0, 10),
    detail: opts.name === undefined ? undefined : `案件：${opts.name}`,
    status: 'done',
  })
  return true
}
