import type { ArchiveEntrySpec, CompressionLevel } from "../types/ipc";

export interface ArchiveTreeNode {
  id: string;
  name: string;
  kind: "file" | "folder";
  sourcePath?: string;
  sizeBytes: number;
  compressionOverride?: CompressionLevel | null;
  children: ArchiveTreeNode[];
}

export type ArchiveDropPosition = "before" | "after" | "inside";

export interface FlattenedArchiveRow {
  node: ArchiveTreeNode;
  path: number[];
  pathKey: string;
  depth: number;
  hasChildren: boolean;
  isCollapsed: boolean;
}

export function archivePathKey(path: readonly number[]): string {
  return path.join(".");
}

function recomputeSizesAndSort(nodes: ArchiveTreeNode[]): ArchiveTreeNode[] {
  return nodes.map((n) => {
    if (n.kind === "file") return n;
    const children = recomputeSizesAndSort(n.children);
    const sizeBytes = children.reduce((acc, c) => acc + c.sizeBytes, 0);
    return { ...n, sizeBytes, children };
  });
}

function cloneArchiveTree(nodes: ArchiveTreeNode[]): ArchiveTreeNode[] {
  return nodes.map((n) => ({
    ...n,
    children: cloneArchiveTree(n.children),
  }));
}

function getListAt(
  root: ArchiveTreeNode[],
  parentPath: readonly number[],
): ArchiveTreeNode[] | null {
  let current = root;
  for (const idx of parentPath) {
    const item = current[idx];
    if (!item) return null;
    current = item.children;
  }
  return current;
}

/**
 * Builds a hierarchical tree of folders and files from flat `ArchiveEntrySpec[]`.
 */
export function buildArchiveTreeFromEntries(entries: ArchiveEntrySpec[]): ArchiveTreeNode[] {
  const roots: ArchiveTreeNode[] = [];

  for (const entry of entries) {
    const parts = entry.archive_path
      .split("/")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s !== ".");
    if (parts.length === 0) continue;

    let currentList = roots;
    let prefixPath = "";
    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i];
      prefixPath = prefixPath ? `${prefixPath}/${seg}` : seg;
      const isLast = i === parts.length - 1;

      if (isLast) {
        currentList.push({
          id: `file:${entry.source_path}:${prefixPath}`,
          name: seg,
          kind: "file",
          sourcePath: entry.source_path,
          sizeBytes: entry.size_bytes,
          compressionOverride: entry.compression_override ?? null,
          children: [],
        });
      } else {
        let folder = currentList.find(
          (n) => n.kind === "folder" && n.name.toLowerCase() === seg.toLowerCase(),
        );
        if (!folder) {
          folder = {
            id: `dir:${prefixPath}`,
            name: seg,
            kind: "folder",
            sizeBytes: 0,
            children: [],
          };
          currentList.push(folder);
        }
        currentList = folder.children;
      }
    }
  }

  return recomputeSizesAndSort(roots);
}

/**
 * Flattens the current archive tree back into `ArchiveEntrySpec[]` with updated archive paths.
 */
export function flattenArchiveTreeToEntries(
  nodes: ArchiveTreeNode[],
  parentPrefix = "",
): ArchiveEntrySpec[] {
  const out: ArchiveEntrySpec[] = [];
  for (const node of nodes) {
    const nextPath = parentPrefix ? `${parentPrefix}/${node.name}` : node.name;
    if (node.kind === "file" && node.sourcePath) {
      out.push({
        source_path: node.sourcePath,
        archive_path: nextPath,
        size_bytes: node.sizeBytes,
        compression_override: node.compressionOverride ?? null,
      });
    } else if (node.kind === "folder") {
      out.push(...flattenArchiveTreeToEntries(node.children, nextPath));
    }
  }
  return out;
}

export function countArchiveFilesAndBytes(nodes: ArchiveTreeNode[]): {
  fileCount: number;
  totalBytes: number;
} {
  let fileCount = 0;
  let totalBytes = 0;
  const walk = (list: ArchiveTreeNode[]) => {
    for (const n of list) {
      if (n.kind === "file") {
        fileCount += 1;
        totalBytes += n.sizeBytes;
      } else {
        walk(n.children);
      }
    }
  };
  walk(nodes);
  return { fileCount, totalBytes };
}

export function collectArchiveFolderKeys(nodes: ArchiveTreeNode[]): string[] {
  const keys: string[] = [];
  const walk = (list: ArchiveTreeNode[], prefix: number[]) => {
    for (let idx = 0; idx < list.length; idx++) {
      const node = list[idx];
      if (node.kind === "folder") {
        const path = [...prefix, idx];
        keys.push(archivePathKey(path));
        walk(node.children, path);
      }
    }
  };
  walk(nodes, []);
  return keys;
}

export function flattenVisibleArchiveRows(
  nodes: ArchiveTreeNode[],
  collapsedKeys: ReadonlySet<string>,
): FlattenedArchiveRow[] {
  const out: FlattenedArchiveRow[] = [];
  const walk = (list: ArchiveTreeNode[], prefix: number[], depth: number) => {
    for (let idx = 0; idx < list.length; idx++) {
      const node = list[idx];
      const path = [...prefix, idx];
      const pathKey = archivePathKey(path);
      const hasChildren = node.kind === "folder" && node.children.length > 0;
      const isCollapsed = hasChildren && collapsedKeys.has(pathKey);
      out.push({ node, path, pathKey, depth, hasChildren, isCollapsed });
      if (hasChildren && !isCollapsed) {
        walk(node.children, path, depth + 1);
      }
    }
  };
  walk(nodes, [], 0);
  return out;
}

export function deleteArchiveNodeAtPath(
  nodes: ArchiveTreeNode[],
  path: readonly number[],
): ArchiveTreeNode[] {
  if (path.length === 0) return nodes;
  const root = cloneArchiveTree(nodes);
  const parentPath = path.slice(0, -1);
  const targetIdx = path[path.length - 1];
  const parentList = getListAt(root, parentPath);
  if (!parentList || targetIdx < 0 || targetIdx >= parentList.length) {
    return nodes;
  }
  parentList.splice(targetIdx, 1);
  return recomputeSizesAndSort(root);
}

function deduplicateMovedName(siblings: ArchiveTreeNode[], candidateName: string): string {
  const taken = new Set(siblings.map((s) => s.name.toLowerCase()));
  if (!taken.has(candidateName.toLowerCase())) return candidateName;

  const dotIdx = candidateName.lastIndexOf(".");
  const stem = dotIdx > 0 ? candidateName.slice(0, dotIdx) : candidateName;
  const ext = dotIdx > 0 ? candidateName.slice(dotIdx) : "";
  let n = 1;
  while (taken.has(`${stem}_${n}${ext}`.toLowerCase())) {
    n += 1;
  }
  return `${stem}_${n}${ext}`;
}

/**
 * Moves a file or folder from `sourcePath` to `before` | `after` | `inside` relative to `targetPath`.
 * Prevents dropping a folder into itself or its own descendants, and prevents dropping `inside` a file.
 */
export function moveArchiveNode(
  nodes: ArchiveTreeNode[],
  sourcePath: readonly number[],
  targetPath: readonly number[],
  position: ArchiveDropPosition,
): ArchiveTreeNode[] {
  if (sourcePath.length === 0 || targetPath.length === 0) return nodes;
  if (
    targetPath.length >= sourcePath.length &&
    sourcePath.every((seg, i) => targetPath[i] === seg)
  ) {
    return nodes;
  }

  const root = cloneArchiveTree(nodes);
  const sourceParentPath = sourcePath.slice(0, -1);
  const sourceIdx = sourcePath[sourcePath.length - 1];
  const sourceList = getListAt(root, sourceParentPath);
  if (!sourceList || sourceIdx < 0 || sourceIdx >= sourceList.length) {
    return nodes;
  }

  const [moved] = sourceList.splice(sourceIdx, 1);
  if (!moved) return nodes;

  const adjustedTarget = [...targetPath];
  if (
    adjustedTarget.length > sourceParentPath.length &&
    sourceParentPath.every((seg, i) => adjustedTarget[i] === seg) &&
    adjustedTarget[sourceParentPath.length] > sourceIdx
  ) {
    adjustedTarget[sourceParentPath.length] -= 1;
  }

  if (position === "inside") {
    const targetParentList = getListAt(root, adjustedTarget.slice(0, -1));
    const targetIdx = adjustedTarget[adjustedTarget.length - 1];
    const targetNode = targetParentList?.[targetIdx];
    if (!targetNode || targetNode.kind !== "folder") return nodes;
    moved.name = deduplicateMovedName(targetNode.children, moved.name);
    targetNode.children.push(moved);
    return recomputeSizesAndSort(root);
  }

  const targetParentPath = adjustedTarget.slice(0, -1);
  const targetIdx = adjustedTarget[adjustedTarget.length - 1];
  const targetList = getListAt(root, targetParentPath);
  if (!targetList || targetIdx < 0 || targetIdx > targetList.length) {
    return nodes;
  }
  moved.name = deduplicateMovedName(targetList, moved.name);
  const insertAt = position === "before" ? targetIdx : targetIdx + 1;
  targetList.splice(insertAt, 0, moved);
  return recomputeSizesAndSort(root);
}
