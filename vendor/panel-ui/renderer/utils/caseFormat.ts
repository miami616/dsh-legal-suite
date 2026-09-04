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

/** 当事人角色可选标签（编辑下拉固定用，与后端 party-vocab CANONICAL_ROLES 一致；
 *  不再含 代理人/审判人员/书记员——那些是卷宗人员非当事人，备忘录 #5）。
 *  另含常用序数/审级变体（第一/第二/第三被申请人等、一审原告），管家写的这类
 *  角色在编辑下拉里能选回、不丢（2026-09-04）。 */
export const PARTY_ROLE_ZH = [
  '原告', '被告', '申请人', '被申请人', '上诉人', '被上诉人', '申请执行人', '被执行人', '第三人',
  '第一被申请人', '第二被申请人', '第三被申请人',
  '第一被告', '第二被告', '第三被告',
  '第一原告', '第二原告',
  '第一被执行人', '第二被执行人',
] as const;

/** 规范角色（不含序数/审级变体）。 */
const CANONICAL_ROLES = ['原告', '被告', '申请人', '被申请人', '上诉人', '被上诉人', '申请执行人', '被执行人', '第三人'] as const;

/** 从角色串里提取规范角色（「第一被申请人」→「被申请人」、「被告一」→「被告」、
 *  「一审原告」→「原告」）。非规范返回原值。 */
export function canonicalPartyRole(role: string): string {
  const r = (role ?? '').trim();
  if ((CANONICAL_ROLES as readonly string[]).includes(r)) return r;
  const stripped = r
    .replace(/^(一审|二审|再审|原审|终审|重审)/, '')
    .replace(/(第?[一二三四五六七八九十百\d]+)/, '');
  return (CANONICAL_ROLES as readonly string[]).includes(stripped) ? stripped : r;
}

/** 在 parties.details 里找一个角色命中给定规范角色的当事人（支持序数变体）。 */
export function findPartyByCanonicalRole(
  details: Array<{ name?: string; role?: string; roles?: string[]; firm?: string }> | undefined,
  canonical: string,
): { name: string; role: string; firm?: string } | undefined {
  const rows = Array.isArray(details) ? details : [];
  for (const d of rows) {
    const roles = Array.isArray(d.roles) ? d.roles : [d.role];
    const hit = roles.some((r) => canonicalPartyRole(r ?? '') === canonical);
    if (hit) return { name: d.name ?? '', role: d.role ?? canonical, firm: d.firm };
  }
  return undefined;
}

/** 我方立场 → 我方主角色中文标签。 */
export function ourSideRoleLabel(ourSide: string): string {
  const map: Record<string, string> = {
    plaintiff: '原告', applicant: '申请人', defendant: '被告', respondent: '被申请人',
    appellant: '上诉人', appellee: '被上诉人',
    executionApplicant: '申请执行人', executionRespondent: '被执行人',
  };
  return map[ourSide] ?? '';
}

/** 我方主角色 → 对方主角色。 */
export function oppositeRoleOf(ourSide: string): string {
  const map: Record<string, string> = {
    plaintiff: '被告', applicant: '被申请人', defendant: '原告', respondent: '申请人',
    appellant: '被上诉人', appellee: '上诉人',
    executionApplicant: '被执行人', executionRespondent: '申请执行人',
  };
  return map[ourSide] ?? '';
}

/** 规范角色 → 所在侧（A=原告系/申请人系，B=被告系/被申请人系）。 */
function sideOfCanonical(canonical: string): 'A' | 'B' | '' {
  if (['原告', '申请人', '上诉人', '申请执行人'].includes(canonical)) return 'A';
  if (['被告', '被申请人', '被上诉人', '被执行人'].includes(canonical)) return 'B';
  return '';
}

/** ourSide key → 我方所在侧。 */
function sideOfOurSide(ourSide: string): 'A' | 'B' | '' {
  const A = ['plaintiff', 'applicant', 'appellant', 'executionApplicant'];
  const B = ['defendant', 'respondent', 'appellee', 'executionRespondent'];
  if (A.includes(ourSide)) return 'A';
  if (B.includes(ourSide)) return 'B';
  return '';
}

/** 一行当事人是否含指定侧角色（容忍序数/多角色）。 */
function rowHasSide(
  d: { name?: string; role?: string; roles?: string[]; firm?: string; phone?: string; address?: string },
  side: 'A' | 'B' | '',
): boolean {
  if (side === '') return false;
  const roles = Array.isArray(d.roles) ? d.roles : d.role ? [d.role] : [];
  return roles.some((r) => sideOfCanonical(canonicalPartyRole(r ?? '')) === side);
}

export interface PartyDisplayRow { name: string; role: string; firm?: string; roles?: string[] }

interface PartiesInput {
  details?: Array<{ name?: string; role?: string; roles?: string[]; firm?: string; phone?: string; address?: string; ourClient?: boolean }>;
  plaintiff?: string;
  defendant?: string;
  ourClientName?: string;
}
interface PartyOwnerInput { ourSide?: string; parties?: PartiesInput }

/** 我方主体列表：以显式标记指认（details[].ourClient:true，或 parties.ourClientName
 *  对应行）。无标记时退化为「我方侧恰好只有一位主体」才敢用；否则返回空（不臆断，
 *  2026-09-04：003 两被申请人，律所只代理第一被申请人，不能把同侧全当我方）。 */
export function ourPartyList(c: PartyOwnerInput): PartyDisplayRow[] {
  const parties = c.parties ?? {};
  const ourSide = c.ourSide ?? parties.ourSide ?? '';
  const details = parties.details ?? [];
  // 1) 显式行标记。
  const marked = details.filter((d) => d.ourClient === true);
  if (marked.length > 0) return marked.map((d) => ({ name: d.name ?? '', role: d.role ?? '', firm: d.firm, roles: d.roles }));
  // 2) ourClientName 指认。
  if (parties.ourClientName) {
    const byName = details.filter((d) => (d.name ?? '') === parties.ourClientName);
    if (byName.length > 0) return byName.map((d) => ({ name: d.name ?? '', role: d.role ?? '', firm: d.firm, roles: d.roles }));
  }
  const side = sideOfOurSide(ourSide);
  // 3) 我方侧恰好只有一位主体 → 无歧义可用。
  if (side !== '') {
    const sameSide = details.filter((d) => rowHasSide(d, side));
    if (sameSide.length === 1) return sameSide.map((d) => ({ name: d.name ?? '', role: d.role ?? '', firm: d.firm, roles: d.roles }));
  }
  // 4) 无法确定 → 空。
  return [];
}

/** 对方主体列表：对侧当事人，排除我方标记行。 */
export function theirPartyList(c: PartyOwnerInput): PartyDisplayRow[] {
  const parties = c.parties ?? {};
  const ourSide = c.ourSide ?? parties.ourSide ?? '';
  const details = parties.details ?? [];
  const side = sideOfOurSide(ourSide);
  const opp = side === 'A' ? 'B' : side === 'B' ? 'A' : '';
  if (opp === '') return [];
  const ourNames = new Set(details.filter((d) => d.ourClient === true).map((d) => d.name ?? ''));
  const theirs = details.filter((d) => rowHasSide(d, opp) && !ourNames.has(d.name ?? ''));
  if (theirs.length > 0) return theirs.map((d) => ({ name: d.name ?? '', role: d.role ?? '', firm: d.firm, roles: d.roles }));
  const primary = oppositeRoleOf(ourSide);
  const fallback = side === 'A' ? parties.defendant : parties.plaintiff;
  return primary && fallback ? [{ name: fallback, role: primary }] : [];
}

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
