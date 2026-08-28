/**
 * Shared panel helpers for dsh-legal-suite/ideas.
 */
import { en, zh, type IdeaKey } from './locales.ts'

export type TranslateValues = Record<string, string | number>

export function dictionary(): IdeaKey {
  const lang = typeof document !== 'undefined' ? document.documentElement.lang : 'zh'
  return lang.toLowerCase().startsWith('en') ? { ...en } : { ...zh }
}

export function tt(key: keyof IdeaKey, values?: TranslateValues): string {
  return t(dictionary(), key, values)
}

export function t(dict: IdeaKey, key: keyof IdeaKey, values?: TranslateValues): string {
  const template: string = dict[key] ?? String(key)
  if (!values) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  )
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
