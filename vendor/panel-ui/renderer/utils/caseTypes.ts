/**
 * caseTypes — the canonical case-type taxonomy for the litigation module.
 *
 * 2026-08: 民商合一（民事+商事 → 民商），去掉「破产/劳动仲裁/商事仲裁」类型，新增「劳动争议」。
 * 仲裁类走审级轴（劳动仲裁/商事仲裁）；执行恢复为独立类型（审级轴：首次执行/恢复执行）。
 * Types are stored on disk as plain Chinese strings (Rust is JSON passthrough),
 * so the taxonomy lives here as the single source of truth, and
 * `normalizeCaseType` maps legacy/agent-written variants to canonical labels on
 * READ (via `normalizeCase` in useAgentLex) so old disks display correctly.
 */

export interface CaseTypeDef {
  key: string;   // canonical label (also the stored value)
  label: string; // display label
  dot: string;   // 8px status-dot hex — the only per-type color (card + filter chips)
}

/** The 7 canonical case types, in display order.
 *  2026-08 收敛为「冷色族」身份色：民商 温蓝 / 刑事 砖红 / 行政 橄榄 / 劳动争议 墨绿 /
 *  知产 藕紫 / 执行 松绿 / 其他 中性灰。避免与语义色（error/terracotta）撞色。 */
export const CASE_TYPE_DEFS: CaseTypeDef[] = [
  { key: '民商', label: '民商', dot: '#4a7ab5' },
  { key: '刑事', label: '刑事', dot: '#a34a4a' },
  { key: '行政', label: '行政', dot: '#8a7037' },
  { key: '劳动争议', label: '劳动争议', dot: '#3a7d6b' },
  { key: '知识产权', label: '知识产权', dot: '#8f5a8a' },
  { key: '执行', label: '执行', dot: '#2d7d5e' },
  { key: '其他', label: '其他', dot: '#a69a90' },
];

/** Filter chips: `全部` + the 6 canonical types (NonLitigation-style pattern). */
export const CASE_TYPES: (CaseTypeDef & { key: string })[] = [
  { key: '__all', label: '全部', dot: '' },
  ...CASE_TYPE_DEFS,
];

/** All canonical labels for exact-match checks. */
const CANONICAL = new Set(CASE_TYPE_DEFS.map(d => d.key));

/** Case causes (案由) keyed by canonical type label, for the registration form. */
export const CASE_CAUSES: Record<string, string[]> = {
  '民商': ['合同纠纷', '侵权纠纷', '婚姻家庭', '继承纠纷', '民间借贷', '物权纠纷', '人格权纠纷',
    '公司纠纷', '金融纠纷', '股权纠纷', '保险纠纷', '票据纠纷', '建设工程', '其他民商'],
  '刑事': ['危害公共安全', '破坏市场经济秩序', '侵犯人身权利', '侵犯财产', '妨害社会管理', '贪污贿赂', '渎职', '其他刑事'],
  '行政': ['行政处罚', '行政强制', '行政许可', '行政征收', '信息公开', '其他行政'],
  '劳动争议': ['劳动报酬', '社会保险', '经济补偿', '劳动合同', '其他劳动争议'],
  '知识产权': ['著作权', '商标权', '专利权', '不正当竞争', '其他知识产权'],
  '执行': ['金钱给付', '行为履行', '财产执行', '恢复执行', '执行异议', '其他执行'],
  '其他': ['其他'],
};

/**
 * Legacy/agent-written variants → canonical label.
 * 民商相关旧称、劳动/仲裁旧类型、破产旧类型都收敛到新 7 类；执行异议归执行。
 */
const TYPE_ALIASES: Record<string, string> = {
  '民商': '民商',
  '民事': '民商',
  '商事': '民商',
  '民商事': '民商',
  '民事诉讼': '民商',
  '民事纠纷': '民商',
  '商事争议': '民商',
  '刑事辩护': '刑事',
  '刑事附带民事': '刑事',
  '行政诉讼': '行政',
  '劳动争议': '劳动争议',
  '劳动纠纷': '劳动争议',
  '劳动仲裁': '劳动争议',
  '知识产权纠纷': '知识产权',
  '商事仲裁': '民商',
  '仲裁': '民商',
  '执行异议': '执行',
  '破产': '民商',
  '破产清算': '民商',
};

/**
 * Map any stored/agent value to a canonical type label. Empty/unrecognized → 其他.
 * `hint`（案由+案名）用于补判：旧数据 type 常漏标「劳动争议」（民商里混着劳动争议案），
 * 民商 + 劳动争议关键词 → 劳动争议，从而审级前案「仲裁」可正确归为劳动仲裁。
 */
export function normalizeCaseType(raw: string | null | undefined, hint?: string): string {
  const t = (raw ?? '').trim();
  if (!t) return '其他';
  const mapped = CANONICAL.has(t) ? t : (TYPE_ALIASES[t] ?? '其他');
  if (mapped === '民商' && hint && /劳动争议|劳动纠纷|劳动仲裁/.test(hint)) return '劳动争议';
  return mapped;
}

const DOT_MAP = new Map(CASE_TYPE_DEFS.map(d => [d.key, d.dot]));
const FALLBACK = DOT_MAP.get('其他')!;

/** Status-dot hex for a case's type. Normalizes unknown values first. */
export function getCaseTypeDot(type: string): string {
  return DOT_MAP.get(normalizeCaseType(type)) ?? FALLBACK;
}
