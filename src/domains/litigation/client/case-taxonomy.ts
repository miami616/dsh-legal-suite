/**
 * Case taxonomy — the 7 canonical types (2026-08 AgentLex convergence) plus
 * alias normalization. Colors match AgentLex CASE_TYPE_DEFS.
 */

export interface CaseTypeDef {
  key: string
  label: string
  dot: string
}

/** The 7 canonical case types, in display order. */
export const CASE_TYPE_DEFS: CaseTypeDef[] = [
  { key: '民商', label: '民商', dot: '#4a7ab5' },
  { key: '刑事', label: '刑事', dot: '#a34a4a' },
  { key: '行政', label: '行政', dot: '#8a7037' },
  { key: '劳动争议', label: '劳动争议', dot: '#3a7d6b' },
  { key: '知识产权', label: '知识产权', dot: '#8f5a8a' },
  { key: '执行', label: '执行', dot: '#2d7d5e' },
  { key: '其他', label: '其他', dot: '#a69a90' },
]

/** Filter chips: 全部 + the 6 (all) canonical types. */
export const CASE_TYPES: (CaseTypeDef & { key: string })[] = [
  { key: '__all', label: '全部', dot: '' },
  ...CASE_TYPE_DEFS,
]

const CANONICAL = new Set(CASE_TYPE_DEFS.map((d) => d.key))

/** Legacy/agent-written variants → canonical label. */
const TYPE_ALIASES: Record<string, string> = {
  '民商': '民商', '民事': '民商', '商事': '民商', '民商事': '民商', '民事诉讼': '民商',
  '民事纠纷': '民商', '商事争议': '民商', '刑事辩护': '刑事', '刑事附带民事': '刑事',
  '行政诉讼': '行政', '劳动争议': '劳动争议', '劳动纠纷': '劳动争议', '劳动仲裁': '劳动争议',
  '知识产权纠纷': '知识产权', '商事仲裁': '民商', '仲裁': '民商', '执行异议': '执行',
  '破产': '民商', '破产清算': '民商',
}

/** Map any stored value to a canonical type label; empty/unrecognized → 其他. */
export function normalizeCaseType(type: string | number | undefined | null): string {
  if (type === undefined || type === null || type === '') return '其他'
  const trimmed = String(type).trim()
  if (CANONICAL.has(trimmed)) return trimmed
  if (TYPE_ALIASES[trimmed]) return TYPE_ALIASES[trimmed]
  // 劳动争议 fuzzy: contains 劳动 or 仲裁+非商事 → 劳动争议
  if (/劳动/.test(trimmed)) return '劳动争议'
  if (/仲裁/.test(trimmed) && !/商事/.test(trimmed)) return '劳动争议'
  return '其他'
}

/** The dot color for a (possibly non-canonical) type string. */
export function getCaseTypeDot(type: string | number | undefined | null): string {
  const canonical = normalizeCaseType(type)
  return CASE_TYPE_DEFS.find((d) => d.key === canonical)?.dot ?? '#a69a90'
}

/** The canonical label for display. */
export function getCaseTypeLabel(type: string | number | undefined | null): string {
  return normalizeCaseType(type)
}

/** Case causes (案由) keyed by canonical type label, for the registration form. */
export const CASE_CAUSES: Record<string, string[]> = {
  '民商': ['合同纠纷', '侵权纠纷', '婚姻家庭', '继承纠纷', '民间借贷', '物权纠纷', '人格权纠纷', '公司纠纷', '金融纠纷', '股权纠纷', '保险纠纷', '票据纠纷', '建设工程', '其他民商'],
  '刑事': ['危害公共安全', '破坏市场经济秩序', '侵犯人身权利', '侵犯财产', '妨害社会管理', '贪污贿赂', '渎职', '其他刑事'],
  '行政': ['行政处罚', '行政强制', '行政许可', '行政征收', '信息公开', '其他行政'],
  '劳动争议': ['劳动报酬', '社会保险', '经济补偿', '劳动合同', '其他劳动争议'],
  '知识产权': ['著作权', '商标权', '专利权', '不正当竞争', '其他知识产权'],
  '执行': ['金钱给付', '行为履行', '财产执行', '恢复执行', '执行异议', '其他执行'],
  '其他': ['其他'],
}
