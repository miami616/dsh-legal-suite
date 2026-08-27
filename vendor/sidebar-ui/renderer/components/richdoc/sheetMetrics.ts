/** Cell range as SheetJS decode_range returns it (0-based, inclusive). */
export interface CellRange {
  s: { r: number; c: number };
  e: { r: number; c: number };
}

/**
 * Cap a sheet's render range to maxRows × maxCols so a 100k-row sheet doesn't
 * build a giant DOM. Returns whether it was truncated and the (possibly clamped)
 * range. Pure — extracted from SheetViewer so the cap math is unit-testable
 * without SheetJS.
 *
 * Bounds are INCLUSIVE: a range spanning N rows has `e.r - s.r === N-1`, so the
 * cap triggers at `>= maxRows` (i.e. N > maxRows) and clamps to keep exactly
 * maxRows rows from the start.
 */
export function clampSheetRange(
  range: CellRange,
  maxRows: number,
  maxCols: number,
): { truncated: boolean; range: CellRange } {
  const truncated = range.e.r - range.s.r >= maxRows || range.e.c - range.s.c >= maxCols;
  if (!truncated) return { truncated: false, range };
  return {
    truncated: true,
    range: {
      s: { ...range.s },
      e: {
        r: Math.min(range.e.r, range.s.r + maxRows - 1),
        c: Math.min(range.e.c, range.s.c + maxCols - 1),
      },
    },
  };
}
