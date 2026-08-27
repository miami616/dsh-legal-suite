/**
 * 系统目录选择（client-runtime workspaces.pickDirectory）。
 *
 * 与设置页同款能力：pickDirectory 是连接层 RPC（宿主弹原生目录选择框），
 * 任何面板都能调用。关键点：workspaces 是 cordis 服务，**挂载晚于各域的
 * apply(ctx)** —— 不能在 apply 时快照缓存（会拿到 undefined 导致永远返回
 * null，issue:「案件绑定/更换文件夹仍然不可用」），必须持有 ctx 引用、在
 * 点击时惰性解析。
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import DirectoryPickerDialog from '../domains/workspace-sidebar/client/DirectoryPickerDialog.tsx'

type WorkspacesFace = { pickDirectory?: () => Promise<string | null> }

declare global {
  interface Window {
    /**
     * 旧版 AgentLex 桌面渲染层（诉讼/非诉面板挂载的
     * Original*Panel）在 DSH web 下没有 Tauri 对话框，其「绑定/更换文件夹」
     * 按钮原本直接失效。本桥由插件 client apply 发布，旧版 UI 优先调用它
     * （见 legacy .../utils/directoryPicker.ts）。
     */
    __agentlexPickDirectory?: (initialPath?: string) => Promise<string | null>
    /** 最近一次目录选择失败的原因（诊断用；成功/取消时清空）。 */
    __agentlexPickLastError?: string
  }
}

let ctxRef: ClientContext | undefined

/** 由域入口注入 client ctx（apply(ctx) 时调用一次；只存引用不取服务）。 */
export function bindCaseWorkspaces(next: ClientContext | undefined): void {
  ctxRef = next
}

/** 记录最近一次失败原因（供旧版 UI 把诊断显示在界面上）。 */
function recordError(reason: string): void {
  if (typeof window !== 'undefined') {
    window.__agentlexPickLastError = reason
  }
  console.warn('[agentlex] pickDirectory:', reason)
}

/**
 * 应用内目录浏览框（browse 兜底）。
 *
 * `host.pickDirectory` 只在宿主装配 native 能力时可用（本机 loopback + 非 SSH
 * 的 darwin/win32/linux）；远程/SSH/非 loopback 部署下宿主解析成 browse 能力，
 * RPC 直接拒绝（"needs the native capability"）。此时退回套件自带的
 * DirectoryPickerDialog——它走宿主 HTTP 路由逐级浏览目录，任何环境可用。
 */
function openBrowseDirectoryDialog(initialPath: string): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    if (typeof document === 'undefined') {
      resolve(null)
      return
    }
    const host = document.createElement('div')
    host.style.position = 'fixed'
    host.style.inset = '0'
    host.style.zIndex = '2147483000'
    document.body.appendChild(host)
    let root: Root | undefined
    let settled = false
    const finish = (path: string | null): void => {
      if (settled) return
      settled = true
      root?.unmount()
      root = undefined
      host.remove()
      resolve(path)
    }
    try {
      root = createRoot(host)
      root.render(
        createElement(DirectoryPickerDialog, {
          open: true,
          initialPath,
          onConfirm: (path: string) => finish(path),
          onCancel: () => finish(null),
        }),
      )
    } catch (error) {
      console.warn('[agentlex] 目录浏览框挂载失败:', error)
      finish(null)
    }
  })
}

/** 打开系统目录选择框，返回所选绝对路径；取消/不可用时返回 null。 */
export async function pickDirectoryPath(initialPath = ''): Promise<string | null> {
  const workspaces = resolveWorkspaces()
  if (!workspaces || typeof workspaces.pickDirectory !== 'function') {
    const ctxKeys = ctxRef !== undefined ? Object.keys(ctxRef as object).slice(0, 12).join(',') : '(无 ctx)'
    const hasGet = ctxRef !== undefined && typeof (ctxRef as { get?: unknown }).get === 'function'
    recordError(`workspaces 服务解析失败（hasCtx=${ctxRef !== undefined}，hasGet=${hasGet}，ctxKeys=${ctxKeys}）`)
    return null
  }
  try {
    const picked = await workspaces.pickDirectory()
    if (picked !== null && picked !== '') {
      if (typeof window !== 'undefined') delete window.__agentlexPickLastError
      return picked
    }
    // 原生框返回 null = 用户取消（正常），不弹浏览框打扰。
    return null
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    recordError(`pickDirectory 调用失败: ${message}`)
    // 宿主能力为 browse（远程/SSH/非 loopback）时原生 RPC 被拒绝——
    // 退回应用内目录浏览框，让选择功能在任意环境可用。
    if (/native capability/i.test(message)) {
      if (typeof window !== 'undefined') delete window.__agentlexPickLastError
      return await openBrowseDirectoryDialog(initialPath)
    }
    return null
  }
}

/**
 * 解析 workspaces 服务（点击时调用，绝不缓存）。
 *
 * 取用顺序：① `ctx.get('workspaces')` —— cordis 规范取法，可穿透父子 scope
 * （runtime 内部即用此式）；② `.workspaces` 属性 —— 官方类型对 Context 的
 * 模块增强声明，部分宿主版本在 root ctx 上以属性形式暴露。
 */
function resolveWorkspaces(): WorkspacesFace | undefined {
  const ctx = ctxRef as unknown as
    | { get?: (name: string) => unknown; workspaces?: WorkspacesFace }
    | undefined
  if (ctx === undefined) return undefined
  try {
    if (typeof ctx.get === 'function') {
      const viaGet = ctx.get('workspaces') as WorkspacesFace | undefined
      if (viaGet && typeof viaGet.pickDirectory === 'function') return viaGet
    }
  } catch {
    /* 服务未注册时 get 可能抛错——落回属性访问 */
  }
  return ctx.workspaces
}

/**
 * 发布 window 目录选择桥（apply 时调用一次）。
 *
 * 旧版 AgentLex 渲染层（legacy UI，诉讼/非诉面板实际挂载的面板）没有 ctx，
 * 通过 `window.__agentlexPickDirectory` 调用本模块的 pickDirectoryPath()，
 * 从而在 DSH web 下也能弹原生目录选择框。返回清理函数（插件卸载时还原）。
 */
export function installAgentlexPickBridge(): () => void {
  if (typeof window === 'undefined') return () => {}
  const ours = (initialPath?: string): Promise<string | null> => pickDirectoryPath(initialPath ?? '')
  window.__agentlexPickDirectory = ours
  return () => {
    if (window.__agentlexPickDirectory === ours) {
      delete window.__agentlexPickDirectory
    }
  }
}
