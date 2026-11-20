import React from "react";
import { computeVisibleRowRange } from "../lib/imageGrid";

export interface UseVirtualizedGridOptions {
  outerRef: React.RefObject<HTMLElement | null>;
  innerRef: React.RefObject<HTMLElement | null>;
  getScrollEl: () => HTMLElement | null;
  totalItems: number;
  cols: number;
  gapPx: number;
  initialRowStridePx: number;
  overscanRows?: number;
  enabled?: boolean;
  /** Extra dependencies whose changes require recalculating the visible window. */
  extraDeps?: readonly unknown[];
  onVisibleWindowChange?: (startIdx: number, endIdxExclusive: number) => void;
}

export interface UseVirtualizedGridResult {
  startRow: number;
  endRow: number;
  startIdx: number;
  endIdxExclusive: number;
  topPadPx: number;
  bottomPadPx: number;
  rowStride: number;
  rowStrideRef: React.MutableRefObject<number>;
  colsRef: React.MutableRefObject<number>;
  refresh: () => void;
}

/**
 * Measures grid row stride via ResizeObserver + computes overscanned visible
 * row slices without forcing layout reflows during drag rAF loops.
 */
export function useVirtualizedGrid({
  outerRef,
  innerRef,
  getScrollEl,
  totalItems,
  cols,
  gapPx,
  initialRowStridePx,
  overscanRows = 3,
  enabled = true,
  extraDeps = [],
  onVisibleWindowChange,
}: UseVirtualizedGridOptions): UseVirtualizedGridResult {
  const safeCols = Math.max(1, cols);
  const colsRef = React.useRef<number>(safeCols);
  colsRef.current = safeCols;

  const [rowStride, setRowStride] = React.useState<number>(initialRowStridePx);
  const rowStrideRef = React.useRef<number>(rowStride);
  rowStrideRef.current = rowStride;

  const [range, setRange] = React.useState<{ startRow: number; endRow: number }>({
    startRow: 0,
    endRow: 12,
  });

  const totalRef = React.useRef<number>(totalItems);
  totalRef.current = totalItems;
  const enabledRef = React.useRef<boolean>(enabled);
  enabledRef.current = enabled;
  const getScrollElRef = React.useRef(getScrollEl);
  getScrollElRef.current = getScrollEl;
  const onVisibleChangeRef = React.useRef(onVisibleWindowChange);
  onVisibleChangeRef.current = onVisibleWindowChange;

  const refresh = React.useCallback(() => {
    if (!enabledRef.current) return;
    const outerEl = outerRef.current;
    const innerEl = innerRef.current;
    const activeCols = Math.max(1, colsRef.current);

    if (innerEl) {
      const firstCard = innerEl.firstElementChild as HTMLElement | null;
      if (firstCard) {
        const h = firstCard.getBoundingClientRect().height;
        if (h > 40) {
          const nextStride = Math.round(h + gapPx);
          if (Math.abs(nextStride - rowStrideRef.current) > 2) {
            rowStrideRef.current = nextStride;
            setRowStride(nextStride);
          }
        }
      }
    }

    const total = totalRef.current;
    const scrollEl = getScrollElRef.current();
    const rowCount = Math.ceil(total / activeCols);
    let startRow = 0;
    let endRow = Math.max(0, Math.min(rowCount - 1, 14));

    if (outerEl && scrollEl && scrollEl.clientHeight > 0) {
      const gridRect = outerEl.getBoundingClientRect();
      const scrollRect = scrollEl.getBoundingClientRect();
      const next = computeVisibleRowRange({
        totalItems: total,
        gridCols: activeCols,
        rowStride: rowStrideRef.current,
        gridRectTop: gridRect.top,
        scrollRectTop: scrollRect.top,
        viewportHeight: scrollEl.clientHeight,
        overscanRows,
      });
      startRow = next.startRow;
      endRow = next.endRow;
    }

    setRange((prev) =>
      prev.startRow === startRow && prev.endRow === endRow ? prev : { startRow, endRow },
    );

    if (total > 0 && endRow >= startRow) {
      const startIdx = startRow * activeCols;
      const endExcl = Math.min(total, (endRow + 1) * activeCols);
      onVisibleChangeRef.current?.(startIdx, endExcl);
    }
  }, [outerRef, innerRef, gapPx, overscanRows]);

  React.useEffect(() => {
    if (!enabled || totalItems === 0) return;
    let rafId: number | null = null;
    const schedule = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        refresh();
      });
    };

    schedule();
    const scrollEl = getScrollElRef.current();
    const outerEl = outerRef.current;
    scrollEl?.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(schedule);
      if (outerEl) ro.observe(outerEl);
      if (scrollEl) ro.observe(scrollEl);
    }

    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      scrollEl?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      ro?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, totalItems, safeCols, refresh, ...extraDeps]);

  const rowCount = Math.ceil(totalItems / safeCols);
  const safeStartRow =
    rowCount === 0 ? 0 : Math.max(0, Math.min(range.startRow, Math.max(0, rowCount - 1)));
  const safeEndRow =
    rowCount === 0 ? -1 : Math.max(safeStartRow, Math.min(range.endRow, rowCount - 1));
  const startIdx = safeStartRow * safeCols;
  const endIdxExclusive =
    safeEndRow >= 0 ? Math.min(totalItems, (safeEndRow + 1) * safeCols) : 0;
  const topPadPx = safeStartRow * rowStride;
  const bottomPadPx =
    rowCount > 0 && safeEndRow >= 0
      ? Math.max(0, (rowCount - 1 - safeEndRow) * rowStride)
      : 0;

  return {
    startRow: safeStartRow,
    endRow: safeEndRow,
    startIdx,
    endIdxExclusive,
    topPadPx,
    bottomPadPx,
    rowStride,
    rowStrideRef,
    colsRef,
    refresh,
  };
}
