import { describe, expect, it } from "vitest";
import type { BookmarkNode } from "../types/ipc";
import {
  addChildBookmarkAtPath,
  bookmarkPathKey,
  buildPageBookmarkMap,
  collectParentBookmarkKeys,
  deleteBookmarkAtPath,
  deleteBookmarkNodesAtPaths,
  flattenVisibleBookmarks,
  moveBookmarkNode,
  moveBookmarkNodesWithSelection,
  pruneNestedBookmarkPaths,
  remapBookmarksAfterPageRemoval,
  updateBookmarkAtPath,
  validateBookmarks,
} from "./bookmarks";

describe("bookmarks helpers", () => {
  it("builds a map from 0-based page index to bookmark titles", () => {
    const nodes: BookmarkNode[] = [
      {
        title: "Folder 1",
        target_page_index: 0,
        children: [{ title: "Sub 1.1", target_page_index: 0, children: [] }],
      },
      { title: "Folder 2", target_page_index: 10, children: [] },
    ];
    const map = buildPageBookmarkMap(nodes);
    expect(map.get(0)).toEqual(["Folder 1", "Sub 1.1"]);
    expect(map.get(10)).toEqual(["Folder 2"]);
    expect(map.get(5)).toBeUndefined();
  });

  it("shifts subsequent folder bookmarks when 5 images of folder 1 are removed (including first image)", () => {
    // 3 folders x 10 images = 30 images -> page 1 (idx 0), page 11 (idx 10), page 21 (idx 20)
    const bookmarks: BookmarkNode[] = [
      { title: "Folder 1", target_page_index: 0, children: [] },
      { title: "Folder 2", target_page_index: 10, children: [] },
      { title: "Folder 3", target_page_index: 20, children: [] },
    ];

    // Remove first 5 images of Folder 1 (indices 0..4)
    const updated = remapBookmarksAfterPageRemoval(bookmarks, 30, new Set([0, 1, 2, 3, 4]));
    expect(updated).toEqual([
      { title: "Folder 1", target_page_index: 0, children: [] }, // still page 1 (old idx 5)
      { title: "Folder 2", target_page_index: 5, children: [] }, // now page 6
      { title: "Folder 3", target_page_index: 15, children: [] }, // now page 16
    ]);
  });

  it("drops a bookmark only when all images in its span are deleted and keeps nested survivors", () => {
    const bookmarks: BookmarkNode[] = [
      { title: "Folder 1", target_page_index: 0, children: [] },
      {
        title: "Folder 2",
        target_page_index: 10,
        children: [
          { title: "Sub 2.1", target_page_index: 10, children: [] },
          { title: "Sub 2.2", target_page_index: 15, children: [] },
        ],
      },
    ];

    // Remove all 10 images of Folder 1 (0..9) + first 5 of Folder 2 (10..14)
    const removed = new Set(Array.from({ length: 15 }, (_, i) => i));
    const updated = remapBookmarksAfterPageRemoval(bookmarks, 20, removed);
    expect(updated).toEqual([
      {
        title: "Folder 2",
        target_page_index: 0,
        children: [{ title: "Sub 2.2", target_page_index: 0, children: [] }],
      },
    ]);
  });

  it("reorders sibling bookmarks and nests across levels while blocking cycles", () => {
    const tree: BookmarkNode[] = [
      {
        title: "A",
        target_page_index: 0,
        children: [{ title: "A1", target_page_index: 1, children: [] }],
      },
      { title: "B", target_page_index: 5, children: [] },
      { title: "C", target_page_index: 10, children: [] },
    ];

    // Move A after C -> [B, C, A]
    const movedAfter = moveBookmarkNode(tree, [0], [2], "after");
    expect(movedAfter.map((n) => n.title)).toEqual(["B", "C", "A"]);

    // Nest C inside B -> B.children = [C]
    const nested = moveBookmarkNode(tree, [2], [1], "inside");
    expect(nested.map((n) => n.title)).toEqual(["A", "B"]);
    expect(nested[1].children.map((n) => n.title)).toEqual(["C"]);

    // Promote A1 before B -> [A, A1, B, C]
    const promoted = moveBookmarkNode(tree, [0, 0], [1], "before");
    expect(promoted.map((n) => n.title)).toEqual(["A", "A1", "B", "C"]);
    expect(promoted[0].children).toEqual([]);

    // Block moving A into its own child A1
    const cycleBlocked = moveBookmarkNode(tree, [0], [0, 0], "inside");
    expect(cycleBlocked).toBe(tree);
  });

  it("validates out-of-order, child-before-parent, and out-of-range bookmarks", () => {
    const tree: BookmarkNode[] = [
      {
        title: "Ch 1",
        target_page_index: 9, // p.10
        children: [{ title: "Sub 1.1", target_page_index: 4, children: [] }], // p.5 < parent p.10 & < prev p.10
      },
      { title: "Ch 2", target_page_index: 6, children: [] }, // p.7 >= Sub 1.1 p.5 -> ok relative to prev
      { title: "Ch 3", target_page_index: 25, children: [] }, // p.26 > totalPages 20
    ];

    const res = validateBookmarks(tree, 20);
    expect(res.totalWarnings).toBe(3);
    expect(res.warningsByPath.get(bookmarkPathKey([0, 0]))).toEqual([
      { kind: "parent", refPage: 10 },
      { kind: "order", refPage: 10 },
    ]);
    expect(res.warningsByPath.get(bookmarkPathKey([2]))).toEqual([
      { kind: "out_of_range", refPage: 20 },
    ]);
    expect(res.warningsByPath.get(bookmarkPathKey([1]))).toBeUndefined();
  });

  it("flattens visible bookmarks respecting collapsed nodes and mutates by path immutably", () => {
    const tree: BookmarkNode[] = [
      {
        title: "Vol 1",
        target_page_index: 0,
        children: [
          { title: "Ch 1", target_page_index: 0, children: [] },
          { title: "Ch 2", target_page_index: 10, children: [] },
        ],
      },
      { title: "Vol 2", target_page_index: 20, children: [] },
    ];

    expect(collectParentBookmarkKeys(tree)).toEqual(["0"]);
    expect(flattenVisibleBookmarks(tree, new Set()).map((r) => r.node.title)).toEqual([
      "Vol 1",
      "Ch 1",
      "Ch 2",
      "Vol 2",
    ]);
    expect(flattenVisibleBookmarks(tree, new Set(["0"])).map((r) => r.node.title)).toEqual([
      "Vol 1",
      "Vol 2",
    ]);

    const updated = updateBookmarkAtPath(tree, [0, 1], { title: "Ch 2 Edited", target_page_index: 12 });
    expect(updated[0].children[1].title).toBe("Ch 2 Edited");
    expect(tree[0].children[1].title).toBe("Ch 2");

    const withChild = addChildBookmarkAtPath(updated, [1], "Sub");
    expect(withChild[1].children).toHaveLength(1);
    expect(withChild[1].children[0].title).toBe("Vol 2 - Sub");

    const deleted = deleteBookmarkAtPath(withChild, [0, 0]);
    expect(deleted[0].children.map((c) => c.title)).toEqual(["Ch 2 Edited"]);
  });

  it("prunes nested paths, batch-deletes, and batch-moves selected sections while preserving tree order", () => {
    const tree: BookmarkNode[] = [
      {
        title: "A",
        target_page_index: 0,
        children: [{ title: "A1", target_page_index: 1, children: [] }],
      },
      { title: "B", target_page_index: 2, children: [] },
      { title: "C", target_page_index: 3, children: [] },
      { title: "D", target_page_index: 4, children: [] },
    ];

    // Prune descendant [0, 0] when parent [0] is selected
    expect(pruneNestedBookmarkPaths([[2], [0, 0], [0]])).toEqual([[0], [2]]);

    // Batch move [A (with A1), C] after D -> [B, D, A (with A1), C]
    const moved = moveBookmarkNodesWithSelection(tree, [[0], [0, 0], [2]], [3], "after");
    expect(moved.nodes.map((n) => n.title)).toEqual(["B", "D", "A", "C"]);
    expect(moved.nodes[2].children.map((c) => c.title)).toEqual(["A1"]);
    expect(moved.nextSelectedKeys).toEqual(["2", "3"]);

    // Cycle guard: cannot drop [A, C] inside A1
    const blocked = moveBookmarkNodesWithSelection(tree, [[0], [2]], [0, 0], "inside");
    expect(blocked.nodes).toBe(tree);

    // Batch delete [A, C] -> [B, D]
    const afterDelete = deleteBookmarkNodesAtPaths(tree, [[0], [0, 0], [2]]);
    expect(afterDelete.map((n) => n.title)).toEqual(["B", "D"]);
  });
});
