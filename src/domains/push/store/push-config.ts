/**
 * Push domain store: push-config.json + push-ledger.json.
 *
 * - push-config.json: the user's reminder config (enabled, title prefix).
 *   Delivery is FIXED to the Feishu card channel (direct Feishu open API,
 *   same credentials as feishu_push.py) — no dsh-im dependency, no
 *   botId/targetId/channel to configure.
 * - push-ledger.json: dedupe ledger. 新版键形如 `caseId|date|label|T{n}`（档位）/
 *   `...|IN|{lead}`（精确提醒）/ `...|OD|{date}`（逾期任务），长期去重；旧版
 *   `caseId|date|label` 键仍按「仅当天有效」，保证升级当天不重复推送。
 * - push-state.json: 运行状态（lastDigestDate / 失败重试 / 上次成功）。
 *
 * 三者都走共享 JsonFileStore（单写者、磁盘锁、原子 rename），host 与手动触发
 * 可以安全共用。
 */

import { JsonFileStore } from '../../litigation/store/file-store.ts'

/** 本地日期（不用 toISOString：UTC 在凌晨 0–8 点会错一天）。 */
function localDateYmd(now: number = Date.now()): string {
  const d = new Date(now)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Push configuration document. */
export interface PushConfig {
  /** Master switch. */
  enabled: boolean
  /** 每日摘要推送时间（HH:mm，默认 08:30）。 */
  pushTime?: string
  /** Optional title prefix prepended to the fixed template. */
  titlePrefix?: string
  /**
   * 智能分级提醒（默认开）：按期限性质使用 T-30/T-15/T-7/T-3/T-2/T-1/D0 阶梯；
   * 关闭后回到旧版「今天 + 明天 + 逾期任务」。
   */
  smartLead?: boolean
  /** 开庭/会议前精确提醒（默认开，开庭 T-2h/T-30m，其他 T-30m）。 */
  preciseReminder?: boolean
  /** 在卡片上显示「逾期后果」提示（默认开，仅法定期限/程序期限）。 */
  includeConsequence?: boolean
  /** 标准模式单张摘要卡最多展示条数（默认 15；精简模式按分区限额）。 */
  maxDigestRows?: number
  /**
   * 提醒密度（默认 concise）：
   *  - concise：每日只推近 7 天 + 当天 + 逾期前 3 天，积压只给数量；
   *  - standard：保留全部档位（T-30/T-15 也每天可见）。
   */
  density?: 'concise' | 'standard'
  updatedAt?: string
}

/** Default push config (disabled, 08:30, smart reminders on). */
export function pushConfigDefault(): PushConfig {
  return {
    enabled: false,
    pushTime: '08:30',
    smartLead: true,
    preciseReminder: true,
    includeConsequence: true,
    maxDigestRows: 15,
    density: 'concise',
  }
}

/** 解析单张卡最大条数（3–50，非法回退 15）。 */
export function parseMaxDigestRows(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return 15
  return Math.min(50, Math.max(3, Math.round(n)))
}

/** 解析推送时间（HH:mm）→ [时, 分]；非法值回退默认 08:30。 */
export function parsePushTime(value: string | undefined): [number, number] {
  const m = /^(\d{1,2}):(\d{2})$/.exec((value ?? '').trim())
  if (m !== null) {
    const h = Number(m[1])
    const min = Number(m[2])
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) return [h, min]
  }
  return [8, 30]
}

/** One ledger entry: a deadline key already pushed. */
export interface LedgerEntry {
  key: string
  pushedAt: string
}

/** push-ledger.json document. */
export interface PushLedger {
  registryVersion: string
  entries: LedgerEntry[]
}

/** Default ledger (empty). */
export function pushLedgerDefault(): PushLedger {
  return { registryVersion: '1.0', entries: [] }
}

/** Build the ledger key for a deadline row. */
export function ledgerKey(caseId: string, date: string, label: string): string {
  return `${caseId}|${date}|${label}`
}

/** The push store surface. */
export interface PushStore {
  readConfig(): Promise<PushConfig>
  writeConfig(config: PushConfig): Promise<PushConfig>
  /**
   * Whether a reminder key was already pushed.
   *
   * 新键（含 `|T{n}` / `|IN|{lead}`）是**长期去重**：同一事项同一档只提醒一次，
   * 不因跨天而重发。旧版键 `caseId|date|label` 仍按「仅当天有效」判断，保证升级
   * 当天不重复推送已发过的旧记录。
   */
  hasPushed(key: string): Promise<boolean>
  /** Record pushed keys (idempotent). */
  recordPushed(keys: string[]): Promise<void>
  /** Prune ledger entries older than `beforeMs` (keeps the file small). */
  pruneLedger(beforeMs: number): Promise<void>
}

/* ------------------------- run state (push-state.json) ------------------------- */

/** 一次推送运行的可观测状态（设置页与失败重试都依赖它）。 */
export interface PushRunState {
  registryVersion: string
  /** 最近一次「摘要卡档期」成功日期（YYYY-MM-DD，本地时区）。 */
  lastDigestDate?: string
  /** 最近一次尝试时间（ISO）。 */
  lastAttemptAt?: string
  /** 最近一次成功时间（ISO）。 */
  lastSuccessAt?: string
  /** 最近一次失败原因（成功后清空）。 */
  lastError?: string
  /** 连续失败次数（成功后归零）。 */
  consecutiveFailures: number
  /** 最近一次「补充提醒」时间（ISO），避免事项新增后反复打扰。 */
  lastIncrementalAt?: string
  /** 最近一次本地兜底通知时间（ISO）。 */
  lastFallbackAt?: string
  /** 最近一次成功推送的条目数。 */
  lastPushedCount?: number
  /** 最近一次推送的性质：digest / incremental / intraday / manual。 */
  lastKind?: string
}

/** 默认运行状态。 */
export function pushStateDefault(): PushRunState {
  return { registryVersion: '1.0', consecutiveFailures: 0 }
}

/** 运行状态存储（读写 + 原子更新）。 */
export interface PushStateStore {
  read(): Promise<PushRunState>
  mutate(fn: (state: PushRunState) => PushRunState): Promise<PushRunState>
}

/** 创建运行状态存储。 */
export function createRunStateStore(dataDir: string): PushStateStore {
  const store = new JsonFileStore<PushRunState>(`${dataDir}/push-state.json`, pushStateDefault)
  return {
    read: () => store.read(),
    mutate: (fn) => store.mutate(fn, ''),
  }
}

/**
 * Create the push store over a data directory.
 * @param dataDir - where push-config.json / push-ledger.json live.
 */
export function createPushStore(dataDir: string): PushStore {
  const configStore = new JsonFileStore<PushConfig>(`${dataDir}/push-config.json`, pushConfigDefault)
  const ledgerStore = new JsonFileStore<PushLedger>(`${dataDir}/push-ledger.json`, pushLedgerDefault)

  return {
    async readConfig(): Promise<PushConfig> {
      // 合并默认值：老配置文件没有 density/smartLead 等新字段时，读出来就是完整口径，
      // 设置页与路由不必各自处理 undefined。
      return { ...pushConfigDefault(), ...(await configStore.read()) }
    },
    async writeConfig(config: PushConfig): Promise<PushConfig> {
      const next = { ...pushConfigDefault(), ...config, updatedAt: new Date().toISOString() }
      await configStore.mutate(() => next, '')
      return next
    },
    async hasPushed(key: string): Promise<boolean> {
      const ledger = await ledgerStore.read()
      const today = localDateYmd()
      const isLegacyKey = !key.includes('|T') && !key.includes('|IN|') && !key.includes('|OD|')
      // 旧版键按天去重（次日重推窗口内期限）；新版分档键长期去重（同档只提醒一次）。
      return ledger.entries.some((entry) =>
        entry.key === key && (isLegacyKey ? entry.pushedAt.slice(0, 10) === today : true),
      )
    },
    async recordPushed(keys: string[]): Promise<void> {
      if (keys.length === 0) return
      await ledgerStore.mutate((ledger) => {
        const now = new Date().toISOString()
        // 已存在的键要**刷新 pushedAt**：旧版按天去重时，昨天发过的键今天重推后
        // 若不刷新，hasPushed 永远看到昨天 → 每个 tick 都重推（历史 bug）。
        const byKey = new Map(ledger.entries.map((entry) => [entry.key, entry]))
        for (const key of keys) byKey.set(key, { key, pushedAt: now })
        return { ...ledger, entries: [...byKey.values()] }
      }, '')
    },
    async pruneLedger(beforeMs: number): Promise<void> {
      await ledgerStore.mutate((ledger) => {
        const cutoff = new Date(beforeMs).toISOString()
        const kept = ledger.entries.filter((entry) => entry.pushedAt >= cutoff)
        if (kept.length === ledger.entries.length) return ledger
        return { ...ledger, entries: kept }
      }, '')
    },
  }
}
