/**
 * 统一把 unknown 错误转成一句可读中文（各域历史上各写一份，这里收一个公共的）。
 * @param error - 任意抛出物（Error / 字符串 / 其它）。
 * @returns 一句不带堆栈的错误文案。
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}
