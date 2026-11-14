/// <reference types="vite/client" />
import React from "react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
import { Copy, CornerUpLeft, Loader2, Maximize2, ZoomIn, ZoomOut } from "lucide-react";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface PdfJsPreviewHandle {
  scrollToMatch: (globalMatchIndex: number) => void;
  setScrollRatio: (ratio: number) => void;
}

interface PdfJsPreviewProps {
  pdfBytes: Uint8Array | null;
  loading?: boolean;
  error?: string | null;
  emptyText: string;
  loadingText: string;
  pageCountLabel?: (total: number) => string;
  onPageCountChange?: (total: number) => void;
  searchQuery?: string;
  activeMatchIndex?: number | null;
  onSearchMatchCountChange?: (total: number) => void;
  copyTextLabel?: string;
  goToInEditorLabel?: string;
  onGoToInEditor?: (selectedText: string, occurrenceIndex: number) => void;
  onScrollRatioChange?: (ratio: number) => void;
  onOpenFind?: () => void;
}

interface PageSearchSpan {
  pageNumber: number;
  count: number;
  startGlobalIndex: number;
}

function getNormalizedSpansText(spans: HTMLSpanElement[]): {
  joined: string;
  spanRanges: { span: HTMLSpanElement; orig: string; start: number; end: number }[];
} {
  let joined = "";
  const spanRanges: { span: HTMLSpanElement; orig: string; start: number; end: number }[] = [];
  for (const span of spans) {
    if (span.dataset.knitOrigText === undefined) {
      span.dataset.knitOrigText = span.textContent ?? "";
    }
    const orig = span.dataset.knitOrigText;
    const start = joined.length;
    joined += orig;
    const end = joined.length;
    spanRanges.push({ span, orig, start, end });
  }
  return { joined, spanRanges };
}

function applySearchHighlightToTextLayer(
  textDiv: HTMLDivElement,
  query: string,
  activeLocalIndex: number | null,
): number {
  const spans = Array.from(textDiv.querySelectorAll("span"));
  if (spans.length === 0) return 0;

  const trimmedQuery = query.trim().toLowerCase();
  if (!trimmedQuery) {
    for (const span of spans) {
      if (span.dataset.knitOrigText !== undefined) {
        span.textContent = span.dataset.knitOrigText;
      }
    }
    return 0;
  }

  const { joined, spanRanges } = getNormalizedSpansText(spans);
  const lowerJoined = joined.toLowerCase();
  const matchIntervals: { start: number; end: number; matchIdx: number }[] = [];

  let cursor = 0;
  let matchIdx = 0;
  while (cursor <= lowerJoined.length - trimmedQuery.length) {
    const pos = lowerJoined.indexOf(trimmedQuery, cursor);
    if (pos === -1) break;
    matchIntervals.push({ start: pos, end: pos + trimmedQuery.length, matchIdx });
    matchIdx += 1;
    cursor = pos + Math.max(1, trimmedQuery.length);
  }

  let activeMarkEl: HTMLElement | null = null;

  for (const { span, orig, start, end } of spanRanges) {
    if (orig.length === 0) continue;
    const overlapping = matchIntervals.filter((m) => m.start < end && m.end > start);
    if (overlapping.length === 0) {
      if (span.textContent !== orig) {
        span.textContent = orig;
      }
      continue;
    }

    const frag = document.createDocumentFragment();
    let localPos = 0;
    for (const m of overlapping) {
      const sliceStart = Math.max(0, m.start - start);
      const sliceEnd = Math.min(orig.length, m.end - start);
      if (sliceStart > localPos) {
        frag.appendChild(document.createTextNode(orig.slice(localPos, sliceStart)));
      }
      const mark = document.createElement("mark");
      const isActive = activeLocalIndex === m.matchIdx;
      mark.textContent = orig.slice(sliceStart, sliceEnd);
      mark.style.backgroundColor = isActive
        ? "rgba(255, 136, 0, 0.55)"
        : "rgba(255, 213, 0, 0.48)";
      mark.style.color = "transparent";
      mark.style.borderRadius = "2px";
      if (isActive) {
        mark.style.outline = "1.5px solid #D97706";
        activeMarkEl = mark;
      }
      frag.appendChild(mark);
      localPos = sliceEnd;
    }
    if (localPos < orig.length) {
      frag.appendChild(document.createTextNode(orig.slice(localPos)));
    }
    span.replaceChildren(frag);
  }

  if (activeMarkEl) {
    activeMarkEl.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  return matchIntervals.length;
}

interface PdfPageCanvasProps {
  pdfDoc: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  containerEl: HTMLDivElement | null;
  searchQuery: string;
  activeLocalIndex: number | null;
  onVisible?: (pageNumber: number) => void;
  registerPageRef: (pageNumber: number, el: HTMLDivElement | null) => void;
}

const PdfPageCanvas: React.FC<PdfPageCanvasProps> = ({
  pdfDoc,
  pageNumber,
  scale,
  containerEl,
  searchQuery,
  activeLocalIndex,
  onVisible,
  registerPageRef,
}) => {
  const wrapperRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = React.useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = React.useState(pageNumber <= 3);
  const [textRenderedTick, setTextRenderedTick] = React.useState(0);
  const [dims, setDims] = React.useState<{ width: number; height: number }>({
    width: 600,
    height: 848,
  });

  const setWrapperRefs = React.useCallback(
    (el: HTMLDivElement | null) => {
      wrapperRef.current = el;
      registerPageRef(pageNumber, el);
    },
    [pageNumber, registerPageRef],
  );

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
        if (!cancelled) {
          setTextRenderedTick((n) => n + 1);
        }
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

  // Apply search highlights to rendered textLayer whenever query / active match / textLayer updates
  React.useEffect(() => {
    const textDiv = textLayerRef.current;
    if (!textDiv || textRenderedTick === 0) return;
    applySearchHighlightToTextLayer(textDiv, searchQuery, activeLocalIndex);
  }, [searchQuery, activeLocalIndex, textRenderedTick]);

  return (
    <div className="flex flex-col items-center">
      <div
        ref={setWrapperRefs}
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

export const PdfJsPreview = React.forwardRef<PdfJsPreviewHandle, PdfJsPreviewProps>(
  (
    {
      pdfBytes,
      loading = false,
      error = null,
      emptyText,
      loadingText,
      pageCountLabel,
      onPageCountChange,
      searchQuery = "",
      activeMatchIndex = null,
      onSearchMatchCountChange,
      copyTextLabel,
      goToInEditorLabel,
      onGoToInEditor,
      onScrollRatioChange,
      onOpenFind,
    },
    ref,
  ) => {
    const scrollRef = React.useRef<HTMLDivElement | null>(null);
    const pageWrapperRefs = React.useRef<Map<number, HTMLDivElement>>(new Map());
    const [pdfDoc, setPdfDoc] = React.useState<PDFDocumentProxy | null>(null);
    const [numPages, setNumPages] = React.useState(0);
    const [currentPage, setCurrentPage] = React.useState(1);
    const [zoomMode, setZoomMode] = React.useState<"fit" | "manual">("fit");
    const [manualScale, setManualScale] = React.useState(1.1);
    const [fitScale, setFitScale] = React.useState(1.0);
    const [basePageWidth, setBasePageWidth] = React.useState(595);
    const [parseError, setParseError] = React.useState<string | null>(null);

    const [pageSearchSpans, setPageSearchSpans] = React.useState<PageSearchSpan[]>([]);
    const [contextMenu, setContextMenu] = React.useState<{
      x: number;
      y: number;
      selectedText: string;
      pageNumber: number;
    } | null>(null);

    const registerPageRef = React.useCallback((pageNumber: number, el: HTMLDivElement | null) => {
      if (el) {
        pageWrapperRefs.current.set(pageNumber, el);
      } else {
        pageWrapperRefs.current.delete(pageNumber);
      }
    }, []);

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

    // Count matches across all pages whenever pdfDoc or searchQuery changes
    React.useEffect(() => {
      const q = searchQuery.trim().toLowerCase();
      if (!pdfDoc || !q) {
        setPageSearchSpans([]);
        onSearchMatchCountChange?.(0);
        return;
      }

      let cancelled = false;
      const run = async () => {
        const spans: PageSearchSpan[] = [];
        let running = 0;
        for (let p = 1; p <= pdfDoc.numPages; p++) {
          if (cancelled) return;
          try {
            const page = await pdfDoc.getPage(p);
            const tc = await page.getTextContent();
            const rawJoined = tc.items
              .map((it) => ("str" in it ? it.str : ""))
              .join("");
            const lower = rawJoined.toLowerCase();
            let count = 0;
            let idx = 0;
            while (idx <= lower.length - q.length) {
              const found = lower.indexOf(q, idx);
              if (found === -1) break;
              count += 1;
              idx = found + Math.max(1, q.length);
            }
            if (count > 0) {
              spans.push({ pageNumber: p, count, startGlobalIndex: running });
              running += count;
            }
          } catch {
            // skip page error
          }
        }
        if (!cancelled) {
          setPageSearchSpans(spans);
          onSearchMatchCountChange?.(running);
        }
      };

      void run();
      return () => {
        cancelled = true;
      };
    }, [pdfDoc, searchQuery, onSearchMatchCountChange]);

    const scrollToMatch = React.useCallback(
      (globalIdx: number) => {
        const hit = pageSearchSpans.find(
          (s) => globalIdx >= s.startGlobalIndex && globalIdx < s.startGlobalIndex + s.count,
        );
        if (!hit) return;
        const wrapper = pageWrapperRefs.current.get(hit.pageNumber);
        wrapper?.scrollIntoView({ block: "center", behavior: "smooth" });
      },
      [pageSearchSpans],
    );

    React.useImperativeHandle(
      ref,
      () => ({
        scrollToMatch,
        setScrollRatio: (ratio: number) => {
          const el = scrollRef.current;
          if (!el) return;
          const maxScroll = el.scrollHeight - el.clientHeight;
          if (maxScroll > 0) {
            el.scrollTop = Math.min(1, Math.max(0, ratio)) * maxScroll;
          }
        },
      }),
      [scrollToMatch],
    );

    // Dismiss custom context menu on click, escape, or scroll
    React.useEffect(() => {
      if (!contextMenu) return;
      const close = () => setContextMenu(null);
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key === "Escape") close();
      };
      window.addEventListener("mousedown", close);
      window.addEventListener("keydown", onKey);
      return () => {
        window.removeEventListener("mousedown", close);
        window.removeEventListener("keydown", onKey);
      };
    }, [contextMenu]);

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
      setManualScale((s) =>
        Number(Math.max(0.4, (zoomMode === "fit" ? fitScale : s) - 0.15).toFixed(2)),
      );
    };

    const handleZoomIn = () => {
      setZoomMode("manual");
      setManualScale((s) =>
        Number(Math.min(2.5, (zoomMode === "fit" ? fitScale : s) + 0.15).toFixed(2)),
      );
    };

    const handleFitWidth = () => {
      setZoomMode("fit");
    };

    const handlePreviewContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
      const sel = window.getSelection();
      const selected = sel?.toString().trim() ?? "";
      if (!selected) {
        setContextMenu(null);
        return;
      }
      e.preventDefault();
      let pageNumber = currentPage;
      const anchorNode = sel?.anchorNode;
      const anchorEl =
        anchorNode instanceof HTMLElement ? anchorNode : anchorNode?.parentElement;
      const pageHost = anchorEl?.closest<HTMLElement>("[data-page-number]");
      if (pageHost?.dataset.pageNumber) {
        const parsed = Number.parseInt(pageHost.dataset.pageNumber, 10);
        if (!Number.isNaN(parsed)) pageNumber = parsed;
      }
      setContextMenu({
        x: Math.min(e.clientX, window.innerWidth - 220),
        y: Math.min(e.clientY, window.innerHeight - 90),
        selectedText: selected,
        pageNumber,
      });
    };

    const resolveOccurrenceIndex = async (snippet: string, targetPage: number): Promise<number> => {
      if (!pdfDoc) return 0;
      const needle = snippet.replace(/\s+/g, " ").toLowerCase();
      if (!needle) return 0;
      let countBefore = 0;
      for (let p = 1; p < targetPage; p++) {
        try {
          const page = await pdfDoc.getPage(p);
          const tc = await page.getTextContent();
          const joined = tc.items
            .map((it) => ("str" in it ? it.str : ""))
            .join("")
            .replace(/\s+/g, " ")
            .toLowerCase();
          let idx = 0;
          while (idx <= joined.length - needle.length) {
            const found = joined.indexOf(needle, idx);
            if (found === -1) break;
            countBefore += 1;
            idx = found + Math.max(1, needle.length);
          }
        } catch {
          // ignore
        }
      }
      return countBefore;
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
          tabIndex={0}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
              e.preventDefault();
              e.stopPropagation();
              onOpenFind?.();
            }
          }}
          onContextMenu={handlePreviewContextMenu}
          onScroll={(e) => {
            if (contextMenu) setContextMenu(null);
            const el = e.currentTarget;
            const maxScroll = el.scrollHeight - el.clientHeight;
            onScrollRatioChange?.(maxScroll > 0 ? el.scrollTop / maxScroll : 0);
          }}
          className="relative flex-1 overflow-y-auto overflow-x-auto p-4 focus:outline-none"
        >
          {loading && pdfDoc && (
            <div className="sticky top-2 z-30 ml-auto mb-2 flex w-fit items-center gap-1.5 rounded-[4px] border border-[#B6D4FE] bg-[#E7F1FF]/95 px-2.5 py-1 text-xs font-semibold text-[#0056B3] shadow-sm">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>{loadingText}</span>
            </div>
          )}
          {(error || parseError) && (
            <div className="mb-3 rounded-[4px] border border-[#DC3545]/40 bg-[#F8D7DA] px-3 py-2 text-xs text-[#842029]">
              {error || parseError}
            </div>
          )}

          {pdfDoc ? (
            <div className="space-y-4">
              {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => {
                const hit = pageSearchSpans.find((s) => s.pageNumber === pageNum);
                const activeLocal =
                  hit &&
                  activeMatchIndex !== null &&
                  activeMatchIndex >= hit.startGlobalIndex &&
                  activeMatchIndex < hit.startGlobalIndex + hit.count
                    ? activeMatchIndex - hit.startGlobalIndex
                    : null;
                return (
                  <div key={`${numPages}-${pageNum}`} data-page-number={pageNum}>
                    <PdfPageCanvas
                      pdfDoc={pdfDoc}
                      pageNumber={pageNum}
                      scale={activeScale}
                      containerEl={scrollRef.current}
                      searchQuery={searchQuery}
                      activeLocalIndex={activeLocal}
                      onVisible={setCurrentPage}
                      registerPageRef={registerPageRef}
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex h-full min-h-[240px] items-center justify-center text-xs text-[#6C757D]">
              {loading ? loadingText : emptyText}
            </div>
          )}
        </div>

        {/* Context Menu for Copy + "Go to in Editor" */}
        {contextMenu && (
          <div
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onMouseDown={(e) => e.stopPropagation()}
            className="fixed z-50 min-w-[190px] rounded-[4px] border border-[#CED4DA] bg-white py-1 shadow-md"
          >
            <button
              type="button"
              onClick={() => {
                const snippet = contextMenu.selectedText;
                setContextMenu(null);
                void navigator.clipboard?.writeText(snippet);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-semibold text-[#212529] hover:bg-[#E7F1FF] hover:text-[#0056B3]"
            >
              <Copy className="h-3.5 w-3.5 text-[#495057]" />
              <span>{copyTextLabel ?? "Copy"}</span>
            </button>
            {onGoToInEditor && (
              <button
                type="button"
                onClick={() => {
                  const { selectedText, pageNumber } = contextMenu;
                  setContextMenu(null);
                  void resolveOccurrenceIndex(selectedText, pageNumber).then((occIdx) => {
                    onGoToInEditor(selectedText, occIdx);
                  });
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs font-semibold text-[#212529] hover:bg-[#E7F1FF] hover:text-[#0056B3]"
              >
                <CornerUpLeft className="h-3.5 w-3.5 text-[#007BFF]" />
                <span>{goToInEditorLabel ?? "Go to in Editor"}</span>
              </button>
            )}
          </div>
        )}
      </div>
    );
  },
);

PdfJsPreview.displayName = "PdfJsPreview";
