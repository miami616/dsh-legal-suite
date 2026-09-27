/**
 * dsh-legal-suite/moot-court — 面板 i18n 助手。
 *
 * 与 litigation/client/i18n.ts 同构：按 document.lang 选中字典（中/英），
 * 支持 {name} 占位插值；所有文案集中在 locales.ts。
 */
import { en, zh, type MootKey } from './locales.ts'

/** 插值参数。 */
export type TranslateValues = Record<string, string | number>

/** 当前字典（按文档语言在调用时选取）。 */
export function dictionary(): MootKey {
  const lang = typeof document !== 'undefined' ? document.documentElement.lang : 'zh'
  return lang.toLowerCase().startsWith('en') ? { ...en } : { ...zh }
}

/** 翻译一个 key，可带 {name} 插值。 */
export function tt(key: keyof MootKey, values?: TranslateValues): string {
  return t(dictionary(), key, values)
}

/** 在指定字典上插值；缺 key 时回退为 key 本身。 */
export function t(dict: MootKey, key: keyof MootKey, values?: TranslateValues): string {
  const template: string = dict[key] ?? String(key)
  if (!values) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  )
}

/** 把未知异常转成可展示的错误文案。 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
