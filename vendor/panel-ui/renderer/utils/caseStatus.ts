/**
 * Case status workflow — 5 stages simplified from the original 11.
 * For display only (no LLM inference — user sets status manually).
 *
 * Two orthogonal axes:
 *   — status (状态): 收案 → 庭前准备 → 待开庭 → 庭后管理 → 已结案
 *   — level/procedure (程序): 一审/二审/执行/仲裁 (stored in CaseEntry.level)
 *
 * 2026-08 配色（对齐任务模块「呼吸感」）：状态只用主题语义色，形成
 * 中性(收案)→info(庭前)→accent(待开庭·峰值)→描边中性(庭后)→success(已结)
 * 的生命周期弧；不再使用 cool Tailwind 撞暖纸主题。
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
 * 状态阶梯按审级分套（一审 8 档 / 二审 6 档 / 执行 5 档；再审/仲裁回退一审）。
 * 与 src/shared/playbook/litigation.ts 的 STATUS_LADDERS 保持同一套 id/标签。
 * status 轴与 level（审级）轴正交：显示与筛选按 case.level 取对应阶梯。
 */
const PILL = (bg: string, text: string) => ({ color: `${bg} ${text}`, dot: bg, barColor: bg });
const INFO_PILL = 'bg-[var(--info-bg)] text-[var(--info)]';
const ACCENT_PILL = 'bg-[var(--accent-warm-subtle)] text-[var(--accent-warm)]';
const OUTLINE_PILL = 'bg-[var(--warning-bg)] text-[var(--warning)]';
const WARNING_PILL = 'bg-[var(--warning-bg)] text-[var(--warning)]';
const SUCCESS_PILL = 'bg-[var(--success-bg)] text-[var(--success)]';

export const STATUS_LADDERS: Record<string, CaseStatusDef[]> = {
  一审: [
    { id: 'intake', label: '收案', ...PILL(INFO_PILL, INFO_PILL), order: 1 },
    { id: 'pre_filing', label: '诉前', ...PILL(INFO_PILL, INFO_PILL), order: 2 },
    { id: 'filing', label: '立案中', ...PILL(INFO_PILL, INFO_PILL), order: 3 },
    { id: 'pretrial', label: '庭前准备', ...PILL(SUCCESS_PILL, SUCCESS_PILL), order: 4 },
    { id: 'awaiting_trial', label: '待开庭', ...PILL(ACCENT_PILL, ACCENT_PILL), order: 5 },
    { id: 'post_trial', label: '庭后管理', ...PILL(OUTLINE_PILL, OUTLINE_PILL), order: 6 },
    { id: 'execution', label: '执行中', ...PILL(WARNING_PILL, WARNING_PILL), order: 7 },
    { id: 'closed', label: '已结案', ...PILL(SUCCESS_PILL, SUCCESS_PILL), order: 99 },
  ],
  二审: [
    { id: 'intake', label: '收案', ...PILL(INFO_PILL, INFO_PILL), order: 1 },
    { id: 'appeal_filed', label: '上诉立案', ...PILL(INFO_PILL, INFO_PILL), order: 2 },
    { id: 'reviewing', label: '审查中', ...PILL(INFO_PILL, INFO_PILL), order: 3 },
    { id: 'awaiting_trial', label: '待开庭', ...PILL(ACCENT_PILL, ACCENT_PILL), order: 4 },
    { id: 'post_judgment', label: '二审判决', ...PILL(OUTLINE_PILL, OUTLINE_PILL), order: 5 },
    { id: 'closed', label: '已结案', ...PILL(SUCCESS_PILL, SUCCESS_PILL), order: 99 },
  ],
  首次执行: [
    { id: 'intake', label: '收案', ...PILL(INFO_PILL, INFO_PILL), order: 1 },
    { id: 'investigation', label: '财产查控', ...PILL(INFO_PILL, INFO_PILL), order: 2 },
    { id: 'disposal', label: '处置中', ...PILL(ACCENT_PILL, ACCENT_PILL), order: 3 },
    { id: 'distribution', label: '分配发还', ...PILL(OUTLINE_PILL, OUTLINE_PILL), order: 4 },
    { id: 'closed', label: '已结案', ...PILL(SUCCESS_PILL, SUCCESS_PILL), order: 99 },
  ],
  恢复执行: [
    { id: 'intake', label: '收案', ...PILL(INFO_PILL, INFO_PILL), order: 1 },
    { id: 'investigation', label: '财产查控', ...PILL(INFO_PILL, INFO_PILL), order: 2 },
    { id: 'disposal', label: '处置中', ...PILL(ACCENT_PILL, ACCENT_PILL), order: 3 },
    { id: 'distribution', label: '分配发还', ...PILL(OUTLINE_PILL, OUTLINE_PILL), order: 4 },
    { id: 'closed', label: '已结案', ...PILL(SUCCESS_PILL, SUCCESS_PILL), order: 99 },
  ],
};

const FALLBACK_LADDER = '一审';

/** 未定制的程序（再审/仲裁等）回退一审套；口语「执行」归一为首次执行。 */
function ladderKey(level: string | null | undefined): string {
  const key = (level ?? '').trim();
  if (key === '执行' || key === '执行中') return '首次执行';
  return STATUS_LADDERS[key] !== undefined ? key : FALLBACK_LADDER;
}

/** 某审级的状态阶梯选项（下拉/筛选用）。 */
export function getStatusOptions(level?: string | null): CaseStatusDef[] {
  return STATUS_LADDERS[ladderKey(level)];
}

/** 兼容导出：一审套。 */
export const CASE_STATUSES: CaseStatusDef[] = STATUS_LADDERS['一审'];

const STATUS_MAP = new Map(CASE_STATUSES.map(s => [s.id, s]));

/** 按审级解析状态定义（未知回落一审套，避免旧数据变未知）。 */
export function getStatusDef(statusId: string | undefined | null, level?: string | null): CaseStatusDef | undefined {
  const hit = getStatusOptions(level).find(s => s.id === (statusId ?? ''));
  if (hit) return hit;
  return STATUS_MAP.get(statusId ?? '');
}

/**
 * Procedure (审级) tag colors — displayed separately from status.
 * 2026-08: 审级轴 = 一审/二审/再审/劳动仲裁/商事仲裁/首次执行/恢复执行（仲裁拆分为劳/商，
 * 新增再审；执行拆分为首次/恢复）。标签一律中性（身份色只出现在左轨节点与筛选色点，
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
};

/** 审级轴的规范顺序（筛选行 / 选项列表用）。 */
export const PROCEDURE_LEVELS: string[] = ['一审', '二审', '再审', '劳动仲裁', '商事仲裁', '首次执行', '恢复执行'];

/** 审级 8px 色点 hex —— 左轨节点 / 筛选色点 / 历程时间线的审级唯一色（冷色族身份色）。 */
export const PROCEDURE_LEVEL_DOTS: Record<string, string> = {
  '一审': '#4a7ab5',
  '二审': '#7d6ab0',
  '再审': '#b0648a',
  '劳动仲裁': '#3a7d6b',
  '商事仲裁': '#2f7d77',
  '首次执行': '#4d7a4f',
  '恢复执行': '#2f7d77',
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
  if (options.some(s => s.id === t)) return t;
  if (/委托|接案|收案|intake/.test(t)) return 'intake';
  if (/诉前|准备起诉|起草诉状|证据收集|pre_filing/.test(t)) return 'pretrial';
  if (/立案|受理|filing|上诉|appeal/.test(t)) return level === '二审' ? 'appeal_filed' : 'pretrial';
  if (/查控|冻结|查封|investigation/.test(t)) return options.some(s => s.id === 'investigation') ? 'investigation' : 'post_trial';
  if (/处置|拍卖|变卖|disposal/.test(t)) return options.some(s => s.id === 'disposal') ? 'disposal' : 'post_trial';
  if (/分配|发还|distribution/.test(t)) return options.some(s => s.id === 'distribution') ? 'distribution' : 'post_trial';
  if (/开庭|等待开庭|排期|awaiting_hearing/.test(t)) return 'awaiting_trial';
  if (/审理|庭审|质证|辩论|举证/.test(t)) return 'post_trial';
  if (/待判|等待判决|合议|judged|二审判决|post_judgment/.test(t)) return level === '二审' ? 'post_judgment' : 'post_trial';
  if (/执行|execution/.test(t)) return 'post_trial';
  if (/撤诉|撤回|withdrawn/.test(t)) return 'closed';
  if (/结案|驳回起诉|调解|和解|closed/.test(t)) return 'closed';
  if (/仲裁/.test(t)) return 'pretrial';
  return 'intake';
}
