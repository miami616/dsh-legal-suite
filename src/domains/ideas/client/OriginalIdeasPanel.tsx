/**
 * Ideas 弹窗 — 想法/备忘主面板（居中弹窗）。
 *
 * 顶部是醒目的大输入框（快速记录），下方统计条 + 选项卡 + 案件过滤 + 搜索，
 * 列表支持状态流转（完成划掉 / 归档 / 删除）、编辑、引用到输入框、复制引用。
 * 整体居中浮层，遮罩点击或 ✕ 关闭。
 */
import { useEffect, useMemo, useState } from 'react'
import { listIdeas, upsertIdea, setStatus, deleteIdea } from './api.ts'
import { copyIdeaReference, insertIdeaReference } from './reference.ts'
import { tt } from './i18n.ts'
import type { IdeaItem, IdeaStatus } from '../store/types.ts'
import css from './panel.module.css'

type Tab = 'all' | IdeaStatus

interface EditorState {
  id?: string
  title: string
  content: string
  caseId: string
  tags: string
}

const emptyEditor: EditorState = { title: '', content: '', caseId: '', tags: '' }

export interface IdeasPanelProps {
  onClose: () => void
}

export function OriginalIdeasPanel({ onClose }: IdeasPanelProps): React.JSX.Element {
  const [ideas, setIdeas] = useState<IdeaItem[]>([])
  const [tab, setTab] = useState<Tab>('all')
  const [search, setSearch] = useState('')
  const [caseFilter, setCaseFilter] = useState('')
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [note, setNote] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [quick, setQuick] = useState('')

  const refresh = async (): Promise<void> => {
    try {
      setIdeas(await listIdeas())
    } catch (error) {
      setNote({ kind: 'err', text: error instanceof Error ? error.message : tt('error') })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    const onChanged = (): void => void refresh()
    window.addEventListener('agentlex:ideas-changed', onChanged)
    return () => window.removeEventListener('agentlex:ideas-changed', onChanged)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (editor !== null) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [editor, onClose])

  const showNote = (kind: 'ok' | 'err', text: string): void => {
    setNote({ kind, text })
    window.setTimeout(() => setNote(null), 2500)
  }

  const quickAdd = async (): Promise<void> => {
    const title = quick.trim()
    if (title === '') return
    try {
      const idea = await upsertIdea({ title })
      setQuick('')
      // 乐观更新：立即把新想法插入列表，避免依赖可能滞后的 refresh()。
      setIdeas((prev) => [idea, ...prev.filter((i) => i.id !== idea.id)])
      void refresh()
    } catch (error) {
      showNote('err', error instanceof Error ? error.message : tt('error'))
    }
  }

  const saveEditor = async (): Promise<void> => {
    if (editor === null) return
    const title = editor.title.trim()
    if (title === '') return
    const tags = editor.tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean)
    const input: Record<string, unknown> = {
      title,
      content: editor.content,
      tags,
      caseId: editor.caseId.trim() || undefined,
    }
    if (editor.id !== undefined) input.id = editor.id
    try {
      await upsertIdea(input)
      setEditor(null)
      await refresh()
      showNote('ok', tt('saved'))
    } catch (error) {
      showNote('err', error instanceof Error ? error.message : tt('error'))
    }
  }

  const toggleDone = async (idea: IdeaItem): Promise<void> => {
    try {
      await setStatus(idea.id, idea.status === 'done' ? 'active' : 'done')
      await refresh()
    } catch (error) {
      showNote('err', error instanceof Error ? error.message : tt('error'))
    }
  }

  const toggleArchive = async (idea: IdeaItem): Promise<void> => {
    try {
      await setStatus(idea.id, idea.status === 'archived' ? 'active' : 'archived')
      await refresh()
    } catch (error) {
      showNote('err', error instanceof Error ? error.message : tt('error'))
    }
  }

  const remove = async (idea: IdeaItem): Promise<void> => {
    if (!window.confirm(tt('actions.deleteConfirm'))) return
    try {
      await deleteIdea(idea.id)
      await refresh()
    } catch (error) {
      showNote('err', error instanceof Error ? error.message : tt('error'))
    }
  }

  const doCopyRef = async (idea: IdeaItem): Promise<void> => {
    try {
      await copyIdeaReference(idea.id)
      showNote('ok', tt('copied'))
    } catch {
      showNote('err', tt('error'))
    }
  }

  const stats = useMemo(() => {
    const active = ideas.filter((i) => i.status === 'active').length
    const done = ideas.filter((i) => i.status === 'done').length
    const archived = ideas.filter((i) => i.status === 'archived').length
    return { total: ideas.length, active, done, archived }
  }, [ideas])

  const caseList = useMemo(() => {
    const seen = new Map<string, string>()
    for (const i of ideas) {
      if (i.caseId !== undefined && i.caseId !== '') seen.set(i.caseId, i.caseName ?? i.caseId)
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }))
  }, [ideas])

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase()
    return ideas.filter((i) => {
      if (tab !== 'all' && i.status !== tab) return false
      if (caseFilter !== '' && i.caseId !== caseFilter) return false
      if (q === '') return true
      return (i.title.toLowerCase().includes(q) || (i.content ?? '').toLowerCase().includes(q))
    })
  }, [ideas, tab, search, caseFilter])

  const statusLabel = (status: IdeaStatus): string => {
    return status === 'done' ? tt('status.done') : status === 'archived' ? tt('status.archived') : tt('status.active')
  }

  return (
    <div className={css.overlay} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={css.modal} role="dialog" aria-modal="true" aria-label={tt('panel.title')}>
        {/* 标题栏 */}
        <header className={css.header}>
          <h2 className={css.title}>{tt('panel.title')}</h2>
          <span className={css.subtitle}>{tt('panel.subtitle')}</span>
          <button type="button" className={css.close} aria-label={tt('add.cancel')} onClick={onClose}>✕</button>
        </header>

        {/* 顶部大输入框 */}
        <div className={css.quickBox}>
          <input
            className={css.quickInput}
            autoFocus
            placeholder={tt('add.placeholder')}
            value={quick}
            onChange={(e) => setQuick(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void quickAdd() }}
          />
          <button type="button" className={css.primaryBtn} onClick={() => void quickAdd()}>{tt('add.btn')}</button>
        </div>

        {/* 完整编辑器（新建 / 编辑） */}
        {editor !== null && (
          <div className={css.editor}>
            <p className={css.editorTitle}>{editor.id !== undefined ? tt('add.editing') : tt('panel.title')}</p>
            <input
              className={css.input}
              autoFocus
              placeholder={tt('add.titlePh')}
              value={editor.title}
              onChange={(e) => setEditor({ ...editor, title: e.target.value })}
            />
            <textarea
              className={css.textarea}
              placeholder={tt('add.contentPh')}
              value={editor.content}
              onChange={(e) => setEditor({ ...editor, content: e.target.value })}
            />
            <div className={css.editorRow}>
              <input className={css.input} placeholder={tt('add.casePh')} value={editor.caseId}
                onChange={(e) => setEditor({ ...editor, caseId: e.target.value })} />
              <input className={css.input} placeholder={tt('add.tagsPh')} value={editor.tags}
                onChange={(e) => setEditor({ ...editor, tags: e.target.value })} />
            </div>
            <div className={css.editorActions}>
              <button type="button" className={css.secondaryBtn} onClick={() => setEditor(null)}>{tt('add.cancel')}</button>
              <button type="button" className={css.primaryBtn} onClick={() => void saveEditor()}>{tt('add.save')}</button>
            </div>
          </div>
        )}

        {note !== null && (
          <div className={`${css.note} ${note.kind === 'ok' ? css.noteOk : css.noteErr}`}>{note.text}</div>
        )}

        {/* 统计 + 工具行 */}
        <div className={css.statsBar}>
          <div className={css.statBlock}><span className={css.statNum}>{stats.active}</span><span className={css.statLabel}>{tt('stats.active')}</span></div>
          <div className={css.statDivider} />
          <div className={css.statBlock}><span className={css.statNumSuccess}>{stats.done}</span><span className={css.statLabel}>{tt('stats.done')}</span></div>
          <div className={css.statDivider} />
          <div className={css.statBlock}><span className={css.statNumCool}>{stats.archived}</span><span className={css.statLabel}>{tt('stats.archived')}</span></div>
          <div className={css.statDivider} />
          <div className={css.statBlock}><span className={css.statNum}>{stats.total}</span><span className={css.statLabel}>{tt('stats.total')}</span></div>
        </div>

        <div className={css.toolbar}>
          <div className={css.tabs}>
            {(['all', 'active', 'done', 'archived'] as Tab[]).map((t) => (
              <button key={t} type="button" className={`${css.tab} ${tab === t ? css.tabActive : ''}`}
                onClick={() => setTab(t)}>
                {t === 'all' ? tt('tab.all') : t === 'done' ? tt('tab.done') : t === 'archived' ? tt('tab.archived') : tt('tab.active')}
              </button>
            ))}
          </div>

          {caseList.length > 0 && (
            <select className={css.searchInput} value={caseFilter} style={{ maxWidth: 170, height: 32, padding: '0 8px', flex: '0 0 auto' }}
              onChange={(e) => setCaseFilter(e.target.value)}>
              <option value="">{tt('filter.allCases')}</option>
              {caseList.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}

          <div className={css.searchBox}>
            <span className={css.searchIcon}>🔍</span>
            <input className={css.searchInput} placeholder={tt('filter.search')} value={search}
              onChange={(e) => setSearch(e.target.value)} />
            {search !== '' && (
              <button type="button" className={css.clearSearch} onClick={() => setSearch('')}>✕</button>
            )}
          </div>
        </div>

        {/* 列表 */}
        <div className={css.modalBody}>
          <div className={css.list}>
            {!loading && visible.length === 0 && (
              <div className={css.empty}>
                <div className={css.emptyIcon}>💡</div>
                {search !== '' || caseFilter !== '' ? tt('emptyNoMatch') : tt('empty')}
              </div>
            )}
            {visible.map((idea) => (
              <div key={idea.id} className={`${css.ideaRow} ${idea.status === 'done' ? css.ideaRowDone : ''}`}>
                <div className={css.ideaBody}>
                  <div className={idea.status === 'done' ? css.ideaTitleDone : css.ideaTitle}>{idea.title}</div>
                  {idea.content !== undefined && idea.content !== '' && (
                    <div className={css.ideaContent}>{idea.content}</div>
                  )}
                  <div className={css.ideaSub}>
                    {idea.caseId !== undefined && idea.caseId !== '' && (
                      <span className={css.caseTag}>{idea.caseName ?? idea.caseId}</span>
                    )}
                    {(idea.tags ?? []).map((tag) => (
                      <span key={tag} className={css.tagChip}>{tag}</span>
                    ))}
                    <span className={`${css.statusPill} ${
                      idea.status === 'done' ? css.toneSuccess : idea.status === 'archived' ? css.toneCool : css.toneNeutral
                    }`}>{statusLabel(idea.status)}</span>
                    <span className={css.timeText}>{(idea.updatedAt ?? idea.createdAt ?? '').slice(0, 10)}</span>
                  </div>
                </div>
                <div className={css.actions}>
                  <button type="button" className={css.iconBtn} title={tt('add.editing')}
                    onClick={() => setEditor({
                      id: idea.id,
                      title: idea.title,
                      content: idea.content ?? '',
                      caseId: idea.caseId ?? '',
                      tags: (idea.tags ?? []).join(', '),
                    })}>
                    ✎
                  </button>
                  {idea.status !== 'archived' && (
                    <button type="button" className={`${css.iconBtn} ${css.iconBtnDone}`} title={tt('actions.done')}
                      onClick={() => void toggleDone(idea)}>
                      {idea.status === 'done' ? '↩' : '✓'}
                    </button>
                  )}
                  <button type="button" className={css.iconBtn} title={tt('actions.archive')}
                    onClick={() => void toggleArchive(idea)}>
                    {idea.status === 'archived' ? '⇪' : '▣'}
                  </button>
                  <button type="button" className={css.iconBtn} title={tt('actions.reference')}
                    onClick={() => insertIdeaReference(idea.id)}>
                    #
                  </button>
                  <button type="button" className={css.iconBtn} title={tt('actions.copyRef')}
                    onClick={() => void doCopyRef(idea)}>
                    ⧉
                  </button>
                  <button type="button" className={`${css.iconBtn} ${css.iconBtnDanger}`} title={tt('actions.delete')}
                    onClick={() => void remove(idea)}>
                    🗑
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
