import type { IdeaItem, IdeaStatus } from '../store/types.ts'

interface Envelope<T> {
  success: boolean
  data?: T
  error?: string
}

async function call<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(`/api/agentlex-ideas/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  })
  const envelope = await response.json() as Envelope<T>
  if (!envelope.success) throw new Error(envelope.error ?? `request failed (${response.status})`)
  return envelope.data as T
}

export function listIdeas(status?: IdeaStatus | 'all'): Promise<IdeaItem[]> {
  return call('ideas', status === undefined || status === 'all' ? {} : { status })
}

export function resolveIdea(idOrToken: string): Promise<IdeaItem> {
  return call('resolve', { id: idOrToken })
}

export function upsertIdea(input: Record<string, unknown>): Promise<IdeaItem> {
  return call('idea', input)
}

export function setStatus(id: string, status: IdeaStatus): Promise<IdeaItem> {
  return call('status', { id, status })
}

export function deleteIdea(id: string): Promise<{ deleted: boolean }> {
  return call('delete-idea', { id })
}
