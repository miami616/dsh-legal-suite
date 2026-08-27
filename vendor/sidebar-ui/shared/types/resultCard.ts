/**
 * Shared 成果卡 (result card) types — consumed by BOTH the sidecar (workflow/runbook
 * runtimes) and the renderer (RunbookResultsGroup / RunbookReportCard). Lives in
 * `src/shared/` so the process boundary doesn't duplicate the card protocol.
 *
 * Extracted from workflow.ts during the runbook productization: the card shapes
 * survived the workflow/playbook retirement because the runbook runtime reuses
 * the streaming-card pipeline and the `chat:workflow-card` event.
 */

// ─── Icon ───────────────────────────────────────────────

/** Icon hint for a 成果卡 header (fixed set the renderer maps to a glyph). */
export type PhaseResultCardIcon = 'law' | 'case' | 'doc' | 'search' | 'list' | 'table' | 'company';

// ─── Row & card ─────────────────────────────────────────

/**
 * One row in a 成果卡, mapped generically from a tool result via the step's
 * `resultCards` field spec. `title` is the headline; `meta` are inline chips
 * (条号 / 案号 / 法院 / 案由 / 日期…); `status` a small badge (时效性…);
 * `body` the long collapsible text (法条原文 / 裁判要旨…).
 */
export interface PhaseResultItem {
  title: string;
  meta?: string[];
  status?: string;
  body?: string;
}

export interface PhaseResultColumn {
  key: string;
  label: string;
}

/**
 * A streaming 成果卡 — the structured result of ONE retrieval tool call, sourced
 * DIRECTLY from the tool's return, normalized per the step's YAML `resultCards`
 * spec. Cards stream in mid-step as each tool completes; same-`label` cards merge.
 *
 * Two layouts: a list of `items` (default) OR a `table` (columns + rows) when the
 * spec declares `display: table`.
 */
export interface PhaseResultCard {
  label: string;       // "法律检索" / "案例检索" / …
  icon?: PhaseResultCardIcon;
  items: PhaseResultItem[];
  table?: { columns: PhaseResultColumn[]; rows: Record<string, string>[] };
  /**
   * Set when the retrieval tool RETURNED AN ERROR (auth failure, upstream 5xx,
   * quota) instead of data. A silent (`narration: silent`) retrieval step would
   * otherwise swallow the failure entirely — no text, no tool bubble, no card —
   * leaving the user staring at an empty step. When present, the renderer shows
   * a warning card instead of a results list. `items` is empty in this case.
   */
  error?: string;
}

// ─── Wire shape (chat:workflow-card SSE event) ──────────

/** Payload of `chat:workflow-card` — append one streaming result card to a step. */
export interface WorkflowCardPayload {
  /** The step/node id the card belongs to. */
  nodeId: string;
  /** Stable id (the tool-use id) so a re-emitted card replaces rather than dupes. */
  cardId: string;
  card: PhaseResultCard;
}

// ─── ResultCardSpec (structural interface shared by workflow & runbook schemas) ──

/**
 * Structural interface matching both the workflow's and runbook's
 * `ResultCardSpecSchema` zod schemas. The normalizer (result-cards.ts)
 * reads these fields; the zod schemas in both runtimes produce the same shape.
 */
export interface ResultCardSpec {
  match: {
    server?: string;
    tool?: string;
  };
  label: string;
  icon?: PhaseResultCardIcon;
  display?: 'list' | 'table';
  columns?: Array<{ key: string; label: string }>;
  fields?: {
    title: string[];
    meta?: string[];
    status?: string[];
    body?: string[];
  };
}
