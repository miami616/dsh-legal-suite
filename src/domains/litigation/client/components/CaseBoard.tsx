/**
 * Case board — AgentLex-style overview: stats bar (big tabular numbers),
 * single-row dropdown filter toolbar (type / status / sort), search, and the
 * Direction-B card grid.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CaseRecord, TimelineEvent } from '../../store/types.ts'
import { daysUntil, parseAmountValue, timeAgo, todayStr } from '../case-format.ts'
import { CASE_TYPES, getCaseTypeDot, normalizeCaseType } from '../case-taxonomy.ts'
import { CASE_STATUSES, getStatusDef, normalizeLevel } from '../case-status.ts'
import { tt } from '../i18n.ts'
import type { CaseHealthView } from '../api.ts'
import { CaseCard } from './CaseCard.tsx'
import css from './board.module.css'

type SortKey = 'recent' | 'nextKeyDate' | 'caseId' | 'claimAmount'
type MenuDim = 'type' | 'status' | 'sort' | null

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'recent', label: tt('board.sortRecent') },
  { value: 'nextKeyDate', label: tt('board.sortNext') },
  { value: 'caseId', label: tt('board.sortId') },
  { value: 'claimAmount', label: tt('board.sortAmount') },
]

interface CaseBoardProps {
  cases: CaseRecord[]
  timelineEvents: TimelineEvent[]
  /** 案件体检（caseId → 完整度/缺口），旁路数据，可能为空表。 */
  healthByCase?: Map<string, CaseHealthView>
  searchQuery: string
  onSearch: (q: string) => void
  onOpenCase: (caseId: string) => void
  onNewCase: () => void
  onDeleteCase: (caseId: string) => void
  onImport: () => void
}

/** upcoming pending events per case, sorted soonest-first. */
function upcomingByCase(events: TimelineEvent[]): Map<string, TimelineEvent[]> {
  const map = new Map<string, TimelineEvent[]>()
  const today = todayStr()
  for (const e of events) {
    if (e.status !== 'pending' || !e.date || e.date < today) continue
    const list = map.get(e.caseId) ?? []
    list.push(e)
    map.set(e.caseId, list)
  }
  for (const list of map.values()) list.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
  return map
}

export function CaseBoard({ cases, timelineEvents, healthByCase, searchQuery, onSearch, onOpenCase, onNewCase, onDeleteCase, onImport }: CaseBoardProps): React.JSX.Element {
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

  const upcoming = useMemo(() => upcomingByCase(timelineEvents), [timelineEvents])

  const visible = useMemo(() => {
    let list = cases
    if (typeFilter) list = list.filter((c) => normalizeCaseType(c.type) === typeFilter)
    if (statusFilter) list = list.filter((c) => (c.status ?? 'intake') === statusFilter)
    if (searchQuery.trim() !== '') {
      const q = searchQuery.trim().toLowerCase()
      list = list.filter((c) => [c.name, c.caseId, c.cause, c.court, c.judge, c.caseNumber, c.parties?.plaintiff, c.parties?.defendant]
        .filter(Boolean).join(' ').toLowerCase().includes(q))
    }
    const sorted = [...list]
    switch (sortKey) {
      case 'caseId': sorted.sort((a, b) => b.caseId.localeCompare(a.caseId)); break
      case 'recent': sorted.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')); break
      case 'nextKeyDate': {
        const first = (c: CaseRecord) => (upcoming.get(c.caseId) ?? [])[0]?.date ?? '9999-99-99'
        sorted.sort((a, b) => first(a).localeCompare(first(b)))
        break
      }
      case 'claimAmount': sorted.sort((a, b) => parseAmount(b) - parseAmount(a)); break
    }
    return sorted
  }, [cases, typeFilter, statusFilter, searchQuery, sortKey, upcoming])

  const byStatus = useMemo(() => {
    const groups = new Map<string, CaseRecord[]>()
    for (const c of visible) {
      const key = c.status ?? 'intake'
      groups.set(key, [...(groups.get(key) ?? []), c])
    }
    return groups
  }, [visible])

  // stats (all cases)
  const activeCount = useMemo(() => cases.filter((c) => (c.status ?? 'intake') !== 'closed').length, [cases])
  const closedCount = useMemo(() => cases.filter((c) => c.status === 'closed').length, [cases])
  const overdueCount = useMemo(() => {
    const today = todayStr()
    let n = 0
    for (const c of cases) for (const g of c.taskGroups ?? []) for (const t of g.tasks) {
      if (t.status !== 'done' && t.deadline && t.deadline < today) n++
    }
    return n
  }, [cases])
  const urgentDates = useMemo(() => {
    const today = todayStr()
    const items: { label: string; date: string }[] = []
    for (const e of timelineEvents) {
      if (e.status !== 'pending' || !e.date || e.date < today) continue
      const days = Math.round((new Date(e.date).getTime() - new Date(today).getTime()) / 86400000)
      if (days <= 7) items.push({ label: e.title, date: e.date })
    }
    items.sort((a, b) => a.date.localeCompare(b.date))
    return items.slice(0, 5)
  }, [timelineEvents])

  // 待补信息：按当前阶段该填却缺失的案件数（不含已结案）。体检是旁路数据，
  // 取不到时 healthByCase 为空表，这里自然为 0，不影响看板。
  const missingInfoCount = useMemo(
    () => [...(healthByCase?.values() ?? [])]
      .filter((h) => h.status !== 'closed' && h.completeness.gaps.length > 0).length,
    [healthByCase],
  )

  const countByType = (key: string): number => visible.filter((c) => normalizeCaseType(c.type) === key).length
  const countByStatus = (id: string): number => visible.filter((c) => (c.status ?? 'intake') === id).length

  const dimBtn = (active: boolean, open: boolean): string => `${css.dropBtn} ${open ? css.dropBtnOpen : active ? css.dropBtnActive : ''}`

  return (
    <div className={css.board}>
      {/* stats bar */}
      {cases.length > 0 && (
        <div className={css.statsBar}>
          <div className={css.statBlock}><span className={css.statNum}>{cases.length}</span><span className={css.statLabel}>{tt('board.totalCases')}</span></div>
          <span className={css.statDivider} />
          <div className={css.statBlock}><span className={css.statNum}>{activeCount}</span><span className={css.statLabel}>{tt('board.active')}</span></div>
          {closedCount > 0 && <><span className={css.statDivider} /><div className={css.statBlock}><span className={css.statNumSuccess}>{closedCount}</span><span className={css.statLabel}>{tt('board.closed')}</span></div></>}
          <div className={css.statsRight}>
            {overdueCount > 0 && (
              <button className={css.urgentStat} type="button"><span className={css.urgentNum}>{overdueCount}</span><span className={css.urgentLabel}>{tt('board.overdue')}</span></button>
            )}
            {urgentDates.length > 0 && (
              <button className={css.urgentPill} type="button">!! {urgentDates.length} {tt('board.urgent')}</button>
            )}
            {missingInfoCount > 0 && (
              <span className={css.missingPill} title="按各案件当前阶段应填、但尚未登记的字段数">待补信息 {missingInfoCount}</span>
            )}
          </div>
        </div>
      )}

      {/* filter toolbar */}
      <div ref={toolbarRef} className={css.toolbar}>
        <div className={css.searchBox}>
          <span className={css.searchIcon} aria-hidden>🔍</span>
          <input className={css.searchInput} placeholder={tt('board.search')} value={searchQuery} onChange={(e) => onSearch(e.target.value)} />
          {searchQuery !== '' && <button className={css.clearSearch} type="button" onClick={() => onSearch('')}>✕</button>}
        </div>
        <div className={css.toolbarActions}>
          {/* type */}
          <div className={css.dropWrap}>
            <button type="button" className={dimBtn(typeFilter !== null, openMenu === 'type')} onClick={() => setOpenMenu(openMenu === 'type' ? null : 'type')}>
              {typeFilter && <span className={css.activeDot} style={{ background: getCaseTypeDot(typeFilter) }} aria-hidden />}
              {typeFilter ? <>{typeFilter}<button className={css.dropClear} type="button" onClick={(e) => { e.stopPropagation(); setTypeFilter(null) }}>×</button></> : <>{tt('board.type')} <span className={css.dropChevron}>▾</span></>}
            </button>
            {openMenu === 'type' && (
              <div className={css.dropPanel}>
                {CASE_TYPES.filter((t) => t.key !== '__all').map((t) => (
                  <button key={t.key} type="button" className={typeFilter === t.key ? `${css.dropOption} ${css.dropOptionActive}` : css.dropOption} onClick={() => { setTypeFilter(typeFilter === t.key ? null : t.key); setOpenMenu(null) }}>
                    <span className={css.activeDot} style={{ background: t.dot }} aria-hidden />
                    <span>{t.label}</span>
                    <span className={css.dropOptionCount}>{countByType(t.key)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* status */}
          <div className={css.dropWrap}>
            <button type="button" className={dimBtn(statusFilter !== null, openMenu === 'status')} onClick={() => setOpenMenu(openMenu === 'status' ? null : 'status')}>
              {statusFilter ? <>{(() => { const d = getStatusDef(statusFilter); return <span className={`${css.statusPill} ${css[`tone-${d.tone}`]}`}>{d.label}</span> })()}<button className={css.dropClear} type="button" onClick={(e) => { e.stopPropagation(); setStatusFilter(null) }}>×</button></> : <>{tt('board.status')} <span className={css.dropChevron}>▾</span></>}
            </button>
            {openMenu === 'status' && (
              <div className={css.dropPanel}>
                {CASE_STATUSES.map((s) => (
                  <button key={s.id} type="button" className={statusFilter === s.id ? `${css.dropOption} ${css.dropOptionActive}` : css.dropOption} onClick={() => { setStatusFilter(statusFilter === s.id ? null : s.id); setOpenMenu(null) }}>
                    <span className={`${css.statusPill} ${css[`tone-${s.tone}`]}`}>{s.label}</span>
                    <span className={css.dropOptionCount}>{countByStatus(s.id)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* sort */}
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
          <button className={css.sparkBtn} type="button" onClick={onImport}>{tt('board.import')}</button>
          <button className={css.primaryBtn} type="button" onClick={onNewCase}>+ {tt('board.newCase')}</button>
        </div>
      </div>

      {/* body */}
      {cases.length === 0 ? (
        <div className={css.empty}>
          <div className={css.emptyIcon}>⚖</div>
          <p>{tt('board.empty')}</p>
          <button className={css.emptyLink} type="button" onClick={onNewCase}>{tt('board.registerFirst')}</button>
        </div>
      ) : visible.length === 0 ? (
        <div className={css.empty}><p>{tt('board.noMatch')}</p></div>
      ) : (
        <div className={css.grid}>
          {visible.map((c) => (
            <CaseCard
              key={c.caseId}
              record={c}
              upcomingEvents={upcoming.get(c.caseId)}
              health={healthByCase?.get(c.caseId)}
              onClick={() => onOpenCase(c.caseId)}
              onDelete={onDeleteCase}
            />
          ))}
        </div>
      )}

      <div className={css.boardFooter}>
        <span>{tt('board.updatedHint')} {timeAgo(cases.length ? maxUpdated(cases) : null)}</span>
      </div>
    </div>
  )
}

function parseAmount(c: CaseRecord): number {
  if (!c.claimAmount) return 0
  const trimmed = c.claimAmount.replace(/[,\s]/g, '')
  const match = /^([0-9.]+)\s*(万|亿)?/.exec(trimmed)
  if (!match) return 0
  let n = Number(match[1])
  if (match[2] === '万') n *= 10_000
  if (match[2] === '亿') n *= 100_000_000
  return n
}

function maxUpdated(cases: CaseRecord[]): string {
  return cases.reduce((max, c) => (c.updatedAt ?? '' > max ? c.updatedAt ?? '' : max), '')
}
