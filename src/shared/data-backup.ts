/**
 * dsh-legal-suite/shared — 数据目录快照拷贝（备份专用）。
 *
 * 数据落盘走两套原子手法：`写 <file>.tmp-<pid>-<rand> + rename` 与
 * `mkdir <file>.lock`（目录锁）。备份是「对着活目录递归拷贝」，这些中间态文件/
 * 目录随时可能在扫描之后、拷贝之前被删掉——Node 的 `cp` 一旦撞上就以
 * `lstat ENOENT` 中断整次备份（实测冷启动播种时必现，日志里一串
 * `[agentlex-*] backup failed`，备份目录整个缺失）。
 *
 * 处理：① 把中间态排除在拷贝之外（备份只应包含落定后的正式文件）；
 * ② 万一仍在窗口内撞上竞态（过滤与实际拷贝之间还有时间差），短暂等待后重试，
 * 最多三次——备份失败不该打断启动，但也不该一直失败。
 */
import { cp } from 'node:fs/promises'

/** 中间态命名：`<file>.tmp-<pid>-<rand>` 与 `<file>.lock`（mkdir 原子锁目录）。 */
const TRANSIENT = /(?:\.tmp-[^/]*|\.lock)$/

/**
 * 把数据目录拷贝成一份备份快照。
 * @param source - 数据目录（可能在备份期间被并发改写）。
 * @param target - 备份目标目录（时间戳目录，通常为空）。
 * @param attempts - 撞上文件消失竞态时的最大尝试次数。
 */
export async function copyDataDirForBackup(source: string, target: string, attempts = 3): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await cp(source, target, {
        recursive: true,
        force: true,
        filter: (entry) => !TRANSIENT.test(entry),
      })
      return
    } catch (error) {
      lastError = error
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
  }
  throw lastError
}
