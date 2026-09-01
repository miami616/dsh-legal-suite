/**
 * Plugin self-updater for the stand-alone suite package.
 *
 * The suite ships as ONE npm package (`dsh-legal-suite`) published to the
 * public npm registry. This module lets the settings panel check for the
 * latest published version and upgrade the installed package in the active
 * DSH profile via pnpm (the real upgrade path: download/verify/install is
 * delegated to the package manager, never hand-written file surgery).
 *
 * Install layout notes:
 * - The package is installed under `<profile>/node_modules/dsh-legal-suite`.
 * - `installedDir()` resolves that directory from the running module location,
 *   independent of how the profile was booted (plain pnpm install, DSH market,
 *   or this updater itself).
 * - Updates write the bumped version into the profile package.json
 *   dependencies so a later routine `pnpm install` cannot silently prune the
 *   package (no extraneous trees / no lockfile drift).
 *
 * A successful update requires a DSH restart to take effect (host and browser
 * halves are loaded at boot).
 */
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** The single package this updater manages. */
export const SUITE_PKG = 'dsh-legal-suite'
/** Public registry the suite is published to. */
const REGISTRY = 'https://registry.npmjs.org'
const USER_AGENT = 'agentlex-suite-updater/1.0'
const PKG_NAME_RE = /^dsh-[a-z0-9-]+$/
const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/

/* ─────────────────────── update progress state ─────────────────────── */

export type UpdatePhase = 'idle' | 'checking' | 'installing' | 'done' | 'error'

export interface UpdateProgress {
  running: boolean
  phase: UpdatePhase
  /** 当前更新目标包。 */
  pkg?: string
  /** 目标版本。 */
  to?: string
  /** 当前已安装版本。 */
  from?: string
  /** 进度展示文案。 */
  message?: string
  /** 多步更新时的步序（当前包序号）。 */
  stepIndex?: number
  /** 多步更新总步数。 */
  stepCount?: number
  /** 失败原因（phase=error 时）。 */
  error?: string
}

let progress: UpdateProgress = { running: false, phase: 'idle' }
let activeAbort: AbortController | undefined

function setProgress(patch: Partial<UpdateProgress>): void {
  progress = { ...progress, ...patch }
}

/** Snapshot for the settings-panel polling. */
export function updateProgressSnapshot(): UpdateProgress {
  return { ...progress }
}

/** Cancel the in-flight update run (kills the pnpm child). */
export function cancelUpdate(): boolean {
  activeAbort?.abort()
  const aborted = activeAbort !== undefined
  setProgress({ running: false, phase: 'error', error: '更新已取消' })
  return aborted
}

export function resetProgress(): void {
  progress = { running: false, phase: 'idle' }
}

/* ───────────────────────── version helpers ────────────────────────── */

export function parseVersion(value: string): [number, number, number] | null {
  const m = VERSION_RE.exec(value)
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) return 0
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1
  }
  return 0
}

/* ─────────────────────── install-location helpers ──────────────────── */

/** The installed package root: lib/domains/litigation → package root. */
export function litigationPackageRoot(): string {
  return resolveUp(3) // lib/domains/<domain>/updater.js
}

function resolveUp(steps: number): string {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < steps; i++) dir = dirname(dir)
  return dir
}

/** Harness home (profiles live under <home>/profiles/<name>). */
function dshHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

/**
 * The module root of the PROFILE this package is installed under, derived
 * from the running module location: <home>/profiles/<name>/node_modules.
 *
 * pkgRoot is the package root (either the hoisted symlink view
 * `…/profiles/<name>/node_modules/dsh-legal-suite` or its realpath inside
 * `.pnpm/…`); truncating at the first `node_modules/` segment yields the
 * profile root either way. Falls back to env override, then to the
 * conventional `web` profile (historical default).
 */
export function modulesRoot(): string {
  const pkgRoot = litigationPackageRoot()
  const nmMark = pkgRoot.indexOf(`${sep}node_modules${sep}`)
  if (nmMark >= 0) {
    const profileRoot = pkgRoot.slice(0, nmMark)
    if (profileRoot !== '' && existsSync(join(profileRoot, 'package.json'))) {
      return join(profileRoot, 'node_modules')
    }
  }
  const envRoot = process.env.DSH_MODULES_ROOT
  if (envRoot !== undefined && envRoot !== '') return envRoot
  return join(dshHome(), 'profiles', 'web', 'node_modules')
}

/** The profile directory (parent of node_modules). */
export function profileDir(): string {
  return dirname(modulesRoot())
}

/** Installed directory for one package inside the current profile. */
export function installedDir(pkg: string): string {
  return join(modulesRoot(), pkg)
}

function assertInsideModulesRoot(target: string): void {
  const root = modulesRoot()
  const rel = target.startsWith(root) ? target.slice(root.length) : target
  if (rel.startsWith('..') || rel.includes(`..${'/'}`)) {
    throw new Error(`拒绝更新 modulesRoot 之外的路径：${target}`)
  }
}

/** Read the installed version of a package (undefined when missing). */
export async function readInstalledVersion(pkg: string): Promise<string | undefined> {
  try {
    const json = JSON.parse(await readFile(join(installedDir(pkg), 'package.json'), 'utf8')) as { version?: unknown }
    return typeof json.version === 'string' ? json.version : undefined
  } catch {
    return undefined
  }
}

/** Installed versions for a set of packages. */
export async function installedVersions(targets: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const pkg of targets) {
    const v = await readInstalledVersion(pkg)
    if (v !== undefined) out[pkg] = v
  }
  return out
}

/** The suite's per-profile data directory (agentlex/ under DSH home). */
export function suiteDataRoot(): string {
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'agentlex')
}

/* ────────────────────────── registry metadata ──────────────────────── */

export interface RegistryMetadata {
  'dist-tags'?: Record<string, string>
  versions?: Record<string, { dist?: { tarball?: string }; dependencies?: Record<string, string> }>
  time?: Record<string, string>
}

/** Fetch public npm registry metadata; undefined on network failure. */
export async function registryMetadata(pkg: string): Promise<RegistryMetadata | undefined> {
  if (!PKG_NAME_RE.test(pkg)) return undefined
  try {
    const res = await fetch(`${REGISTRY}/${encodeURIComponent(pkg)}`, {
      headers: { accept: 'application/vnd.npm.install-v1+json', 'user-agent': USER_AGENT },
    })
    if (!res.ok) return undefined
    return await res.json() as RegistryMetadata
  } catch (error) {
    console.warn(`[agentlex-litigation] registry metadata failed (${pkg}):`, error)
    return undefined
  }
}

/* ─────────────────────────── package labels ────────────────────────── */

const PACKAGE_LABELS: Record<string, string> = {
  'dsh-legal-suite': '法律套件（AgentLex Legal Suite）',
}

/** Public label used by both halves. */
export function packageLabel(pkg: string): string {
  return PACKAGE_LABELS[pkg] ?? pkg
}

/* ───────────────────────── profile wiring state ────────────────────── */

/** Profile manifest's dsh.profile.bundles list (empty when unreadable). */
export async function readProfileBundles(): Promise<string[]> {
  try {
    const json = JSON.parse(await readFile(join(profileDir(), 'package.json'), 'utf8')) as {
      dsh?: { profile?: { bundles?: unknown } }
    }
    const bundles = json.dsh?.profile?.bundles
    return Array.isArray(bundles) ? bundles.filter((b): b is string => typeof b === 'string') : []
  } catch {
    return []
  }
}

/** The profile manifest's declared dependency spec for the suite (undefined when absent). */
export async function readProfileDependency(pkg: string): Promise<string | undefined> {
  try {
    const json = JSON.parse(await readFile(join(profileDir(), 'package.json'), 'utf8')) as {
      dependencies?: Record<string, unknown>
    }
    const raw = json.dependencies?.[pkg]
    return typeof raw === 'string' ? raw : undefined
  } catch {
    return undefined
  }
}

/**
 * Start-chain wiring state: whether the suite is listed in the profile's
 * dsh.profile.bundles (loaded by cordis at boot) vs merely installed.
 */
export async function suiteLoadState(targets: string[]): Promise<Record<string, SuiteLoadState>> {
  const bundles = await readProfileBundles()
  const wired = bundles.includes(SUITE_PKG)
  const out: Record<string, SuiteLoadState> = {}
  for (const pkg of targets) {
    if ((await readInstalledVersion(pkg)) === undefined) {
      out[pkg] = 'missing'
    } else {
      out[pkg] = wired ? 'enabled' : 'installed'
    }
  }
  return out
}

/* ────────────────────────── version check ──────────────────────────── */

/** One pending update triple. */
export interface PackageUpdate {
  pkg: string
  label: string
  from: string
  to: string
}

/** 成员加载状态：enabled=已接入启动链路（重启后 cordis 会加载）/ installed=已装未启用 / missing=未安装。 */
export type SuiteLoadState = 'enabled' | 'installed' | 'missing'

/** Result of a version check. */
export interface PluginVersionCheck {
  source: string
  /** 已安装版本（profile node_modules 实测）。 */
  installed: Record<string, string>
  /** registry 最新发布版本（仅列出已安装且有发布的包）。 */
  latest: Record<string, string>
  /** 最新版发布时间（registry time 字段），ISO 字符串。 */
  publishDate: Record<string, string>
  /** 启动链路接线状态。 */
  loadState: Record<string, SuiteLoadState>
  /** 需要更新的包列表（latest > installed）。 */
  updates: PackageUpdate[]
  /** 套件声明但未装配的成员（单包模型下恒为空）。 */
  unassembled: string[]
  updateAvailable: boolean
  /** 检测失败说明（如网络不通）；无则省略。 */
  error?: string
}

/** Check installed vs registry-latest for the suite package. */
export async function checkPluginUpdate(): Promise<PluginVersionCheck> {
  const targets = [SUITE_PKG]
  const installed = await installedVersions(targets)
  const loadState = await suiteLoadState(targets)
  const latest: Record<string, string> = {}
  const publishDate: Record<string, string> = {}
  const updates: PackageUpdate[] = []
  let error: string | undefined

  for (const pkg of targets) {
    const from = installed[pkg]
    const meta = await registryMetadata(pkg)
    const to = meta?.['dist-tags']?.latest
    if (to === undefined) {
      error = '无法读取 npm registry（请确认网络可访问 https://registry.npmjs.org）'
      continue
    }
    latest[pkg] = to
    const published = meta?.time?.[to]
    if (typeof published === 'string' && published !== '') publishDate[pkg] = published
    if (from === undefined || compareVersions(to, from) > 0) {
      updates.push({ pkg, label: packageLabel(pkg), from: from ?? '—', to })
    }
  }

  return {
    source: 'npmjs',
    installed,
    latest,
    publishDate,
    loadState,
    updates,
    unassembled: [],
    updateAvailable: updates.length > 0,
    ...(error !== undefined ? { error } : {}),
  }
}

/* ───────────────────────────── update ───────────────────────────── */

/** Result of an update run. */
export interface PluginUpdateResult {
  updated: PackageUpdate[]
  /** 已是最新、无需更新的包。 */
  skipped: string[]
  /** 失败的包与原因（单个失败不中断其余包）。 */
  errors: Array<{ pkg: string; error: string }>
  /** 已更新但未接入启动链路的成员（profile bundles 未列出套件）。 */
  notWired?: string[]
  /** 未装配的成员（单包模型下恒为空）。 */
  unassembled: string[]
  /** 因发布冷却（minimumReleaseAge）而预先写入豁免清单的 pkg@version。 */
  policyExcluded?: string[]
  /** 备份根目录（$DSH_HOME/agentlex-backups/plugin-update/<ts>/）。 */
  backupRoot?: string
  /** 已提升直接依赖版本的 profile package.json（绝对路径）。 */
  profilePackageJson?: string
  /** 宿主/浏览器代码在启动时加载，必须重启 DSH 才生效。 */
  restartRequired: boolean
}

/**
 * Install a version into the PROFILE via pnpm (download/verify/install is
 * delegated to the package manager — pnpm pulls the tarball from the public
 * registry with integrity verification, writes the dependency into the
 * profile package.json (caret) and refreshes pnpm-lock.yaml.
 *
 * Before installing, the current directory is backed up to
 * $DSH_HOME/agentlex-backups/plugin-update/<ts>/ so a failed pnpm run still
 * leaves a rollback copy; pnpm itself is transactional — a failed add leaves
 * the previous install untouched.
 */
async function installViaPnpm(pkg: string, to: string, signal?: AbortSignal): Promise<void> {
  const targetDir = installedDir(pkg)
  assertInsideModulesRoot(targetDir)

  // 1. 备份旧版本（先解析符号链接真实目标；备份失败即中止，保证可回滚）。
  const ts = Date.now()
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const backupRoot = join(home, 'agentlex-backups', 'plugin-update', String(ts))
  const backupPkgDir = join(backupRoot, pkg)
  setProgress({ phase: 'installing', pkg, to, message: `${packageLabel(pkg)} 备份旧版本…` })
  if (existsSync(targetDir)) {
    await mkdir(backupPkgDir, { recursive: true })
    const realSource = realpathSync(targetDir)
    await cp(realSource, backupPkgDir, { recursive: true })
  }

  // 2. 交给 pnpm 安装（registry 拉取 + 完整性校验 + 清单/lockfile 同步）。
  setProgress({ phase: 'installing', pkg, to, message: `${packageLabel(pkg)} 通过 pnpm 安装 @${to}…` })
  let result = await runPnpm(['add', '--config.node-linker=hoisted', `${pkg}@${to}`], profileDir(), signal)
  if (signal?.aborted) throw new Error('更新已取消')
  if (!result.ok) {
    // ③ 兜底：换 npm 安装（参考 dsh-bridge：npm 不经过 pnpm 的 minimumReleaseAge
    // 发布冷却，可在刚发布即更新；也能绕开其它 pnpm 供应链策略拦截）。仍失败则
    // 抛错（旧版本已备份）。
    console.warn(`[agentlex-litigation] pnpm install failed for ${pkg}@${to}; retrying via npm: ${result.output.slice(0, 200)}`)
    setProgress({ phase: 'installing', pkg, to, message: `${packageLabel(pkg)} pnpm 失败，改用 npm 安装 @${to}…` })
    const npmOk = await runNpmInstall(pkg, to, signal)
    if (npmOk) {
      console.log(`[agentlex-litigation] updated ${pkg} → ${to} via npm`)
      return
    }
    throw new Error(
      `安装失败：pnpm 与 npm 均失败（${result.output || '命令异常退出'}；旧版本已备份于 ${backupRoot}）`,
    )
  }
  console.log(`[agentlex-litigation] updated ${pkg} → ${to} via pnpm`)
}

/**
 * 用 npm 重试安装（`npm install <pkg>@<to> --save --save-exact --prefix <profileDir>`）。
 * 主要用途：绕开 pnpm 的 minimumReleaseAge 发布冷却（刚发布的版本可立即更新）。
 * 返回是否成功（npm 不写 profile 的 pnpm-workspace 策略，仅更新 node_modules 与
 * package.json 依赖声明）。
 */
function runNpmInstall(pkg: string, to: string, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const bin = process.platform === 'win32' ? 'npm.cmd' : 'npm'
    const child = spawn(bin, ['install', `${pkg}@${to}`, '--save', '--save-exact', '--prefix', profileDir()], {
      cwd: profileDir(),
      env: { ...process.env, CI: 'true', npm_config_audit: 'false', npm_config_fund: 'false' },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    })
    const chunks: Buffer[] = []
    let lastOutputAt = Date.now()
    const append = (chunk: Buffer): void => { chunks.push(chunk); lastOutputAt = Date.now() }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    const timer = setTimeout(() => child.kill(), INSTALL_TIMEOUT_MS)
    const watchdog = setInterval(() => {
      if (Date.now() - lastOutputAt > PNPM_SILENT_KILL_MS) child.kill()
    }, 15_000)
    const onAbort = (): void => { child.kill() }
    signal?.addEventListener('abort', onAbort, { once: true })
    const settle = (ok: boolean): void => {
      clearTimeout(timer)
      clearInterval(watchdog)
      signal?.removeEventListener('abort', onAbort)
      resolve(ok)
    }
    child.on('error', () => settle(false))
    child.on('close', (code) => {
      const output = Buffer.concat(chunks).toString('utf8').trim().slice(0, 500)
      if (output !== '') lastPnpmErrorOutput = output
      settle(code === 0)
    })
  })
}

/**
 * 单次 pnpm 调用的整体超时（下载 + 安装）。
 *
 * 实测（pnpm 10.34.5 + 空 store 全量下载）冷安装存在超过 60s 的静默窗口
 * （首个 tarball 建立连接 + 下载完成前 pnpm 不刷新进度行）。旧值会把这个
 * 正常的慢速下载误判为挂死，因此放宽：总超时 300s，静默窗口 180s。
 */
const INSTALL_TIMEOUT_MS = 300 * 1000
const PNPM_SILENT_KILL_MS = 180 * 1000
/** pnpm 单次 registry 请求超时（默认 60s 对慢网络过紧，会静默重试加剧卡顿）。 */
const PNPM_FETCH_TIMEOUT_MS = 180 * 1000

/**
 * Run one pnpm subprocess against the profile directory. No TTY → CI mode so
 * pnpm never aborts on the "remove modules directory" confirmation prompt;
 * output tail is collected for the progress panel; abort (cancel) kills the
 * child; overall timeout + no-output watchdog apply.
 */
function runPnpm(args: string[], dir: string, signal?: AbortSignal): Promise<{ ok: boolean; output: string }> {
  return new Promise((resolve) => {
    const bin = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
    const child = spawn(bin, args, {
      cwd: dir,
      env: {
        ...process.env,
        CI: 'true',
        npm_config_confirm_modules_purge: 'false',
        npm_config_node_linker: 'hoisted',
        npm_config_fetch_timeout: String(PNPM_FETCH_TIMEOUT_MS),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    })
    const chunks: Buffer[] = []
    let size = 0
    let lastOutputAt = Date.now()
    const append = (chunk: Buffer): void => {
      if (size >= 4096) return
      chunks.push(chunk.subarray(0, 4096 - size))
      size += chunks[chunks.length - 1].length
      lastOutputAt = Date.now()
    }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    const timer = setTimeout(() => child.kill(), INSTALL_TIMEOUT_MS)
    const watchdog = setInterval(() => {
      if (Date.now() - lastOutputAt > PNPM_SILENT_KILL_MS) child.kill()
    }, 15_000)
    const onAbort = (): void => { child.kill() }
    signal?.addEventListener('abort', onAbort, { once: true })
    const settle = (ok: boolean, output: string): void => {
      clearTimeout(timer)
      clearInterval(watchdog)
      signal?.removeEventListener('abort', onAbort)
      if (!ok) lastPnpmErrorOutput = output
      resolve({ ok, output })
    }
    child.on('error', (error) => {
      settle(false, `pnpm 启动失败：${error.message}（请确认 PATH 中可用 pnpm，或手动执行安装）`)
    })
    child.on('close', (code) => {
      const output = Buffer.concat(chunks).toString('utf8').trim().slice(0, 2000)
      if (code === null) {
        const hint = signal?.aborted ? '更新已取消' : 'pnpm 长时间无输出（可能网络不可达），已中止'
        settle(false, `${hint}${output !== '' ? ` · 最后输出：${output.slice(0, 300)}` : ''}`)
        return
      }
      settle(code === 0, output)
    })
  })
}

/** Serialize update runs (multi-apply reloads must not interleave). */
let updateQueue: Promise<unknown> = Promise.resolve()

/** 最近一次 pnpm 失败输出（供「一键修复供应链策略」解析被拦包）。 */
let lastPnpmErrorOutput = ''

/**
 * Perform the update for the suite package (optionally limited by pkgFilter).
 * Changed package: backup → pnpm add（registry 拉取 + 完整性校验 + 清单/
 * lockfile 同步，由 pnpm 完成真正升级，不再手写覆盖 node_modules）。
 */
export function performPluginUpdate(pkgFilter?: string): Promise<PluginUpdateResult> {
  const run = async (): Promise<PluginUpdateResult> => {
    const result: PluginUpdateResult = { updated: [], skipped: [], errors: [], unassembled: [], restartRequired: true }

    resetProgress()
    const controller = new AbortController()
    activeAbort = controller
    setProgress({ running: true, phase: 'checking', stepIndex: 0, message: '正在检查更新…' })

    try {
      const targets = [SUITE_PKG].filter((pkg) => pkgFilter === undefined || pkg === pkgFilter)
      const installed = await installedVersions(targets)
      setProgress({ stepCount: targets.length })
      let step = 0

      for (const pkg of targets) {
        if (controller.signal.aborted) {
          result.errors.push({ pkg: '*', error: '更新已取消' })
          break
        }
        step += 1
        setProgress({ stepIndex: step, message: `${packageLabel(pkg)} 检查中…` })
        const from = installed[pkg]
        const meta = await registryMetadata(pkg)
        const to = meta?.['dist-tags']?.latest
        if (to === undefined) {
          result.errors.push({ pkg, error: 'registry 元数据不可用（网络问题）' })
          continue
        }
        if (from !== undefined && compareVersions(to, from) <= 0) {
          result.skipped.push(pkg)
          continue
        }
        // 开发/链接安装（link: 工作区、file: vendor）不做自动更新：pnpm add 会
        // 把链接依赖替换成 registry 版本，破坏开发装配，直接跳过并提示。
        const depEntry = await readProfileDependency(pkg)
        if (depEntry !== undefined && (depEntry.startsWith('link:') || depEntry.startsWith('file:'))) {
          result.errors.push({ pkg, error: '当前以 link:/file: 方式安装（开发/内嵌装配），跳过自动更新以避免破坏链接' })
          continue
        }
        // 第一方发布免冷却：先把目标版本写进 minimumReleaseAgeExclude，否则刚
        // 发布的版本会被供应链策略拦截（安装失败，或重启时锁文件校验失败回滚）。
        try {
          const policy = await addMinimumReleaseAgeExcludes([`${pkg}@${to}`])
          if (policy.ok && policy.added.length > 0) {
            ;(result.policyExcluded ??= []).push(...policy.added)
          }
        } catch {
          /* 豁免写入失败不阻塞更新；若策略随后拦截，走 installViaPnpm 错误路径 */
        }
        setProgress({ pkg, from: from ?? '—', to, message: `${packageLabel(pkg)} ${from ?? '未安装'} → ${to}` })
        try {
          await installViaPnpm(pkg, to, controller.signal)
          result.updated.push({ pkg, label: packageLabel(pkg), from: from ?? '—', to })
        } catch (error) {
          result.errors.push({ pkg, error: error instanceof Error ? error.message : String(error) })
        }
      }
    } finally {
      activeAbort = undefined
    }

    // 提升 profile 直接依赖：更新后的版本写入直接依赖（缺失则补 ^x.y.z，
    // 保留原 caret 风格），使后续 pnpm/npm install 保持新版本、且不会把更新器
    // 落盘安装的目录当作 extraneous 剪除。
    if (result.updated.length > 0) {
      try {
        const profilePkgPath = join(profileDir(), 'package.json')
        const json = JSON.parse(await readFile(profilePkgPath, 'utf8')) as {
          dependencies?: Record<string, unknown>
        }
        const deps = (json.dependencies ??= {})
        let changed = false
        for (const u of result.updated) {
          const raw = deps[u.pkg]
          // 开发 profile 用 link: 指向工作区，不动它；其余按 caret 风格提升。
          if (typeof raw === 'string' && raw.startsWith('link:')) continue
          const caret = raw === undefined ? '^' : (typeof raw === 'string' && raw.startsWith('^') ? '^' : '')
          deps[u.pkg] = `${caret}${u.to}`
          changed = true
        }
        if (changed) {
          await writeFile(profilePkgPath, `${JSON.stringify(json, null, 2)}\n`, 'utf8')
          result.profilePackageJson = profilePkgPath
        }
      } catch (error) {
        result.errors.push({
          pkg: SUITE_PKG,
          error: `提升 profile 依赖失败: ${error instanceof Error ? error.message : String(error)}`,
        })
      }
    }

    // 接线自检：更新后仍未进入启动链路的（profile bundles 未列出套件）——
    // 面板必须明确提示，否则又是「已是最新但从未加载」的假象。
    if (result.updated.length > 0) {
      try {
        const loadState = await suiteLoadState(result.updated.map((u) => u.pkg))
        const notWired = result.updated.filter((u) => loadState[u.pkg] !== 'enabled').map((u) => u.pkg)
        if (notWired.length > 0) result.notWired = notWired
      } catch {
        /* 接线自检失败不影响更新结果本身 */
      }
    }

    const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
    result.backupRoot = join(home, 'agentlex-backups', 'plugin-update')
    setProgress({
      running: false,
      phase: result.errors.length > 0 ? 'error' : 'done',
      error: result.errors[0]?.error,
      message: result.errors.length > 0 ? '更新未完全成功' : '更新完成',
    })
    return result
  }
  updateQueue = updateQueue.then(run, run)
  return updateQueue as Promise<PluginUpdateResult>
}

/* ─────────────────── 供应链策略一键修复 ─────────────────── */

/** 从 pnpm 报错输出中解析被 minimumReleaseAge 拦截的包（pkg@version）。 */
export function parsePolicyOffenders(output: string): string[] {
  const offenders = new Set<string>()
  // 形如：1 lockfile entries failed verification: dsh-legal-suite@0.1.0 was published at ...
  const re = /([A-Za-z0-9@._-]+@\d+\.\d+\.\d+)(?=\s+was published)/g
  for (const m of output.matchAll(re)) {
    const value = m[1]
    if (value.includes('@') && !value.startsWith('@')) offenders.add(value)
  }
  return [...offenders]
}

/**
 * 把条目追加进 profile 的 pnpm-workspace.yaml minimumReleaseAgeExclude 清单
 * （幂等：已被任一现有条目覆盖的版本自动跳过）。
 *
 * 背景：本机 pnpm 启用供应链发布冷却（minimumReleaseAge），刚发布的版本会被
 * 安装与启动期锁文件校验拒绝——GUI 更新失败、或重启时按旧锁文件回滚。套件是
 * 第一方可信发布，更新器在安装前主动把目标版本写入豁免清单。
 */
export async function addMinimumReleaseAgeExcludes(
  entries: string[],
): Promise<{ ok: boolean; added: string[]; error?: string }> {
  const wanted = entries.map((e) => e.trim()).filter((e) => e !== '')
  if (wanted.length === 0) return { ok: true, added: [] }
  const wsPath = join(profileDir(), 'pnpm-workspace.yaml')
  let text: string
  try {
    text = await readFile(wsPath, 'utf8')
  } catch {
    return { ok: false, added: [], error: `无法读取 ${wsPath}` }
  }
  const lines = text.split(/\r?\n/)
  const keyIdx = lines.findIndex((l) => l.trim().startsWith('minimumReleaseAgeExclude:'))
  let insertAt = lines.length
  if (keyIdx === -1) {
    lines.push('minimumReleaseAgeExclude:')
    insertAt = lines.length
  } else {
    for (let i = keyIdx + 1; i < lines.length; i++) {
      const t = lines[i].trim()
      if (t === '') continue
      if (!t.startsWith('-') && !t.startsWith('#')) {
        insertAt = i
        break
      }
    }
  }
  const covered = (entry: string, raw: string[]): boolean =>
    raw.some((e) => e === entry || e.split('||').map((x) => x.trim()).includes(entry))
  const existingRaw = lines
    .slice(keyIdx === -1 ? lines.length : keyIdx + 1, insertAt)
    .map((l) => l.trim().replace(/^-\s*/, '').replace(/^['"]|['"]$/g, ''))
    .filter((l) => l !== '')
  const added: string[] = []
  for (const entry of wanted) {
    if (covered(entry, existingRaw)) continue
    lines.splice(insertAt, 0, `  - '${entry}'`)
    insertAt += 1
    added.push(entry)
  }
  if (added.length === 0) return { ok: true, added: [] }
  try {
    await writeFile(wsPath, `${lines.join('\n')}\n`, 'utf8')
  } catch (error) {
    return { ok: false, added: [], error: `写入 ${wsPath} 失败：${error instanceof Error ? error.message : String(error)}` }
  }
  console.log(`[agentlex-litigation] minimumReleaseAgeExclude += ${added.join(', ')}`)
  return { ok: true, added }
}

/**
 * 一键修复 pnpm 供应链策略（minimumReleaseAge）拦截：把最近一次 pnpm 报错中
 * 被拦的 pkg@version 追加进 profile 的 minimumReleaseAgeExclude 清单，之后重试
 * 更新即可通过。只放行「新发布但合法」的包，不关闭整个策略。
 */
export async function fixSupplyChainPolicy(): Promise<{ ok: boolean; added: string[]; error?: string }> {
  const offenders = parsePolicyOffenders(lastPnpmErrorOutput)
  if (offenders.length === 0) {
    return { ok: false, added: [], error: '未检测到供应链策略拦截（请先执行一次更新以复现）' }
  }
  return addMinimumReleaseAgeExcludes(offenders)
}

/* ───────────────────────── 宿主进程重启 ───────────────────────── */

/**
 * 重启 DSH 宿主进程（新版本宿主代码在启动时加载，必须重启才生效）。
 *
 * 参考 dsh-bridge 的 `restartDsh` 实现：
 * - 守护进程 / PM2 托管（DSH_DAEMON / PM2_HOME 存在）：直接 process.exit(0)，
 *   由守护进程自动拉起（本机 DSH 服务由 supervisor 托管，退出会自动重启）。
 * - 常规 Node/CLI 模式：先 spawn 一个与当前进程相同参数（process.execPath +
 *   process.argv.slice(1)）的 detached 后台子进程接管，再 process.exit(0)。
 *
 * 重启后浏览器需刷新以加载新版本界面；调用方（client）负责在重启后重连并
 * `location.reload()`。
 */
export function restartDshProcess(): { ok: boolean; scheduled?: boolean } {
  setTimeout(() => {
    try {
      if (process.env.DSH_DAEMON || process.env.PM2_HOME) {
        // 由守护进程 / PM2 拉起。
        process.exit(0)
      } else {
        // 常规模式：派生独立后台子进程后退出（自举接管）。
        const child = spawn(process.execPath, process.argv.slice(1), {
          cwd: process.cwd(),
          env: process.env,
          detached: true,
          stdio: 'ignore',
        })
        child.unref()
        process.exit(0)
      }
    } catch (error) {
      console.warn(`[agentlex-litigation] restartDsh failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, 600)
  return { ok: true, scheduled: true }
}