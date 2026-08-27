/**
 * Project detail — masthead + tabbed body (概览 / 任务组 / 关键日期 / 关联).
 */
import { useState } from 'react'
import type { ProjectRecord } from '../../store/types.ts'
import { countTasks, daysUntil, timeAgo, todayStr } from '../format.ts'
import { getProjectTypeDot, getStatusDef, projectTypeLabel } from '../project-taxonomy.ts'
import { tt } from '../i18n.ts'
import * as api from '../api.ts'
import { pickDirectoryPath } from '../../../../shared/folder-picker.ts'
import css from './detail.module.css'

type Tab = 'overview' | 'tasks' | 'dates' | 'related'

interface ProjectDetailProps {
  record: ProjectRecord
  onChange: () => void
}

export function ProjectDetail({ record, onChange }: ProjectDetailProps): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('overview')
  const [folderBusy, setFolderBusy] = useState(false)

  /** 绑定/更换项目文件夹：弹系统目录选择框；取消则不动。 */
  const pickFolder = async (): Promise<void> => {
    const picked = await pickDirectoryPath()
    if (picked === null || picked === '' || picked === record.folder || folderBusy) return
    setFolderBusy(true)
    try {
      await api.updateProject(record.projectId, { folder: picked })
      onChange()
    } finally {
      setFolderBusy(false)
    }
  }

  const status = getStatusDef(record.status)
  const typeDot = getProjectTypeDot(record.projectType)
  const typeLabel = projectTypeLabel(record.projectType)
  const { total, done } = countTasks(record)
  const periodEnd = record.servicePeriod?.end
  const periodDays = periodEnd ? daysUntil(periodEnd) : null

  return (
    <div className={css.page}>
      <div className={css.pageInner}>
        {/* masthead */}
        <div className={css.masthead}>
          <div className={css.mastheadTop}>
            <span className={css.typeTag} style={{ background: `color-mix(in srgb, ${typeDot} 13%, transparent)`, color: `color-mix(in srgb, ${typeDot} 62%, var(--lit-ink))` }}>
              <span className={css.typeDot} style={{ background: typeDot }} aria-hidden />
              {typeLabel}
            </span>
            <span className={`${css.statusPill} ${css[`tone-${status.tone}`]}`}>{status.label}</span>
            <span className={css.mastheadTime}>{tt('detail.updated')} {timeAgo(record.updatedAt)}</span>
          </div>
          <div className={css.mastheadTitleRow}>
            <span className={css.mastheadId}>{record.projectId}</span>
            <h1 className={css.mastheadName}>{record.name}</h1>
          </div>
          <div className={css.mastheadMeta}>
            {record.leadLawyer && <><span>{tt('detail.lead')}{record.leadLawyer}</span><span className={css.metaDivider}>·</span></>}
            {record.servicePeriod?.start && record.servicePeriod.end && (
              <>
                <span className={css.metaMono}>{record.servicePeriod.start} ~ {record.servicePeriod.end}</span>
                {periodDays !== null && (
                  <span className={periodDays <= 30 ? `${css.statusPill} ${css['tone-warning']}` : `${css.statusPill} ${css['tone-neutral']}`}>
                    {periodDays < 0 ? tt('detail.expired') : tt('detail.daysLeft', { n: String(periodDays) })}
                  </span>
                )}
                <span className={css.metaDivider}>·</span>
              </>
            )}
            {total > 0 && <span className={`${css.statusPill} ${css['tone-accent']}`}>{tt('detail.taskProgress', { done: String(done), total: String(total) })}</span>}
          </div>
        </div>

        {/* tab bar */}
        <div className={css.tabBar}>
          <button type="button" className={tab === 'overview' ? `${css.tab} ${css.tabActive}` : css.tab} onClick={() => setTab('overview')}>{tt('detail.tabOverview')}</button>
          <button type="button" className={tab === 'tasks' ? `${css.tab} ${css.tabActive}` : css.tab} onClick={() => setTab('tasks')}>{tt('detail.tabTasks')}</button>
          <button type="button" className={tab === 'dates' ? `${css.tab} ${css.tabActive}` : css.tab} onClick={() => setTab('dates')}>{tt('detail.tabDates')}</button>
          <button type="button" className={tab === 'related' ? `${css.tab} ${css.tabActive}` : css.tab} onClick={() => setTab('related')}>{tt('detail.tabRelated')}</button>
        </div>

        {tab === 'overview' && <OverviewTab record={record} pickFolder={pickFolder} folderBusy={folderBusy} />}
        {tab === 'tasks' && <TasksTab record={record} />}
        {tab === 'dates' && <DatesTab record={record} />}
        {tab === 'related' && <RelatedTab record={record} />}
      </div>
    </div>
  )
}

function OverviewTab({ record, pickFolder, folderBusy }: { record: ProjectRecord; pickFolder: () => Promise<void>; folderBusy: boolean }): React.JSX.Element {
  return (
    <div className={css.columns}>
      <div className={css.leftCol}>
        <section className={css.section}>
          <h3 className={css.sectionTitle}>{tt('detail.basic')}</h3>
          <div className={css.infoGrid}>
            <div className={css.infoItem}><span className={css.infoLabel}>{tt('detail.id')}</span><p className={css.infoValue}>{record.projectId}</p></div>
            <div className={css.infoItem}><span className={css.infoLabel}>{tt('detail.type')}</span><p className={css.infoValue}>{projectTypeLabel(record.projectType)}</p></div>
            <div className={css.infoItem}><span className={css.infoLabel}>{tt('detail.status')}</span><p className={css.infoValue}>{getStatusDef(record.status).label}</p></div>
            <div className={css.infoItem}><span className={css.infoLabel}>{tt('detail.lead')}</span><p className={css.infoValue}>{record.leadLawyer || '—'}</p></div>
            <div className={css.infoItem}><span className={css.infoLabel}>{tt('detail.period')}</span><p className={css.infoValue}>{record.servicePeriod?.start && record.servicePeriod.end ? `${record.servicePeriod.start} ~ ${record.servicePeriod.end}` : '—'}</p></div>
            <div className={css.infoItem}><span className={css.infoLabel}>{tt('detail.folder')}</span><p className={css.infoValue}>{record.folder || '—'}</p>
              <button type="button" onClick={() => { void pickFolder() }} disabled={folderBusy} style={{ marginLeft: 'auto', flex: 'none', border: 0, background: 'transparent', color: 'var(--lit-accent)', font: 'inherit', fontSize: 12, cursor: 'pointer' }}>
                {record.folder ? tt('detail.folderChange') : tt('detail.folderBind')}
              </button>
            </div>
          </div>
        </section>

        {(record.serviceScope ?? []).length > 0 && (
          <section className={css.section}>
            <h3 className={css.sectionTitle}>{tt('detail.scope')}</h3>
            <div className={css.scopeList}>
              {(record.serviceScope ?? []).map((s, i) => <span key={i} className={css.scopeChip}>{s}</span>)}
            </div>
          </section>
        )}
      </div>

      <div className={css.rightCol}>
        <section className={css.section}>
          <h3 className={css.sectionTitle}>{tt('detail.summary')}</h3>
          {record.summary ? <p className={css.summaryText}>{record.summary}</p> : <p className={css.summaryEmpty}>{tt('detail.noSummary')}</p>}
        </section>
      </div>
    </div>
  )
}

function TasksTab({ record }: { record: ProjectRecord }): React.JSX.Element {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const groups = [...(record.taskGroups ?? [])].sort((a, b) => a.order - b.order)

  const toggle = (id: string): void => setOpen((o) => ({ ...o, [id]: !o[id] }))

  if (groups.length === 0) return <p className={css.empty}>{tt('detail.noTasks')}</p>

  return (
    <div className={css.taskTree}>
      {groups.map((g) => {
        const doneCount = g.tasks.filter((t) => t.status === 'done').length
        const pct = g.tasks.length === 0 ? 0 : Math.round((doneCount / g.tasks.length) * 100)
        const isOpen = open[g.id] ?? true
        return (
          <div key={g.id} className={css.groupCard}>
            <div className={css.groupHead} onClick={() => toggle(g.id)}>
              <span className={`${css.groupChevron} ${isOpen ? css.groupChevronOpen : ''}`}>▸</span>
              <span className={css.groupName}>{g.name || tt('detail.untitledGroup')}</span>
              <span className={css.groupProgress}>{doneCount}/{g.tasks.length}</span>
            </div>
            <div className={css.groupProgressBar}><div className={css.groupProgressFill} style={{ width: `${pct}%` }} /></div>
            {isOpen && (
              <div className={css.groupBody}>
                {g.tasks.map((t) => (
                  <TaskRow key={t.id} task={t} />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

interface TaskRowShape {
  title: string
  status?: string
  deadline?: string
  priority?: string
  subtasks?: Array<{ id: string; title: string; done: boolean }>
}

function TaskRow({ task }: { task: TaskRowShape }): React.JSX.Element {
  const done = task.status === 'done'
  return (
    <>
      <div className={css.taskItem}>
        <span className={css.taskCheck}>{done ? <span className={css.checkIcon}>✓</span> : <span className={css.circleIcon}>○</span>}</span>
        <span className={done ? `${css.taskTitle} ${css.taskTitleDone}` : css.taskTitle}>{task.title}</span>
        <div className={css.taskMeta}>
          {task.priority && <span className={css[`priority${cap(task.priority)}`]}>{task.priority}</span>}
          {task.deadline && <span className={css.metaMono}>{task.deadline}</span>}
        </div>
      </div>
      {(task.subtasks ?? []).length > 0 && (
        <div className={css.subtaskList}>
          {(task.subtasks ?? []).map((s) => (
            <div key={s.id} className={s.done ? `${css.subtaskRow} ${css.subtaskRowDone}` : css.subtaskRow}>
              <span>{s.done ? <span className={css.checkIcon}>✓</span> : <span className={css.circleIcon}>○</span>}</span>
              <span>{s.title}</span>
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function DatesTab({ record }: { record: ProjectRecord }): React.JSX.Element {
  const dates = [...(record.keyDates ?? [])].sort((a, b) => a.date.localeCompare(b.date))
  const today = todayStr()
  if (dates.length === 0) return <p className={css.empty}>{tt('detail.noDates')}</p>
  return (
    <section className={css.section}>
      <h3 className={css.sectionTitle}>{tt('detail.tabDates')}</h3>
      <div className={css.scheduleList}>
        {dates.map((d) => {
          const days = daysUntil(d.date)
          const urgent = !d.done && days <= 30
          return (
            <div key={d.id} className={urgent ? `${css.scheduleItem} ${css.scheduleItemUrgent}` : css.scheduleItem}>
              <span className={css.scheduleDate}>{d.date}</span>
              <span className={d.done ? `${css.scheduleLabel} ${css.scheduleDone}` : css.scheduleLabel}>{d.label}</span>
              <span className={d.done ? css.scheduleCountdown : urgent ? `${css.scheduleCountdown} ${css.scheduleCountdownUrgent}` : css.scheduleCountdown}>
                {d.done ? tt('detail.done') : d.date < today ? tt('detail.overdue') : days === 0 ? tt('detail.today') : tt('detail.days', { n: String(days) })}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function RelatedTab({ record }: { record: ProjectRecord }): React.JSX.Element {
  const contracts = record.linkedContracts ?? []
  const research = record.linkedResearch ?? []
  if (contracts.length === 0 && research.length === 0) return <p className={css.sectionMuted}>{tt('detail.noRelated')}</p>
  return (
    <div className={css.columns}>
      {contracts.length > 0 && (
        <section className={css.section}>
          <h3 className={css.sectionTitle}>{tt('detail.contracts')}</h3>
          <div className={css.linkList}>
            {contracts.map((c, i) => (
              <div key={i} className={css.linkRow}>
                <span className={css.linkIcon}>📄</span>
                <span className={css.linkName}>{c}</span>
                <span className={css.linkType}>{tt('detail.contract')}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      {research.length > 0 && (
        <section className={css.section}>
          <h3 className={css.sectionTitle}>{tt('detail.research')}</h3>
          <div className={css.linkList}>
            {research.map((r, i) => (
              <div key={i} className={css.linkRow}>
                <span className={css.linkIcon}>📚</span>
                <span className={css.linkName}>{r}</span>
                <span className={css.linkType}>{tt('detail.researchItem')}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
