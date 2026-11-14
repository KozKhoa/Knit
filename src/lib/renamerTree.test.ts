import { describe, expect, it } from "vitest";
import type { RenameItem } from "../types/ipc";
import { buildRenamerTree, flattenVisibleTree } from "./renamerTree";

function makeItem(overrides: Partial<RenameItem> & Pick<RenameItem, "id" | "original_path" | "original_name" | "parent_dir" | "is_dir" | "depth">): RenameItem {
  return {
    new_name: overrides.original_name,
    new_path: overrides.original_path,
    selected: true,
    status: "unchanged",
    error_message: null,
    ...overrides,
  };
}

describe("renamerTree", () => {
  it("builds a hierarchical tree from bottom-up items and aggregates subtree indices", () => {
    const items: RenameItem[] = [
      makeItem({
        id: "3",
        original_path: "/manga/ch02/001.jpg",
        original_name: "001.jpg",
        parent_dir: "/manga/ch02",
        is_dir: false,
        depth: 2,
      }),
      makeItem({
        id: "2",
        original_path: "/manga/ch01/001.jpg",
        original_name: "001.jpg",
        parent_dir: "/manga/ch01",
        is_dir: false,
        depth: 2,
        selected: false,
      }),
      makeItem({
        id: "1",
        original_path: "/manga/ch01",
        original_name: "ch01",
        parent_dir: "/manga",
        is_dir: true,
        depth: 1,
      }),
      makeItem({
        id: "4",
        original_path: "/manga/ch02",
        original_name: "ch02",
        parent_dir: "/manga",
        is_dir: true,
        depth: 1,
      }),
    ];

    const tree = buildRenamerTree(items, ["/manga"]);
    expect(tree.map((n) => n.name)).toEqual(["ch01", "ch02"]);
    expect(tree[0].subtreePlanIndices).toEqual([2, 1]);
    expect(tree[1].subtreePlanIndices).toEqual([3, 0]);

    const collapsedRows = flattenVisibleTree(tree, items, new Set());
    expect(collapsedRows.map((r) => r.node.name)).toEqual(["ch01", "ch02"]);
    expect(collapsedRows[0].someSelected).toBe(true);
    expect(collapsedRows[0].allSelected).toBe(false);
    expect(collapsedRows[1].allSelected).toBe(true);

    const expandedRows = flattenVisibleTree(tree, items, new Set(["/manga/ch01"]));
    expect(expandedRows.map((r) => `${r.treeDepth}:${r.node.name}`)).toEqual([
      "0:ch01",
      "1:001.jpg",
      "0:ch02",
    ]);
  });

  it("synthesizes virtual folder nodes when target_type excludes directories", () => {
    const items: RenameItem[] = [
      makeItem({
        id: "a",
        original_path: "/manga/vol1/01.jpg",
        original_name: "01.jpg",
        parent_dir: "/manga/vol1",
        is_dir: false,
        depth: 2,
      }),
    ];

    const tree = buildRenamerTree(items, ["/manga"]);
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("vol1");
    expect(tree[0].planIndex).toBeNull();
    expect(tree[0].subtreePlanIndices).toEqual([0]);
    expect(tree[0].children[0].name).toBe("01.jpg");
  });
});
