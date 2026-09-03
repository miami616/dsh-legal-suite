/** Data model for the task-management store. */

export interface TaskItem {
  id: string
  title: string
  detail?: string
  status: 'todo' | 'doing' | 'done'
  priority?: 'low' | 'medium' | 'high'
  deadline?: string
  /** 具体时间（HH:mm），与 deadline（纯日期 yyyy-MM-dd）分开存。 */
  time?: string
  source?: 'standalone' | 'litigation' | 'nonlitigation'
  sourceId?: string
  sourceName?: string
  /** The task-group (stage) id within the source case/project — enables write-through. */
  groupId?: string
  createdAt?: string
  updatedAt?: string
}

export interface StandaloneTasksRegistry {
  registryVersion: string
  lastUpdated?: string
  tasks: Record<string, TaskItem>
}

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}
