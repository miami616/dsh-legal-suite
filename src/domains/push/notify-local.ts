/**
 * 本地兜底通知（macOS 通知中心）——飞书推送失败时的最后一道可见性。
 *
 * 为什么需要：期限提醒是「无人值守」链路，飞书 token 过期、网络断开、应用被删
 * 都会让卡片发不出去。原实现只在 console.warn 里留一行，用户完全不知道今天
 * 的提醒没来——对法定期限而言这是不可接受的静默失败。
 *
 * 约束：
 *  - 只在 macOS 上启用（`osascript`）；其他平台直接返回 false；
 *  - **只传数量，不传案件名/当事人**，避免通知中心泄露敏感信息；
 *  - best-effort：任何失败都吞掉并返回 false，绝不影响主流程。
 */

import { execFile } from 'node:child_process'

/** osascript 转义：去掉换行与双引号，避免 AppleScript 注入。 */
function sanitize(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/[\r\n]+/g, ' ')
    .replace(/"/g, '\\"')
    .slice(0, 180)
}

/**
 * 弹一条 macOS 通知。
 * @param title - 通知标题（不含案件信息）。
 * @param body - 通知正文（只放数量/操作提示）。
 * @returns 是否成功派发（不代表用户看到）。
 */
export async function notifyLocal(title: string, body: string): Promise<boolean> {
  if (process.platform !== 'darwin') return false
  const script = `display notification "${sanitize(body)}" with title "${sanitize(title)}"`
  return await new Promise<boolean>((resolve) => {
    execFile('osascript', ['-e', script], { timeout: 10_000 }, (error) => {
      if (error !== null) {
        console.warn('[agentlex-push] 本地通知失败:', error.message)
        resolve(false)
        return
      }
      resolve(true)
    })
  })
}
