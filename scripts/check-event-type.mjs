#!/usr/bin/env node
/**
 * 日程类型兜底推断回归自检（0.2.26）。
 *
 * 背景：用户 2026-10-20 反馈「21 号开庭没时间也不红」。根因之一是关键日期/手工
 * 登记的事件常常没有 kind，服务端只好落到 case_event，界面于是不知道它是开庭、
 * 上诉期还是缴费期限——永远不预警。修法是在 src/shared/event-type.ts 按标题兜底
 * 推断，渲染层 vendor/panel-ui/renderer/hooks/useAgentLex.ts 用同一套规则。
 *
 * 这个脚本锁定两件事：
 *   ① 真实数据里出现过的标题都能落到正确类型（开庭 / 上诉期 / 举证期 / 履行期限 /
 *      预交诉讼费 / 送达 / 立案 …）；
 *   ② 「收到开庭传票」这类标题走送达，不被误判成开庭；
 *   ③ 显式 kind 永远优先于标题推断（工具写对了就不能被覆盖）。
 *
 * 跑法：pnpm run check:event-type（先 tsc 出 lib，再执行本脚本）
 */
import { inferEventType, resolveEventType } from '../lib/shared/event-type.js'

let failed = 0

function eq(actual, expected, label) {
  const pass = actual === expected
  if (!pass) failed += 1
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${label} → ${actual}${pass ? '' : `（期望 ${expected}）`}`)
}

console.log('— 标题推断（真实数据标题）—')
eq(inferEventType('开庭'), 'hearing', '开庭')
eq(inferEventType('出庭通知'), 'hearing', '出庭通知')
eq(inferEventType('上诉期届满'), 'appeal_deadline', '上诉期届满')
eq(inferEventType('举证期限届满'), 'evidence_deadline', '举证期限届满')
eq(inferEventType('答辩期届满'), 'defense_deadline', '答辩期届满')
eq(inferEventType('判决履行期限届满'), 'deadline', '判决履行期限届满')
eq(inferEventType('财产保全期限届满'), 'deadline', '财产保全期限届满')
eq(inferEventType('预交上诉费期限'), 'deadline', '预交上诉费期限')
eq(inferEventType('预交案件受理费￥2352期限（缴款码…）'), 'deadline', '预交案件受理费期限')
eq(inferEventType('裁判文书送达'), 'service', '裁判文书送达')
eq(inferEventType('收到张海峰、亲情沂蒙上诉状'), 'service', '收到上诉状')
eq(inferEventType('一审立案'), 'filing', '一审立案')
eq(inferEventType('收案'), 'case_event', '收案')
eq(inferEventType(''), 'case_event', '空标题')

console.log('— 易错顺序 —')
eq(inferEventType('收到开庭传票与答辩通知书'), 'service', '收到开庭传票 → 送达，不是开庭')
eq(inferEventType('开庭传票送达'), 'service', '开庭传票送达 → 送达')

console.log('— kind 优先 —')
eq(resolveEventType('hearing', '上诉期届满', 'event'), 'hearing', '显式 kind 覆盖标题推断')
eq(resolveEventType(undefined, '开庭', 'event'), 'hearing', '缺 kind 时按标题推断')
eq(resolveEventType(undefined, '双方交换证据目录', 'both'), 'hearing', 'both 且认不出时按旧行为')
eq(resolveEventType(undefined, '双方交换证据目录', 'event'), 'case_event', '认不出 → case_event')

console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项未通过`)
process.exit(failed === 0 ? 0 : 1)
