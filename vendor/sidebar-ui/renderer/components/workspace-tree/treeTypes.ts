import type { DirectoryTreeNode } from "../../../shared/dir-types";

export interface WorkspaceTreeNodeMeta {
  data: DirectoryTreeNode;
  depth: number;
  parentPath: string | null;
}

export interface VisibleTreeRow extends WorkspaceTreeNodeMeta {
  path: string;
  isDir: boolean;
  isLoading: boolean;
  isOpen: boolean;
  isSelected: boolean;
}

export interface StickyAncestor {
  id: string;
  path: string;
  name: string;
  depth: number;
}

/** Inline-editor state: F2 rename, or context-menu 新建文件/新建文件夹. */
export type TreeEditingState =
  | {
      mode: "rename";
      /** Workspace-relative path of the node being renamed. */
      path: string;
      initialName: string;
      isDir: boolean;
      /** Sibling names (excluding self) for live collision feedback. */
      siblingNames: ReadonlySet<string>;
    }
  | {
      mode: "create-file" | "create-folder";
      /** Workspace-relative dir the new item is created in ("" = root). */
      parentDir: string;
      siblingNames: ReadonlySet<string>;
    };

/**
 * What the virtual list actually renders: real tree rows plus synthetic
 * rows (the inline editor, the "empty folder" hint). Synthetic rows are NOT
 * draggable and resolve drops / sticky ancestors via their parent dir.
 */
export type TreeListItem =
  | { kind: "node"; key: string; row: VisibleTreeRow }
  | { kind: "edit"; key: string; depth: number; editing: TreeEditingState }
  | { kind: "empty-hint"; key: string; depth: number; parentDir: string };

/** Parent-dir chain anchor used by sticky-ancestor resolution, uniform
 *  across real and synthetic rows. */
export function stickyParentPathOf(item: TreeListItem): string | null {
  switch (item.kind) {
    case "node":
      return item.row.parentPath;
    case "edit":
      return item.editing.mode === "rename"
        ? parentDirOfPath(item.editing.path) || null
        : item.editing.parentDir || null;
    case "empty-hint":
      return item.parentDir || null;
  }
}

export function parentDirOfPath(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx > 0 ? path.slice(0, idx) : "";
}
