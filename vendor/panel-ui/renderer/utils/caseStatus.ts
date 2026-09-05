/**
 * Case status workflow — per-procedure status ladders for the GUI pill /
 * dropdown / filter / left-track rendering.
 *
 * Two orthogonal axes:
 *   — status (状态): per-level ladder, id must match shared playbook
 *   — level/procedure (程序): 一审/二审/再审/劳动仲裁/商事仲裁/首次执行/恢复执行/刑事
 *
 * 2026-08 配色（对齐任务模块「呼吸感」）：状态只用主题语义色，形成
 * 中性(收案)→info(庭前)→accent(待开庭·峰值)→描边中性(庭后)→success(已结)
 * 的生命周期弧；不再使用 cool Tailwind 撞暖纸主题。
 *
 * 2026-09（0.2.4）：与 shared playbook 的多轨阶梯对齐——补 再审/劳动仲裁/
 * 商事仲裁/刑事 全套；二审 reviewing→appellate（二审审理）；一审 execution
 * 档保留（存量兼容）；执行新增 terminated（终本）。id/标签必须与
 * src/shared/playbook/litigation.ts 的 STATUS_LADDERS 完全一致（同一套词汇）。
 */

export interface CaseStatusDef {
  id: string;
  label: string;
  color: string;    // Tailwind bg + text classes for the 6px status pill
  dot: string;      // Tailwind bg class for the 8px status-dot legend (dropdowns)
  barColor: string; // Tailwind bg class for progress bars
  order: number;    // Display order (1=earliest, 99=closed)
}

/**
 * 状态阶梯按审级分套（一审 8 档 / 二审 5 档 / 再审 4 档 / 执行 6 档 /
 * 劳动仲裁 6 档 / 商事仲裁 6 档 / 刑事 6 档）。与 src/shared/playbook/litigation.ts
 * 的 STATUS_LADDERS 保持同一套 id/标签。status 轴与 level（审级）轴正交：
 * 显示与筛选按 case.level 取对应阶梯。
 */
const PILL = (bg: string, text: string) => ({ color: `${bg} ${text}`, dot: bg, barColor: bg });
const INFO_PILL = 'bg-[var(--info-bg)] text-[var(--info)]';
const ACCENT_PILL = 'bg-[var(--accent-warm-subtle)] text-[var(--accent-warm)]';
const OUTLINE_PILL = 'bg-[var(--warning-bg)] text-[var(--warning)]';
const WARNING_PILL = 'bg-[var(--warning-bg)] text-[var(--warning)]';
const SUCCESS_PILL = 'bg-[var(--success-bg)] text-[var(--success)]';

export const STATUS_LADDERS: Record<string, CaseStatusDef[]> = {
  /** 民商 · 一审（docx）：收案 → 诉前准备 → 立案中 → 庭前准备 → 庭后管理 → 上诉期 → 二审中 → 已结案。 */
  一审: [
    { id: 'intake', label: '收案', ...PILL(INFO_PILL, INFO_PILL), order: 1 },
    { id: 'pre_filing', label: '诉前准备', ...PILL(INFO_PILL, INFO_PILL), order: 2 },
    { id: 'filing', label: '立案中', ...PILL(INFO_PILL, INFO_PILL), order: 3 },
    { id: 'pretrial', label: '庭前准备', ...PILL(SUCCESS_PILL, SUCCESS_PILL), order: 4 },
    { id: 'post_trial', label: '庭后管理', ...PILL(OUTLINE_PILL, OUTLINE_PILL), order: 5 },
    { id: 'appeal_window', label: '上诉期', ...PILL(WARNING_PILL, WARNING_PILL), order: 6 },
    { id: 'second_instance', label: '二审中', ...PILL(WARNING_PILL, WARNING_PILL), order: 7 },
    { id: 'closed', label: '已结案', ...PILL(SUCCESS_PILL, SUCCESS_PILL), order: 99 },
  ],
  /** 民商 · 二审（docx）：收案 → 诉前准备 → 上诉立案 → 庭前准备 → 庭后管理 → 已结案。 */
  二审: [
    { id: 'intake', label: '收案', ...PILL(INFO_PILL, INFO_PILL), order: 1 },
    { id: 'pre_filing', label: '诉前准备', ...PILL(INFO_PILL, INFO_PILL), order: 2 },
    { id: 'appeal_filed', label: '上诉立案', ...PILL(INFO_PILL, INFO_PILL), order: 3 },
    { id: 'pretrial', label: '庭前准备', ...PILL(SUCCESS_PILL, SUCCESS_PILL), order: 4 },
    { id: 'post_trial', label: '庭后管理', ...PILL(OUTLINE_PILL, OUTLINE_PILL), order: 5 },
    { id: 'closed', label: '已结案', ...PILL(SUCCESS_PILL, SUCCESS_PILL), order: 99 },
  ],
  /** 再审（docx）：收案 → 申请与审查 → 再审审理 → 已结案。 */
  再审: [
    { id: 'intake', label: '收案', ...PILL(INFO_PILL, INFO_PILL), order: 1 },
    { id: 'retrial_apply', label: '申请与审查', ...PILL(INFO_PILL, INFO_PILL), order: 2 },
    { id: 'retrial_trial', label: '再审审理', ...PILL(ACCENT_PILL, ACCENT_PILL), order: 3 },
    { id: 'closed', label: '已结案', ...PILL(SUCCESS_PILL, SUCCESS_PILL), order: 99 },
  ],
  /** 执行（docx）：收案 → 立案 → 执行中 → 终本 → 恢复执行 → 已结案。首次/恢复共用。 */
  首次执行: [
    { id: 'intake', label: '收案', ...PILL(INFO_PILL, INFO_PILL), order: 1 },
    { id: 'filing', label: '立案', ...PILL(INFO_PILL, INFO_PILL), order: 2 },
    { id: 'executing', label: '执行中', ...PILL(ACCENT_PILL, ACCENT_PILL), order: 3 },
    { id: 'terminated', label: '终本', ...PILL(WARNING_PILL, WARNING_PILL), order: 4 },
    { id: 'recovery', label: '恢复执行', ...PILL(ACCENT_PILL, ACCENT_PILL), order: 5 },
    { id: 'closed', label: '已结案', ...PILL(SUCCESS_PILL, SUCCESS_PILL), order: 99 },
  ],
  恢复执行: [
    { id: 'intake', label: '收案', ...PILL(INFO_PILL, INFO_PILL), order: 1 },
    { id: 'filing', label: '立案', ...PILL(INFO_PILL, INFO_PILL), order: 2 },
    { id: 'executing', label: '执行中', ...PILL(ACCENT_PILL, ACCENT_PILL), order: 3 },
    { id: 'terminated', label: '终本', ...PILL(WARNING_PILL, WARNING_PILL), order: 4 },
    { id: 'recovery', label: '恢复执行', ...PILL(ACCENT_PILL, ACCENT_PILL), order: 5 },
    { id: 'closed', label: '已结案', ...PILL(SUCCESS_PILL, SUCCESS_PILL), order: 99 },
  ],
  /** 劳动仲裁（docx）：收案 → 仲裁申请 → 庭前准备 → 庭后管理 → 起诉期 → 已结案。 */
  劳动仲裁: [
    { id: 'intake', label: '收案', ...PILL(INFO_PILL, INFO_PILL), order: 1 },
    { id: 'arb_apply', label: '仲裁申请', ...PILL(INFO_PILL, INFO_PILL), order: 2 },
    { id: 'pretrial', label: '庭前准备', ...PILL(SUCCESS_PILL, SUCCESS_PILL), order: 3 },
    { id: 'post_trial', label: '庭后管理', ...PILL(OUTLINE_PILL, OUTLINE_PILL), order: 4 },
    { id: 'appeal_window', label: '起诉期', ...PILL(WARNING_PILL, WARNING_PILL), order: 5 },
    { id: 'closed', label: '已结案', ...PILL(SUCCESS_PILL, SUCCESS_PILL), order: 99 },
  ],
  /** 商业仲裁（docx）：收案 → 仲裁申请 → 组庭与答辩 → 庭前准备 → 庭后管理 → 已结案。 */
  商事仲裁: [
    { id: 'intake', label: '收案', ...PILL(INFO_PILL, INFO_PILL), order: 1 },
    { id: 'arb_apply', label: '仲裁申请', ...PILL(INFO_PILL, INFO_PILL), order: 2 },
    { id: 'arb_tribunal', label: '组庭与答辩', ...PILL(ACCENT_PILL, ACCENT_PILL), order: 3 },
    { id: 'pretrial', label: '庭前准备', ...PILL(SUCCESS_PILL, SUCCESS_PILL), order: 4 },
    { id: 'post_trial', label: '庭后管理', ...PILL(OUTLINE_PILL, OUTLINE_PILL), order: 5 },
    { id: 'closed', label: '已结案', ...PILL(SUCCESS_PILL, SUCCESS_PILL), order: 99 },
  ],
  /** 刑事：收案 → 侦查 → 审查起诉 → 一审 → 二审 → 已结案（独立轨）。 */
  刑事: [
    { id: 'intake', label: '收案', ...PILL(INFO_PILL, INFO_PILL), order: 1 },
    { id: 'investigation_c', label: '侦查', ...PILL(INFO_PILL, INFO_PILL), order: 2 },
    { id: 'prosecution_c', label: '审查起诉', ...PILL(ACCENT_PILL, ACCENT_PILL), order: 3 },
    { id: 'trial_c', label: '一审', ...PILL(ACCENT_PILL, ACCENT_PILL), order: 4 },
    { id: 'appeal_c', label: '二审', ...PILL(WARNING_PILL, WARNING_PILL), order: 5 },
    { id: 'closed', label: '已结案', ...PILL(SUCCESS_PILL, SUCCESS_PILL), order: 99 },
  ],
};

const FALLBACK_LADDER = '一审';

/** 未定制的程序回退一审套；口语「执行」归一为首次执行。 */
function ladderKey(level: string | null | undefined): string {
  const key = (level ?? '').trim();
  if (key === '执行' || key === '执行中') return '首次执行';
  return STATUS_LADDERS[key] !== undefined ? key : FALLBACK_LADDER;
}

/** 存量状态 id 归并（docx 档位重排后，把旧阶梯 id 映射到新档，避免读侧回落 intake）。 */
const STATUS_LEGACY_MERGE: Record<string, string> = {
  // 二审旧档 → docx 二审：审查中→庭前准备、二审审理/二审判决→庭后管理
  reviewing: 'pretrial',
  appellate: 'post_trial',
  post_judgment: 'post_trial',
  // 一审旧「待开庭」→ 庭前准备（docx 庭前含开庭）；旧「执行中」→ 执行轨 executing
  awaiting_trial: 'pretrial',
  execution: 'executing',
  // 执行旧 查控/处置/分配 → docx 执行中
  investigation: 'executing',
  disposal: 'executing',
  distribution: 'executing',
};

/** 某审级的状态阶梯选项（下拉/筛选用）。 */
export function getStatusOptions(level?: string | null): CaseStatusDef[] {
  return STATUS_LADDERS[ladderKey(level)];
}

/** 兼容导出：一审套。 */
export const CASE_STATUSES: CaseStatusDef[] = STATUS_LADDERS['一审'];

const STATUS_MAP = new Map(CASE_STATUSES.map(s => [s.id, s]));

/** 按审级解析状态定义（未知回落一审套，避免旧数据变未知）。 */
export function getStatusDef(statusId: string | undefined | null, level?: string | null): CaseStatusDef | undefined {
  const id = (statusId ?? '');
  const merged = STATUS_LEGACY_MERGE[id] ?? id;
  const hit = getStatusOptions(level).find(s => s.id === merged);
  if (hit) return hit;
  return STATUS_MAP.get(merged);
}

/**
 * Procedure (审级) tag colors — displayed separately from status.
 * 审级轴 = 一审/二审/再审/劳动仲裁/商事仲裁/首次执行/恢复执行/刑事（仲裁拆分为劳/商，
 * 新增再审/刑事；执行拆分为首次/恢复）。标签一律中性（身份色只出现在左轨节点与筛选色点，
 * 见 PROCEDURE_LEVEL_DOTS），不再按审级彩虹配色。
 */
export const PROCEDURE_TAGS: Record<string, string> = {
  '一审': 'bg-[color-mix(in_srgb,#4a7ab5_13%,transparent)] text-[color-mix(in_srgb,#4a7ab5_62%,var(--ink))]',
  '二审': 'bg-[color-mix(in_srgb,#7d6ab0_13%,transparent)] text-[color-mix(in_srgb,#7d6ab0_62%,var(--ink))]',
  '再审': 'bg-[color-mix(in_srgb,#b0648a_13%,transparent)] text-[color-mix(in_srgb,#b0648a_62%,var(--ink))]',
  '劳动仲裁': 'bg-[color-mix(in_srgb,#3a7d6b_13%,transparent)] text-[color-mix(in_srgb,#3a7d6b_62%,var(--ink))]',
  '商事仲裁': 'bg-[color-mix(in_srgb,#2f7d77_13%,transparent)] text-[color-mix(in_srgb,#2f7d77_62%,var(--ink))]',
  '首次执行': 'bg-[color-mix(in_srgb,#4d7a4f_13%,transparent)] text-[color-mix(in_srgb,#4d7a4f_62%,var(--ink))]',
  '恢复执行': 'bg-[color-mix(in_srgb,#2f7d77_13%,transparent)] text-[color-mix(in_srgb,#2f7d77_62%,var(--ink))]',
  '刑事': 'bg-[color-mix(in_srgb,#8c2f28_13%,transparent)] text-[color-mix(in_srgb,#8c2f28_62%,var(--ink))]',
};

/** 审级轴的规范顺序（筛选行 / 选项列表用）。 */
export const PROCEDURE_LEVELS: string[] = ['一审', '二审', '再审', '劳动仲裁', '商事仲裁', '首次执行', '恢复执行', '刑事'];

/** 审级 8px 色点 hex —— 左轨节点 / 筛选色点 / 历程时间线的审级唯一色（冷色族身份色）。 */
export const PROCEDURE_LEVEL_DOTS: Record<string, string> = {
  '一审': '#4a7ab5',
  '二审': '#7d6ab0',
  '再审': '#b0648a',
  '劳动仲裁': '#3a7d6b',
  '商事仲裁': '#2f7d77',
  '首次执行': '#4d7a4f',
  '恢复执行': '#2f7d77',
  '刑事': '#8c2f28',
};

/** 左轨等窄位审级缩写：劳动仲裁→劳仲、商事仲裁→商仲、执行程序统一→执行（tooltip 保留全称）。 */
const PROCEDURE_SHORT: Record<string, string> = {
  '劳动仲裁': '劳仲',
  '商事仲裁': '商仲',
  '首次执行': '执行',
  '恢复执行': '执行',
};

export function getProcedureShort(level: string): string {
  return PROCEDURE_SHORT[level] ?? level;
}

export function getProcedureDot(level: string): string {
  return PROCEDURE_LEVEL_DOTS[level] ?? '#a69a90';
}

/**
 * 审级归一：旧数据里审级可能是 '仲裁'（未拆分劳动/商事），按案件类型拆分。
 * 劳动争议 → 劳动仲裁；其余（民商/知产等）→ 商事仲裁。
 * 旧的泛 '执行' 审级 → 首次执行（执行现已拆为 首次执行/恢复执行 两档）。
 * 同时去掉「一审（前案）」这类括号注解（前案 = 关联前案），保留规范审级。空值/未知保留原值。
 */
export function normalizeLevel(level: string | null | undefined, caseType?: string): string {
  const t = (level ?? '').trim();
  const base = t.replace(/（[^）]*）$/, '').trim() || t;
  if (base === '仲裁') return caseType === '劳动争议' ? '劳动仲裁' : '商事仲裁';
  if (base === '执行') return '首次执行';
  return base;
}

export function getProcedureColor(level: string): string {
  return PROCEDURE_TAGS[level] ?? 'bg-[var(--paper-inset)] text-[var(--ink-muted)]';
}

/** Sort by workflow order (active first, then closed). */
export function sortByStatus(aId: string, bId: string): number {
  const a = STATUS_MAP.get(aId)?.order ?? 50;
  const b = STATUS_MAP.get(bId)?.order ?? 50;
  return a - b;
}

/**
 * Map legacy free-text statuses to status IDs of the given procedure ladder
 * (default: 一审). First checks whether the value is already one of the
 * ladder's standard IDs — this prevents the regex matchers from greedily
 * matching within the ID itself (e.g. "awaiting_trial" contains "trial" → would
 * have been mapped to "post_trial" instead of staying "awaiting_trial").
 */
export function normalizeStatus(raw: string, level?: string | null): string {
  const t = raw.trim();
  const options = getStatusOptions(level);
  // 已是本审级阶梯的规范 id → 原样返回（防止正则贪婪误匹配 id 内部子串）。
  if (options.some(s => s.id === t)) return t;
  // 委托/接案/收案 → intake（各套通用）。
  if (/委托|接案|收案|intake/.test(t)) return 'intake';
  // 诉前准备 → 一审套的 pre_filing；其它套无此档则回退 pretrial。
  if (/诉前|准备起诉|起草诉状|证据收集|pre_filing/.test(t)) return options.some(s => s.id === 'pre_filing') ? 'pre_filing' : 'pretrial';
  // 立案/受理：一审套有 filing（立案中）；二审套有 appeal_filed（上诉立案）。
  if (/立案|受理|filing|上诉|appeal/.test(t)) {
    if (options.some(s => s.id === 'appeal_filed')) return 'appeal_filed';
    if (options.some(s => s.id === 'filing')) return 'filing';
    return 'pretrial';
  }
  // 上诉期（一审 docx：收到裁判文书后）。
  if (/上诉期|上诉期限|收到判决|裁判送达/.test(t)) return options.some(s => s.id === 'appeal_window') ? 'appeal_window' : 'post_trial';
  // 二审中（一审 docx：任一方上诉后）。level 通常随即切到 二审。
  if (/二审中|已上诉|正在上诉/.test(t)) return options.some(s => s.id === 'second_instance') ? 'second_instance' : 'post_trial';
  // 执行（docx 档：立案→执行中→终本→恢复执行）。
  if (/执行立案|申请执行|受理执行/.test(t)) return options.some(s => s.id === 'filing') ? 'filing' : 'executing';
  if (/执行中|查控|冻结|查封|处置|拍卖|变卖|分配|发还|investigation|disposal|distribution/.test(t)) return options.some(s => s.id === 'executing') ? 'executing' : 'post_trial';
  if (/终本|terminated/.test(t)) return options.some(s => s.id === 'terminated') ? 'terminated' : 'post_trial';
  if (/恢复执行|recovery/.test(t)) return options.some(s => s.id === 'recovery') ? 'recovery' : 'executing';
  // 侦查/审查起诉（刑事轨）。
  if (/侦查|investigation_c/.test(t)) return options.some(s => s.id === 'investigation_c') ? 'investigation_c' : 'intake';
  if (/审查起诉|起诉意见|prosecution_c/.test(t)) return options.some(s => s.id === 'prosecution_c') ? 'prosecution_c' : 'intake';
  // 开庭/审理：docx 一审无独立开庭档，庭前准备含开庭；二审/再审有独立审理档则用之。
  if (/开庭|等待开庭|排期|awaiting_hearing|待开庭/.test(t)) return options.some(s => s.id === 'pretrial') ? 'pretrial' : 'post_trial';
  if (/审理|庭审|质证|辩论|举证|二审审理|appellate/.test(t)) return options.some(s => s.id === 'pretrial') ? 'pretrial' : 'post_trial';
  if (/待判|等待判决|合议|judged|二审判决|post_judgment/.test(t)) return options.some(s => s.id === 'post_trial') ? 'post_trial' : 'post_trial';
  if (/组庭|选定仲裁员|arb_tribunal/.test(t)) return options.some(s => s.id === 'arb_tribunal') ? 'arb_tribunal' : 'pretrial';
  if (/仲裁申请|arb_apply/.test(t)) return options.some(s => s.id === 'arb_apply') ? 'arb_apply' : 'pretrial';
  if (/再审申请|再审审查|retrial_apply/.test(t)) return options.some(s => s.id === 'retrial_apply') ? 'retrial_apply' : 'post_trial';
  if (/起诉期|裁决后起诉|appeal_window/.test(t)) return options.some(s => s.id === 'appeal_window') ? 'appeal_window' : 'post_trial';
  if (/执行|execution/.test(t)) return options.some(s => s.id === 'executing') ? 'executing' : 'post_trial';
  if (/撤诉|撤回|withdrawn/.test(t)) return 'closed';
  if (/结案|驳回起诉|调解|和解|closed/.test(t)) return 'closed';
  if (/仲裁/.test(t)) return 'pretrial';
  return 'intake';
}

