/**
 * MemoTaskTab.tsx — 备忘录面板里的「任务/日程」tab（#6）。
 *
 * 在备忘录入口提供一个与「进行中/已归档」同级的「任务/日程」tab，快速新增任务/日程。
 * 归属方式与任务模块的新建弹窗一致：一个下拉选择「独立」或具体案件/项目（#24），
 * 不再用「临时/诉讼/非诉」三类按钮；类型（任务/日程/日程+任务）同样下拉单选。
 * 新建字段与既有任务面板一致：标题 / 详情 / 优先级 / 截止日 / 子项。
 */
import React from 'react'

interface MemoTaskTabProps {
  /** 保存成功后的回调（父级可刷新 / toast）。 */
  onSaved?: (text: string) => void
}

interface CaseOption { id: string; name: string; type: string; caseId?: string }
interface ProjectOption { id: string; name: string; projectType: string; projectId?: string }

/** 归属下拉的编码值：空 = 独立；`case:<id>` = 诉讼案件；`proj:<id>` = 非诉项目。 */
type OwnerValue = '' | `case:${string}` | `proj:${string}`

/** 统一 POST 并解包 { success, data|error }。 */
async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  })
  const env = await res.json().catch(() => null) as { success: boolean; data?: T; error?: string } | null
  if (!res.ok || env === null || env.success === false) {
    throw new Error(env?.error ?? `request failed (${res.status})`)
  }
  return env.data as T
}

export function MemoTaskTab({ onSaved }: MemoTaskTabProps): React.ReactElement {
  const [owner, setOwner] = React.useState<OwnerValue>('')
  const [itemType, setItemType] = React.useState<'event' | 'task' | 'both'>('task')
  const [title, setTitle] = React.useState('')
  const [detail, setDetail] = React.useState('')
  const [deadline, setDeadline] = React.useState('')
  const [deadlineTime, setDeadlineTime] = React.useState('09:00')
  const [priority, setPriority] = React.useState<'low' | 'medium' | 'high'>('medium')
  const [cases, setCases] = React.useState<CaseOption[]>([])
  const [projects, setProjects] = React.useState<ProjectOption[]>([])
  const [subtasks, setSubtasks] = React.useState<string[]>([])
  const [subtaskInput, setSubtaskInput] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')

  // 加载案件 / 项目候选（供归属下拉使用）。
  React.useEffect(() => {
    let active = true
    void (async () => {
      try {
        const [caseReg, projReg] = await Promise.all([
          post<{ cases: Record<string, CaseOption & { archived?: boolean }> }>('/api/agentlex-case/read', {}),
          post<{ projects: Record<string, ProjectOption & { status?: string }> }>('/api/agentlex-nonlitigation/projects', {}),
        ])
        if (!active) return
        setCases(Object.values(caseReg.cases ?? {}).filter((c) => !c.archived).map((c) => ({ id: c.caseId ?? '', name: c.name, type: c.type })))
        setProjects(Object.values(projReg.projects ?? {}).filter((p) => p.status !== 'closed').map((p) => ({ id: p.projectId ?? '', name: p.name, projectType: p.projectType })))
      } catch {
        /* 候选加载失败不阻塞表单 */
      }
    })()
    return () => { active = false }
  }, [])

  const addSubtask = (): void => {
    const t = subtaskInput.trim()
    if (t === '') return
    setSubtasks((prev) => [...prev, t])
    setSubtaskInput('')
  }

  const removeSubtask = (index: number): void => {
    setSubtasks((prev) => prev.filter((_, i) => i !== index))
  }

  const canSave = title.trim() !== '' && !busy

  const save = async (): Promise<void> => {
    const t = title.trim()
    if (t === '') return
    setBusy(true)
    setError('')
    try {
      // deadline 只存纯日期（既有约定），具体时间单独存 time 字段（HH:mm）。
      const deadlineDate = /^\d{4}-\d{2}-\d{2}/.test(deadline) ? deadline.slice(0, 10) : deadline
      const hasTime = deadlineTime.trim() !== '' && deadline !== ''
      const baseDetail = detail.trim()
      // 统一事项模型：写 /api/agentlex-item/item，type 分流（event/task/both）。
      // 归属解码：case: → 诉讼案件；proj: → 非诉项目；空 → 独立。ownerType 必须
      // 显式传（缺省时聚合层把非空 ownerId 当 litigation，项目任务会错归诉讼）。
      const ownerId = owner.startsWith('case:') ? owner.slice(5) : owner.startsWith('proj:') ? owner.slice(5) : ''
      const ownerType = owner.startsWith('case:') ? 'litigation' : owner.startsWith('proj:') ? 'nonlitigation' : 'standalone'
      const ownerName = owner.startsWith('case:')
        ? cases.find((c) => c.id === ownerId)?.name
        : owner.startsWith('proj:')
          ? projects.find((p) => p.id === ownerId)?.name
          : undefined
      // 子项拼进 subtasks（统一事项原生支持）。
      const subItems = subtasks.map((s) => ({ id: `sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, title: s, done: false }))
      await post('/api/agentlex-item/item', {
        ownerId,
        ownerType,
        ownerName,
        type: itemType,
        title: t,
        date: deadlineDate === '' ? undefined : deadlineDate,
        time: hasTime ? deadlineTime.trim() : undefined,
        detail: baseDetail === '' ? undefined : baseDetail,
        priority,
        subtasks: subItems.length > 0 ? subItems : undefined,
      })
      // 重置表单。
      setTitle(''); setDetail(''); setDeadline(''); setDeadlineTime('09:00'); setPriority('medium')
      setSubtasks([]); setSubtaskInput(''); setItemType('task')
      onSaved?.('已新增任务/日程')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const ownerLabel = (v: OwnerValue): string => {
    if (v === '') return '独立任务/日程'
    if (v.startsWith('case:')) {
      const c = cases.find((x) => x.id === v.slice(5))
      return c ? `案件 #${c.id} ${c.name}` : '诉讼案件'
    }
    if (v.startsWith('proj:')) {
      const p = projects.find((x) => x.id === v.slice(5))
      return p ? `项目 #${p.id} ${p.name}` : '非诉项目'
    }
    return '独立任务/日程'
  }

  return (
    <div className="memo-task" data-agentlex-memo-root>
      {/* 归属（下拉单选：独立 / 案件 / 项目） + 事项类型 */}
      <div className="memo-task__row">
        <label className="memo-task__field memo-task__field--grow">
          <span className="memo-task__label">归属</span>
          <select className="memo-task__select" value={owner} onChange={(e) => setOwner(e.target.value as OwnerValue)}>
            <option value="">独立任务/日程</option>
            <optgroup label="诉讼案件">
              {cases.map((c) => <option key={c.id} value={`case:${c.id}`}>案件 #{c.id} {c.name}</option>)}
            </optgroup>
            <optgroup label="非诉项目">
              {projects.map((p) => <option key={p.id} value={`proj:${p.id}`}>项目 #{p.id} {p.name}</option>)}
            </optgroup>
          </select>
        </label>
        <label className="memo-task__field">
          <span className="memo-task__label">类型</span>
          <select className="memo-task__select" value={itemType} onChange={(e) => setItemType(e.target.value as 'event' | 'task' | 'both')}>
            <option value="task">任务</option>
            <option value="event">日程</option>
            <option value="both">日程+任务</option>
          </select>
        </label>
      </div>

      {/* 标题 */}
      <label className="memo-task__field">
        <span className="memo-task__label">任务/日程标题</span>
        <input
          className="memo-task__input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="要做什么…"
        />
      </label>

      {/* 截止日 + 优先级 */}
      <div className="memo-task__row">
        <label className="memo-task__field memo-task__field--grow">
          <span className="memo-task__label">截止日</span>
          <div className="memo-task__datetime">
            <input className="memo-task__input" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            <input className="memo-task__input memo-task__time" type="time" value={deadlineTime} onChange={(e) => setDeadlineTime(e.target.value)} />
          </div>
        </label>
        <label className="memo-task__field">
          <span className="memo-task__label">优先级</span>
          <select className="memo-task__select" value={priority} onChange={(e) => setPriority(e.target.value as 'low' | 'medium' | 'high')}>
            <option value="low">低</option>
            <option value="medium">中</option>
            <option value="high">高</option>
          </select>
        </label>
      </div>

      {/* 详情 */}
      <label className="memo-task__field">
        <span className="memo-task__label">详情</span>
        <textarea
          className="memo-task__textarea"
          rows={2}
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          placeholder="补充说明（可写：法庭 / 地点 / 要求等）"
        />
      </label>

      {/* 子项 */}
      <div className="memo-task__field">
        <span className="memo-task__label">子项</span>
        <div className="memo-task__subadd">
          <input
            className="memo-task__input"
            value={subtaskInput}
            onChange={(e) => setSubtaskInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSubtask() } }}
            placeholder="输入子项后回车添加"
          />
          <button type="button" className="memo-task__add" onClick={addSubtask}>＋</button>
        </div>
        {subtasks.length > 0 && (
          <ul className="memo-task__subs">
            {subtasks.map((s, i) => (
              <li key={i} className="memo-task__sub">
                <span>{s}</span>
                <button type="button" className="memo-task__sub-del" onClick={() => removeSubtask(i)}>✕</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error !== '' && <p className="memo-task__error">{error}</p>}

      <div className="memo-task__actions">
        <button
          type="button"
          className="memo-btn memo-btn--primary"
          onClick={() => void save()}
          disabled={!canSave}
        >
          {busy ? '保存中…' : '新增任务/日程'}
        </button>
      </div>
    </div>
  )
}
