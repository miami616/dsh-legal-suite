/** Data model for the task-management store. */

export interface TaskItem {
  id: string
  title: string
  detail?: string
  status: 'todo' | 'doing' | 'done'
  priority?: 'low' | 'medium' | 'high'
  deadline?: string
  source?: 'standalone' | 'litigation' | 'nonlitigation'
  sourceId?: string
  sourceName?: string
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
