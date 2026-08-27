/**
 * Spreadsheet read-only viewer (SheetJS CE) — handles `.xlsx` AND legacy `.xls`
 * (SheetJS auto-detects the format from the bytes).
 *
 * Parses to per-sheet HTML tables with a row/col cap (PRD 0.2.20 §5) so a
 * 100k-row sheet doesn't build a giant DOM. `sheet_to_html` HTML-escapes cell
 * content; the host's external-resource guard covers any residual resource ref.
 *
 * Parsing is a pure `useMemo` (synchronous — ≤25MB cap bounds the cost). Errors,
 * including an empty/unreadable workbook, are reported up via `onError` in an
 * effect (never a parent setState mid-render) so they degrade to the unified
 * "open with default app" fallback instead of a blank screen.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as XLSX from 'xlsx';
import { clampSheetRange } from './sheetMetrics';
import type { RichDocSubViewerProps } from './types';

// Caps keep the injected DOM bounded. Beyond these the user opens externally.
const MAX_ROWS = 2000;
const MAX_COLS = 100;

interface SheetData {
  name: string;
  html: string;
  truncated: boolean;
}

export default function SheetViewer({ bytes, onError, onEmpty }: RichDocSubViewerProps) {
  const { t } = useTranslation('app');
  // Parse purely in render — RichDocViewer keys this by path, so a file switch
  // remounts (recomputes) and resets `active` to 0 for free. Parse errors are
  // surfaced via an effect (not during render) so we never call a parent setter
  // mid-render.
  const parsed = useMemo<{ sheets: SheetData[] | null; error: string | null; empty: boolean }>(() => {
    try {
      // Uint8Array view; SheetJS reads (does not detach) the buffer.
      // Perf for big sheets (read-only HTML preview):
      //  - `sheetRows: MAX_ROWS + 1` truncates at PARSE time (not after) — the +1
      //    lets us still detect "there were more rows" to show the truncation note.
      //  - `dense` is faster + lighter for large grids (sheet_to_html supports it).
      //  - `cellFormula`/`cellHTML` are on by default but unused in a value-only
      //    preview; `cellText` stays default so dates/currency keep their display.
      const wb = XLSX.read(new Uint8Array(bytes), {
        type: 'array',
        sheetRows: MAX_ROWS + 1,
        dense: true,
        cellFormula: false,
        cellHTML: false,
      });
      if (wb.SheetNames.length === 0) {
        return { sheets: null, error: null, empty: true };
      }
      const sheets: SheetData[] = wb.SheetNames.map((name) => {
        const ws = wb.Sheets[name];
        let truncated = false;
        const ref = ws['!ref'];
        if (ref) {
          const clamped = clampSheetRange(XLSX.utils.decode_range(ref), MAX_ROWS, MAX_COLS);
          truncated = clamped.truncated;
          if (clamped.truncated) ws['!ref'] = XLSX.utils.encode_range(clamped.range);
        }
        return { name, html: XLSX.utils.sheet_to_html(ws, { editable: false }), truncated };
      });
      return { sheets, error: null, empty: false };
    } catch (e) {
      return { sheets: null, error: e instanceof Error ? e.message : t('richDoc.sheetParseFailed'), empty: false };
    }
  }, [bytes, t]);

  const [active, setActive] = useState(0);

  useEffect(() => {
    if (parsed.error) onError(parsed.error);
    else if (parsed.empty) onEmpty();
  }, [parsed, onError, onEmpty]);

  const sheets = parsed.sheets;
  if (!sheets || sheets.length === 0) return null; // error reported via effect above
  const current = sheets[Math.min(active, sheets.length - 1)];

  return (
    <div className="flex h-full flex-col bg-[var(--paper-elevated)]">
      <div className="flex-1 overflow-auto overscroll-contain p-3">
        {current.truncated && (
          <div className="mb-2 rounded-[var(--radius-sm)] bg-[var(--paper-inset)] px-3 py-1.5 text-xs text-[var(--ink-muted)]">
            {t('richDoc.sheetTruncated', { rows: MAX_ROWS, cols: MAX_COLS })}
          </div>
        )}
        <div
          className="inline-block [&_table]:border-collapse [&_table]:text-sm [&_table]:text-[var(--ink)] [&_td]:border [&_td]:border-[var(--line)] [&_td]:px-2 [&_td]:py-1 [&_td]:align-top [&_th]:border [&_th]:border-[var(--line)] [&_th]:bg-[var(--paper-inset)] [&_th]:px-2 [&_th]:py-1"
          dangerouslySetInnerHTML={{ __html: current.html }}
        />
      </div>
      {sheets.length > 1 && (
        <div className="flex flex-shrink-0 items-center gap-1 overflow-x-auto border-t border-[var(--line)] bg-[var(--paper-elevated)] px-2 py-1.5">
          {sheets.map((s, i) => (
            <button
              key={s.name}
              type="button"
              onClick={() => setActive(i)}
              className={`flex-shrink-0 rounded-[var(--radius-sm)] px-2.5 py-1 text-xs font-medium transition-colors ${
                i === active
                  ? 'bg-[var(--paper-inset)] text-[var(--ink)]'
                  : 'text-[var(--ink-muted)] hover:text-[var(--ink)]'
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
