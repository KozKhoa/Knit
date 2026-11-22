import React from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { FileText, Loader2, Maximize2, X, ZoomIn, ZoomOut } from "lucide-react";
import { useI18n } from "../i18n";
import {
  formatBytes,
  isTauriRuntime,
  releasePdfCachedFiles,
  renderPdfPagePreviewFile,
} from "../lib/ipc";
import type { PdfInfo } from "../types/ipc";

interface PdfFilePreviewModalProps {
  pdfInfo: PdfInfo | null;
  onClose: () => void;
}

interface LazyPdfModalPageProps {
  pdfPath: string;
  pageNumber: number;
  containerEl: HTMLDivElement | null;
  displayWidth: number;
  renderWidth: number;
  onVisible: (pageNumber: number) => void;
}

const LazyPdfModalPage: React.FC<LazyPdfModalPageProps> = ({
  pdfPath,
  pageNumber,
  containerEl,
  displayWidth,
  renderWidth,
  onVisible,
}) => {
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = React.useState(pageNumber <= 2);
  const [srcUrl, setSrcUrl] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    const el = wrapperRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          setInView(entry.isIntersecting);
          if (entry.isIntersecting && entry.intersectionRatio >= 0.25) {
            onVisible(pageNumber);
          }
        }
      },
      {
        root: containerEl,
        rootMargin: "650px 0px",
        threshold: [0, 0.25],
      },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [containerEl, pageNumber, onVisible]);

  React.useEffect(() => {
    if (!inView || !isTauriRuntime()) {
      setSrcUrl(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
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

    return () => {
      cancelled = true;
    };
  }, [inView, pdfPath, pageNumber, renderWidth]);

  const minHeight = Math.round(displayWidth * 1.38);

  return (
    <div className="flex flex-col items-center">
      <div
        ref={wrapperRef}
        data-page-number={pageNumber}
        style={{
          width: `${displayWidth}px`,
          minHeight: srcUrl ? undefined : `${minHeight}px`,
        }}
        className="relative flex items-center justify-center overflow-hidden rounded-[2px] border border-[#CED4DA] bg-white shadow-sm"
      >
        {inView && srcUrl ? (
          <img
            src={srcUrl}
            alt={`Page ${pageNumber}`}
            decoding="async"
            draggable={false}
            className="block h-auto w-full select-none"
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
};

export const PdfFilePreviewModal: React.FC<PdfFilePreviewModalProps> = ({
  pdfInfo,
  onClose,
}) => {
  const { t } = useI18n();
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const [scrollEl, setScrollEl] = React.useState<HTMLDivElement | null>(null);
  const [currentPage, setCurrentPage] = React.useState(1);
  const [zoomMode, setZoomMode] = React.useState<"fit" | "manual">("fit");
  const [manualScale, setManualScale] = React.useState(1.0);
  const [fitScale, setFitScale] = React.useState(1.0);

  const setScrollContainerRef = React.useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el;
    setScrollEl(el);
  }, []);

  // Giải phóng bộ nhớ RAM ngay khi đóng modal xem trước PDF lớn
  React.useEffect(() => {
    if (!pdfInfo) return;
    setCurrentPage(1);
    setZoomMode("fit");
    return () => {
      void releasePdfCachedFiles([]);
    };
  }, [pdfInfo]);

  React.useEffect(() => {
    if (!pdfInfo) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [pdfInfo, onClose]);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const recompute = () => {
      const avail = Math.max(240, el.clientWidth - 48);
      setFitScale(Number(Math.min(2.2, Math.max(0.45, avail / 680)).toFixed(3)));
    };
    recompute();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", recompute);
      return () => window.removeEventListener("resize", recompute);
    }
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pdfInfo]);

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
  }, [pdfInfo]);

  const handleClose = React.useCallback(() => {
    void releasePdfCachedFiles([]);
    onClose();
  }, [onClose]);

  if (!pdfInfo) return null;

  const fileName = pdfInfo.path.split(/[\\/]/).pop() ?? pdfInfo.path;
  const activeScale = zoomMode === "fit" ? fitScale : manualScale;
  const zoomPct = Math.round(activeScale * 100);
  const displayWidth = Math.max(240, Math.round(680 * activeScale));
  const renderWidth = activeScale > 1.25 ? 1440 : 960;

  return (
    <div
      onClick={handleClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="flex h-[90vh] w-[92vw] max-w-[1280px] flex-col overflow-hidden rounded-[4px] border border-[#CED4DA] bg-white shadow-2xl"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#DEE2E6] bg-[#F8F9FA] px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 shrink-0 text-[#007BFF]" />
              <span className="truncate text-sm font-bold text-[#212529]">{fileName}</span>
              <span className="rounded-[4px] bg-[#E9ECEF] px-2 py-0.5 font-mono-code text-xs font-semibold text-[#495057]">
                {pdfInfo.page_count} p.
              </span>
              {pdfInfo.file_size_bytes > 0 && (
                <span className="font-mono-code text-xs text-[#6C757D]">
                  {formatBytes(pdfInfo.file_size_bytes)}
                </span>
              )}
            </div>
            <div
              title={pdfInfo.path}
              className="font-mono-code mt-0.5 truncate text-[11px] text-[#495057]"
            >
              {pdfInfo.path}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <span className="mr-2 font-mono-code text-xs font-semibold text-[#495057]">
              {pdfInfo.page_count > 0 ? `${currentPage} / ${pdfInfo.page_count}` : "0 / 0"}
            </span>
            <button
              type="button"
              onClick={() => {
                setZoomMode("manual");
                setManualScale((s) =>
                  Number(Math.max(0.4, (zoomMode === "fit" ? fitScale : s) - 0.15).toFixed(2)),
                );
              }}
              title="Zoom out"
              className="flex h-7 w-7 items-center justify-center rounded-[4px] border border-[#CED4DA] bg-white text-[#343A40] hover:bg-[#E9ECEF]"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <span className="w-12 text-center font-mono-code text-xs font-semibold text-[#343A40]">
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
              title="Zoom in"
              className="flex h-7 w-7 items-center justify-center rounded-[4px] border border-[#CED4DA] bg-white text-[#343A40] hover:bg-[#E9ECEF]"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setZoomMode("fit")}
              title="Fit width"
              className={`inline-flex h-7 items-center gap-1 rounded-[4px] border px-2 text-xs font-semibold ${
                zoomMode === "fit"
                  ? "border-[#007BFF] bg-[#E7F1FF] text-[#0056B3]"
                  : "border-[#CED4DA] bg-white text-[#343A40] hover:bg-[#E9ECEF]"
              }`}
            >
              <Maximize2 className="h-3 w-3" />
              Fit
            </button>
            <button
              type="button"
              onClick={handleClose}
              aria-label={t.common.close}
              className="ml-1 rounded-[4px] p-1.5 text-[#6C757D] hover:bg-[#E9ECEF] hover:text-[#212529]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div
          ref={setScrollContainerRef}
          tabIndex={0}
          className="relative flex-1 overflow-y-auto overflow-x-auto bg-[#E9ECEF] p-4 focus:outline-none"
        >
          <div className="space-y-4">
            {Array.from({ length: pdfInfo.page_count }, (_, i) => i + 1).map((pageNum) => (
              <LazyPdfModalPage
                key={`${pdfInfo.path}-${pageNum}`}
                pdfPath={pdfInfo.path}
                pageNumber={pageNum}
                containerEl={scrollEl}
                displayWidth={displayWidth}
                renderWidth={renderWidth}
                onVisible={setCurrentPage}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
