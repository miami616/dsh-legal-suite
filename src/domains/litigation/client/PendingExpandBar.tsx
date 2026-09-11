/**
 * 待展开阶段提示（状态变更三态 UI，v0.2.6 / 0.2.12 修订）。
 *
 * 按 `pendingExpand.mode` 分两种呈现——**管家自己推进的不该打扰用户**：
 *  - `confirm`（**手动**改状态产生）→ 弹窗，提供 [展开] / [忽略]：
 *    展开 = 按挂起的阶段模板落库任务+事件；忽略 = 仅清除标记。
 *  - `agent`（管家调 update_case 推进产生）→ **不弹窗**，只在右下角留一枚
 *    不遮挡、不阻塞的窄条（管家在同一回合自行 expand/ignore，处理完即消失）。
 *    留这一枚是因为：管家万一没收尾，案件会带着看不见的挂起标记；没有它
 *    就只剩读侧工具可见，界面上永远发现不了。
 *
 * 数据源：/api/agentlex-case/read（registry 透出 pendingExpand），监听
 * agentlex:registry-changed 实时刷新。caseId 传入时只显示当前案件（详情页视图），
 * 不传时显示全部（诉讼面板）。
 */
import { useEffect, useState } from 'react'
import * as api from './api.ts'
import { getStatusDef } from './case-status.ts'
import type { PendingExpand } from '../store/types.ts'

const REGISTRY_CHANGED = 'agentlex:registry-changed'

interface PendingRow {
  caseId: string
  caseName: string
  level?: string
  pending: PendingExpand
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 9999,
  background: 'rgba(0,0,0,0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}
const modalStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 12,
  boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
  width: 420,
  maxWidth: '90vw',
  padding: '20px 22px',
  fontFamily: 'inherit',
}
const titleStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  marginBottom: 4,
}
const subStyle: React.CSSProperties = {
  fontSize: 13,
  color: '#666',
  marginBottom: 14,
}
const previewStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#444',
  background: '#f5f5f5',
  borderRadius: 8,
  padding: '10px 12px',
  marginBottom: 16,
  maxHeight: 160,
  overflowY: 'auto',
  lineHeight: 1.7,
}
const btnRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  justifyContent: 'flex-end',
}
const btnBase: React.CSSProperties = {
  fontSize: 14,
  padding: '7px 18px',
  borderRadius: 8,
  border: '1px solid transparent',
  cursor: 'pointer',
}
const btnPrimary: React.CSSProperties = {
  ...btnBase,
  background: '#b45309',
  color: '#fff',
}
const btnGhost: React.CSSProperties = {
  ...btnBase,
  background: '#fff',
  color: '#666',
  borderColor: '#ccc',
}

/** 管家推进态：右下角窄条（不遮挡、不阻塞、不弹窗）。 */
const agentStripStyle: React.CSSProperties = {
  position: 'fixed',
  right: 16,
  bottom: 16,
  zIndex: 9998,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  maxWidth: 'min(420px, 90vw)',
  padding: '8px 12px',
  borderRadius: 10,
  background: 'rgba(255,255,255,0.96)',
  border: '1px solid #e5e5e5',
  boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
  fontSize: 12,
  color: '#555',
  fontFamily: 'inherit',
}
const agentDotStyle: React.CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: 999,
  background: '#b45309',
  flexShrink: 0,
}
const agentDismissStyle: React.CSSProperties = {
  marginLeft: 'auto',
  border: 'none',
  background: 'transparent',
  color: '#999',
  fontSize: 12,
  cursor: 'pointer',
  padding: '2px 4px',
}

export function PendingExpandBar({ caseId }: { caseId?: string }): React.JSX.Element | null {
  const [rows, setRows] = useState<PendingRow[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  const refresh = async (): Promise<void> => {
    try {
      const registry = await api.readRegistry()
      const list: PendingRow[] = []
      for (const record of Object.values(registry.cases)) {
        if (record.pendingExpand === undefined) continue
        if (caseId !== undefined && record.caseId !== caseId) continue
        list.push({ caseId: record.caseId, caseName: record.name, level: record.level, pending: record.pendingExpand })
      }
      setRows(list)
    } catch {
      /* registry 暂不可读时静默，等下次事件刷新 */
    }
  }

  useEffect(() => {
    void refresh()
    const onChanged = (): void => { void refresh() }
    window.addEventListener(REGISTRY_CHANGED, onChanged)
    return () => window.removeEventListener(REGISTRY_CHANGED, onChanged)
  }, [])

  if (rows.length === 0) return null

  // 弹窗只给 confirm（手动改状态）；agent（管家推进）走角落窄条，不弹窗。
  const confirmRows = rows.filter((r) => r.pending.mode !== 'agent')
  const agentRows = rows.filter((r) => r.pending.mode === 'agent')

  const act = async (row: PendingRow, action: 'expand' | 'ignore'): Promise<void> => {
    setBusy(row.caseId)
    try {
      await api.resolvePendingExpand(row.caseId, action)
      await refresh()
    } catch (error) {
      console.warn('[litigation] resolve-pending-expand failed:', error)
    } finally {
      setBusy(null)
    }
  }

  // 管家推进产生的挂起：不弹窗，角落窄条 + 「交给管家」说明，只提供忽略。
  if (confirmRows.length === 0) {
    const agentRow = agentRows[0]!
    const agentLabel = getStatusDef(agentRow.pending.toStatus, agentRow.level).label
    return (
      <div style={agentStripStyle} role="status">
        <span style={agentDotStyle} />
        <span>
          管家推进到「{agentLabel}」，「{agentRow.pending.stageName}」由管家处理中
        </span>
        <button type="button" disabled={busy === agentRow.caseId} onClick={() => void act(agentRow, 'ignore')} style={agentDismissStyle}>
          忽略
        </button>
      </div>
    )
  }

  // 多案件时逐个弹（一次一个，处理完再下一个）。
  const row = confirmRows[0]!
  const toLabel = getStatusDef(row.pending.toStatus, row.level).label

  return (
    <div style={overlayStyle}>
      <div style={modalStyle} role="dialog" aria-modal="true">
        <div style={titleStyle}>状态已推进，是否展开阶段任务？</div>
        <div style={subStyle}>
          「{row.caseName}」({row.caseId}) 状态已推进到「{toLabel}」，
          对应「{row.pending.stageName}」阶段任务尚未展开。
        </div>
        <div style={previewStyle}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>将展开：</div>
          任务 + 日程（按阶段模板）
        </div>
        <div style={btnRowStyle}>
          <button type="button" disabled={busy === row.caseId} onClick={() => void act(row, 'ignore')} style={btnGhost}>忽略</button>
          <button type="button" disabled={busy === row.caseId} onClick={() => void act(row, 'expand')} style={btnPrimary}>展开</button>
        </div>
      </div>
    </div>
  )
}
