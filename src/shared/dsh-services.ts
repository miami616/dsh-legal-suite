/**
 * cordis 客户端服务解析（跨代兼容的唯一取法）。
 *
 * 为什么不能直接写 `ctx.someService`：0.1.6-alpha.2 起客户端服务的访问者 ctx
 * 必须在注入表里显式声明该服务，否则属性访问直接抛
 * `cannot get property "xxx" without inject`（皮肤设置作用域绑定就踩了这个坑——
 * 异常被 catch 后只留一行 warning，功能静默失效）。cordis 的**根 ctx**没有注入
 * 限制，所以「root-first + `get()`」是既安全又不依赖 `export const inject` 的取法
 * （子 fiber 的 inject 在打包合并后不一定被 cordis 读取）。
 *
 * 属性访问只作为最后兜底，并且必须包在 try 里（严格代理同样会抛）。
 */

/** 任意可解析服务的 ctx（cordis Context 的结构最小面）。 */
export interface ServiceResolvableContext {
  get?(name: string): unknown
  root?: unknown
  [key: string]: unknown
}

/**
 * 解析一个 cordis 服务：root ctx → 当前 ctx；`get()` → 同名属性。
 * @param ctx - 任何 cordis client 上下文（子 fiber / root / 插件 ctx）。
 * @param name - 服务名（如 'sessions' / 'uiWorkspace' / 'workspaces'）。
 * @returns 服务实例，或 undefined（不存在/不可读）。
 */
export function serviceOf<T>(ctx: unknown, name: string): T | undefined {
  if (ctx === undefined || ctx === null) return undefined
  const root = (ctx as { root?: unknown }).root
  const candidates: unknown[] = [root, ctx]
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue
    const holder = candidate as ServiceResolvableContext
    const getter = holder.get
    if (typeof getter === 'function') {
      try {
        const value = getter.call(candidate, name)
        if (value !== undefined) return value as T
      } catch {
        /* 该 ctx 的注入表不含此服务/服务未注册——试下一个 */
      }
    }
    try {
      const direct = holder[name]
      if (direct !== undefined) return direct as T
    } catch {
      /* 严格代理拒绝属性访问——忽略 */
    }
  }
  return undefined
}

/** 目录选择服务面（宿主原生目录框；解析结果只在确认存在时才返回）。 */
export interface DirectoryPickerFace {
  pickDirectory(): Promise<string | null>
}

/**
 * 取「目录选择」服务面：0.1.3-alpha.2 起 `pickDirectory` 迁到 uiWorkspace；
 * 更早的 harness 只有 workspaces。只返回**真的带 `pickDirectory`** 的那个
 * （调用方据此判断能否走原生目录框，否则退回应用内浏览框）。
 * @param ctx - 插件 client ctx（或任何可解析 ctx）。
 */
export function resolveDirectoryPicker(ctx: unknown): DirectoryPickerFace | undefined {
  const viaWorkspaces = serviceOf<DirectoryPickerFace>(ctx, 'workspaces')
  if (typeof viaWorkspaces?.pickDirectory === 'function') return viaWorkspaces
  const viaUiWorkspace = serviceOf<DirectoryPickerFace>(ctx, 'uiWorkspace')
  if (typeof viaUiWorkspace?.pickDirectory === 'function') return viaUiWorkspace
  return undefined
}
