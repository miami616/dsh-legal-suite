/**
 * dsh-legal-suite/nonlitigation — host half (S0 skeleton).
 *
 * 非诉项目：项目 / 合同审查 / 法律研究 / 常法服务。
 * S0 先提供健康路由 + 设置卡片，后续里程碑补全存储/路由/UI。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-settings'
import z from 'schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { cp, mkdir, readdir, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Events } from '@deepseek-ai/cordis'
import { syncShippedPreset } from '../../shared/preset-sync.ts'
import { seedNonLitigationSample } from '../../shared/seed/index.ts'
import { createProjectStore } from './store/project-store.ts'
import { createServiceStore } from './store/service-store.ts'
import { makeRoutes } from './routes.ts'
import { registerNonLitigationHttpTool } from './tools.ts'

export const name = 'nonlitigation'

/** The shipped agent preset id this plugin owns (非诉管家, mirrors litigation-manager). */
export const PRESET_IDS = ['nonlitigation-manager']

/** Services required before the non-litigation surfaces can mount. */
export const inject = ['webServer', 'systemPrompt', 'tools', 'settings']

export const NONLITIGATION_SETTINGS_NAMESPACE = 'agentlex-nonlitigation' as const

export interface Config {
  enabled?: boolean
  dataDir?: string
  /** Agent-preset mode: register only the scoped nonlitigation tool. */
  agentPreset?: boolean
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  dataDir: z.string().required(false),
  agentPreset: z.boolean().default(false),
})

/** URL 形态的值不是合法目录路径（历史上曾因设置项误填把 LLM 接口地址写进来）。 */
const URLISH_PATH = /^[a-z][a-z0-9+.-]*:\/\//i

export function resolveDataDir(configured?: string): string {
  if (configured !== undefined && configured !== '' && !URLISH_PATH.test(configured.trim())) return configured
  const home = process.env.DSH_HOME ?? ''
  if (home !== '') return `${home}/agentlex/nonlitigation`
  const os = process.platform === 'win32' ? 'USERPROFILE' : 'HOME'
  const userHome = process.env[os] ?? '.'
  return `${userHome}/.dsh/agentlex/nonlitigation`
}

/**
 * Sync the plugin's shipped agent preset(s) into the harness user root
 * ($DSH_HOME/.agent-presets/<id>) — the ONLY root dsh's agent-preset picker
 * reads for locally authored presets; the package's own presets/ directory is
 * never scanned. The shipped copy is therefore authoritative: the sync is
 * idempotent and runs on every host-plane apply, so manually installed copies
 * can be deleted freely (the next boot restores the shipped preset).
 *
 * The copy rewrites the preset's agent-plugin row (`name: dsh-legal-suite`) to
 * this package's own absolute entry URL, because the agent-preset loader
 * resolves `name:` from the App install tree, not from the profile's
 * node_modules — a bare package name fails with "Cannot find package".
 * See src/shared/preset-sync.ts.
 *
 * Multiple apply/sync calls race on the same target (a reload re-runs apply
 * with a fresh closure); the module-level queue serializes them and the copy
 * is done entry-by-entry into an explicitly created target directory, so
 * concurrent runs can never interleave rm/cp into a half-written preset.
 * Failures are logged, never fatal.
 */
let presetSyncQueue: Promise<void> = Promise.resolve()

/** Copy the shipped presets once; serialized behind the shared queue. */
async function syncPresetsOnce(presetIds: string[]): Promise<void> {
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
  for (const presetId of presetIds) {
    const source = join(packageRoot, 'presets', presetId)
    const target = join(home, '.agent-presets', presetId)
    try {
      await syncShippedPreset(source, target)
    } catch (error) {
      console.warn(`[agentlex-nonlitigation] preset sync failed (${presetId}):`, error)
    }
  }
}

export function syncShippedPresets(presetIds: string[]): Promise<void> {
  presetSyncQueue = presetSyncQueue.then(() => syncPresetsOnce(presetIds), () => syncPresetsOnce(presetIds))
  return presetSyncQueue
}

/* ─────────────────────── data backup + dataDir migration ─────────────────── */

/** Keep this many backup snapshots per module (oldest dropped first). */
const KEEP_BACKUPS = 20
/** Throttle: at most one snapshot per module per minute. */
const BACKUP_MIN_INTERVAL_MS = 60_000

/** Per-module backup throttle state (one module, survives fiber reloads). */
const backupState: { last: number } = { last: 0 }

/** Serializes snapshot runs — multiple apply/sync calls race otherwise. */
let backupQueue: Promise<void> = Promise.resolve()

/**
 * Snapshot the whole data directory into ~/.dsh/agentlex-backups/<module>/<ts>/.
 * Runs serialized behind a module-level queue (reloads re-run apply and would
 * otherwise interleave two snapshots) and throttled to one per minute — the
 * first call after boot always fires, so startup snapshots once. Failures are
 * logged, never fatal — a broken backup must not break the plugin.
 */
async function snapshotOnce(module: string, dataDir: string, home: string): Promise<void> {
  const now = Date.now()
  if (now - backupState.last < BACKUP_MIN_INTERVAL_MS) return
  backupState.last = now
  const root = join(home, 'agentlex-backups', module)
  const target = join(root, String(now))
  try {
    await mkdir(target, { recursive: true })
    await cp(dataDir, target, { recursive: true })
    const dirs = (await readdir(root, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
    while (dirs.length > KEEP_BACKUPS) {
      await rm(join(root, dirs.shift()!), { recursive: true, force: true })
    }
  } catch (error) {
    console.warn(`[agentlex-${module}] backup failed:`, error)
  }
}

function snapshotDataDir(module: string, dataDir: string, home: string): Promise<void> {
  backupQueue = backupQueue.then(() => snapshotOnce(module, dataDir, home), () => snapshotOnce(module, dataDir, home))
  return backupQueue
}

/** The dataDir of the previous host sync (module-level, survives reloads). */
let lastDataDir: string | undefined

/**
 * When the configured dataDir changes, migrate the previous directory's
 * contents into the new one (once, and only when the new directory is
 * empty — never overwrite an existing dataset). Lets users repoint the
 * module at a custom folder from the settings UI without losing projects.
 */
async function migrateDataDirIfChanged(dataDir: string): Promise<void> {
  if (lastDataDir === undefined) { lastDataDir = dataDir; return }
  if (lastDataDir === dataDir) return
  const prev = lastDataDir
  lastDataDir = dataDir
  try {
    let existing: string[] = []
    try { existing = await readdir(dataDir) } catch { /* not yet created */ }
    if (existing.length > 0) {
      console.warn(`[agentlex-nonlitigation] dataDir 已切换 ${prev} → ${dataDir},新目录非空,未迁移`)
      return
    }
    const prevFiles = await readdir(prev)
    await mkdir(dataDir, { recursive: true })
    for (const name of prevFiles) {
      await cp(join(prev, name), join(dataDir, name), { recursive: true, force: true })
    }
    console.warn(`[agentlex-nonlitigation] dataDir 已迁移 ${prev} → ${dataDir}`)
  } catch (error) {
    console.warn('[agentlex-nonlitigation] dataDir migration failed:', error)
  }
}

/**
 * Module-level surface registry, SPLIT BY PLANE.
 *
 * The plugin is mounted twice in the same process: once as the host row
 * (`id: nonlitigation` — routes/stores) and once inside the 非诉管家 agent
 * preset (`agentPreset: true` — scoped tool only). The two planes must never
 * share a slot: a preset apply used to tear the host's routes down (project
 * actions in the UI silently failed). Each plane also survives cordis
 * Fiber._reloads (injected services arrive in batches, each re-running apply
 * with fresh closures): per-apply local disposers cannot see the previous
 * apply's registration — the second apply would collide on
 * "duplicate exact route". Holding each plane's surface at module level lets
 * every apply/sync tear the previous registration of ITS OWN plane down
 * synchronously (makeRoutes disposers are a synchronous table.delete) before
 * re-registering; the token keeps the fiber-unload effect from wiping a
 * newer reload's surface.
 */
interface HostSurface {
  token: object
  dispose: () => void
}

/** The host plane (routes/stores) — `agentPreset: false`. */
let hostSurface: HostSurface | undefined
/** The agent-preset plane (scoped tool only) — `agentPreset: true`. */
let presetSurface: HostSurface | undefined

/** Wipe the host-plane surface when it belongs to `owner`. */
function disposeHostSurface(owner: object): void {
  if (hostSurface !== undefined && hostSurface.token === owner) {
    hostSurface.dispose()
    hostSurface = undefined
  }
}

/** Wipe the preset-plane surface when it belongs to `owner`. */
function disposePresetSurface(owner: object): void {
  if (presetSurface !== undefined && presetSurface.token === owner) {
    presetSurface.dispose()
    presetSurface = undefined
  }
}

export function apply(ctx: Context, config: Config = {}): void {
  let current: () => Config = () => config
  const resolve = (): Config => ({
    enabled: current().enabled ?? true,
    dataDir: current().dataDir,
    agentPreset: current().agentPreset === true,
  })
  const token = {}

  const sync = (): void => {
    const value = resolve()
    const isPreset = value.agentPreset === true

    // Synchronous teardown of THIS plane's previous surface (any apply's —
    // reloads re-enter with a fresh closure and a new token) BEFORE
    // re-registering. The other plane's surface is left untouched.
    if (isPreset) {
      if (presetSurface !== undefined) { presetSurface.dispose(); presetSurface = undefined }
    } else {
      if (hostSurface !== undefined) { hostSurface.dispose(); hostSurface = undefined }
    }
    // Keep the harness preset roster in sync with the shipped preset(s).
    // Async, best-effort; the preset picker reads $DSH_HOME/.agent-presets/.
    if (!isPreset) void syncShippedPresets(PRESET_IDS)
    if (!value.enabled) return
    if (isPreset) {
      presetSurface = { token, dispose: registerNonLitigationHttpTool(ctx) }
      return
    }
    const dataDir = resolveDataDir(value.dataDir)
    const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
    // 全新安装时数据目录要等首次写入才创建；启动快照/迁移检查若在创建前
    // 运行会报 ENOENT（原逻辑不致命，但新装每次启动都刷噪音日志）。先确保
    // 目录存在，再跑迁移与启动快照。
    void mkdir(dataDir, { recursive: true })
      .then(() => {
        // Repoint to a custom dataDir (settings UI) → migrate the old dataset in.
        void migrateDataDirIfChanged(dataDir)
        void snapshotDataDir('nonlitigation', dataDir, home)
      })
      .catch((error) => {
        console.warn('[agentlex-nonlitigation] 数据目录创建失败:', error)
        void migrateDataDirIfChanged(dataDir)
        void snapshotDataDir('nonlitigation', dataDir, home)
      })
    const projectStore = createProjectStore(dataDir, ctx)
    const serviceStore = createServiceStore(dataDir, ctx)
    // 全新安装（空数据目录）时内置一份参考项目，让新用户开箱即见完整演示。
    // 仅当 registry 为空时播种，绝不覆盖已有数据；失败仅告警不致命。
    void seedNonLitigationSample(projectStore, serviceStore)
      .then((seeded) => {
        if (seeded !== undefined) console.warn(`[agentlex-nonlitigation] 已播种内置参考项目 ${seeded}`)
      })
      .catch((error) => console.warn('[agentlex-nonlitigation] 参考项目播种失败:', error))
    // Automatic backup: snapshot after every data write (throttled), plus one
    // on apply. Backups land OUTSIDE the dataDir (~/.dsh/agentlex-backups/).
    const disposers: Array<() => void> = [ctx.on('agentlex:registry-changed' as keyof Events, () => {
      void snapshotDataDir('nonlitigation', dataDir, home)
    })]
    disposers.push(makeRoutes(ctx, { projectStore, serviceStore, dataDir }))
    hostSurface = { token, dispose: () => { for (const dispose of disposers.splice(0).reverse()) dispose() } }
  }

  ctx.settings.installSection(ctx, NONLITIGATION_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => { current = source; sync() },
    onChange: sync,
  })

  // Fiber-unload safety net: only tears down this apply's plane. During a
  // fiber reload the old fiber's effect fires asynchronously — the token
  // check keeps it from wiping the newer reload's surface.
  ctx.effect(() => () => {
    disposeHostSurface(token)
    disposePresetSurface(token)
  }, 'agentlex-nonlitigation: teardown')

  sync()
}

