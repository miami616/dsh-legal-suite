/**
 * Case card — AgentLex Direction-B structure: left rail = mono case id +
 * procedure journey; right = type tag + name + status + party rows +
 * case-no/cause rows + key-date chips + footer.
 */
import { useMemo } from 'react'
import { daysUntil, formatAmount, isPlaceholder, parseAmountValue, relativeDays, timeAgo } from '../case-format.ts'
import { getCaseTypeDot, normalizeCaseType } from '../case-taxonomy.ts'
import { getProcedureShort, getStatusDef, normalizeLevel } from '../case-status.ts'
import { resolveCounterparty, resolveOurParty } from '../party.ts'
import { tt } from '../i18n.ts'
import type { CaseRecord, TimelineEvent } from '../../store/types.ts'
import css from './board.module.css'

interface CaseCardProps {
  record: CaseRecord
  /** Upcoming pending timeline events (soonest first). */
  upcomingEvents?: TimelineEvent[]
  onClick: () => void
  onDelete: (caseId: string) => void
}

export function CaseCard({ record, upcomingEvents = [], onClick, onDelete }: CaseCardProps): React.JSX.Element {
  const typeLabel = normalizeCaseType(record.type)
  const typeDot = getCaseTypeDot(record.type)
  const status = getStatusDef(record.status)
  const level = normalizeLevel(record.level)
  const levelShort = getProcedureShort(level)
  const amount = formatAmount(parseAmountValue(record.claimAmount))
  const showAmount = parseAmountValue(record.claimAmount) > 0
  const caseNoReal = record.caseNumber && !isPlaceholder(record.caseNumber) ? record.caseNumber : ''
  const courtReal = record.court && !isPlaceholder(record.court) ? record.court : ''

  const upcoming = useMemo(
    () => upcomingEvents.filter((e) => e.date && daysUntil(e.date) >= 0).sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '')).slice(0, 2),
    [upcomingEvents],
  )

  const [idHead, idTail] = useMemo(() => {
    const dash = record.caseId.indexOf('-')
    return dash > 0 ? [record.caseId.slice(0, dash + 1), record.caseId.slice(dash + 1)] : ['', record.caseId]
  }, [record.caseId])

  const our = resolveOurParty(record)
  const cp = resolveCounterparty(record)

  const levelDotColor = level !== '' ? getLevelDot(level) : undefined

  return (
    <div className={css.card} role="button" tabIndex={0} onClick={onClick} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}>
      {/* left rail */}
      <div className={css.cardRail}>
        <div className={css.cardId}>
          {idHead !== '' && <div className={css.cardIdHead}>{idHead}</div>}
          <div className={css.cardIdTail}>{idTail}</div>
        </div>
        <div className={css.cardLevels}>
          <span className={css.cardLevelsLine} aria-hidden />
          {level !== '' ? (
            <div className={css.cardLevelRow}>
              <span className={css.cardLevelDot} style={{ background: levelDotColor, borderColor: levelDotColor }} aria-hidden />
              <span className={css.cardLevelLabelCurrent}>{levelShort}</span>
            </div>
          ) : (
            <div className={css.cardLevelPending}>{tt('card.pending')}</div>
          )}
        </div>
      </div>

      {/* body */}
      <div className={css.cardBody}>
        <div className={css.cardTitleRow}>
          <span className={css.typeTag} style={{ background: `color-mix(in srgb, ${typeDot} 13%, transparent)`, color: `color-mix(in srgb, ${typeDot} 62%, var(--lit-ink))` }}>
            <span className={css.typeDot} style={{ background: typeDot }} aria-hidden />
            {typeLabel}
          </span>
          <h3 className={css.cardName} title={record.name}>{record.name}</h3>
          <span className={`${css.statusPill} ${css[`tone-${status.tone}`]}`}>{status.label}</span>
        </div>

        <div className={css.partyRow}>
          <span className={css.partyLabel}>{tt('card.ourSide')}</span>
          {our.role !== '' ? <span className={css.partyRole}>{our.role}</span> : <span className={css.partyNameMuted}>—</span>}
          {our.name !== '' ? <span className={css.partyName}>{our.name}</span> : <span className={css.partyNameMuted}>—</span>}
        </div>
        {cp.name !== '' && (
          <div className={css.partyRow}>
            <span className={css.partyLabel}>{tt('card.counterparty')}</span>
            {cp.role !== '' && <span className={css.partyRole}>{cp.role}</span>}
            <span className={css.partyNameMuted}>{cp.name}</span>
          </div>
        )}
        {(caseNoReal !== '' || courtReal !== '') && (
          <div className={css.partyRow}>
            <span className={css.partyLabel}>{tt('card.caseNo')}</span>
            {caseNoReal !== '' && <span className={`${css.monoValue} ${css.partyNameMuted}`}>{caseNoReal}</span>}
            {courtReal !== '' && <span className={css.partyNameMuted}>{caseNoReal !== '' ? ' · ' : ''}{courtReal}</span>}
          </div>
        )}
        {(record.cause !== undefined && record.cause !== '' || showAmount) && (
          <div className={css.partyRow}>
            <span className={css.partyLabel}>{tt('card.cause')}</span>
            {record.cause && !isPlaceholder(record.cause) ? <span className={css.partyNameMuted}>{record.cause}</span> : <span className={css.partyNameMuted}>—</span>}
            {showAmount && <>
              <span className={css.partyNameMuted}>·</span>
              <span className={css.partyNameMuted}>标的</span>
              <span className={`${css.partyName} ${css.monoValue}`}>{amount}</span>
            </>}
          </div>
        )}

        <div className={css.cardFooter}>
          {upcoming.map((e) => {
            const days = daysUntil(e.date)
            const cls = days <= 3 ? css.dateChipUrgent : days <= 7 ? css.dateChipSoon : css.dateChipNeutral
            return (
              <span key={`${e.id ?? e.title}-${e.date}`} className={`${css.dateChip} ${cls}`} title={`${e.title} ${e.date}`}>
                <span className={css.dateChipMono}>{e.date.slice(5)}</span>
                <span className={css.dateChipText}>{e.title}</span>
                {days === 0 ? tt('card.today') : days === 1 ? tt('card.tomorrow') : tt('card.daysLater', { n: String(days) })}
              </span>
            )
          })}
          <span className={css.footerSpacer} />
          {record.updatedAt && <span className={css.cardTime}>{timeAgo(record.updatedAt)}</span>}
          <button className={css.deleteBtn} type="button" aria-label={tt('card.delete')}
            onClick={(e) => { e.stopPropagation(); onDelete(record.caseId) }}>✕</button>
        </div>
      </div>
    </div>
  )
}

/** Procedure level dot color (mirrors AgentLex PROCEDURE_LEVEL_DOTS). */
function getLevelDot(level: string): string {
  const dots: Record<string, string> = {
    '一审': '#4a7ab5', '二审': '#7d6ab0', '再审': '#b0648a',
    '劳动仲裁': '#3a7d6b', '商事仲裁': '#2f7d77', '首次执行': '#4d7a4f', '恢复执行': '#2f7d77',
  }
  return dots[level] ?? '#a69a90'
}