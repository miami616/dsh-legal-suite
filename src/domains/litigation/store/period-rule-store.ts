/**
 * 期限规则「本地补丁表 + 提案回流」存储（0.2.12）。
 *
 * 规则表永远写不全：模型可以依法条**提案**，但不得凭提案当已生效规则用。
 * 因此把规则分成三层，本文件承载后两层的落盘：
 *   1. `PERIOD_RULES`（`src/shared/playbook/period-rules.ts`）——法条内置表，代码资产；
 *   2. `overrides`——**本地补丁表**：地方法院口径 / 律师确认过的规则，按 id 覆盖
 *      或新增内置表条目（`confidence: 'local-practice'`）；
 *   3. `proposals`——**待确认提案**：模型带 `cite` 的草案，状态 proposed → 律师
 *      `accept` 后升为补丁表条目（立即生效）或 `reject` 丢弃。
 *
 * 硬闸门：`confidence: 'proposed'` 的规则**绝不参与匹配**（见 mergePeriodRules）。
 *
 * 存储：`<dataDir>/period-rules.json`（$DSH_HOME/agentlex/litigation/），
 * 与案件档案分离——它是规则资产，不是案件数据。
 */
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { JsonFileStore, clone } from './file-store.ts'
import { nowIso } from './id.ts'
import { PERIOD_RULES, mergePeriodRules, type PeriodRule } from '../../../shared/playbook/period-rules.ts'

/** 提案（模型依法条提出、待律师确认）。 */
export interface ProposedPeriodRule {
  /** 提案 id（稳定，供 resolve 定位）。 */
  id: string
  /** 拟新增/覆盖的规则 id（= rule.id）。 */
  ruleId: string
  /** 规则草案（confidence 恒为 'proposed'，确认后才改写为 local-practice）。 */
  rule: PeriodRule
  /** 法律依据（必填——无依据的提案不予受理）。 */
  cite: string
  /** 提案理由（为什么内置表没覆盖、为什么是这个期间）。 */
  reasoning: string
  /** 由哪个案件暴露出来的（表扩容的线索）。 */
  caseId?: string
  status: 'proposed' | 'accepted' | 'rejected'
  createdAt: string
  resolvedAt?: string
  /** 处理说明（拒绝原因 / 采纳时的修正）。 */
  resolution?: string
}

/** period-rules.json 文档。 */
export interface PeriodRuleDoc {
  registryVersion: string
  lastUpdated?: string
  /** 本地补丁表：按 id 覆盖内置规则或新增本地口径规则。 */
  overrides: PeriodRule[]
  /** 提案（含已处理的，留审计）。 */
  proposals: ProposedPeriodRule[]
}

export interface PeriodRuleStore {
  read(): Promise<PeriodRuleDoc>
  /** 生效规则集合（内置 + 补丁，剔除 proposed）。 */
  effectiveRules(): Promise<PeriodRule[]>
  /** 仅内置表（用于对比「本地补丁改了什么」）。 */
  builtinRules(): PeriodRule[]
  listProposals(status?: ProposedPeriodRule['status']): Promise<ProposedPeriodRule[]>
  /** 登记一条待确认提案（幂等：同 ruleId 已有未决提案则更新）。 */
  propose(input: {
    rule: PeriodRule
    cite: string
    reasoning: string
    caseId?: string
    /** 显式提案 id（幂等重提）；缺省按 ruleId 生成。 */
    id?: string
  }): Promise<ProposedPeriodRule>
  /**
   * 处理提案。accept → 写入补丁表并**立即生效**；reject → 只改状态。
   * @param correction - 采纳时的修正（律师把草案数字/术语改对）。
   */
  resolve(proposalId: string, action: 'accept' | 'reject', opts?: { correction?: Partial<PeriodRule>; note?: string }): Promise<{ ok: boolean; notice: string; ruleId?: string }>
  /** 直接写入/覆盖补丁表条目（律师手工维护地方法院口径）。 */
  upsertOverride(rule: PeriodRule): Promise<PeriodRule>
  /** 移除补丁表条目（回到内置表口径）。 */
  removeOverride(ruleId: string): Promise<{ deleted: boolean }>
}

function docDefault(): PeriodRuleDoc {
  return { registryVersion: '1.0', overrides: [], proposals: [] }
}

/** 提案 id：同规则同起算口径只保留一条未决提案。 */
function proposalIdOf(ruleId: string): string {
  return `ppr-${ruleId}`
}

/**
 * 创建期限规则 store。
 * @param dataDir - litigation 数据目录（period-rules.json 所在）。
 * @param ctx - host ctx（变更广播，可选）。
 */
export function createPeriodRuleStore(dataDir: string, ctx?: Context): PeriodRuleStore {
  const store = new JsonFileStore<PeriodRuleDoc>(join(dataDir, 'period-rules.json'), docDefault, ctx)

  const normalize = (doc: PeriodRuleDoc): PeriodRuleDoc => ({
    registryVersion: doc.registryVersion ?? '1.0',
    lastUpdated: doc.lastUpdated,
    overrides: Array.isArray(doc.overrides) ? doc.overrides : [],
    proposals: Array.isArray(doc.proposals) ? doc.proposals : [],
  })

  return {
    async read(): Promise<PeriodRuleDoc> {
      return clone(normalize(await store.read()))
    },

    builtinRules(): PeriodRule[] {
      return clone(PERIOD_RULES)
    },

    async effectiveRules(): Promise<PeriodRule[]> {
      const doc = normalize(await store.read())
      return mergePeriodRules(doc.overrides)
    },

    async listProposals(status?: ProposedPeriodRule['status']): Promise<ProposedPeriodRule[]> {
      const doc = normalize(await store.read())
      return clone(status === undefined ? doc.proposals : doc.proposals.filter((p) => p.status === status))
    },

    async propose(input): Promise<ProposedPeriodRule> {
      const now = nowIso()
      const ruleId = String(input.rule.id ?? '')
      if (ruleId === '') throw new Error('propose_period_rule: rule.id required')
      if (String(input.cite ?? '').trim() === '') {
        throw new Error('propose_period_rule: cite required——无法律依据的提案不予受理（不得凭记忆发明期间）')
      }
      const id = input.id ?? proposalIdOf(ruleId)
      let result: ProposedPeriodRule | undefined
      await store.mutate((raw) => {
        const doc = normalize(raw)
        const next = clone(doc)
        const proposal: ProposedPeriodRule = {
          id,
          ruleId,
          // 草案恒为 proposed：确认前绝不生效。
          rule: { ...clone(input.rule), id: ruleId, confidence: 'proposed' },
          cite: String(input.cite),
          reasoning: String(input.reasoning ?? ''),
          caseId: input.caseId,
          status: 'proposed',
          createdAt: now,
        }
        const idx = next.proposals.findIndex((p) => p.id === id)
        if (idx >= 0) {
          // 同 id 重提：保留原 createdAt，刷新草案与理由（幂等重提不刷屏）。
          next.proposals[idx] = { ...proposal, createdAt: next.proposals[idx]!.createdAt }
          result = clone(next.proposals[idx]!)
        } else {
          next.proposals.push(proposal)
          result = clone(proposal)
        }
        next.lastUpdated = now
        return next
      }, 'cases', input.caseId, 'period-rule-propose')
      return result!
    },

    async resolve(proposalId, action, opts): Promise<{ ok: boolean; notice: string; ruleId?: string }> {
      const now = nowIso()
      let notice = ''
      let ruleId: string | undefined
      await store.mutate((raw) => {
        const doc = normalize(raw)
        const next = clone(doc)
        const idx = next.proposals.findIndex((p) => p.id === proposalId)
        if (idx < 0) throw new Error(`proposal not found: ${proposalId}`)
        const proposal = next.proposals[idx]!
        if (proposal.status !== 'proposed') {
          notice = `提案 ${proposalId} 已是 ${proposal.status}，无需重复处理`
          return raw
        }
        ruleId = proposal.ruleId
        if (action === 'reject') {
          next.proposals[idx] = { ...proposal, status: 'rejected', resolvedAt: now, resolution: opts?.note ?? '律师拒绝' }
          notice = `已拒绝提案 ${proposal.ruleId}（不写入规则表）`
        } else {
          // 采纳 → 升 local-practice 并写入补丁表，立即生效。
          const accepted: PeriodRule = {
            ...clone(proposal.rule),
            ...clone(opts?.correction ?? {}),
            id: proposal.ruleId,
            confidence: 'local-practice',
          }
          next.proposals[idx] = { ...proposal, status: 'accepted', resolvedAt: now, resolution: opts?.note ?? '律师确认' }
          const oIdx = next.overrides.findIndex((o) => o.id === accepted.id)
          if (oIdx >= 0) next.overrides[oIdx] = accepted
          else next.overrides.push(accepted)
          notice = `已采纳 ${accepted.id}（${accepted.term}）→ 写入本地补丁表，立即生效`
        }
        next.lastUpdated = now
        return next
      }, 'cases', undefined, 'period-rule-resolve')
      return { ok: notice !== '' && !notice.includes('无需重复处理'), notice, ruleId }
    },

    async upsertOverride(rule): Promise<PeriodRule> {
      const now = nowIso()
      const id = String(rule.id ?? '')
      if (id === '') throw new Error('upsertOverride: rule.id required')
      const stored: PeriodRule = { ...clone(rule), id, confidence: rule.confidence === 'proposed' ? 'local-practice' : rule.confidence }
      await store.mutate((raw) => {
        const doc = normalize(raw)
        const next = clone(doc)
        const idx = next.overrides.findIndex((o) => o.id === id)
        if (idx >= 0) next.overrides[idx] = stored
        else next.overrides.push(stored)
        next.lastUpdated = now
        return next
      }, 'cases', undefined, 'period-rule-override')
      return clone(stored)
    },

    async removeOverride(ruleId): Promise<{ deleted: boolean }> {
      let deleted = false
      await store.mutate((raw) => {
        const doc = normalize(raw)
        if (!doc.overrides.some((o) => o.id === ruleId)) return raw
        const next = clone(doc)
        next.overrides = next.overrides.filter((o) => o.id !== ruleId)
        next.lastUpdated = nowIso()
        deleted = true
        return next
      }, 'cases', undefined, 'period-rule-override-remove')
      return { deleted }
    },
  }
}
