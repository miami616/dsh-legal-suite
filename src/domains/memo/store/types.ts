/**
 * 备忘录域类型（host 半共享）。
 *
 * Memo = 一条备忘：正文 + 自定标签 + 归档/删除状态。持久化为 JSON 文档
 * （JsonFileStore，单写队列 + 磁盘锁）。引用语义：会话输入框中的 `#ref`
 * 可指向 memo.ref（短引用码），agent 经 memo 工具查回正文。
 */

/** 备忘录状态机：active（在用）/ archived（归档）/ deleted（回收站删除）。 */
export type MemoStatus = 'active' | 'archived'

export interface MemoItem {
  /** 稳定 id（childId('memo')）。 */
  id: string
  /** 短引用码（# 后输入的 token，如 memo 主题词/序号，去重用）。 */
  ref: string
  /** 备忘正文。 */
  content: string
  /** 自定义标签（小写 trim 去重）。 */
  tags: string[]
  status: MemoStatus
  createdAt: string
  updatedAt: string
}

export interface MemoRegistry {
  /** 文档 schema 版本。 */
  registryVersion: '1.0'
  memos: Record<string, MemoItem>
  lastUpdated?: string
}

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

export const MEMO_REGISTRY_VERSION = '1.0' as const
