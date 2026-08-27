/**
 * caseFormat — shared formatting helpers for the case / project modules.
 *
 * These are pure functions so they are directly unit-testable and safe to use
 * across the dashboard cards, detail pages and filter rows.
 */

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function daysUntil(dateStr: string): number {
  const d = new Date(dateStr), t = new Date();
  d.setHours(0, 0, 0, 0); t.setHours(0, 0, 0, 0);
  return Math.ceil((d.getTime() - t.getTime()) / 86400000);
}

export function isOverdue(dateStr: string): boolean {
  return dateStr < todayStr();
}

/**
 * Render an amount (litigation 标的 / contract 金额) in a uniform way.
 *
 * Storage is a free string (agents may write "500000", "50万", "500000元"),
 * so this parser normalizes to "500,000 元". Returns '' for empty and the
 * raw string verbatim when it can't be parsed — never a wrong number like
 * parseInt('50万') → 50.
 */
export function formatAmount(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  const s = String(v).trim();
  if (!s) return '';
  // "12.5" / "1,234,567" / "50万" / "500000元" / "1.5万元"
  const m = s.match(/^([\d.,]+)\s*(万)?\s*元?$/);
  if (m) {
    let n = parseFloat(m[1].replace(/,/g, ''));
    if (!Number.isNaN(n)) {
      if (m[2] === '万') n *= 10000;
      return `${n.toLocaleString('zh-CN', { maximumFractionDigits: 0 })} 元`;
    }
  }
  // Bare numeric string without the trailing 元/万 unit pattern.
  const n = Number(s.replace(/,/g, ''));
  if (!Number.isNaN(n) && s.trim() !== '') return `${n.toLocaleString('zh-CN', { maximumFractionDigits: 0 })} 元`;
  return s;
}

/** Numeric value for sorting (handles "50万" → 500000). Returns 0 on unparseable. */
export function parseAmountValue(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const s = String(v).trim();
  const m = s.match(/^([\d.,]+)\s*(万)?\s*元?$/);
  if (m) {
    const amount = parseFloat(m[1].replace(/,/g, ''));
    if (!Number.isNaN(amount)) return m[2] === '万' ? amount * 10000 : amount;
  }
  const n = Number(s.replace(/,/g, ''));
  return Number.isNaN(n) ? 0 : n;
}

/** Compact relative-time label for an ISO/date string ("3天前", "刚刚"). '' when unparseable. */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const MIN = 60000, HOUR = 3600000, DAY = 86400000;
  if (diff < MIN) return '刚刚';
  if (diff < HOUR) return `${Math.floor(diff / MIN)}分钟前`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}小时前`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}天前`;
  return iso.slice(0, 10);
}

/** Chinese role labels used on disk for party details. */
export const PARTY_ROLE_ZH = ['原告', '被告', '上诉人', '被上诉人', '申请人', '被申请人', '申请执行人', '被执行人', '第三人', '代理人', '审判人员', '书记员'] as const;

/** Map legacy/UI English role tokens to the canonical Chinese role labels. */
export function normalizePartyRole(role: string): string {
  const EN_TO_ZH: Record<string, string> = {
    plaintiff: '原告',
    defendant: '被告',
    third_party: '第三人',
    'third party': '第三人',
    agent: '代理人',
    attorney: '代理人',
    judge: '审判人员',
    '审判人员': '审判人员',
    clerk: '书记员',
    书记员: '书记员',
    applicant: '申请人',
    respondent: '被申请人',
    execution_applicant: '申请执行人',
    '申请执行人': '申请执行人',
    execution_respondent: '被执行人',
    executed_party: '被执行人',
    '被执行人': '被执行人',
  };
  return EN_TO_ZH[role.trim()] ?? role;
}

/**
 * 两个主诉主体输入框（原告/被告 占位）→ 角色标签，随我方立场对应的程序映射：
 * 仲裁 → 申请人/被申请人，执行 → 申请执行人/被执行人；一审诉讼与上诉仍为 原告/被告
 * （上诉的二审主体用单独的 上诉人/被上诉人 字段）。
 */
export function partyRoleForOurSide(ourSide: string): { first: string; second: string } {
  switch (ourSide) {
    case 'applicant':
    case 'respondent':
      return { first: '申请人', second: '被申请人' };
    case 'executionApplicant':
    case 'executionRespondent':
      return { first: '申请执行人', second: '被执行人' };
    default:
      return { first: '原告', second: '被告' };
  }
}
