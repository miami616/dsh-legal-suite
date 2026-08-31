/**
 * memo-api.ts — 备忘录域浏览器端 REST 客户端。
 *
 * 与 host 的 /api/agentlex-memo/* 路由一一对应；另订阅 events-stream SSE
 * 把 host 的 `agentlex:registry-changed` 广播转成页面 CustomEvent
 * `agentlex:memos-changed`，供面板与 # 补全联动刷新。
 */

import type { MemoItem } from '../store/types.ts'

export interface ApiEnvelope<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = path.startsWith('/') ? path : `/${path}`
  const res = await fetch(url, {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
  const body = await res.json().catch(() => null) as ApiEnvelope<T> | null
  if (!res.ok || body === null || body.success === false || body.data === undefined) {
    throw new Error((body?.error) ?? `memo request failed: ${res.status}`)
  }
  return body.data
}

export const memoApi = {
  list(): Promise<MemoItem[]> {
    return request<MemoItem[]>('api/agentlex-memo/memos')
  },
  get(id: string): Promise<MemoItem> {
    return request<MemoItem>(`api/agentlex-memo/memo?id=${encodeURIComponent(id)}`)
  },
  /** body: { id?, content, tags?, ref?, status? } */
  upsert(input: Partial<MemoItem> & { content?: string }): Promise<MemoItem> {
    return request<MemoItem>('api/agentlex-memo/memo', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  },
  archive(id: string, archived: boolean): Promise<MemoItem> {
    return request<MemoItem>('api/agentlex-memo/archive', {
      method: 'POST',
      body: JSON.stringify({ id, archived }),
    })
  },
  remove(id: string): Promise<{ deleted: boolean }> {
    return request<{ deleted: boolean }>('api/agentlex-memo/delete', {
      method: 'POST',
      body: JSON.stringify({ id }),
    })
  },
}

/**
 * 订阅 memo 变更推送；返回取消订阅函数。
 *
 * 用轻量轮询（每 3s 拉一次列表）代替持久 SSE 连接：面板自身每次写操作后都会
 * 主动刷新，轮询只覆盖跨标签页/跨会话的外部写入。避免 SSE 长连接在某些
 * 环境（如 headless 浏览器有限连接池）下阻塞同源 fetch 写请求。
 */
export function subscribeMemos(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const onChange = (): void => listener()
  window.addEventListener('agentlex:memos-changed', onChange)
  const timer = window.setInterval(() => {
    void memoApi.list().then(onChange).catch(() => { /* 后台轮询失败不扰 */ })
  }, 3000)
  return () => {
    window.removeEventListener('agentlex:memos-changed', onChange)
    window.clearInterval(timer)
  }
}
