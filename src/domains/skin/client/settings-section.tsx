/**
 * AgentLex 设置页。
 *
 * - AgentLexSettingsSection：注册 `settings.section`「AgentLex 设置」——外观主题 / 品牌与欢迎语 / 数据目录 / 模块开关。
 *
 * 注：原独立的「桌面」settings.section（Profile 切换 / 桌面通知）已按需求移除，
 * 相关实现（DesktopSettingsSection / DesktopNotificationSettings）一并删除。
 */
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { IWorkspaces, SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the slots contract merge (agentlex.workbench.item declared below).
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { getSkinConfig, setSkinConfig, useSkinConfig, type AgentLexSkinConfig } from './config.ts'
import { AGENTLEX_THEMES } from './themes.ts'
// 目录选择弹层（工作区域提供）：远程端登录无原生目录框时回退到它浏览/输入路径。
import DirectoryPickerDialog from '../../workspace-sidebar/client/DirectoryPickerDialog.tsx'
// 运行中插件版本：跨域复用 litigation 域的 self-version 接口（零网络开销）。
import { getSelfPluginVersion } from '../../litigation/client/api.ts'

/**
 * agentlex.workbench.item — 套件内设置槽位契约（由本页拥有）。
 *
 * AgentLex 设置设置页通过 children 声明该槽位，并用 props.renderSlot 把注册项
 * 渲染为页面内的设置块（litigation 的「插件版本与更新」：版本检测 + 一键更新 +
 * 版本更新管理）。声明即认领：只有本页可以渲染该槽位。
 */
export interface AgentLexWorkbenchItemOwnerProps {
  /** Marker field: workbench item owner props are intentionally empty. */
  children?: never
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'agentlex.workbench.item': {
      kind: 'list'
      scope: 'root'
      owner: AgentLexWorkbenchItemOwnerProps
    }
  }
}

let scope: SettingsScope<AgentLexSkinConfig> | undefined

/** 远程端（如 dsh-bridge 远程登录）下 settingsScope 可能晚于本页就绪；
 * 设置页检测到 scope 未绑定时调用该回调，让 skin client 重试 bind。 */
let retryBindScope: (() => void) | null = null

/** 设置页暴露给 skin client：登记 scope 绑定结果（scope 仅在写入时需要；渲染用本地 config）。 */
export function bindAgentLexSettingsScope(next: SettingsScope<AgentLexSkinConfig> | undefined): void {
  scope = next
}

/** skin client 在 apply 时登记「重试 bind」；设置页在 scope 缺失时用于重试写入路径。 */
export function bindScopeRetryHooks(retry: () => void): void {
  retryBindScope = retry
}

/** Module data-dir scopes (settings UI: 数据目录 fields, host migrates on change). */
let litigationScope: SettingsScope<{ dataDir?: string }> | undefined
let nonlitigationScope: SettingsScope<{ dataDir?: string }> | undefined

export function bindModuleDataDirScopes(
  next: {
    litigation: SettingsScope<{ dataDir?: string }> | undefined
    nonlitigation: SettingsScope<{ dataDir?: string }> | undefined
  },
): void {
  litigationScope = next.litigation
  nonlitigationScope = next.nonlitigation
}

/** DSH 工作区服务（client-runtime 注入；pickDirectory() 打开宿主系统目录选择框）。 */
let workspaces: IWorkspaces | undefined

export function bindWorkspaces(next: IWorkspaces | undefined): void {
  workspaces = next
}

/** 打开系统目录选择框，返回所选绝对路径；取消/不可用时返回 null。 */
async function pickDirectoryPath(): Promise<string | null> {
  if (!workspaces) return null
  try {
    return await workspaces.pickDirectory()
  } catch {
    return null
  }
}

/** URL 形态的值不是合法目录路径（如误入的 LLM 接口地址）。 */
const URLISH_PATH = /^[a-z][a-z0-9+.-]*:\/\//i

/**
 * 设置项写入的统一入口。远程端（dsh-bridge 远程登录）下 settingsScope 服务不可用，
 * scope 为 undefined，`scope.set` 会是 no-op（点击无反应）。这里在 scope 可用时仍
 * 走 scope.set（host 持久化），且**始终**更新本地 skin config（setSkinConfig →
 * UI 立即切换 + 主题/品牌 localStorage 兜底 + 驱动模块启停），保证任意环境下点击
 * 都有即时反馈。
 */
function commitSetting<K extends keyof AgentLexSkinConfig>(key: K, value: AgentLexSkinConfig[K]): void {
  if (scope) void scope.set(key, value)
  setSkinConfig({ [key]: value })
}

/** Subscribe a module data-dir scope (value key: dataDir)。URL 形态异常值按空处理。 */
function useDataDirValue(subject: SettingsScope<{ dataDir?: string }> | undefined): string {
  const raw = useSyncExternalStore(
    (listener) => (subject ? subject.subscribe(listener) : () => {}),
    () => subject?.getSnapshot().value?.dataDir ?? '',
  )
  return URLISH_PATH.test(raw.trim()) ? '' : raw
}

function Field({ label, description, value, onCommit, commitEmpty = false, onPick }: {
  label: string
  description?: string
  value: string
  onCommit: (v: string) => void
  commitEmpty?: boolean
  /** 显示「选择目录…」按钮（数据目录字段用，走 DSH native directory picker）。 */
  onPick?: () => void
}) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
      <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--dsw-alias-label-secondary)' }}>{label}</span>
      {description !== undefined && (
        <span style={{ fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary)' }}>{description}</span>
      )}
      <span style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          defaultValue={value}
          key={value}
          onBlur={(e) => { const v = e.target.value.trim(); if (v || commitEmpty) onCommit(v) }}
          style={{
            boxSizing: 'border-box',
            flex: 1,
            minWidth: 0,
            height: 36,
            padding: '0 10px',
            border: '1px solid var(--dsw-alias-border-l2)',
            borderRadius: 8,
            background: 'var(--dsw-specific-input-major)',
            color: 'var(--dsw-alias-label-primary)',
            fontSize: 14,
            outline: 'none',
          }}
        />
        {onPick !== undefined && (
          <button
            type="button"
            onClick={onPick}
            style={{
              flex: 'none',
              height: 36,
              padding: '0 14px',
              border: '1px solid var(--dsw-alias-border-l2)',
              borderRadius: 8,
              background: 'var(--dsw-specific-input-major)',
              color: 'var(--dsw-alias-label-primary)',
              fontSize: 13,
              fontWeight: 550,
              cursor: 'pointer',
            }}
          >
            选择目录…
          </button>
        )}
      </span>
    </label>
  )
}

function Toggle({ label, description, checked, onChange, disabled = false }: {
  label: string
  description?: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '8px 0',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--dsw-alias-label-secondary)' }}>{label}</span>
        {description !== undefined && (
          <span style={{ fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary)' }}>{description}</span>
        )}
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 18, height: 18, accentColor: 'var(--dsw-alias-state-business-primary)' }}
      />
    </label>
  )
}

/** 主题配色选择卡片：三色色卡 + 名称 + 描述，点击即时预览并持久化。 */
function ThemePicker({ value, onSelect }: { value: string; onSelect: (key: string) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 8 }}>
      {AGENTLEX_THEMES.map((t) => {
        const active = t.core.key === value
        return (
          <button
            key={t.core.key}
            type="button"
            onClick={() => onSelect(t.core.key)}
            title={t.core.desc}
            style={{
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              padding: 10,
              borderRadius: 12,
              border: `1.5px solid ${active ? 'var(--dsw-alias-state-business-primary)' : 'var(--dsw-alias-border-l2)'}`,
              background: active ? 'var(--dsw-alias-state-business-tertiary)' : 'var(--dsw-specific-input-major)',
              color: 'var(--dsw-alias-label-primary)',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <span style={{ display: 'flex', height: 26, borderRadius: 7, overflow: 'hidden', border: '1px solid var(--dsw-alias-border-l2)' }}>
              <span style={{ flex: 1.2, background: t.core.swatch[0] }} />
              <span style={{ flex: 1.6, background: t.core.swatch[1] }} />
              <span style={{ flex: 1, background: t.core.swatch[2] }} />
            </span>
            <span style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{t.core.label}</span>
              {active && (
                <span style={{ fontSize: 11, color: 'var(--dsw-alias-state-business-primary)', fontWeight: 600 }}>使用中</span>
              )}
            </span>
            <span style={{ fontSize: 11.5, lineHeight: 1.45, color: 'var(--dsw-alias-label-tertiary)' }}>
              {t.core.desc}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** 构建注入的插件版本（tsdown define，见 tsdown.config.ts）。 */
declare const __PLUGIN_VERSION__: string

/** AgentLex 设置（外观 / 品牌 / 数据目录 / 模块开关 + 套件设置槽位）。
 *  renderSlot：框架注入的已声明子槽渲染面（agentlex.workbench.item）。 */
export function AgentLexSettingsSection(props: {
  close?: () => void
  renderSlot: (key: 'agentlex.workbench.item', owner: AgentLexWorkbenchItemOwnerProps) => ReactNode
}): React.JSX.Element | null {
  const config = useSkinConfig()
  const litigationDataDir = useDataDirValue(litigationScope)
  const nonlitigationDataDir = useDataDirValue(nonlitigationScope)
  /** 数据目录存储值被异常数据（URL 等）污染时自愈并提示。 */
  const [dataDirHealMsg, setDataDirHealMsg] = useState('')
  useEffect(() => {
    const scan = (name: string, subject: SettingsScope<{ dataDir?: string }> | undefined): void => {
      const raw = subject?.getSnapshot().value?.dataDir ?? ''
      if (URLISH_PATH.test(raw.trim())) {
        console.warn(`[agentlex-skin] ${name} 数据目录存储值异常（非路径，疑似 URL），自动清除`, raw)
        void subject?.unset('dataDir')
        setDataDirHealMsg((prev) => (prev === '' ? `已自动清除「${name}」中的异常路径值（其值不是目录路径，可能来自旧版本误填）` : prev))
      }
    }
    scan('诉讼案件', litigationScope)
    scan('非诉项目', nonlitigationScope)
  }, [])
  /** 运行中插件版本（self-version 接口；失败回退构建期常量）。 */
  const [selfVersion, setSelfVersion] = useState('')
  useEffect(() => {
    let mounted = true
    void getSelfPluginVersion().then((v) => { if (mounted && v !== '') setSelfVersion(v) })
    return () => { mounted = false }
  }, [])
  // 目录选择弹层目标：原生选择框在远程端不可用（pickDirectory 返回 null）时打开。
  const [dirPicker, setDirPicker] = useState<'litigation' | 'nonlitigation' | null>(null)
  // 远程端（dsh-bridge 远程登录）下 settingsScope 可能不可用 → scope 为 undefined。
  // 渲染只依赖本地 skin 配置（config 取自 useSkinConfig，恒有值），scope 仅用于写入
  // （可选）。因此设置页始终完整渲染，绝不因 scope 缺失而空白/加载中阻塞。
  useEffect(() => {
    if (scope) return
    const t = setTimeout(() => { retryBindScope?.() }, 120)
    return () => { clearTimeout(t) }
  }, [scope])

  return (
    <div style={{ maxWidth: 520, width: '100%' }}>
      {/* 顶部标题区：品牌名 + 版本 + 一句话定位 */}
      <div style={{ marginBottom: 18, paddingBottom: 14, borderBottom: '1px solid var(--dsw-alias-border-l2)' }}>
        <p style={{ margin: '0 0 2px', fontSize: 20, fontWeight: 750, letterSpacing: 0.2, color: 'var(--dsw-alias-label-primary)' }}>
          {config.brandEn}
          <span style={{ marginLeft: 8, fontSize: 12.5, fontWeight: 500, color: 'var(--dsw-alias-label-tertiary)' }}>
            {config.brandZh} · 版本 {selfVersion || (typeof __PLUGIN_VERSION__ === 'string' ? __PLUGIN_VERSION__ : '')}
          </span>
        </p>
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: 'var(--dsw-alias-label-tertiary)' }}>
          基于 DeepSeek Harness（DSH）的法律事务助理套件：诉讼案件 · 非诉项目 · 任务管理。
        </p>
      </div>

      {/* ① 启用 AgentLex 总开关 */}
      <div style={{ marginBottom: 18 }}>
        <Toggle
          label="启用 AgentLex"
          description="关闭后皮肤、诉讼/非诉/任务、技能与工具、工作区右边栏全部停用，回到 DSH 原生界面"
          checked={config.agentlexEnabled}
          onChange={(v) => commitSetting('agentlexEnabled', v)}
        />
      </div>

      {/* ② 外观（皮肤 + 主题 + 会话排版） */}
      <div style={{ marginBottom: 18 }}>
        <p style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 650, color: 'var(--dsw-alias-label-primary)' }}>外观</p>
        <Toggle
          label="AgentLex 皮肤"
          description="外壳与三模块的主题皮肤；关闭后恢复 DSH 原生外观"
          checked={config.skinEnabled}
          disabled={!config.agentlexEnabled}
          onChange={(v) => commitSetting('skinEnabled', v)}
        />
        <div style={{ opacity: config.agentlexEnabled && config.skinEnabled ? 1 : 0.5, pointerEvents: config.agentlexEnabled && config.skinEnabled ? 'auto' : 'none' }}>
          <div style={{ margin: '10px 0 4px' }}>
            <ThemePicker value={config.theme} onSelect={(key) => commitSetting('theme', key)} />
          </div>
          <Toggle
            label="会话正文两端对齐"
            description="AI 输出与用户消息两端对齐，字距紧凑"
            checked={config.conversationJustify}
            onChange={(v) => commitSetting('conversationJustify', v)}
          />
          <Toggle
            label="会话排版增强"
            description="行距段距与原生一致、背景块可见、彩色表头"
            checked={config.conversationEnhance}
            onChange={(v) => commitSetting('conversationEnhance', v)}
          />
        </div>
      </div>

      {/* ③ 品牌 */}
      <div style={{ marginBottom: 18 }}>
        <p style={{ margin: '0 0 10px', paddingTop: 8, borderTop: '1px solid var(--dsw-alias-border-l2)', fontSize: 15, fontWeight: 650, color: 'var(--dsw-alias-label-primary)' }}>品牌</p>
        <Field label="品牌英文" value={config.brandEn} onCommit={(v) => commitSetting('brandEn', v)} />
        <Field label="品牌中文" value={config.brandZh} onCommit={(v) => commitSetting('brandZh', v)} />
        <Field label="欢迎语称呼" description="新会话欢迎语中的称呼" value={config.userName} onCommit={(v) => commitSetting('userName', v)} />
      </div>

      {/* ④ 功能模块 */}
      <div style={{ marginBottom: 18 }}>
        <p style={{ margin: '0 0 10px', paddingTop: 8, borderTop: '1px solid var(--dsw-alias-border-l2)', fontSize: 15, fontWeight: 650, color: 'var(--dsw-alias-label-primary)' }}>功能模块</p>
        <Toggle label="诉讼案件" description="案件看板 / 详情 / 任务树 / 时间轴 / 期限提醒" checked={config.litigationEnabled} disabled={!config.agentlexEnabled} onChange={(v) => commitSetting('litigationEnabled', v)} />
        <Toggle label="非诉项目" description="项目管理 / 合同审查 / 法律研究 / 常法服务" checked={config.nonlitigationEnabled} disabled={!config.agentlexEnabled} onChange={(v) => commitSetting('nonlitigationEnabled', v)} />
        <Toggle label="任务管理" description="独立任务 + 跨插件统一任务视图" checked={config.taskEnabled} disabled={!config.agentlexEnabled} onChange={(v) => commitSetting('taskEnabled', v)} />
        <Toggle label="技能与工具" description="技能 / MCP 面板与输入框选择" checked={config.skillsToolsEnabled} disabled={!config.agentlexEnabled} onChange={(v) => commitSetting('skillsToolsEnabled', v)} />
        <Toggle label="工作区右边栏" description="会话右侧文件树 / 预览 / 搜索" checked={config.workspaceSidebarEnabled} disabled={!config.agentlexEnabled} onChange={(v) => commitSetting('workspaceSidebarEnabled', v)} />
        <div style={{ paddingLeft: 22, opacity: config.agentlexEnabled && config.workspaceSidebarEnabled ? 1 : 0.5, pointerEvents: config.agentlexEnabled && config.workspaceSidebarEnabled ? 'auto' : 'none' }}>
          <Toggle
            label="侧边栏打开文件/链接"
            description="点击会话中的文件路径在右侧栏定位；仅 md 文件预览"
            checked={config.openReferencesInSidebar}
            onChange={(v) => commitSetting('openReferencesInSidebar', v)}
          />
        </div>
      </div>

      {/* ⑤ 数据与存储 */}
      <div style={{ marginBottom: 18 }}>
        <p style={{ margin: '0 0 10px', paddingTop: 8, borderTop: '1px solid var(--dsw-alias-border-l2)', fontSize: 15, fontWeight: 650, color: 'var(--dsw-alias-label-primary)' }}>数据与存储</p>
        {dataDirHealMsg !== '' && (
          <p style={{ margin: '0 0 10px', padding: '8px 10px', borderRadius: 8, fontSize: 12, background: 'var(--dsw-alias-state-warning-tertiary)', color: 'var(--dsw-alias-state-warning-primary)' }}>
            {dataDirHealMsg}
          </p>
        )}
        <Field
          label="诉讼案件数据目录"
          description="留空恢复默认 ~/.dsh/agentlex/litigation"
          value={litigationDataDir}
          commitEmpty
          onCommit={(v) => { if (v === '') void litigationScope?.unset('dataDir'); else void litigationScope?.set('dataDir', v) }}
          onPick={async () => {
            const picked = await pickDirectoryPath()
            if (picked !== null && picked !== '') void litigationScope?.set('dataDir', picked)
            else setDirPicker('litigation')
          }}
        />
        <Field
          label="非诉项目数据目录"
          description="留空恢复默认 ~/.dsh/agentlex/nonlitigation"
          value={nonlitigationDataDir}
          commitEmpty
          onCommit={(v) => { if (v === '') void nonlitigationScope?.unset('dataDir'); else void nonlitigationScope?.set('dataDir', v) }}
          onPick={async () => {
            const picked = await pickDirectoryPath()
            if (picked !== null && picked !== '') void nonlitigationScope?.set('dataDir', picked)
            else setDirPicker('nonlitigation')
          }}
        />
        <p style={{ margin: '4px 0 12px', fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }}>
          切换目录后原数据自动迁移到新目录；预设会话的工作区文件夹跟随此目录（中文标题「诉讼管家 / 非诉管家」）。
        </p>
      </div>

      {/* ⑥ 套件 */}
      <div style={{ marginTop: 12, paddingTop: 8, borderTop: '1px solid var(--dsw-alias-border-l2)' }}>
        <p style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 650, color: 'var(--dsw-alias-label-primary)' }}>套件</p>
        {props.renderSlot('agentlex.workbench.item', {})}
      </div>

      {/* 关于 */}
      <div style={{ marginTop: 12, paddingTop: 8, borderTop: '1px solid var(--dsw-alias-border-l2)' }}>
        <p style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 650, color: 'var(--dsw-alias-label-primary)' }}>关于</p>
        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.7, color: 'var(--dsw-alias-label-tertiary)' }}>
          {config.brandZh}（{config.brandEn}）是面向法律事务的 DSH 插件套件，将诉讼案件、非诉项目、
          任务管理三大业务模块改造为 DSH 原生插件：案件看板与期限提醒、合同审查与法律研究、
          跨插件统一任务视图；并配套外壳皮肤、工作区右边栏与技能 / MCP 工具平台。
          业务数据默认存放于 ~/.dsh/agentlex/（可自定义路径，切换自动迁移），与桌面应用数据分离。
        </p>
      </div>
      {dirPicker !== null && (
        <DirectoryPickerDialog
          open
          initialPath={dirPicker === 'litigation' ? litigationDataDir : nonlitigationDataDir}
          onConfirm={(path) => {
            if (dirPicker === 'litigation') void litigationScope?.set('dataDir', path)
            else void nonlitigationScope?.set('dataDir', path)
            setDirPicker(null)
          }}
          onCancel={() => setDirPicker(null)}
        />
      )}
    </div>
  )
}
