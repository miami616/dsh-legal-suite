/**
 * 运行中插件版本的唯一可信来源。
 *
 * 模块首次被加载时读取「本包安装目录」的 package.json 并缓存：进程跑的是哪份
 * 代码，加载时读到的就是哪份 manifest，因此该值始终等于当前运行中的版本——
 * 插件更新落盘后需重启 DSH 才生效，而重启会重新加载本模块，显示随之自动跟随，
 * 全程无需任何手动同步。（构建期 define 的 __PLUGIN_VERSION__ 仅作为客户端在
 * self-version 接口不可用时的兜底。）
 */
import { readFileSync } from 'node:fs'

let cached: string | undefined

/** 当前运行版本；读取失败返回空串（调用方自行回退）。 */
export function selfVersion(): string {
  if (cached === undefined) {
    try {
      // lib/domains/litigation/self-version.js → 向上三级即包根
      const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { version?: unknown }
      cached = typeof pkg.version === 'string' ? pkg.version : ''
    } catch {
      cached = ''
    }
  }
  return cached
}
