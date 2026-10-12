/**
 * Shared preset-sync helpers — the fix for
 * "Agent 预设「诉讼管家 / 非诉管家」无法挂载（Cannot find package 'dsh-legal-suite'）".
 *
 * Why the rewrite exists:
 * - The HOST bundle loader resolves a plugin row like `agentlex: dsh-legal-suite`
 *   from the PROFILE root (`profiles/<name>/node_modules`), so the plugin itself
 *   loads fine.
 * - The AGENT-PRESET loader (the one that loads `.agent-presets/<id>/agent.cordis.yml`
 *   rows) resolves `name:` from the App install tree (`.../node_modules/@deepseek-ai/...`),
 *   which never contains the profile-installed `dsh-legal-suite`. A bare package
 *   name therefore fails with `Cannot find package 'dsh-legal-suite'`.
 * - The shipping presets are copied verbatim into `${DSH_HOME}/.agent-presets/`
 *   on every host apply, so hand-editing the copy is pointless — the fix must
 *   happen when the backup copy is written.
 *
 * Fix: when syncing a shipped preset, rewrite the agent-plugin row's
 * `name: dsh-legal-suite` (bare package name) to this package's OWN absolute
 * entry URL. A `file://` specifier does not depend on any loader base directory:
 * Node imports it by path, and the package's own dependencies resolve from its
 * real install location. The sync code runs inside the successfully-loaded host
 * bundle, so it can compute its own location via `import.meta.url` — no hardcoded
 * username/profile paths, and the result stays correct across machines and
 * upgrades (each apply re-syncs from the new install).
 *
 * This module is compiled to `lib/shared/preset-sync.js`; its own position
 * (up two levels) is always the package root, in both the src layout and the
 * built layout.
 */

import { cp, mkdir, readdir, rename, rm } from 'node:fs/promises'
import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { load as parseYaml } from 'js-yaml'

/** Bare package name used in the shipped presets' agent-plugin row. */
export const SUITE_PACKAGE_NAME = 'dsh-legal-suite'

/** The preset row we must rewrite: `name: 'dsh-legal-suite'` (any indent/quote). */
const AGENT_NAME_LINE = /(^.*name:\s*)(['"])dsh-legal-suite\2([ \t]*)$/m

/** Package root of dsh-legal-suite, derived from THIS module's own location. */
function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
}

/** Absolute file:// URL of this package's own entry (lib/index.js). */
export function suiteEntryUrl(): string {
  return pathToFileURL(join(packageRoot(), 'lib', 'index.js')).href
}

/** Single-quote a YAML scalar, doubling embedded quotes ('' escapes a quote). */
function yamlQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/**
 * 全局串行队列：suite.ts 的 ensureAgentPresets 与各域（litigation/nonlitigation）
 * 的 syncShippedPresets 是不同调用方、各自队列互不相干，会对同一 preset 目录
 * 并发 rm→cp，交错出 `ENOTEMPTY: rmdir`（issue:「非诉管家 agent 预设提示错误」）。
 * 把互斥下沉到本模块，所有调用方共享一条写队列。
 */
let presetWriteQueue: Promise<void> = Promise.resolve()
function serializePresetWrite<T>(task: () => Promise<T>): Promise<T> {
  const run = presetWriteQueue.then(task, task)
  presetWriteQueue = run.then(() => undefined, () => undefined)
  return run
}

/**
 * Rewrite the `name: 'dsh-legal-suite'` agent-plugin row to the package's own
 * absolute entry URL. Any other row (`@deepseek-ai/...`) is left untouched.
 * Idempotent: an already-URL'd row no longer matches and stays as-is.
 */
export function rewriteSuiteEntry(yml: string, entryUrl: string): string {
  return yml.replace(AGENT_NAME_LINE, (_match, lead: string, _quote: string, trail: string) => {
    return `${lead}${yamlQuote(entryUrl)}${trail}`
  })
}

/**
 * Copy a shipped preset directory into `${DSH_HOME}/.agent-presets/<id>`,
 * rewriting agent.cordis.yml's plugin row from the bare package name to the
 * package's own absolute entry URL (see module comment). Every other entry is
 * copied byte-for-byte. Runs inside the module-level serial queue so all
 * callers (suite + domains) can never interleave rm→cp into a half-written
 * preset (ENOTEMPTY race).
 */
export function syncShippedPreset(source: string, target: string): Promise<void> {
  return serializePresetWrite(async () => {
    await rm(target, { recursive: true, force: true })
    await mkdir(target, { recursive: true })
    const entryUrl = suiteEntryUrl()
    for (const entry of await readdir(source, { withFileTypes: true })) {
      const srcPath = join(source, entry.name)
      const dstPath = join(target, entry.name)
      if (entry.name === 'agent.cordis.yml' && entry.isFile()) {
        const text = await readFile(srcPath, 'utf8')
        await writeFile(dstPath, rewriteSuiteEntry(text, entryUrl), 'utf8')
      } else {
        await cp(srcPath, dstPath, { recursive: true, force: true })
      }
    }
  })
}

/* ───────────────── profile patch 模式（DSH 0.1.7 起） ───────────────── */

/**
 * 标记区块：写进 profile 的 `cordis.patch.yml`，由本插件在宿主 apply 时维护。
 * 区块外的一切内容原样保留；区块内内容每次 apply 重新渲染，逐字相同时不写盘。
 */
const BLOCK_START = '# >>> dsh-legal-suite agent presets（自动生成，请勿手改） >>>'
const BLOCK_END = '# <<< dsh-legal-suite agent presets <<<'

/** 同一进程内的临时文件序号：并发写入时不会共用同一个 tmp 文件名。 */
let temporarySeq = 0

/** 一个随包预设渲染成 patch 声明所需的输入。 */
interface PresetSource {
  readonly id: string
  readonly name?: string
  readonly description?: string
  readonly order?: number
  readonly pluginsYaml: string
}

/**
 * 从宿主上下文读取当前 profile 的 patch 文件路径。
 * DSH 0.1.7 起 `profileContext` 服务带 `patchPath`；0.1.6 及以前没有该服务
 * （那时预设只能走 `.agent-presets` 目录），此时返回 undefined 让调用方回退。
 * @param ctx - 宿主 Cordis 上下文（或任意带 get 的对象）。
 * @returns cordis.patch.yml 的绝对路径；取不到返回 undefined。
 */
export function profilePatchPath(ctx: unknown): string | undefined {
  const get = (ctx as { get?: (name: string) => unknown } | undefined)?.get
  if (typeof get !== 'function') return undefined
  const profile = get.call(ctx, 'profileContext')
  if (profile === null || typeof profile !== 'object') return undefined
  const path = (profile as { patchPath?: unknown }).patchPath
  return typeof path === 'string' && path !== '' ? path : undefined
}

/**
 * 读取 `presets/<id>/` 的元数据与子插件列表，并把入口行改写为本包绝对 URL。
 * @param id - 随包预设目录名。
 * @param entryUrl - 子插件行使用的本包入口 URL。
 * @returns 渲染 patch 声明所需的字段（preset.yml 缺失时以 id 兜底）。
 */
async function readPresetSource(id: string, entryUrl: string): Promise<PresetSource> {
  const dir = join(packageRoot(), 'presets', id)
  let meta: Record<string, unknown> = {}
  try {
    const parsed: unknown = parseYaml(await readFile(join(dir, 'preset.yml'), 'utf8'))
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      meta = parsed as Record<string, unknown>
    }
  } catch {
    // preset.yml 缺失或不可解析时只用 id 兜底：预设本身仍能挂载。
  }
  const pluginsYaml = rewriteSuiteEntry(await readFile(join(dir, 'agent.cordis.yml'), 'utf8'), entryUrl)
  return {
    id,
    ...(typeof meta.name === 'string' ? { name: meta.name } : {}),
    ...(typeof meta.description === 'string' ? { description: meta.description } : {}),
    ...(typeof meta.order === 'number' ? { order: meta.order } : {}),
    pluginsYaml,
  }
}

/**
 * 随包预设目录名（`presets/` 下的子目录），字母序稳定。
 *
 * 区块内容一律按「全集」渲染，而不是调用方传入的子集：suite 与各域会并发
 * 调用本模块，若各自只渲染自己的预设，后写的调用会把先写的区块覆盖掉
 * （实测后果：patch 里出现两个残缺区块）。
 * @returns 随包预设 id 列表；目录不可读时返回空数组。
 */
export async function shippedPresetIds(): Promise<string[]> {
  try {
    const entries = await readdir(join(packageRoot(), 'presets'), { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}

/**
 * 把若干随包预设渲染成 patch 的 insert 声明块（含首尾标记）。
 * @param presetIds - 要渲染的预设 id；省略时取 `presets/` 下的全集。
 * @param entryUrl - 子插件行使用的本包入口 URL；默认取当前安装位置。
 * @returns 可直接写进 profile patch 的 YAML 文本块。
 */
export async function renderPresetBlock(
  presetIds?: readonly string[],
  entryUrl: string = suiteEntryUrl(),
): Promise<string> {
  const ids = presetIds ?? (await shippedPresetIds())
  const lines: string[] = [
    BLOCK_START,
    '# 每个 preset 一条 @deepseek-ai/dsh-agent-preset 声明 —— DSH 0.1.7 起预设必须在组合里声明，',
    '# 不再从 $DSH_HOME/.agent-presets 目录自动发现。',
  ]
  for (const id of ids) {
    const source = await readPresetSource(id, entryUrl)
    lines.push('- insert:')
    lines.push(`    - id: preset-${source.id}`)
    lines.push("      name: '@deepseek-ai/dsh-agent-preset'")
    lines.push('      config:')
    lines.push(`        id: ${yamlQuote(source.id)}`)
    if (source.name !== undefined) lines.push(`        name: ${yamlQuote(source.name)}`)
    if (source.description !== undefined) lines.push(`        description: ${yamlQuote(source.description)}`)
    if (source.order !== undefined) lines.push(`        order: ${source.order}`)
    lines.push('        plugins:')
    for (const line of source.pluginsYaml.split('\n')) {
      lines.push(line.trim() === '' ? '' : `          ${line}`)
    }
  }
  lines.push(BLOCK_END)
  return lines.join('\n')
}

/** 从 YAML 文本里提取已声明的 preset id（`- id: preset-xxx`）。 */
function extractPresetIds(text: string): Set<string> {
  const ids = new Set<string>()
  const pattern = /- id:\s*preset-([A-Za-z0-9._-]+)/g
  let match = pattern.exec(text)
  while (match !== null) {
    if (match[1] !== undefined) ids.add(match[1])
    match = pattern.exec(text)
  }
  return ids
}

/**
 * 幂等写入 profile patch：替换标记区块（没有则追加到末尾）；托管区块之外已经
 * 声明过的 preset **绝不再声明第二次**（重复的 preset id 会让 registry 报警甚至
 * 拒绝挂载）—— 这类 id 直接从托管区块里剔除，全被外部声明时连区块一起移除。
 * 生成结果与现有文件逐字相同时**不写盘** —— patch 变动会触发 Loader 重载，
 * 每次启动都无脑重写会把热重载变成重启循环。
 * @param patchPath - profile 的 cordis.patch.yml 路径。
 * @param presetIds - 要声明的随包预设；省略时取 `presets/` 全集。
 * @returns 写入结果：'written' 已更新，'unchanged' 内容已是最新。
 */
export async function syncPresetsIntoProfilePatch(
  patchPath: string,
  presetIds?: readonly string[],
): Promise<'written' | 'unchanged'> {
  const all = presetIds ?? (await shippedPresetIds())
  let current = ''
  try {
    current = await readFile(patchPath, 'utf8')
  } catch {
    current = ''
  }
  const start = current.indexOf(BLOCK_START)
  const end = current.indexOf(BLOCK_END)
  const hasBlock = start >= 0 && end > start
  const outside = hasBlock ? current.slice(0, start) + current.slice(end + BLOCK_END.length) : current
  const declared = extractPresetIds(outside)
  const ids = all.filter((id) => !declared.has(id))
  let next: string
  if (ids.length === 0) {
    if (!hasBlock) return 'unchanged'
    next = current.slice(0, start) + current.slice(end + BLOCK_END.length)
    next = `${next.replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '')}\n`
    // 区块被整块摘掉后，若文件只剩注释/空行，补回空数组占位，避免组合期读到空文档。
    const meaningful = next.replace(/^[ \t]*#.*$/gm, '').trim()
    if (meaningful === '') next = `${next.replace(/\s+$/, '')}\n[]\n`
  } else {
    const block = await renderPresetBlock(ids)
    if (hasBlock) {
      const tail = current.slice(end + BLOCK_END.length).replace(/^\n/, '')
      next = current.slice(0, start) + block + (tail === '' ? '\n' : `\n${tail}`)
    } else {
      let head = current.replace(/\s+$/, '')
      // 新建 profile 的 patch 模板正文就是一行空数组 `[]`。它一旦被后面追加的
      // `- insert:` 块序列接上，YAML 解析器看到的是「第一个文档已结束、又来了
      // 第二个文档却没有 `---` 分隔符」，整个 profile 组合直接抛错、dsh 起不来
      // （实测：新 profile 首次启动正常，我们写入预设后第二次启动即失败）。
      // 按 dsh 既有约定把占位空数组注释掉，让后面的块序列成为文档唯一内容。
      head = head.replace(/^([ \t]*)\[\]([ \t]*)$/m, '$1# []$2')
      next = head === '' ? `${block}\n` : `${head}\n\n${block}\n`
    }
  }
  if (next === current) return 'unchanged'
  const temporary = `${patchPath}.agentlex-${String(process.pid)}-${String(temporarySeq++)}.tmp`
  await writeFile(temporary, next, 'utf8')
  await rename(temporary, patchPath)
  return 'written'
}

/**
 * 统一入口：有 profile patch（0.1.7+）就把**全部**随包预设声明写进去；否则回退到
 * 旧的 `${DSH_HOME}/.agent-presets` 目录（0.1.6 及以前只认目录）。
 *
 * 区块内容固定按 `presets/` 全集渲染，且整条写入路径串行化：suite 与各域会并发
 * 调用，交集渲染 + 并发 rename 会把 patch 写成两个残缺区块（实测踩到）。
 * @param patchPath - `profilePatchPath(ctx)` 的结果。
 * @param label - 日志前缀（如 agentlex-suite）。
 * @returns 实际使用的通道。
 */
export async function installShippedPresets(
  patchPath: string | undefined,
  label: string,
): Promise<'patch' | 'directory'> {
  const ids = await shippedPresetIds()
  if (ids.length === 0) {
    console.warn(`[${label}] 随包预设目录为空，跳过 preset 安装`)
    return 'directory'
  }
  if (patchPath !== undefined) {
    const result = await serializePresetWrite(() => syncPresetsIntoProfilePatch(patchPath, ids))
    const verb = result === 'written' ? 'declared in' : 'already declared in'
    console.log(`[${label}] ${String(ids.length)} agent preset(s) ${verb} ${patchPath}`)
    return 'patch'
  }
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const root = join(home, '.agent-presets')
  await serializePresetWrite(async () => {
    for (const id of ids) {
      await syncShippedPreset(join(packageRoot(), 'presets', id), join(root, id))
    }
  })
  console.log(`[${label}] ${String(ids.length)} agent preset(s) ready in ${root}`)
  return 'directory'
}