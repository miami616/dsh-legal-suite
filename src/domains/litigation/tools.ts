/**
 * Agent tool for the litigation module — the model-facing "诉讼管家" surface.
 *
 * A single `litigation` tool with an `action` union keeps the schema flat and
 * the model's job easy: read/query cases, register/update cases, manage task
 * groups/tasks/subtasks/checklists, timeline events, and deadline summaries.
 * Every mutation goes through the same stores as the HTTP routes, so the
 * browser half live-refreshes (agentlex:registry-changed) after a change.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { CaseStore } from './store/case-store.ts'
import type { TimelineStore } from './store/timeline-store.ts'
import type { ScheduleStore } from './store/schedule-store.ts'
import { STATUS_LADDERS, STAGE_TRACKS, SIDE_STAGES, defaultLevelForType, getLitigationStatus, summarizeRules } from '../../shared/playbook/litigation.ts'
import {
  applyStageExpansion,
  detectStageSuggestions,
  planStageExpansion,
} from './stage-expansion.ts'
import { applyPeriodRegistration, listRules, planPeriodRegistration, type ServiceRequest } from './period-service.ts'
import { runPatrol, groupItemsByCase } from './patrol.ts'
import { PERIOD_RULES, type PeriodRule } from '../../shared/playbook/period-rules.ts'
import { computeCaseHealth, computeRegistryHealth } from './health.ts'
import { isEventItem } from '../item/store/types.ts'

/** Stores the tool operates on (same instances as the route family). */
export interface ToolDeps {
  caseStore: CaseStore
  timelineStore: TimelineStore
  scheduleStore?: ScheduleStore
  /** 统一事项 store —— 时间轴事件/任务写统一事项（v0.1.27）。 */
  itemStore?: import('../item/store/item-store.ts').ItemStore
  /** 期限规则本地补丁表 + 提案（0.2.12）。 */
  periodRuleStore?: import('./store/period-rule-store.ts').PeriodRuleStore
  /** 账实核对台账（去重推送 + 已确认留档）。 */
  patrolLedgerStore?: import('./store/patrol-ledger-store.ts').PatrolLedgerStore
  /** Deadline engine summary (optional when unavailable). */
  deadlines?(caseId?: string, opts?: { includeOverdue?: boolean }): unknown | Promise<unknown>
  /** Apple 日历同步配置（日程建立时自动写入 Apple Calendar）。 */
  calendarSync?: { enabled: boolean; calendarName: string }
}

/** 生效规则集合（内置 + 本地补丁表）；store 缺席时退回内置表。 */
async function effectiveRulesOf(deps: ToolDeps): Promise<PeriodRule[]> {
  if (deps.periodRuleStore === undefined) return PERIOD_RULES
  return deps.periodRuleStore.effectiveRules()
}

const ACTIONS = [
  'list_cases',
  'get_case',
  'register_case',
  'update_case',
  'delete_case',
  'add_keydate',
  'toggle_keydate',
  'delete_keydate',
  'upsert_group',
  'delete_group',
  'upsert_task',
  'delete_task',
  'move_task',
  'set_task_keydate',
  'upsert_subtask',
  'delete_subtask',
  'upsert_check',
  'toggle_check',
  'upsert_event',
  'toggle_event',
  'delete_event',
  'list_events',
  'resolve_pending_expand',
  'deadlines',
  'apply_stage_template',
  'stage_suggestions',
  'case_health',
  'case_info',
  'period_rules',
  'patrol_scan',
  'mute_patrol_finding',
  'mute_period_gate',
  'propose_period_rule',
  'resolve_period_rule',
  'derive_deadline',
  'register_service',
] as const

type Action = typeof ACTIONS[number]

const LADDER_LABELS = Object.entries(STATUS_LADDERS).map(([k, v]) => `${k}: ${v.map((s) => s.id).join('/')}`).join('；')

/** 全部阶段模板 id（主轨+旁路），用于 stageId 参数描述。 */
const ALL_STAGE_IDS = [...Object.values(STAGE_TRACKS).flat(), ...SIDE_STAGES].map((s) => s.id).join('/')
/** Tool parameters (shared by both registrations). */
const PARAMETERS = {
  action: { type: 'string', required: true, description: `要执行的操作：${ACTIONS.join(' / ')}` },
  caseId: { type: 'string', description: '案件编号，如 2025-003' },
  caseNumber: { type: 'string', description: '法院案号' },
  name: { type: 'string', description: '案件名称' },
  type: { type: 'string', description: '案件类型：民商/刑事/行政/劳动争议/知识产权/执行/其他' },
  cause: { type: 'string', description: '案由，如 广告合同纠纷' },
  status: { type: 'string', description: `进度，取值须与审级 level 匹配的规范阶梯：${LADDER_LABELS}。level 未指明时按一审阶梯校验` },
  court: { type: 'string', description: '受理法院' },
  judge: { type: 'string', description: '承办法官' },
  judgePhone: { type: 'string', description: '承办法官联系电话（法官/书记员对外联系方式）' },
  level: { type: 'string', description: '审级/程序：一审/二审/再审/劳动仲裁/商事仲裁/首次执行/恢复执行/刑事。update_case 设 level 时自动追加到审级历程（instances）。转二审/再审/执行 = 切 level（任务在对应轨模板展开），不是堆任务' },
  instances: { type: 'json', description: '审级历程数组（可选，update_case 传则整体覆盖）：[{ level, status?, caseNo?, court?, plaintiff?, defendant?, result? }]，按时间先后排列。通常不传，靠 level 自动同步' },
  claimAmount: { type: 'string', description: '标的额，如 84000 或 8.4万' },
  filingDate: { type: 'string', description: '立案日期 YYYY-MM-DD' },
  ourSide: { type: 'string', description: '我方身份：plaintiff/defendant/applicant/respondent/appellant/appellee/executionApplicant/executionRespondent' },
  summary: { type: 'string', description: '案情摘要' },
  folder: { type: 'string', description: '卷宗文件夹路径' },
  parties: { type: 'json', description: '当事人明细对象：{ plaintiff?, defendant?, ourSide?, details?: [{ name, role?, roles?, address?, legalRep?, creditCode?, phone?, firm?, ourClient? }] }。role 只取规范角色（原告/被告/申请人/被申请人/上诉人/被上诉人/申请执行人/被执行人/第三人，可带序数/审级前缀如「第一被申请人」）；同一主体（同名）只登记一行、绝不重复列当事人；同一主体跨审级出现多个身份时角色放 roles 数组（如 申请人+上诉人）；我方行加 ourClient: true' },
  label: { type: 'string', description: '关键日期名称，如 开庭' },
  date: { type: 'string', description: '日期 YYYY-MM-DD' },
  keyDateId: { type: 'string', description: '关键日期 id' },
  groupId: { type: 'string', description: '任务组（阶段）id（upsert_task/upsert_subtask/delete_subtask/toggle_check/upsert_check 必填）' },
  groupName: { type: 'string', description: '任务组（阶段）名称，如 一审阶段（upsert_group 新建时必填）' },
  taskId: { type: 'string', description: '任务 id（upsert_subtask/delete_subtask/toggle_check/upsert_check 必填；upsert_task 可选——省略则新建任务并自动生成 id）' },
  taskTitle: { type: 'string', description: '任务标题（upsert_task 新建时必填）' },
  deadline: { type: 'string', description: '任务截止日期 YYYY-MM-DD' },
  time: { type: 'string', description: '任务具体时间 HH:MM（可选，如 15:10；与 deadline 分开存）' },
  priority: { type: 'string', description: '优先级：low/medium/high' },
  toGroupId: { type: 'string', description: 'move_task 目标任务组 id' },
  enabled: { type: 'boolean', description: 'set_task_keydate 是否启用任务的关键日期提醒（true=生成/解除关键日期，双向联动；任务须已有 deadline）' },
  subtaskId: { type: 'string', description: '子任务 id（upsert_subtask 可选——省略则新建子任务并自动生成 id；delete_subtask 必填）' },
  subtaskTitle: { type: 'string', description: '子任务标题（upsert_subtask 新建时必填）' },
  checklistId: { type: 'string', description: '检查项 id（upsert_check 可选——省略则新建检查项并自动生成 id；toggle_check/delete_checklist 必填）' },
  checklistText: { type: 'string', description: '检查项内容（upsert_check 新建时必填；同时传 checklistId 则更新该检查项）' },
  eventId: { type: 'string', description: '时间轴事件 id' },
  eventType: { type: 'string', description: '事件类型（开放词表，规范枚举：hearing/evidence_deadline/defense_deadline/appeal_deadline/filing_deadline/filing/engagement/close/archive/service/court_notice/arbitration/mediation/judgment/ruling/verdict/appeal/execution/case_event；个案可用任意自定义标识，如 保全听证/专家证人出庭）。不传时按 case_event 兜底；规范词表只作标签与期限归类，不拦截自由表达' },
  title: { type: 'string', description: '时间轴事件名称，如 第一次开庭' },
  detail: { type: 'string', description: '事件详情' },
  expandOnStatus: { type: 'string', description: '状态变更后的阶段任务展开策略（case 级，可随时改）：confirm（默认，改状态后挂起待展开标记，须向用户确认后再展开）/ agent（交给管家按纪律自主处理，有明确依据直接展开、模糊先确认）/ off（关闭，改状态不展开任何任务）。update_case 可传此字段设置' },
  expandAction: { type: 'string', description: 'resolve_pending_expand 的动作：expand（按挂起的阶段模板落库任务+事件）/ ignore（仅清除标记不展开）' },
  includeOverdue: { type: 'boolean', description: 'deadlines 是否包含已过期历史事项（默认 false，只返回未到期）' },
  stageId: { type: 'string', description: 'apply_stage_template 的阶段模板 id（跨轨全集：' + ALL_STAGE_IDS + '）。省略或空串 = 按案件 level/status 自动展开「当前应展开的阶段」。展开按案件 level 命中对应轨模板，按 type/我方身份自动过滤不适用的任务；模板是骨架，落地后可增删改，用 only/skip 裁剪' },
  anchorDate: { type: 'string', description: 'apply_stage_template 的锚点日期 YYYY-MM-DD（如开庭日）：模板中带提前量的任务据此推算 deadline' },
  only: { type: 'json', description: 'apply_stage_template 只展开这些任务标题的数组，如 ["提交证据","申请财产保全"]' },
  skip: { type: 'json', description: 'apply_stage_template 跳过这些任务标题的数组（本案不适用的标准动作）' },
  dryRun: { type: 'boolean', description: 'apply_stage_template 传 true 时只返回展开计划不落库（预览用）；默认 false' },
  includeClosed: { type: 'boolean', description: 'case_health 不带 caseId 扫描全部时，是否包含已结案案件（默认 false）' },
  caseInfoAction: { type: 'string', description: 'case_info 的动作：read（只读案件文件夹里的 案件信息.md/案卷信息.md，不存在不创建）/ ensure（不存在则按模板新建，存在原样返回）。读回内容后按案情补全缺失字段，用 file-write 写回' },
  /* ---- 法定期限规则表（v0.2.11）：只登记触发事由，届满日由系统派生 ---- */
  doc: { type: 'string', description: '触发文书名（register_service/derive_deadline 必填）：仲裁裁决书/判决书/裁定书/起诉状副本/仲裁申请书副本/生效法律文书…' },
  serviceDate: { type: 'string', description: '文书送达（或收到/生效）之日 YYYY-MM-DD——期间起算锚点，由管家从送达回证/裁定书载明日期读取' },
  serviceFact: { type: 'string', description: '事实类型：送达/收到/作出/生效（默认 送达）' },
  docKind: { type: 'string', description: '文书种类定性：非终局裁决/终局裁决/判决/裁定。定性本身是判断（不由系统猜）——终局裁决时劳动者 15 日起诉、用人单位 30 日申请撤裁，路径不同' },
  clientRole: { type: 'string', description: '我方实体身份：劳动者/用人单位（终局裁决的救济路径靠它区分；普通诉讼不必传）' },
  proposalId: { type: 'string', description: '提案 id（resolve_period_rule 必填，形如 ppr-<ruleId>）' },
  decision: { type: 'string', description: 'resolve_period_rule：accept（采纳→写本地补丁表立即生效）| reject（丢弃）' },
  correction: { type: 'object', additionalProperties: true, description: 'resolve_period_rule(accept) 时对草案的修正（如把期间/术语改对）' },
  note: { type: 'string', description: 'resolve_period_rule 处理说明' },
  muted: { type: 'boolean', description: 'mute_period_gate：false = 取消确认（重新纳入巡检）' },
  reason: { type: 'string', description: 'mute_period_gate / mute_patrol_finding 确认理由（备查，如「二审独立建档，上诉期由 2026-058 跟踪」）' },
  reasoning: { type: 'string', description: 'propose_period_rule 提案理由（内置表为何未覆盖）' },
  cite: { type: 'string', description: '法律依据（propose_period_rule 必填，如「劳动争议调解仲裁法 §50」；无依据的提案不予受理）' },
  ruleId: { type: 'string', description: '规则 id：propose_period_rule 用稳定语义键（如 labor_arbitration.objection_to_award）；mute_patrol_finding 用 patrol_scan 结果里的 ruleId（如 period.duplicate_registration）' },
  rule: { type: 'object', additionalProperties: true, description: 'propose_period_rule 规则草案（scope/trigger/period/start/term/cite/effective）' },
  procedure: { type: 'string', description: '程序轨：劳动仲裁/一审/二审/再审/首次执行/恢复执行/商事仲裁/刑事。register_service/derive_deadline/period_rules 可选，缺省取案件 level' },
} as const

/** Tool description — the model reads this to know when to call. */
const DESCRIPTION = [
  '案件管理工具（AgentLex 诉讼管家）。管理诉讼案件：案件登记/更新/删除、当事人、案由、法院、标的、进度、',
  '任务树（阶段→任务→子任务→检查项）、时间轴（开庭/举证/上诉等节点与提醒）、关键日期、期限汇总。',
  '当用户提到具体案件、要求登记/更新案件、安排任务、记录开庭/举证/上诉等节点、查询期限时调用。',
  'action 必填；各 action 所需字段见 parameters。列表/查询类只读，变更类会立即持久化并刷新界面。',
  '',
  '【按案件自适应选轨与裁任务（v0.3.0 核心）】',
  '案件有三条正交轴：type（民商/刑事/行政/劳动争议/知识产权/执行）、level（审级/程序：一审/二审/再审/',
  '劳动仲裁/商事仲裁/首次执行/恢复执行/刑事）、status（该 level 阶梯内的档位）。三者决定案件生命周期路径：',
  '- 建案/更新时先定 level：刑事→「刑事」；劳动争议→「劳动仲裁」；执行→「首次执行」；其余→「一审」；',
  '  有仲裁协议的民商→「商事仲裁」。user 没明说 level 时按 type 推断，不要瞎猜更不要默认塞进一审。',
  '- apply_stage_template 只按 stageId 展开；先按 level 命中该轨模板，再按案件 type/我方身份(side)',
  '  自动过滤不适用的任务（如行政起诉期限任务只出现在行政案件、答辩状任务只在我方为被告时出现）。',
  '- 展开新案件只铺当前阶段任务，不要把全流程一次性铺出来；任务模板是参考骨架，可增删改。',
  '',
  '【管家自动程序动作（不要派成律师任务）】',
  '收到法院文书/通知后的登记是管家职责，不创建「登记××」这类无交付物的任务。',
  '',
  '【法定期限：只登记触发事由，届满日由系统派生（v0.2.11，强制）】',
  '法定不变期间（起诉期/上诉期/撤销裁决申请期/答辩期/申请执行期限）**禁止自行推算日期**：',
  '一律用 register_service 登记，只给事实（收到什么文书、哪天送达），系统查规则表算届满日、',
  '取规范术语、带法律依据，并自动铺「提前量任务链」（T-10 研读 → T-7 分析 → T-5 确认 → T-3 定稿 → T-2 递交）。',
  '- 拿不准时先用 derive_deadline 只读预览（不落库）：返回候选、届满日、计算过程、依据与将落的任务；',
  '- 规则表查不到（period_rules 可看全集）→ 不要编日期：用 propose_period_rule 依法条提案并说明依据，律师 resolve_period_rule(accept) 确认后才生效；',
  '- 账实核对用 patrol_scan：列出「实际状态与登记不一致」的案件（漏登记/登记错/该推进没推进），每条带证据+期望+动作；确认无需处理的用 mute_patrol_finding；',
  '  法院在文书中指定的期间（举证期限/答辩期等以通知书载明为准）仍按文书日期直接登记。',
  '- 触发事由归一：判决书/裁定书/裁决书 → 「裁判文书送达」（status=done，进时间轴纪年）；',
  '- 标签纪律：劳动仲裁裁决之后登记「起诉期届满」（无上诉！终局裁决用人单位才走「撤销裁决申请期届满」）；',
  '  诉讼一审判决/裁定之后登记「上诉期届满」。术语错会把期限指向错误的程序——由规则表 term 兜底。',
  '内置规则（procedure·文书种类/我方身份·触发 → 期间 → 术语）：',
  '  ' + summarizeRules(),
  '法院指定期间与非规范节点仍用 add_keydate / upsert_event 手工登记；期间类事项不要建任务（任务只留提前量动作）。',
  '【期限登记纪律】（2026-09-11 用户口径，踩过坑）：',
  '  · **当事人的履行期限不登记**——判决/调解书里对方分期付款的「履行期限届满」是对方的付款义务，',
  '    不是我方要盯的期限（实测被误登记 11 条，全进了日历）。只登记影响**我方程序权利**的期限。',
  '  · 「申请执行期限届满」只在**尚未申请执行**时登记：本案 level 已是首次执行/恢复执行，',
  '    或同案已有执行案（如二审案已有对应执行案），都不再登记——已进入执行程序，该期限是废纸。',
  '',
  '【写入纪律】',
  '任务名写「动作」不写「状态」（用「出庭参加庭审」，不用「等待开庭」）；',
  '同一事项不得同时登记为任务 deadline、关键日期与时间轴事件，只登记必要的体系；',
  '新建案件时只铺当前阶段，不要一次性生成全流程任务。',
  '当事人纪律（备忘录 #5）：角色只能用规范词表（原告/被告/申请人/被申请人/上诉人/被上诉人/申请执行人/被执行人/第三人），',
  '同一主体只登记一行、不重复列当事人，跨审级多个身份用 roles 数组表达；我方行标 ourClient: true。',
  '阶段推进：apply_stage_template 按阶段模板展开标准任务（dryRun=true 先预览、only/skip 裁剪、anchorDate 推算 deadline）；',
  'stage_suggestions 只读检测「当前阶段已完成→该展开下一阶段」与缺失的登记字段；',
  'update_case 改变 status 时响应会内联返回 stageSuggestions，据此向用户提出下一步建议。',
  '案件转二审/再审/执行 = update_case 切 level（如 level=二审），instances 自动记录审级历程，',
  '任务在对应轨模板展开——「二审中」只是状态不是任务，不要在二审状态里硬塞一审的任务组。',
  'case_health 只读体检：信息完整度按当前阶段动态计算（诉前不罚缺案号），附缺口清单与阶段进度。',
  '模板里的「条件任务」（如 缴纳诉讼费/申请财产保全/分析上诉可行性/刑事取保候审）默认展开不会创建——',
  '只在触发条件出现（收到缴费通知 / 有转移财产风险 / 裁判不利需评估上诉 / 符合取保情形）时用 only 点名展开。',
  '案件文件夹记忆文件：处理具体案件前用 case_info 读 案件信息.md（没有则 ensure），有新进展同步补写，',
  '用 file-write 落盘。',
  '',
  '【事件纪年·收案到结案】',
  '每个案子从收案开始纪年，到结案/归档收尾：建案自动落「收案」事件（kind=engagement，status=done）；',
  '阶段模板展开时自动落该阶段标准程序节点事件（如 开庭/举证期限届满/答辩期届满/裁判文书送达/上诉期届满），',
  '展开时按标题幂等，已存在不重复。已发生节点用 status=done + 实际日期登记（只进时间轴、不进关键日程）；',
  '未发生节点 status=pending（进关键日程/期限汇总，倒计时）。事件类型开放：规范词表（含 engagement/close/archive）',
  '只作标签与期限归类，个案特殊节点（保全听证/专家证人出庭/追加当事人…）直接 upsert_event 任意标题即可。',
  '同一事项不得同时登记为任务 deadline、关键日期与时间轴事件，只登记必要的体系。',
  '',
  '【状态变更 → 阶段展开（三态 expandOnStatus，默认 confirm）】',
  '改状态档位（如 立案中→庭前准备）= 宣告进入下一阶段，任务树应跟着展开该阶段标准任务：',
  '- confirm：**只用于手动改状态的 UI 语义**（前端会弹确认框）；管家调 update_case 改状态时不会走 confirm，一律 agent 态，因此不会弹框；',
  '- confirm 态下 update_case 改 status 后响应里会带 pendingExpand（stageId/stageName/预览清单）——须当场向用户确认',
  '  「是否展开 X 阶段」(给出清单)，用户同意 → resolve_pending_expand(expand) 落库；用户拒绝 → resolve_pending_expand(ignore) 清除；',
  '- agent：改状态后同样读 pendingExpand（mode=agent），按管家纪律自主处理：有明确程序依据（收到开庭传票、',
  '  切审级轨等）直接 apply_stage_template 或 resolve_pending_expand(expand) 展开；情况模糊先与用户确认；',
  '- off：case 设 expandOnStatus=off 后改状态不展开任务。',
  '无论哪态，改状态后都不得留下未处理的 pendingExpand——必须 expand 或 ignore 收尾；stage_suggestions /',
  'case_health / get_case 读侧可见 pendingExpand，漏处理也能补。',
].join('\n')

/** Validate ids are non-empty strings for mutation actions. */
function requireIds(ids: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(ids)) {
    if (value === undefined || value === '') throw new Error(`${key} is required`)
  }
}

/** Strip undefined/null properties recursively so values are JSON-safe. */
type JsonVal = null | boolean | number | string | JsonVal[] | { [key: string]: JsonVal }

function clean(value: unknown): JsonVal {
  if (value === undefined || value === null) return null
  if (Array.isArray(value)) return value.map((v) => clean(v))
  if (typeof value === 'object') {
    const out: { [key: string]: JsonVal } = {}
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue
      out[key] = clean(v)
    }
    return out
  }
  return value as JsonVal
}

/**
 * 当事人入参归一化：DSH 工具框架把 `type: 'json'` 参数以 JSON 字符串传给
 * handler，原样落盘会把 parties 序列化成字符串、界面无法渲染（issue:
 * 当事人信息不显示）。字符串（合法 JSON）→ 解析为对象；解析失败保留原值。
 */
function normalizeParties(value: unknown): unknown {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return JSON.parse(trimmed) as unknown
      } catch {
        /* 非 JSON 字符串：保留原值（如手写文本备注） */
      }
    }
  }
  return value
}

/**
 * 数组类入参归一化：`type: 'json'` 的参数同样以 JSON 字符串传入，因此
 * only/skip 既可能是真数组，也可能是 `["a","b"]` 这样的字符串，还可能是
 * 单个标题。三种形态一律归一为字符串数组，避免管家按直觉传单个字符串时
 * 被静默忽略。
 */
function toStringArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return undefined
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown
        return Array.isArray(parsed) ? parsed.map(String) : undefined
      } catch {
        /* 非 JSON 数组：按单个标题处理 */
      }
    }
    return [trimmed]
  }
  return undefined
}

/**
 * Register the litigation agent tool on ctx.tools.
 * @param ctx - host context with the `tools` service injected.
 * @param deps - the stores backing the operations.
 * @returns the disposer that unregisters the tool.
 */
export function registerLitigationTool(ctx: Context, deps: ToolDeps): () => void {
  return ctx.tools.register(defineTool({
    name: 'litigation',
    description: DESCRIPTION,
    parameters: PARAMETERS,
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{
        type: 'text',
        text: JSON.stringify(value, null, 2),
      }],
    },
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const action = args.action as Action
      if (!ACTIONS.includes(action)) throw new Error(`unknown action: ${String(args.action)}`)

      const cs = deps.caseStore
      const ts = deps.timelineStore
      const s = (v: unknown): string | undefined => (v === undefined || v === null) ? undefined : String(v)

      switch (action) {
        /* ----------------------------- read ----------------------------- */
        case 'list_cases': {
          const registry = await cs.readRegistry()
          const summary = Object.values(registry.cases).map((c) => ({
            caseId: c.caseId, name: c.name, type: c.type, status: c.status,
            court: c.court, level: c.level, updatedAt: c.updatedAt,
          }))
          return clean({ count: summary.length, cases: summary })
        }
        case 'get_case': {
          requireIds({ caseId: s(args.caseId) })
          const record = await cs.readCase(args.caseId as string)
          if (record === undefined) return { error: `case not found: ${args.caseId}` }
          // 0.2.2：任务组从 items 重建（registry taskGroups 下岗）。
          if (deps.itemStore !== undefined) {
            const { hydrateCaseTaskGroups } = await import('./task-view.ts')
            return clean({ case: await hydrateCaseTaskGroups(record, cs, deps.itemStore) })
          }
          return clean({ case: record })
        }
        case 'list_events': {
          // 统一事项模型：事件 = items(event/both)。case-timeline.json 已于
          // 0.2.2 并库退役，不再合并 legacy。
          if (deps.itemStore !== undefined) {
            const itemsEvents = (await deps.itemStore.listItems(args.caseId === undefined ? undefined : String(args.caseId)))
              .filter((it) => isEventItem(it))
            const { itemToTimelineEvent } = await import('../item/shape.ts')
            const out = itemsEvents.map((it) => itemToTimelineEvent(it))
            return clean({ count: out.length, events: out })
          }
          const events = await ts.listEvents(args.caseId === undefined ? undefined : String(args.caseId))
          return clean({ count: events.length, events })
        }
        case 'deadlines': {
          if (deps.deadlines === undefined) return { error: 'deadline engine unavailable' }
          const opts = typeof args.includeOverdue === 'boolean' ? { includeOverdue: args.includeOverdue } : undefined
          return clean({ deadlines: await deps.deadlines(args.caseId === undefined ? undefined : String(args.caseId), opts) })
        }
        /* ------------------- stage templates & suggestions -------------- */
        case 'stage_suggestions': {
          const registry = await cs.readRegistry()
          // 0.2.2：任务组从 items 重建，否则展开写 items 后检测仍说没任务。
          const hydrated = deps.itemStore !== undefined
            ? (await import('./task-view.ts')).hydrateRegistryTaskGroups(registry, cs, deps.itemStore)
            : Promise.resolve(registry)
          const found = detectStageSuggestions(await hydrated, s(args.caseId))
          return clean({ count: found.length, cases: found })
        }
        case 'apply_stage_template': {
          // stageId 可空：缺省时按案件 level/status 自动展开「当前应展开的阶段」。
          requireIds({ caseId: s(args.caseId) })
          const opts = {
            anchorDate: s(args.anchorDate),
            only: toStringArray(args.only),
            skip: toStringArray(args.skip),
          }
          const caseId = args.caseId as string
          const stageId = args.stageId === undefined ? '' : String(args.stageId)
          const plan = args.dryRun === true
            ? await planStageExpansion(cs, caseId, stageId, { ...opts, dryRun: true })
            : await applyStageExpansion(cs, caseId, stageId, opts, deps.itemStore)
          return clean(plan)
        }
        case 'case_health': {
          // 体检同时看时间轴日程（0.2.11）：只登日程不登关键日期也算登记，
          // 且术语按案件 level 从规则表取（劳动仲裁 = 起诉期届满）。
          const allItems = deps.itemStore === undefined ? undefined : await deps.itemStore.listItems()
          const healthOpts = {
            deadlines: deps.deadlines === undefined
              ? undefined
              : async (id: string) => await deps.deadlines!(id),
            events: allItems,
          }
          const caseId = s(args.caseId)
          if (caseId !== undefined) {
            const record = await cs.readCase(caseId)
            if (record === undefined) return { error: `case not found: ${caseId}` }
            // 0.2.2：先重建任务组（从 items），体检才看得到展开的任务。
            const hydrated = deps.itemStore !== undefined
              ? await (await import('./task-view.ts')).hydrateCaseTaskGroups(record, cs, deps.itemStore)
              : record
            return clean(await computeCaseHealth(hydrated, healthOpts))
          }
          const registry = await cs.readRegistry()
          const hydratedReg = deps.itemStore !== undefined
            ? await (await import('./task-view.ts')).hydrateRegistryTaskGroups(registry, cs, deps.itemStore)
            : registry
          const rows = await computeRegistryHealth(hydratedReg, {
            ...healthOpts,
            includeClosed: args.includeClosed === true,
          })
          return clean({ count: rows.length, cases: rows })
        }

        /* ------------------- 法定期限规则表（0.2.11/0.2.12） -------------- */
        case 'period_rules': {
          // 生效规则集合 = 内置表 + 本地补丁表（0.2.12）；proposed 不参与匹配。
          const rules = await effectiveRulesOf(deps)
          const rows = listRules(s(args.procedure), rules)
          return clean({ count: rows.length, rules: rows })
        }
        case 'mute_period_gate': {
          // 确认闸门（不再提醒）：确实无需在本案登记期限时用（如二审独立建档、
          // 一审案的上诉期由二审案跟踪）。传 muted=false 取消确认。
          requireIds({ caseId: s(args.caseId) })
          const muted = args.muted === false ? undefined : { at: new Date().toISOString(), reason: s(args.reason) }
          const record = await cs.setPeriodGateMuted(String(args.caseId), muted)
          return clean({
            caseId: record.caseId,
            muted: record.periodGateMuted !== undefined,
            reason: record.periodGateMuted?.reason,
            notice: muted === undefined
              ? '已取消确认，巡检会重新纳入该案'
              : '已确认无需在本案登记期限（不再提醒）；如后续需要登记，register_service 后闸门自然解除。',
          })
        }
        case 'patrol_scan': {
          // 案件账实核对（0.2.12）：只读。规则见 patrol.ts——定位是"实际状态与登记不一致"，
          // 不碰字段完整性（case_health）与任务逾期（任务台账）。
          const rules = await effectiveRulesOf(deps)
          const registry = await cs.readRegistry()
          const items = deps.itemStore === undefined ? [] : await deps.itemStore.listItems()
          const result = runPatrol(Object.values(registry.cases), groupItemsByCase(items), rules)
          const muted: string[] = []
          const findings = []
          for (const f of result.findings) {
            const isMuted = deps.patrolLedgerStore === undefined
              ? false
              : await deps.patrolLedgerStore.isMuted(f.caseId, f.ruleId)
            if (isMuted) muted.push(`${f.caseId}/${f.ruleId}`)
            findings.push({ ...f, muted: isMuted })
          }
          return clean({ ...result, findings, muted })
        }
        case 'mute_patrol_finding': {
          // 确认某条发现无需处理（留 reason）；muted=false 取消确认。
          if (deps.patrolLedgerStore === undefined) throw new Error('patrolLedgerStore 不可用')
          requireIds({ caseId: s(args.caseId) })
          const ruleId = s(args.ruleId) ?? ''
          if (ruleId === '') throw new Error('ruleId 必填（见 patrol_scan 结果里的 ruleId）')
          if (args.muted === false) {
            const r = await deps.patrolLedgerStore.unmute(String(args.caseId), ruleId)
            return clean({ ok: r.removed, muted: false, notice: '已取消确认，下次核对会重新纳入' })
          }
          const row = await deps.patrolLedgerStore.mute(String(args.caseId), ruleId, s(args.reason))
          return clean({ ok: true, muted: true, ruleId: row.ruleId, reason: row.reason, notice: '已确认无需处理，不再提醒（留档备查）' })
        }
        case 'propose_period_rule': {
          // 表未命中时**只能提案**（带 cite），不得自行推算日期；律师确认后才生效。
          if (deps.periodRuleStore === undefined) throw new Error('periodRuleStore 不可用')
          const draft = args.rule as Record<string, unknown> | undefined
          const rule = (draft ?? {}) as unknown as PeriodRule
          const ruleId = s(args.ruleId) ?? s(rule.id) ?? ''
          if (ruleId === '') throw new Error('ruleId（或 rule.id）必填')
          const proposal = await deps.periodRuleStore.propose({
            rule: { ...rule, id: ruleId } as PeriodRule,
            cite: String(args.cite ?? rule.cite ?? ''),
            reasoning: String(args.reasoning ?? ''),
            caseId: s(args.caseId),
          })
          return clean({
            proposalId: proposal.id,
            ruleId: proposal.ruleId,
            status: proposal.status,
            cite: proposal.cite,
            notice: `提案已登记（${proposal.ruleId}）。**确认前不生效**：请律师用 resolve_period_rule(accept) 采纳后再用 register_service 登记。`,
          })
        }
        case 'resolve_period_rule': {
          if (deps.periodRuleStore === undefined) throw new Error('periodRuleStore 不可用')
          const proposalId = s(args.proposalId) ?? ''
          if (proposalId === '') throw new Error('proposalId 必填')
          const decision = s(args.decision) ?? 'accept'
          const result = await deps.periodRuleStore.resolve(
            proposalId,
            decision === 'reject' ? 'reject' : 'accept',
            {
              correction: args.correction as Partial<PeriodRule> | undefined,
              note: s(args.note),
            },
          )
          return clean(result)
        }
        case 'derive_deadline':
        case 'register_service': {
          requireIds({ caseId: s(args.caseId) })
          const rawFact = s(args.serviceFact)
          const fact: ServiceRequest['fact'] = rawFact === '送达' || rawFact === '收到' || rawFact === '作出' || rawFact === '生效' ? rawFact : undefined
          const request: ServiceRequest = {
            doc: String(args.doc ?? ''),
            date: String(args.serviceDate ?? args.date ?? ''),
            fact,
            clientRole: s(args.clientRole),
            docKind: s(args.docKind),
            procedure: s(args.procedure),
          }
          if (request.doc === '' || request.date === '') {
            throw new Error('doc 与 serviceDate 均必填（只登记触发事由，届满日由规则表派生）')
          }
          const rules = await effectiveRulesOf(deps)
          if (action === 'derive_deadline') {
            return clean(await planPeriodRegistration(cs, String(args.caseId), request, rules))
          }
          return clean(await applyPeriodRegistration(cs, String(args.caseId), request, deps.itemStore, rules))
        }

        /* ---------------------- case folder memory file ------------------ */
        // case_info：案件文件夹里的 案件信息.md/案卷信息.md 记忆文件
        // （备忘录 #13）。实际注册的 HTTP 代理走 routes 的 case-info 路由；
        // 这里保留进程内等价实现，保证两套 execute 行为一致。
        case 'case_info': {
          requireIds({ caseId: s(args.caseId) })
          const record = await cs.readCase(args.caseId as string)
          if (record === undefined) return { error: `case not found: ${args.caseId}` }
          const folder = s(record.folder)
          if (folder === undefined || folder === '') {
            return { error: `案件 ${args.caseId} 未绑定卷宗文件夹，无法读写 案件信息.md` }
          }
          const { readCaseInfoFile, ensureCaseInfoFile } = await import('./file-service.ts')
          if (args.caseInfoAction === 'ensure') {
            const statusDef = getLitigationStatus(record.status, record.level)
            return clean(await ensureCaseInfoFile(folder, {
              caseId: record.caseId,
              caseName: record.name,
              type: record.type,
              cause: record.cause,
              statusLabel: statusDef.label,
              level: record.level,
              caseNumber: record.caseNumber,
              court: record.court,
              judge: record.judge,
              judgePhone: record.judgePhone,
            }))
          }
          return clean(await readCaseInfoFile(folder))
        }

        /* ---------------------------- cases ----------------------------- */
        case 'register_case': {
          const input: Record<string, unknown> = {
            name: s(args.name), type: s(args.type), cause: s(args.cause),
            status: s(args.status), court: s(args.court), judge: s(args.judge),
            level: s(args.level) ?? defaultLevelForType(s(args.type)),
            claimAmount: s(args.claimAmount),
            filingDate: s(args.filingDate), ourSide: s(args.ourSide),
            caseNumber: s(args.caseNumber), summary: s(args.summary),
          }
          if (args.parties !== undefined) input.parties = clean(normalizeParties(args.parties))
          const record = await cs.registerCase(input)
          const out: Record<string, unknown> = { caseId: record.caseId, name: record.name, ok: true, level: input.level }
          // 建案即打起点节点：收案事件（纪年史头，status=done 只进时间轴）。
          try {
            const { ensureCaseOpenEvent } = await import('./case-open.ts')
            await ensureCaseOpenEvent(deps.itemStore, record.caseId, {
              name: record.name,
              date: new Date().toISOString().slice(0, 10),
            })
          } catch { /* 打点失败不阻塞建案 */ }
          // 建案后内联返回「当前应展开的阶段」dryRun 计划（备忘录 #19：管家不主动建任务）。
          // 让管家在同一次响应里就知道该铺哪些标准任务——确认后 apply_stage_template 落库。
          if (record.status !== undefined && record.status !== '' && record.status !== 'closed') {
            try {
              const plan = await planStageExpansion(cs, record.caseId, '', { dryRun: true }, deps.itemStore)
              out.nextStage = clean({
                stageId: plan.stageId,
                stageName: plan.groupName,
                tasks: plan.tasks.map((t) => t.title),
                skippedExisting: plan.skippedExisting,
                hint: '案件刚建好，请按此清单展开当前阶段任务（apply_stage_template 落库，可按 only/skip 裁剪）',
              })
            } catch { /* 无法解析阶段时不阻塞建案 */ }
          }
          return clean(out)
        }
        case 'update_case': {
          requireIds({ caseId: s(args.caseId) })
          const patch: Record<string, unknown> = {}
          for (const key of ['name', 'type', 'cause', 'status', 'court', 'judge', 'judgePhone', 'level', 'claimAmount', 'filingDate', 'ourSide', 'caseNumber', 'summary', 'folder', 'expandOnStatus'] as const) {
            const value = s(args[key])
            if (value !== undefined) patch[key] = value
          }
          // level 缺省但 type 变化（如 劳动争议→已起诉转民事一审）时按新 type 推断 level。
          if (patch.level === undefined && patch.type !== undefined) {
            const current = await cs.readCase(args.caseId as string)
            if (current !== undefined && (current.level === undefined || current.level === '')) {
              patch.level = defaultLevelForType(String(patch.type))
            }
          }
          if (args.parties !== undefined) patch.parties = clean(normalizeParties(args.parties))
          // 变更前 status——判断「真的发生了档位变化」（prevStatus vs 新 status）。
          const prevRecord = await cs.readCase(args.caseId as string)
          const prevStatus = prevRecord?.status
          const record = await cs.updateCase(args.caseId as string, patch)
          // 同回合钩子：status 被更新时，内联返回阶段推进建议 + 状态变更三态
          // 处理（pendingExpand）——调用方（管家/浏览器）同一轮交互即可收尾，
          // 不必等下一次体检。任务组一律从 items 重建（0.2.2）。
          if (args.status !== undefined && record.status !== prevStatus) {
            const registry = await cs.readRegistry()
            // 0.2.2：任务组从 items 重建。
            const hydrated = deps.itemStore !== undefined
              ? await (await import('./task-view.ts')).hydrateRegistryTaskGroups(registry, cs, deps.itemStore)
              : registry
            const found = detectStageSuggestions(hydrated, args.caseId as string)[0]
            const out: Record<string, unknown> = {
              caseId: record.caseId,
              ok: true,
              stageSuggestions: found?.suggestions ?? [],
            }
            // 三态展开：状态档位变化 → 挂起或忽略。
            //
            // ⚠ 管家自己推进状态时**一律走 agent 态**（除非案件设了 off）：'confirm'
            // 是给**手动改状态**用的 UI 语义——它会让前端弹「是否展开阶段任务」确认框，
            // 而管家自己推进时那个框是多余的（管家在同一回合按纪律自行 expand/ignore）。
            // 案件级 expandOnStatus 表达的是「用户手动改时要不要问」，不该被管家继承。
            if (deps.itemStore !== undefined) {
              const { handleStatusTransition } = await import('./status-transition.ts')
              const setting = String(patch.expandOnStatus ?? record.expandOnStatus ?? '')
              const mode = (setting === 'off' ? 'off' : 'agent') as never
              const trans = await handleStatusTransition({
                caseStore: cs,
                itemStore: deps.itemStore,
                caseId: record.caseId,
                prevStatus,
                nextStatus: record.status,
                level: record.level,
                mode,
              })
              if (trans.pendingExpand !== undefined) {
                out.pendingExpand = trans.pendingExpand
                // 附展开预览：管家/用户确认前就知道要建哪些任务与事件。
                try {
                  const { planStageExpansion } = await import('./stage-expansion.ts')
                  const plan = await planStageExpansion(cs, record.caseId, trans.pendingExpand.stageId, { dryRun: true }, deps.itemStore)
                  out.taskPreview = plan.tasks.map((t) => t.title)
                  out.eventPreview = plan.events.map((e) => e.title)
                } catch { /* 预览失败不阻塞 */ }
              }
              if (trans.notice !== undefined) out.notice = trans.notice
            }
            return clean(out)
          }
          return { caseId: record.caseId, ok: true }
        }
        case 'delete_case': {
          requireIds({ caseId: s(args.caseId) })
          // 级联删除：案件 + items（事件/任务）+ task-groups + 旧版孤儿记录。
          // 备忘录 #3：删除后编号不得残留。
          if (deps.itemStore !== undefined && deps.scheduleStore !== undefined) {
            const { cascadeDeleteCase } = await import('./cascade-delete.ts')
            const result = await cascadeDeleteCase({
              caseStore: cs,
              timelineStore: ts,
              scheduleStore: deps.scheduleStore,
              itemStore: deps.itemStore,
            }, args.caseId as string)
            return clean(result)
          }
          await cs.deleteCase(args.caseId as string)
          return clean({ caseId: args.caseId, deleted: true })
        }
        case 'add_keydate': {
          requireIds({ caseId: s(args.caseId), label: s(args.label), date: s(args.date) })
          const record = await cs.addKeyDate(args.caseId as string, args.label as string, args.date as string)
          // Issue 附: return the created keyDateId so the model can toggle it
          // right away (toggle_keydate requires keyDateId) without re-reading.
          const created = (record.keyDates ?? []).at(-1)
          return clean({ caseId: record.caseId, ok: true, keyDateId: created?.id, label: created?.label, date: created?.date })
        }
        case 'delete_keydate': {
          requireIds({ caseId: s(args.caseId), keyDateId: s(args.keyDateId) })
          const record = await cs.deleteKeyDate(String(args.caseId), String(args.keyDateId))
          return clean({
            caseId: record.caseId,
            keyDates: (record.keyDates ?? []).map((k) => ({ id: k.id, label: k.label, date: k.date })),
            ok: true,
          })
        }
        case 'toggle_keydate': {
          requireIds({ caseId: s(args.caseId), keyDateId: s(args.keyDateId) })
          const record = await cs.toggleKeyDate(args.caseId as string, args.keyDateId as string)
          return { caseId: record.caseId, ok: true }
        }

        /* ---------------------------- task groups ----------------------- */
        case 'upsert_group': {
          requireIds({ caseId: s(args.caseId) })
          // 统一事项模型：任务组存 task-groups.json（ownerId=caseId）。
          if (deps.itemStore !== undefined) {
            const created = await deps.itemStore.upsertGroup({
              ownerId: String(args.caseId),
              ownerType: 'litigation',
              name: args.groupName !== undefined ? String(args.groupName) : undefined,
              ...(args.groupId !== undefined ? { id: String(args.groupId) } : {}),
            })
            return { caseId: String(args.caseId), groupId: created.id, ok: true }
          }
          const group: Record<string, unknown> = {}
          if (args.groupId !== undefined) group.id = String(args.groupId)
          if (args.groupName !== undefined) group.name = String(args.groupName)
          const record = await cs.upsertTaskGroup(args.caseId as string, group)
          return { caseId: record.caseId, ok: true }
        }
        case 'delete_group': {
          requireIds({ caseId: s(args.caseId), groupId: s(args.groupId) })
          if (deps.itemStore !== undefined) {
            // 0.2.2：deleteGroup 一并清理组内任务（items 的 groupId 引用）。
            await deps.itemStore.deleteGroup(String(args.groupId))
            return { ok: true }
          }
          await cs.deleteTaskGroup(args.caseId as string, args.groupId as string)
          return { ok: true }
        }

        /* ------------------------------ tasks --------------------------- */
        case 'upsert_task': {
          requireIds({ caseId: s(args.caseId), groupId: s(args.groupId) })
          // 统一事项模型：任务写 items.json（type=task，groupId 引用任务组）。
          if (deps.itemStore !== undefined) {
            const title = args.taskTitle !== undefined ? String(args.taskTitle) : (args.title !== undefined ? String(args.title) : '新事项')
            const groupName = (await deps.itemStore.listGroups(String(args.caseId))).find((g) => g.id === args.groupId)?.name
            const created = await deps.itemStore.upsertItem({
              ownerId: String(args.caseId),
              ownerType: 'litigation',
              type: 'task',
              title,
              date: args.deadline === undefined ? undefined : String(args.deadline),
              time: args.time === undefined ? undefined : String(args.time),
              priority: (args.priority as never) ?? 'medium',
              status: (args.status === 'done' ? 'done' : args.status === 'doing' || args.status === 'in_progress' ? 'doing' : args.status === 'todo' ? 'pending' : undefined) as never,
              groupId: String(args.groupId),
              groupName,
              // 溯源标记：任务后续被改名也能认出它来自哪个模板任务（幂等展开）。
              templateTitle: title,
              ...(args.taskId !== undefined ? { id: String(args.taskId) } : {}),
            })
            return { caseId: String(args.caseId), taskId: created.id, ok: true }
          }
          const task: Record<string, unknown> = {}
          if (args.taskId !== undefined) task.id = String(args.taskId)
          if (args.taskTitle !== undefined) task.title = String(args.taskTitle)
          if (args.deadline !== undefined) task.deadline = String(args.deadline)
          if (args.time !== undefined) task.time = String(args.time)
          if (args.priority !== undefined) task.priority = String(args.priority)
          if (args.status !== undefined) task.status = String(args.status)
          const record = await cs.upsertTask(args.caseId as string, args.groupId as string, task)
          return { caseId: record.caseId, ok: true }
        }
        case 'delete_task': {
          requireIds({ caseId: s(args.caseId), groupId: s(args.groupId), taskId: s(args.taskId) })
          if (deps.itemStore !== undefined) {
            await deps.itemStore.deleteItem(String(args.taskId))
            return { ok: true }
          }
          await cs.deleteTask(args.caseId as string, args.groupId as string, args.taskId as string)
          return { ok: true }
        }
        case 'set_task_keydate': {
          requireIds({ caseId: s(args.caseId), groupId: s(args.groupId), taskId: s(args.taskId) })
          if (typeof args.enabled !== 'boolean') throw new Error('enabled (boolean) is required')
          // 0.2.2：任务在 items，但 keyDates 是案件字段 → case-store 维护
          // keyDates 数组，item 补链接字段。
          if (deps.itemStore !== undefined) {
            const item = await deps.itemStore.readItem(String(args.taskId))
            if (item === undefined) throw new Error(`task not found: ${args.taskId}`)
            const record = await cs.setTaskKeyDate(args.caseId as string, args.groupId as string, args.taskId as string, args.enabled)
            const kd = (record.keyDates ?? []).find((k) => k.id === item.keyDateId || (args.enabled === false && k.label === item.title))
            await deps.itemStore.upsertItem({
              id: String(args.taskId),
              ...(args.enabled === true && kd !== undefined
                ? { keyDateId: kd.id, remindKeyDate: true }
                : { keyDateId: undefined, remindKeyDate: false }),
            } as never)
            const out: Record<string, unknown> = { caseId: String(args.caseId), ok: true, enabled: args.enabled }
            if (args.enabled === true && kd !== undefined) out.keyDateId = kd.id
            return clean(out)
          }
          const record = await cs.setTaskKeyDate(args.caseId as string, args.groupId as string, args.taskId as string, args.enabled)
          return { caseId: record.caseId, ok: true, enabled: args.enabled }
        }
        case 'move_task': {
          requireIds({ caseId: s(args.caseId), taskId: s(args.taskId), toGroupId: s(args.toGroupId) })
          if (deps.itemStore !== undefined) {
            const toGroup = (await deps.itemStore.listGroups(String(args.caseId))).find((g) => g.id === args.toGroupId)
            await deps.itemStore.upsertItem({
              id: String(args.taskId),
              groupId: String(args.toGroupId),
              groupName: toGroup?.name,
              ownerId: String(args.caseId),
              ownerType: 'litigation',
            })
            return { ok: true }
          }
          await cs.moveTask(args.caseId as string, args.taskId as string, args.toGroupId as string)
          return { ok: true }
        }

        /* ---------------------------- subtasks -------------------------- */
        case 'upsert_subtask': {
          requireIds({ caseId: s(args.caseId), groupId: s(args.groupId), taskId: s(args.taskId) })
          if (deps.itemStore !== undefined) {
            const title = args.subtaskTitle !== undefined ? String(args.subtaskTitle) : (args.title !== undefined ? String(args.title) : '子任务')
            const sid = args.subtaskId === undefined ? undefined : String(args.subtaskId)
            if (sid !== undefined) {
              await deps.itemStore.updateSubtask(String(args.taskId), sid, { title })
            } else {
              await deps.itemStore.addSubtask(String(args.taskId), { title })
            }
            return { caseId: String(args.caseId), ok: true }
          }
          const subtask: Record<string, unknown> = {}
          if (args.subtaskId !== undefined) subtask.id = String(args.subtaskId)
          if (args.subtaskTitle !== undefined) subtask.title = String(args.subtaskTitle)
          const record = await cs.upsertSubtask(args.caseId as string, args.groupId as string, args.taskId as string, subtask)
          return { caseId: record.caseId, ok: true }
        }
        case 'delete_subtask': {
          requireIds({ caseId: s(args.caseId), groupId: s(args.groupId), taskId: s(args.taskId), subtaskId: s(args.subtaskId) })
          if (deps.itemStore !== undefined) {
            await deps.itemStore.deleteSubtask(String(args.taskId), String(args.subtaskId))
            return { ok: true }
          }
          await cs.deleteSubtask(args.caseId as string, args.groupId as string, args.taskId as string, args.subtaskId as string)
          return { ok: true }
        }
        case 'upsert_check': {
          requireIds({ caseId: s(args.caseId), groupId: s(args.groupId), taskId: s(args.taskId) })
          if (deps.itemStore !== undefined) {
            const text = args.checklistText !== undefined ? String(args.checklistText) : ''
            const cid = args.checklistId === undefined ? undefined : String(args.checklistId)
            await deps.itemStore.addChecklist(String(args.taskId), {
              ...(cid !== undefined ? { id: cid } : {}),
              text,
            })
            return { caseId: String(args.caseId), ok: true }
          }
          const item: Record<string, unknown> = {}
          if (args.checklistId !== undefined) item.id = String(args.checklistId)
          if (args.checklistText !== undefined) item.text = String(args.checklistText)
          const record = await cs.upsertChecklist(args.caseId as string, args.groupId as string, args.taskId as string, item)
          return { caseId: record.caseId, ok: true }
        }
        case 'toggle_check': {
          requireIds({ caseId: s(args.caseId), groupId: s(args.groupId), taskId: s(args.taskId), checklistId: s(args.checklistId) })
          if (deps.itemStore !== undefined) {
            await deps.itemStore.toggleChecklist(String(args.taskId), String(args.checklistId))
            return { caseId: String(args.caseId), ok: true }
          }
          const record = await cs.toggleChecklist(args.caseId as string, args.groupId as string, args.taskId as string, args.checklistId as string)
          return { caseId: record.caseId, ok: true }
        }

        /* ---------------------------- timeline -------------------------- */
        case 'upsert_event': {
          requireIds({ caseId: s(args.caseId) })
          // 统一事项模型：时间轴事件写 items.json（type=event，kind=事件类型）。
          if (deps.itemStore !== undefined) {
            const created = await deps.itemStore.upsertItem({
              ownerId: String(args.caseId),
              ownerType: 'litigation',
              type: 'event',
              kind: s(args.eventType),
              title: s(args.title) ?? '新事件',
              date: s(args.date),
              time: s(args.time),
              detail: s(args.detail),
              status: (s(args.status) as never) ?? 'pending',
              ...(args.eventId !== undefined ? { id: String(args.eventId) } : {}),
            })
            // 联动：登记「受理通知送达」后，若该案已进入庭前准备（已立案）且
            // 有「立案」事件，则以受理通知日期修正立案日期（2026-09-08 实务规则）。
            if (created.title === '受理通知送达' && created.date !== undefined) {
              try {
                const { syncFilingEventOnPretrial } = await import('./status-transition.ts')
                await syncFilingEventOnPretrial({ caseStore: cs, itemStore: deps.itemStore, caseId: String(args.caseId) })
              } catch { /* 联动失败不阻塞登记 */ }
            }
            return { eventId: created.id, ok: true }
          }
          const event: Record<string, unknown> = {
            caseId: String(args.caseId),
            title: s(args.title),
            date: s(args.date),
            type: s(args.eventType) ?? 'case_event',
            detail: s(args.detail),
            status: s(args.status) ?? 'pending',
          }
          if (args.eventId !== undefined) event.id = String(args.eventId)
          const created = await ts.upsertEvent(event)
          return { eventId: created.id, ok: true }
        }
        case 'toggle_event': {
          requireIds({ eventId: s(args.eventId) })
          if (deps.itemStore !== undefined) {
            const existing = await deps.itemStore.readItem(String(args.eventId))
            if (existing !== undefined && isEventItem(existing)) {
              const updated = await deps.itemStore.toggleItem(String(args.eventId))
              return { eventId: updated.id, status: updated.status, ok: true }
            }
          }
          const updated = await ts.toggleEvent(args.eventId as string)
          return { eventId: updated.id, status: updated.status, ok: true }
        }
        case 'delete_event': {
          requireIds({ eventId: s(args.eventId) })
          // 事件写 items 后，删除优先从 items 删；若不在 items（旧孤儿事件）则
          // 回落 legacy case-timeline.json，保证两种来源都能删掉（备忘录 #3）。
          if (deps.itemStore !== undefined) {
            const existing = await deps.itemStore.readItem(String(args.eventId))
            if (existing !== undefined && isEventItem(existing)) {
              await deps.itemStore.deleteItem(String(args.eventId))
              return { deleted: true }
            }
            // items 中不存在：顺手删 legacy（幂等）。
            const legacyResult = await ts.deleteEvent(args.eventId as string)
            return { deleted: true, legacy: legacyResult.deleted }
          }
          await ts.deleteEvent(args.eventId as string)
          return { deleted: true }
        }

        /* ----------------------- pending expand 收尾 --------------------- */
        case 'resolve_pending_expand': {
          requireIds({ caseId: s(args.caseId), expandAction: s(args.expandAction) })
          // 三态收尾：expand（按挂起的阶段模板落库任务+事件）/ ignore（仅清除）。
          const { resolvePendingExpand } = await import('./status-transition.ts')
          const action = String(args.expandAction) === 'expand' ? 'expand' : 'ignore'
          const result = await resolvePendingExpand(cs, deps.itemStore, String(args.caseId), action)
          return clean({ caseId: String(args.caseId), ...result })
        }

        default:
          throw new Error(`unhandled action: ${action}`)
      }
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `litigation: ${String(args.action)}${args.caseId !== undefined ? ` ${String(args.caseId)}` : ''}`,
    }),
  }))
}

/**
 * Agent-plane (preset) registration: the same `litigation` tool, but its
 * execute calls the host's HTTP route family (/api/agentlex-case/*) instead
 * of touching stores directly. Used when the plugin is mounted as a row of an
 * agent preset's agent.cordis.yml — no host services are available there.
 */
export function registerLitigationHttpTool(ctx: Context): () => void {
  // Base URL is resolved lazily on each execute: the agent-preset context may
  // not expose webServer at registration time (and DSH_WEB_URL may not be set
  // until the web shell publishes it). Registering must never throw just
  // because the host origin isn't resolvable yet.
  return ctx.tools.register(defineTool({
    name: 'litigation',
    description: DESCRIPTION,
    parameters: PARAMETERS,
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{
        type: 'text',
        text: JSON.stringify(value, null, 2),
      }],
    },
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const action = args.action as Action
      if (!ACTIONS.includes(action)) throw new Error(`unknown action: ${String(args.action)}`)

      const route = HTTP_ROUTE[action]
      if (route === undefined) throw new Error(`no route for action: ${action}`)
      const body = buildBody(action, args)
      const data = await api(body, resolveHostBaseUrl(ctx))
      return clean(route.map ? route.map(data) : data)
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `litigation: ${String(args.action)}${args.caseId !== undefined ? ` ${String(args.caseId)}` : ''}`,
    }),
  }))
}

/** Resolve the litigation host's own base URL for node-side fetches. */
function resolveHostBaseUrl(ctx: Context): string {
  // Prefer the live webServer service port; DSH_WEB_URL can be stale (e.g.
  // pointing at 3080 while the actual web shell is on 3081).
  const server = ctx.get('webServer') as { port?: number } | undefined
  if (server !== undefined && server.port !== undefined) {
    return `http://127.0.0.1:${String(server.port)}`
  }
  const fromEnv = process.env.DSH_WEB_URL
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv.replace(/\/+$/, '')
  throw new Error('litigation: cannot resolve host base URL (no webServer service)')
}

/** One host route call: POST /api/agentlex-case/<route> and unwrap the envelope. */
async function api(body: Record<string, unknown>, baseUrl: string): Promise<unknown> {
  const path = String(body.route ?? 'read')
  const { route: _omit, ...payload } = body
  let response: Response
  try {
    response = await fetch(`${baseUrl}/api/agentlex-case/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch (error) {
    throw new Error(`litigation host unreachable: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`litigation host HTTP ${response.status}: ${text || 'request failed'}`)
  }
  const envelope = await response.json() as { success: boolean; data?: unknown; error?: string }
  if (!envelope.success) throw new Error(envelope.error ?? `request failed (${response.status})`)
  return envelope.data
}

/** action → { route, map? } where map transforms the raw route data. */
const HTTP_ROUTE: Record<Action, { route: string; map?: (data: unknown) => unknown }> = {
  list_cases: {
    route: 'read',
    map: (data) => {
      const registry = data as { cases: Record<string, { caseId: string; name: string; type: string; status?: string; court?: string; level?: string; updatedAt?: string }> }
      const summary = Object.values(registry.cases).map((c) => ({
        caseId: c.caseId, name: c.name, type: c.type, status: c.status,
        court: c.court, level: c.level, updatedAt: c.updatedAt,
      }))
      return { count: summary.length, cases: summary }
    },
  },
  get_case: { route: 'read-case', map: (data) => ({ case: data }) },
  list_events: { route: 'events' },
  deadlines: { route: 'deadlines' },
  register_case: { route: 'register-case' },
  update_case: { route: 'update-case' },
  delete_case: { route: 'delete-case' },
  add_keydate: { route: 'add-keydate' },
  toggle_keydate: { route: 'toggle-keydate' },
  delete_keydate: { route: 'delete-keydate' },
  upsert_group: { route: 'group' },
  delete_group: { route: 'delete-group' },
  upsert_task: { route: 'task' },
  delete_task: { route: 'delete-task' },
  move_task: { route: 'move-task' },
  set_task_keydate: { route: 'set-task-keydate' },
  upsert_subtask: { route: 'subtask' },
  delete_subtask: { route: 'delete-subtask' },
  upsert_check: { route: 'checklist' },
  toggle_check: { route: 'check' },
  upsert_event: { route: 'event' },
  toggle_event: { route: 'toggle-event' },
  delete_event: { route: 'delete-event' },
  resolve_pending_expand: { route: 'resolve-pending-expand' },
  apply_stage_template: { route: 'stage-template' },
  stage_suggestions: { route: 'stage-suggestions' },
  case_health: { route: 'case-health' },
  case_info: { route: 'case-info' },
  period_rules: { route: 'period-rules' },
  patrol_scan: { route: 'patrol-scan' },
  mute_patrol_finding: { route: 'mute-patrol-finding' },
  mute_period_gate: { route: 'mute-period-gate' },
  propose_period_rule: { route: 'propose-period-rule' },
  resolve_period_rule: { route: 'resolve-period-rule' },
  derive_deadline: { route: 'derive-deadline' },
  register_service: { route: 'register-service' },
}

/** Build the request payload (route + action fields) for an action. */
function buildBody(action: Action, args: Record<string, unknown>): Record<string, unknown> {
  const route = HTTP_ROUTE[action].route
  const s = (v: unknown): string | undefined => (v === undefined || v === null) ? undefined : String(v)
  const body: Record<string, unknown> = { route }
  switch (action) {
    case 'list_cases': case 'list_events':
      if (args.caseId !== undefined) body.caseId = s(args.caseId)
      return body
    case 'deadlines':
      if (args.caseId !== undefined) body.caseId = s(args.caseId)
      if (typeof args.includeOverdue === 'boolean') body.includeOverdue = args.includeOverdue
      return body
    case 'register_case':
      for (const key of ['name', 'type', 'cause', 'status', 'court', 'judge', 'judgePhone', 'level', 'claimAmount', 'filingDate', 'ourSide', 'caseNumber', 'summary', 'folder'] as const) {
        const value = s(args[key])
        if (value !== undefined) body[key] = value
      }
      if (args.parties !== undefined) body.parties = clean(normalizeParties(args.parties))
      if (args.instances !== undefined) body.instances = clean(JSON.parse(String(args.instances)) as unknown)
      return body
    case 'get_case': case 'update_case': case 'delete_case':
    case 'add_keydate': case 'toggle_keydate': case 'delete_keydate':
      // 标记调用方：管家改状态走 agent 态（不弹前端确认框）——见 routes.ts update-case。
      // 浏览器改状态走 api.ts，不带 actor，按案件设置（confirm/agent/off）。
      if (action === 'update_case') body.actor = 'agent'
      body.caseId = s(args.caseId)
      if (args.keyDateId !== undefined) body.keyDateId = s(args.keyDateId)
      if (args.label !== undefined) body.label = s(args.label)
      if (args.date !== undefined) body.date = s(args.date)
      if (action === 'update_case') {
        for (const key of ['name', 'type', 'cause', 'status', 'court', 'judge', 'judgePhone', 'level', 'claimAmount', 'filingDate', 'ourSide', 'caseNumber', 'summary', 'folder', 'expandOnStatus'] as const) {
          const value = s(args[key])
          if (value !== undefined) body[key] = value
        }
        if (args.parties !== undefined) body.parties = clean(normalizeParties(args.parties))
        if (args.instances !== undefined) {
          try { body.instances = clean(JSON.parse(String(args.instances)) as unknown) } catch { body.instances = clean(args.instances) }
        }
      }
      return body
    case 'upsert_group': case 'delete_group':
      body.caseId = s(args.caseId)
      if (args.groupId !== undefined) body.groupId = s(args.groupId)
      if (args.groupName !== undefined) body.name = s(args.groupName)
      return body
    case 'apply_stage_template': case 'stage_suggestions': case 'case_health':
      if (args.caseId !== undefined) body.caseId = s(args.caseId)
      if (action === 'case_health' && typeof args.includeClosed === 'boolean') {
        body.includeClosed = args.includeClosed
      }
      if (action === 'apply_stage_template') {
        if (args.stageId !== undefined) body.stageId = s(args.stageId)
        if (args.anchorDate !== undefined) body.anchorDate = s(args.anchorDate)
        if (typeof args.dryRun === 'boolean') body.dryRun = args.dryRun
        const only = toStringArray(args.only)
        if (only !== undefined) body.only = only
        const skip = toStringArray(args.skip)
        if (skip !== undefined) body.skip = skip
      }
      return body
    case 'case_info':
      if (args.caseId !== undefined) body.caseId = s(args.caseId)
      if (args.folder !== undefined) body.path = s(args.folder)
      if (args.caseInfoAction !== undefined) body.action = s(args.caseInfoAction)
      return body
    case 'period_rules':
      if (args.procedure !== undefined) body.procedure = s(args.procedure)
      return body
    case 'patrol_scan':
      return body
    case 'mute_patrol_finding':
      body.caseId = s(args.caseId)
      if (args.ruleId !== undefined) body.ruleId = s(args.ruleId)
      if (typeof args.muted === 'boolean') body.muted = args.muted
      if (args.reason !== undefined) body.reason = s(args.reason)
      return body
    case 'mute_period_gate':
      body.caseId = s(args.caseId)
      if (typeof args.muted === 'boolean') body.muted = args.muted
      if (args.reason !== undefined) body.reason = s(args.reason)
      return body
    case 'propose_period_rule':
      if (args.caseId !== undefined) body.caseId = s(args.caseId)
      if (args.ruleId !== undefined) body.ruleId = s(args.ruleId)
      if (args.rule !== undefined) body.rule = args.rule
      if (args.cite !== undefined) body.cite = s(args.cite)
      if (args.reasoning !== undefined) body.reasoning = s(args.reasoning)
      return body
    case 'resolve_period_rule':
      if (args.proposalId !== undefined) body.proposalId = s(args.proposalId)
      if (args.decision !== undefined) body.decision = s(args.decision)
      if (args.correction !== undefined) body.correction = args.correction
      if (args.note !== undefined) body.note = s(args.note)
      return body
    case 'derive_deadline': case 'register_service':
      body.caseId = s(args.caseId)
      if (args.doc !== undefined) body.doc = s(args.doc)
      if (args.serviceDate !== undefined) body.serviceDate = s(args.serviceDate)
      if (args.serviceFact !== undefined) body.serviceFact = s(args.serviceFact)
      if (args.docKind !== undefined) body.docKind = s(args.docKind)
      if (args.clientRole !== undefined) body.clientRole = s(args.clientRole)
      if (args.procedure !== undefined) body.procedure = s(args.procedure)
      return body
    case 'upsert_task': case 'delete_task':
      body.caseId = s(args.caseId)
      body.groupId = s(args.groupId)
      if (args.taskId !== undefined) body.taskId = s(args.taskId)
      if (action === 'upsert_task') {
        if (args.taskTitle !== undefined) body.title = s(args.taskTitle)
        if (args.deadline !== undefined) body.deadline = s(args.deadline)
        if (args.priority !== undefined) body.priority = s(args.priority)
        if (args.status !== undefined) body.status = s(args.status)
      }
      return body
    case 'move_task':
      body.caseId = s(args.caseId)
      body.taskId = s(args.taskId)
      body.toGroupId = s(args.toGroupId)
      return body
    case 'set_task_keydate':
      body.caseId = s(args.caseId)
      body.groupId = s(args.groupId)
      body.taskId = s(args.taskId)
      body.enabled = Boolean(args.enabled)
      return body
    case 'upsert_subtask': case 'delete_subtask': case 'toggle_check': case 'upsert_check':
      body.caseId = s(args.caseId)
      body.groupId = s(args.groupId)
      body.taskId = s(args.taskId)
      if (args.subtaskId !== undefined) body.subtaskId = s(args.subtaskId)
      if (args.checklistId !== undefined) body.checklistId = s(args.checklistId)
      if (args.subtaskTitle !== undefined) body.title = s(args.subtaskTitle)
      if (args.checklistText !== undefined) body.text = s(args.checklistText)
      return body
    case 'upsert_event':
      body.caseId = s(args.caseId)
      if (args.eventId !== undefined) body.id = s(args.eventId)
      if (args.title !== undefined) body.title = s(args.title)
      if (args.date !== undefined) body.date = s(args.date)
      if (args.eventType !== undefined) body.type = s(args.eventType)
      if (args.detail !== undefined) body.detail = s(args.detail)
      if (args.status !== undefined) body.status = s(args.status)
      return body
    case 'toggle_event': case 'delete_event':
      if (args.eventId !== undefined) body.eventId = s(args.eventId)
      return body
    case 'resolve_pending_expand':
      body.caseId = s(args.caseId)
      body.action = s(args.expandAction)
      return body
    default:
      return body
  }
}
