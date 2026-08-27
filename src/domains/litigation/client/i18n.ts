/**
 * Shared panel helpers: the active-dictionary pick (document-language based,
 * task-board precedent) plus a small interpolator. All copy stays in the
 * locale dictionaries (locales.ts).
 */
import { en, zh, type LitigationKey } from './locales.ts'

/** Template values accepted by the interpolator. */
export type TranslateValues = Record<string, string | number>

/** Active dictionary, picked by the document language at call time. */
export function dictionary(): LitigationKey {
  const lang = typeof document !== 'undefined' ? document.documentElement.lang : 'zh'
  return lang.toLowerCase().startsWith('en') ? { ...en } : { ...zh }
}

/** Translate a key with optional {name} template params (current language). */
export function tt(key: keyof LitigationKey, values?: TranslateValues): string {
  return t(dictionary(), key, values)
}

/** Interpolate {name} placeholders; unknown key falls back to the key itself. */
export function t(dict: LitigationKey, key: keyof LitigationKey, values?: TranslateValues): string {
  const template: string = dict[key] ?? String(key)
  if (!values) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  )
}

/** Human-readable error text from an unknown thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
