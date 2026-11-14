import React from "react";

export interface UseVerticalResizeOptions {
  /** Current persisted or controlled height in pixels. */
  value: number;
  /** Minimum allowed height in pixels. */
  min: number;
  /** Maximum allowed height in pixels. */
  max: number;
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

function clampHeight(height: number, min: number, max: number): number {
  if (!Number.isFinite(height)) return min;
  return Math.min(max, Math.max(min, Math.round(height)));
}

/**
 * Manages pointer-drag vertical resizing with clamped bounds, deferred commit on
 * release, and automatic window listener cleanup on unmount or pointercancel.
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

      const startY = e.clientY;
      const startH = heightRef.current;
      let latestH = startH;
      setIsResizing(true);

      const onMove = (ev: PointerEvent) => {
        latestH = clampHeight(startH + (ev.clientY - startY), min, max);
        setHeight(latestH);
      };

      const cleanup = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
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
