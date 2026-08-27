// Tree merge + frontier re-fetch utilities for DirectoryPanel refresh.
//
// Background: `cmd_workspace_dir_tree` caps depth at 4 and `cmd_workspace_dir_expand`
// caps depth at 3. So the renderer's `directoryInfo` is built incrementally:
// dirTree() returns the depth-4 skeleton; user expansion of a depth-5+ folder
// triggers dirExpand() which patches that sub-tree into `directoryInfo`. A naive
// "replace whole tree on refresh" wipes those patches and the visual tree
// collapses every time the fs watcher / tool-complete / 120s polling fires.
//
// This module provides the pieces to refresh non-destructively: keep stale lazy
// children as a fallback so the UI stays continuous, then re-fetch the frontier
// the user actually expanded so the visible state is fresh.

import type {
  DirectoryTreeNode,
  ExpandDirectoryResult,
} from "../../../shared/dir-types";

/**
 * Map of `dirExpand` results keyed by path, ready for `applyChildrenMap`.
 * Re-using the shared `ExpandDirectoryResult` type means a future Rust-side
 * schema change (extra fields on the response) surfaces as a TS error at
 * the call sites that destructure the result, not as silent data loss.
 */
export type ChildrenUpdates = ReadonlyMap<string, ExpandDirectoryResult>;

/**
 * Merge an old (possibly lazy-loaded) tree node into a new one fetched fresh.
 *
 * Rules:
 *  1. New `loaded:false` + old has loaded children (`loaded !== false` AND
 *     `children` defined)             → carry old children, mark loaded.
 *     The new fetch capped at the depth boundary; without this the
 *     previously expanded sub-tree would render as collapsed until
 *     `collectFreshUpdates` re-fetches it.
 *  2. Both sides have `children`      → recurse by path. Preserves
 *     deeper lazy patches inside an otherwise-fresh sub-tree. Returns
 *     the new node reference when no descendant actually changed, so
 *     downstream React-state comparisons stay cheap.
 *  3. Otherwise                       → return new as-is.
 *
 * Case 1 deliberately does NOT fire when the new node is `loaded:true` with
 * empty children — that means the dir was emptied on disk; carrying old
 * children would resurrect deleted files.
 *
 * Note: `DirectoryTreeNode.loaded` is typed `boolean | undefined` where
 * `true | undefined` both mean "fully loaded" per the type doc. Using
 * `!== false` keeps Case 1 robust if the Rust serialization ever omits
 * the flag for loaded dirs.
 */
export function mergeLazyChildren(
  newNode: DirectoryTreeNode,
  oldNode: DirectoryTreeNode | undefined,
): DirectoryTreeNode {
  if (!oldNode) return newNode;
  if (newNode.type !== "dir" || oldNode.type !== "dir") return newNode;

  if (
    newNode.loaded === false &&
    oldNode.loaded !== false &&
    oldNode.children !== undefined
  ) {
    return { ...newNode, children: oldNode.children, loaded: true };
  }

  if (newNode.children && oldNode.children) {
    const oldByPath = new Map(oldNode.children.map((c) => [c.path, c]));
    let changed = false;
    const nextChildren = newNode.children.map((nc) => {
      const merged = mergeLazyChildren(nc, oldByPath.get(nc.path));
      if (merged !== nc) changed = true;
      return merged;
    });
    if (!changed) return newNode;
    return { ...newNode, children: nextChildren };
  }

  return newNode;
}

/**
 * Structural equality over the *displayed* tree.
 *
 * `DirectoryTreeNode` carries only display fields (`id` / `name` / `path` /
 * `type` / `children` / `loaded`) — no mtime, size, or content. So two scans
 * of an unchanged tree are deeply equal here, while any displayed difference
 * (a file added / removed / renamed, a dir's `loaded` boundary moving, or
 * children reordering — `cmd_workspace_dir_tree` sorts deterministically) makes
 * them unequal.
 *
 * This makes DirectoryPanel's refresh idempotent. `dirTree()` allocates fresh
 * objects on every call, and `mergeLazyChildren` returns the *fresh* node when
 * nothing needed carrying — so a no-op refresh (the fs watcher firing on a
 * file-content edit, `.git`/temp churn, a change inside a collapsed subtree,
 * the 120s safety poll, or a tool-complete bump) would otherwise commit a
 * brand-new `directoryInfo` identity, rebuild `visibleRows`, and force
 * react-virtuoso to reconcile a byte-identical list — the visible "flicker".
 * The caller compares the merged tree against the previously-committed one and
 * keeps the old reference when they're equal, so React bails out entirely.
 *
 * `loaded` is normalized: `true` and `undefined` both mean "fully loaded" per
 * the field's type doc, so they compare equal.
 */
export function treeNodeEqual(
  a: DirectoryTreeNode,
  b: DirectoryTreeNode,
): boolean {
  if (a === b) return true;
  if (
    a.path !== b.path ||
    a.type !== b.type ||
    a.name !== b.name ||
    a.id !== b.id
  ) {
    return false;
  }
  // `true | undefined` both mean "loaded"; only `false` is "not loaded".
  if ((a.loaded !== false) !== (b.loaded !== false)) return false;

  const ac = a.children;
  const bc = b.children;
  if (ac === bc) return true;
  // One has a children array, the other doesn't (loaded-empty vs unloaded).
  if (ac === undefined || bc === undefined) return false;
  if (ac.length !== bc.length) return false;
  for (let i = 0; i < ac.length; i += 1) {
    if (!treeNodeEqual(ac[i], bc[i])) return false;
  }
  return true;
}

/**
 * Walk the tree and collect paths of `loaded:false` boundary dirs whose path
 * is in `openPaths`. These are the dirs the user has expanded but the current
 * tree shape doesn't yet have their children — feed them to `dirExpand`.
 *
 * Does NOT recurse into unloaded boundaries (they have no children to walk);
 * cascading is handled by `collectFreshUpdates` re-running this fn after each
 * round of expansions.
 */
export function collectLazyBoundariesInOpenSet(
  node: DirectoryTreeNode,
  openPaths: ReadonlySet<string>,
): string[] {
  const result: string[] = [];
  const walk = (n: DirectoryTreeNode): void => {
    if (n.type === "dir" && n.loaded === false && openPaths.has(n.path)) {
      result.push(n.path);
      return;
    }
    if (n.children) {
      for (const child of n.children) walk(child);
    }
  };
  walk(node);
  return result;
}

/**
 * Apply a batch of dirExpand results (keyed by path) to `root`. Replaces
 * children + loaded at every matching dir. Returns the same reference when
 * no update applied, so React's structural-equality checks downstream stay
 * cheap.
 */
export function applyChildrenMap(
  root: DirectoryTreeNode,
  updates: ChildrenUpdates,
): DirectoryTreeNode {
  if (updates.size === 0) return root;
  const update = updates.get(root.path);
  const base = update
    ? { ...root, children: update.children, loaded: update.loaded }
    : root;
  if (!base.children || base.children.length === 0) return base;

  let changed = update !== undefined;
  const nextChildren = base.children.map((c) => {
    const mapped = applyChildrenMap(c, updates);
    if (mapped !== c) changed = true;
    return mapped;
  });
  if (!changed) return root;
  return { ...base, children: nextChildren };
}

/**
 * Bounded-concurrency parallel runner. Order of results matches input.
 * Worker pool pattern — N workers pull the next index from a shared cursor.
 */
async function runWithConcurrencyLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const work = async (): Promise<void> => {
    while (true) {
      const myIndex = nextIndex++;
      if (myIndex >= items.length) return;
      results[myIndex] = await fn(items[myIndex]);
    }
  };
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => work()));
  return results;
}

export interface CollectFreshUpdatesOptions {
  maxIterations?: number;
  maxConcurrency?: number;
  /**
   * Predicate: is the user actively loading this path right now (via
   * `expandDir`)? If true, skip the refetch — the user's expand will
   * commit its own result. Prevents the refresh's frontier-refetch from
   * racing with a user-driven expand on the same path.
   */
  isLoading?: (path: string) => boolean;
  /**
   * Predicate checked between rounds and before each fetch. Returning
   * false short-circuits the cascade. Used by callers to cancel a
   * superseded refresh and stop burning IPC.
   */
  shouldContinue?: () => boolean;
  /**
   * Per-path failure reporter. Default is `console.warn` — without it,
   * permission errors / deleted-dir errors disappear silently.
   */
  onError?: (path: string, error: unknown) => void;
}

/**
 * For each dir in `openPaths` sitting at a `loaded:false` boundary in `tree`,
 * fire `dirExpand` in parallel (capped). After each round, re-scan boundaries
 * — `dirExpand` itself returns at most depth-3 deep, so a depth-7 expansion
 * needs two rounds to fully resolve.
 *
 * Returns a Map<path, ExpandDirectoryResult> the caller applies via
 * `applyChildrenMap`. Individual `dirExpand` errors are reported via
 * `onError` (defaults to console.warn) but don't break the cascade — the
 * failed path falls back to whatever `mergeLazyChildren` preserved (or
 * stays at `loaded:false` if no fallback exists), so a transient fs error
 * on one subtree doesn't blank the whole refresh.
 *
 * Each cascade tracks "paths already fetched this round" — even if the
 * server keeps returning `loaded:false` for the same path (e.g. very
 * large dir hit the entry cap), we don't refetch it within this cascade.
 *
 * `maxIterations` is a safety cap against pathological infinite cascades.
 * At 10 rounds × dirExpand depth=3 that's effective depth=30 — well beyond
 * any sane filesystem nesting.
 */
export async function collectFreshUpdates(
  tree: DirectoryTreeNode,
  openPaths: ReadonlySet<string>,
  dirExpand: (args: { path: string }) => Promise<ExpandDirectoryResult>,
  options: CollectFreshUpdatesOptions = {},
): Promise<Map<string, ExpandDirectoryResult>> {
  const maxIterations = options.maxIterations ?? 10;
  const maxConcurrency = options.maxConcurrency ?? 8;
  const isLoading = options.isLoading ?? (() => false);
  const shouldContinue = options.shouldContinue ?? (() => true);
  const onError =
    options.onError ??
    ((path, error) => {
      console.warn(
        `[treeMerge] dirExpand failed for ${path}:`,
        error,
      );
    });

  const updates = new Map<string, ExpandDirectoryResult>();
  const attempted = new Set<string>();
  let current = tree;

  for (let i = 0; i < maxIterations; i++) {
    if (!shouldContinue()) return updates;

    const rawBoundaries = collectLazyBoundariesInOpenSet(current, openPaths);
    const boundaries = rawBoundaries.filter(
      (p) => !isLoading(p) && !attempted.has(p),
    );
    if (boundaries.length === 0) return updates;

    // Mark every boundary as attempted BEFORE awaiting — even if the fetch
    // fails or is canceled, we won't re-fetch it within this cascade.
    for (const path of boundaries) attempted.add(path);

    const results = await runWithConcurrencyLimit(
      boundaries,
      maxConcurrency,
      async (path) => {
        if (!shouldContinue()) return null;
        try {
          const result = await dirExpand({ path });
          return { path, result };
        } catch (error) {
          onError(path, error);
          return null;
        }
      },
    );

    if (!shouldContinue()) return updates;

    let progressed = false;
    for (const r of results) {
      if (r) {
        updates.set(r.path, r.result);
        progressed = true;
      }
    }
    if (!progressed) return updates;
    current = applyChildrenMap(current, updates);
  }

  return updates;
}
