/**
 * dsh-legal-suite/moot-court — 会话存储。
 *
 * 产物隔离（方案 §3）：所有文件只落 `$DSH_HOME/agentlex/moot-court/`，
 * 绝不写入案件卷宗目录。目录结构：
 *
 *   <dataDir>/
 *     sessions.json                       # 顶层会话索引（列表视图 + 状态机元数据）
 *     sessions/<id>/
 *       session.json                      # 元数据镜像（单会话可读副本）
 *       dossier.json                      # 案件快照（一次复制，此后与卷宗解耦）
 *       transcript.jsonl                  # 逐条发言，每追加一条即落盘（断点续跑）
 *       issues.json                       # 结构化争点
 *       judgment.md                       # 模拟判决书/裁决书
 *       report.json                       # 攻击面报告
 *
 * 写协议沿用 JsonFileStore（索引）+ 每会话文件的串行队列，避免同一会话并发写撕裂。
 */
import { appendFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { JsonFileStore, assertSafePathSegment } from '../../task/store/file-store.ts'
import { childId, nowIso } from '../../task/store/id.ts'
import {
  MOOT_REGISTRY_VERSION,
  type Dossier,
  type Issue,
  type MootRegistry,
  type MootReport,
  type TrialSession,
  type TranscriptEntry,
} from './types.ts'

/** 建会话的输入。 */
export interface CreateSessionInput {
  title: string
  procedure: TrialSession['procedure']
  mode: TrialSession['mode']
  tribunal: TrialSession['tribunal']
  arbitrationRules?: TrialSession['arbitrationRules']
  config: TrialSession['config']
  dossier: Dossier
}

export interface MootStore {
  readonly dataDir: string
  sessionDir(id: string): string
  listSessions(): Promise<TrialSession[]>
  getSession(id: string): Promise<TrialSession | undefined>
  createSession(input: CreateSessionInput): Promise<TrialSession>
  updateSession(id: string, mutate: (session: TrialSession) => TrialSession): Promise<TrialSession>
  deleteSession(id: string): Promise<{ deleted: boolean }>
  readDossier(id: string): Promise<Dossier | undefined>
  writeDossier(id: string, dossier: Dossier): Promise<void>
  appendTranscript(id: string, entry: Omit<TranscriptEntry, 'seq' | 'createdAt'> & { createdAt?: string }): Promise<TranscriptEntry>
  readTranscript(id: string, sinceSeq?: number): Promise<TranscriptEntry[]>
  writeIssues(id: string, issues: Issue[]): Promise<void>
  readIssues(id: string): Promise<Issue[]>
  writeJudgment(id: string, markdown: string): Promise<void>
  readJudgment(id: string): Promise<string>
  writeReport(id: string, report: MootReport): Promise<void>
  readReport(id: string): Promise<MootReport | undefined>
}

/** 逐会话串行队列：同一会话的写操作不交叉。 */
const queues = new Map<string, Promise<unknown>>()

function enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve()
  const next = prev.then(task, task)
  queues.set(key, next.then(() => undefined, () => undefined))
  return next
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    const raw = await readFile(file, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    return parsed !== null && typeof parsed === 'object' ? (parsed as T) : undefined
  } catch {
    return undefined
  }
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(resolve(file, '..'), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
  const { rename } = await import('node:fs/promises')
  await rename(tmp, file)
}

export function createMootStore(dataDir: string, ctx: Context): MootStore {
  const root = resolve(dataDir)
  const sessionsRoot = join(root, 'sessions')

  const registry = new JsonFileStore<MootRegistry>(
    join(root, 'sessions.json'),
    () => ({ registryVersion: MOOT_REGISTRY_VERSION, sessions: {}, lastUpdated: nowIso() }),
    ctx,
  )

  const sessionDir = (id: string): string => {
    assertSafePathSegment(id, 'sessionId')
    return join(sessionsRoot, id)
  }

  const file = (id: string, name: string): string => join(sessionDir(id), name)

  return {
    dataDir: root,
    sessionDir,

    async listSessions() {
      const reg = await registry.read()
      return Object.values(reg.sessions).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    },

    async getSession(id) {
      const reg = await registry.read()
      return reg.sessions[id]
    },

    async createSession(input) {
      const id = childId('mt')
      const now = nowIso()
      const session: TrialSession = {
        id,
        title: input.title,
        procedure: input.procedure,
        mode: input.mode,
        tribunal: input.tribunal,
        ...(input.arbitrationRules === undefined ? {} : { arbitrationRules: input.arbitrationRules }),
        status: 'draft',
        phase: '',
        phaseIndex: 0,
        round: 0,
        config: input.config,
        stats: { tokensUsed: 0, calls: 0, phasesDone: [] },
        createdAt: now,
        updatedAt: now,
      }
      await mkdir(sessionDir(id), { recursive: true })
      await writeJson(file(id, 'dossier.json'), input.dossier)
      await writeJson(file(id, 'session.json'), session)
      await writeFile(file(id, 'transcript.jsonl'), '', 'utf8')
      await registry.mutate((reg) => {
        reg.sessions[id] = session
        reg.lastUpdated = now
        return reg
      }, 'moot', undefined, 'moot-create-session')
      return session
    },

    async updateSession(id, mutate) {
      let updated: TrialSession | undefined
      await registry.mutate((reg) => {
        const existing = reg.sessions[id]
        if (existing === undefined) throw new Error(`moot session not found: ${id}`)
        const next = mutate({ ...existing })
        next.updatedAt = nowIso()
        reg.sessions[id] = next
        reg.lastUpdated = next.updatedAt
        updated = next
        return reg
      }, 'moot', undefined, 'moot-update-session')
      // 元数据镜像（单会话可读副本，与索引一致）。
      await writeJson(file(id, 'session.json'), updated!)
      return updated!
    },

    async deleteSession(id) {
      await rm(sessionDir(id), { recursive: true, force: true })
      await registry.mutate((reg) => {
        delete reg.sessions[id]
        reg.lastUpdated = nowIso()
        return reg
      }, 'moot', undefined, 'moot-delete-session')
      return { deleted: true }
    },

    async readDossier(id) {
      return readJson<Dossier>(file(id, 'dossier.json'))
    },

    async writeDossier(id, dossier) {
      await writeJson(file(id, 'dossier.json'), dossier)
    },

    async appendTranscript(id, entry) {
      return enqueue(`transcript:${id}`, async () => {
        const dir = sessionDir(id)
        await mkdir(dir, { recursive: true })
        const all = await this.readTranscript(id)
        const next: TranscriptEntry = {
          ...entry,
          seq: all.length + 1,
          createdAt: entry.createdAt ?? nowIso(),
        }
        await appendFile(file(id, 'transcript.jsonl'), `${JSON.stringify(next)}\n`, 'utf8')
        return next
      })
    },

    async readTranscript(id, sinceSeq = 0) {
      try {
        const raw = await readFile(file(id, 'transcript.jsonl'), 'utf8')
        const out: TranscriptEntry[] = []
        for (const line of raw.split('\n')) {
          const trimmed = line.trim()
          if (trimmed === '') continue
          try {
            const parsed = JSON.parse(trimmed) as TranscriptEntry
            if (typeof parsed.seq !== 'number') continue
            if (parsed.seq > sinceSeq) out.push(parsed)
          } catch {
            // 损坏行跳过：单行损坏不应让整场庭审不可读。
          }
        }
        return out
      } catch {
        return []
      }
    },

    async writeIssues(id, issues) {
      await writeJson(file(id, 'issues.json'), { issues, updatedAt: nowIso() })
    },

    async readIssues(id) {
      const doc = await readJson<{ issues: Issue[] }>(file(id, 'issues.json'))
      return doc?.issues ?? []
    },

    async writeJudgment(id, markdown) {
      await mkdir(sessionDir(id), { recursive: true })
      await writeFile(file(id, 'judgment.md'), markdown, 'utf8')
    },

    async readJudgment(id) {
      try {
        return await readFile(file(id, 'judgment.md'), 'utf8')
      } catch {
        return ''
      }
    },

    async writeReport(id, report) {
      await writeJson(file(id, 'report.json'), report)
    },

    async readReport(id) {
      return readJson<MootReport>(file(id, 'report.json'))
    },
  }
}

/** 清理陈旧会话目录（无索引记录的孤儿目录）。 */
export async function pruneOrphanSessionDirs(store: MootStore, keepIds: Set<string>): Promise<string[]> {
  const removed: string[] = []
  try {
    const entries = await readdir(join(store.dataDir, 'sessions'), { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (keepIds.has(entry.name)) continue
      await rm(join(store.dataDir, 'sessions', entry.name), { recursive: true, force: true })
      removed.push(entry.name)
    }
  } catch {
    // 目录不存在：首次运行时正常。
  }
  return removed
}
