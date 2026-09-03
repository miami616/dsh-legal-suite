/**
 * MemoTaskTab.tsx — 备忘录面板里的「任务」tab（#6）。
 *
 * 在备忘录入口提供一个与「进行中/已归档」同级的「任务」tab，快速新增任务。
 * 任务分三类，与三个模块匹配：
 *   - 临时（standalone）：独立任务，存 task store。
 *   - 诉讼（litigation）：关联案件，写穿到案件 taskGroups。
 *   - 非诉（nonlitigation）：关联项目，写穿到项目 taskGroups。
 * 新建任务字段与既有任务面板一致：标题 / 详情 / 优先级 / 截止日 / 子项。
 */
import React from 'react'

interface MemoTaskTabProps {
  /** 保存成功后的回调（父级可刷新 / toast）。 */
  onSaved?: (text: string) => void
}

type TaskSource = 'standalone' | 'litigation' | 'nonlitigation'

interface CaseOption { id: string; name: string; type: string }
interface ProjectOption { id: string; name: string; projectType: string }

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

const SOURCE_LABEL: Record<TaskSource, string> = {
  standalone: '临时任务',
  litigation: '诉讼任务',
  nonlitigation: '非诉任务',
}

export function MemoTaskTab({ onSaved }: MemoTaskTabProps): React.ReactElement {
  const [source, setSource] = React.useState<TaskSource>('standalone')
  const [title, setTitle] = React.useState('')
  const [detail, setDetail] = React.useState('')
  const [deadline, setDeadline] = React.useState('')
  const [deadlineTime, setDeadlineTime] = React.useState('09:00')
  const [priority, setPriority] = React.useState<'low' | 'medium' | 'high'>('medium')
  const [cases, setCases] = React.useState<CaseOption[]>([])
  const [projects, setProjects] = React.useState<ProjectOption[]>([])
  const [caseId, setCaseId] = React.useState('')
  const [projectId, setProjectId] = React.useState('')
  const [subtasks, setSubtasks] = React.useState<string[]>([])
  const [subtaskInput, setSubtaskInput] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')

  // 加载案件 / 项目候选（供关联选择）。
  React.useEffect(() => {
    let active = true
    void (async () => {
      try {
        const [caseReg, projReg] = await Promise.all([
          post<{ cases: Record<string, CaseOption & { archived?: boolean }> }>('/api/agentlex-case/read', {}),
          post<{ projects: Record<string, ProjectOption & { status?: string }> }>('/api/agentlex-nonlitigation/projects', {}),
        ])
        if (!active) return
        setCases(Object.values(caseReg.cases ?? {}).filter((c) => !c.archived).map((c) => ({ id: c.caseId, name: c.name, type: c.type })))
        setProjects(Object.values(projReg.projects ?? {}).filter((p) => p.status !== 'closed').map((p) => ({ id: p.projectId, name: p.name, projectType: p.projectType })))
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

  const canSave = title.trim() !== '' && !busy && (source === 'standalone' || (source === 'litigation' ? caseId !== '' : projectId !== ''))

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
      const base: Record<string, unknown> = {
        title: t,
        detail: baseDetail === '' ? undefined : baseDetail,
        deadline: deadlineDate === '' ? undefined : deadlineDate,
        time: hasTime ? deadlineTime.trim() : undefined,
        priority,
      }
      if (source === 'standalone') {
        // 独立任务：子项拼进 detail（task store 无原生子项）。
        const subText = subtasks.length > 0 ? `\n子项：\n${subtasks.map((s) => `- ${s}`).join('\n')}` : ''
        await post('/api/agentlex-task/task', { ...base, detail: `${base.detail ?? ''}${subText}`.trim() || undefined })
      } else if (source === 'litigation') {
        const groupId = await ensureLitigationGroup(caseId)
        const created = await post<{ id: string }>('/api/agentlex-task/task', {
          ...base, source: 'litigation', sourceId: caseId, groupId,
        })
        const taskId = created?.id
        if (taskId) {
          for (const st of subtasks) {
            await post('/api/agentlex-case/subtask', { caseId, groupId, taskId, title: st })
          }
        }
      } else {
        const groupId = await ensureProjectGroup(projectId)
        const created = await post<{ id: string }>('/api/agentlex-task/task', {
          ...base, source: 'nonlitigation', sourceId: projectId, groupId,
        })
        const taskId = created?.id
        if (taskId) {
          for (const st of subtasks) {
            await post('/api/agentlex-nonlitigation/subtask', { projectId, groupId, taskId, title: st })
          }
        }
      }
      // 重置表单。
      setTitle(''); setDetail(''); setDeadline(''); setDeadlineTime('09:00'); setPriority('medium')
      setSubtasks([]); setSubtaskInput('')
      onSaved?.(`已新增${SOURCE_LABEL[source]}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  /** 取案件第一个任务组；无则建一个「待办」组。 */
  const ensureLitigationGroup = async (cid: string): Promise<string> => {
    const rec = await post<{ taskGroups?: Array<{ id: string; name: string }> }>('/api/agentlex-case/read-case', { caseId: cid })
    const groups = rec?.taskGroups ?? []
    if (groups.length > 0) return groups[0].id
    const created = await post<{ taskGroups?: Array<{ id: string; name: string }> }>('/api/agentlex-case/group', { caseId: cid, name: '待办' })
    return created?.taskGroups?.[created.taskGroups.length - 1]?.id ?? ''
  }

  /** 取项目第一个任务组；无则建一个「待办」组。 */
  const ensureProjectGroup = async (pid: string): Promise<string> => {
    const rec = await post<{ taskGroups?: Array<{ id: string; name: string }> }>('/api/agentlex-nonlitigation/project', { projectId: pid })
    const groups = rec?.taskGroups ?? []
    if (groups.length > 0) return groups[0].id
    const created = await post<{ taskGroups?: Array<{ id: string; name: string }> }>('/api/agentlex-nonlitigation/group', { projectId: pid, name: '待办' })
    return created?.taskGroups?.[created.taskGroups.length - 1]?.id ?? ''
  }

  return (
    <div className="memo-task" data-agentlex-memo-root>
      {/* 来源类型 */}
      <div className="memo-task__source">
        {(['standalone', 'litigation', 'nonlitigation'] as TaskSource[]).map((s) => (
          <button
            key={s}
            type="button"
            className={`memo-task__source-btn${source === s ? ' memo-task__source-btn--on' : ''}`}
            onClick={() => setSource(s)}
          >
            {SOURCE_LABEL[s]}
          </button>
        ))}
      </div>

      {/* 关联案件 / 项目 */}
      {source === 'litigation' && (
        <label className="memo-task__field">
          <span className="memo-task__label">关联案件</span>
          <select className="memo-task__select" value={caseId} onChange={(e) => setCaseId(e.target.value)}>
            <option value="">选择案件…</option>
            {cases.map((c) => <option key={c.id} value={c.id}>#{c.id} {c.name}</option>)}
          </select>
        </label>
      )}
      {source === 'nonlitigation' && (
        <label className="memo-task__field">
          <span className="memo-task__label">关联项目</span>
          <select className="memo-task__select" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">选择项目…</option>
            {projects.map((p) => <option key={p.id} value={p.id}>#{p.id} {p.name}</option>)}
          </select>
        </label>
      )}

      {/* 标题 */}
      <label className="memo-task__field">
        <span className="memo-task__label">任务标题</span>
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
          {busy ? '保存中…' : '新增任务'}
        </button>
      </div>
    </div>
  )
}
