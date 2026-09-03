/**
 * MemoPanel.tsx — 备忘录主面板（创建 / 编辑 / 标签筛选 / 归档 / 删除 / 引用）。
 *
 * 设计：扁平现代、单列排序列表（非分组卡片）；所有写操作给出自动消失的 toast
 * 反馈；新建/编辑支持 Cmd/Ctrl+Enter 保存（标签栏回车即存）；关闭/外部点击退出时
 * 自动保存未提交的草稿。
 */
import React from 'react'
import { memoApi, subscribeMemos } from './memo-api.ts'
import { appendReferenceToComposer } from './memo-input-bridge.ts'
import { MemoTaskTab } from './MemoTaskTab.tsx'
import type { MemoItem } from '../store/types.ts'

interface MemoPanelProps {
  /** 请求关闭面板（由调用方卸载）。关闭前会尽力自动保存草稿。 */
  onClose(): void
  /** 初始 tab。 */
  initialTab?: 'active' | 'archived'
  /** 供父级在点击遮罩时调用「带自动保存的关闭」。 */
  requestCloseRef?: React.MutableRefObject<(() => void) | null>
}

type Tab = 'active' | 'archived'
/** 面板顶部大 tab：备忘录 / 任务（任务与备忘录同级并列，#6）。 */
type SectionTab = 'memo' | 'task'

/** toast 反馈。 */
interface Toast {
  text: string
  kind: 'ok' | 'warn' | 'info'
}

const TOAST_MS = 2600

export function MemoPanel({ onClose, initialTab = 'active', requestCloseRef }: MemoPanelProps): React.ReactElement {
  const [sectionTab, setSectionTab] = React.useState<SectionTab>('memo')
  const [tab, setTab] = React.useState<Tab>(initialTab)
  const [memos, setMemos] = React.useState<MemoItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [activeTag, setActiveTag] = React.useState<string | null>(null)
  const [query, setQuery] = React.useState('')
  const [draft, setDraft] = React.useState('')
  const [draftTags, setDraftTags] = React.useState('')
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [toast, setToast] = React.useState<Toast | null>(null)
  const searchRef = React.useRef<HTMLInputElement>(null)
  const draftRef = React.useRef<HTMLTextAreaElement>(null)

  // ---- toast 自动消失 ----
  const toastTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = React.useCallback((text: string, kind: Toast['kind'] = 'info'): void => {
    if (toastTimer.current !== null) clearTimeout(toastTimer.current)
    setToast({ text, kind })
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS)
  }, [])

  const load = React.useCallback(async (): Promise<void> => {
    try {
      setMemos(await memoApi.list())
    } catch (error) {
      showToast(`加载失败：${error instanceof Error ? error.message : String(error)}`, 'warn')
    } finally {
      setLoading(false)
    }
  }, [showToast])

  React.useEffect(() => {
    void load()
    const dispose = subscribeMemos(() => { void load() })
    return dispose
  }, [load])

  React.useEffect(() => {
    const onEsc = (e: KeyboardEvent): void => { if (e.key === 'Escape') void requestClose() }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, draftTags, editingId, onClose])

  React.useEffect(() => () => {
    if (toastTimer.current !== null) clearTimeout(toastTimer.current)
  }, [])

  // ---- 关闭时自动保存未提交草稿 ----
  const draftReadyRef = React.useRef(false)
  React.useEffect(() => { draftReadyRef.current = true }, [])
  const requestClose = async (): Promise<void> => {
    const content = draft.trim()
    if (content === '') { onClose(); return }
    try {
      const tags = draftTags.split(/[，#\s,]+/).map((t) => t.trim()).filter(Boolean)
      if (editingId !== null) await memoApi.upsert({ id: editingId, content, tags })
      else await memoApi.upsert({ content, tags })
    } catch {
      // 关闭时自动保存失败不阻塞关闭；不弹提示避免打断。
    }
    onClose()
  }

  // 把「带自动保存的关闭」注册给父级（遮罩点击用），每次渲染更新以捕获最新草稿。
  React.useEffect(() => {
    if (requestCloseRef) requestCloseRef.current = () => { void requestClose() }
    return () => { if (requestCloseRef) requestCloseRef.current = null }
  }, [requestCloseRef, draft, draftTags, editingId, onClose])

  const allTags = React.useMemo(() => {
    const map = new Map<string, number>()
    for (const m of memos) if (m.status === tab) for (const t of m.tags) map.set(t, (map.get(t) ?? 0) + 1)
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [memos, tab])

  const visible = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return memos
      .filter((m) => m.status === tab)
      .filter((m) => (activeTag === null ? true : m.tags.includes(activeTag)))
      .filter((m) => (q === '' ? true : m.content.toLowerCase().includes(q) || m.ref.includes(q) || m.tags.some((t) => t.includes(q))))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }, [memos, tab, activeTag, query])

  const save = async (): Promise<void> => {
    const content = draft.trim()
    if (content === '') return
    setBusy(true)
    try {
      const tags = draftTags.split(/[，#\s,]+/).map((t) => t.trim()).filter(Boolean)
      if (editingId !== null) {
        await memoApi.upsert({ id: editingId, content, tags })
      } else {
        await memoApi.upsert({ content, tags })
      }
      setDraft('')
      setDraftTags('')
      setEditingId(null)
      showToast('已保存 ✓', 'ok')
      setLoading(true)
      await load()
      // 回到顶部聚焦新建框。
      draftRef.current?.focus()
    } catch (error) {
      showToast(`保存失败：${error instanceof Error ? error.message : String(error)}`, 'warn')
    } finally {
      setBusy(false)
    }
  }

  const saveOnEnter = (e: React.KeyboardEvent): void => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void save() }
  }
  // 标签栏：回车直接保存。
  const saveOnTagEnter = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void save() }
  }

  const startEdit = (m: MemoItem): void => {
    setEditingId(m.id)
    setDraft(m.content)
    setDraftTags(m.tags.join(', '))
    setTab('active')
  }

  const cancelEdit = (): void => {
    setEditingId(null)
    setDraft('')
    setDraftTags('')
  }

  const runAction = async (fn: () => Promise<unknown>, okText: string): Promise<void> => {
    setBusy(true)
    try {
      await fn()
      showToast(okText, 'ok')
      await load()
    } catch (error) {
      showToast(`操作失败：${error instanceof Error ? error.message : String(error)}`, 'warn')
    } finally {
      setBusy(false)
    }
  }

  const archiveMemo = (m: MemoItem): void => {
    void runAction(() => memoApi.archive(m.id, true), `已归档「${m.content.slice(0, 18)}…」`)
  }
  const restoreMemo = (m: MemoItem): void => {
    void runAction(() => memoApi.archive(m.id, false), '已恢复')
  }
  const deleteMemo = (m: MemoItem): void => {
    if (!window.confirm(`删除这条备忘？\n「${m.content.slice(0, 40)}${m.content.length > 40 ? '…' : ''}」`)) return
    void runAction(() => memoApi.remove(m.id), '已删除')
  }
  const insertRef = (m: MemoItem): void => {
    try {
      appendReferenceToComposer(m.ref)
      showToast(`已引用 #${m.ref} 到输入框`, 'ok')
    } catch {
      showToast('请先打开对话面板再引用', 'warn')
    }
  }

  const isNew = editingId === null
  const saveDisabled = busy || draft.trim() === ''

  return (
    <div className="memo-panel" data-agentlex-memo-root role="dialog" aria-modal="true" aria-label="备忘录 / 任务">
      {/* 顶部：备忘录 / 任务 两个并列大 tab + 关闭 */}
      <div className="memo-panel__header">
        <div className="memo-section-tabs">
          <button
            type="button"
            className={`memo-section-tab${sectionTab === 'memo' ? ' memo-section-tab--on' : ''}`}
            onClick={() => setSectionTab('memo')}
          >
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
            备忘录
          </button>
          <button
            type="button"
            className={`memo-section-tab${sectionTab === 'task' ? ' memo-section-tab--on' : ''}`}
            onClick={() => setSectionTab('task')}
          >
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
            任务
          </button>
        </div>
        <button type="button" className="memo-icon-btn" aria-label="关闭" title="关闭（Esc）" onClick={() => void requestClose()}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>

      {/* 任务 tab（与备忘录同级并列，#6） */}
      {sectionTab === 'task' && (
        <MemoTaskTab onSaved={(text) => showToast(text, 'ok')} />
      )}

      {/* 备忘录正文（仅当 sectionTab === 'memo'） */}
      {sectionTab === 'memo' && (
      <>
      {/* 搜索栏 */}
      <div className="memo-panel__header">
        <div className="memo-panel__title">
          <span>备忘录</span>
          <span className="memo-panel__count">{memos.filter((m) => m.status === 'active').length}</span>
        </div>
        <input
          ref={searchRef}
          className="memo-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索备忘…（⌘K）"
        />
      </div>

      {/* 新建/编辑框 */}
      <div className={`memo-draft${isNew ? '' : ' memo-draft--edit'}`}>
        <textarea
          ref={draftRef}
          className="memo-draft__input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={saveOnEnter}
          placeholder={isNew ? '记录点什么…（Enter 换行，⌘/Ctrl+Enter 保存）' : '编辑备忘内容…（⌘/Ctrl+Enter 保存）'}
          rows={3}
          autoFocus
        />
        <div className="memo-draft__tags">
          <input
            className="memo-draft__tags-input"
            value={draftTags}
            onChange={(e) => setDraftTags(e.target.value)}
            onKeyDown={saveOnTagEnter}
            placeholder="标签（逗号分隔，如：客户, 开庭）· 回车保存"
          />
          <div className="memo-draft__actions">
            {!isNew && (
              <button type="button" className="memo-btn memo-btn--muted" onClick={cancelEdit}>取消</button>
            )}
            <button
              type="button"
              className={`memo-btn memo-btn--primary${busy ? ' memo-btn--busy' : ''}`}
              onClick={() => void save()}
              disabled={saveDisabled}
            >
              {isNew ? '保存' : '保存修改'}
            </button>
          </div>
        </div>
      </div>

      {/* 标签筛选 */}
      <div className="memo-tags-bar">
        <span className="memo-tags-bar__label">标签</span>
        <button
          type="button"
          className={`memo-tag memo-tag--filter${activeTag === null ? ' memo-tag--on' : ''}`}
          onClick={() => setActiveTag(null)}
        >全部</button>
        {allTags.map(([tag, n]) => (
          <button
            key={tag}
            type="button"
            className={`memo-tag memo-tag--filter${activeTag === tag ? ' memo-tag--on' : ''}`}
            onClick={() => setActiveTag(activeTag === tag ? null : tag)}
          >{tag} <span className="memo-tag__n">{n}</span></button>
        ))}
        {allTags.length === 0 && <span className="memo-tags-bar__empty">暂无标签</span>}
      </div>

      {/* tab 切换 */}
      <div className="memo-tabs">
        <button type="button" className={`memo-tab${tab === 'active' ? ' memo-tab--on' : ''}`} onClick={() => setTab('active')}>
          进行中
          <span className="memo-tab__n">{memos.filter((m) => m.status === 'active').length}</span>
        </button>
        <button type="button" className={`memo-tab${tab === 'archived' ? ' memo-tab--on' : ''}`} onClick={() => setTab('archived')}>
          已归档
          <span className="memo-tab__n">{memos.filter((m) => m.status === 'archived').length}</span>
        </button>
      </div>

      {/* 列表（单列扁平） */}
      <div className="memo-list">
        {loading && <div className="memo-empty">加载中…</div>}
        {!loading && visible.length === 0 && (
          <div className="memo-empty">
            {tab === 'active'
              ? (activeTag !== null ? '该标签下没有备忘' : '还没有备忘，先记一条吧 ✍️')
              : '没有已归档的备忘'}
          </div>
        )}
        {visible.map((m) => {
          const date = new Date(m.updatedAt)
          const dateStr = date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
          const archived = m.status === 'archived'
          return (
            <div key={m.id} className={`memo-item${archived ? ' memo-item--archived' : ''}`}>
              <div className="memo-item__main">
                <div className="memo-item__content">{m.content}</div>
                <div className="memo-item__meta">
                  <span className="memo-item__ref">#{m.ref}</span>
                  {m.tags.map((t) => <span key={t} className="memo-item__tag">{t}</span>)}
                  <span className="memo-item__date">{dateStr}</span>
                </div>
              </div>
              <div className="memo-item__actions">
                <button type="button" className="memo-act" title="引用到输入框" onClick={() => insertRef(m)}>
                  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 3 6 6" /><path d="M10 14 21 3" /><path d="M18 13l-5.5 5.5a3.54 3.54 0 0 1-5 0L5 16l-1 4 4-1-2.5-2.5a3.54 3.54 0 0 1 0-5L11 6" /></svg>
                </button>
                {archived ? (
                  <>
                    <button type="button" className="memo-act" title="恢复" onClick={() => restoreMemo(m)}>
                      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>
                    </button>
                    <button type="button" className="memo-act memo-act--danger" title="彻底删除" onClick={() => deleteMemo(m)}>
                      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" className="memo-act" title="编辑" onClick={() => startEdit(m)}>
                      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /></svg>
                    </button>
                    <button type="button" className="memo-act" title="归档" onClick={() => archiveMemo(m)}>
                      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="4" rx="1.5" /><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" /><path d="M9 12h6" /></svg>
                    </button>
                    <button type="button" className="memo-act memo-act--danger" title="删除" onClick={() => deleteMemo(m)}>
                      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /></svg>
                    </button>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* 底部提示 */}
      <div className="memo-footer">
        <span>Enter 换行 · ⌘/Ctrl+Enter 保存 · Esc 关闭（草稿自动保存）</span>
      </div>
      </>
      )}

      {/* toast 反馈 */}
      {toast !== null && (
        <div className={`memo-toast memo-toast--${toast.kind}`} role="status">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {toast.kind === 'ok'
              ? <path d="M20 6 9 17l-5-5" />
              : toast.kind === 'warn'
                ? <path d="M12 8v4M12 16h.01" />
                : <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Z" />}
          </svg>
          <span>{toast.text}</span>
        </div>
      )}
    </div>
  )
}
