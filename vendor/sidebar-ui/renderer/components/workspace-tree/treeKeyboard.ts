import type { VisibleTreeRow } from "./treeTypes";

/**
 * Pure key→action resolver for the workspace tree (VS Code Explorer
 * semantics). The component executes the returned action; everything
 * decidable from (key, focus, rows) is decided here so it's unit-testable.
 */
export type TreeKeyAction =
  | { type: "focus"; path: string; extendSelection: boolean }
  | { type: "collapse"; path: string }
  | { type: "expand"; path: string }
  | { type: "activate"; path: string }
  | { type: "rename"; path: string }
  | { type: "delete" }
  | { type: "select-all" }
  | { type: "copy" }
  | { type: "cut" }
  | { type: "paste" }
  | { type: "undo" }
  | { type: "type-ahead"; char: string };

export interface TreeKeyInput {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export interface TreeKeyContext {
  rows: readonly VisibleTreeRow[];
  focusedPath: string | null;
  isOpen: (path: string) => boolean;
}

function rowIndexOf(rows: readonly VisibleTreeRow[], path: string | null): number {
  if (path === null) return -1;
  return rows.findIndex((r) => r.path === path);
}

export function resolveTreeKeyAction(
  input: TreeKeyInput,
  ctx: TreeKeyContext,
): TreeKeyAction | null {
  const { rows, focusedPath } = ctx;
  const cmd = input.metaKey || input.ctrlKey;

  if (cmd) {
    switch (input.key.toLowerCase()) {
      case "a":
        return { type: "select-all" };
      case "c":
        return { type: "copy" };
      case "x":
        return { type: "cut" };
      case "v":
        return { type: "paste" };
      case "z":
        return input.shiftKey ? null : { type: "undo" };
      case "backspace":
        return { type: "delete" };
      default:
        return null;
    }
  }

  if (rows.length === 0) return null;
  const idx = rowIndexOf(rows, focusedPath);
  const focused = idx >= 0 ? rows[idx] : null;

  switch (input.key) {
    case "ArrowDown": {
      const next = idx < 0 ? rows[0] : rows[Math.min(idx + 1, rows.length - 1)];
      return { type: "focus", path: next.path, extendSelection: input.shiftKey };
    }
    case "ArrowUp": {
      const next = idx < 0 ? rows[rows.length - 1] : rows[Math.max(idx - 1, 0)];
      return { type: "focus", path: next.path, extendSelection: input.shiftKey };
    }
    case "Home":
      return { type: "focus", path: rows[0].path, extendSelection: input.shiftKey };
    case "End":
      return {
        type: "focus",
        path: rows[rows.length - 1].path,
        extendSelection: input.shiftKey,
      };
    case "ArrowLeft": {
      if (!focused) return null;
      if (focused.isDir && ctx.isOpen(focused.path)) {
        return { type: "collapse", path: focused.path };
      }
      // Closed dir or file → focus the parent dir (VS Code).
      return focused.parentPath
        ? { type: "focus", path: focused.parentPath, extendSelection: false }
        : null;
    }
    case "ArrowRight": {
      if (!focused || !focused.isDir) return null;
      if (!ctx.isOpen(focused.path)) {
        return { type: "expand", path: focused.path };
      }
      // Open dir → focus first child if any.
      const next = rows[idx + 1];
      return next && next.parentPath === focused.path
        ? { type: "focus", path: next.path, extendSelection: false }
        : null;
    }
    case "Enter":
    case " ":
      return focused ? { type: "activate", path: focused.path } : null;
    case "F2":
      return focused ? { type: "rename", path: focused.path } : null;
    case "Delete":
      return { type: "delete" };
    default: {
      // Type-ahead: single printable character without modifiers.
      if (input.key.length === 1 && !input.altKey && input.key !== " ") {
        return { type: "type-ahead", char: input.key };
      }
      return null;
    }
  }
}

/**
 * Type-ahead jump: find the next row (after the focused one, wrapping)
 * whose name starts with `buffer`, case-insensitive. Returns null when
 * nothing matches.
 */
export function findTypeAheadTarget(
  rows: readonly VisibleTreeRow[],
  focusedPath: string | null,
  buffer: string,
): string | null {
  if (rows.length === 0 || buffer.length === 0) return null;
  const needle = buffer.toLowerCase();
  const start = rowIndexOf(rows, focusedPath);
  for (let step = 1; step <= rows.length; step += 1) {
    const row = rows[(start + step) % rows.length];
    if (row.data.name.toLowerCase().startsWith(needle)) {
      return row.path;
    }
  }
  return null;
}
