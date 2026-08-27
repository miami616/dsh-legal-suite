import type { TaskItem } from '../store/types.ts'

interface Envelope<T> {
  success: boolean
  data?: T
  error?: string
}

async function call<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(`/api/agentlex-task/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  })
  const envelope = await response.json() as Envelope<T>
  if (!envelope.success) throw new Error(envelope.error ?? `request failed (${response.status})`)
  return envelope.data as T
}

export function listTasks(): Promise<TaskItem[]> {
  return call('tasks')
}

export function upsertTask(input: Record<string, unknown>): Promise<TaskItem> {
  return call('task', input)
}

export function deleteTask(id: string): Promise<{ deleted: boolean }> {
  return call('delete-task', { id })
}

export function unifiedTasks(): Promise<TaskItem[]> {
  return call('unified')
}
