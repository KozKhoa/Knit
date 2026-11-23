import type { BookmarkNode } from "../types/ipc";

/**
 * Xây map `0-based page_index -> danh sách tiêu đề bookmark` trỏ vào trang đó.
 */
export function buildPageBookmarkMap(nodes: BookmarkNode[]): Map<number, string[]> {
  const map = new Map<number, string[]>();
  const walk = (list: BookmarkNode[]) => {
    for (const node of list) {
      const existing = map.get(node.target_page_index);
      if (existing) {
        existing.push(node.title);
      } else {
        map.set(node.target_page_index, [node.title]);
      }
      if (node.children.length > 0) {
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return map;
}

/**
 * Cập nhật lại cây bookmark sau khi xóa các chỉ số trang trong `removedIndices`.
 * - Các bookmark phía sau vùng bị xóa sẽ tự động dời `target_page_index` lên theo chỉ số mới.
 * - Nếu chỉ xóa một phần ảnh thuộc khoảng của một bookmark (kể cả ảnh đầu tiên của khoảng),
 *   bookmark đó được giữ lại và dời sang ảnh còn lại đầu tiên trong khoảng `[target, nextStop)`.
 * - Chỉ xóa bookmark khi toàn bộ khoảng ảnh của nó bị xóa sạch và không còn bookmark con nào.
 */
export function remapBookmarksAfterPageRemoval(
  bookmarks: BookmarkNode[],
  oldTotalPages: number,
  removedIndices: ReadonlySet<number>,
): BookmarkNode[] {
  if (bookmarks.length === 0 || oldTotalPages <= 0) return bookmarks;
  if (removedIndices.size === 0) return bookmarks;

  const oldToNew = new Map<number, number>();
  let nextNewIdx = 0;
  for (let i = 0; i < oldTotalPages; i++) {
    if (!removedIndices.has(i)) {
      oldToNew.set(i, nextNewIdx);
      nextNewIdx += 1;
    }
  }
  if (oldToNew.size === 0) return [];

  const stopSet = new Set<number>();
  const collectStops = (nodes: BookmarkNode[]) => {
    for (const n of nodes) {
      if (n.target_page_index >= 0 && n.target_page_index < oldTotalPages) {
        stopSet.add(n.target_page_index);
      }
      if (n.children.length > 0) {
        collectStops(n.children);
      }
    }
  };
  collectStops(bookmarks);
  const sortedStops = Array.from(stopSet).sort((a, b) => a - b);

  const firstSurvivingInSpan = (startOld: number, endOldExcl: number): number | null => {
    const clampedStart = Math.max(0, startOld);
    const clampedEnd = Math.min(oldTotalPages, endOldExcl);
    for (let p = clampedStart; p < clampedEnd; p++) {
      const mapped = oldToNew.get(p);
      if (mapped !== undefined) return mapped;
    }
    return null;
  };

  const remapNodes = (nodes: BookmarkNode[]): BookmarkNode[] => {
    const out: BookmarkNode[] = [];
    for (const node of nodes) {
      const children = node.children.length > 0 ? remapNodes(node.children) : [];
      const nextStop =
        sortedStops.find((s) => s > node.target_page_index) ?? oldTotalPages;
      const mappedSelf = firstSurvivingInSpan(node.target_page_index, nextStop);
      if (mappedSelf !== null) {
        out.push({
          title: node.title,
          target_page_index: mappedSelf,
          children,
        });
      } else if (children.length > 0) {
        out.push({
          title: node.title,
          target_page_index: children[0].target_page_index,
          children,
        });
      }
    }
    return out;
  };

  return remapNodes(bookmarks);
}

export type BookmarkDropPosition = "before" | "after" | "inside";

export interface BookmarkValidationWarning {
  kind: "order" | "parent" | "out_of_range";
  /** 1-based reference page number (previous bookmark page, parent page, or totalPages) */
  refPage: number;
}

export function bookmarkPathKey(path: readonly number[]): string {
  return path.join(".");
}

function cloneBookmarkTree(nodes: BookmarkNode[]): BookmarkNode[] {
  return nodes.map((n) => ({
    title: n.title,
    target_page_index: n.target_page_index,
    children: cloneBookmarkTree(n.children),
  }));
}

function getListAt(
  root: BookmarkNode[],
  parentPath: readonly number[],
): BookmarkNode[] | null {
  let current = root;
  for (const idx of parentPath) {
    const item = current[idx];
    if (!item) return null;
    current = item.children;
  }
  return current;
}

/**
 * Di chuyển một bookmark từ `sourcePath` tới vị trí tương đối (`before` | `after` | `inside`)
 * so với `targetPath`. Tự động chặn kéo node cha vào chính nó hoặc con cháu của nó.
 */
export function moveBookmarkNode(
  nodes: BookmarkNode[],
  sourcePath: readonly number[],
  targetPath: readonly number[],
  position: BookmarkDropPosition,
): BookmarkNode[] {
  if (sourcePath.length === 0 || targetPath.length === 0) return nodes;
  if (
    targetPath.length >= sourcePath.length &&
    sourcePath.every((seg, i) => targetPath[i] === seg)
  ) {
    return nodes;
  }

  const root = cloneBookmarkTree(nodes);
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
    if (!targetNode) return nodes;
    targetNode.children.push(moved);
    return root;
  }

  const targetParentPath = adjustedTarget.slice(0, -1);
  const targetIdx = adjustedTarget[adjustedTarget.length - 1];
  const targetList = getListAt(root, targetParentPath);
  if (!targetList || targetIdx < 0 || targetIdx > targetList.length) {
    return nodes;
  }
  const insertAt = position === "before" ? targetIdx : targetIdx + 1;
  targetList.splice(insertAt, 0, moved);
  return root;
}

/**
 * Kiểm tra cảnh báo logic của cây bookmark (không chặn export):
 * - `order`: bookmark đứng sau có số trang nhỏ hơn bookmark đứng trước (tức mục trước > mục sau).
 * - `parent`: bookmark con có số trang nhỏ hơn bookmark cha.
 * - `out_of_range`: số trang vượt quá tổng số trang hiện có.
 */
export function validateBookmarks(
  nodes: BookmarkNode[],
  totalPages: number,
): { warningsByPath: Map<string, BookmarkValidationWarning[]>; totalWarnings: number } {
  const warningsByPath = new Map<string, BookmarkValidationWarning[]>();
  let totalWarnings = 0;
  let prevPageIndex: number | null = null;

  const pushWarning = (key: string, warning: BookmarkValidationWarning) => {
    const existing = warningsByPath.get(key);
    if (existing) {
      existing.push(warning);
    } else {
      warningsByPath.set(key, [warning]);
    }
    totalWarnings += 1;
  };

  const walk = (
    list: BookmarkNode[],
    prefix: number[],
    parentPageIndex: number | null,
  ) => {
    list.forEach((node, idx) => {
      const path = [...prefix, idx];
      const key = bookmarkPathKey(path);

      if (totalPages > 0 && (node.target_page_index < 0 || node.target_page_index >= totalPages)) {
        pushWarning(key, { kind: "out_of_range", refPage: totalPages });
      }
      if (parentPageIndex !== null && node.target_page_index < parentPageIndex) {
        pushWarning(key, { kind: "parent", refPage: parentPageIndex + 1 });
      }
      if (prevPageIndex !== null && node.target_page_index < prevPageIndex) {
        pushWarning(key, { kind: "order", refPage: prevPageIndex + 1 });
      }

      prevPageIndex = node.target_page_index;
      if (node.children.length > 0) {
        walk(node.children, path, node.target_page_index);
      }
    });
  };

  walk(nodes, [], null);
  return { warningsByPath, totalWarnings };
}

export interface FlattenedBookmarkRow {
  node: BookmarkNode;
  path: number[];
  pathKey: string;
  depth: number;
  hasChildren: boolean;
  isCollapsed: boolean;
}

/**
 * Làm phẳng danh sách các bookmark đang hiển thị theo trạng thái thu gọn `collapsedKeys`
 * để phục vụ ảo hóa (virtualized list) với hàng ngàn bookmark.
 */
export function flattenVisibleBookmarks(
  nodes: BookmarkNode[],
  collapsedKeys: ReadonlySet<string>,
): FlattenedBookmarkRow[] {
  const out: FlattenedBookmarkRow[] = [];
  const walk = (list: BookmarkNode[], prefix: number[], depth: number) => {
    for (let idx = 0; idx < list.length; idx++) {
      const node = list[idx];
      const path = [...prefix, idx];
      const key = bookmarkPathKey(path);
      const hasChildren = node.children.length > 0;
      const isCollapsed = hasChildren && collapsedKeys.has(key);
      out.push({ node, path, pathKey: key, depth, hasChildren, isCollapsed });
      if (hasChildren && !isCollapsed) {
        walk(node.children, path, depth + 1);
      }
    }
  };
  walk(nodes, [], 0);
  return out;
}

/**
 * Thu thập toàn bộ pathKey của các node có children (dùng cho nút Thu gọn tất cả).
 */
export function collectParentBookmarkKeys(nodes: BookmarkNode[]): string[] {
  const keys: string[] = [];
  const walk = (list: BookmarkNode[], prefix: number[]) => {
    for (let idx = 0; idx < list.length; idx++) {
      const node = list[idx];
      if (node.children.length > 0) {
        const path = [...prefix, idx];
        keys.push(bookmarkPathKey(path));
        walk(node.children, path);
      }
    }
  };
  walk(nodes, []);
  return keys;
}

function updateListAtPath(
  list: BookmarkNode[],
  path: readonly number[],
  depth: number,
  transform: (siblings: BookmarkNode[], idx: number) => BookmarkNode[],
): BookmarkNode[] {
  const idx = path[depth];
  if (idx === undefined || idx < 0 || idx >= list.length) return list;
  if (depth === path.length - 1) {
    return transform(list, idx);
  }
  const target = list[idx];
  const nextChildren = updateListAtPath(target.children, path, depth + 1, transform);
  if (nextChildren === target.children) return list;
  const copy = [...list];
  copy[idx] = { ...target, children: nextChildren };
  return copy;
}

export function updateBookmarkAtPath(
  nodes: BookmarkNode[],
  path: readonly number[],
  patch: Partial<Pick<BookmarkNode, "title" | "target_page_index">>,
): BookmarkNode[] {
  if (path.length === 0) return nodes;
  return updateListAtPath(nodes, path, 0, (siblings, idx) => {
    const copy = [...siblings];
    copy[idx] = { ...copy[idx], ...patch };
    return copy;
  });
}

export function deleteBookmarkAtPath(
  nodes: BookmarkNode[],
  path: readonly number[],
): BookmarkNode[] {
  if (path.length === 0) return nodes;
  return updateListAtPath(nodes, path, 0, (siblings, idx) =>
    siblings.filter((_, i) => i !== idx),
  );
}

export function parseBookmarkPathKey(key: string): number[] {
  if (!key) return [];
  const parts = key.split(".").map((n) => Number.parseInt(n, 10));
  return parts.some((n) => Number.isNaN(n) || n < 0) ? [] : parts;
}

export function isBookmarkDescendantOrSame(
  ancestor: readonly number[],
  candidate: readonly number[],
): boolean {
  return (
    candidate.length >= ancestor.length &&
    ancestor.every((seg, i) => candidate[i] === seg)
  );
}

/**
 * Loại bỏ các đường dẫn con cháu nếu nút cha đã nằm trong danh sách chọn,
 * đồng thời sắp xếp theo thứ tự xuất hiện trên cây từ trên xuống dưới.
 */
export function pruneNestedBookmarkPaths(paths: readonly number[][]): number[][] {
  const sorted = [...paths]
    .filter((p) => p.length > 0)
    .sort((a, b) => {
      const len = Math.min(a.length, b.length);
      for (let i = 0; i < len; i++) {
        if (a[i] !== b[i]) return a[i] - b[i];
      }
      return a.length - b.length;
    });

  const kept: number[][] = [];
  for (const p of sorted) {
    if (!kept.some((anc) => isBookmarkDescendantOrSame(anc, p))) {
      kept.push(p);
    }
  }
  return kept;
}

function getBookmarkNodeAt(
  nodes: BookmarkNode[],
  path: readonly number[],
): BookmarkNode | null {
  let list = nodes;
  let found: BookmarkNode | null = null;
  for (let i = 0; i < path.length; i++) {
    const idx = path[i];
    if (idx < 0 || idx >= list.length) return null;
    found = list[idx];
    list = found.children;
  }
  return found;
}

/**
 * Xóa hàng loạt các bookmark theo danh sách đường dẫn (tự gộp nút cha-con).
 */
export function deleteBookmarkNodesAtPaths(
  nodes: BookmarkNode[],
  paths: readonly number[][],
): BookmarkNode[] {
  const pruned = pruneNestedBookmarkPaths(paths);
  if (pruned.length === 0) return nodes;

  const targetRefs = new Set<BookmarkNode>();
  for (const p of pruned) {
    const node = getBookmarkNodeAt(nodes, p);
    if (node) targetRefs.add(node);
  }
  if (targetRefs.size === 0) return nodes;

  const walk = (list: BookmarkNode[]): BookmarkNode[] => {
    const out: BookmarkNode[] = [];
    for (const n of list) {
      if (targetRefs.has(n)) continue;
      out.push(n.children.length > 0 ? { ...n, children: walk(n.children) } : n);
    }
    return out;
  };

  return walk(nodes);
}

/**
 * Di chuyển hàng loạt các bookmark đang chọn tới vị trí tương đối (`before` | `after` | `inside`)
 * so với `targetPath`, giữ nguyên thứ tự cây và nhánh con của từng mục.
 */
export function moveBookmarkNodesWithSelection(
  nodes: BookmarkNode[],
  sourcePaths: readonly number[][],
  targetPath: readonly number[],
  position: BookmarkDropPosition,
): { nodes: BookmarkNode[]; nextSelectedKeys: string[] } {
  const pruned = pruneNestedBookmarkPaths(sourcePaths);
  if (pruned.length === 0 || targetPath.length === 0) {
    return {
      nodes,
      nextSelectedKeys: pruned.map((p) => bookmarkPathKey(p)),
    };
  }
  if (pruned.some((src) => isBookmarkDescendantOrSame(src, targetPath))) {
    return {
      nodes,
      nextSelectedKeys: pruned.map((p) => bookmarkPathKey(p)),
    };
  }

  const movedRefs: BookmarkNode[] = [];
  for (const p of pruned) {
    const n = getBookmarkNodeAt(nodes, p);
    if (n) movedRefs.push(n);
  }
  const targetRef = getBookmarkNodeAt(nodes, targetPath);
  if (movedRefs.length === 0 || !targetRef) {
    return {
      nodes,
      nextSelectedKeys: pruned.map((p) => bookmarkPathKey(p)),
    };
  }

  const movedSet = new Set(movedRefs);
  const movedClones = movedRefs.map((n) => ({
    title: n.title,
    target_page_index: n.target_page_index,
    children: cloneBookmarkTree(n.children),
  }));
  const movedCloneSet = new Set(movedClones);

  const transform = (list: BookmarkNode[]): BookmarkNode[] => {
    const out: BookmarkNode[] = [];
    for (const n of list) {
      if (movedSet.has(n)) continue;

      const nextChildren = n.children.length > 0 ? transform(n.children) : [];
      if (n === targetRef && position === "inside") {
        out.push({
          title: n.title,
          target_page_index: n.target_page_index,
          children: [...nextChildren, ...movedClones],
        });
        continue;
      }

      const rebuilt: BookmarkNode = {
        title: n.title,
        target_page_index: n.target_page_index,
        children: nextChildren,
      };
      if (n === targetRef && position === "before") {
        out.push(...movedClones, rebuilt);
      } else if (n === targetRef && position === "after") {
        out.push(rebuilt, ...movedClones);
      } else {
        out.push(rebuilt);
      }
    }
    return out;
  };

  const nextNodes = transform(nodes);
  const nextSelectedKeys: string[] = [];
  const collectKeys = (list: BookmarkNode[], prefix: number[]) => {
    list.forEach((n, idx) => {
      const p = [...prefix, idx];
      if (movedCloneSet.has(n)) {
        nextSelectedKeys.push(bookmarkPathKey(p));
      } else if (n.children.length > 0) {
        collectKeys(n.children, p);
      }
    });
  };
  collectKeys(nextNodes, []);

  return { nodes: nextNodes, nextSelectedKeys };
}

export function moveBookmarkNodes(
  nodes: BookmarkNode[],
  sourcePaths: readonly number[][],
  targetPath: readonly number[],
  position: BookmarkDropPosition,
): BookmarkNode[] {
  return moveBookmarkNodesWithSelection(nodes, sourcePaths, targetPath, position).nodes;
}

export function addChildBookmarkAtPath(
  nodes: BookmarkNode[],
  path: readonly number[],
  childSuffix: string,
): BookmarkNode[] {
  if (path.length === 0) return nodes;
  return updateListAtPath(nodes, path, 0, (siblings, idx) => {
    const copy = [...siblings];
    const parent = copy[idx];
    copy[idx] = {
      ...parent,
      children: [
        ...parent.children,
        {
          title: `${parent.title} - ${childSuffix}`,
          target_page_index: parent.target_page_index,
          children: [],
        },
      ],
    };
    return copy;
  });
}
