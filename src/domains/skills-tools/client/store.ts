/**
 * 技能与工具 — 客户端状态（useSyncExternalStore + 周期性刷新）。
 *
 * 状态来自宿主 /api/agentlex-skills/state：技能（~/.dsh/skills 扫描）与
 * MCP 服务器（用户 + cordis 内置）。每 STATUS_POLL_MS 轮询一次以反映
 * 连接状态变化（✓/⏳/Ø）；所有写操作由调用方直接走 api 后 setState。
 */
import { useSyncExternalStore, useState } from 'react'
import { fetchState } from './api.ts'
import type { SkillsToolsState } from '../types.ts'

const STATUS_POLL_MS = 10000

const EMPTY: SkillsToolsState = { skills: [], mcp: [] }

let state: SkillsToolsState = EMPTY
let lastError: string | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function getState(): SkillsToolsState {
  return state
}

export function getLastError(): string | null {
  return lastError
}

/** 用后端返回的最新 state 覆盖本地（写操作后调用）。 */
export function setState(next: SkillsToolsState): void {
  state = next
  lastError = null
  emit()
}

/** 后台轮询（connection/reset 后由装配层重挂）。 */
export function startPolling(): () => void {
  let alive = true
  let timer: ReturnType<typeof setTimeout> | null = null

  const tick = async (): Promise<void> => {
    if (!alive) return
    try {
      const next = await fetchState()
      if (alive) {
        state = next
        lastError = null
        emit()
      }
    } catch (error) {
      if (alive) lastError = String((error as Error)?.message ?? error)
    }
    if (alive) timer = setTimeout(tick, STATUS_POLL_MS)
  }

  void tick()
  return () => {
    alive = false
    if (timer !== null) clearTimeout(timer)
  }
}

/** 组件订阅。 */
export function subscribeState(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useSkillsToolsState(): SkillsToolsState {
  return useSyncExternalStore(subscribeState, getState)
}

/** 面板打开时用一次（避免等待轮询间隔）。 */
export function useRefreshOnce(active: boolean): void {
  const [refreshed, setRefreshed] = useState(false)
  if (active && !refreshed) {
    setRefreshed(true)
    void fetchState().then(setState).catch(() => undefined)
  }
}
