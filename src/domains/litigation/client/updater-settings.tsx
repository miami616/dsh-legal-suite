/**
 * 「设置 → AgentLex 设置 → 插件版本与更新」设置块（agentlex.workbench.item
 * 槽位，由 dsh-skin 的工作台设置页渲染）。
 *
 * - 版本与更新：显示已安装版本，通过宿主 /api/agentlex-case/plugin-version
 *   检测公共 npm registry 最新版；有新版本时提供「立即更新」，走宿主
 *   /api/agentlex-case/plugin-update（备份 → pnpm 升级），完成后提示重启
 *   DSH 生效。
 *
 * 只 import 浏览器安全的模块（api.ts / i18n.ts）；界面优先展示运行中版本
 * （self-version 接口，服务端启动时读安装目录 package.json），构建期 define
 * 的 __PLUGIN_VERSION__ 仅作接口不可用时的兜底，与宿主 updater.ts 无关。
 */
import { useEffect, useState } from 'react'
import {
  cancelPluginUpdate,
  checkPluginUpdate,
  fixPluginPolicy,
  getSelfPluginVersion,
  getPluginUpdateStatus,
  runPluginUpdate,
  type PluginUpdateResult,
  type PluginVersionCheck,
  type PluginUpdateTriple,
  type UpdateProgress,
} from './api.ts'
import { tt, errorMessage } from './i18n.ts'

/** 当前运行中的诉讼插件版本（构建时由 tsdown define 注入）。 */
declare const __PLUGIN_VERSION__: string

/** 桌面壳（AgentLex Desktop）preload 暴露的宿主重启入口；网页环境无此 API。 */
declare global {
  interface Window {
    dshDesktopApp?: { restartHarness: () => Promise<{ ok: boolean }> }
  }
}

/** 套件成员显示名（与宿主 updater.ts 的 PACKAGE_LABELS 保持一致）。 */
const PACKAGE_LABELS: Record<string, string> = {
  'dsh-legal-suite': '法律套件组合包',
  'dsh-litigation': '诉讼案件插件',
  'dsh-nonlitigation': '非诉项目插件',
  'dsh-task': '任务中心插件',
  'dsh-skin': 'AgentLex 皮肤',
  'dsh-workspace-sidebar': '工作区右边栏',
  'dsh-adapter': '兼容适配层',
}

const NPM_URL = 'https://www.npmjs.com/package/dsh-legal-suite'

/** 字节数人性化（下载进度显示）。 */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${unit === 0 || value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

function label(pkg: string): string {
  return PACKAGE_LABELS[pkg] ?? pkg
}

/** 一行版本信息：包名 + 已安装 → 最新 + 状态徽标（接线状态三态 + 未装配）。 */
function VersionRow({
  pkg,
  installed,
  latest,
  update,
  loadState,
  unassembled,
}: {
  pkg: string
  installed: string
  latest?: string
  update?: PluginUpdateTriple
  loadState?: 'enabled' | 'installed' | 'missing'
  /** 套件最新版声明但本 profile 未装配（桌面版不内置/需更新组合包）——不显示误导的「可安装」。 */
  unassembled?: boolean
}) {
  // 徽标优先级：可更新 > 已安装未启用（黄） > 未装配（灰，明确不装） > 未安装 > 已是最新。
  let badge: React.JSX.Element
  if (update !== undefined) {
    badge = (
      <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--dsw-alias-state-business-primary)', background: 'var(--dsw-alias-state-business-tertiary)', padding: '2px 8px', borderRadius: 999 }}>
        可更新 {update.to}
      </span>
    )
  } else if (loadState === 'installed') {
    badge = (
      <span title="文件已就位，但未被启动链路引用（不在组合包 cordis.patch.yml 或 bundles 中）——重启也不会加载" style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--dsw-alias-state-warning-primary)', background: 'var(--dsw-alias-state-warning-tertiary)', padding: '2px 8px', borderRadius: 999 }}>
        已安装未启用
      </span>
    )
  } else if (unassembled === true) {
    badge = (
      <span title="本 profile 的装配链未包含它（组合包未引用/未声明），不会自动安装" style={{ fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary)', padding: '2px 8px', borderRadius: 999, border: '1px solid var(--dsw-alias-border-l2)' }}>
        未装配
      </span>
    )
  } else if (loadState === 'missing') {
    badge = (
      <span style={{ fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary)', padding: '2px 8px', borderRadius: 999, border: '1px solid var(--dsw-alias-border-l2)' }}>
        未安装
      </span>
    )
  } else {
    badge = (
      <span style={{ fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary)', padding: '2px 8px', borderRadius: 999, border: '1px solid var(--dsw-alias-border-l2)' }}>
        已是最新
      </span>
    )
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '9px 0', borderBottom: '1px solid var(--dsw-alias-border-l1)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--dsw-alias-label-primary)' }}>{label(pkg)}</span>
        <span style={{ fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary)' }}>
          {installed}{latest !== undefined && latest !== installed ? ` → ${latest}` : ''}
        </span>
        {loadState === 'installed' && (
          <span style={{ fontSize: 11, color: 'var(--dsw-alias-state-warning-primary)' }}>
            已安装但未接入启动链路：重启不会加载，请先更新「法律套件组合包」或检查 profile bundles。
          </span>
        )}
      </div>
      {badge}
    </div>
  )
}

/** 「插件版本与更新」设置块（挂在 AgentLex 设置设置页内）。 */
export function PluginUpdaterSettings(): React.JSX.Element {
  const [phase, setPhase] = useState<'idle' | 'checking' | 'ready' | 'error' | 'updating' | 'done'>('idle')
  const [check, setCheck] = useState<PluginVersionCheck | null>(null)
  /** 运行中版本（self-version 接口；失败回退构建期常量）。 */
  const [selfVersion, setSelfVersion] = useState('')
  useEffect(() => {
    let mounted = true
    void getSelfPluginVersion().then((v) => { if (mounted && v !== '') setSelfVersion(v) })
    return () => { mounted = false }
  }, [])
  const [result, setResult] = useState<PluginUpdateResult | null>(null)
  const [errorText, setErrorText] = useState<string | null>(null)
  const [progress, setProgress] = useState<UpdateProgress | null>(null)
  const [fixing, setFixing] = useState(false)
  const [fixMsg, setFixMsg] = useState<string | null>(null)

  /** 桌面环境：请求宿主重启 harness（新版本宿主代码生效）；网页环境仅能刷新。 */
  const restartDsh = async (): Promise<void> => {
    try {
      setErrorText(null)
      await window.dshDesktopApp?.restartHarness()
    } catch (error) {
      setErrorText(`重启失败：${errorMessage(error)}`)
    }
  }

  const runCheck = async (): Promise<void> => {
    setPhase('checking')
    setErrorText(null)
    try {
      const c = await checkPluginUpdate()
      setCheck(c)
      if (c.error !== undefined && c.error !== '') {
        setErrorText(c.error)
        setPhase('error')
      } else {
        setPhase('ready')
      }
    } catch (error) {
      setErrorText(errorMessage(error))
      setPhase('error')
    }
  }

  const runUpdate = async (): Promise<void> => {
    if (check === null || !check.updateAvailable) return
    const n = String(check.updates.length)
    if (!window.confirm(tt('updater.confirm', { n }))) return
    setPhase('updating')
    setErrorText(null)
    setProgress(null)
    // 轮询进度快照：下载字节/阶段/步骤实时展示；更新请求返回后停止轮询。
    const poll = window.setInterval(() => {
      void getPluginUpdateStatus().then(setProgress).catch(() => undefined)
    }, 600)
    try {
      setResult(await runPluginUpdate())
      await getPluginUpdateStatus().then(setProgress).catch(() => undefined)
      setPhase('done')
    } catch (error) {
      setErrorText(errorMessage(error))
      setPhase('error')
    } finally {
      window.clearInterval(poll)
    }
  }

  const cancelRunning = async (): Promise<void> => {
    try {
      await cancelPluginUpdate()
    } catch (error) {
      setErrorText(errorMessage(error))
    }
  }

  /** 一键修复 pnpm 供应链策略（minimumReleaseAge）拦截并重试更新。 */
  const handlePolicyFix = async (): Promise<void> => {
    setFixing(true)
    setFixMsg(null)
    try {
      const result = await fixPluginPolicy()
      if (!result.ok) {
        setFixMsg(result.error ?? '修复失败')
        return
      }
      setFixMsg(result.added.length > 0
        ? `已放行：${result.added.join('、')}，正在重试更新…`
        : '策略已放行，正在重试更新…')
      await runUpdate()
    } catch (error) {
      setFixMsg(`修复失败：${errorMessage(error)}`)
    } finally {
      setFixing(false)
    }
  }

  /** 错误文本是否命中供应链策略拦截。 */
  const isPolicyViolation = (text: string | undefined): boolean =>
    text !== undefined && text.includes('MINIMUM_RELEASE_AGE_VIOLATION')

  const progressPercent = (): number | null => {
    const p = progress
    if (p === null || !p.totalBytes || p.totalBytes <= 0) return null
    return Math.min(100, Math.round(((p.receivedBytes ?? 0) / p.totalBytes) * 100))
  }

  const PHASE_LABEL: Record<string, string> = {
    checking: '检查中…',
    installing: '安装中…',
  }

  const button: React.CSSProperties = {
    height: 34,
    padding: '0 14px',
    borderRadius: 8,
    border: 0,
    background: 'var(--dsw-alias-state-business-primary)',
    color: 'var(--dsw-alias-label-primary-inverted)',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  }
  const ghostButton: React.CSSProperties = {
    height: 34,
    padding: '0 14px',
    borderRadius: 8,
    border: '1px solid var(--dsw-alias-border-l2)',
    background: 'var(--dsw-specific-input-major)',
    color: 'var(--dsw-alias-label-primary)',
    fontSize: 13,
    cursor: 'pointer',
  }

  return (
    <div style={{ maxWidth: 520 }}>
      <div style={{ marginBottom: 14 }}>
        <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }}>{tt('updater.title')}</p>
        <p style={{ margin: '0 0 8px', fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary)' }}>
          {tt('updater.currentPlugin', { version: selfVersion || __PLUGIN_VERSION__ })} · {tt('updater.channel')}
        </p>
      </div>

      {phase === 'idle' && (
        <div style={{ marginBottom: 14 }}>
          <p style={{ margin: '0 0 10px', fontSize: 12.5, lineHeight: 1.6, color: 'var(--dsw-alias-label-tertiary)' }}>
            检查与更新均为手动触发：打开本页或应用启动时不会自动联网检查，也不会自动安装更新。
            点击「检查更新」后才会查询公共 npm registry；有新版时由你确认后再安装。
          </p>
          <button type="button" onClick={() => void runCheck()} style={button}>{tt('updater.checkNow')}</button>
        </div>
      )}

      {phase === 'checking' && (
        <p style={{ margin: '8px 0', fontSize: 13, color: 'var(--dsw-alias-label-secondary)' }}>{tt('updater.checking')}…</p>
      )}

      {phase === 'error' && check !== null && (
        <div style={{ marginBottom: 12 }}>
          {Object.keys(check.loadState ?? {}).map((pkg) => (
            <VersionRow key={pkg} pkg={pkg} installed={check.installed[pkg] ?? '—'} latest={check.latest[pkg]} loadState={check.loadState[pkg]} />
          ))}
        </div>
      )}
      {phase === 'error' && (
        <>
          <p style={{ margin: '0 0 12px', fontSize: 12.5, color: 'var(--dsw-alias-state-error-primary)' }}>
            {errorText ?? tt('updater.checkFailed')}
          </p>
          {isPolicyViolation(errorText ?? undefined) && (
            <div style={{ marginBottom: 12, padding: '8px 10px', borderRadius: 8, background: 'var(--dsw-alias-state-warning-tertiary)' }}>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--dsw-alias-state-warning-primary)', fontWeight: 600 }}>
                pnpm 供应链策略（minimumReleaseAge）拦截了新发布的包。一键修复会把被拦的包加入
                profile 的 minimumReleaseAgeExclude 放行清单（不关闭整个策略），然后自动重试更新。
              </p>
              {fixMsg !== null && (
                <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' }}>{fixMsg}</p>
              )}
              <button type="button" onClick={() => void handlePolicyFix()} disabled={fixing} style={{ ...ghostButton, marginTop: 8 }}>
                {fixing ? '修复中…' : '一键修复并重试更新'}
              </button>
            </div>
          )}
          <button type="button" onClick={() => void runCheck()} style={ghostButton}>{tt('updater.retry')}</button>
        </>
      )}

      {phase === 'ready' && check !== null && (
        <>
          <div style={{ marginBottom: 14 }}>
            {Object.keys(check.loadState ?? {}).map((pkg) => {
              const update = check.updates.find((u) => u.pkg === pkg)
              return (
                <VersionRow
                  key={pkg}
                  pkg={pkg}
                  installed={check.installed[pkg] ?? '—'}
                  latest={check.latest[pkg]}
                  update={update}
                  loadState={check.loadState[pkg]}
                  unassembled={(check.unassembled ?? []).includes(pkg)}
                />
              )
            })}
          </div>
          {check.updateAvailable ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button type="button" onClick={() => void runUpdate()} style={button}>
                {tt('updater.updateNow', { n: String(check.updates.length) })}
              </button>
              {check.updates.length > 0 && (
                <p style={{ margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }}>
                  {check.updates.map((u) => `${label(u.pkg)} ${u.from} → ${u.to}`).join('；')}
                </p>
              )}
            </div>
          ) : (
            <p style={{ margin: '4px 0', fontSize: 13, color: 'var(--dsw-alias-state-business-primary)' }}>{tt('updater.upToDate')}</p>
          )}
          {check.unassembled !== undefined && check.unassembled.length > 0 && (
            <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 8, background: 'var(--dsw-alias-state-warning-tertiary)' }}>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--dsw-alias-state-warning-primary)', fontWeight: 600 }}>
                ⚠ 套件最新版包含未装配的成员：
              </p>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' }}>
                {check.unassembled.map((p) => label(p)).join('、')}
                。本 profile 未包含它（桌面版不内置 / 需更新组合包），不会自动安装。
              </p>
            </div>
          )}
        </>
      )}

      {phase === 'updating' && (
        <div style={{ margin: '8px 0 12px' }}>
          <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--dsw-alias-label-secondary)' }}>
            {progress !== null && progress.pkg !== undefined
              ? `${label(progress.pkg)} ${progress.from ?? ''} → ${progress.to ?? ''}`
              : tt('updater.updating')}…
            {progress !== null && progress.stepCount > 0
              ? `（${progress.stepIndex}/${progress.stepCount}）`
              : ''}
          </p>
          <div style={{ height: 8, borderRadius: 999, background: 'var(--dsw-alias-border-l1)', overflow: 'hidden', marginBottom: 6 }}>
            {(() => {
              const percent = progressPercent()
              const labelNow = progress !== null ? PHASE_LABEL[progress.phase] ?? '' : ''
              return (
                <div style={{
                  height: '100%', borderRadius: 999,
                  width: percent !== null ? `${percent}%` : '38%',
                  background: 'var(--dsw-alias-state-business-primary)',
                  transition: 'width 0.4s ease',
                  ...(percent === null ? { animation: 'agentlex-update-indeterminate 1.2s ease-in-out infinite' } : {}),
                }} />
              )
            })()}
          </div>
          <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }}>
            {progress !== null
              ? `${progress.totalBytes && progress.totalBytes > 0
                  ? `已下载 ${formatBytes(progress.receivedBytes ?? 0)} / ${formatBytes(progress.totalBytes)} · `
                  : ''}${PHASE_LABEL[progress.phase] ?? progress.phase}${progress.message ? ` · ${progress.message}` : ''}`
              : tt('updater.updating')}
          </p>
          <button type="button" onClick={() => void cancelRunning()} style={ghostButton}>取消更新</button>
          <style>{`@keyframes agentlex-update-indeterminate { 0% { margin-left: -38% } 100% { margin-left: 100% } }`}</style>
        </div>
      )}

      {phase === 'done' && result !== null && (
        <div style={{ marginBottom: 12 }}>
          <p style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600, color: 'var(--dsw-alias-state-business-primary)' }}>
            {tt('updater.updated', { n: String(result.updated.length) })} ✔
          </p>
          {result.updated.map((u) => (
            <p key={u.pkg} style={{ margin: '2px 0', fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)' }}>
              {label(u.pkg)}：{u.from} → {u.to}
            </p>
          ))}
          {result.skipped.length > 0 && (
            <p style={{ margin: '4px 0', fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }}>
              {tt('updater.skipped', { n: String(result.skipped.length) })}
            </p>
          )}
          {result.errors.length > 0 && (
            <p style={{ margin: '4px 0', fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' }}>
              {result.errors.map((e) => `${label(e.pkg)}：${e.error}`).join('；')}
            </p>
          )}
          {result.errors.some((e) => isPolicyViolation(e.error)) && (
            <div style={{ margin: '8px 0', padding: '8px 10px', borderRadius: 8, background: 'var(--dsw-alias-state-warning-tertiary)' }}>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--dsw-alias-state-warning-primary)', fontWeight: 600 }}>
                pnpm 供应链策略（minimumReleaseAge）拦截了新发布的包。
              </p>
              {fixMsg !== null && (
                <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' }}>{fixMsg}</p>
              )}
              <button type="button" onClick={() => void handlePolicyFix()} disabled={fixing} style={{ ...ghostButton, marginTop: 8 }}>
                {fixing ? '修复中…' : '一键修复并重试更新'}
              </button>
            </div>
          )}
          {result.notWired !== undefined && result.notWired.length > 0 && (
            <div style={{ margin: '8px 0', padding: '8px 10px', borderRadius: 8, background: 'var(--dsw-alias-state-warning-tertiary)' }}>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--dsw-alias-state-warning-primary)', fontWeight: 600 }}>
                ⚠ 以下成员已安装但未接入启动链路，重启也不会加载：
              </p>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' }}>
                {result.notWired.map((p) => label(p)).join('、')}
                。请一并更新「法律套件组合包」（其新版 cordis.patch.yml 会引用新成员），或手动把成员加入 profile bundles。
              </p>
            </div>
          )}
          {result.unassembled !== undefined && result.unassembled.length > 0 && (
            <div style={{ margin: '8px 0', padding: '8px 10px', borderRadius: 8, background: 'var(--dsw-alias-state-warning-tertiary)' }}>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--dsw-alias-state-warning-primary)', fontWeight: 600 }}>
                ⚠ 已跳过未装配的套件新成员：
              </p>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--dsw-alias-label-secondary)' }}>
                {result.unassembled.map((p) => label(p)).join('、')}
                。本 profile 未包含它（桌面版不内置 / 需更新组合包），不会自动安装。
              </p>
            </div>
          )}
          <p style={{ margin: '10px 0 0', fontSize: 12.5, color: 'var(--dsw-alias-state-warning-primary)' }}>
            {tt('updater.restartHint')}
          </p>
          <p style={{ margin: '2px 0 14px', fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary)' }}>
            {result.backupRoot !== undefined ? tt('updater.backup', { dir: result.backupRoot }) : ''}
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {typeof window !== 'undefined' && window.dshDesktopApp?.restartHarness !== undefined ? (
              <button type="button" onClick={() => void restartDsh()} style={button}>重启 DSH（使新版本生效）</button>
            ) : (
              <button type="button" onClick={() => window.location.reload()} style={button}>刷新页面（加载新版本界面）</button>
            )}
            <button type="button" onClick={() => void runCheck()} style={ghostButton}>{tt('updater.recheck')}</button>
          </div>
          {typeof window !== 'undefined' && window.dshDesktopApp?.restartHarness === undefined && (
            <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }}>
              当前为网页环境：刷新页面只更新浏览器界面，宿主代码需手动重启 DSH 服务后才生效。
            </p>
          )}
        </div>
      )}

      <div style={{ paddingTop: 12, borderTop: '1px solid var(--dsw-alias-border-l2)' }}>
        <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' }}>
          {tt('updater.footer')}{' '}
          <a href={`${NPM_URL}`} target="_blank" rel="noreferrer" style={{ color: 'var(--dsw-alias-state-business-primary)' }}>
            {tt('updater.releases')}
          </a>
        </p>
      </div>
    </div>
  )
}