/**
 * Browser-half API client for /api/agentlex-case/*.
 *
 * All calls are same-origin POST with a JSON body; the host responds with
 * the envelope { success, data|error, hint? } (src/routes.ts). Errors surface
 * as thrown Error with the host message, so React callers can render them.
 */
import type {
  CaseRecord, CaseRegistry, CaseTask, ScheduleItem, Subtask, TaskGroup, TimelineEvent,
} from '../store/types.ts'

/** Envelope as the host sends it. */
interface Envelope<T> {
  success: boolean
  data?: T
  error?: string
  hint?: string
}

/** POST a JSON body to an agentlex-case route and unwrap the envelope. */
async function call<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api/agentlex-case/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (error) {
    throw new Error(`host unreachable: ${error instanceof Error ? error.message : String(error)}`)
  }
  let envelope: Envelope<T>
  try {
    envelope = await response.json() as Envelope<T>
  } catch {
    throw new Error(`host returned non-JSON (${response.status})`)
  }
  if (!envelope.success) {
    const err = new Error(envelope.error ?? `request failed (${response.status})`)
    ;(err as Error & { hint?: string }).hint = envelope.hint
    throw err
  }
  return envelope.data as T
}

/* ------------------------------- health ------------------------------- */

export function health(): Promise<{ ok: boolean; plugin: string; status: string }> {
  return call('health')
}

/* -------------------------------- cases ------------------------------- */

export function readRegistry(): Promise<CaseRegistry> {
  return call('read')
}

export function readCase(caseId: string): Promise<CaseRecord> {
  return call('read-case', { caseId })
}

export function registerCase(input: Record<string, unknown>): Promise<CaseRecord> {
  return call('register-case', input)
}

export function updateCase(caseId: string, patch: Record<string, unknown>): Promise<CaseRecord> {
  return call('update-case', { caseId, ...patch })
}

export function deleteCase(caseId: string): Promise<{ deleted: boolean }> {
  return call('delete-case', { caseId })
}

/* ------------------------------ key dates ----------------------------- */

export function addKeyDate(caseId: string, label: string, date: string): Promise<CaseRecord> {
  return call('add-keydate', { caseId, label, date })
}

export function toggleKeyDate(caseId: string, keyDateId: string): Promise<CaseRecord> {
  return call('toggle-keydate', { caseId, keyDateId })
}

/* ---------------------------- task groups ----------------------------- */

export function upsertTaskGroup(caseId: string, group: Partial<TaskGroup>): Promise<CaseRecord> {
  return call('group', { caseId, ...group })
}

export function deleteTaskGroup(caseId: string, groupId: string): Promise<CaseRecord> {
  return call('delete-group', { caseId, groupId })
}

export function reorderTaskGroups(caseId: string, orderedIds: string[]): Promise<CaseRecord> {
  return call('reorder-groups', { caseId, orderedIds })
}

/* -------------------------------- tasks ------------------------------- */

export function upsertTask(caseId: string, groupId: string, task: Partial<CaseTask>): Promise<CaseRecord> {
  return call('task', { caseId, groupId, ...task })
}

export function deleteTask(caseId: string, groupId: string, taskId: string): Promise<CaseRecord> {
  return call('delete-task', { caseId, groupId, taskId })
}

export function moveTask(caseId: string, taskId: string, toGroupId: string, index?: number): Promise<CaseRecord> {
  return call('move-task', { caseId, taskId, toGroupId, index })
}

export function setTaskKeyDate(caseId: string, groupId: string, taskId: string, enabled: boolean): Promise<CaseRecord> {
  return call('set-task-keydate', { caseId, groupId, taskId, enabled })
}

/* ------------------------------- subtasks ----------------------------- */

export function upsertSubtask(caseId: string, groupId: string, taskId: string, subtask: Partial<Subtask>): Promise<CaseRecord> {
  return call('subtask', { caseId, groupId, taskId, ...subtask })
}

export function deleteSubtask(caseId: string, groupId: string, taskId: string, subtaskId: string): Promise<CaseRecord> {
  return call('delete-subtask', { caseId, groupId, taskId, subtaskId })
}

export function toggleChecklist(caseId: string, groupId: string, taskId: string, checklistId: string): Promise<CaseRecord> {
  return call('check', { caseId, groupId, taskId, checklistId })
}

/* ------------------------------- timeline ----------------------------- */

export function listEvents(caseId?: string): Promise<TimelineEvent[]> {
  return call('events', caseId === undefined ? {} : { caseId })
}

export function upsertEvent(event: Partial<TimelineEvent>): Promise<TimelineEvent> {
  return call('event', event as Record<string, unknown>)
}

export function deleteEvent(eventId: string): Promise<{ deleted: boolean }> {
  return call('delete-event', { eventId })
}

export function toggleEvent(eventId: string): Promise<TimelineEvent> {
  return call('toggle-event', { eventId })
}

/* ------------------------------- schedules ---------------------------- */

export function listSchedules(caseId?: string): Promise<ScheduleItem[]> {
  return call('schedules', caseId === undefined ? {} : { caseId })
}

export function upsertSchedule(item: Partial<ScheduleItem>): Promise<ScheduleItem> {
  return call('schedule', item as Record<string, unknown>)
}

export function deleteSchedule(itemId: string): Promise<{ deleted: boolean }> {
  return call('delete-schedule', { itemId })
}

export function toggleSchedule(itemId: string): Promise<ScheduleItem> {
  return call('toggle-schedule', { itemId })
}

/* ------------------------------- deadlines ---------------------------- */

export function listDeadlines(caseId?: string): Promise<unknown> {
  return call('deadlines', caseId === undefined ? {} : { caseId })
}

export function parseReminder(value: string | number): Promise<{ minutes: number }> {
  return call('parse-reminder', { value })
}

/* -------------------------------- import ------------------------------ */

export interface ImportResult {
  added: number
  updated: number
  skipped: number
  eventsImported: number
  detail: string[]
}

export function importAgentLex(sourceDir?: string): Promise<ImportResult> {
  return call('import-agentlex', sourceDir === undefined ? {} : { sourceDir })
}

/* --------------------------- case folder files ------------------------- */

export interface FolderTreeNode {
  id: string
  name: string
  path: string
  type: 'file' | 'dir'
  children?: FolderTreeNode[]
  loaded?: boolean
}

export interface FolderTreeResult {
  root: string
  summary: { totalFiles: number; totalDirs: number }
  tree: FolderTreeNode
  truncated: boolean
}

export interface ExpandDirectoryResult {
  children: FolderTreeNode[]
  loaded: boolean
}

export interface FolderSearchResult {
  matches: string[]
  truncated: boolean
}

export interface PreviewResult {
  content: string
  name: string
  size: number
}

export interface DownloadResult {
  name: string
  mimeType: string
  data: string
}

/* --------------------------- plugin update ------------------------- */

export interface PluginUpdateTriple {
  pkg: string
  label: string
  from: string
  to: string
}

/** 成员启动链路接线状态（与宿主 updater.ts 一致）。 */
export type SuiteLoadState = 'enabled' | 'installed' | 'missing'

export interface PluginVersionCheck {
  source: string
  installed: Record<string, string>
  latest: Record<string, string>
  publishDate: Record<string, string>
  /** 每个成员的接线状态：enabled=已接入启动链路 / installed=已装未启用 / missing=未安装。 */
  loadState: Record<string, SuiteLoadState>
  updates: PluginUpdateTriple[]
  /** 套件最新版声明、但本 profile 未装配的成员（不会自动安装，需随组合包更新接入）。 */
  unassembled: string[]
  updateAvailable: boolean
  error?: string
}

export interface PluginUpdateResult {
  updated: PluginUpdateTriple[]
  skipped: string[]
  errors: Array<{ pkg: string; error: string }>
  /** 已装/已更新但仍未接入启动链路的成员（重启也不会加载，需更新组合包或手动接线）。 */
  notWired?: string[]
  /** 本 profile 未装配、已跳过的套件新成员（桌面版剥离的成员等，不会自动安装）。 */
  unassembled: string[]
  /** 因发布冷却（minimumReleaseAge）而预先写入豁免清单的 pkg@version。 */
  policyExcluded?: string[]
  backupRoot?: string
  profilePackageJson?: string
  restartRequired: boolean
}

/** 检测插件版本：返回已安装版本、registry 最新版本与需要更新的包列表。 */
export function checkPluginUpdate(): Promise<PluginVersionCheck> {
  return call('plugin-version')
}

/** self-version 接口的响应。 */
export interface SelfVersion {
  version: string
}

let selfVersionPromise: Promise<string> | undefined

/**
 * 当前「运行中」的插件版本：服务端模块加载时读安装目录 package.json 并缓存，
 * 更新重启后自动跟随。结果按页面会话缓存；接口不可用时返回空串，由调用方
 * 回退到构建期常量 __PLUGIN_VERSION__。
 */
export function getSelfPluginVersion(): Promise<string> {
  selfVersionPromise ??= call<SelfVersion>('self-version')
    .then((r) => (typeof r.version === 'string' ? r.version : ''))
    .catch(() => '')
  return selfVersionPromise
}

/** 执行插件更新；完成后需重启 DSH 生效。 */
export function runPluginUpdate(pkg?: string): Promise<PluginUpdateResult> {
  return call('plugin-update', pkg === undefined ? {} : { pkg })
}

/** 自更新进度快照（前端轮询展示）。 */
export interface UpdateProgress {
  running: boolean
  phase: 'idle' | 'checking' | 'installing' | 'done' | 'error'
  pkg?: string
  from?: string
  to?: string
  receivedBytes?: number
  totalBytes?: number
  stepIndex: number
  stepCount: number
  message?: string
  error?: string
}

/** 读取当前更新进度。 */
export function getPluginUpdateStatus(): Promise<UpdateProgress> {
  return call('plugin-update-status')
}

/** 取消进行中的更新。 */
export function cancelPluginUpdate(): Promise<{ ok: boolean }> {
  return call('plugin-update-cancel')
}

/** 一键修复 pnpm 供应链策略（minimumReleaseAge）拦截：把被拦包加入排除清单。 */
export interface PluginPolicyFixResult {
  ok: boolean
  added: string[]
  error?: string
}

export function fixPluginPolicy(): Promise<PluginPolicyFixResult> {
  return call('plugin-policy-fix')
}

export function folderTree(path: string): Promise<FolderTreeResult> {
  return call('folder-tree', { path })
}

export function folderExpand(path: string, dir: string): Promise<ExpandDirectoryResult> {
  return call('folder-expand', { path, dir })
}

export function folderSearch(path: string, query: string): Promise<FolderSearchResult> {
  return call('folder-search', { path, query })
}

export function filePreview(path: string, file: string): Promise<PreviewResult> {
  return call('file-preview', { path, file })
}

export function fileDownload(path: string, file: string): Promise<DownloadResult> {
  return call('file-download', { path, file })
}

export function openPath(path: string, file?: string, kind: 'finder' | 'default' = 'default'): Promise<{ ok: boolean }> {
  return call('open-path', { path, ...(file === undefined ? {} : { file }), kind })
}
