/**
 * dsh-legal-suite/shared — 跨 harness 版本的 settings 注册适配器。
 *
 * `ctx.settings` 服务在宿主 harness 的不同版本里暴露过三种接口：
 *   1. rc.2 静态 API：`settingsNamespace(...)` + 自由函数（本包仅在编译期依赖，
 *      运行时不由它提供 `settings` 服务）。
 *   2. alpha2 早期服务方法：`ctx.settings.installSection(owner, ns, schema,
 *      entry, hooks)`。
 *   3. alpha2 现行服务方法：`ctx.settings.register(ns, schema, {base, applies,
 *      validate}) -> SettingsScope{get, watch, update, replace}`。
 *
 * 本适配器对业务域暴露统一入口 `installSettingsSection(...)`，内部按当前宿主
 * 实际提供的 API 选择实现：
 *   - `register` 可用 → 走现行 live 语义（scope.watch 驱动 onChange）；
 *   - 否则 `installSection` 可用 → 走旧方法；
 *   - 都没有 → 仅以 composition entry 兜底并告警。
 *
 * 关键：任何 settings 注册失败都【绝不抛出】——否则业务的 `apply` 会在
 * `ctx.webServer.register` 之前中断，导致整域 REST 路由缺失（浏览器 404）。
 * 这正是 0.1.17 备忘录/诉讼/非诉/任务路由 404，而皮肤（已被防御包裹）正常的根因。
 */
import type { Context } from '@deepseek-ai/cordis'
import type z from '@deepseek-ai/schemastery'
import { domainConfigReader, onLiveConfigChange } from './live-config.ts'

/** 与历史 installSection 相同的 owner-side 生命周期钩子。 */
export interface SettingsSectionHooks<T> {
  /** 接收当前生效的配置源（已注册时的 resolved scope，否则 composition entry）。 */
  setSource(current: () => T): void
  /** 在 attach/detach/change 后重判任何派生状态。 */
  onChange(): void
}

/**
 * 统一注册 settings 分区。返回一个 dispose 函数；调用方（业务域）应把其并入
 * fiber 生命周期清理。此函数永不抛错。
 */
export function installSettingsSection<T>(
  ctx: Context,
  ns: string,
  schema: z<T>,
  entry: T,
  hooks: SettingsSectionHooks<T>,
): () => void {
  const settings = (ctx as unknown as {
    settings?: {
      // 现行 API
      register?: <V>(n: string, s: z<V>, opts?: { base?: Partial<V>; applies?: 'live' | 'restart' }) => {
        get: () => V
        watch: (cb: () => void) => () => void
      }
      // 旧 alpha2 API
      installSection?: (owner: unknown, n: string, s: z<unknown>, e: unknown, h: unknown) => void
      // rc.2
      get?: (n: string) => unknown
    }
  }).settings

  // 1) 现行 alpha2 register API。
  if (typeof settings?.register === 'function') {
    try {
      const scope = settings.register(ns, schema as z<typeof entry>, { base: entry })
      // scope.get() 已把 schema defaults + base + user layer 解析成完整值，
      // 直接作为当前源。
      hooks.setSource(() => scope.get())
      const disposeWatch = scope.watch(() => hooks.onChange())
      // register 的生命周期挂在调用 fiber 上；disposeWatch 为保险冗余清理。
      return () => { disposeWatch() }
    } catch (error) {
      console.warn(`[agentlex-suite] settings.register("${ns}") failed:`, error instanceof Error ? error.message : String(error))
    }
  }

  // 2) 旧 alpha2 installSection API。
  if (typeof settings?.installSection === 'function') {
    try {
      settings.installSection(ctx, ns, schema as z<unknown>, entry, {
        setSource: hooks.setSource,
        onChange: hooks.onChange,
      })
      // installSection 已把注册挂在 owner fiber 上，无需额外清理。
      return () => {}
    } catch (error) {
      console.warn(`[agentlex-suite] settings.installSection("${ns}") failed:`, error instanceof Error ? error.message : String(error))
    }
  }

  // 3) 0.1.7-alpha.1 起：harness 用 SettingsForms 取代命名空间注册
  //    （register/installSection/get 全部下线），配置取自「loader 条目自己的
  //    cordis Config」，且只有 `.volatile()` 字段可编辑。合包后各域不是独立条目，
  //    聚合层把它们的字段并到 agentlex 条目上，并在此登记「按命名空间读取当前值」
  //    的读取器；条目配置经 loader/volatile-update 就地更新（不 remount），
  //    所以这里既读镜像也要在事件后触发 onChange。
  if (typeof (settings as unknown as { configure?: unknown } | undefined)?.configure === 'function') {
    const reader = domainConfigReader(ns)
    hooks.setSource(() => {
      if (reader === undefined) return entry
      const value = reader()
      return (value === undefined || value === null ? entry : value) as T
    })
    // ⚠ 不能在这里监听 `loader/volatile-update`：该事件由 loader 带 fiber 过滤发出
    // （只投递给条目自身 fiber 的 ctx），子域是嵌套 fiber，收不到。改订阅聚合层的
    // 进程内镜像变化——聚合层持有条目引用并转发事件。
    const off = onLiveConfigChange(() => { hooks.onChange() })
    return () => { off() }
  }

  // 4) 兜底：无 settings 服务或两代接口皆不可用，仅以 composition entry 作为源。
  if (typeof settings === 'undefined' || (typeof settings.register !== 'function' && typeof settings.installSection !== 'function')) {
    console.warn(`[agentlex-suite] settings service unavailable for "${ns}" — using composition defaults`)
  }
  hooks.setSource(() => entry)
  return () => {}
}
