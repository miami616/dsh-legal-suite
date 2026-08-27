export const SUPPORTED_LOCALES = ['zh-CN', 'en-US'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

export const UI_LANGUAGE_OPTIONS = ['system', ...SUPPORTED_LOCALES] as const;
export type UiLanguage = (typeof UI_LANGUAGE_OPTIONS)[number];

const SUPPORTED_LOCALE_SET = new Set<string>(SUPPORTED_LOCALES);
const UI_LANGUAGE_SET = new Set<string>(UI_LANGUAGE_OPTIONS);

function normalizeLocaleToken(value: string): string {
  return value.trim().replace(/_/g, '-');
}

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === 'string' && SUPPORTED_LOCALE_SET.has(value);
}

export function isUiLanguage(value: unknown): value is UiLanguage {
  return typeof value === 'string' && UI_LANGUAGE_SET.has(value);
}

export function normalizeUiLanguage(value: unknown): UiLanguage {
  if (isUiLanguage(value)) return value;
  return 'system';
}

export function resolveSupportedLocale(locale: string | null | undefined): SupportedLocale {
  if (!locale) return 'en-US';
  const normalized = normalizeLocaleToken(locale).toLowerCase();
  if (normalized === 'zh' || normalized.startsWith('zh-')) return 'zh-CN';
  return 'en-US';
}

export function resolveEffectiveLocale(
  uiLanguage: unknown,
  systemLocale?: string | null,
): SupportedLocale {
  const normalized = normalizeUiLanguage(uiLanguage);
  if (normalized !== 'system') return normalized;
  return resolveSupportedLocale(systemLocale);
}
