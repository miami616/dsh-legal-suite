/** Data model for the non-litigation store. */

/** A task inside a project task group (same shape as litigation). */
export interface ProjectTask {
  id: string
  title: string
  detail?: string
  deadline?: string
  /** 具体时间（HH:mm），与 deadline（纯日期）分开存。 */
  time?: string
  priority?: 'low' | 'medium' | 'high'
  status: 'todo' | 'doing' | 'done'
  subtasks?: Array<{ id: string; title: string; done: boolean; [k: string]: unknown }>
  checklist?: Array<{ id: string; text: string; done: boolean; [k: string]: unknown }>
  /**
   * 该任务由哪个阶段模板任务展开而来（存模板里的规范标题）。管家改名后
   * 据此仍能识别「已展开过」，避免重复展开时又新建一个原名版本。
   */
  templateTitle?: string
  createdAt?: string
  updatedAt?: string
}

export interface ProjectTaskGroup {
  id: string
  name: string
  order: number
  tasks: ProjectTask[]
  createdAt?: string
  updatedAt?: string
}

export interface ProjectRecord {
  projectId: string
  name: string
  projectType: string
  status: string
  leadLawyer?: string
  contractAmount?: string
  servicePeriod?: { start?: string; end?: string }
  serviceScope?: string[]
  folder?: string
  summary?: string
  keyDates?: Array<{ id: string; label: string; date: string; done?: boolean; createdAt?: string; updatedAt?: string }>
  taskGroups?: ProjectTaskGroup[]
  linkedContracts?: string[]
  linkedResearch?: string[]
  createdAt?: string
  updatedAt?: string
}

export interface ProjectRegistry {
  registryVersion: string
  lastUpdated?: string
  projects: Record<string, ProjectRecord>
}

export interface ServiceRecord {
  id: string
  name: string
  kind?: string
  client?: string
  status?: string
  date?: string
  note?: string
  createdAt?: string
  updatedAt?: string
}

export interface ServiceRegistry {
  registryVersion: string
  lastUpdated?: string
  services: Record<string, ServiceRecord>
}

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  hint?: string
}
