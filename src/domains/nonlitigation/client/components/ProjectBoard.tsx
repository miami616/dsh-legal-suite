/**
 * Project board — AgentLex-style overview: stats bar (big tabular numbers),
 * single-row dropdown filter toolbar (type / status / sort), search, and the
 * Direction-B project card grid.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectRecord } from '../../store/types.ts'
import { daysUntil, timeAgo, todayStr } from '../format.ts'
import { getProjectTypeDot, normalizeStatusKey, PROJECT_STATUSES, PROJECT_TYPES, projectTypeLabel } from '../project-taxonomy.ts'
import { tt } from '../i18n.ts'
import type { ProjectHealthView } from '../api.ts'
import { ProjectCard } from './ProjectCard.tsx'
import css from '../board.module.css'

type SortKey = 'recent' | 'nextDate' | 'projectId' | 'progress'
type MenuDim = 'type' | 'status' | 'sort' | null

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'recent', label: tt('board.sortRecent') },
  { value: 'nextDate', label: tt('board.sortNext') },
  { value: 'projectId', label: tt('board.sortId') },
  { value: 'progress', label: tt('board.sortProgress') },
]

interface ProjectBoardProps {
  projects: ProjectRecord[]
  /** 项目体检（projectId → 完整度/缺口/台账），旁路数据，可能为空表。 */
  healthByProject?: Map<string, ProjectHealthView>
  searchQuery: string
  onSearch: (q: string) => void
  onOpenProject: (projectId: string) => void
  onNewProject: () => void
  onDeleteProject: (projectId: string) => void
  onImport: () => void
}

/** next upcoming key date per project, soonest-first. */
function nextDate(record: ProjectRecord): string {
  const list = (record.keyDates ?? []).filter((d) => d.date && !d.done && d.date >= todayStr())
  if (list.length === 0) return '9999-99-99'
  list.sort((a, b) => a.date.localeCompare(b.date))
  return list[0].date
}

function progressOf(record: ProjectRecord): number {
  let total = 0
  let done = 0
  for (const g of record.taskGroups ?? []) for (const t of g.tasks ?? []) {
    total++
    if (t.status === 'done') done++
  }
  return total === 0 ? 1 : done / total
}

export function ProjectBoard({ projects, healthByProject, searchQuery, onSearch, onOpenProject, onNewProject, onDeleteProject, onImport }: ProjectBoardProps): React.JSX.Element {
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<SortKey>('recent')
  const [openMenu, setOpenMenu] = useState<MenuDim>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!openMenu) return
    const h = (e: MouseEvent): void => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) setOpenMenu(null)
    }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [openMenu])

  const visible = useMemo(() => {
    let list = projects
    if (typeFilter) list = list.filter((p) => projectTypeLabel(p.projectType) === typeFilter)
    if (statusFilter) list = list.filter((p) => normalizeStatusKey(p.status) === statusFilter)
    if (searchQuery.trim() !== '') {
      const q = searchQuery.trim().toLowerCase()
      list = list.filter((p) => [p.name, p.projectId, p.leadLawyer, ...(p.serviceScope ?? [])]
        .filter(Boolean).join(' ').toLowerCase().includes(q))
    }
    const sorted = [...list]
    switch (sortKey) {
      case 'projectId': sorted.sort((a, b) => b.projectId.localeCompare(a.projectId)); break
      case 'recent': sorted.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')); break
      case 'nextDate': sorted.sort((a, b) => nextDate(a).localeCompare(nextDate(b))); break
      case 'progress': sorted.sort((a, b) => progressOf(a) - progressOf(b)); break
    }
    return sorted
  }, [projects, typeFilter, statusFilter, searchQuery, sortKey])

  // stats (all projects)
  const activeCount = projects.filter((p) => {
    const k = normalizeStatusKey(p.status)
    return k !== 'completed' && k !== 'closed'
  }).length
  const completedCount = projects.filter((p) => normalizeStatusKey(p.status) === 'completed').length
  const overdueCount = projects.reduce((n, p) => {
    const today = todayStr()
    for (const g of p.taskGroups ?? []) for (const t of g.tasks ?? []) {
      if (t.status !== 'done' && t.deadline && t.deadline < today) n++
    }
    return n
  }, 0)
  const expiringPeriods = projects.filter((p) => {
    const end = p.servicePeriod?.end
    return !!end && daysUntil(end) >= 0 && daysUntil(end) <= 60
  }).length

  const countByType = (key: string): number => visible.filter((p) => projectTypeLabel(p.projectType) === key).length
  const countByStatus = (id: string): number => visible.filter((p) => normalizeStatusKey(p.status) === id).length

  // 待补信息：按项目类型与状态该填却缺失的项数（不含已归档）。
  const missingInfoCount = useMemo(
    () => [...(healthByProject?.values() ?? [])]
      .filter((h) => h.status !== 'closed' && h.completeness.gaps.length > 0).length,
    [healthByProject],
  )

  const dimBtn = (active: boolean, open: boolean): string => `${css.dropBtn} ${open ? css.dropBtnOpen : active ? css.dropBtnActive : ''}`

  return (
    <div className={css.board}>
      {projects.length > 0 && (
        <div className={css.statsBar}>
          <div className={css.statBlock}><span className={css.statNum}>{projects.length}</span><span className={css.statLabel}>{tt('board.totalProjects')}</span></div>
          <span className={css.statDivider} />
          <div className={css.statBlock}><span className={css.statNumAccent}>{activeCount}</span><span className={css.statLabel}>{tt('board.active')}</span></div>
          {completedCount > 0 && <><span className={css.statDivider} /><div className={css.statBlock}><span className={css.statNumSuccess}>{completedCount}</span><span className={css.statLabel}>{tt('board.completed')}</span></div></>}
          <div className={css.statsRight}>
            {overdueCount > 0 && (
              <button className={css.urgentStat} type="button"><span className={css.urgentNum}>{overdueCount}</span><span className={css.urgentLabel}>{tt('board.overdue')}</span></button>
            )}
            {expiringPeriods > 0 && (
              <button className={css.urgentStat} type="button"><span className={css.urgentNumWarn}>{expiringPeriods}</span><span className={css.urgentLabel}>{tt('board.expiring')}</span></button>
            )}
            {missingInfoCount > 0 && (
              <span className={css.missingPill} title="按各项目类型与状态应填、但尚未登记的字段数">待补信息 {missingInfoCount}</span>
            )}
          </div>
        </div>
      )}

      <div ref={toolbarRef} className={css.toolbar}>
        <div className={css.searchBox}>
          <span className={css.searchIcon} aria-hidden>🔍</span>
          <input className={css.searchInput} placeholder={tt('board.search')} value={searchQuery} onChange={(e) => onSearch(e.target.value)} />
          {searchQuery !== '' && <button className={css.clearSearch} type="button" onClick={() => onSearch('')}>✕</button>}
        </div>
        <div className={css.toolbarActions}>
          <div className={css.dropWrap}>
            <button type="button" className={dimBtn(typeFilter !== null, openMenu === 'type')} onClick={() => setOpenMenu(openMenu === 'type' ? null : 'type')}>
              {typeFilter && <span className={css.activeDot} style={{ background: getProjectTypeDot(typeFilter ?? undefined) }} aria-hidden />}
              {typeFilter ? <>{typeFilter}<button className={css.dropClear} type="button" onClick={(e) => { e.stopPropagation(); setTypeFilter(null) }}>×</button></> : <>{tt('board.type')} <span className={css.dropChevron}>▾</span></>}
            </button>
            {openMenu === 'type' && (
              <div className={css.dropPanel}>
                {PROJECT_TYPES.filter((t) => t.key !== '__all').map((t) => (
                  <button key={t.key} type="button" className={typeFilter === t.label ? `${css.dropOption} ${css.dropOptionActive}` : css.dropOption} onClick={() => { setTypeFilter(typeFilter === t.label ? null : t.label); setOpenMenu(null) }}>
                    <span className={css.activeDot} style={{ background: t.dot }} aria-hidden />
                    <span>{t.label}</span>
                    <span className={css.dropOptionCount}>{countByType(t.label)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className={css.dropWrap}>
            <button type="button" className={dimBtn(statusFilter !== null, openMenu === 'status')} onClick={() => setOpenMenu(openMenu === 'status' ? null : 'status')}>
              {statusFilter ? <>{(() => { const d = PROJECT_STATUSES.find((s) => s.id === statusFilter); return <span className={`${css.statusPill} ${css[`tone-${d?.tone ?? 'neutral'}`]}`}>{d?.label ?? statusFilter}</span> })()}<button className={css.dropClear} type="button" onClick={(e) => { e.stopPropagation(); setStatusFilter(null) }}>×</button></> : <>{tt('board.status')} <span className={css.dropChevron}>▾</span></>}
            </button>
            {openMenu === 'status' && (
              <div className={css.dropPanel}>
                {PROJECT_STATUSES.map((s) => (
                  <button key={s.id} type="button" className={statusFilter === s.id ? `${css.dropOption} ${css.dropOptionActive}` : css.dropOption} onClick={() => { setStatusFilter(statusFilter === s.id ? null : s.id); setOpenMenu(null) }}>
                    <span className={`${css.statusPill} ${css[`tone-${s.tone}`]}`}>{s.label}</span>
                    <span className={css.dropOptionCount}>{countByStatus(s.id)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className={css.dropWrap}>
            <button type="button" className={dimBtn(false, openMenu === 'sort')} onClick={() => setOpenMenu(openMenu === 'sort' ? null : 'sort')}>
              {tt('board.sortBy')}{SORT_OPTIONS.find((o) => o.value === sortKey)?.label} <span className={css.dropChevron}>▾</span>
            </button>
            {openMenu === 'sort' && (
              <div className={css.dropPanel}>
                {SORT_OPTIONS.map((o) => (
                  <button key={o.value} type="button" className={sortKey === o.value ? `${css.dropOption} ${css.dropOptionActive}` : css.dropOption} onClick={() => { setSortKey(o.value); setOpenMenu(null) }}>
                    <span>{o.label}</span>
                    {sortKey === o.value && <span className={css.dropCheck}>✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className={css.miniBtn} type="button" onClick={onImport}>{tt('board.import')}</button>
          <button className={css.primaryBtn} type="button" onClick={onNewProject}>+ {tt('board.newProject')}</button>
        </div>
      </div>

      {projects.length === 0 ? (
        <div className={css.empty}>
          <div className={css.emptyIcon}>💼</div>
          <p>{tt('board.empty')}</p>
          <button className={css.emptyLink} type="button" onClick={onNewProject}>{tt('board.registerFirst')}</button>
        </div>
      ) : visible.length === 0 ? (
        <div className={css.empty}><p>{tt('board.noMatch')}</p></div>
      ) : (
        <div className={css.grid}>
          {visible.map((p) => (
            <ProjectCard
              key={p.projectId}
              record={p}
              health={healthByProject?.get(p.projectId)}
              onClick={() => onOpenProject(p.projectId)}
              onDelete={onDeleteProject}
            />
          ))}
        </div>
      )}

      <div className={css.boardFooter}>
        <span>{tt('board.updatedHint')} {timeAgo(projects.length ? maxUpdated(projects) : undefined)}</span>
      </div>
    </div>
  )
}

function maxUpdated(projects: ProjectRecord[]): string {
  return projects.reduce((max, p) => (p.updatedAt ?? '' > max ? p.updatedAt ?? '' : max), '')
}
