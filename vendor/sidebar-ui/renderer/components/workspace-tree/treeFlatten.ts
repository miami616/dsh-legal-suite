import type { DirectoryTreeNode } from "../../../shared/dir-types";

import type {
  StickyAncestor,
  TreeEditingState,
  TreeListItem,
  VisibleTreeRow,
  WorkspaceTreeNodeMeta,
} from "./treeTypes";
import { parentDirOfPath, stickyParentPathOf } from "./treeTypes";

export function buildWorkspaceNodeMetaByPath(
  nodes: DirectoryTreeNode[],
  depth = 0,
  parentPath: string | null = null,
  map = new Map<string, WorkspaceTreeNodeMeta>(),
): Map<string, WorkspaceTreeNodeMeta> {
  for (const node of nodes) {
    map.set(node.path, { data: node, depth, parentPath });
    if (node.type === "dir" && node.children?.length) {
      buildWorkspaceNodeMetaByPath(node.children, depth + 1, node.path, map);
    }
  }
  return map;
}

export function buildVisibleTreeRows(
  nodes: DirectoryTreeNode[],
  openPaths: ReadonlySet<string>,
  loadingPaths: ReadonlySet<string>,
  selectedPaths: ReadonlySet<string>,
  depth = 0,
  parentPath: string | null = null,
  rows: VisibleTreeRow[] = [],
): VisibleTreeRow[] {
  for (const node of nodes) {
    const isDir = node.type === "dir";
    const isOpen = isDir && openPaths.has(node.path);
    rows.push({
      data: node,
      depth,
      isDir,
      isLoading: loadingPaths.has(node.path),
      isOpen,
      isSelected: selectedPaths.has(node.path),
      parentPath,
      path: node.path,
    });
    if (isDir && isOpen && node.children?.length) {
      buildVisibleTreeRows(
        node.children,
        openPaths,
        loadingPaths,
        selectedPaths,
        depth + 1,
        node.path,
        rows,
      );
    }
  }
  return rows;
}

export function buildVisibleRangeSelection(
  visibleRows: VisibleTreeRow[],
  anchorPath: string,
  targetPath: string,
): string[] {
  const startIdx = visibleRows.findIndex((row) => row.path === anchorPath);
  const endIdx = visibleRows.findIndex((row) => row.path === targetPath);
  if (startIdx === -1 || endIdx === -1) {
    return [targetPath];
  }
  const [from, to] =
    startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
  return visibleRows.slice(from, to + 1).map((row) => row.path);
}

export function buildStickyAncestors(
  items: readonly TreeListItem[],
  nodeMetaByPath: ReadonlyMap<string, WorkspaceTreeNodeMeta>,
  firstVisibleIndex: number,
  scrollTop: number,
  maxDepth: number,
): StickyAncestor[] {
  if (scrollTop <= 0 || firstVisibleIndex <= 0) {
    return [];
  }

  // Clamp to the last item instead of bailing: the overlay-model probe
  // (`topUnits + count`) can overshoot the list near the scroll bottom
  // when the viewport is only a few rows tall. Bailing to `[]` there makes
  // the fixed-point iteration oscillate between `[]` and an n-deep stack at
  // every row boundary (visible as per-row breadcrumb flicker); clamping
  // means "use the last row's ancestors" — which is also the correct VS Code
  // semantics for a bottom-pinned view.
  const item = items[Math.min(firstVisibleIndex, items.length - 1)];
  if (!item) {
    return [];
  }

  const ancestors: StickyAncestor[] = [];
  let parentPath = stickyParentPathOf(item);
  while (parentPath && ancestors.length < maxDepth) {
    const meta = nodeMetaByPath.get(parentPath);
    if (!meta) {
      break;
    }
    ancestors.unshift({
      depth: meta.depth,
      id: meta.data.id,
      name: meta.data.name,
      path: parentPath,
    });
    parentPath = meta.parentPath;
  }
  return ancestors;
}

/**
 * Assemble what the virtual list renders: the visible tree rows plus
 * synthetic rows —
 *  - the inline editor row (rename replaces its node IN PLACE; create is
 *    inserted as the first child of its parent dir, or at the very top for
 *    the root), and
 *  - an "empty folder" hint row under every open, fully-loaded, empty dir
 *    (suppressed while the inline editor is creating inside that dir —
 *    the editor takes its place).
 */
export function buildTreeListItems(
  visibleRows: readonly VisibleTreeRow[],
  editing: TreeEditingState | null,
): TreeListItem[] {
  const items: TreeListItem[] = [];
  const creatingIn =
    editing && editing.mode !== "rename" ? editing.parentDir : null;

  // Synthetic keys use a `:`-namespace — `:` is rejected by
  // `validate_item_name` on both sides, so no real path can ever collide
  // with these in Virtuoso's computeItemKey.
  const EDIT_KEY = "synthetic:edit";

  if (creatingIn === "") {
    items.push({ kind: "edit", key: EDIT_KEY, depth: 0, editing: editing! });
  }

  for (const row of visibleRows) {
    if (editing?.mode === "rename" && row.path === editing.path) {
      items.push({
        kind: "edit",
        key: EDIT_KEY,
        depth: row.depth,
        editing,
      });
      continue;
    }
    items.push({ kind: "node", key: row.path, row });

    if (row.isDir && row.isOpen) {
      if (creatingIn === row.path) {
        items.push({
          kind: "edit",
          key: EDIT_KEY,
          depth: row.depth + 1,
          editing: editing!,
        });
      } else if (
        row.data.loaded !== false &&
        (row.data.children?.length ?? 0) === 0 &&
        !row.isLoading
      ) {
        items.push({
          kind: "empty-hint",
          key: `synthetic:empty:${row.path}`,
          depth: row.depth + 1,
          parentDir: row.path,
        });
      }
    }
  }
  return items;
}

/**
 * VS Code-style sticky "push" transition, as a pure function of the RAW
 * scroll position. When the next row unit resolves to a SHALLOWER breadcrumb
 * (the deepest sticky folder's subtree is ending), the bar slides up by the
 * sub-row scroll fraction × the depth delta, so exiting rows are pushed out
 * smoothly instead of popping at the boundary. Returns the upward translate
 * in px (0 when no transition is in progress).
 *
 * Designed to be called from the scroll handler and written to a CSS
 * variable — it must NOT enter React state (that would re-render per pixel,
 * defeating the row-quantized `topUnits` state).
 */
export function computeStickyPushPx(
  rawScrollTop: number,
  rowHeight: number,
  countAtUnit: (unit: number) => number,
): number {
  if (rawScrollTop <= 0 || rowHeight <= 0) return 0;
  const unit = Math.floor(rawScrollTop / rowHeight);
  const frac = (rawScrollTop - unit * rowHeight) / rowHeight;
  if (frac <= 0) return 0;
  const current = countAtUnit(unit);
  if (current <= 0) return 0;
  const next = countAtUnit(unit + 1);
  if (next >= current) return 0;
  const push = frac * rowHeight * (current - next);
  return Math.min(Math.round(push), current * rowHeight);
}

/** Re-export for callers that need the same parent-dir derivation. */
export { parentDirOfPath };

/**
 * Maximum number of stacked sticky-ancestor rows. The viewport reserves a
 * CONSTANT `MAX_STICKY_ANCESTOR_DEPTH * rowHeight` footer at the scroll bottom
 * so `maxScroll` never moves (the breadcrumb stays flicker-free at the bottom)
 * AND the last rows can scroll clear of the overlay bar — see
 * `resolveStickyAncestors` and `WorkspaceTreeViewport`. The model's
 * `buildStickyAncestors` cap MUST use the same value.
 */
export const MAX_STICKY_ANCESTOR_DEPTH = 3;

/**
 * Resolve the sticky breadcrumb as a PURE FUNCTION of `scrollTop`,
 * OVERLAY model (VS Code sticky-scroll semantics).
 *
 * The breadcrumb bar floats OVER the scroll content and occupies no scroll
 * space. This is load-bearing for two scroll-stability properties:
 *
 *  1. No content jump at depth boundaries. The previous header-spacer model
 *     inserted a `count * rowHeight` spacer into the scroll content so the
 *     bar never covered a row — but every time `count` changed mid-scroll the
 *     spacer resized and the WHOLE list visually jumped by ±rowHeight (the
 *     "sticky跳动" bug). With an overlay nothing in the scroll content ever
 *     resizes, so rows never shift; the bar simply covers the top `count`
 *     rows, exactly like VS Code.
 *
 *  2. No scroll↔layout feedback loop at the bottom. The scroll content height
 *     is constant (rows + constant footer), so `maxScroll` never moves and
 *     `scrollTop` is a stable input.
 *
 * Derivation: with the bar covering `count` rows, the row at the bar's bottom
 * edge is `floor(scrollTop / rowHeight) + count`. That's circular in `count`,
 * but `count` is bounded by `maxDepth`, so we resolve it by fixed-point
 * iteration in at most `maxDepth + 1` steps. Even at a depth boundary where no
 * exact fixed point exists, the final value is a deterministic function of
 * `scrollTop`, so the result is identical across renders → no oscillation.
 *
 * `ancestorsAt(firstVisibleIndex)` is the per-index ancestor walker (the model's
 * `getStickyAncestors` bound to the current `scrollTop`).
 */
export function resolveStickyAncestors(
  scrollTop: number,
  rowHeight: number,
  maxDepth: number,
  ancestorsAt: (firstVisibleIndex: number) => StickyAncestor[],
): StickyAncestor[] {
  if (scrollTop <= 0 || rowHeight <= 0) {
    return [];
  }
  const topUnits = Math.floor(scrollTop / rowHeight);
  let count = 0;
  let ancestors: StickyAncestor[] = [];
  for (let step = 0; step <= maxDepth; step += 1) {
    const firstVisibleIndex = topUnits + count;
    ancestors = ancestorsAt(firstVisibleIndex);
    if (ancestors.length === count) {
      return ancestors;
    }
    count = ancestors.length;
  }
  return ancestors;
}
