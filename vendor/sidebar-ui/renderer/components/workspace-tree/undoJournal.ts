import { parentDirOfPath } from "./treeTypes";

/**
 * In-app undo journal for REVERSIBLE tree mutations (move / rename / paste /
 * create). Deletes are NOT journaled — they go to the OS trash, where
 * Finder/Explorer own restoration. Pure data + plan-building here; the
 * component executes plans through the file service.
 */
export type UndoableOp =
  | { kind: "move"; moves: Array<{ from: string; to: string }> }
  | { kind: "rename"; from: string; to: string }
  /** Freshly created items (新建笔记/文件/文件夹) — undo trashes them. */
  | { kind: "create"; paths: string[] }
  /** Paste-copies — undo trashes the copies (originals untouched). */
  | { kind: "copy"; createdPaths: string[] };

export type UndoPlanStep =
  | {
      op: "move";
      /** Current (post-op) workspace-relative path to move back. */
      sourcePath: string;
      /** Directory it returns to. */
      targetDir: string;
      /** Name it should end up with (auto-rename on the forward move may
       *  have changed the basename; executor renames after moving when the
       *  landed name differs). */
      desiredName: string;
    }
  | { op: "rename"; path: string; newName: string }
  | { op: "delete"; path: string };

export function buildUndoPlan(entry: UndoableOp): UndoPlanStep[] {
  switch (entry.kind) {
    case "move":
      // Reverse order — deterministic, and safe if a future forward op ever
      // produces dependent moves.
      return [...entry.moves].reverse().map(({ from, to }) => ({
        op: "move",
        sourcePath: to,
        targetDir: parentDirOfPath(from),
        desiredName: baseNameOf(from),
      }));
    case "rename":
      // MUST be a rename primitive, not a same-dir move: `cmd_workspace_move`
      // skips "already in target dir" as a no-op, so a move-based reversal
      // would silently do nothing.
      return [{ op: "rename", path: entry.to, newName: baseNameOf(entry.from) }];
    case "create":
      return entry.paths.map((path) => ({ op: "delete", path }));
    case "copy":
      return entry.createdPaths.map((path) => ({ op: "delete", path }));
  }
}

export function baseNameOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(idx + 1) : path;
}

export const UNDO_JOURNAL_CAP = 20;

/** Push with cap — returns a NEW array (state-friendly). */
export function pushUndoEntry(
  journal: readonly UndoableOp[],
  entry: UndoableOp,
): UndoableOp[] {
  const next = [...journal, entry];
  return next.length > UNDO_JOURNAL_CAP
    ? next.slice(next.length - UNDO_JOURNAL_CAP)
    : next;
}
