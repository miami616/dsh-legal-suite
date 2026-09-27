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

/** 解析结果：作用域 + 「逻辑字段名 → 当前 harness 实际字段名」映射。 */
export interface ResolvedClientSettings<T> {
  scope: ClientSettingsScope<T>
  /** 把域内逻辑字段名映射成本代 harness 的承载字段名（0.1.6 恒等）。 */
  field(logical: string): string
}

/** 合包后 host 侧只有一个 loader 条目，其 id 由 cordis.patch.yml 固定为 `agentlex`。 */
export const AGENTLEX_ENTRY_ID = 'agentlex'

/** 0.1.7 起配置并到单条目上，各域字段用该前缀区分（如 dataDir → litigationDataDir）。 */
export function prefixedField(prefix: string, logical: string): string {
  return `${prefix}${logical.charAt(0).toUpperCase()}${logical.slice(1)}`
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
      if (scope !== undefined && scope !== null) return { scope, field: (logical) => logical }
    } catch {
      /* 落到新版取法 */
    }
  }
  const forms = serviceOf<{ get?: (entryId: string) => ClientSettingsScope<T> }>(ctx, 'configForms')
  if (typeof forms?.get === 'function') {
    try {
      const scope = forms.get(AGENTLEX_ENTRY_ID)
      if (scope !== undefined && scope !== null) {
        return {
          scope,
          field: (logical) => (modernPrefix === undefined ? logical : prefixedField(modernPrefix, logical)),
        }
      }
    } catch {
      /* 服务不可用 */
    }
  }
  return undefined
}

/**
 * 把一个「字段名已改」的作用域包成逻辑字段名的视图：读快照时把实际字段搬回逻辑名，
 * 写 set/unset 时再搬回去。调用方（设置页 UI）因此两代共用同一套字段名。
 * @param scope - 原始作用域（其 value 用本代 harness 的字段名）。
 * @param resolveField - 逻辑字段名 → 本代实际字段名。
 */
export function aliasSettingsScope<T>(
  scope: ClientSettingsScope<Record<string, unknown>>,
  resolveField: (logical: string) => string,
): ClientSettingsScope<T> {
  const project = (value: unknown): T | undefined => {
    if (value === undefined || value === null || typeof value !== 'object') return value as T | undefined
    const source = value as Record<string, unknown>
    const mapped: Record<string, unknown> = { ...source }
    for (const logical of Object.keys(source)) {
      const actual = resolveField(logical)
      if (actual === logical) continue
      if (actual in source) mapped[logical] = source[actual]
      else delete mapped[logical]
    }
    for (const logical of Object.keys(source)) {
      const actual = resolveField(logical)
      if (actual !== logical) delete mapped[actual]
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
