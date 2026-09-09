/**
 * 待展开阶段确认弹窗（状态变更三态 UI，v0.2.6）。
 *
 * 状态档位已推进、但对应阶段任务尚未展开的案件（case.pendingExpand，
 * confirm/agent 模式产生）→ 弹窗提示，提供 [展开] / [忽略] 两个动作：
 *  - 展开 = 按挂起的阶段模板落库任务+事件；
 *  - 忽略 = 仅清除标记。
 *
 * 数据源：/api/agentlex-case/read（registry 透出 pendingExpand），监听
 * agentlex:registry-changed 实时刷新。caseId 传入时只弹当前案件（详情页视图），
 * 不传时弹全部（诉讼面板）。
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

  // 多案件时逐个弹（一次一个，处理完再下一个）。
  const row = rows[0]!
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
          {row.pending.mode === 'agent'
            ? '（交管家处理，管家将按纪律自主展开或与你确认）'
            : '任务 + 日程（按阶段模板）'}
        </div>
        <div style={btnRowStyle}>
          <button type="button" disabled={busy === row.caseId} onClick={() => void act(row, 'ignore')} style={btnGhost}>忽略</button>
          <button type="button" disabled={busy === row.caseId} onClick={() => void act(row, 'expand')} style={btnPrimary}>展开</button>
        </div>
      </div>
    </div>
  )
}
