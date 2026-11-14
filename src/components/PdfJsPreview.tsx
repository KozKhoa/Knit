/// <reference types="vite/client" />
import React from "react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PdfJsPreviewProps {
  pdfBytes: Uint8Array | null;
  loading?: boolean;
  error?: string | null;
  emptyText: string;
  loadingText: string;
  pageCountLabel?: (total: number) => string;
  onPageCountChange?: (total: number) => void;
}

interface PdfPageCanvasProps {
  pdfDoc: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  containerEl: HTMLDivElement | null;
  onVisible?: (pageNumber: number) => void;
}

const PdfPageCanvas: React.FC<PdfPageCanvasProps> = ({
  pdfDoc,
  pageNumber,
  scale,
  containerEl,
  onVisible,
}) => {
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = React.useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = React.useState(pageNumber <= 3);
  const [dims, setDims] = React.useState<{ width: number; height: number }>({
    width: 600,
    height: 848,
  });

  // Track visibility inside scroll container for lazy rendering
  React.useEffect(() => {
    const el = wrapperRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            if (entry.intersectionRatio >= 0.35) {
              onVisible?.(pageNumber);
            }
          }
        }
      },
      {
        root: containerEl,
        rootMargin: "450px 0px",
        threshold: [0, 0.35],
      },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [containerEl, pageNumber, onVisible]);

  // Render canvas + TextLayer when visible or scale/doc changes
  React.useEffect(() => {
    let cancelled = false;
    let renderTask: RenderTask | null = null;
    let textLayer: pdfjsLib.TextLayer | null = null;
    let pageObj: PDFPageProxy | null = null;

    const run = async () => {
      try {
        pageObj = await pdfDoc.getPage(pageNumber);
        if (cancelled) return;
        const viewport = pageObj.getViewport({ scale });
        setDims({ width: viewport.width, height: viewport.height });

        if (!inView) return;

        const canvas = canvasRef.current;
        const textDiv = textLayerRef.current;
        if (!canvas || !textDiv) return;

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        renderTask = pageObj.render({
          canvas,
          canvasContext: ctx,
          viewport,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        });
        await renderTask.promise;
        if (cancelled) return;

        textDiv.replaceChildren();
        textDiv.style.setProperty("--scale-factor", String(scale));
        textDiv.style.width = `${viewport.width}px`;
        textDiv.style.height = `${viewport.height}px`;

        textLayer = new pdfjsLib.TextLayer({
          textContentSource: pageObj.streamTextContent(),
          container: textDiv,
          viewport,
        });
        await textLayer.render();
      } catch {
        // Ignore cancellation errors during rapid re-renders
      }
    };

    void run();

    return () => {
      cancelled = true;
      try {
        renderTask?.cancel();
      } catch {
        // ignore
      }
      try {
        textLayer?.cancel();
      } catch {
        // ignore
      }
    };
  }, [pdfDoc, pageNumber, scale, inView]);

  return (
    <div className="flex flex-col items-center">
      <div
        ref={wrapperRef}
        style={{ width: dims.width, height: dims.height }}
        className="relative overflow-hidden rounded-[2px] border border-[#CED4DA] bg-white shadow-sm"
      >
        <canvas ref={canvasRef} className="block" />
        <div ref={textLayerRef} className="textLayer" />
      </div>
      <div className="mt-1 font-mono-code text-[11px] text-[#6C757D]">
        {pageNumber}
      </div>
    </div>
  );
};

export const PdfJsPreview: React.FC<PdfJsPreviewProps> = ({
  pdfBytes,
  loading = false,
  error = null,
  emptyText,
  loadingText,
  pageCountLabel,
  onPageCountChange,
}) => {
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const [pdfDoc, setPdfDoc] = React.useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = React.useState(0);
  const [currentPage, setCurrentPage] = React.useState(1);
  const [zoomMode, setZoomMode] = React.useState<"fit" | "manual">("fit");
  const [manualScale, setManualScale] = React.useState(1.1);
  const [fitScale, setFitScale] = React.useState(1.0);
  const [basePageWidth, setBasePageWidth] = React.useState(595);
  const [parseError, setParseError] = React.useState<string | null>(null);

  // Load PDFDocumentProxy whenever pdfBytes changes
  React.useEffect(() => {
    if (!pdfBytes || pdfBytes.byteLength === 0) {
      setPdfDoc((prev) => {
        if (prev) void prev.cleanup();
        return null;
      });
      setNumPages(0);
      setCurrentPage(1);
      onPageCountChange?.(0);
      return;
    }

    let cancelled = false;
    setParseError(null);
    const loadingTask = pdfjsLib.getDocument({ data: pdfBytes.slice() });

    loadingTask.promise
      .then(async (doc) => {
        if (cancelled) {
          void doc.cleanup();
          return;
        }
        try {
          const firstPage = await doc.getPage(1);
          const vp = firstPage.getViewport({ scale: 1.0 });
          if (!cancelled && vp.width > 0) {
            setBasePageWidth(vp.width);
          }
        } catch {
          // keep default basePageWidth
        }
        if (cancelled) {
          void doc.cleanup();
          return;
        }
        setPdfDoc((prev) => {
          if (prev && prev !== doc) void prev.cleanup();
          return doc;
        });
        setNumPages(doc.numPages);
        setCurrentPage((p) => Math.min(Math.max(1, p), doc.numPages));
        onPageCountChange?.(doc.numPages);
      })
      .catch((err) => {
        if (!cancelled) {
          setParseError(String(err));
        }
      });

    return () => {
      cancelled = true;
      void loadingTask.destroy();
    };
  }, [pdfBytes, onPageCountChange]);

  // Compute fit-width scale whenever container resizes
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el || basePageWidth <= 0) return;

    const recompute = () => {
      const avail = Math.max(240, el.clientWidth - 36);
      setFitScale(Number(Math.min(2.2, Math.max(0.45, avail / basePageWidth)).toFixed(3)));
    };
    recompute();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", recompute);
      return () => window.removeEventListener("resize", recompute);
    }
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [basePageWidth]);

  const activeScale = zoomMode === "fit" ? fitScale : manualScale;
  const zoomPct = Math.round(activeScale * 100);

  const handleZoomOut = () => {
    setZoomMode("manual");
    setManualScale((s) => Number(Math.max(0.4, (zoomMode === "fit" ? fitScale : s) - 0.15).toFixed(2)));
  };

  const handleZoomIn = () => {
    setZoomMode("manual");
    setManualScale((s) => Number(Math.min(2.5, (zoomMode === "fit" ? fitScale : s) + 0.15).toFixed(2)));
  };

  const handleFitWidth = () => {
    setZoomMode("fit");
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#E9ECEF]">
      {/* Preview Toolbar */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[#DEE2E6] bg-[#F8F9FA] px-3 py-1.5 text-xs text-[#495057]">
        <div className="font-mono-code font-semibold">
          {numPages > 0
            ? pageCountLabel
              ? `${currentPage} / ${pageCountLabel(numPages)}`
              : `${currentPage} / ${numPages}`
            : "0 / 0"}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleZoomOut}
            disabled={!pdfDoc}
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
            onClick={handleZoomIn}
            disabled={!pdfDoc}
            title="Zoom in"
            className="flex h-6 w-6 items-center justify-center rounded-[4px] border border-[#CED4DA] bg-white text-[#343A40] hover:bg-[#E9ECEF] disabled:opacity-40"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={handleFitWidth}
            disabled={!pdfDoc}
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

      {/* Continuous Scroll Pages */}
      <div
        ref={scrollRef}
        className="relative flex-1 overflow-y-auto overflow-x-auto p-4"
      >
        {(error || parseError) && (
          <div className="mb-3 rounded-[4px] border border-[#DC3545]/40 bg-[#F8D7DA] px-3 py-2 text-xs text-[#842029]">
            {error || parseError}
          </div>
        )}

        {pdfDoc ? (
          <div className="space-y-4">
            {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => (
              <PdfPageCanvas
                key={`${numPages}-${pageNum}`}
                pdfDoc={pdfDoc}
                pageNumber={pageNum}
                scale={activeScale}
                containerEl={scrollRef.current}
                onVisible={setCurrentPage}
              />
            ))}
          </div>
        ) : (
          <div className="flex h-full min-h-[240px] items-center justify-center text-xs text-[#6C757D]">
            {loading ? loadingText : emptyText}
          </div>
        )}
      </div>
    </div>
  );
};
