/**
 * Ideas — 会话输入框「#」选择按钮（conversation.input.left 槽位）。
 *
 * 点击展开想法下拉，选中一条即往输入框插入 `#idea-<id>` 引用令牌
 * （AI 见令牌调用 ideas 工具按 id 拉全文）。参考 codex-ui「技能」按钮设计，
 * 复用 chat-input-bridge 保留输入框已有内容。
 */
import { useEffect, useRef, useState } from 'react'
import { listIdeas } from './api.ts'
import { insertIdeaReference } from './reference.ts'
import type { IdeaItem } from '../store/types.ts'
import css from './panel.module.css'

export interface IdeasPickerProps {
  /** 会话输入动作（备用；实际用 chat-input-bridge 写草稿）。 */
  inputActions?: { setDraft(text: string): void }
  [key: string]: unknown
}

function BulbIcon({ size = 14 }: { size?: number }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-4 10.5c.8.7 1.2 1.7 1.4 2.5h5.2c.2-.8.6-1.8 1.4-2.5A6 6 0 0 0 12 3Z"/>
    </svg>
  )
}

export function IdeasPicker(props: IdeasPickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [ideas, setIdeas] = useState<IdeaItem[]>([])
  const [query, setQuery] = useState('')
  const wrapRef = useRef<HTMLDivElement | null>(null)

  const load = (): void => {
    void listIdeas('all').then((all) => {
      // 默认按最近更新排（后端已排序）；未归档在前。
      const sorted = [...all].sort((a, b) => {
        const ao = a.status === 'archived' ? 1 : 0
        const bo = b.status === 'archived' ? 1 : 0
        if (ao !== bo) return ao - bo
        return (b.updatedAt ?? b.createdAt ?? '').localeCompare(a.updatedAt ?? a.createdAt ?? '')
      })
      setIdeas(sorted)
    }).catch(() => setIdeas([]))
  }

  useEffect(() => {
    if (open) load()
    const onChanged = (): void => { if (open) load() }
    window.addEventListener('agentlex:ideas-changed', onChanged)
    return () => window.removeEventListener('agentlex:ideas-changed', onChanged)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDocClick = (event: MouseEvent): void => {
      if (wrapRef.current !== null && !wrapRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('click', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pick = (idea: IdeaItem): void => {
    setOpen(false)
    insertIdeaReference(idea.id)
  }

  const q = query.trim().toLowerCase()
  const filtered = q === '' ? ideas : ideas.filter((i) =>
    i.title.toLowerCase().includes(q) || (i.content ?? '').toLowerCase().includes(q),
  )

  return (
    <div className={css.pickerWrap} ref={wrapRef}>
      <button
        type="button"
        className={css.pickerBtn}
        title="想法 / 备忘 · 点击引用 (#idea)"
        aria-label="想法"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={css.pickerIcon}><BulbIcon size={13} /></span>
        <span className={css.pickerLabel}>想法</span>
      </button>
      {open && (
        <div className={css.pickerMenu} role="menu">
          <input
            className={css.pickerSearch}
            autoFocus
            placeholder="搜索想法…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {filtered.length === 0 && <div className={css.pickerEmpty}>暂无想法</div>}
          {filtered.map((idea) => (
            <button key={idea.id} type="button" role="menuitem" className={css.pickerItem} onClick={() => pick(idea)}>
              <span className={css.pickerItemIcon}><BulbIcon size={14} /></span>
              <span className={css.pickerItemName}>
                {idea.status === 'done' ? '✓ ' : idea.status === 'archived' ? '▣ ' : ''}{idea.title}
              </span>
              <span className={css.pickerItemHint}>
                {idea.caseName ?? idea.caseId ?? ''}
                {idea.status === 'done' ? ' · 已完成' : idea.status === 'archived' ? ' · 已归档' : ''}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
