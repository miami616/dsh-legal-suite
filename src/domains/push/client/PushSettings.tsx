/**
 * 「IM 推送」设置块（挂在 AgentLex 设置设置页内，agentlex.workbench.item 槽位）。
 *
 * 配置期限 IM 推送：总开关 + dsh-im 投递目标选择 + 标题前缀 + 测试消息。
 * 提前量固定为「提前 1 天 + 当天」，不提供可配置项（决策 2）。
 *
 * 依赖说明（决策 4）：需先安装并接入 dsh-im（配置机器人 + 投递目标）与
 * dsh-timer-agent；本块在 dsh-im 缺席时显示提示而非崩溃。
 */
import { useEffect, useState } from 'react'
import {
  listPushTargets, readPushConfig, runPushNow, sendPushTest, writePushConfig,
  type DeliveryTarget, type PushConfigView,
} from './api.ts'

/** 固定提醒窗口说明（决策 2）。 */
const WINDOW_HINT = '提醒窗口固定为「提前 1 天 + 当天」；远期提醒由日报/周报承担。'

/** 固定推送模板预览（决策 3）。 */
const TEMPLATE_PREVIEW = `📌 重要日程提醒 · 2 项待办

⚖️ 开庭 · 明天
案件：张三诉李四合同纠纷
案号：(2026)鲁0102民初10195号
法院：济南市历下区人民法院
时间：14:45
地点：速裁审判法庭第一庭
日期：2026-09-04

⏰ 举证期限 · 今天
案件：王五诉赵六
日期：2026-09-03`

const label = { color: 'var(--dsw-alias-label-secondary)', fontSize: 12.5, marginBottom: 4, display: 'block' } as const
const input = {
  width: '100%', boxSizing: 'border-box', padding: '7px 10px', borderRadius: 8,
  border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-l2)',
  color: 'var(--dsw-alias-label-primary)', fontSize: 13,
} as const
const button = {
  padding: '7px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
  background: 'var(--dsw-alias-state-business-primary)', color: '#fff', fontSize: 12.5, fontWeight: 600,
} as const
const ghostButton = {
  padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12.5,
  border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent', color: 'var(--dsw-alias-label-primary)',
} as const

/**
 * 强制文本粘贴：读取剪贴板纯文本并插入输入框，阻止默认行为。
 * 防御某些全局 paste 处理器把文本粘贴替换成图片路径的问题。
 */
function forceTextPaste(e: React.ClipboardEvent<HTMLInputElement>, setter: (v: string) => void): void {
  const text = e.clipboardData?.getData('text/plain')
  if (text === undefined || text === '') return
  e.preventDefault()
  const el = e.currentTarget
  const start = el.selectionStart ?? el.value.length
  const end = el.selectionEnd ?? el.value.length
  const next = el.value.slice(0, start) + text + el.value.slice(end)
  setter(next)
  // 恢复光标到插入后位置。
  requestAnimationFrame(() => {
    const pos = start + text.length
    el.setSelectionRange(pos, pos)
  })
}

/** 「IM 推送」设置块。 */
export function PushSettings(): React.JSX.Element {
  const [config, setConfig] = useState<PushConfigView | null>(null)
  const [targets, setTargets] = useState<DeliveryTarget[]>([])
  const [targetsAvailable, setTargetsAvailable] = useState(false)
  const [targetsError, setTargetsError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  // Load config on mount.
  useEffect(() => {
    let mounted = true
    void readPushConfig().then((cfg) => {
      if (!mounted) return
      setConfig(cfg)
      if (cfg.botId !== '') void loadTargets(cfg.botId)
    }).catch((error) => {
      if (mounted) setMessage({ kind: 'err', text: `读取配置失败：${error instanceof Error ? error.message : String(error)}` })
    })
    return () => { mounted = false }
  }, [])

  const loadTargets = async (botId: string): Promise<void> => {
    try {
      const result = await listPushTargets(botId)
      setTargetsAvailable(result.available)
      setTargets(result.targets)
      setTargetsError(result.error ?? null)
    } catch (error) {
      setTargetsAvailable(false)
      setTargets([])
      setTargetsError(error instanceof Error ? error.message : String(error))
    }
  }

  const handleBotIdChange = (value: string): void => {
    setConfig((prev) => (prev === null ? prev : { ...prev, botId: value }))
    if (value.trim() !== '') void loadTargets(value.trim())
    else { setTargets([]); setTargetsAvailable(false) }
  }

  const handleSave = async (): Promise<void> => {
    if (config === null) return
    setSaving(true)
    setMessage(null)
    try {
      const saved = await writePushConfig(config)
      setConfig(saved)
      setMessage({ kind: 'ok', text: '已保存。' })
    } catch (error) {
      setMessage({ kind: 'err', text: `保存失败：${error instanceof Error ? error.message : String(error)}` })
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async (): Promise<void> => {
    if (config === null || config.botId === '' || config.targetId === '') {
      setMessage({ kind: 'err', text: '请先选择投递目标。' })
      return
    }
    setTesting(true)
    setMessage(null)
    try {
      await sendPushTest({ botId: config.botId, targetId: config.targetId, titlePrefix: config.titlePrefix })
      setMessage({ kind: 'ok', text: '测试消息已发送，请到 IM 渠道确认。' })
    } catch (error) {
      setMessage({ kind: 'err', text: `测试失败：${error instanceof Error ? error.message : String(error)}` })
    } finally {
      setTesting(false)
    }
  }

  const handleRunNow = async (): Promise<void> => {
    setRunning(true)
    setMessage(null)
    try {
      const result = await runPushNow()
      setMessage({ kind: 'ok', text: `已执行：窗口内 ${result.due} 条，推送 ${result.pushed} 条。` })
    } catch (error) {
      setMessage({ kind: 'err', text: `执行失败：${error instanceof Error ? error.message : String(error)}` })
    } finally {
      setRunning(false)
    }
  }

  if (config === null) {
    return <p style={{ fontSize: 12.5, color: 'var(--dsw-alias-label-tertiary)' }}>加载中…</p>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 总开关 */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--dsw-alias-label-primary)' }}>
        <input
          type="checkbox"
          checked={config.enabled}
          onChange={(e) => setConfig((prev) => (prev === null ? prev : { ...prev, enabled: e.target.checked }))}
        />
        启用期限 IM 推送
      </label>

      {/* 投递目标 */}
      <div>
        <label style={label}>dsh-im 投递目标（需先在 dsh-im 设置页接入机器人并配置目标）</label>
        <input
          style={input}
          placeholder="Bot ID（从 dsh-im 设置页复制）"
          value={config.botId}
          onChange={(e) => handleBotIdChange(e.target.value)}
          onPaste={(e) => forceTextPaste(e, (v) => handleBotIdChange(v))}
        />
        {targetsAvailable && targets.length > 0 ? (
          <select
            style={{ ...input, marginTop: 6 }}
            value={config.targetId}
            onChange={(e) => setConfig((prev) => (prev === null ? prev : { ...prev, targetId: e.target.value }))}
          >
            <option value="">选择投递目标…</option>
            {targets.map((t) => (
              <option key={t.targetId} value={t.targetId}>{t.name ?? t.targetId}</option>
            ))}
          </select>
        ) : (
          <input
            style={{ ...input, marginTop: 6 }}
            placeholder="Target ID（从 dsh-im 设置页「复制调用参数」粘贴）"
            value={config.targetId}
            onChange={(e) => setConfig((prev) => (prev === null ? prev : { ...prev, targetId: e.target.value }))}
            onPaste={(e) => forceTextPaste(e, (v) => setConfig((prev) => (prev === null ? prev : { ...prev, targetId: v })))}
          />
        )}
        {targetsError !== null && (
          <p style={{ margin: '4px 0 0', fontSize: 11.5, color: 'var(--dsw-alias-state-warning-primary)' }}>{targetsError}</p>
        )}
        {!targetsAvailable && (
          <p style={{ margin: '4px 0 0', fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary)' }}>
            未检测到 dsh-im 投递目标列表，请手动粘贴从 dsh-im 设置页复制的 Bot ID 与 Target ID。
          </p>
        )}
      </div>

      {/* 标题前缀 */}
      <div>
        <label style={label}>标题前缀（可选）</label>
        <input
          style={input}
          placeholder="如：律所"
          value={config.titlePrefix ?? ''}
          onChange={(e) => setConfig((prev) => (prev === null ? prev : { ...prev, titlePrefix: e.target.value }))}
        />
      </div>

      {/* 提醒窗口说明 */}
      <p style={{ margin: 0, fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary)' }}>{WINDOW_HINT}</p>

      {/* 模板预览 */}
      <div style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--dsw-alias-bg-l2)', fontSize: 11.5, color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'pre-wrap' }}>
        <span style={{ fontWeight: 600 }}>固定推送模板：</span>
        {TEMPLATE_PREVIEW}
      </div>

      {/* 操作按钮 */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => void handleSave()} disabled={saving} style={button}>
          {saving ? '保存中…' : '保存'}
        </button>
        <button type="button" onClick={() => void handleTest()} disabled={testing} style={ghostButton}>
          {testing ? '发送中…' : '发送测试消息'}
        </button>
        <button type="button" onClick={() => void handleRunNow()} disabled={running} style={ghostButton}>
          {running ? '执行中…' : '立即执行一次'}
        </button>
      </div>

      {message !== null && (
        <p style={{ margin: 0, fontSize: 12, color: message.kind === 'ok' ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-error-primary)' }}>
          {message.text}
        </p>
      )}
    </div>
  )
}
