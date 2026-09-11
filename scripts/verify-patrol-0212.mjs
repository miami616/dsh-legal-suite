/**
 * 0.2.12 案件账实核对（巡检）验证。
 *
 * 覆盖：
 *  A. 每条规则命中正确 + 给出证据/期望/动作；
 *  B. **不该报的三种情形**（开发中实测踩过的误报）：
 *     - 开庭节点已过但没勾完成（读侧当历史，无后果）；
 *     - 立案中却没有案号（本来就是"等案号"）；
 *     - 分期履行的同一标签不同日期（合法）；
 *     - 任务「领取裁判文书」不算送达证据（待办不是事实）；
 *  C. 去重台账：指纹稳定、只推新出现、修好后复发能再报、已确认(mute)不再报；
 *  D. 卡片 markdown 含证据/期望/动作。
 *
 * 全程临时目录，不触碰 live 数据。
 */
import { mkdtemp, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCaseStore } from '../lib/domains/litigation/store/case-store.js'
import { createItemStore } from '../lib/domains/item/store/item-store.js'
import { createPatrolLedgerStore } from '../lib/domains/litigation/store/patrol-ledger-store.js'
import { createPeriodRuleStore } from '../lib/domains/litigation/store/period-rule-store.js'
import { runPatrol, patrolCase, PATROL_RULES, groupItemsByCase } from '../lib/domains/litigation/patrol.js'
import { patrolCardMarkdown } from '../lib/domains/push/feishu-card.js'

let failures = 0
const check = (name, cond, extra = '') => {
  const ok = Boolean(cond)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`)
  if (!ok) failures++
}
const iso = (offsetDays) => {
  const t = new Date(Date.now() + offsetDays * 86400000)
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}

const root = await mkdtemp(join(tmpdir(), 'ls-patrol-'))
const litDir = join(root, 'litigation')
const itemsDir = join(root, 'items')
await mkdir(litDir, { recursive: true })
await mkdir(itemsDir, { recursive: true })

try {
  const itemStore = createItemStore(itemsDir)
  const caseStore = createCaseStore(litDir, undefined, itemStore)
  const ledger = createPatrolLedgerStore(litDir)
  const rules = await createPeriodRuleStore(litDir).effectiveRules()

  const mk = async (patch, items = []) => {
    const rec = await caseStore.registerCase({ name: patch.name ?? '测试案', type: patch.type ?? '民商', level: patch.level ?? '一审', court: patch.court ?? '测试法院', ...patch })
    for (const it of items) {
      await itemStore.upsertItem({ ownerId: rec.caseId, ownerType: 'litigation', ...it })
    }
    return { rec, items: await itemStore.listItems(rec.caseId) }
  }

  /* ══════════ A. 规则命中 ══════════ */

  // A1 裁判文书已送达但期限未登记
  const a1 = await mk({ status: 'post_trial' }, [
    { type: 'event', title: '判决书送达', date: iso(-20), status: 'done' },
  ])
  const a1f = patrolCase(a1.rec, a1.items, rules)
  check('A1 送达但无期限 → 命中', a1f.some((f) => f.ruleId === 'period.missing_after_service'))
  const a1hit = a1f.find((f) => f.ruleId === 'period.missing_after_service')
  check('A1 证据含送达节点与推算届满日', a1hit.evidence.join('|').includes('判决书送达') && a1hit.evidence.join('|').includes('推算届满日'))
  check('A1 动作给 register_service 与 delete_keydate 两条出路', a1hit.action.includes('register_service') && a1hit.action.includes('delete_keydate'))

  // A2 期限已过但状态未推进
  const a2 = await mk({ status: 'appeal_window' }, [
    { type: 'keydate', title: '上诉期届满', date: iso(-5), status: 'pending' },
  ])
  const a2f = patrolCase(a2.rec, a2.items, rules)
  check('A2 期限已过+状态未推进 → 命中', a2f.some((f) => f.ruleId === 'period.expired_needs_progress'))
  check('A2 动作给推进建议', (a2f.find((f) => f.ruleId === 'period.expired_needs_progress')?.action ?? '').includes('update_case'))

  // A3 开庭已过但状态仍庭前准备
  const a3 = await mk({ status: 'pretrial' }, [
    { type: 'event', title: '第一次开庭', date: iso(-10), status: 'pending' },
  ])
  check('A3 开庭已过+状态未推进 → 命中', patrolCase(a3.rec, a3.items, rules).some((f) => f.ruleId === 'hearing.passed_state_not_advanced'))

  // A4 已有立案证据但状态仍立案前（用户新增的场景）
  const a4 = await mk({ status: 'filing' }, [
    { type: 'event', title: '收到开庭传票', date: iso(-3), status: 'done' },
  ])
  const a4f = patrolCase(a4.rec, a4.items, rules)
  check('A4 收到传票但状态仍立案中 → 命中', a4f.some((f) => f.ruleId === 'status.filed_but_not_advanced'))
  check('A4 证据点名传票', (a4f.find((f) => f.ruleId === 'status.filed_but_not_advanced')?.evidence.join('|') ?? '').includes('传票'))
  // 仅凭案号也构成证据
  const a4b = await mk({ status: 'intake', caseNumber: '(2026)测民初1号' })
  check('A4 仅凭案号也命中', patrolCase(a4b.rec, a4b.items, rules).some((f) => f.ruleId === 'status.filed_but_not_advanced'))

  // A5 同一期限重复登记（同标签同日期）
  const a5 = await mk({ status: 'post_trial' }, [
    { type: 'keydate', title: '上诉期届满', date: iso(3), status: 'pending' },
    { type: 'keydate', title: '上诉期届满', date: iso(3), status: 'pending' },
  ])
  const a5f = patrolCase(a5.rec, a5.items, rules).find((f) => f.ruleId === 'period.duplicate_registration')
  check('A5 同标签同日期 → 命中', a5f !== undefined)
  check('A5 动作给出要删的 id', (a5f?.action ?? '').includes('delete_keydate') && (a5f?.action ?? '').includes('kd') === false)

  // A6 已结案仍有未完成任务
  const a6 = await mk({ status: 'closed' }, [
    { type: 'task', title: '签订委托代理合同', status: 'pending' },
  ])
  check('A6 已结案+未完成任务 → 命中', patrolCase(a6.rec, a6.items, rules).some((f) => f.ruleId === 'case.closed_with_open_tasks'))

  /* ══════════ B. 不该报的（误报防线） ══════════ */

  // B1 开庭已过但没勾完成、且状态已推进 → 无后果，不报
  const b1 = await mk({ status: 'post_trial' }, [
    { type: 'event', title: '第一次开庭', date: iso(-10), status: 'pending' },
  ])
  check('B1 开庭节点未勾完成（状态已推进）不报', patrolCase(b1.rec, b1.items, rules).length === 0)

  // B2 立案中且没有案号 → 本来就是等案号，不报
  const b2 = await mk({ status: 'filing' })
  check('B2 立案中无案号不报', patrolCase(b2.rec, b2.items, rules).length === 0)

  // B3 分期履行：同标签不同日期 → 合法，不报
  const b3 = await mk({ status: 'post_trial' }, [
    { type: 'keydate', title: '判决履行期限届满', date: iso(30), status: 'pending' },
    { type: 'keydate', title: '判决履行期限届满', date: iso(200), status: 'pending' },
  ])
  check('B3 分期履行同标签不同日期不报', patrolCase(b3.rec, b3.items, rules).length === 0)

  // B4 任务「领取裁判文书」不是送达证据（待办不是事实）
  const b4 = await mk({ status: 'post_trial' }, [
    { type: 'task', title: '领取裁判文书', status: 'pending' },
  ])
  check('B4 任务「领取裁判文书」不构成送达证据', patrolCase(b4.rec, b4.items, rules).length === 0)

  // B5 跨审级：节点日期早于立案日期 → 合法，不报
  const b5 = await mk({ status: 'post_trial', level: '二审', filingDate: iso(-30) }, [
    { type: 'event', title: '一审判决', date: iso(-90), status: 'done' },
  ])
  check('B5 跨审级日期不报', patrolCase(b5.rec, b5.items, rules).length === 0)

  // B6 撤诉裁定送达不产生上诉期 → 不报
  const b6 = await mk({ status: 'closed' }, [
    { type: 'event', title: '准予撤诉裁定书送达', date: iso(-5), status: 'done' },
  ])
  check('B6 撤诉裁定不报', patrolCase(b6.rec, b6.items, rules).length === 0)

  /* ══════════ C. 去重台账 ══════════ */

  const allItems = await itemStore.listItems()
  const registry = await caseStore.readRegistry()
  const result = runPatrol(Object.values(registry.cases), groupItemsByCase(allItems), rules)
  check('C0 汇总统计一致', result.caseCount === new Set(result.findings.map((f) => f.caseId)).size && result.summary.includes('项异常'), result.summary)

  const valid = result.findings.map((f) => f.fingerprint)
  const first = await ledger.filterNew(valid, valid)
  check('C1 首轮全部为新', first.length === valid.length, String(first.length))
  await ledger.markPushed(first)
  const second = await ledger.filterNew(valid, valid)
  check('C2 第二轮不再重复推', second.length === 0, String(second.length))

  // 修好一个问题 → 指纹被清理（台账不留死键，将来复发能再报）
  await itemStore.upsertItem({ ownerId: a1.rec.caseId, type: 'keydate', title: '上诉期届满', date: iso(10), status: 'pending' })
  const afterFix = await itemStore.listItems()
  const result2 = runPatrol(Object.values((await caseStore.readRegistry()).cases), groupItemsByCase(afterFix), rules)
  const valid2 = result2.findings.map((f) => f.fingerprint)
  await ledger.filterNew(valid2, valid2)
  check('C3 修好后指纹被清理（台账不留死键）', (await ledger.read()).pushed.every((p) => valid2.includes(p.fingerprint)))
  check('C3b 修好的那条不再出现在结果里', !result2.findings.some((f) => f.caseId === a1.rec.caseId && f.ruleId === 'period.missing_after_service'))

  // 新出现的问题 → 仍会推（不能因为"推过一次"就永久静音）
  const cNew = await mk({ status: 'closed' }, [{ type: 'task', title: '新残留任务', status: 'pending' }])
  const afterNew = await itemStore.listItems()
  const result3 = runPatrol(Object.values((await caseStore.readRegistry()).cases), groupItemsByCase(afterNew), rules)
  const valid3 = result3.findings.map((f) => f.fingerprint)
  const third = await ledger.filterNew(valid3, valid3)
  check('C4 新出现的问题仍会推', third.some((f) => f.includes(cNew.rec.caseId)), String(third.length))

  // mute：确认后不再纳入
  await ledger.mute(a2.rec.caseId, 'period.expired_needs_progress', '测试确认')
  check('C5 mute 生效', await ledger.isMuted(a2.rec.caseId, 'period.expired_needs_progress') === true)
  check('C6 未确认的规则不受影响', await ledger.isMuted(a2.rec.caseId, 'period.missing_after_service') === false)
  await ledger.unmute(a2.rec.caseId, 'period.expired_needs_progress')
  check('C7 unmute 生效', await ledger.isMuted(a2.rec.caseId, 'period.expired_needs_progress') === false)

  /* ══════════ D. 卡片 ══════════ */
  const md = patrolCardMarkdown(result.findings.slice(0, 2))
  check('D1 卡片标题与严重级', md.includes('# 案件账实核对') && md.includes('⚠ 高'))
  check('D2 每条含证据/期望/动作', md.includes('期望：') && md.includes('动作：') && md.includes('- '))
  check('D3 卡片说明去处', md.includes('mute_patrol_finding'))

  /* ══════════ E. 规则集自身 ══════════ */
  check('E1 规则 id 唯一', new Set(PATROL_RULES.map((r) => r.id)).size === PATROL_RULES.length)
  check('E2 每条规则有名称与严重级', PATROL_RULES.every((r) => r.name !== '' && ['high', 'medium', 'low'].includes(r.severity)))
  check('E3 不包含立案日期类规则（用户裁定）', !PATROL_RULES.some((r) => /filing.?date|立案日期|立案日/.test(r.id + r.name)))
} catch (error) {
  failures++
  console.error('EXCEPTION', error)
} finally {
  await rm(root, { recursive: true, force: true })
}

console.log(`\n${failures === 0 ? '✅ 全部通过' : `❌ ${failures} 项失败`}`)
process.exit(failures === 0 ? 0 : 1)
