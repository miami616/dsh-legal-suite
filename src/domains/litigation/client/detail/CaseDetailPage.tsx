/**
 * Case detail — AgentLex detail-v2 layout: masthead + two columns.
 *
 * Left: 案件基本信息 (2-col) / 当事人信息 (role badges, 我方 highlighted) /
 *       关键日程 (future nodes countdown) / 任务拆解.
 * Right: 案件概述 / 审级历程 (current level node) / 办案时间轴.
 *
 * Data model is the plugin's CaseRecord (no instances/tags/folder/fee);
 * the procedure journey renders the single current level.
 */
import { useEffect, useMemo, useState } from 'react'
import type { CaseRecord, TimelineEvent } from '../../store/types.ts'
import { daysUntil, formatAmount, parseAmountValue, timeAgo, todayStr } from '../case-format.ts'
import { getCaseTypeDot, normalizeCaseType } from '../case-taxonomy.ts'
import { getStatusDef, normalizeLevel, getProcedureDot } from '../case-status.ts'
import { resolveCounterparty, resolveOurParty } from '../party.ts'
import { tt } from '../i18n.ts'
import * as api from '../api.ts'
import { pickDirectoryPath } from '../../../../shared/folder-picker.ts'
import { TaskTree } from './TaskTree.tsx'
import { Timeline } from './Timeline.tsx'
import css from './detail.module.css'

interface CaseDetailPageProps {
  record: CaseRecord
  events: TimelineEvent[]
  onChange: () => void
  /** Open 诉讼管家 for this case (seeds the session with case context). */
  onOpenAgent?: (context: string) => void
  /** Open the bound case folder in the better-sidebar. */
  onOpenFolder?: (folder: string) => void
}

/** role badge tone (AgentLex ROLE_BADGE palette). */
function roleBadge(role: string): string {
  const tones: Record<string, string> = {
    '原告': css.rolePlaintiff, '申请人': css.rolePlaintiff, '申请执行人': css.roleExec,
    '被告': css.roleDefendant, '被申请人': css.roleDefendant, '被执行人': css.roleExecResp,
    '上诉人': css.roleAppellant, '被上诉人': css.roleAppellee, '第三人': css.roleThird,
  }
  return tones[role] ?? css.roleThird
}

export function CaseDetailPage({ record, events, onChange, onOpenAgent, onOpenFolder }: CaseDetailPageProps): React.JSX.Element {
  const [summaryDraft, setSummaryDraft] = useState<string | null>(null)
  const [summaryError, setSummaryError] = useState('')
  const [folderDraft, setFolderDraft] = useState<string | null>(null)
  const [folderError, setFolderError] = useState('')
  // 案件体检：完整度按当前阶段动态计算（诉前不罚缺案号）。旁路数据，
  // 取不到就整块不渲染，绝不影响详情页主体。
  const [health, setHealth] = useState<api.CaseHealthView | null>(null)
  useEffect(() => {
    let alive = true
    void api.caseHealth(record.caseId)
      .then((res) => { if (alive) setHealth(res as api.CaseHealthView) })
      .catch(() => { if (alive) setHealth(null) })
    return () => { alive = false }
  }, [record.caseId, record.updatedAt])

  const typeLabel = normalizeCaseType(record.type)
  const typeDot = getCaseTypeDot(record.type)
  const status = getStatusDef(record.status)
  const level = normalizeLevel(record.level)
  const amount = formatAmount(parseAmountValue(record.claimAmount))
  const showAmount = parseAmountValue(record.claimAmount) > 0
  const caseNoReal = record.caseNumber && !/^【.+】$/.test(record.caseNumber) ? record.caseNumber : ''
  const courtReal = record.court && !/^【.+】$/.test(record.court) ? record.court : ''
  const our = resolveOurParty(record)
  const opp = resolveCounterparty(record)
  const ourRole = our.role
  const oppRole = opp.role
  const ourName = our.name
  const oppName = opp.name
  const details = record.parties?.details ?? []

  // 关键日程 = future pending events (soonest first); 时间轴 shows the rest.
  const today = todayStr()
  const upcoming = useMemo(() => events
    .filter((e) => e.status === 'pending' && e.date && e.date >= today)
    .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '')), [events, today])

  const saveSummary = async (): Promise<void> => {
    if (summaryDraft === null) return
    const value = summaryDraft.trim()
    setSummaryDraft(null)
    if (value === record.summary) return
    try {
      await api.updateCase(record.caseId, { summary: value })
      onChange()
    } catch {
      setSummaryError('保存失败')
    }
  }

  const saveFolder = async (): Promise<void> => {
    if (folderDraft === null) return
    const value = folderDraft.trim()
    setFolderDraft(null)
    if (value === (record.folder ?? '')) return
    try {
      await api.updateCase(record.caseId, { folder: value === '' ? undefined : value })
      onChange()
    } catch {
      setFolderError('保存失败')
    }
  }

  /** 绑定/更换卷宗：优先弹系统目录选择框；取消或环境不可用时回退手填草稿。 */
  const pickOrEditFolder = async (): Promise<void> => {
    const picked = await pickDirectoryPath()
    if (picked !== null && picked !== '') {
      setFolderDraft(null)
      if (picked !== (record.folder ?? '')) {
        try {
          await api.updateCase(record.caseId, { folder: picked })
          onChange()
        } catch {
          setFolderError('保存失败')
        }
      }
      return
    }
    setFolderDraft(record.folder ?? '')
  }

  return (
    <div className={css.page}>
      <div className={css.pageInner}>
      {/* ═══ masthead ═══ */}
      <header className={css.masthead}>
        <div className={css.mastheadTop}>
          <span className={css.typeTag} style={{ background: `color-mix(in srgb, ${typeDot} 13%, transparent)`, color: `color-mix(in srgb, ${typeDot} 62%, var(--lit-ink))` }}>
            <span className={css.typeDot} style={{ background: typeDot }} aria-hidden />
            {typeLabel}
          </span>
          {level !== '' && <span className={css.levelTag}>{level}</span>}
          <span className={`${css.statusPill} ${css[`tone-${status.tone}`]}`}>{status.label}</span>
          <span className={css.mastheadTime}>{timeAgo(record.updatedAt)}</span>
          {onOpenAgent !== undefined && (
            <button
              className={css.agentBtn}
              type="button"
              onClick={() => onOpenAgent(
                `请帮我处理案件 ${record.caseId}（${record.name}）。` +
                `案件类型：${typeLabel}${record.cause ? `；案由：${record.cause}` : ''}` +
                `${record.court ? `；法院：${record.court}` : ''}` +
                `${record.judge && !/^【.+】$/.test(record.judge) ? `；法官：${record.judge}` : ''}` +
                `${showAmount ? `；标的：${amount}` : ''}` +
                `${record.summary ? `；案情摘要：${record.summary}` : ''}` +
                `。请先查看该案件的现状，再告诉我可以帮你做什么。`,
              )}
            >
              ⚖ {tt('agent.title')}
            </button>
          )}
        </div>
        <div className={css.mastheadTitleRow}>
          <span className={css.mastheadId}>{record.caseId}</span>
          <h1 className={css.mastheadName}>{record.name}</h1>
        </div>
        {(caseNoReal !== '' || courtReal !== '') && (
          <div className={css.mastheadMeta}>
            {caseNoReal !== '' && <span className={css.metaMono}>{caseNoReal}</span>}
            {courtReal !== '' && <span>{caseNoReal !== '' ? ' · ' : ''}{courtReal}</span>}
          </div>
        )}
        {(ourRole !== '' || oppRole !== '') && (
          <div className={css.mastheadParties}>
            {ourRole !== '' && (
              <span className={css.mhParty}>
                <span className={`${css.roleBadge} ${roleBadge(ourRole)}`}>{ourRole}</span>
                <span className={css.mhName}>{ourName || '—'}</span>
                <span className={css.mhTag}>{tt('detail.ourSide')}</span>
              </span>
            )}
            {oppRole !== '' && <span className={css.mhVs}>诉</span>}
            {oppRole !== '' && (
              <span className={css.mhParty}>
                <span className={`${css.roleBadge} ${roleBadge(oppRole)}`}>{oppRole}</span>
                <span className={css.mhName}>{oppName || '—'}</span>
              </span>
            )}
          </div>
        )}
      </header>

      {/* ═══ two columns ═══ */}
      <div className={css.columns}>
        {/* left */}
        <div className={css.leftCol}>
          {/* 1. 案件基本信息 */}
          <section className={css.section}>
            <h2 className={css.sectionTitle}>{tt('detail.basicInfo')}</h2>
            <div className={css.infoGrid}>
              <div className={css.infoItem}><span className={css.infoLabel}>案由</span><p className={css.infoValue}>{record.cause || '—'}</p></div>
              <div className={css.infoItem}><span className={css.infoLabel}>案件类型</span><p className={css.infoValue}>{typeLabel}</p></div>
              <div className={css.infoItem}><span className={css.infoLabel}>审理法院</span><p className={css.infoValue}>{courtReal || '—'}</p></div>
              <div className={css.infoItem}><span className={css.infoLabel}>承办法官</span><p className={css.infoValue}>{record.judge && !/^【.+】$/.test(record.judge) ? record.judge : '—'}</p></div>
              <div className={css.infoItem}><span className={css.infoLabel}>立案日期</span><p className={css.infoValue}>{record.filingDate ? record.filingDate.slice(0, 10) : '—'}</p></div>
              <div className={css.infoItem}><span className={css.infoLabel}>诉讼标的</span><p className={css.infoValue}>{showAmount ? amount : '—'}</p></div>
            </div>
          </section>

          {/* 2. 当事人信息 */}
          <section className={css.section}>
            <div className={css.sectionHead}>
              <h2 className={css.sectionTitle}>{tt('detail.parties')}</h2>
              {ourRole !== '' && (
                <span className={css.ourSideLabel}>{tt('detail.ourSide')}：<span className={`${css.roleBadge} ${roleBadge(ourRole)}`}>{ourRole}</span></span>
              )}
            </div>
            {details.length === 0 ? (
              <p className={css.sectionMuted}>{tt('overview.noParties')}</p>
            ) : (
              <div className={css.partyList}>
                {details.map((p, i) => {
                  const role = p.role || '原告'
                  const isOur = role === ourRole
                  return (
                    <div key={`${p.name}-${i}`} className={isOur ? `${css.partyRow} ${css.partyRowOur}` : css.partyRow}>
                      <span className={`${css.roleBadge} ${roleBadge(role)}`}>{role}</span>
                      {isOur && <span className={css.ourMark}>{tt('detail.ourSide')}</span>}
                      <span className={css.partyName}>{p.name}</span>
                      {p.legalRep && <span className={css.partySub}>法代 {p.legalRep}</span>}
                      {p.address && <span className={css.partySub}>{p.address}</span>}
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* 卷宗文件夹 */}
          <section className={css.section}>
            <div className={css.sectionHead}>
              <h2 className={css.sectionTitle}>{tt('detail.folder')}</h2>
              {folderDraft === null && (
                <button
                  className={css.sectionAction}
                  type="button"
                  onClick={() => { void pickOrEditFolder() }}
                >
                  {record.folder ? tt('detail.folderChange') : tt('detail.folderBind')}
                </button>
              )}
            </div>
            {folderDraft !== null ? (
              <div className={css.folderEdit}>
                <input
                  className={css.input}
                  value={folderDraft}
                  onChange={(e) => setFolderDraft(e.target.value)}
                  onBlur={() => { void saveFolder() }}
                  onKeyDown={(e) => { if (e.key === 'Escape') setFolderDraft(null) }}
                  placeholder={tt('modal.folderPlaceholder')}
                  autoFocus
                />
                {folderError !== '' && <p className={css.sectionError}>{folderError}</p>}
                <span className={css.sectionMuted}>{tt('modal.folderHint')}</span>
              </div>
            ) : record.folder !== undefined && record.folder !== '' ? (
              <div className={css.folderRow}>
                <span className={css.folderIcon} aria-hidden>📁</span>
                <span className={css.folderPath} title={record.folder}>{record.folder}</span>
                {onOpenFolder && (
                  <button
                    className={css.sectionAction}
                    type="button"
                    onClick={() => onOpenFolder(record.folder!)}
                  >
                    在侧边栏打开
                  </button>
                )}
              </div>
            ) : (
              <p className={css.sectionMuted}>{tt('detail.noFolder')}</p>
            )}
          </section>

          {/* 3. 关键日程 */}
          <section className={css.section}>
            <h2 className={css.sectionTitle}>{tt('detail.keySchedule')}</h2>
            {upcoming.length === 0 ? (
              <p className={css.sectionMuted}>{tt('detail.noSchedule')}</p>
            ) : (
              <div className={css.scheduleList}>
                {upcoming.map((e) => {
                  const days = daysUntil(e.date)
                  const urgent = days <= 3
                  return (
                    <div key={`${e.id ?? e.title}-${e.date}`} className={urgent ? `${css.scheduleItem} ${css.scheduleItemUrgent}` : css.scheduleItem}>
                      <span className={css.scheduleDate}>{e.date.slice(5)}</span>
                      <span className={css.scheduleLabel}>{e.title}</span>
                      <span className={urgent ? `${css.scheduleCountdown} ${css.scheduleCountdownUrgent}` : css.scheduleCountdown}>
                        {days === 0 ? tt('card.today') : days === 1 ? tt('card.tomorrow') : tt('card.daysLater', { n: String(days) })}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          {/* 4. 任务拆解 */}
          <section className={css.section}>
            <h2 className={css.sectionTitle}>{tt('detail.tasks')}</h2>
            <TaskTree record={record} onChange={onChange} />
          </section>
        </div>

        {/* right */}
        <div className={css.rightCol}>
          {/* 案件概述 */}
          <section className={css.section}>
            <h3 className={css.sectionTitle}>{tt('detail.overview')}</h3>
            {summaryDraft !== null ? (
              <div className={css.summaryEdit}>
                <textarea className={css.summaryInput} rows={4} maxLength={200} autoFocus
                  value={summaryDraft} onChange={(e) => setSummaryDraft(e.target.value)}
                  onBlur={() => { void saveSummary() }}
                  onKeyDown={(e) => { if (e.key === 'Escape') setSummaryDraft(null) }}
                  placeholder={tt('overview.summaryPlaceholder')} />
                {summaryError !== '' && <p className={css.sectionError}>{summaryError}</p>}
              </div>
            ) : (record.summary !== undefined && record.summary !== '') ? (
              <div className={css.summaryText}>
                <p>{record.summary}</p>
                <button className={css.summaryEditBtn} type="button" onClick={() => setSummaryDraft(record.summary ?? '')}>编辑</button>
              </div>
            ) : (
              <button className={css.summaryEmpty} type="button" onClick={() => setSummaryDraft('')}>+ {tt('detail.overview')}</button>
            )}
          </section>

          {/* 信息完整度 */}
          {health !== null && (
            <section className={css.section}>
              <h3 className={css.sectionTitle}>信息完整度</h3>
              <div className={css.healthHead}>
                <span className={css.healthScore}>{health.completeness.score}%</span>
                <span className={css.healthMeta}>
                  按「{health.statusLabel}」阶段计算 · 已填 {health.completeness.filled}/{health.completeness.total}
                </span>
              </div>
              <span className={css.healthBar} aria-hidden>
                <span className={css.healthBarFill} style={{ width: `${health.completeness.score}%` }} />
              </span>
              {health.stage.name !== undefined && health.stage.total > 0 && (
                <p className={css.healthMeta}>
                  当前阶段「{health.stage.name}」：共 {health.stage.total} 项，已完成 {health.stage.done} 项，待办 {health.stage.open} 项
                </p>
              )}
              {health.completeness.gaps.length > 0 ? (
                <ul className={css.healthGaps}>
                  {health.completeness.gaps.map((g) => (
                    <li key={g.field}>
                      <span className={css.healthGapLabel}>{g.label}</span>
                      <span className={css.healthGapWhy}>{g.why}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={css.sectionMuted}>当前阶段应登记的信息已齐全。</p>
              )}
              {health.suggestions.length > 0 && (
                <ul className={css.healthSuggestions}>
                  {health.suggestions.map((s, i) => (
                    <li key={`${s.type}-${i}`}>{s.reason}</li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* 审级历程 */}
          <section className={css.section}>
            <h3 className={css.sectionTitle}>{tt('detail.procedureJourney')}</h3>
            {level === '' ? (
              <p className={css.sectionMuted}>{tt('detail.noProcedure')}</p>
            ) : (
              <div className={css.journey}>
                <span className={css.journeyLine} aria-hidden />
                <div className={css.journeyNode}>
                  <span className={css.journeyDot} style={{ backgroundColor: getProcedureDot(level) }} aria-hidden />
                  <span className={css.levelTag}>{level}</span>
                  <span className={css.journeyCurrent}>{tt('detail.current')}</span>
                </div>
              </div>
            )}
          </section>

          {/* 办案时间轴 */}
          <section className={css.section}>
            <h3 className={css.sectionTitle}>{tt('detail.caseTimeline')}</h3>
            <Timeline caseId={record.caseId} caseName={record.name} events={events} onChange={onChange} />
          </section>
        </div>
      </div>
      </div>
    </div>
  )
}
