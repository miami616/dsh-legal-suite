/**
 * 「期限提醒」设置块（挂在 AgentLex 设置设置页内，agentlex.workbench.item 槽位）。
 *
 * v0.2.25：智能分级提醒 + 精确到点提醒 + 失败可见（状态/预览）。
 * 推送直连飞书 open API（与每日早报同一套凭据），不依赖 dsh-im / dsh-timer-agent。
 */
import { useEffect, useState } from 'react'
import {
  readPushConfig, runPushNow, sendPushTest, writePushConfig,
  readFeishuConfig, writeFeishuConfig, readPushStatus, previewPush,
  type PushConfigView, type FeishuConfigView, type PushStatusView, type PushPreviewView,
} from './api.ts'

/** 提醒时机说明。 */
const WINDOW_HINT = '仅工作日（周一至周五，含调休上班日）按设定时间推送：法定期限 T-30/7/3/1/当天，开庭 T-7/3/1/当天 + 当天提前 2 小时；周末与法定节假日不发每日摘要（开庭精确提醒仍发），假期前最后一个工作日会补位。'

/** 卡片模板预览——用中性示例，不含真实当事人/案号/法院。 */
const TEMPLATE_PREVIEW = `日程提醒

今日必办 · 共 1 项
上诉期届满 · 还剩 3 天  [硬期限]
甲方与乙方买卖合同纠纷
（2026）X民初XXXX号 · XX市XX区人民法院
⚠ 逾期丧失上诉权，一审裁判生效

明日安排
开庭 · 明天 09:00
甲方与乙方买卖合同纠纷
第X法庭`

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
  const [runningWeekly, setRunningWeekly] = useState<'weekly-plan' | 'weekly-review' | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [status, setStatus] = useState<PushStatusView | null>(null)
  const [preview, setPreview] = useState<PushPreviewView | null>(null)
  const [previewing, setPreviewing] = useState(false)

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
    void readPushStatus().then((st) => { if (mounted) setStatus(st) }).catch(() => { /* 旧宿主无 status 路由 */ })
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

  const handleRunWeekly = async (mode: 'weekly-plan' | 'weekly-review'): Promise<void> => {
    setRunningWeekly(mode)
    setMessage(null)
    try {
      const result = await runPushNow(false, mode)
      setMessage({
        kind: 'ok',
        text: result.error !== undefined
          ? `发送失败：${result.error}`
          : result.pushed > 0 ? `已发送（${result.pushed} 行）。` : '本周没有可汇总的内容，未发送空卡。',
      })
      const st = await readPushStatus().catch(() => null)
      if (st !== null) setStatus(st)
    } catch (error) {
      setMessage({ kind: 'err', text: `发送失败：${error instanceof Error ? error.message : String(error)}` })
    } finally {
      setRunningWeekly(null)
    }
  }

  const handlePreview = async (): Promise<void> => {
    setPreviewing(true)
    setMessage(null)
    try {
      setPreview(await previewPush())
    } catch (error) {
      setMessage({ kind: 'err', text: `预览失败：${error instanceof Error ? error.message : String(error)}` })
    } finally {
      setPreviewing(false)
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

      {/* 智能提醒选项 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: 'var(--dsw-alias-label-primary)' }}>
          <input
            type="checkbox"
            checked={config.density !== 'standard'}
            onChange={(e) => setConfig((prev) => (prev === null ? prev : { ...prev, density: e.target.checked ? 'concise' : 'standard' }))}
            style={{ marginTop: 2 }}
          />
          <span>
            精简提醒（推荐）
            <span style={{ display: 'block', fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary)' }}>
              今天、明天全部列出；提前提醒只到 T-7，逾期只推前 3 天；更远的期限周一汇总，积压只给数量
            </span>
          </span>
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: 'var(--dsw-alias-label-primary)' }}>
          <input
            type="checkbox"
            checked={config.frequency !== 'normal'}
            onChange={(e) => setConfig((prev) => (prev === null ? prev : { ...prev, frequency: e.target.checked ? 'low' : 'normal' }))}
            style={{ marginTop: 2 }}
          />
          <span>
            低频提醒（推荐）
            <span style={{ display: 'block', fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary)' }}>
              法定期限只提醒 T-30/7/3/1/当天，普通任务 T-3/1/当天；开庭只提前 2 小时提醒一次
            </span>
          </span>
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: 'var(--dsw-alias-label-primary)' }}>
          <input
            type="checkbox"
            checked={config.imageMode === true}
            onChange={(e) => setConfig((prev) => (prev === null ? prev : { ...prev, imageMode: e.target.checked }))}
            style={{ marginTop: 2 }}
          />
          <span>
            图片版提醒
            <span style={{ display: 'block', fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary)' }}>
              把当天摘要渲染成一张图发飞书；生成/上传失败自动回退文字卡
            </span>
          </span>
        </label>
        {[
          { key: 'smartLead' as const, title: '智能分级提醒', hint: '按期限性质分级：上诉/起诉/答辩/保全 T-30 起逐级提醒，开庭/举证 T-7 起，普通任务 T-3 起' },
          { key: 'preciseReminder' as const, title: '开庭/会议前精确提醒', hint: '开庭提前 2 小时与 30 分钟，其他带时间事项提前 30 分钟' },
          { key: 'includeConsequence' as const, title: '显示逾期后果', hint: '法定期限卡片上附一句「逾期会怎样」，如「逾期丧失上诉权」' },
        ].map((row) => (
          <label key={row.key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: 'var(--dsw-alias-label-primary)' }}>
            <input
              type="checkbox"
              checked={config[row.key] !== false}
              onChange={(e) => setConfig((prev) => (prev === null ? prev : { ...prev, [row.key]: e.target.checked }))}
              style={{ marginTop: 2 }}
            />
            <span>
              {row.title}
              <span style={{ display: 'block', fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary)' }}>{row.hint}</span>
            </span>
          </label>
        ))}
      </div>

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

      {/* 周报 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label style={label}>周报（与日报同一条飞书通道）</label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: 'var(--dsw-alias-label-primary)' }}>
          <input
            type="checkbox"
            checked={config.weeklyPlanEnabled !== false}
            onChange={(e) => setConfig((prev) => (prev === null ? prev : { ...prev, weeklyPlanEnabled: e.target.checked }))}
            style={{ marginTop: 2 }}
          />
          <span>
            周一早上「本周重点工作」
            <span style={{ display: 'block', fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary)' }}>
              按下面的每日推送时间发出；周一早上只发这一张，替代当天日报——同一批事项不会推两遍
            </span>
          </span>
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: 'var(--dsw-alias-label-primary)' }}>
          <input
            type="checkbox"
            checked={config.weeklyReviewEnabled !== false}
            onChange={(e) => setConfig((prev) => (prev === null ? prev : { ...prev, weeklyReviewEnabled: e.target.checked }))}
            style={{ marginTop: 2 }}
          />
          <span>
            周五下午「本周总结与下周重点」
            <span style={{ display: 'block', fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary)' }}>
              本周完成 / 本周顺延 / 下周要点；顺延只列已经过去且仍未完成的，今天在办的不算，不重复当天日报
            </span>
          </span>
        </label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12.5, color: 'var(--dsw-alias-label-secondary)' }}>周五发送时间</span>
          <input
            style={{ ...input, maxWidth: 140 }}
            type="time"
            disabled={config.weeklyReviewEnabled === false}
            value={config.weeklyReviewTime ?? '16:30'}
            onChange={(e) => setConfig((prev) => (prev === null ? prev : { ...prev, weeklyReviewTime: e.target.value }))}
          />
        </div>
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

      {/* 运行状态：上次成功/失败、下次摘要时间 */}
      {status !== null && (
        <div style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--dsw-alias-bg-l2)', fontSize: 11.5, lineHeight: 1.7, color: 'var(--dsw-alias-label-secondary)' }}>
          <span style={{ fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }}>运行状态</span>
          <div>下次摘要：{status.nextDigestAt} · 今日计划 {status.due} 项</div>
          {status.weekly !== undefined && (
            <div>
              周报：{status.weekly.planEnabled ? `本周重点 ${status.weekly.nextPlanAt}` : '本周重点已关'}
              {' · '}
              {status.weekly.reviewEnabled ? `本周总结 ${status.weekly.nextReviewAt}` : '本周总结已关'}
            </div>
          )}
          {status.workday === false && (
            <div style={{ color: 'var(--dsw-alias-label-tertiary)' }}>今天是非工作日（周末/法定节假日），每日摘要暂停；开庭/法定期限的精确提醒仍会发送。</div>
          )}
          <div>
            上次：{status.state.lastSuccessAt !== undefined
              ? `成功 ${new Date(status.state.lastSuccessAt).toLocaleString('zh-CN', { hour12: false })}`
              : '尚无成功记录'}
            {status.state.lastPushedCount !== undefined ? `（${status.state.lastPushedCount} 项）` : ''}
          </div>
          {(status.state.lastError ?? '') !== '' && (
            <div style={{ color: 'var(--dsw-alias-state-warning-primary)' }}>
              ⚠ 上次失败（连续 {status.state.consecutiveFailures} 次）：{status.state.lastError}
            </div>
          )}
          {!status.feishuConfigured && (
            <div style={{ color: 'var(--dsw-alias-state-warning-primary)' }}>⚠ 飞书凭据未配置，提醒无法送达</div>
          )}
        </div>
      )}

      {/* 今日提醒计划预览 */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button type="button" onClick={() => void handlePreview()} disabled={previewing} style={ghostButton}>
          {previewing ? '读取中…' : '预览今日提醒'}
        </button>
        {preview !== null && (
          <span style={{ fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary)' }}>
            {preview.total} 项 · {preview.bySection.map((g) => `${g.title} ${g.count}`).join(' / ') || '今日无需提醒'}
            {preview.suppressed !== undefined && preview.suppressed.overdue > 0
              ? ` · 另有逾期 ${preview.suppressed.overdue} 项折叠`
              : ''}
            {preview.suppressed !== undefined && (preview.suppressed.capped ?? 0) > 0
              ? ` · 另有 ${preview.suppressed.capped} 项未展开`
              : ''}
          </span>
        )}
      </div>
      {preview !== null && preview.items.length > 0 && (
        <div style={{ padding: '8px 10px', borderRadius: 8, background: 'var(--dsw-alias-bg-l2)', fontSize: 11.5, lineHeight: 1.7, color: 'var(--dsw-alias-label-secondary)', maxHeight: 220, overflow: 'auto' }}>
          {preview.items.map((item, i) => (
            <div key={`${item.label}-${i}`}>
              <span style={{ fontWeight: item.severity === 'critical' ? 700 : 500 }}>{item.label}</span>
              {item.time !== undefined && item.time !== '' ? ` ${item.time}` : ''} · {item.phaseLabel}
              {item.consequence !== undefined ? ` · ⚠ ${item.consequence}` : ''}
            </div>
          ))}
        </div>
      )}

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
        <button type="button" onClick={() => void handleRunWeekly('weekly-plan')} disabled={runningWeekly !== null} style={ghostButton}>
          {runningWeekly === 'weekly-plan' ? '发送中…' : '发送本周重点'}
        </button>
        <button type="button" onClick={() => void handleRunWeekly('weekly-review')} disabled={runningWeekly !== null} style={ghostButton}>
          {runningWeekly === 'weekly-review' ? '发送中…' : '发送本周总结'}
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
