/**
 * dsh-legal-suite/shared — 0.1.7 volatile 配置的进程内镜像。
 *
 * harness 0.1.7-alpha.1 把「运行时可改的配置」从自定义命名空间改成了
 * loader 条目的 **volatile 字段**：
 *   - 只有标记 `.volatile()` 的字段会出现在 `SettingsForms.describe()`；
 *   - 这些字段在插件收到的 config 里是 `Volatile{get()}` 引用（不是裸值）；
 *   - 写入后 loader 原地更新引用并 emit `loader/volatile-update`，**不 remount**。
 *
 * 合包后各子域不是独立 loader 条目、拿不到自己的 volatile 引用，所以由聚合层
 * （src/index.ts）持有顶层条目的引用，每次事件重新解包成裸值放进这里；各域的
 * settings 适配器再按自己的命名空间从这个镜像读取（见 settings-adapter.ts）。
 */

/** 一个域的配置读取器：返回该域当前生效的 Config。 */
export type DomainConfigReader = () => unknown

let live: Record<string, unknown> = {}
const readers = new Map<string, DomainConfigReader>()
const listeners = new Set<() => void>()

/** 裸对象（非数组、非 null）时才递归展开。 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value) as unknown
  return proto === Object.prototype || proto === null
}

/** `Volatile{get()}` 引用（跨 cosmokit 副本无法用 symbol 判定，用协议鸭子类型）。 */
export function isVolatileRef(value: unknown): value is { get(): unknown } {
  return typeof value === 'object' && value !== null
    && typeof (value as { get?: unknown }).get === 'function'
}

/** 递归把 volatile 引用换成当前快照值；普通对象原样保留结构。 */
export function unwrapVolatile<T>(value: T): T {
  if (isVolatileRef(value)) return unwrapVolatile(value.get() as T)
  if (!isPlainObject(value)) return value
  const out: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) out[key] = unwrapVolatile(child)
  return out as T
}

/** 记录聚合条目当前解包后的配置，并通知所有订阅者。 */
export function setLiveConfig(next: Record<string, unknown>): void {
  live = next
  for (const listener of [...listeners]) {
    try { listener() } catch { /* 单个域失败不影响其它域 */ }
  }
}

/** 聚合条目当前解包后的配置（未设置时为空对象）。 */
export function getLiveConfig(): Record<string, unknown> {
  return live
}

/** 订阅聚合配置变化（返回退订函数）。 */
export function onLiveConfigChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** 登记一个域的配置读取器（由聚合层在挂载该域前调用）。 */
export function registerDomainConfig(namespace: string, reader: DomainConfigReader): void {
  readers.set(namespace, reader)
}

/** 按命名空间取域的配置读取器。 */
export function domainConfigReader(namespace: string): DomainConfigReader | undefined {
  return readers.get(namespace)
}
