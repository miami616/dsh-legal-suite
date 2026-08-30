/**
 * Project card — AgentLex Direction-B structure: left rail = mono project id +
 * type strip; right = type tag + name + status + rows (客户/负责人, 服务期, 服务范围)
 * + task progress + key-date chips + footer.
 */
import type { ProjectRecord } from '../../store/types.ts'
import { countTasks, daysUntil, timeAgo } from '../format.ts'
import { getProjectTypeDot, getStatusDef, projectTypeLabel } from '../project-taxonomy.ts'
import { tt } from '../i18n.ts'
import type { ProjectHealthView } from '../api.ts'
import css from '../board.module.css'

interface ProjectCardProps {
  record: ProjectRecord
  /** 项目体检结果（旁路数据，取不到时不显示完整度）。 */
  health?: ProjectHealthView
  onClick: () => void
  onDelete: (projectId: string) => void
}

export function ProjectCard({ record, health, onClick, onDelete }: ProjectCardProps): React.JSX.Element {
  const typeLabel = projectTypeLabel(record.projectType)
  const typeDot = getProjectTypeDot(record.projectType)
  const status = getStatusDef(record.status)
  const { total, done } = countTasks(record)

  const [idHead, idTail] = (() => {
    const dash = record.projectId.indexOf('-')
    return dash > 0 ? [record.projectId.slice(0, dash + 1), record.projectId.slice(dash + 1)] : ['', record.projectId]
  })()

  // upcoming key dates (soonest first, within the next 14 days)
  const upcoming = (record.keyDates ?? [])
    .filter((d) => d.date && !d.done && daysUntil(d.date) >= 0)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 2)

  const periodEnd = record.servicePeriod?.end

  return (
    <div className={css.card} role="button" tabIndex={0} onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}>
      {/* left rail */}
      <div className={css.cardRail}>
        <div className={css.cardId}>
          {idHead !== '' && <div className={css.cardIdHead}>{idHead}</div>}
          <div className={css.cardIdTail}>{idTail}</div>
        </div>
        <div className={css.cardTypeStrip}>
          <span className={css.cardTypeChip}>{typeLabel}</span>
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

        {(record.leadLawyer ?? '') !== '' && (
          <div className={css.row}>
            <span className={css.rowLabel}>{tt('card.lead')}</span>
            <span className={css.rowValue}>{record.leadLawyer}</span>
          </div>
        )}
        {(record.servicePeriod?.start || periodEnd) && (
          <div className={css.row}>
            <span className={css.rowLabel}>{tt('card.period')}</span>
            <span className={`${css.rowValueMuted} ${css.monoValue}`}>
              {record.servicePeriod?.start ?? ''} ~ {periodEnd ?? ''}
            </span>
            {periodEnd && daysUntil(periodEnd) > 0 && (
              <span className={daysUntil(periodEnd) <= 30 ? css.dateChipSoon : css.dateChipNeutral}>
                {tt('card.daysLeft', { n: String(daysUntil(periodEnd)) })}
              </span>
            )}
          </div>
        )}
        {(record.serviceScope ?? []).length > 0 && (
          <div className={css.row}>
            <span className={css.rowLabel}>{tt('card.scope')}</span>
            <span className={css.rowValueMuted}>{(record.serviceScope ?? []).slice(0, 3).join(' / ')}{(record.serviceScope ?? []).length > 3 ? ' …' : ''}</span>
          </div>
        )}

        <div className={css.cardFooter}>
          {upcoming.map((d) => {
            const days = daysUntil(d.date)
            const cls = days <= 3 ? css.dateChipUrgent : days <= 7 ? css.dateChipSoon : css.dateChipNeutral
            return (
              <span key={d.id} className={`${css.dateChip} ${cls}`} title={`${d.label} ${d.date}`}>
                <span className={css.dateChipMono}>{d.date.slice(5)}</span>
                <span className={css.dateChipText}>{d.label}</span>
                {days === 0 ? tt('card.today') : days === 1 ? tt('card.tomorrow') : tt('card.daysLater', { n: String(days) })}
              </span>
            )
          })}
          {total > 0 && <span className={css.taskStat}>✓ {done}/{total}</span>}
          {health !== undefined && health.completeness.gaps.length > 0 && (
            <span
              className={css.healthChip}
              title={`信息完整度 ${health.completeness.score}%（按「${health.statusLabel}」阶段计算）\n待补：${health.completeness.gaps.map((g) => g.label).join('、')}`}
            >
              <span className={css.healthChipBar} aria-hidden>
                <span className={css.healthChipFill} style={{ width: `${health.completeness.score}%` }} />
              </span>
              <span className={css.healthChipNum}>{health.completeness.score}%</span>
            </span>
          )}
          <span className={css.footerSpacer} />
          {record.updatedAt && <span className={css.cardTime}>{timeAgo(record.updatedAt)}</span>}
          <button className={css.deleteBtn} type="button" aria-label={tt('card.delete')}
            onClick={(e) => { e.stopPropagation(); onDelete(record.projectId) }}>✕</button>
        </div>
      </div>
    </div>
  )
}
