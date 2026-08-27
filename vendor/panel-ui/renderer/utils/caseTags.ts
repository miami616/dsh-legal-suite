/**
 * caseTags — categorized preset tags for the case / project modules.
 *
 * Tags stay a flat `string[]` on disk (agent-compatible — `case update --record`
 * writes plain strings). This module only enriches the UI: a curated preset
 * palette grouped by category (quick-add in TagInput), per-category chip colors,
 * and category-grouped filtering. Unknown/user tags fall back to 自定义.
 */

export interface TagCategory {
  key: string;
  label: string;
  color: string; // badge classes
}

export const TAG_CATEGORIES: TagCategory[] = [
  { key: 'client', label: '客户', color: 'bg-blue-50 text-blue-700' },
  { key: 'nature', label: '案件性质', color: 'bg-purple-50 text-purple-700' },
  { key: 'stage', label: '阶段特征', color: 'bg-amber-50 text-amber-700' },
  { key: 'priority', label: '优先级', color: 'bg-red-50 text-red-700' },
  { key: 'custom', label: '自定义', color: 'bg-[var(--paper-inset)] text-[var(--ink-muted)]' },
];

export interface TagPresetGroup {
  category: string; // key into TAG_CATEGORIES
  tags: string[];
}

/** Curated quick-add tags, grouped by category. */
export const TAG_PRESETS: TagPresetGroup[] = [
  { category: 'client', tags: ['高净值', '国企', '民企', '政府', '金融机构', '上市公司', '跨国公司', '个人'] },
  { category: 'nature', tags: ['系列案', '疑难复杂', '涉外', '标的额大', '集团诉讼', '新类型'] },
  { category: 'stage', tags: ['紧急', '异地', '需出差', '可能上诉', '待鉴定', '涉刑民交叉'] },
  { category: 'priority', tags: ['高优先', '普通', '低优先'] },
];

const TAG_TO_CATEGORY = new Map<string, string>();
for (const g of TAG_PRESETS) {
  for (const t of g.tags) TAG_TO_CATEGORY.set(t, g.category);
}

/** Resolve a tag to its category key. Unknown → 'custom'. */
export function tagCategoryOf(tag: string): string {
  return TAG_TO_CATEGORY.get(tag.trim()) ?? 'custom';
}

const CATEGORY_LABEL = new Map(TAG_CATEGORIES.map(c => [c.key, c.label]));
const CATEGORY_COLOR = new Map(TAG_CATEGORIES.map(c => [c.key, c.color]));

export function getTagCategoryLabel(key: string): string {
  return CATEGORY_LABEL.get(key) ?? '自定义';
}

/** Badge classes for a tag, colored by its category. Unknown → 自定义 neutral. */
export function getTagColor(tag: string): string {
  return CATEGORY_COLOR.get(tagCategoryOf(tag)) ?? CATEGORY_COLOR.get('custom')!;
}
