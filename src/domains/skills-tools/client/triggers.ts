/**
 * 技能与工具 — 输入触发器（`/` 命令）。
 *
 * 输入 `/` 弹出「技能与工具」命令组 —— 只保留面板操作项：
 * 打开技能与工具面板 / 添加技能 · 添加 MCP。
 * （技能与 MCP 的直接调用改由输入框「技能」按钮菜单完成；`/` 菜单
 * 不再列出技能 / MCP 条目，保持干净。与系统命令菜单并存，多源分组。）
 */
import { openPanel } from './summon.ts'

/** 最小 InputTriggerSource 结构（避免引入 dsh-client-ui-input-trigger 运行时依赖）。 */
export interface SkillTriggerSource {
  trigger: string
  name: string
  order?: number
  candidates(session: unknown, req: { query?: unknown }): Promise<Array<{ name: string; icon?: string; hint?: string; value?: string; section?: string }>>
  onPick(pick: { candidate: { value?: string } }): { text: string }
}

export interface SkillTriggerContext {
  inputTriggers?: {
    registerSource(source: SkillTriggerSource): () => void
  }
}

const SKILLS_ICON = 'data:image/svg+xml;utf8,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="%23C26D3A" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="M8 1.8 9.5 6.5 14.2 8 9.5 9.5 8 14.2 6.5 9.5 1.8 8 6.5 6.5z"/%3E%3Cpath d="M12.7 9.7l.7 1.9 1.9.7-1.9.7-.7 1.9-.7-1.9-1.9-.7 1.9-.7z" opacity="0.55"/%3E%3C/svg%3E'
const PLUS_ICON = 'data:image/svg+xml;utf8,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="%23C26D3A" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"%3E%3Cpath d="M8 3v10M3 8h10"/%3E%3C/svg%3E'

/** `/` 命令源：技能与工具命令组（仅面板操作项）。 */
export function registerSlashSource(ctx: SkillTriggerContext): () => void {
  if (ctx.inputTriggers === undefined) return () => {}
  return ctx.inputTriggers.registerSource({
    trigger: '/',
    name: '技能与工具',
    order: 40,
    candidates: async (_session, req) => {
      const q = String(req.query ?? '').toLowerCase()
      const matches = (text: string): boolean => q === '' || text.toLowerCase().includes(q)
      const items: Array<{ name: string; icon?: string; hint?: string; value?: string; section?: string }> = []
      if (matches('打开') || matches('技能') || matches('工具') || matches('面板')) {
        items.push({ name: '打开技能与工具面板', icon: SKILLS_ICON, hint: '技能 / 工具选项卡', value: 'panel:skills', section: '面板' })
      }
      if (matches('添加') || matches('技能') || matches('mcp') || matches('工具')) {
        items.push({ name: '添加技能 / 添加 MCP', icon: PLUS_ICON, hint: '上传 zip / .skill / .md · 粘贴 JSON 配置', value: 'panel:skills-add', section: '面板' })
      }
      return items
    },
    onPick: (pick) => {
      const value = pick.candidate.value ?? ''
      if (value === 'panel:skills' || value === 'panel:skills-add' || value === 'panel:tools' || value === 'panel:tools-add') {
        openPanel(value === 'panel:tools' || value === 'panel:tools-add' ? 'tools' : 'skills')
      }
      return { text: '' }
    },
  })
}
