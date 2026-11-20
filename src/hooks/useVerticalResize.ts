import React from "react";

export interface UseVerticalResizeOptions {
  /** Current persisted or controlled height in pixels. */
  value: number;
  /** Minimum allowed height in pixels. */
  min: number;
  /** Optional maximum allowed height in pixels (omit for unlimited height). */
  max?: number;
  /** Called once when the drag finishes (pointerup / pointercancel) with the clamped height. */
  onCommit: (nextHeight: number) => void;
}

export interface UseVerticalResizeResult {
  /** Live clamped height in pixels (updates on pointermove during drag). */
  height: number;
  /** True while a vertical resize drag is active. */
  isResizing: boolean;
  /** Attach to the resize handle's `onPointerDown` event. */
  handlePointerDown: (e: React.PointerEvent<HTMLElement>) => void;
}

function clampHeight(height: number, min: number, max?: number): number {
  if (!Number.isFinite(height)) return min;
  const rounded = Math.round(height);
  const aboveMin = Math.max(min, rounded);
  return max !== undefined && Number.isFinite(max) ? Math.min(max, aboveMin) : aboveMin;
}

/** Finds the nearest vertically scrollable ancestor element. */
export function findScrollableAncestor(startEl: HTMLElement | null): HTMLElement | null {
  let cur = startEl?.parentElement ?? null;
  while (cur) {
    const style = window.getComputedStyle(cur);
    const overflowY = style.overflowY;
    if (
      (overflowY === "auto" || overflowY === "scroll" || cur.tagName === "MAIN") &&
      cur.scrollHeight >= cur.clientHeight
    ) {
      return cur;
    }
    cur = cur.parentElement;
  }
  return null;
}

/**
 * Manages pointer-drag vertical resizing with clamped bounds, edge auto-scroll
 * when dragging to the viewport/container boundary, deferred commit on release,
 * and automatic window listener cleanup on unmount or pointercancel.
 */
export function useVerticalResize({
  value,
  min,
  max,
  onCommit,
}: UseVerticalResizeOptions): UseVerticalResizeResult {
  const [height, setHeight] = React.useState(() => clampHeight(value, min, max));
  const [isResizing, setIsResizing] = React.useState(false);

  const heightRef = React.useRef(height);
  heightRef.current = height;

  const onCommitRef = React.useRef(onCommit);
  onCommitRef.current = onCommit;

  const cleanupDragRef = React.useRef<(() => void) | null>(null);

  React.useEffect(() => {
    setHeight(clampHeight(value, min, max));
  }, [value, min, max]);

  React.useEffect(() => {
    return () => {
      cleanupDragRef.current?.();
      cleanupDragRef.current = null;
    };
  }, []);

  const handlePointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();

      cleanupDragRef.current?.();

      const scrollEl = findScrollableAncestor(e.currentTarget as HTMLElement);
      const startScrollTop = scrollEl ? scrollEl.scrollTop : 0;
      const startY = e.clientY;
      const startH = heightRef.current;
      let latestClientY = startY;
      let latestH = startH;
      let scrollRafId: number | null = null;
      setIsResizing(true);

      const updateHeightFromPointer = () => {
        const scrollDelta = scrollEl ? scrollEl.scrollTop - startScrollTop : 0;
        latestH = clampHeight(startH + (latestClientY - startY) + scrollDelta, min, max);
        setHeight(latestH);
      };

      const computeEdgeScrollStep = (): number => {
        if (!scrollEl) return 0;
        const rect = scrollEl.getBoundingClientRect();
        const topEdge = Math.max(0, rect.top);
        const bottomEdge = Math.min(window.innerHeight, rect.bottom);
        const zone = 36;
        if (bottomEdge > topEdge + zone * 2) {
          if (latestClientY >= bottomEdge - zone) {
            const ratio = Math.min(1.5, Math.max(0.25, (latestClientY - (bottomEdge - zone)) / zone));
            return Math.round(6 + ratio * 12);
          }
          if (latestClientY <= topEdge + zone) {
            const ratio = Math.min(1.5, Math.max(0.25, (topEdge + zone - latestClientY) / zone));
            return -Math.round(6 + ratio * 12);
          }
        }
        return 0;
      };

      const tickAutoScroll = () => {
        scrollRafId = null;
        if (!scrollEl) return;
        const dy = computeEdgeScrollStep();
        if (dy === 0) return;
        const prevTop = scrollEl.scrollTop;
        scrollEl.scrollTop += dy;
        if (scrollEl.scrollTop !== prevTop) {
          updateHeightFromPointer();
          scrollRafId = window.requestAnimationFrame(tickAutoScroll);
        }
      };

      const onMove = (ev: PointerEvent) => {
        latestClientY = ev.clientY;
        updateHeightFromPointer();
        if (scrollEl && computeEdgeScrollStep() !== 0 && scrollRafId === null) {
          scrollRafId = window.requestAnimationFrame(tickAutoScroll);
        }
      };

      const cleanup = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
        if (scrollRafId !== null) {
          window.cancelAnimationFrame(scrollRafId);
          scrollRafId = null;
        }
        cleanupDragRef.current = null;
      };

      const finish = () => {
        cleanup();
        setIsResizing(false);
        onCommitRef.current(latestH);
      };

      cleanupDragRef.current = cleanup;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
    },
    [min, max],
  );

  return { height, isResizing, handlePointerDown };
}
