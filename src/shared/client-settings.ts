/**
 * dsh-legal-suite/shared — 跨 harness 版本的客户端设置作用域解析。
 *
 * harness 的客户端设置服务在 0.1.7-alpha.1 换了名与取法：
 *   - ≤ 0.1.6：`ctx.settingsScope.bind({ namespace })`，namespace 由宿主插件
 *     自己注册（本套件用 'agentlex-legal-suite' / 'agentlex-litigation' …）。
 *   - ≥ 0.1.7：`ctx.configForms.get(entryId)`，entryId 是 loader 条目 id；宿主
 *     不再接受自定义 namespace，schema 来自该条目的 cordis Config。
 *
 * 两者的**作用域对象接口同形**（getSnapshot/subscribe/set/unset），所以这里
 * 只统一「怎么取到」，并把字段名映射交给调用方（0.1.7 下多个域的配置被并到
 * 同一条目上，用前缀区分）。
 *
 * 两个服务都走 `serviceOf` 的 root-first 解析，**绝不能写进 `export const inject`**：
 * 0.1.7 没有 `settingsScope`，声明它会让整个 client 插件 pending 不加载
 * （实测 `dsh-legal-suite: pending (waiting for service: settingsScope)`）。
 */
import { serviceOf } from './dsh-services.ts'

/** 作用域快照（两代字段同形：status/value/revision/writable）。 */
export interface ClientSettingsSnapshot<T> {
  status?: string
  value?: T
  writable?: boolean
  revision?: number
}

/** 统一的客户端设置作用域面。 */
export interface ClientSettingsScope<T> {
  getSnapshot(): ClientSettingsSnapshot<T>
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): unknown
  unset(field: string): unknown
}

/** 解析结果：作用域 + 「逻辑字段名 ↔ 当前 harness 实际字段名」双向映射。 */
export interface ResolvedClientSettings<T> {
  scope: ClientSettingsScope<T>
  /** 把域内逻辑字段名映射成本代 harness 的承载字段名（0.1.6 恒等）。 */
  field(logical: string): string
  /** 反向映射：承载字段名 → 逻辑字段名（读快照做投影用；0.1.6 恒等）。 */
  logicalOf(actual: string): string
}

/** 合包后 host 侧只有一个 loader 条目，其 id 由 cordis.patch.yml 固定为 `agentlex`。 */
export const AGENTLEX_ENTRY_ID = 'agentlex'

/** 0.1.7 起配置并到单条目上，各域字段用该前缀区分（如 dataDir → litigationDataDir）。 */
export function prefixedField(prefix: string, logical: string): string {
  return `${prefix}${logical.charAt(0).toUpperCase()}${logical.slice(1)}`
}

/**
 * `prefixedField` 的逆：承载字段名折回逻辑字段名（litigationDataDir → dataDir）。
 *
 * 只认「前缀 + 首字母大写」这一形态，其余（不含该前缀、或前缀后不是大写开头）
 * 原样返回，避免把恰好像 `litigationLog` 这样的字段误折。
 */
export function unprefixedField(prefix: string, actual: string): string {
  if (!actual.startsWith(prefix)) return actual
  const rest = actual.slice(prefix.length)
  if (rest === '' || rest[0] !== rest[0].toUpperCase()) return actual
  return rest[0].toLowerCase() + rest.slice(1)
}

/**
 * 解析一个套件设置作用域：优先老版 `settingsScope.bind`，退回新版 `configForms.get`。
 * @param ctx - 插件 client ctx（或任何可解析 ctx）。
 * @param namespace - 0.1.6 的宿主命名空间（新版忽略）。
 * @param modernPrefix - 新版字段前缀（仅当该域字段被并进聚合条目时需要）。
 * @returns 作用域与字段映射；两代取法都不可用时返回 undefined。
 */
export function resolveClientSettings<T>(
  ctx: unknown,
  namespace: string,
  modernPrefix?: string,
): ResolvedClientSettings<T> | undefined {
  const legacy = serviceOf<{ bind?: (spec: { namespace: string }) => ClientSettingsScope<T> }>(ctx, 'settingsScope')
  if (typeof legacy?.bind === 'function') {
    try {
      const scope = legacy.bind({ namespace })
      if (scope !== undefined && scope !== null) return { scope, field: (logical) => logical, logicalOf: (actual) => actual }
    } catch {
      /* 落到新版取法 */
    }
  }
  const forms = serviceOf<ModernConfigForms<T>>(ctx, 'configForms')
  if (typeof forms?.get === 'function') {
    return { scope: moduleSettingsScope(forms, namespace, modernPrefix), field: (logical) => logical, logicalOf: (actual) => actual }
  }
  return undefined
}

/** `configForms` 服务在 0.2.x 的最小面（get + describe 里的已服务命名空间目录）。 */
interface ModernConfigForms<T> {
  get(namespace: string): ClientSettingsScope<T>
  describe?(): {
    getSnapshot?: () => { view?: { namespaces?: Array<{ ns?: string }> } }
    subscribe?: (listener: () => void) => () => void
  }
}

/**
 * 动态解析「该域设置到底读哪个命名空间」的作用域。
 *
 * 背景（2026-10-15 修）：
 *   - 0.1.7-alpha.1 那代 harness 只暴露 loader **条目**（id=`agentlex`）的表单，
 *     各域字段被并进该条目、用前缀区分（`litigationCalendarSyncEnabled`），
 *     所以老写法是 `configForms.get('agentlex')` + 前缀映射。
 *   - 0.2.x 又回到「每个域 `settings.register(自己的命名空间)`」，宿主服务的是
 *     `agentlex-litigation` / `agentlex-legal-suite` 这些**域命名空间**，
 *     字段名就是域 schema 的逻辑名（`calendarSyncEnabled`）。
 * 沿用老写法会去读一个**没人注册的命名空间** `agentlex`：表单 `status='unavailable'`、
 * `value=undefined` → 设置页全部退回默认值（「日程同步 Apple 日历」显示为关、下面的
 * 同步范围整块 `pointer-events:none` 点不动、日历下拉显示默认「个人」），而且 `set()`
 * 写到不存在的命名空间上**静默无效**——用户「改了没反应」的根因。
 *
 * 因此这里先看宿主**实际在服务**哪个命名空间：是域命名空间就用域命名空间（字段名
 * 逻辑名，不做前缀映射）；否则退回老代的合并条目 + 前缀映射。判定挂在镜像的
 * 已服务命名空间目录上，并在「服务集合变化」时重新通知订阅者，避免启动早期
 * 目录还没到就锁死选择。
 */
function moduleSettingsScope<T>(
  forms: ModernConfigForms<T>,
  namespace: string,
  modernPrefix: string | undefined,
): ClientSettingsScope<T> {
  const entryId = AGENTLEX_ENTRY_ID
  const prefixed = modernPrefix !== undefined

  /** 宿主此刻是否服务这个命名空间（镜像未就绪时返回 false → 退回条目表单）。 */
  const isServed = (ns: string): boolean => {
    try {
      const view = forms.describe?.()?.getSnapshot?.().view
      if (view === undefined) return false
      return (view.namespaces ?? []).some((candidate) => candidate?.ns === ns)
    } catch {
      return false
    }
  }

  /** 当前该读写的目标命名空间，以及是否需要把承载字段名折回逻辑名。 */
  const target = (): { ns: string; fold: boolean } =>
    isServed(namespace) ? { ns: namespace, fold: false } : { ns: entryId, fold: prefixed }

  const foldValue = (value: unknown, fold: boolean): T | undefined => {
    if (!fold) return value as T | undefined
    if (value === undefined || value === null || typeof value !== 'object') return value as T | undefined
    const mapped: Record<string, unknown> = {}
    for (const [actual, field] of Object.entries(value as Record<string, unknown>)) {
      mapped[unprefixedField(modernPrefix as string, actual)] = field
    }
    return mapped as T
  }

  return {
    getSnapshot: () => {
      const { ns, fold } = target()
      const snapshot = forms.get(ns).getSnapshot()
      return { ...snapshot, value: foldValue(snapshot.value, fold) }
    },
    subscribe: (listener) => {
      const offs: Array<() => void> = []
      for (const ns of [namespace, entryId]) {
        try { offs.push(forms.get(ns).subscribe(listener)) } catch { /* 单个表单不可用不影响另一个 */ }
      }
      try {
        const off = forms.describe?.()?.subscribe?.(listener)
        if (typeof off === 'function') offs.push(off)
      } catch { /* 镜像不可用 */ }
      return () => { for (const off of offs) { try { off() } catch { /* 忽略清理异常 */ } } }
    },
    set: (field, value) => {
      const { ns, fold } = target()
      return forms.get(ns).set(fold ? prefixedField(modernPrefix as string, field) : field, value)
    },
    unset: (field) => {
      const { ns, fold } = target()
      return forms.get(ns).unset(fold ? prefixedField(modernPrefix as string, field) : field)
    },
  }
}

/**
 * 把一个「字段名已改」的作用域包成逻辑字段名的视图：读快照时把承载字段名折回逻辑名，
 * 写 set/unset 时再搬回去。调用方（设置页 UI）因此两代共用同一套字段名。
 *
 * ⚠ 投影方向必须按「快照里实际叫什么 → 逻辑名」走：快照的键是**承载字段名**
 * （`litigationCalendarSyncEnabled`），UI 要的是**逻辑名**（`calendarSyncEnabled`）。
 * 早期版本把快照的键当逻辑名去算前缀，得到 `litigationLitigation…` 这种不存在的
 * 键，于是整个投影被清成 `{}`，设置页所有读取都退回默认值（2026-10-12 修：
 * 表现为「日程同步 Apple 日历」显示为关、下面的同步范围选项整块 pointer-events:none
 * 点不动，而宿主里开关其实是 true）。
 *
 * @param scope - 原始作用域（其 value 用本代 harness 的承载字段名）。
 * @param resolveField - 逻辑字段名 → 本代承载字段名（写入用）。
 * @param resolveLogical - 本代承载字段名 → 逻辑字段名（读取投影用，默认恒等）。
 */
export function aliasSettingsScope<T>(
  scope: ClientSettingsScope<Record<string, unknown>>,
  resolveField: (logical: string) => string,
  resolveLogical: (actual: string) => string = (actual) => actual,
): ClientSettingsScope<T> {
  const project = (value: unknown): T | undefined => {
    if (value === undefined || value === null || typeof value !== 'object') return value as T | undefined
    const source = value as Record<string, unknown>
    const mapped: Record<string, unknown> = {}
    for (const actual of Object.keys(source)) {
      mapped[resolveLogical(actual)] = source[actual]
    }
    return mapped as T
  }
  return {
    getSnapshot: () => ({ ...scope.getSnapshot(), value: project(scope.getSnapshot().value) as never }),
    subscribe: (listener) => scope.subscribe(listener),
    set: (field, value) => scope.set(resolveField(field), value),
    unset: (field) => scope.unset(resolveField(field)),
  }
}
