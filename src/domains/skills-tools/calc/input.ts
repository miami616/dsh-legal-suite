/**
 * 律师小工具 — 输入读取工具（把 unknown 安全收敛为标量）。
 */
import { parseAmount } from './money.ts'

export function str(input: Record<string, unknown>, key: string, fallback = ''): string {
  const value = input[key]
  if (value === undefined || value === null) return fallback
  const text = String(value).trim()
  return text === '' ? fallback : text
}

export function num(input: Record<string, unknown>, key: string, fallback = 0): number {
  const value = input[key]
  if (value === undefined || value === null || value === '') return fallback
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(/[,\s]/g, ''))
  return Number.isFinite(parsed) ? parsed : fallback
}

/** 金额（支持「100万」等写法）。 */
export function money(input: Record<string, unknown>, key: string, fallback = 0): number {
  const parsed = parseAmount(input[key])
  return parsed === null ? fallback : parsed
}

export function bool(input: Record<string, unknown>, key: string, fallback = false): boolean {
  const value = input[key]
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'boolean') return value
  const text = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on', '是'].includes(text)) return true
  if (['0', 'false', 'no', 'off', '否'].includes(text)) return false
  return fallback
}

export function oneOf<T extends string>(input: Record<string, unknown>, key: string, options: readonly T[], fallback: T): T {
  const text = str(input, key)
  return (options as readonly string[]).includes(text) ? (text as T) : fallback
}
