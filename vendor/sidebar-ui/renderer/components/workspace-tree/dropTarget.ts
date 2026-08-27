import type { WorkspaceTreeNodeMeta } from "./treeTypes";

/**
 * Droppable id of the viewport-wide root zone: the `drop:` prefix with an
 * empty path (= the workspace root). Registered on the wrapper around the
 * whole tree viewport so dropping on blank space below the last row targets
 * the root — and so `over === null` can mean what it should mean: "pointer
 * left the tree entirely, don't drop anywhere".
 */
export const ROOT_DROP_ID = "drop:";

/**
 * Droppable id prefix for STICKY breadcrumb rows. They need their own
 * namespace because the ancestor's real row (`drop:<path>`) is still
 * registered while scrolled out of view, and dnd-kit ids must be unique.
 * The sticky bar visually owns the top of the viewport, so the panel's
 * collision detection lets sticky hits beat the rows hidden underneath —
 * without this, dropping "on the breadcrumb folder" landed in whatever
 * invisible row happened to sit behind the bar.
 */
export const STICKY_DROP_PREFIX = "sticky:";

/**
 * Droppable id prefix for the synthetic "empty folder" hint row — it stands
 * in for the (empty) directory it lives in, so drops on it land in that dir
 * rather than falling through to the viewport root zone.
 */
export const EMPTY_HINT_DROP_PREFIX = "empty:";

/** Extract the workspace-relative path from a `drop:` / `sticky:` / `empty:` id. */
export function parseDropId(overId: string | null): string | null {
  if (overId === null) return null;
  if (overId.startsWith(STICKY_DROP_PREFIX)) {
    return overId.slice(STICKY_DROP_PREFIX.length);
  }
  if (overId.startsWith(EMPTY_HINT_DROP_PREFIX)) {
    return overId.slice(EMPTY_HINT_DROP_PREFIX.length);
  }
  if (!overId.startsWith("drop:")) return null;
  return overId.slice("drop:".length);
}

function parentDirOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx > 0 ? path.slice(0, idx) : "";
}

/**
 * Resolve the target directory for an EXTERNAL drag (OS files / browser
 * File objects) hovering or dropping on a tree element, identified by the
 * `data-tree-path` attribute under the pointer. Same semantics as the
 * internal resolver minus the source guards (external items have no source
 * inside the tree): dir → itself, file → its parent dir, blank / unknown →
 * workspace root.
 */
export function resolveExternalDropDir(
  pathAttr: string | null,
  nodeMetaByPath: ReadonlyMap<string, WorkspaceTreeNodeMeta>,
): string {
  if (!pathAttr) return "";
  const meta = nodeMetaByPath.get(pathAttr);
  if (!meta) return "";
  return meta.data.type === "dir" ? pathAttr : (meta.parentPath ?? "");
}

/**
 * Resolve the EFFECTIVE target directory of an internal tree drag, VS Code
 * style. Pure — the component feeds it `event.over.id` and the current node
 * meta map; the result drives both the highlight and the eventual move.
 *
 * Rules:
 *  - `null` over id (pointer outside the tree)            → null (no drop)
 *  - root zone id                                          → "" (workspace root)
 *  - over a directory row                                  → that directory
 *  - over a FILE row                                       → the file's parent
 *    directory (dropping "on a file" means "into where that file lives" —
 *    pre-fix this fell through to the root and silently moved items there)
 *  - over a row that no longer exists in the tree          → null
 *  - target is one of the sources / inside a dragged dir   → null
 *  - every dragged item already sits directly in target    → null (no-op —
 *    suppressing it here also suppresses the misleading highlight)
 */
export function resolveInternalDropTarget(
  overId: string | null,
  sourcePaths: readonly string[],
  nodeMetaByPath: ReadonlyMap<string, WorkspaceTreeNodeMeta>,
): string | null {
  const overPath = parseDropId(overId);
  if (overPath === null) return null;

  let targetDir: string;
  if (overPath === "") {
    targetDir = "";
  } else {
    const meta = nodeMetaByPath.get(overPath);
    if (!meta) return null;
    targetDir =
      meta.data.type === "dir" ? overPath : (meta.parentPath ?? "");
  }

  for (const src of sourcePaths) {
    if (src === targetDir) return null;
    if (targetDir.startsWith(`${src}/`)) return null;
  }
  if (
    sourcePaths.length > 0 &&
    sourcePaths.every((p) => parentDirOf(p) === targetDir)
  ) {
    return null;
  }
  return targetDir;
}
