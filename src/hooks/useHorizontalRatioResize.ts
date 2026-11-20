import React from "react";

export interface UseHorizontalRatioResizeOptions {
  /** Current persisted ratio (e.g. 0.42). */
  value: number;
  /** Minimum ratio in [0..1]. */
  min: number;
  /** Maximum ratio in [0..1]. */
  max: number;
  /** Container element whose width defines ratio coordinates. */
  containerRef: React.RefObject<HTMLElement | null>;
  /**
   * Optional CSS custom property name (e.g. `"--split-left"`).
   * When provided, drag updates write directly to `containerRef.current.style`
   * via `requestAnimationFrame` with zero React re-renders during drag, and
   * commit React state once on pointer release.
   */
  cssVar?: string;
  /** Called once on pointerup / pointercancel with 4-decimal rounded ratio. */
  onCommit: (nextRatio: number) => void;
}

export interface UseHorizontalRatioResizeResult {
  ratio: number;
  isResizing: boolean;
  handlePointerDown: (e: React.PointerEvent<HTMLElement>) => void;
}

function clampRatio(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function formatRatioPct(ratio: number): string {
  return `${(ratio * 100).toFixed(2)}%`;
}

/**
 * Manages horizontal split-pane ratio dragging with clamped bounds, deferred
 * commit on release, optional rAF-throttled direct CSS variable updates, and
 * automatic cleanup on unmount or pointercancel.
 */
export function useHorizontalRatioResize({
  value,
  min,
  max,
  containerRef,
  cssVar,
  onCommit,
}: UseHorizontalRatioResizeOptions): UseHorizontalRatioResizeResult {
  const [ratio, setRatio] = React.useState(() => clampRatio(value, min, max));
  const [isResizing, setIsResizing] = React.useState(false);

  const ratioRef = React.useRef(ratio);
  ratioRef.current = ratio;

  const onCommitRef = React.useRef(onCommit);
  onCommitRef.current = onCommit;

  const cleanupDragRef = React.useRef<(() => void) | null>(null);

  React.useEffect(() => {
    const clamped = clampRatio(value, min, max);
    setRatio(clamped);
    if (cssVar && containerRef.current) {
      containerRef.current.style.setProperty(cssVar, formatRatioPct(clamped));
    }
  }, [value, min, max, cssVar, containerRef]);

  React.useEffect(() => {
    return () => {
      cleanupDragRef.current?.();
      cleanupDragRef.current = null;
    };
  }, []);

  const handlePointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0) return;

      e.preventDefault();
      cleanupDragRef.current?.();

      let latest = ratioRef.current;
      let rafId: number | null = null;
      let rafScheduled = false;
      setIsResizing(true);

      const applyCssVar = (val: number) => {
        if (cssVar && containerRef.current) {
          containerRef.current.style.setProperty(cssVar, formatRatioPct(val));
        }
      };

      const onMove = (ev: PointerEvent) => {
        latest = clampRatio((ev.clientX - rect.left) / rect.width, min, max);
        if (cssVar) {
          if (!rafScheduled) {
            rafScheduled = true;
            rafId = window.requestAnimationFrame(() => {
              rafScheduled = false;
              rafId = null;
              applyCssVar(latest);
            });
          }
        } else {
          setRatio(latest);
        }
      };

      const cleanup = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
        if (rafId !== null) {
          window.cancelAnimationFrame(rafId);
          rafId = null;
        }
        rafScheduled = false;
        cleanupDragRef.current = null;
      };

      const finish = () => {
        cleanup();
        const committed = Number(latest.toFixed(4));
        applyCssVar(committed);
        setRatio(committed);
        setIsResizing(false);
        onCommitRef.current(committed);
      };

      cleanupDragRef.current = cleanup;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
    },
    [containerRef, cssVar, min, max],
  );

  return { ratio, isResizing, handlePointerDown };
}
