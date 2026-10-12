#!/usr/bin/env node
/**
 * 文件级脱敏命令行（本机运行，不联网）。
 *
 * 用法：
 *   node scripts/redact-file.mjs <文件|目录> [选项]
 *
 * 选项：
 *   --scope <id>        归属：案件编号 / 项目 id（缺省 global = 全库词条）
 *   --mode <m>          reversible（默认，可还原）/ masked（对外单向）
 *   --out <path>        输出路径（单文件；默认同目录 <原名>.redacted<ext>）
 *   --restore           还原模式：把脱敏后的文件/文本换回真名
 *   --text              把脱敏（或还原）后的文本打到 stdout（便于喂模型/管道）
 *   --json              以 JSON 输出完整报告
 *   --data-dir <dir>    脱敏数据目录（默认 $DSH_HOME/agentlex/redact）
 *   --litigation-dir <dir>     诉讼词典源（默认 $DSH_HOME/agentlex/litigation）
 *   --nonlitigation-dir <dir>  非诉词典源（默认 $DSH_HOME/agentlex/nonlitigation）
 *
 * 产物：
 *   .docx → <原名>.redacted.docx（保格式）+ <原名>.redacted.txt（脱敏文本）
 *   .pdf/.txt/.md/图片 → <原名>.redacted.txt
 *   还原 → <原名>.restored.docx / <原名>.restored.txt
 *   目录 → 逐个文件处理（整卷对外提供）
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { stat } from 'node:fs/promises'
import { createRedactStore } from '../lib/domains/redact/store/redact-store.js'
import { runRedact, runRedactDirectory, runRestore } from '../lib/domains/redact/service.js'

function parseArgs(argv) {
  const options = { _: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!arg.startsWith('--')) { options._.push(arg); continue }
    const key = arg.slice(2)
    if (['restore', 'text', 'json'].includes(key)) { options[key] = true; continue }
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) throw new Error(`选项 --${key} 缺少值`)
    options[key] = value
    i += 1
  }
  return options
}

const opts = parseArgs(process.argv.slice(2))
if (opts._.length === 0) {
  console.error('用法：node scripts/redact-file.mjs <文件|目录> [--scope 2026-056] [--mode masked] [--restore] [--text] [--json]')
  process.exit(2)
}
const target = opts._[0]
const dshHome = process.env.DSH_HOME ?? join(homedir(), '.dsh')
const dataDir = opts['data-dir'] ?? process.env.DSH_AGENTLEX_REDACT_DIR ?? join(dshHome, 'agentlex', 'redact')
const dirs = {
  litigationDir: opts['litigation-dir'] ?? join(dshHome, 'agentlex', 'litigation'),
  nonlitigationDir: opts['nonlitigation-dir'] ?? join(dshHome, 'agentlex', 'nonlitigation'),
}
const store = createRedactStore(dataDir)
const deps = { store, dirs, dataDir }
const request = {
  scope: opts.scope,
  mode: opts.mode === 'masked' ? 'masked' : 'reversible',
  outPath: opts.out,
  path: target,
  includeText: true,
}

const info = await stat(target)
const result = opts.restore
  ? await runRestore(deps, request)
  : info.isDirectory()
    ? await runRedactDirectory(deps, { ...request, dir: target, path: undefined })
    : await runRedact(deps, request)

if (opts.json) {
  console.log(JSON.stringify(result, null, 2))
} else if (info.isDirectory() && !opts.restore) {
  console.log(`批量脱敏：${result.results.length} 个文件（scope=${result.scope}，mode=${result.mode}）`)
  for (const item of result.results) {
    if (item.error !== undefined) console.log(`  ✗ ${item.file} — ${item.error}`)
    else console.log(`  ✓ ${item.file} — 命中 ${item.hits} 处 → ${item.outPaths.join(' / ')}`)
  }
} else if (opts.restore) {
  console.log(`还原完成（scope=${result.scope}）：还原 ${result.restored} 处`)
  if (result.outPaths.length > 0) console.log(`产物：${result.outPaths.join(' / ')}`)
  if (result.missing.length > 0) console.log(`未还原（原文不在映射表里，需人工核对）：${result.missing.map((m) => `${m.alias}×${m.count}`).join('、')}`)
  if (result.ambiguous.length > 0) console.log(`歧义（一个假名对应多个原名，未硬猜）：${result.ambiguous.join('、')}`)
} else {
  const report = result.report
  console.log(`脱敏完成（scope=${result.scope}，mode=${result.mode}）：命中 ${report.totalHits} 处`)
  for (const stat of report.byKind) console.log(`  ${stat.label} ×${stat.count}  例：${stat.samples.join('、')}`)
  if (result.outPaths.length > 0) console.log(`产物：${result.outPaths.join('\n      ')}`)
  for (const note of result.notes ?? []) console.log(`说明：${note}`)
  if (report.candidates.length > 0) console.log(`候选（未替换，确认后可加入词条）：${report.candidates.map((c) => `${c.display}×${c.count}`).join('、')}`)
  for (const warning of report.warnings) console.log(`⚠ ${warning}`)
  console.log(`映射表：${result.mappingPath}${result.restorable ? '（可还原）' : '（对外单向，不可还原）'}`)
}
if (opts.text && typeof result.text === 'string') {
  process.stdout.write(`\n--- 文本 ---\n${result.text}\n`)
}
