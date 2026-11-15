import { describe, expect, it } from "vitest";
import { computeVisibleRowRange, hitTestGridInsertIndex, mergeThumbCacheLru } from "./imageGrid";

describe("imageGrid virtualization and O(1) hit-testing", () => {
  it("computes visible rows and padding accurately when scrolled", () => {
    // 1000 items, 4 cols = 250 rows, stride = 250px
    const range = computeVisibleRowRange({
      totalItems: 1000,
      gridCols: 4,
      rowStride: 250,
      gridRectTop: -2400,
      scrollRectTop: 100,
      viewportHeight: 800,
      overscanRows: 2,
    });
    // visibleStartY = 100 - (-2400) = 2500 -> row 10
    // visibleEndY = 2500 + 800 = 3300 -> row 13
    // with overscan 2 -> startRow = 8, endRow = 15
    expect(range.rowCount).toBe(250);
    expect(range.startRow).toBe(8);
    expect(range.endRow).toBe(15);
    expect(range.topPadPx).toBe(8 * 250);
    expect(range.bottomPadPx).toBe((249 - 15) * 250);
  });

  it("handles empty items and zero viewport height gracefully", () => {
    const empty = computeVisibleRowRange({
      totalItems: 0,
      gridCols: 4,
      rowStride: 250,
      gridRectTop: 0,
      scrollRectTop: 0,
      viewportHeight: 800,
    });
    expect(empty.endRow).toBe(-1);
    expect(empty.rowCount).toBe(0);

    const jsdomFallback = computeVisibleRowRange({
      totalItems: 200,
      gridCols: 4,
      rowStride: 250,
      gridRectTop: 0,
      scrollRectTop: 0,
      viewportHeight: 0,
    });
    expect(jsdomFallback.startRow).toBe(0);
    expect(jsdomFallback.endRow).toBe(15);
  });

  it("hit-tests insert index in O(1) including left/right half and partial last row", () => {
    // gridWidth = 436, 4 cols, gap 12 -> colWidth = (436 - 36) / 4 = 100, colSpan = 112
    const base = {
      gridLeft: 100,
      gridTop: -500,
      gridWidth: 436,
      gridCols: 4,
      gapPx: 12,
      rowStride: 200,
      totalItems: 10, // 3 rows: [0..3], [4..7], [8, 9]
    };

    // Row 2 (relY = 450 -> row 2), Col 1 (relX = 112 + 20 = 132 -> left half of item 9)
    expect(hitTestGridInsertIndex({ ...base, clientX: 232, clientY: -50 })).toBe(9);

    // Right half of item 9 (relX = 112 + 80 = 192)
    expect(hitTestGridInsertIndex({ ...base, clientX: 292, clientY: -50 })).toBe(10);

    // Empty slot on last row (row 2, col 3) clamps to totalItems (10)
    expect(hitTestGridInsertIndex({ ...base, clientX: 480, clientY: -50 })).toBe(10);

    // Row 0, left half of item 0
    expect(hitTestGridInsertIndex({ ...base, clientX: 110, clientY: -490 })).toBe(0);
  });

  it("bounds thumbnail cache using LRU while protecting visible viewport items", () => {
    const prev = { a: "u-a", b: "u-b", c: "u-c", d: "u-d" };
    const protectedIds = new Set(["a"]);
    const { nextCache, evictedIds } = mergeThumbCacheLru(
      prev,
      { e: "u-e", f: "u-f" },
      4,
      protectedIds,
    );

    expect(Object.keys(nextCache)).toHaveLength(4);
    expect(nextCache.a).toBe("u-a");
    expect(nextCache.e).toBe("u-e");
    expect(nextCache.f).toBe("u-f");
    expect(evictedIds).toEqual(["b", "c"]);
    expect(nextCache.d).toBe("u-d");
  });
});
