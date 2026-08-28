/**
 * Ideas — 输入触发器（`#` 命令）。
 *
 * 输入 `#` 弹出「想法」候选列表，选中即插入 `#idea-<id>` 引用令牌。
 * 用 `#` 而非 `@`，避免与 DSH 文件引用（@）触发冲突。
 */
import { listIdeas } from './api.ts'
import { insertIdeaReference, ideaRefToken } from './reference.ts'

/** 最小 InputTriggerSource 结构（同 skills-tools，避免引入运行时依赖）。 */
export interface IdeaTriggerSource {
  trigger: string
  name: string
  order?: number
  candidates(session: unknown, req: { query?: unknown }): Promise<Array<{ name: string; icon?: string; hint?: string; value?: string; section?: string }>>
  onPick(pick: { candidate: { value?: string } }): { text: string }
}

export interface IdeaTriggerContext {
  inputTriggers?: {
    registerSource(source: IdeaTriggerSource): () => void
  }
}

const BULB_ICON = 'data:image/svg+xml;utf8,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%23C26D3A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="M9 18h6"/%3E%3Cpath d="M10 21h4"/%3E%3Cpath d="M12 3a6 6 0 0 0-4 10.5c.8.7 1.2 1.7 1.4 2.5h5.2c.2-.8.6-1.8 1.4-2.5A6 6 0 0 0 12 3Z"/%3E%3C/svg%3E'

/** `#` 命令源：想法列表。 */
export function registerIdeaTrigger(ctx: IdeaTriggerContext): () => void {
  if (ctx.inputTriggers === undefined) return () => {}
  return ctx.inputTriggers.registerSource({
    trigger: '#',
    name: '想法',
    order: 42,
    candidates: async (_session, req) => {
      const q = String(req.query ?? '').toLowerCase()
      try {
        const all = await listIdeas('all')
        const items = all
          .sort((a, b) => {
            const ao = a.status === 'archived' ? 1 : 0
            const bo = b.status === 'archived' ? 1 : 0
            if (ao !== bo) return ao - bo
            return (b.updatedAt ?? b.createdAt ?? '').localeCompare(a.updatedAt ?? a.createdAt ?? '')
          })
          .filter((i) => {
            if (i.status === 'archived') return false
            if (q === '') return true
            return i.title.toLowerCase().includes(q) || (i.content ?? '').toLowerCase().includes(q)
          })
          .slice(0, 20)
          .map((i) => ({
            name: i.title,
            icon: BULB_ICON,
            hint: i.caseName ?? i.caseId ?? '',
            value: i.id,
            section: '想法',
          }))
        return items
      } catch {
        return []
      }
    },
    onPick: (pick) => {
      const id = pick.candidate.value ?? ''
      if (id !== '') insertIdeaReference(id)
      return { text: '' }
    },
  })
}

/** 导出令牌构造，供 # 菜单项复用（保持单一来源）。 */
export { ideaRefToken }
