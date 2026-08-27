/**
 * EventForm — inline add/edit form for a case timeline event.
 *
 * Writes through the store's addTimelineEvent / updateTimelineEvent (which route
 * to cmd_agentlex_add/update_timeline_event). Used by the 关键日程 card for
 * future nodes and by the timeline for historical events.
 */
import { memo, useState } from 'react';
import CustomSelect from '@/components/CustomSelect';
import type { TimelineEvent, TimelineEventType, TimelineEventStatus } from '@/hooks/useAgentLex';

export const EVENT_TYPE_OPTS: { value: TimelineEventType; label: string }[] = [
  { value: 'hearing', label: '开庭' },
  { value: 'evidence_deadline', label: '举证期限' },
  { value: 'defense_deadline', label: '答辩期' },
  { value: 'appeal_deadline', label: '上诉期' },
  { value: 'retrial_deadline', label: '再审期' },
  { value: 'filing_deadline', label: '起诉/立案期限' },
  { value: 'limitation_expiry', label: '时效/审限届满' },
  { value: 'filing', label: '起诉/立案' },
  { value: 'service', label: '送达' },
  { value: 'court_notice', label: '法院通知' },
  { value: 'arbitration', label: '仲裁' },
  { value: 'meeting', label: '会议/面谈' },
  { value: 'case_event', label: '其他节点' },
];

export interface EventFormData {
  label: string;
  date: string;
  time?: string;
  type: TimelineEventType;
  status: TimelineEventStatus;
  remindDays?: number;
}

interface EventFormProps {
  initial?: TimelineEvent;
  onSubmit: (data: EventFormData) => void;
  onCancel: () => void;
  /** For a past-dated event the caller may want to keep it completed. */
  defaultStatus?: TimelineEventStatus;
}

export default memo(function EventForm({ initial, onSubmit, onCancel, defaultStatus = 'pending' }: EventFormProps) {
  const [label, setLabel] = useState(initial?.label ?? '');
  const [date, setDate] = useState(initial?.date ?? new Date().toISOString().slice(0, 10));
  const [time, setTime] = useState(initial?.time ?? '');
  const [type, setType] = useState<TimelineEventType>(initial?.type ?? 'hearing');
  const [remindDays, setRemindDays] = useState(() => {
    const rule = initial?.remindRules?.[0];
    return rule?.type === 'before_event' && rule.minutes && rule.minutes % 1440 === 0
      ? String(rule.minutes / 1440)
      : '';
  });

  const canSubmit = label.trim() !== '' && date.trim() !== '';

  return (
    <div className="space-y-2.5 p-3 rounded-xl bg-[var(--paper)] border border-[var(--paper-inset)]">
      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2">
          <input type="text" value={label} onChange={e => setLabel(e.target.value)} autoFocus
            placeholder="事件标题（如：第一次开庭）" className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--paper-elevated)] text-sm text-[var(--ink)] placeholder:text-[var(--ink-subtle)] outline-none ring-1 ring-[var(--paper-inset)] focus:ring-[var(--ink-subtle)]" />
        </div>
        <div>
          <span className="text-xs text-[var(--ink-muted)]">日期</span>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--paper-elevated)] text-sm text-[var(--ink)] outline-none ring-1 ring-[var(--paper-inset)] focus:ring-[var(--ink-subtle)]" />
        </div>
        <div>
          <span className="text-xs text-[var(--ink-muted)]">时间（可选）</span>
          <input type="time" value={time} onChange={e => setTime(e.target.value)}
            className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--paper-elevated)] text-sm text-[var(--ink)] outline-none ring-1 ring-[var(--paper-inset)] focus:ring-[var(--ink-subtle)]" />
        </div>
        <div>
          <span className="text-xs text-[var(--ink-muted)]">类型</span>
          <CustomSelect size="sm" value={type}
            options={EVENT_TYPE_OPTS.map(o => ({ value: o.value, label: o.label }))}
            onChange={v => setType(v as TimelineEventType)} />
        </div>
        <div>
          <span className="text-xs text-[var(--ink-muted)]">提前提醒（天，可选）</span>
          <input type="number" min={0} value={remindDays} onChange={e => setRemindDays(e.target.value)} placeholder="7"
            className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--paper-elevated)] text-sm text-[var(--ink)] placeholder:text-[var(--ink-subtle)] outline-none ring-1 ring-[var(--paper-inset)] focus:ring-[var(--ink-subtle)]" />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="px-2.5 py-1 rounded text-xs text-[var(--ink-muted)] hover:bg-[var(--paper-inset)]">取消</button>
        <button disabled={!canSubmit} onClick={() => onSubmit({
          label: label.trim(), date, time: time || undefined,
          type, status: defaultStatus, remindDays: remindDays ? Number(remindDays) : undefined,
        })}
          className="px-3 py-1 rounded text-xs font-medium bg-[var(--ink)] text-[var(--paper)] hover:opacity-90 disabled:opacity-40">
          {initial ? '保存' : '添加'}
        </button>
      </div>
    </div>
  );
});
