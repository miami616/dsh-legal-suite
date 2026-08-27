/**
 * caseTimeline — pure disk-contract mappers for timeline events.
 *
 * The Rust command `cmd_agentlex_add_timeline_event` requires a `title` param
 * (Tauri auto-converts camelCase↔snake_case, but NOT label→title), and the
 * stored event on disk is keyed `title` — the frontend TimelineEvent uses
 * `label` (see `normalizeTimelineEvent` reading `raw.title ?? raw.label`).
 *
 * These mappers bridge that gap so the UI never sends `label` to the disk
 * boundary. Pinned by `caseTimeline.test.ts` so a future merge can't reintroduce
 * the 2026-08-02 "添加日程 写盘失败 / 编辑标签不生效" bugs.
 */

/** Structural subset of the frontend TimelineEvent (no hooks import, no cycle). */
export interface TimelineEventLike {
  caseId?: string;
  caseName?: string;
  label: string;
  date: string;
  time?: string | null;
  type: string;
  status?: string;
  source?: string;
  remindRules?: unknown;
  createdBy?: string;
  completedAt?: string | null;
}

/** Drop undefined keys so the wire payload stays clean for the Rust merge. */
function defined(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Payload for `cmd_agentlex_add_timeline_event` — maps label→title, no label key. */
export function timelineEventToAddPayload(evt: TimelineEventLike): Record<string, unknown> {
  return defined({
    caseId: evt.caseId,
    caseName: evt.caseName,
    eventType: evt.type,
    title: evt.label,
    date: evt.date,
    time: evt.time ?? null,
    source: evt.source,
    remindRules: evt.remindRules,
    createdBy: evt.createdBy,
    status: evt.status,
  });
}

/**
 * Patch for `cmd_agentlex_update_timeline_event`. Maps label→title and omits
 * `label`/`id`/`createdAt`/`createdBy` — the stored event holds `title`, so once
 * `title` is updated the edit displays on next read (`title` wins over `label`).
 */
export function timelineEventToUpdatePatch(updated: TimelineEventLike): Record<string, unknown> {
  return defined({
    title: updated.label,
    date: updated.date,
    time: updated.time,
    type: updated.type,
    status: updated.status,
    source: updated.source,
    remindRules: updated.remindRules,
    completedAt: updated.completedAt,
  });
}
