import type { RenameItem } from "../types/ipc";

export interface RenamerTreeNode {
  key: string;
  name: string;
  isDir: boolean;
  depth: number;
  /** Index inside `RenamePlan.items` when this node represents an actual scanned item, else `null` for virtual folder groups. */
  planIndex: number | null;
  item: RenameItem | null;
  children: RenamerTreeNode[];
  /** Plan indices of this node (if real) plus all real descendants. */
  subtreePlanIndices: number[];
}

export interface FlattenedTreeRow {
  key: string;
  node: RenamerTreeNode;
  treeDepth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  /** Selection summary across `subtreePlanIndices`. */
  allSelected: boolean;
  someSelected: boolean;
}

export type RenamerSortField = "none" | "type" | "original" | "new" | "status";
export type RenamerSortDir = "asc" | "desc";

const naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compareTreeNodes(
  a: RenamerTreeNode,
  b: RenamerTreeNode,
  sortField: RenamerSortField,
  sortDir: RenamerSortDir,
): number {
  const dirMul = sortDir === "asc" ? 1 : -1;
  switch (sortField) {
    case "type": {
      if (a.isDir !== b.isDir) return (a.isDir ? -1 : 1) * dirMul;
      return naturalCollator.compare(a.name, b.name);
    }
    case "original": {
      const cmp = naturalCollator.compare(a.name, b.name);
      if (cmp !== 0) return cmp * dirMul;
      return a.isDir === b.isDir ? 0 : a.isDir ? -1 : 1;
    }
    case "new": {
      const aNew = a.item ? a.item.new_name : a.name;
      const bNew = b.item ? b.item.new_name : b.name;
      const cmp = naturalCollator.compare(aNew, bNew);
      if (cmp !== 0) return cmp * dirMul;
      return naturalCollator.compare(a.name, b.name);
    }
    case "status": {
      const aSt = a.item?.status ?? "";
      const bSt = b.item?.status ?? "";
      const cmp = aSt.localeCompare(bSt);
      if (cmp !== 0) return cmp * dirMul;
      return naturalCollator.compare(a.name, b.name);
    }
    case "none":
    default: {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return naturalCollator.compare(a.name, b.name);
    }
  }
}

export function sortFlatRenameItems(
  items: RenameItem[],
  sortField: RenamerSortField,
  sortDir: RenamerSortDir,
): { item: RenameItem; planIndex: number }[] {
  const indexed = items.map((item, planIndex) => ({ item, planIndex }));
  if (sortField === "none") return indexed;
  const dirMul = sortDir === "asc" ? 1 : -1;
  indexed.sort((a, b) => {
    let cmp = 0;
    switch (sortField) {
      case "type":
        if (a.item.is_dir !== b.item.is_dir) {
          cmp = a.item.is_dir ? -1 : 1;
        } else {
          cmp = naturalCollator.compare(a.item.original_name, b.item.original_name);
          return cmp;
        }
        break;
      case "original":
        cmp = naturalCollator.compare(a.item.original_name, b.item.original_name);
        break;
      case "new":
        cmp = naturalCollator.compare(a.item.new_name, b.item.new_name);
        break;
      case "status":
        cmp = a.item.status.localeCompare(b.item.status);
        if (cmp === 0) {
          return naturalCollator.compare(a.item.original_name, b.item.original_name);
        }
        break;
    }
    if (cmp !== 0) return cmp * dirMul;
    return a.planIndex - b.planIndex;
  });
  return indexed;
}

function pathParent(p: string): string {
  const norm = p.replace(/[\\/]+$/, "");
  const idx = Math.max(norm.lastIndexOf("/"), norm.lastIndexOf("\\"));
  return idx > 0 ? norm.slice(0, idx) : "";
}

function pathBase(p: string): string {
  const norm = p.replace(/[\\/]+$/, "");
  const idx = Math.max(norm.lastIndexOf("/"), norm.lastIndexOf("\\"));
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

function normalizePathKey(p: string): string {
  return p.replace(/[\\/]+$/, "");
}

/**
 * Builds a folder/file tree from `RenamePlan.items` (whose array order may be
 * bottom-up for safe renaming). Virtual folder group nodes are synthesized when
 * intermediate directories are excluded by `ScanFilter` (e.g. `target_type = "files"`).
 */
export function buildRenamerTree(
  items: RenameItem[],
  roots: string[],
  sortField: RenamerSortField = "none",
  sortDir: RenamerSortDir = "asc",
): RenamerTreeNode[] {
  if (items.length === 0) return [];

  const rootSet = new Set(roots.map(normalizePathKey).filter(Boolean));
  const nodesByPath = new Map<string, RenamerTreeNode>();

  // 1. Register all real items first
  items.forEach((item, planIndex) => {
    const key = normalizePathKey(item.original_path);
    nodesByPath.set(key, {
      key,
      name: item.original_name,
      isDir: item.is_dir,
      depth: item.depth,
      planIndex,
      item,
      children: [],
      subtreePlanIndices: [planIndex],
    });
  });

  // 2. Ensure parent folders exist up to scanned roots
  const ensureFolderNode = (dirPath: string): RenamerTreeNode | null => {
    const key = normalizePathKey(dirPath);
    if (!key) return null;
    const existing = nodesByPath.get(key);
    if (existing) return existing;
    if (rootSet.has(key)) {
      const rootNode: RenamerTreeNode = {
        key,
        name: pathBase(key) || key,
        isDir: true,
        depth: 0,
        planIndex: null,
        item: null,
        children: [],
        subtreePlanIndices: [],
      };
      nodesByPath.set(key, rootNode);
      return rootNode;
    }

    const parentPath = pathParent(key);
    if (!parentPath || parentPath === key) return null;

    const virtualNode: RenamerTreeNode = {
      key,
      name: pathBase(key) || key,
      isDir: true,
      depth: 0,
      planIndex: null,
      item: null,
      children: [],
      subtreePlanIndices: [],
    };
    nodesByPath.set(key, virtualNode);
    return virtualNode;
  };

  // Attach every node to its parent (creating virtual folder nodes up to rootSet if needed)
  const topLevelNodes: RenamerTreeNode[] = [];
  const attachedKeys = new Set<string>();

  const attachToParent = (node: RenamerTreeNode) => {
    if (attachedKeys.has(node.key)) return;
    attachedKeys.add(node.key);

    if (rootSet.has(node.key)) {
      topLevelNodes.push(node);
      return;
    }

    const parentKey = normalizePathKey(
      node.item ? node.item.parent_dir : pathParent(node.key),
    );
    if (!parentKey || parentKey === node.key) {
      topLevelNodes.push(node);
      return;
    }

    // If parent is one of the selected roots and isn't a real item, attach directly as top-level
    // unless multiple roots exist, in which case grouping under the root folder is clearer.
    if (rootSet.has(parentKey) && rootSet.size === 1 && !nodesByPath.has(parentKey)) {
      topLevelNodes.push(node);
      return;
    }

    const parentNode = ensureFolderNode(parentKey);
    if (!parentNode || parentNode.key === node.key) {
      topLevelNodes.push(node);
      return;
    }

    parentNode.children.push(node);
    attachToParent(parentNode);
  };

  // Snapshot initial nodes so map mutation while attaching virtual parents stays deterministic
  const initialNodes = Array.from(nodesByPath.values());
  for (const node of initialNodes) {
    attachToParent(node);
  }

  // 3. Sort children (naturally or by column) and aggregate subtree indices
  const finalize = (node: RenamerTreeNode): number[] => {
    node.children.sort((a, b) => compareTreeNodes(a, b, sortField, sortDir));
    const indices: number[] = node.planIndex !== null ? [node.planIndex] : [];
    for (const child of node.children) {
      indices.push(...finalize(child));
    }
    node.subtreePlanIndices = indices;
    return indices;
  };

  topLevelNodes.sort((a, b) => compareTreeNodes(a, b, sortField, sortDir));
  for (const top of topLevelNodes) {
    finalize(top);
  }

  return topLevelNodes;
}

/**
 * Flattens visible tree nodes according to `expandedKeys` for fast virtualized rendering.
 */
export function flattenVisibleTree(
  roots: RenamerTreeNode[],
  items: RenameItem[],
  expandedKeys: Set<string>,
): FlattenedTreeRow[] {
  const rows: FlattenedTreeRow[] = [];

  const visit = (node: RenamerTreeNode, treeDepth: number) => {
    const hasChildren = node.children.length > 0;
    const isExpanded = hasChildren && expandedKeys.has(node.key);

    let selectedCount = 0;
    for (const idx of node.subtreePlanIndices) {
      if (items[idx]?.selected) selectedCount += 1;
    }
    const totalCount = node.subtreePlanIndices.length;

    rows.push({
      key: node.key,
      node,
      treeDepth,
      hasChildren,
      isExpanded,
      allSelected: totalCount > 0 && selectedCount === totalCount,
      someSelected: selectedCount > 0 && selectedCount < totalCount,
    });

    if (isExpanded) {
      for (const child of node.children) {
        visit(child, treeDepth + 1);
      }
    }
  };

  for (const root of roots) {
    visit(root, 0);
  }

  return rows;
}
