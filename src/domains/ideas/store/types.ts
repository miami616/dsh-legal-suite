/**
 * Data model for the ideas/notes store.
 *
 * 想法 = 个人备忘。除标题/正文外支持：可选关联案件（caseId/caseName）、
 * 标签（tags），以及生命周期状态 status：
 *   - active    进行中（默认，面板「全部/进行中」视图）
 *   - done      已实现/已完成（面板以删除线呈现「划掉」）
 *   - archived  已归档（从主视图收拢到「已归档」标签）
 * 删除为硬删除（deleteIdea）。
 */

export type IdeaStatus = 'active' | 'done' | 'archived'

export interface IdeaItem {
  id: string
  title: string
  /** 正文（多行，可空；仅标题也可成一条）。 */
  content?: string
  /** 可选关联案件编号。 */
  caseId?: string
  /** 可选关联案件名称（冗余，便于列表直接显示）。 */
  caseName?: string
  /** 可选标签。 */
  tags?: string[]
  status: IdeaStatus
  createdAt?: string
  updatedAt?: string
}

export interface IdeasRegistry {
  registryVersion: string
  lastUpdated?: string
  ideas: Record<string, IdeaItem>
}

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}
