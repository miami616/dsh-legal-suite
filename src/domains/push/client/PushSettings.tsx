/**
 * 「期限提醒」设置块（挂在 AgentLex 设置设置页内，agentlex.workbench.item 槽位）。
 *
 * 配置期限提醒：总开关 + 标题前缀 + 测试卡片 + 立即执行。
 * 提醒时机固定：每天早上 8:30 统一推送「今日 + 明日」到期的关键日期（飞书卡片）。
 * 推送直连飞书 open API（与每日早报同一套凭据），不依赖 dsh-im / dsh-timer-agent。
 */
import { useEffect, useState } from 'react'
import {
  readPushConfig, runPushNow, sendPushTest, writePushConfig,
  readFeishuConfig, writeFeishuConfig,
  type PushConfigView, type FeishuConfigView,
} from './api.ts'

/** 提醒时机说明。 */
const WINDOW_HINT = '提醒时机：每天按设定时间统一推送「今日 + 明日」到期的日程与任务（开庭 / 举证期 / 上诉期 / 任务截止等），飞书卡片。'

/** 固定推送模板预览——用中性示例，不含真实当事人/案号/法院。 */
const TEMPLATE_PREVIEW = `重要日程与任务提醒

开庭 · 明天 09:00
甲方与乙方买卖合同纠纷
（2026）X民初XXXX号 · XX市XX区人民法院 · 第X法庭

案件沟通会 · 明天 16:30
某顾问单位`

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

/** 「期限提醒」设置块。 */
export function PushSettings(): React.JSX.Element {
  const [config, setConfig] = useState<PushConfigView | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  // 飞书凭据配置状态。
  const [feishu, setFeishu] = useState<FeishuConfigView | null>(null)
  const [feishuEditing, setFeishuEditing] = useState(false)
  const [feishuAppId, setFeishuAppId] = useState('')
  const [feishuSecret, setFeishuSecret] = useState('')
  const [feishuOwner, setFeishuOwner] = useState('')
  const [feishuSaving, setFeishuSaving] = useState(false)

  // Load config on mount.
  useEffect(() => {
    let mounted = true
    void readPushConfig().then((cfg) => {
      if (!mounted) return
      setConfig(cfg)
    }).catch((error) => {
      if (mounted) setMessage({ kind: 'err', text: `读取配置失败：${error instanceof Error ? error.message : String(error)}` })
    })
    void readFeishuConfig().then((f) => {
      if (!mounted) return
      setFeishu(f)
      setFeishuAppId(f.appId ?? '')
      setFeishuOwner(f.ownerOpenId ?? '')
    }).catch(() => { /* 路由不可用时保持未配置 */ })
    return () => { mounted = false }
  }, [])

  const handleSaveFeishu = async (): Promise<void> => {
    setFeishuSaving(true)
    setMessage(null)
    try {
      const saved = await writeFeishuConfig({ appId: feishuAppId, appSecret: feishuSecret, ownerOpenId: feishuOwner })
      setFeishu(saved)
      setFeishuEditing(false)
      setFeishuSecret('')
      setMessage({ kind: 'ok', text: '飞书凭据已保存。' })
    } catch (error) {
      setMessage({ kind: 'err', text: `保存失败：${error instanceof Error ? error.message : String(error)}` })
    } finally {
      setFeishuSaving(false)
    }
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
    if (config === null) return
    setTesting(true)
    setMessage(null)
    try {
      await sendPushTest({ titlePrefix: config.titlePrefix })
      setMessage({ kind: 'ok', text: '测试卡片已发送，请到飞书确认。' })
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
      {/* 飞书凭据配置（自包含，不依赖 dsh-im） */}
      <div>
        <label style={label}>飞书机器人（推送接收）</label>
        {feishu !== null && feishu.configured && !feishuEditing ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)' }}>
              已配置：{feishu.appId}
            </span>
            <button
              type="button"
              onClick={() => setFeishuEditing(true)}
              style={ghostButton}
            >
              修改
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              style={input}
              placeholder="App ID（飞书开放平台创建应用获取）"
              value={feishuAppId}
              onChange={(e) => setFeishuAppId(e.target.value)}
            />
            <input
              style={input}
              type="password"
              placeholder="App Secret"
              value={feishuSecret}
              onChange={(e) => setFeishuSecret(e.target.value)}
            />
            <input
              style={input}
              placeholder="接收人 Open ID（机器人私聊你的 open_id）"
              value={feishuOwner}
              onChange={(e) => setFeishuOwner(e.target.value)}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={() => void handleSaveFeishu()} disabled={feishuSaving} style={button}>
                {feishuSaving ? '保存中…' : '保存飞书配置'}
              </button>
              {feishu !== null && feishu.configured && (
                <button type="button" onClick={() => setFeishuEditing(false)} style={ghostButton}>取消</button>
              )}
            </div>
            <p style={{ margin: 0, fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary)' }}>
              在飞书开放平台创建企业自建应用，获取 App ID / App Secret；机器人私聊你后，在飞书后台「开发者信息」可查你的 Open ID。
            </p>
          </div>
        )}
      </div>

      {/* 总开关 */}
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--dsw-alias-label-primary)' }}>
        <input
          type="checkbox"
          checked={config.enabled}
          onChange={(e) => setConfig((prev) => (prev === null ? prev : { ...prev, enabled: e.target.checked }))}
        />
        启用期限提醒（每日飞书推送）
      </label>

      {/* 推送时间 */}
      <div>
        <label style={label}>每日推送时间</label>
        <input
          style={{ ...input, maxWidth: 140 }}
          type="time"
          value={config.pushTime ?? '08:30'}
          onChange={(e) => setConfig((prev) => (prev === null ? prev : { ...prev, pushTime: e.target.value }))}
        />
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

      {/* 提醒时机说明 */}
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
          {testing ? '发送中…' : '发送测试卡片'}
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
