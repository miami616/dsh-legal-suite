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

export const CASE_STATUSES: CaseStatusDef[] = [
  { id: 'intake', label: '收案', color: 'bg-[var(--paper-inset)] text-[var(--ink-muted)]', dot: 'bg-[var(--ink-subtle)]', barColor: 'bg-[var(--ink-subtle)]', order: 1 },
  { id: 'pretrial', label: '庭前准备', color: 'bg-[var(--info-bg)] text-[var(--info)]', dot: 'bg-[var(--info)]', barColor: 'bg-[var(--info)]', order: 2 },
  { id: 'awaiting_trial', label: '待开庭', color: 'bg-[var(--accent-warm-subtle)] text-[var(--accent-warm)]', dot: 'bg-[var(--accent-warm)]', barColor: 'bg-[var(--accent-warm)]', order: 3 },
  { id: 'post_trial', label: '庭后管理', color: 'bg-transparent text-[var(--ink-muted)] border border-[var(--line-strong)]', dot: 'bg-[var(--line-strong)]', barColor: 'bg-[var(--line-strong)]', order: 4 },
  { id: 'closed', label: '已结案', color: 'bg-[var(--success-bg)] text-[var(--success)]', dot: 'bg-[var(--success)]', barColor: 'bg-[var(--success)]', order: 99 },
];

const STATUS_MAP = new Map(CASE_STATUSES.map(s => [s.id, s]));

export function getStatusDef(statusId: string): CaseStatusDef | undefined {
  return STATUS_MAP.get(statusId);
}

/**
 * Procedure (审级) tag colors — displayed separately from status.
 * 2026-08: 审级轴 = 一审/二审/再审/劳动仲裁/商事仲裁/首次执行/恢复执行（仲裁拆分为劳/商，
 * 新增再审；执行拆分为首次/恢复）。标签一律中性（身份色只出现在左轨节点与筛选色点，
 * 见 PROCEDURE_LEVEL_DOTS），不再按审级彩虹配色。
 */
export const PROCEDURE_TAGS: Record<string, string> = {
  '一审': 'bg-[var(--paper-inset)] text-[var(--ink-muted)]',
  '二审': 'bg-[var(--paper-inset)] text-[var(--ink-muted)]',
  '再审': 'bg-[var(--paper-inset)] text-[var(--ink-muted)]',
  '劳动仲裁': 'bg-[var(--paper-inset)] text-[var(--ink-muted)]',
  '商事仲裁': 'bg-[var(--paper-inset)] text-[var(--ink-muted)]',
  '首次执行': 'bg-[var(--paper-inset)] text-[var(--ink-muted)]',
  '恢复执行': 'bg-[var(--paper-inset)] text-[var(--ink-muted)]',
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
 * Map legacy free-text statuses to the new simplified 5 status IDs.
 *
 * First checks whether the value is already one of the standard IDs — this
 * prevents the regex matchers from greedily matching within the ID itself
 * (e.g. "awaiting_trial" contains "trial" → would have been mapped to
 * "post_trial" instead of staying "awaiting_trial").
 */
export function normalizeStatus(raw: string): string {
  const t = raw.trim();
  // Already a standard ID? Return directly (the regex fallback below is for
  // legacy free-text values like "开庭", "等待判决", etc.).
  if (CASE_STATUSES.some(s => s.id === t)) return t;
  if (/委托|接案|收案|intake/.test(t)) return 'intake';
  if (/诉前|准备起诉|起草诉状|证据收集|pre_filing/.test(t)) return 'pretrial';
  if (/立案|受理|filing/.test(t)) return 'pretrial';
  if (/开庭|等待开庭|排期|awaiting_hearing/.test(t)) return 'awaiting_trial';
  if (/审理|庭审|质证|辩论|举证/.test(t)) return 'post_trial';
  if (/待判|等待判决|合议|上诉|二审|judged|appeal/.test(t)) return 'post_trial';
  if (/执行|execution/.test(t)) return 'post_trial';
  if (/撤诉|撤回|withdrawn/.test(t)) return 'closed';
  if (/结案|驳回起诉|调解|和解|closed/.test(t)) return 'closed';
  if (/仲裁/.test(t)) return 'pretrial';
  return 'intake';
}
