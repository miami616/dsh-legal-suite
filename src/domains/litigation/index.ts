/**
 * dsh-legal-suite/litigation — host half.
 *
 * AgentLex 诉讼案件：案件看板 / 详情 / 任务树 / 时间轴 / 日程 / 期限提醒。
 * 独立重实现：自带存储（$DSH_HOME/agentlex/litigation/），不依赖 AgentLex 应用。
 *
 * M0 骨架：配置 schema + 设置卡片 + /api/agentlex-case/health 健康路由，
 * 用于验证宿主半在任意 dsh profile 中加载。M1 起在此挂载案件存储与完整路由。
 *
 * The browser half (./client) renders the case manager panel and the sidebar
 * entry. Everything rides official NPM SDK packages — no dsh source changes.
 */

import type { Context } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
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
import { seedLitigationSample } from '../../shared/seed/index.ts'
import { createCaseStore } from './store/case-store.ts'
import { createScheduleStore } from './store/schedule-store.ts'
import { createTimelineStore } from './store/timeline-store.ts'
import { computeDeadlines } from './deadlines.ts'
import { defaultSourcePath, importFromAgentLex } from './import/agentlex-migrate.ts'
import { makeRoutes } from './routes.ts'
import { registerLitigationHttpTool } from './tools.ts'
import {
  checkPluginUpdate,
  performPluginUpdate,
  updateProgressSnapshot,
  cancelUpdate,
  fixSupplyChainPolicy,
} from './updater.ts'

/** Stable cordis plugin name. */
export const name = 'litigation'

/** The shipped agent preset id this plugin owns (诉讼管家). */
export const PRESET_ID = 'litigation-manager'

/** Services required before the litigation surfaces can mount. */
export const inject = ['webServer', 'systemPrompt', 'tools']

/**
 * Settings namespace of the litigation capability — the section the web
 * settings surface edits. Spelled here rather than imported: the browser half
 * spells the same value and must not depend on a Host package.
 */
export const LITIGATION_SETTINGS_NAMESPACE = settingsNamespace('agentlex-litigation')

/** Plugin config, validated by the same-named schemastery schema. */
export interface Config {
  /** Whether to announce the litigation module to every agent (system prompt). */
  announceToAgent?: boolean
  /** Master switch for the plugin (routes, prompt section). */
  enabled?: boolean
  /** Data directory override (default: $DSH_HOME/agentlex/litigation). */
  dataDir?: string
  /**
   * Agent-preset mode: mount as an agent-plane row (scoped litigation tool +
   * persona only), no host routes/stores. Set in the 诉讼管家 preset's
   * agent.cordis.yml so the plugin never re-registers host surfaces per-session.
   */
  agentPreset?: boolean
}

export const Config: z<Config> = z.object({
  announceToAgent: z.boolean().default(true),
  enabled: z.boolean().default(true),
  dataDir: z.string().required(false),
  agentPreset: z.boolean().default(false),
})

/** Schema default, re-read for hand-built test contexts. */
const DEFAULT_ANNOUNCE = true

/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 160

/** Model-facing announcement: plugin presence and capabilities. */
export const LITIGATION_GUIDANCE =
  '本机已安装 agentlex-dsh-litigation 插件（诉讼案件）：侧边栏「诉讼案件」入口。能力：案件管理（登记/当事人/案由/法院/标的/进度）、任务树（阶段→任务→子任务→检查项，检查项可创建/勾选）、时间轴（开庭/举证/上诉等法院程序节点与期限提醒）、日程。数据独立存储于 $DSH_HOME/agentlex/litigation/，与 AgentLex 桌面应用的数据分开；可通过导入工具从 ~/.myagents/agentlex/ 一次性迁移。用户提到「诉讼 / 案件 / 卷宗 / 开庭 / 举证期 / 上诉期」时即指本插件，请据此协作。模型可直接调用 litigation 工具（action 见工具参数）帮用户查询/登记/更新案件、安排任务、记录时间轴节点与期限，工具变更会实时刷新界面。阶段推进：apply_stage_template 按阶段模板展开标准任务（dryRun=true 先预览，only/skip 裁剪，anchorDate 推算 deadline）；stage_suggestions 只读检测「当前阶段已完成应展开下一阶段」与缺失的登记字段；update_case 改变 status 时响应会内联返回下一阶段建议。'

/** URL 形态的值不是合法目录路径（历史上曾因设置项误填把 LLM 接口地址写进来）。 */
const URLISH_PATH = /^[a-z][a-z0-9+.-]*:\/\//i

/** Resolve the data directory: explicit config wins, else $DSH_HOME/agentlex/litigation. */
export function resolveDataDir(configured?: string): string {
  if (configured !== undefined && configured !== '' && !URLISH_PATH.test(configured.trim())) return configured
  const home = process.env.DSH_HOME ?? ''
  if (home !== '') return `${home}/agentlex/litigation`
  // Fallback for bare host runs without DSH_HOME.
  const os = process.platform === 'win32' ? 'USERPROFILE' : 'HOME'
  const userHome = process.env[os] ?? '.'
  return `${userHome}/.dsh/agentlex/litigation`
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
      console.warn(`[agentlex-litigation] preset sync failed (${presetId}):`, error)
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
 * module at a custom folder from the settings UI without losing cases.
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
      console.warn(`[agentlex-litigation] dataDir 已切换 ${prev} → ${dataDir},新目录非空,未迁移`)
      return
    }
    const prevFiles = await readdir(prev)
    await mkdir(dataDir, { recursive: true })
    for (const name of prevFiles) {
      await cp(join(prev, name), join(dataDir, name), { recursive: true, force: true })
    }
    console.warn(`[agentlex-litigation] dataDir 已迁移 ${prev} → ${dataDir}`)
  } catch (error) {
    console.warn('[agentlex-litigation] dataDir migration failed:', error)
  }
}

/**
 * Mount the litigation host: settings section + case store + routes.
 * @param ctx - host plugin context carrying webServer/systemPrompt.
 * @param config - resolved plugin config (schema defaults applied by the loader).
 */
/**
 * Module-level surface registry, SPLIT BY PLANE.
 *
 * The plugin is mounted twice in the same process: once as the host row
 * (`id: litigation` — routes/stores/persona) and once inside the 诉讼管家
 * agent preset (`agentPreset: true` — scoped tool only). The two planes must
 * never share a slot: a preset apply used to tear the host's routes down
 * (deleting a case in the UI silently 404'd). Each plane also survives cordis
 * Fiber._reloads (injected services arrive in batches, each re-running apply
 * with fresh closures): a per-apply local variable cannot see the previous
 * apply's registration — the second apply would collide on
 * "webserver: duplicate exact route". Holding each plane's surface at module
 * level lets every apply/sync tear the previous registration of ITS OWN plane
 * down synchronously (makeRoutes disposers are a synchronous table.delete)
 * before re-registering. The token links each registration to the apply that
 * owns it, so the fiber-unload effect only cleans up when its own surface is
 * still active — never the surface of a newer reload.
 */
interface HostSurface {
  token: object
  dispose: () => void
}

/** The host plane (routes/stores/persona) — `agentPreset: false`. */
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
    announceToAgent: current().announceToAgent ?? DEFAULT_ANNOUNCE,
    enabled: current().enabled ?? true,
    dataDir: current().dataDir,
    agentPreset: current().agentPreset === true,
  })

  // Ownership token of THIS apply's surface (distinct per fiber reload).
  const token = {}

  const sync = (): void => {
    const value = resolve()
    // This apply's plane, fixed for the whole closure (teardown uses it).
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
    if (!isPreset) void syncShippedPresets([PRESET_ID])
    if (!value.enabled) return

    // Agent-preset plane: mounted as a row of an agent preset's
    // agent.cordis.yml. Register only the scoped litigation tool (over the
    // host HTTP API) — no routes/stores/persona, so a preset session never
    // duplicates host surfaces.
    if (isPreset) {
      presetSurface = { token, dispose: registerLitigationHttpTool(ctx) }
      return
    }

    const disposers: Array<() => void> = []
    if (value.announceToAgent) {
      disposers.push(ctx.systemPrompt.section({
        name: 'plugin:agentlex-litigation',
        order: SECTION_ORDER,
        text: LITIGATION_GUIDANCE,
      }))
    }

    // Storage + route family, all on the same cordis ctx so every mutation
    // broadcasts agentlex:registry-changed to listeners (the browser half
    // subscribes for live refresh).
    const dataDir = resolveDataDir(value.dataDir)
    const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
    // 全新安装时数据目录要等首次写入才创建；启动快照/迁移检查若在创建前
    // 运行会报 ENOENT（原逻辑不致命，但新装每次启动都刷噪音日志）。先确保
    // 目录存在，再跑迁移与启动快照。
    void mkdir(dataDir, { recursive: true })
      .then(() => {
        // Repoint to a custom dataDir (settings UI) → migrate the old dataset in.
        void migrateDataDirIfChanged(dataDir)
        void snapshotDataDir('litigation', dataDir, home)
      })
      .catch((error) => {
        console.warn('[agentlex-litigation] 数据目录创建失败:', error)
        void migrateDataDirIfChanged(dataDir)
        void snapshotDataDir('litigation', dataDir, home)
      })
    const caseStore = createCaseStore(dataDir, ctx)
    const timelineStore = createTimelineStore(dataDir, ctx)
    const scheduleStore = createScheduleStore(dataDir, ctx)
    // 全新安装（空数据目录）时内置一份参考用例，让新用户开箱即见完整演示。
    // 仅当 registry 为空时播种，绝不覆盖已有数据；失败仅告警不致命。
    void seedLitigationSample(caseStore, timelineStore, scheduleStore)
      .then((seeded) => {
        if (seeded !== undefined) console.warn(`[agentlex-litigation] 已播种内置参考用例 ${seeded}`)
      })
      .catch((error) => console.warn('[agentlex-litigation] 参考用例播种失败:', error))
    const deadlines = async (caseId?: string, opts?: { includeOverdue?: boolean }) => {
      const [registry, events] = await Promise.all([caseStore.readRegistry(), timelineStore.listEvents()])
      return computeDeadlines(registry, events, caseId, opts)
    }
    // Automatic backup: snapshot after every data write (throttled), plus one
    // on apply. Backups land OUTSIDE the dataDir (~/.dsh/agentlex-backups/),
    // so deleting/recreating the working folder never takes the backups with it.
    disposers.push(ctx.on('agentlex:registry-changed' as keyof Events, () => {
      void snapshotDataDir('litigation', dataDir, home)
    }))
    disposers.push(makeRoutes(ctx, {
      caseStore,
      timelineStore,
      scheduleStore,
      dataDir,
      // Deadline engine reads through the same stores (fresh each call).
      deadlines,
      // 插件自更新：设置 → AgentLex 设置「插件版本与更新」→ 检测公共 npm
      // registry 最新版 / 经 pnpm 升级本包（完成后需重启 DSH 生效）。
      pluginUpdate: {
        check: () => checkPluginUpdate(),
        update: (pkgFilter?: string) => performPluginUpdate(pkgFilter),
        status: async () => updateProgressSnapshot(),
        cancel: async () => cancelUpdate(),
        policyFix: () => fixSupplyChainPolicy(),
      },
      // Import from ~/.myagents/agentlex (or an explicit dir), read-only source.
      importFromAgentLex: async (sourceDir?: string) => {
        const dir = sourceDir !== undefined && sourceDir !== '' ? sourceDir : defaultSourcePath()
        const result = await importFromAgentLex(caseStore, timelineStore, dir)
        // The import wrote many rows; a single change broadcast lets clients
        // refresh once instead of per-row. dispatch() only RESOLVES the
        // listeners — run them (same pattern as file-store).
        const payload = { domain: 'import', reason: 'agentlex-import' }
        for (const listener of ctx.events.dispatch('emit', ['agentlex:registry-changed', payload])) {
          try { listener(payload) } catch (error) { console.warn('[agentlex-litigation] import listener failed:', error) }
        }
        return result
      },
    }))
    hostSurface = {
      token,
      dispose: () => { for (const dispose of disposers.splice(0).reverse()) dispose() },
    }
  }

  installSettingsSection(ctx, LITIGATION_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => { current = source; sync() },
    onChange: sync,
  })

  // Fiber-unload safety net: only tears down this apply's plane. During a
  // fiber reload the old fiber's effect fires asynchronously — the token
  // check keeps it from wiping the newer reload's surface.
  ctx.effect(() => () => {
    disposeHostSurface(token)
    disposePresetSurface(token)
  }, 'agentlex-litigation: teardown')

  // Initial registration from the composition entry (covers deployments with
  // no settings service, whose installSettingsSection never fires its hooks).
  sync()
}
