import React from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Loader2, Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { isTauriRuntime, releasePdfCachedFiles, renderPdfPagePreviewFile } from "../lib/ipc";

export interface PdfLazyFilePreviewHandle {
  scrollToPage: (pageNumber: number) => void;
  setScrollRatio: (ratio: number) => void;
}

interface PdfLazyFilePreviewProps {
  filePath: string | null;
  totalPages: number;
  loading?: boolean;
  error?: string | null;
  emptyText: string;
  loadingText: string;
  pageCountLabel?: (total: number) => string;
  onScrollRatioChange?: (ratio: number) => void;
  onOpenFind?: () => void;
}

interface LazyPreviewPageProps {
  pdfPath: string;
  pageNumber: number;
  displayWidth: number;
  pageHeight: number;
  slotHeight: number;
  renderWidth: number;
  registerPageRef: (pageNumber: number, el: HTMLDivElement | null) => void;
}

const LazyPreviewPage: React.FC<LazyPreviewPageProps> = React.memo(
  ({
    pdfPath,
    pageNumber,
    displayWidth,
    pageHeight,
    slotHeight,
    renderWidth,
    registerPageRef,
  }) => {
    const [srcUrl, setSrcUrl] = React.useState<string | null>(null);
    const [loading, setLoading] = React.useState(false);

    const setRefs = React.useCallback(
      (el: HTMLDivElement | null) => {
        registerPageRef(pageNumber, el);
      },
      [pageNumber, registerPageRef],
    );

    React.useEffect(() => {
      if (!isTauriRuntime()) {
        setSrcUrl(null);
        setLoading(false);
        return;
      }

      let cancelled = false;
      setLoading(true);
      const delayMs = pageNumber <= 2 ? 0 : 45;
      const timer = window.setTimeout(() => {
        void renderPdfPagePreviewFile(pdfPath, pageNumber - 1, renderWidth)
          .then((filePath) => {
            if (!cancelled) {
              setSrcUrl(convertFileSrc(filePath));
            }
          })
          .catch(() => {
            if (!cancelled) setSrcUrl(null);
          })
          .finally(() => {
            if (!cancelled) setLoading(false);
          });
      }, delayMs);

      return () => {
        cancelled = true;
        window.clearTimeout(timer);
      };
    }, [pdfPath, pageNumber, renderWidth]);

    return (
      <div
        className="flex flex-col items-center"
        style={{ height: `${slotHeight}px` }}
      >
        <div
          ref={setRefs}
          data-page-number={pageNumber}
          style={{
            width: `${displayWidth}px`,
            height: `${pageHeight}px`,
          }}
          className="relative flex items-center justify-center overflow-hidden rounded-[2px] border border-[#CED4DA] bg-white shadow-sm"
        >
          {srcUrl ? (
            <img
              src={srcUrl}
              alt={`Page ${pageNumber}`}
              decoding="async"
              draggable={false}
              className="block max-h-full max-w-full object-contain select-none"
            />
          ) : (
            <div className="flex flex-col items-center gap-2 py-8 text-xs text-[#6C757D]">
              {loading && <Loader2 className="h-4 w-4 animate-spin text-[#007BFF]" />}
              <span className="font-mono-code">#{pageNumber}</span>
            </div>
          )}
        </div>
        <div className="mt-1 font-mono-code text-[11px] text-[#6C757D]">{pageNumber}</div>
      </div>
    );
  },
);

LazyPreviewPage.displayName = "LazyPreviewPage";

/**
 * Virtualized, zero-IPC-byte PDF preview powered by Rust mmap (`render_pdf_page_preview_file`).
 * Mounts only pages within the active scroll window so 1,000+ page PDFs stay responsive and low-RAM.
 */
export const PdfLazyFilePreview = React.forwardRef<
  PdfLazyFilePreviewHandle,
  PdfLazyFilePreviewProps
>(
  (
    {
      filePath,
      totalPages,
      loading = false,
      error = null,
      emptyText,
      loadingText,
      pageCountLabel,
      onScrollRatioChange,
      onOpenFind,
    },
    ref,
  ) => {
    const scrollRef = React.useRef<HTMLDivElement | null>(null);
    const pageWrapperRefs = React.useRef<Map<number, HTMLDivElement>>(new Map());
    const [currentPage, setCurrentPage] = React.useState(1);
    const [zoomMode, setZoomMode] = React.useState<"fit" | "manual">("fit");
    const [manualScale, setManualScale] = React.useState(1.0);
    const [fitScale, setFitScale] = React.useState(1.0);
    const [viewport, setViewport] = React.useState({ top: 0, height: 640 });
    const scrollRafRef = React.useRef<number | null>(null);
    const onScrollRatioRef = React.useRef(onScrollRatioChange);
    onScrollRatioRef.current = onScrollRatioChange;

    const registerPageRef = React.useCallback(
      (pageNumber: number, el: HTMLDivElement | null) => {
        if (el) {
          pageWrapperRefs.current.set(pageNumber, el);
        } else {
          pageWrapperRefs.current.delete(pageNumber);
        }
      },
      [],
    );

    React.useEffect(() => {
      setCurrentPage(1);
      setZoomMode("fit");
      setViewport((prev) => ({ ...prev, top: 0 }));
      if (scrollRef.current) {
        scrollRef.current.scrollTop = 0;
      }
      if (!filePath) return;
      return () => {
        void releasePdfCachedFiles([filePath]);
      };
    }, [filePath]);

    React.useEffect(() => {
      const el = scrollRef.current;
      if (!el) return;
      const recompute = () => {
        const avail = Math.max(240, el.clientWidth - 36);
        setFitScale(Number(Math.min(2.2, Math.max(0.45, avail / 640)).toFixed(3)));
        const clientH = el.clientHeight > 0 ? el.clientHeight : 640;
        setViewport((prev) =>
          prev.height === clientH ? prev : { ...prev, height: clientH },
        );
      };
      recompute();
      if (typeof ResizeObserver === "undefined") {
        window.addEventListener("resize", recompute);
        return () => window.removeEventListener("resize", recompute);
      }
      const ro = new ResizeObserver(recompute);
      ro.observe(el);
      return () => ro.disconnect();
    }, [filePath, totalPages]);

    const zoomModeRef = React.useRef(zoomMode);
    zoomModeRef.current = zoomMode;
    const fitScaleRef = React.useRef(fitScale);
    fitScaleRef.current = fitScale;

    React.useEffect(() => {
      const el = scrollRef.current;
      if (!el) return;
      const onWheel = (e: WheelEvent) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        e.stopPropagation();
        const step = e.deltaY < 0 ? 0.12 : -0.12;
        setZoomMode("manual");
        setManualScale((prev) => {
          const base = zoomModeRef.current === "fit" ? fitScaleRef.current : prev;
          return Number(Math.min(3.0, Math.max(0.4, base + step)).toFixed(2));
        });
      };
      el.addEventListener("wheel", onWheel, { passive: false });
      return () => el.removeEventListener("wheel", onWheel);
    }, [filePath]);

    React.useEffect(() => {
      return () => {
        if (scrollRafRef.current !== null) {
          window.cancelAnimationFrame(scrollRafRef.current);
          scrollRafRef.current = null;
        }
      };
    }, []);

    const activeScale = zoomMode === "fit" ? fitScale : manualScale;
    const zoomPct = Math.round(activeScale * 100);
    const displayWidth = Math.max(220, Math.round(640 * activeScale));
    const pageHeight = Math.round(displayWidth * 1.38);
    const slotHeight = pageHeight + 36;
    const renderWidth = activeScale > 1.25 ? 1120 : 800;

    const slotHeightRef = React.useRef(slotHeight);
    slotHeightRef.current = slotHeight;

    React.useImperativeHandle(
      ref,
      () => ({
        scrollToPage: (pageNumber: number) => {
          const el = pageWrapperRefs.current.get(pageNumber);
          if (el) {
            el.scrollIntoView({ block: "center", behavior: "smooth" });
            return;
          }
          const container = scrollRef.current;
          if (!container) return;
          const targetTop = Math.max(0, (pageNumber - 1) * slotHeightRef.current - 24);
          if (typeof container.scrollTo === "function") {
            container.scrollTo({ top: targetTop, behavior: "smooth" });
          } else {
            container.scrollTop = targetTop;
          }
        },
        setScrollRatio: (ratio: number) => {
          const el = scrollRef.current;
          if (!el) return;
          const maxScroll = el.scrollHeight - el.clientHeight;
          if (maxScroll > 0) {
            el.scrollTop = Math.min(1, Math.max(0, ratio)) * maxScroll;
          }
        },
      }),
      [],
    );

    const handleScroll = React.useCallback(() => {
      if (scrollRafRef.current !== null) return;
      scrollRafRef.current = window.requestAnimationFrame(() => {
        scrollRafRef.current = null;
        const el = scrollRef.current;
        if (!el) return;
        const top = el.scrollTop;
        const height = el.clientHeight > 0 ? el.clientHeight : 640;
        setViewport((prev) =>
          Math.abs(prev.top - top) < 2 && prev.height === height ? prev : { top, height },
        );
        const maxScroll = el.scrollHeight - el.clientHeight;
        onScrollRatioRef.current?.(maxScroll > 0 ? top / maxScroll : 0);
      });
    }, []);

    const startPage =
      totalPages > 0 ? Math.max(1, Math.floor(viewport.top / slotHeight) - 3) : 1;
    const endPage =
      totalPages > 0
        ? Math.min(totalPages, Math.ceil((viewport.top + viewport.height) / slotHeight) + 4)
        : 0;
    const visiblePages = React.useMemo(() => {
      if (endPage < startPage) return [];
      const arr: number[] = [];
      for (let p = startPage; p <= endPage; p += 1) {
        arr.push(p);
      }
      return arr;
    }, [startPage, endPage]);

    React.useEffect(() => {
      if (totalPages <= 0) {
        setCurrentPage(1);
        return;
      }
      const approxPage = Math.min(
        totalPages,
        Math.max(1, Math.floor((viewport.top + viewport.height * 0.35) / slotHeight) + 1),
      );
      setCurrentPage((prev) => (prev === approxPage ? prev : approxPage));
    }, [totalPages, viewport.top, viewport.height, slotHeight]);

    const topSpacerHeight = Math.max(0, (startPage - 1) * slotHeight);
    const bottomSpacerHeight = Math.max(0, (totalPages - endPage) * slotHeight);

    return (
      <div className="flex h-full min-h-0 flex-col bg-[#E9ECEF]">
        {/* Toolbar */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[#DEE2E6] bg-[#F8F9FA] px-3 py-1.5 text-xs text-[#495057]">
          <div className="font-mono-code font-semibold">
            {totalPages > 0
              ? pageCountLabel
                ? `${currentPage} / ${pageCountLabel(totalPages)}`
                : `${currentPage} / ${totalPages}`
              : "0 / 0"}
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                setZoomMode("manual");
                setManualScale((s) =>
                  Number(Math.max(0.4, (zoomMode === "fit" ? fitScale : s) - 0.15).toFixed(2)),
                );
              }}
              disabled={!filePath || totalPages === 0}
              title="Zoom out"
              className="flex h-6 w-6 items-center justify-center rounded-[4px] border border-[#CED4DA] bg-white text-[#343A40] hover:bg-[#E9ECEF] disabled:opacity-40"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <span className="w-12 text-center font-mono-code text-[11px] font-semibold">
              {zoomPct}%
            </span>
            <button
              type="button"
              onClick={() => {
                setZoomMode("manual");
                setManualScale((s) =>
                  Number(Math.min(3.0, (zoomMode === "fit" ? fitScale : s) + 0.15).toFixed(2)),
                );
              }}
              disabled={!filePath || totalPages === 0}
              title="Zoom in"
              className="flex h-6 w-6 items-center justify-center rounded-[4px] border border-[#CED4DA] bg-white text-[#343A40] hover:bg-[#E9ECEF] disabled:opacity-40"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setZoomMode("fit")}
              disabled={!filePath || totalPages === 0}
              title="Fit width"
              className={`ml-1 inline-flex h-6 items-center gap-1 rounded-[4px] border px-2 text-[11px] font-semibold ${
                zoomMode === "fit"
                  ? "border-[#007BFF] bg-[#E7F1FF] text-[#0056B3]"
                  : "border-[#CED4DA] bg-white text-[#343A40] hover:bg-[#E9ECEF]"
              } disabled:opacity-40`}
            >
              <Maximize2 className="h-3 w-3" />
              Fit
            </button>
          </div>
        </div>

        {/* Virtualized Continuous Scroll Pages */}
        <div
          ref={scrollRef}
          tabIndex={0}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
              e.preventDefault();
              e.stopPropagation();
              onOpenFind?.();
            }
          }}
          onScroll={handleScroll}
          className="relative flex-1 overscroll-contain overflow-y-auto overflow-x-auto p-4 focus:outline-none"
        >
          {loading && (
            <div className="sticky top-2 z-30 ml-auto mb-2 flex w-fit items-center gap-1.5 rounded-[4px] border border-[#B6D4FE] bg-[#E7F1FF]/95 px-2.5 py-1 text-xs font-semibold text-[#0056B3] shadow-sm">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>{loadingText}</span>
            </div>
          )}
          {error && (
            <div className="mb-3 rounded-[4px] border border-[#DC3545]/40 bg-[#F8D7DA] px-3 py-2 text-xs text-[#842029]">
              {error}
            </div>
          )}

          {filePath && totalPages > 0 ? (
            <div>
              {topSpacerHeight > 0 && <div style={{ height: `${topSpacerHeight}px` }} />}
              {visiblePages.map((pageNum) => (
                <LazyPreviewPage
                  key={`${filePath}-${pageNum}`}
                  pdfPath={filePath}
                  pageNumber={pageNum}
                  displayWidth={displayWidth}
                  pageHeight={pageHeight}
                  slotHeight={slotHeight}
                  renderWidth={renderWidth}
                  registerPageRef={registerPageRef}
                />
              ))}
              {bottomSpacerHeight > 0 && <div style={{ height: `${bottomSpacerHeight}px` }} />}
            </div>
          ) : (
            <div className="flex h-full min-h-[240px] items-center justify-center text-xs text-[#6C757D]">
              {loading ? loadingText : emptyText}
            </div>
          )}
        </div>
      </div>
    );
  },
);

PdfLazyFilePreview.displayName = "PdfLazyFilePreview";
