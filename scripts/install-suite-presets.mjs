#!/usr/bin/env node
/**
 * Install the AgentLex agent presets (诉讼管家 / 非诉管家) into
 * $DSH_HOME/.agent-presets/ so the system's agent-preset picker offers them.
 *
 * Reads each preset from this package's own `presets/` directory (shipped in
 * the npm tarball via the `files` field) and copies it into the harness-home
 * user preset root (idempotent).
 *
 * 失败提示：受限权限（EPERM/EACCES/EROFS）下给出可执行的补救命令，而不是仅
 * 静默 warning。作为 postinstall 运行时保持退出码 0，不中断插件安装。
 *
 * Usage: node scripts/install-suite-presets.mjs
 */
import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { syncShippedPreset } from '../lib/shared/preset-sync.js'

const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const userPresetRoot = join(home, '.agent-presets')
/** 本包根（scripts/ → 包根）。 */
const pkgRoot = fileURLToPath(new URL('../', import.meta.url))

/** Preset directory names shipped in this package's presets/. */
const PRESETS = ['litigation-manager', 'nonlitigation-manager']

const PERM_CODES = new Set(['EPERM', 'EACCES', 'EROFS', 'EINVAL'])

function isPermError(err) {
  return err && typeof err === 'object' && (PERM_CODES.has(err.code) || /permission denied|read-only|operation not permitted/i.test(String(err.message ?? '')))
}

/** 手动补救命令（postinstall 被跳过 / 权限失败时提示用户执行）。 */
function manualRemedy() {
  return `node ${fileURLToPath(import.meta.url)}`
}

let installed = 0
let failed = 0

for (const preset of PRESETS) {
  const src = join(pkgRoot, 'presets', preset)
  const dst = join(userPresetRoot, preset)
  try {
    // syncShippedPreset 会把 agent.cordis.yml 里的 name: 'dsh-legal-suite'
    // 改写为本包绝对入口 URL（agent 预设加载器解析不到裸包名，见
    // src/shared/preset-sync.ts），其余文件原样复制。
    await mkdir(dst, { recursive: true })
    await syncShippedPreset(src, dst)
    console.log(`[agentlex-suite] 预设已安装 → ${dst}`)
    installed++
  } catch (err) {
    failed++
    if (isPermError(err)) {
      console.error(
        `[agentlex-suite] 预设 ${preset} 安装失败：${err instanceof Error ? err.message : String(err)}` +
        `\n  原因：$DSH_HOME 下的 ${userPresetRoot} 不可写（常见于受限 sandbox / 普通权限）` +
        `\n  补救：在有权写该目录的终端手动执行一次：` +
        `\n        ${manualRemedy()}` +
        `\n  本脚本作为 postinstall 不会中断插件安装，但预设需手动补齐。`,
      )
    } else {
      console.error(`[agentlex-suite] 预设 ${preset} 安装失败（非权限问题）：${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

console.log('')
if (failed > 0) {
  console.error(`[agentlex-suite] ⚠ ${installed} 个预设已安装，${failed} 个失败`)
  console.error(`[agentlex-suite] 手动补齐：${manualRemedy()}`)
} else {
  console.log(`[agentlex-suite] ${installed} 个 agent 预设已安装 → ${userPresetRoot}`)
}