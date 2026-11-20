import React from "react";
import { RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { useI18n } from "../i18n";

interface ZoomPanViewportProps {
  /** Changing this key automatically resets zoom and pan (e.g. page/image identifier). */
  resetKey: string | number;
  children: React.ReactNode;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const ZOOM_STEP = 1.18;

/**
 * Interactive viewport supporting mouse-wheel zoom on hover and pointer-drag panning when zoomed.
 */
export const ZoomPanViewport: React.FC<ZoomPanViewportProps> = ({ resetKey, children }) => {
  const { t } = useI18n();
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = React.useState(1);
  const [pan, setPan] = React.useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [panning, setPanning] = React.useState(false);

  const zoomRef = React.useRef(zoom);
  zoomRef.current = zoom;
  const panRef = React.useRef(pan);
  panRef.current = pan;

  React.useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [resetKey]);

  const applyZoom = React.useCallback((nextZoomRaw: number, focalClient?: { x: number; y: number }) => {
    const prevZoom = zoomRef.current;
    const nextZoom = Number(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, nextZoomRaw)).toFixed(3));
    if (nextZoom <= 1.001) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
      return;
    }

    const container = containerRef.current;
    if (container && focalClient) {
      const rect = container.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = focalClient.x - cx;
      const dy = focalClient.y - cy;
      const ratio = nextZoom / prevZoom;
      const curPan = panRef.current;
      setPan({
        x: Math.round(dx - (dx - curPan.x) * ratio),
        y: Math.round(dy - (dy - curPan.y) * ratio),
      });
    }
    setZoom(nextZoom);
  }, []);

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      applyZoom(zoomRef.current * factor, { x: e.clientX, y: e.clientY });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [applyZoom]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || zoomRef.current <= 1.001) return;
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startPan = panRef.current;
    setPanning(true);

    const onMove = (ev: PointerEvent) => {
      setPan({
        x: Math.round(startPan.x + (ev.clientX - startX)),
        y: Math.round(startPan.y + (ev.clientY - startY)),
      });
    };
    const onUp = () => {
      setPanning(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    if (zoomRef.current > 1.001) {
      applyZoom(1);
    } else {
      applyZoom(2, { x: e.clientX, y: e.clientY });
    }
  };

  return (
    <div
      ref={containerRef}
      data-testid="zoom-pan-viewport"
      onPointerDown={handlePointerDown}
      onDoubleClick={handleDoubleClick}
      className={`relative flex flex-1 select-none items-center justify-center overflow-hidden bg-[#212529] p-4 ${
        zoom > 1.001 ? (panning ? "cursor-grabbing" : "cursor-grab") : "cursor-zoom-in"
      }`}
    >
      <div
        data-testid="zoom-pan-stage"
        style={{
          transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
          transformOrigin: "center center",
        }}
        className="flex h-full w-full items-center justify-center transition-transform duration-75 ease-out will-change-transform"
      >
        {children}
      </div>

      {/* Compact Zoom HUD */}
      <div
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        className="absolute bottom-3 left-3 z-20 flex items-center gap-1 rounded-[4px] border border-[#495057] bg-[#343A40]/90 px-2 py-1 text-xs text-white"
      >
        <button
          type="button"
          onClick={() => applyZoom(zoom / 1.25)}
          disabled={zoom <= MIN_ZOOM}
          aria-label="Zoom out"
          className="rounded-[4px] p-1 text-[#DEE2E6] hover:bg-[#495057] hover:text-white disabled:opacity-40"
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </button>
        <span
          data-testid="zoom-pan-pct"
          className="min-w-[44px] text-center font-mono-code text-[11px] font-semibold"
        >
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={() => applyZoom(zoom * 1.25)}
          disabled={zoom >= MAX_ZOOM}
          aria-label="Zoom in"
          className="rounded-[4px] p-1 text-[#DEE2E6] hover:bg-[#495057] hover:text-white disabled:opacity-40"
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </button>
        {zoom > 1.001 && (
          <button
            type="button"
            onClick={() => applyZoom(1)}
            title={t.common.zoomResetLabel}
            className="ml-0.5 inline-flex items-center gap-1 rounded-[4px] border border-[#6C757D] bg-[#495057] px-1.5 py-0.5 text-[11px] font-medium text-white hover:bg-[#5A6268]"
          >
            <RotateCcw className="h-3 w-3" />
            <span>100%</span>
          </button>
        )}
      </div>

      <div className="pointer-events-none absolute bottom-3 left-1/2 hidden -translate-x-1/2 rounded-[4px] bg-[#343A40]/80 px-2.5 py-1 text-[11px] text-[#DEE2E6] sm:block">
        {t.common.zoomPanHint}
      </div>
    </div>
  );
};
