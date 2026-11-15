import React from "react";
import { NumberInput } from "../components/NumberInput";
import { Select } from "../components/Select";
import { Slider } from "../components/Slider";
import {
  AlertTriangle,
  Edit3,
  FileOutput,
  GripVertical,
  Layers,
  PanelRightClose,
  PanelRightOpen,
  RotateCw,
  Trash2,
  X,
} from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { BookmarkTreeEditor } from "../components/BookmarkTreeEditor";
import { Dropzone } from "../components/Dropzone";
import { ImageCanvasEditorModal } from "../components/ImageCanvasEditorModal";
import { useI18n } from "../i18n";
import {
  computeVisibleRowRange,
  hitTestGridInsertIndex,
  IMAGE_GRID_GAP_PX,
  mergeThumbCacheLru,
  THUMB_CACHE_MAX_ENTRIES,
} from "../lib/imageGrid";
import {
  buildImage2Pdf,
  isTauriRuntime,
  pickDirectory,
  pickFiles,
  pickSaveFile,
  renderImageThumbBase64,
  renderImageThumbFile,
  renderPageDraftPreviewFile,
  scanImagesForPdf,
} from "../lib/ipc";
import {
  ArrowDownAZ,
  ArrowUpAZ,
  Undo2,
} from "lucide-react";
import {
  hasPageEdits,
  pageEditSignature,
  sortPageDrafts,
  type ImageSortMode,
  type SortDirection,
} from "../lib/imageSort";
import { usePersistentState } from "../lib/storage";
import type {
  AnimatedImagePolicy,
  BookmarkNode,
  Image2PdfConfig,
  JobEvent,
  PageBackground,
  PageDraft,
  PageLayoutPolicy,
} from "../types/ipc";

export interface DroppedBatch {
  seq: number;
  paths: string[];
}

interface Image2PdfViewProps {
  onStartJob: (jobId: string, label: string) => void;
  onJobEvent: (ev: JobEvent) => void;
  onFinishJob: (
    title: string,
    outputs: string[],
    summary: string,
    status: "success" | "error" | "cancelled",
  ) => void;
  busy: boolean;
  droppedBatch?: DroppedBatch | null;
}

type BgMode = "transparent" | "white" | "black" | "custom";
type MarginUnit = "pt" | "mm";

const PT_PER_MM = 72 / 25.4;
const GRID_COL_OPTIONS = [2, 3, 4, 5, 6] as const;

interface PageCardProps {
  page: PageDraft;
  idx: number;
  thumbUrl: string | undefined;
  thumbBakedSig: string | undefined;
  thumbBakedRot: number;
  loadThumbs: boolean;
  isDragged: boolean;
  isDraggingAny: boolean;
  showBarLeft: boolean;
  showBarEnd: boolean;
  editedBadgeLabel: string;
  rotateTitle: string;
  editBtnLabel: string;
  editBtnTitle: string;
  deletePageTitle: string;
  onRegisterRef: (id: string, el: HTMLDivElement | null) => void;
  onPointerDownCard: (e: React.PointerEvent<HTMLDivElement>, idx: number) => void;
  onDoubleClickCard: (e: React.MouseEvent<HTMLDivElement>, pageId: string) => void;
  onRotate: (id: string) => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
}

const PageCard: React.FC<PageCardProps> = React.memo(
  ({
    page,
    idx,
    thumbUrl,
    thumbBakedSig,
    thumbBakedRot,
    loadThumbs,
    isDragged,
    isDraggingAny,
    showBarLeft,
    showBarEnd,
    editedBadgeLabel,
    rotateTitle,
    editBtnLabel,
    editBtnTitle,
    deletePageTitle,
    onRegisterRef,
    onPointerDownCard,
    onDoubleClickCard,
    onRotate,
    onEdit,
    onRemove,
  }) => {
    const hasEdits = hasPageEdits(page);
    const sigMatches = thumbBakedSig === pageEditSignature(page);
    const displayRotDeg = sigMatches
      ? 0
      : (((page.rotation_deg - thumbBakedRot) % 360) + 360) % 360;
    const isQuarterRotated = Math.abs(displayRotDeg % 180) === 90;

    const cardRefCb = React.useCallback(
      (el: HTMLDivElement | null) => {
        onRegisterRef(page.id, el);
      },
      [page.id, onRegisterRef],
    );

    const handlePointerDown = React.useCallback(
      (e: React.PointerEvent<HTMLDivElement>) => {
        onPointerDownCard(e, idx);
      },
      [onPointerDownCard, idx],
    );

    const handleDoubleClick = React.useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        onDoubleClickCard(e, page.id);
      },
      [onDoubleClickCard, page.id],
    );

    return (
      <div
        data-page-id={page.id}
        ref={cardRefCb}
        onPointerDown={handlePointerDown}
        onDoubleClick={handleDoubleClick}
        className="relative"
      >
        {showBarLeft && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -left-[9px] bottom-0 top-0 z-30 w-1.5 rounded-full bg-[#007BFF] shadow-[0_0_8px_rgba(0,123,255,0.75)]"
          />
        )}
        {showBarEnd && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-[9px] bottom-0 top-0 z-30 w-1.5 rounded-full bg-[#007BFF] shadow-[0_0_8px_rgba(0,123,255,0.75)]"
          />
        )}

        <div
          className={`flex flex-col overflow-hidden rounded-[4px] border border-[#DEE2E6] bg-white ${
            isDraggingAny ? "cursor-grabbing" : "cursor-grab"
          } ${isDragged ? "opacity-40 ring-2 ring-[#007BFF]" : "opacity-100"}`}
        >
          {loadThumbs && (
            <div className="relative flex h-36 items-center justify-center overflow-hidden bg-[#F1F3F5] p-2">
              {thumbUrl ? (
                <img
                  src={thumbUrl}
                  alt={page.label}
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  className={`pointer-events-none object-contain ${
                    isQuarterRotated
                      ? "max-h-[112px] max-w-[112px]"
                      : "max-h-full max-w-full"
                  }`}
                  style={displayRotDeg !== 0 ? { transform: `rotate(${displayRotDeg}deg)` } : undefined}
                />
              ) : (
                <Layers className="h-6 w-6 text-[#ADB5BD]" />
              )}
              <span className="absolute left-1.5 top-1.5 flex items-center gap-0.5 rounded-[4px] bg-[#343A40] px-1.5 py-0.5 font-mono-code text-[11px] text-white">
                <GripVertical className="h-3 w-3 opacity-80" />#{idx + 1}
              </span>
              {hasEdits && (
                <span className="absolute right-1.5 top-1.5 rounded-[4px] bg-[#17A2B8] px-1.5 py-0.5 text-[11px] font-semibold text-white">
                  {editedBadgeLabel}
                </span>
              )}
            </div>
          )}
          <div className="border-t border-[#DEE2E6] p-2">
            <div
              className="truncate text-sm font-semibold text-[#212529]"
              title={page.label}
            >
              {page.label}
            </div>
            <div className="font-mono-code text-xs text-[#6C757D]">
              {page.width_px}x{page.height_px}
              {page.duration_ms ? ` · ${page.duration_ms}ms` : ""}
            </div>
            <div className="mt-2 flex items-center justify-between gap-1">
              <button
                type="button"
                onClick={() => onRotate(page.id)}
                className="rounded-[4px] border border-[#DEE2E6] p-1 text-[#495057] hover:bg-[#F8F9FA]"
                title={rotateTitle}
              >
                <RotateCw className="h-3.5 w-3.5" />
              </button>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={!loadThumbs}
                  onClick={() => onEdit(page.id)}
                  className="rounded-[4px] border border-[#007BFF] px-2 py-0.5 text-xs font-semibold text-[#007BFF] hover:bg-[#007BFF] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                  title={editBtnTitle}
                >
                  <Edit3 className="mr-0.5 inline h-3 w-3" />
                  {editBtnLabel}
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(page.id)}
                  className="rounded-[4px] p-1 text-[#DC3545] hover:bg-[#F8D7DA]"
                  title={deletePageTitle}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  },
);

export const Image2PdfView: React.FC<Image2PdfViewProps> = ({
  onStartJob,
  onJobEvent,
  onFinishJob,
  busy,
  droppedBatch,
}) => {
  const { t } = useI18n();

  const [pages, setPages] = React.useState<PageDraft[]>([]);
  const [bookmarks, setBookmarks] = React.useState<BookmarkNode[]>([]);
  const [thumbCache, setThumbCache] = React.useState<Record<string, string>>({});
  const [thumbMetaCache, setThumbMetaCache] = React.useState<
    Record<string, { sig: string; bakedRot: number }>
  >({});
  const [hiResCache, setHiResCache] = React.useState<Record<string, string>>({});
  const [editedPreviewCache, setEditedPreviewCache] = React.useState<Record<string, string>>({});
  const [previewPageId, setPreviewPageId] = React.useState<string | null>(null);
  const [editingPageId, setEditingPageId] = React.useState<string | null>(null);
  const [showBookmarks, setShowBookmarks] = usePersistentState<boolean>(
    "knit.img2pdf.showBookmarks",
    true,
  );
  const [loadThumbs, setLoadThumbs] = usePersistentState<boolean>(
    "knit.img2pdf.loadThumbs",
    true,
  );

  const [layoutMode, setLayoutMode] = usePersistentState<"original_size" | "fit_a4" | "fit_letter">(
    "knit.img2pdf.layoutMode",
    "original_size",
  );
  const [dpi, setDpi] = usePersistentState<number>("knit.img2pdf.dpi", 72);
  const [marginValue, setMarginValue] = usePersistentState<number>("knit.img2pdf.marginValue", 24);
  const [marginUnit, setMarginUnit] = usePersistentState<MarginUnit>("knit.img2pdf.marginUnit", "pt");
  const [bgMode, setBgMode] = usePersistentState<BgMode>("knit.img2pdf.bgMode", "white");
  const [bgCustomHex, setBgCustomHex] = usePersistentState<string>(
    "knit.img2pdf.bgCustomHex",
    "#F8F9FA",
  );
  const [jpegQuality, setJpegQuality] = usePersistentState<number>("knit.img2pdf.jpegQuality", 88);
  const [losslessPassthrough, setLosslessPassthrough] = usePersistentState<boolean>(
    "knit.img2pdf.losslessPassthrough",
    true,
  );
  const [animatedPolicy, setAnimatedPolicy] = usePersistentState<AnimatedImagePolicy>(
    "knit.img2pdf.animatedPolicy",
    "first_frame_only",
  );
  const [maxMb, setMaxMb] = usePersistentState<string>("knit.img2pdf.maxMb", "");
  const [splitMode, setSplitMode] = usePersistentState<"none" | "max_mb" | "max_pages_per_file">(
    "knit.img2pdf.splitMode",
    maxMb.trim() !== "" && Number(maxMb) > 0 ? "max_mb" : "none",
  );
  const [maxPagesPerFile, setMaxPagesPerFile] = usePersistentState<number>(
    "knit.img2pdf.maxPagesPerFile",
    50,
  );
  const [sortMode, setSortMode] = usePersistentState<ImageSortMode>(
    "knit.img2pdf.sortMode",
    "manual",
  );
  const [sortDir, setSortDir] = usePersistentState<SortDirection>(
    "knit.img2pdf.sortDir",
    "asc",
  );
  const [gridCols, setGridCols] = usePersistentState<number>("knit.img2pdf.gridCols", 4);

  const importOrderMapRef = React.useRef<Record<string, number>>({});
  const nextImportOrderRef = React.useRef<number>(1);
  const undoStackRef = React.useRef<
    { pages: PageDraft[]; bookmarks: BookmarkNode[]; sortMode: ImageSortMode; sortDir: SortDirection }[]
  >([]);
  const [undoCount, setUndoCount] = React.useState(0);
  const pagesStateRef = React.useRef<PageDraft[]>(pages);
  pagesStateRef.current = pages;
  const bookmarksStateRef = React.useRef<BookmarkNode[]>(bookmarks);
  bookmarksStateRef.current = bookmarks;
  const sortModeRef = React.useRef<ImageSortMode>(sortMode);
  sortModeRef.current = sortMode;
  const sortDirRef = React.useRef<SortDirection>(sortDir);
  sortDirRef.current = sortDir;

  const pushUndoSnapshot = React.useCallback(() => {
    const stack = undoStackRef.current;
    stack.push({
      pages: pagesStateRef.current,
      bookmarks: bookmarksStateRef.current,
      sortMode: sortModeRef.current,
      sortDir: sortDirRef.current,
    });
    if (stack.length > 50) stack.shift();
    setUndoCount(stack.length);
  }, []);

  const handleUndo = React.useCallback(() => {
    const snap = undoStackRef.current.pop();
    if (!snap) return;
    setUndoCount(undoStackRef.current.length);
    setPages(snap.pages);
    setBookmarks(snap.bookmarks);
    setSortMode(snap.sortMode);
    setSortDir(snap.sortDir);
  }, [setSortMode, setSortDir]);

  const [dragIndex, setDragIndex] = React.useState<number | null>(null);
  const [insertAt, setInsertAt] = React.useState<number | null>(null);
  const [scanningPaths, setScanningPaths] = React.useState(false);
  const [scanProgress, setScanProgress] = React.useState<{
    done: number;
    total: number;
    currentItem: string;
  } | null>(null);
  const [scanWarnings, setScanWarnings] = React.useState<string[]>([]);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const lastHandledDropSeq = React.useRef<number>(0);

  const [cardHeight, setCardHeight] = React.useState<number>(() => (loadThumbs ? 236 : 92));
  const [visibleRange, setVisibleRange] = React.useState<{ startRow: number; endRow: number }>({
    startRow: 0,
    endRow: 15,
  });

  const gridOuterRef = React.useRef<HTMLDivElement | null>(null);
  const dragGhostRef = React.useRef<HTMLDivElement | null>(null);
  const initialGhostPosRef = React.useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const cardRefs = React.useRef<Map<string, HTMLDivElement>>(new Map());
  const insertAtRef = React.useRef<number | null>(null);
  const pagesRef = React.useRef<PageDraft[]>(pages);
  const pagesByIdRef = React.useRef<Map<string, PageDraft>>(new Map());
  const gridColsRef = React.useRef<number>(gridCols);
  const rowStrideRef = React.useRef<number>(cardHeight + IMAGE_GRID_GAP_PX);
  const suppressClickUntilRef = React.useRef<number>(0);

  const thumbCacheRef = React.useRef<Record<string, string>>(thumbCache);
  const loadThumbsRef = React.useRef<boolean>(loadThumbs);
  const visibleIdsRef = React.useRef<Set<string>>(new Set());
  const inFlightIdsRef = React.useRef<Set<string>>(new Set());
  const queuedSetRef = React.useRef<Set<string>>(new Set());
  const queuedOrderRef = React.useRef<string[]>([]);
  const failedThumbIdsRef = React.useRef<Set<string>>(new Set());
  const pendingThumbBatchRef = React.useRef<Record<string, string>>({});
  const thumbFlushTimerRef = React.useRef<number | null>(null);
  const activeWorkersRef = React.useRef<number>(0);
  const thumbGenRef = React.useRef<number>(0);
  const observerRef = React.useRef<IntersectionObserver | null>(null);

  const rowStride = cardHeight + IMAGE_GRID_GAP_PX;
  gridColsRef.current = gridCols;
  rowStrideRef.current = rowStride;

  React.useEffect(() => {
    pagesRef.current = pages;
    const map = new Map<string, PageDraft>();
    for (const p of pages) {
      map.set(p.id, p);
    }
    pagesByIdRef.current = map;
  }, [pages]);

  React.useEffect(() => {
    thumbCacheRef.current = thumbCache;
  }, [thumbCache]);

  React.useEffect(() => {
    loadThumbsRef.current = loadThumbs;
    setCardHeight(loadThumbs ? 236 : 92);
    if (!loadThumbs) {
      thumbGenRef.current += 1;
      queuedSetRef.current.clear();
      queuedOrderRef.current = [];
      inFlightIdsRef.current.clear();
      pendingThumbBatchRef.current = {};
      if (thumbFlushTimerRef.current !== null) {
        window.clearTimeout(thumbFlushTimerRef.current);
        thumbFlushTimerRef.current = null;
      }
    }
  }, [loadThumbs]);

  React.useEffect(() => {
    return () => {
      if (thumbFlushTimerRef.current !== null) {
        window.clearTimeout(thumbFlushTimerRef.current);
        thumbFlushTimerRef.current = null;
      }
    };
  }, []);

  const flushPendingThumbs = React.useCallback(() => {
    thumbFlushTimerRef.current = null;
    const batch = pendingThumbBatchRef.current;
    const metaBatch = pendingMetaBatchRef.current;
    const keys = Object.keys(batch);
    if (keys.length === 0) return;
    pendingThumbBatchRef.current = {};
    pendingMetaBatchRef.current = {};
    const { nextCache } = mergeThumbCacheLru(
      thumbCacheRef.current,
      batch,
      THUMB_CACHE_MAX_ENTRIES,
      visibleIdsRef.current,
    );
    thumbCacheRef.current = nextCache;
    setThumbCache(nextCache);
    setThumbMetaCache((prev) => ({ ...prev, ...metaBatch }));
  }, []);

  const thumbSigRef = React.useRef<Record<string, string>>({});
  const pendingMetaBatchRef = React.useRef<
    Record<string, { sig: string; bakedRot: number }>
  >({});

  const scheduleThumbFlush = React.useCallback(() => {
    if (thumbFlushTimerRef.current !== null) return;
    thumbFlushTimerRef.current = window.setTimeout(flushPendingThumbs, 40);
  }, [flushPendingThumbs]);

  const pumpThumbQueue = React.useCallback(() => {
    if (!isTauriRuntime() || !loadThumbsRef.current) return;
    const CONCURRENCY = 3;

    while (activeWorkersRef.current < CONCURRENCY && queuedOrderRef.current.length > 0) {
      // Pop từ cuối (LIFO) để ưu tiên các ảnh người dùng vừa cuộn tới trong viewport
      const pageId = queuedOrderRef.current.pop();
      if (!pageId) break;
      if (!queuedSetRef.current.delete(pageId)) continue;
      if (!visibleIdsRef.current.has(pageId)) continue;

      const page = pagesByIdRef.current.get(pageId);
      if (!page) continue;

      const sig = pageEditSignature(page);
      if (
        (thumbCacheRef.current[pageId] && thumbSigRef.current[pageId] === sig) ||
        inFlightIdsRef.current.has(pageId) ||
        failedThumbIdsRef.current.has(pageId)
      ) {
        continue;
      }

      inFlightIdsRef.current.add(pageId);
      activeWorkersRef.current += 1;
      const gen = thumbGenRef.current;

      void (async () => {
        try {
          const edited = hasPageEdits(page);
          const thumbPath = edited
            ? await renderPageDraftPreviewFile(page, 360)
            : await renderImageThumbFile(page.source.path, 360);
          if (thumbGenRef.current !== gen || !loadThumbsRef.current) return;

          const latestPage = pagesByIdRef.current.get(pageId);
          if (latestPage && pageEditSignature(latestPage) !== sig) {
            return;
          }

          const url = convertFileSrc(thumbPath);
          thumbCacheRef.current[pageId] = url;
          thumbSigRef.current[pageId] = sig;
          pendingThumbBatchRef.current[pageId] = url;
          pendingMetaBatchRef.current[pageId] = {
            sig,
            bakedRot: edited ? ((page.rotation_deg % 360) + 360) % 360 : 0,
          };
          scheduleThumbFlush();
        } catch {
          if (thumbGenRef.current !== gen || !loadThumbsRef.current) return;
          // Không fallback nạp trực tiếp file ảnh gốc nhiều MB lên Grid để tránh nghẽn WebView
          failedThumbIdsRef.current.add(pageId);
        } finally {
          inFlightIdsRef.current.delete(pageId);
          activeWorkersRef.current = Math.max(0, activeWorkersRef.current - 1);
          const latestPage = pagesByIdRef.current.get(pageId);
          if (
            latestPage &&
            pageEditSignature(latestPage) !== sig &&
            visibleIdsRef.current.has(pageId)
          ) {
            queuedSetRef.current.add(pageId);
            queuedOrderRef.current.push(pageId);
          }
          if (thumbGenRef.current === gen && loadThumbsRef.current) {
            pumpThumbQueue();
          }
        }
      })();
    }
  }, [scheduleThumbFlush]);

  const enqueueThumbnail = React.useCallback(
    (pageId: string) => {
      if (!isTauriRuntime() || !loadThumbsRef.current) return;
      const page = pagesByIdRef.current.get(pageId);
      const sig = page ? pageEditSignature(page) : "";
      if (
        (thumbCacheRef.current[pageId] && thumbSigRef.current[pageId] === sig) ||
        inFlightIdsRef.current.has(pageId) ||
        failedThumbIdsRef.current.has(pageId)
      ) {
        return;
      }
      if (!queuedSetRef.current.has(pageId)) {
        queuedSetRef.current.add(pageId);
      }
      queuedOrderRef.current.push(pageId);
      pumpThumbQueue();
    },
    [pumpThumbQueue],
  );

  // Re-render visible thumbnails automatically whenever a page's edits change
  React.useEffect(() => {
    if (!loadThumbs || !isTauriRuntime()) return;
    for (const p of pages) {
      if (!visibleIdsRef.current.has(p.id)) continue;
      const sig = pageEditSignature(p);
      if (thumbSigRef.current[p.id] && thumbSigRef.current[p.id] !== sig) {
        failedThumbIdsRef.current.delete(p.id);
        enqueueThumbnail(p.id);
      }
    }
  }, [pages, loadThumbs, enqueueThumbnail]);

  React.useEffect(() => {
    if (!loadThumbs || !isTauriRuntime() || typeof IntersectionObserver === "undefined") {
      observerRef.current?.disconnect();
      observerRef.current = null;
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.pageId;
          if (!id) continue;
          if (entry.isIntersecting) {
            visibleIdsRef.current.add(id);
            enqueueThumbnail(id);
          } else {
            visibleIdsRef.current.delete(id);
            queuedSetRef.current.delete(id);
          }
        }
      },
      { rootMargin: "320px 0px" },
    );

    observerRef.current = observer;
    for (const el of cardRefs.current.values()) {
      observer.observe(el);
    }

    return () => {
      observer.disconnect();
      if (observerRef.current === observer) {
        observerRef.current = null;
      }
    };
  }, [loadThumbs, enqueueThumbnail]);

  const registerCardRef = React.useCallback((id: string, el: HTMLDivElement | null) => {
    const prevEl = cardRefs.current.get(id);
    if (prevEl && prevEl !== el) {
      observerRef.current?.unobserve(prevEl);
    }
    if (el) {
      cardRefs.current.set(id, el);
      observerRef.current?.observe(el);
    } else {
      cardRefs.current.delete(id);
      visibleIdsRef.current.delete(id);
      queuedSetRef.current.delete(id);
    }
  }, []);

  const updateVisibleRange = React.useCallback(() => {
    const gridEl = gridOuterRef.current;
    if (!gridEl) return;
    const scrollEl = gridEl.closest("main");
    const gridRect = gridEl.getBoundingClientRect();
    const scrollRectTop = scrollEl ? scrollEl.getBoundingClientRect().top : 0;
    const viewportHeight = scrollEl ? scrollEl.clientHeight : window.innerHeight || 0;

    const next = computeVisibleRowRange({
      totalItems: pagesRef.current.length,
      gridCols: gridColsRef.current,
      rowStride: rowStrideRef.current,
      gridRectTop: gridRect.top,
      scrollRectTop,
      viewportHeight,
      overscanRows: 3,
    });

    setVisibleRange((prev) =>
      prev.startRow === next.startRow && prev.endRow === next.endRow
        ? prev
        : { startRow: next.startRow, endRow: next.endRow },
    );
  }, []);

  React.useLayoutEffect(() => {
    if (pages.length === 0) return;
    const firstCard = cardRefs.current.values().next().value as HTMLDivElement | undefined;
    if (firstCard && firstCard.offsetHeight > 0) {
      const measured = firstCard.offsetHeight;
      if (Math.abs(measured - cardHeight) >= 1) {
        setCardHeight(measured);
      }
    }
    updateVisibleRange();
  }, [pages.length, gridCols, loadThumbs, showBookmarks, cardHeight, updateVisibleRange]);

  React.useEffect(() => {
    const gridEl = gridOuterRef.current;
    if (!gridEl) return;
    const scrollEl = gridEl.closest("main");
    let rafId: number | null = null;

    const onScrollOrResize = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        updateVisibleRange();
      });
    };

    scrollEl?.addEventListener("scroll", onScrollOrResize, { passive: true });
    window.addEventListener("resize", onScrollOrResize);

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && scrollEl) {
      ro = new ResizeObserver(onScrollOrResize);
      ro.observe(scrollEl);
    }

    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      scrollEl?.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
      ro?.disconnect();
    };
  }, [pages.length, updateVisibleRange]);

  const resolveFullResSrc = React.useCallback(
    (page: PageDraft | null): string => {
      if (!page) return "";
      const lower = page.source.path.toLowerCase();
      // Animated images (GIF / WebP / APNG) must use native file URL so WebView plays animation
      if (
        page.source.kind === "animated_frame" ||
        lower.endsWith(".gif") ||
        lower.endsWith(".webp") ||
        lower.endsWith(".apng")
      ) {
        if (isTauriRuntime()) return convertFileSrc(page.source.path);
      }
      if (hiResCache[page.id]) return hiResCache[page.id];
      if (page.source.kind === "image_file") {
        if (!lower.endsWith(".avif") && !lower.endsWith(".tiff") && !lower.endsWith(".tif")) {
          if (isTauriRuntime()) return convertFileSrc(page.source.path);
        }
      }
      return thumbCache[page.id] || "";
    },
    [hiResCache, thumbCache],
  );

  // Lazy-decode higher-res (1600px) when opening modal for formats WebView can't load natively (AVIF/TIFF/Animated)
  React.useEffect(() => {
    const activeId = editingPageId || previewPageId;
    if (!activeId || !isTauriRuntime()) return;
    const page = pages.find((p) => p.id === activeId);
    if (!page || hiResCache[page.id]) return;
    const lower = page.source.path.toLowerCase();
    const needsRustDecode =
      page.source.kind === "animated_frame" ||
      lower.endsWith(".avif") ||
      lower.endsWith(".tiff") ||
      lower.endsWith(".tif");
    if (!needsRustDecode) return;

    let cancelled = false;
    void renderImageThumbBase64(page.source.path, 1600)
      .then((b64) => {
        if (!cancelled) {
          setHiResCache((prev) => ({ ...prev, [page.id]: `data:image/png;base64,${b64}` }));
        }
      })
      .catch(() => {
        // fallback to 360px thumb
      });
    return () => {
      cancelled = true;
    };
  }, [editingPageId, previewPageId, pages, hiResCache]);

  React.useEffect(() => {
    if (!previewPageId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreviewPageId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewPageId]);

  // Render full-resolution baked preview whenever user opens an edited page in the modal
  React.useEffect(() => {
    if (!previewPageId || !isTauriRuntime()) return;
    const page = pages.find((p) => p.id === previewPageId);
    if (!page || !hasPageEdits(page)) return;
    const sig = pageEditSignature(page);
    const cacheKey = `${page.id}:${sig}`;
    if (editedPreviewCache[cacheKey]) return;

    let cancelled = false;
    void renderPageDraftPreviewFile(page, 1800)
      .then((filePath) => {
        if (cancelled) return;
        const url = convertFileSrc(filePath);
        setEditedPreviewCache((prev) => ({ ...prev, [cacheKey]: url }));
      })
      .catch(() => {
        // Ignore transient preview errors; falls back to thumb/source
      });
    return () => {
      cancelled = true;
    };
  }, [previewPageId, pages, editedPreviewCache]);

  // Global Ctrl+Z undo for page operations when not editing inside canvas or inputs
  React.useEffect(() => {
    const onUndoKey = (e: KeyboardEvent) => {
      if (editingPageId) return;
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== "z") {
        return;
      }
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (undoStackRef.current.length === 0) return;
      e.preventDefault();
      handleUndo();
    };
    window.addEventListener("keydown", onUndoKey);
    return () => window.removeEventListener("keydown", onUndoKey);
  }, [editingPageId, handleUndo]);

  const appendScanPaths = React.useCallback(
    async (paths: string[], isFolder: boolean) => {
      if (paths.length === 0) return;
      setErrorMsg(null);
      setScanningPaths(true);
      setScanProgress({ done: 0, total: 0, currentItem: "" });
      try {
        const scan = await scanImagesForPdf(paths, isFolder, animatedPolicy, (ev) => {
          if (ev.kind === "progress") {
            setScanProgress({
              done: ev.data.done,
              total: ev.data.total,
              currentItem: ev.data.current_item,
            });
          }
        });
        if (scan.warnings && scan.warnings.length > 0) {
          setScanWarnings((prev) => [...prev, ...scan.warnings!]);
        }
        if (scan.pages.length === 0) return;
        for (const p of scan.pages) {
          if (importOrderMapRef.current[p.id] === undefined) {
            importOrderMapRef.current[p.id] = nextImportOrderRef.current;
            nextImportOrderRef.current += 1;
          }
        }
        setPages((prev) => {
          const offset = prev.length;
          if (scan.bookmarks.length > 0) {
            const shifted = shiftBookmarks(scan.bookmarks, offset);
            setBookmarks((bPrev) => [...bPrev, ...shifted]);
          }
          const combined = [...prev, ...scan.pages];
          return sortModeRef.current !== "manual"
            ? sortPageDrafts(
                combined,
                sortModeRef.current,
                sortDirRef.current,
                importOrderMapRef.current,
              )
            : combined;
        });
      } catch (e) {
        setErrorMsg(String(e));
      } finally {
        setScanningPaths(false);
        setScanProgress(null);
      }
    },
    [animatedPolicy],
  );

  React.useEffect(() => {
    if (!droppedBatch || droppedBatch.seq === lastHandledDropSeq.current) return;
    lastHandledDropSeq.current = droppedBatch.seq;
    void appendScanPaths(droppedBatch.paths, false);
  }, [droppedBatch, appendScanPaths]);

  const handlePickFiles = async () => {
    setErrorMsg(null);
    try {
      const selected = await pickFiles({
        title: t.image2pdf.pickFilesDialog,
        multiple: true,
        filters: [
          {
            name: "Images",
            extensions: ["jpg", "jpeg", "jfif", "png", "webp", "avif", "gif", "bmp", "tiff", "tif"],
          },
        ],
      });
      if (selected.length === 0) return;
      await appendScanPaths(selected, false);
    } catch (e) {
      setErrorMsg(String(e));
    }
  };

  const handlePickFolder = async () => {
    setErrorMsg(null);
    try {
      const dir = await pickDirectory(t.image2pdf.pickFolderDialog);
      if (!dir) return;
      await appendScanPaths([dir], true);
    } catch (e) {
      setErrorMsg(String(e));
    }
  };

  const reorderPage = React.useCallback(
    (fromIdx: number, toIdx: number) => {
      const current = pagesStateRef.current;
      if (
        fromIdx === toIdx ||
        fromIdx < 0 ||
        toIdx < 0 ||
        fromIdx >= current.length ||
        toIdx >= current.length
      ) {
        return;
      }
      pushUndoSnapshot();
      setSortMode("manual");
      setPages((prev) => {
        if (
          fromIdx === toIdx ||
          fromIdx < 0 ||
          toIdx < 0 ||
          fromIdx >= prev.length ||
          toIdx >= prev.length
        ) {
          return prev;
        }
        const next = [...prev];
        const [item] = next.splice(fromIdx, 1);
        next.splice(toIdx, 0, item);
        return next;
      });
    },
    [pushUndoSnapshot, setSortMode],
  );

  const rotatePage = React.useCallback(
    (id: string) => {
      pushUndoSnapshot();
      setPages((prev) =>
        prev.map((p) => (p.id === id ? { ...p, rotation_deg: (p.rotation_deg + 90) % 360 } : p)),
      );
    },
    [pushUndoSnapshot],
  );

  const removePage = React.useCallback(
    (id: string) => {
      pushUndoSnapshot();
      visibleIdsRef.current.delete(id);
      queuedSetRef.current.delete(id);
      failedThumbIdsRef.current.delete(id);
      delete thumbCacheRef.current[id];
      delete thumbSigRef.current[id];
      setPages((prev) => prev.filter((p) => p.id !== id));
      setThumbCache((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setHiResCache((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    [pushUndoSnapshot],
  );

  const handleSortModeChange = React.useCallback(
    (nextMode: ImageSortMode) => {
      if (nextMode === sortModeRef.current) return;
      pushUndoSnapshot();
      setSortMode(nextMode);
      if (nextMode !== "manual") {
        setPages((prev) =>
          sortPageDrafts(prev, nextMode, sortDirRef.current, importOrderMapRef.current),
        );
      }
    },
    [pushUndoSnapshot, setSortMode],
  );

  const handleToggleSortDir = React.useCallback(() => {
    const nextDir: SortDirection = sortDirRef.current === "asc" ? "desc" : "asc";
    pushUndoSnapshot();
    setSortDir(nextDir);
    if (sortModeRef.current !== "manual") {
      setPages((prev) =>
        sortPageDrafts(prev, sortModeRef.current, nextDir, importOrderMapRef.current),
      );
    }
  }, [pushUndoSnapshot, setSortDir]);

  const handleEditPage = React.useCallback((id: string) => {
    setEditingPageId(id);
  }, []);

  const switchMarginUnit = (nextUnit: MarginUnit) => {
    if (nextUnit === marginUnit) return;
    const converted =
      nextUnit === "mm" ? marginValue / PT_PER_MM : marginValue * PT_PER_MM;
    setMarginValue(Math.round(converted * 10) / 10);
    setMarginUnit(nextUnit);
  };

  const buildPageBackground = (): PageBackground => {
    switch (bgMode) {
      case "transparent":
        return { kind: "transparent" };
      case "white":
        return { kind: "white" };
      case "black":
        return { kind: "black" };
      case "custom": {
        const rgb = parseHexRgb(bgCustomHex);
        return { kind: "custom", ...rgb };
      }
    }
  };

  const handleExportPdf = async () => {
    if (pages.length === 0 || busy) return;
    setErrorMsg(null);
    try {
      const outPath = await pickSaveFile({
        title: t.image2pdf.savePdfDialog,
        defaultPath: "output.pdf",
        filters: [{ name: "PDF Document", extensions: ["pdf"] }],
      });
      if (!outPath) return;

      const marginPt =
        marginUnit === "mm" ? Math.max(0, marginValue) * PT_PER_MM : Math.max(0, marginValue);
      const background = buildPageBackground();

      const layout: PageLayoutPolicy =
        layoutMode === "original_size"
          ? { mode: "original_size", dpi }
          : layoutMode === "fit_a4"
            ? { mode: "fit_a4", margin_pt: marginPt, background }
            : { mode: "fit_letter", margin_pt: marginPt, background };

      const parsedMax = Number(maxMb);
      const parsedMaxPages = Math.round(maxPagesPerFile);
      const config: Image2PdfConfig = {
        output_path: outPath,
        layout,
        jpeg_quality: jpegQuality,
        lossless_passthrough: losslessPassthrough,
        animated_policy: animatedPolicy,
        max_mb:
          splitMode === "max_mb" &&
          maxMb.trim() !== "" &&
          !Number.isNaN(parsedMax) &&
          parsedMax > 0
            ? parsedMax
            : null,
        max_pages_per_file:
          splitMode === "max_pages_per_file" &&
          Number.isFinite(parsedMaxPages) &&
          parsedMaxPages > 0
            ? parsedMaxPages
            : null,
      };

      const jobId = crypto.randomUUID();
      onStartJob(jobId, t.shell.nav.image2pdf.label);
      const res = await buildImage2Pdf(jobId, pages, bookmarks, config, onJobEvent);
      onFinishJob(
        t.shell.nav.image2pdf.label,
        res.output_files,
        t.image2pdf.exportDoneSummary(res.total_pages, res.output_files.length, res.passthrough_pages),
        "success",
      );
    } catch (e) {
      const msg = String(e);
      setErrorMsg(msg);
      onFinishJob(
        t.shell.nav.image2pdf.label,
        [],
        msg,
        msg.toLowerCase().includes("cancel") || msg.includes("huy") ? "cancelled" : "error",
      );
    }
  };

  const previewPage = pages.find((p) => p.id === previewPageId) ?? null;
  const editingPage = pages.find((p) => p.id === editingPageId) ?? null;

  const handleCardPointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>, idx: number) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest("button")) return;

      const startX = e.clientX;
      const startY = e.clientY;
      let dragging = false;
      let latestX = startX;
      let latestY = startY;
      let rafId: number | null = null;

      const computeInsert = (clientX: number, clientY: number): number | null => {
        const gridEl = gridOuterRef.current;
        if (!gridEl) return null;
        const rect = gridEl.getBoundingClientRect();
        return hitTestGridInsertIndex({
          clientX,
          clientY,
          gridLeft: rect.left,
          gridTop: rect.top,
          gridWidth: rect.width,
          gridCols: gridColsRef.current,
          gapPx: IMAGE_GRID_GAP_PX,
          rowStride: rowStrideRef.current,
          totalItems: pagesRef.current.length,
        });
      };

      const tickDrag = () => {
        rafId = null;
        if (!dragging) return;

        if (dragGhostRef.current) {
          dragGhostRef.current.style.transform = `translate3d(${latestX + 14}px, ${latestY + 14}px, 0)`;
        }

        const scrollEl = gridOuterRef.current?.closest("main");
        if (scrollEl) {
          const sr = scrollEl.getBoundingClientRect();
          const edgePx = 56;
          let dy = 0;
          if (latestY < sr.top + edgePx) {
            dy = -Math.ceil(((sr.top + edgePx - latestY) / edgePx) * 18);
          } else if (latestY > sr.bottom - edgePx) {
            dy = Math.ceil(((latestY - (sr.bottom - edgePx)) / edgePx) * 18);
          }
          if (dy !== 0) {
            const prevTop = scrollEl.scrollTop;
            scrollEl.scrollTop += dy;
            if (scrollEl.scrollTop !== prevTop) {
              rafId = window.requestAnimationFrame(tickDrag);
            }
          }
        }

        const nextInsert = computeInsert(latestX, latestY);
        if (nextInsert !== insertAtRef.current) {
          insertAtRef.current = nextInsert;
          setInsertAt(nextInsert);
        }
      };

      const onMove = (ev: PointerEvent) => {
        latestX = ev.clientX;
        latestY = ev.clientY;
        if (!dragging) {
          if (Math.hypot(latestX - startX, latestY - startY) < 5) return;
          dragging = true;
          suppressClickUntilRef.current = performance.now() + 300;
          initialGhostPosRef.current = { x: latestX + 14, y: latestY + 14 };
          setDragIndex(idx);
        }
        if (rafId === null) {
          rafId = window.requestAnimationFrame(tickDrag);
        }
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        if (rafId !== null) {
          window.cancelAnimationFrame(rafId);
          rafId = null;
        }

        if (dragging) {
          suppressClickUntilRef.current = performance.now() + 250;
          const targetInsert = computeInsert(latestX, latestY) ?? insertAtRef.current;
          if (targetInsert !== null && targetInsert !== idx && targetInsert !== idx + 1) {
            const toIdx = targetInsert > idx ? targetInsert - 1 : targetInsert;
            reorderPage(idx, toIdx);
          }
          insertAtRef.current = null;
          setDragIndex(null);
          setInsertAt(null);
        }
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [reorderPage],
  );

  const handleCardDoubleClick = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement>, pageId: string) => {
      if ((e.target as HTMLElement).closest("button")) return;
      if (performance.now() < suppressClickUntilRef.current) return;
      setPreviewPageId(pageId);
    },
    [],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#212529]">{t.image2pdf.title}</h1>
          <p className="text-sm text-[#6C757D]">{t.image2pdf.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {pages.length > 0 && (
            <button
              type="button"
              onClick={() => {
                pushUndoSnapshot();
                thumbGenRef.current += 1;
                visibleIdsRef.current.clear();
                queuedSetRef.current.clear();
                queuedOrderRef.current = [];
                failedThumbIdsRef.current.clear();
                inFlightIdsRef.current.clear();
                pendingThumbBatchRef.current = {};
                pendingMetaBatchRef.current = {};
                if (thumbFlushTimerRef.current !== null) {
                  window.clearTimeout(thumbFlushTimerRef.current);
                  thumbFlushTimerRef.current = null;
                }
                thumbCacheRef.current = {};
                thumbSigRef.current = {};
                setPages([]);
                setBookmarks([]);
                setThumbCache({});
                setThumbMetaCache({});
                setHiResCache({});
                setPreviewPageId(null);
                setEditingPageId(null);
              }}
              className="rounded-[4px] border border-[#CED4DA] bg-white px-3.5 py-2 text-sm font-semibold text-[#DC3545] hover:bg-[#F8D7DA]"
            >
              {t.image2pdf.clearList}
            </button>
          )}
          <button
            type="button"
            disabled={pages.length === 0 || busy}
            onClick={() => void handleExportPdf()}
            className="flex items-center gap-1.5 rounded-[4px] bg-[#007BFF] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0069D9] disabled:opacity-50"
          >
            <FileOutput className="h-4 w-4" />
            {t.image2pdf.exportBtn(pages.length)}
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-[4px] border border-[#F5C6CB] bg-[#F8D7DA] px-3.5 py-2.5 text-sm text-[#721C24]">
          {errorMsg}
        </div>
      )}

      {scanWarnings.length > 0 && (
        <div className="rounded-[4px] border border-[#FFE08A] bg-[#FFF8DB] px-3.5 py-2.5 text-xs text-[#664D03]">
          <div className="flex items-center justify-between gap-2 font-semibold">
            <span className="inline-flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4 text-[#B86E00]" />
              {t.image2pdf.scanWarningsTitle(scanWarnings.length)}
            </span>
            <button
              type="button"
              onClick={() => setScanWarnings([])}
              className="rounded-[4px] border border-[#E5C267] bg-white px-2 py-0.5 text-[11px] font-medium text-[#664D03] hover:bg-[#FFFDF5]"
            >
              {t.image2pdf.dismissBtn}
            </button>
          </div>
          <ul className="mt-1.5 max-h-24 list-disc space-y-0.5 overflow-y-auto pl-5 font-mono-code text-[11px]">
            {scanWarnings.map((w, idx) => (
              <li key={idx}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Configuration Bar */}
      <div className="grid grid-cols-1 gap-3.5 rounded-[4px] border border-[#DEE2E6] bg-white p-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase text-[#6C757D]">
            {t.image2pdf.layoutHeading}
          </label>
          <Select
            ariaLabel={t.image2pdf.layoutHeading}
            value={layoutMode}
            onChange={(val) => setLayoutMode(val as typeof layoutMode)}
            className="w-full"
            options={[
              { value: "original_size", label: t.image2pdf.layoutOriginal },
              { value: "fit_a4", label: t.image2pdf.layoutA4 },
              { value: "fit_letter", label: t.image2pdf.layoutLetter },
            ]}
          />

          {layoutMode === "original_size" ? (
            <label className="flex items-center justify-between gap-2 text-xs text-[#6C757D]">
              <span>{t.image2pdf.dpiLabel}</span>
              <NumberInput
                ariaLabel={t.image2pdf.dpiLabel}
                size="sm"
                min={36}
                max={600}
                value={dpi}
                onChange={setDpi}
                className="w-24"
              />
            </label>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 text-xs text-[#6C757D]">
                <span>{t.image2pdf.paddingLabel}</span>
                <div className="flex items-center gap-1">
                  <NumberInput
                    ariaLabel={t.image2pdf.paddingLabel}
                    size="sm"
                    min={0}
                    max={marginUnit === "mm" ? 60 : 170}
                    step={marginUnit === "mm" ? 1 : 2}
                    value={marginValue}
                    onChange={setMarginValue}
                    className="w-20"
                  />
                  <Select
                    ariaLabel="Padding unit"
                    size="sm"
                    value={marginUnit}
                    onChange={(val) => switchMarginUnit(val as MarginUnit)}
                    className="font-mono-code"
                    options={[
                      { value: "mm", label: "mm" },
                      { value: "pt", label: "pt" },
                    ]}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 text-xs text-[#6C757D]">
                <span>{t.image2pdf.bgColorLabel}</span>
                <div className="flex items-center gap-1.5">
                  <Select
                    ariaLabel={t.image2pdf.bgColorLabel}
                    size="sm"
                    value={bgMode}
                    onChange={(val) => setBgMode(val as BgMode)}
                    options={[
                      { value: "white", label: t.image2pdf.bgWhite },
                      { value: "black", label: t.image2pdf.bgBlack },
                      { value: "transparent", label: t.image2pdf.bgTransparent },
                      { value: "custom", label: t.image2pdf.bgCustom },
                    ]}
                  />
                  {bgMode === "custom" && (
                    <input
                      type="color"
                      value={bgCustomHex}
                      onChange={(e) => setBgCustomHex(e.target.value)}
                      className="knit-control-sm w-9 cursor-pointer rounded-[4px] border border-[#CED4DA] bg-white p-0.5"
                      title={bgCustomHex}
                    />
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase text-[#6C757D]">
            {t.image2pdf.qualityHeading}
          </label>
          <label className="flex items-center gap-2 text-sm text-[#212529]">
            <input
              type="checkbox"
              checked={losslessPassthrough}
              onChange={(e) => setLosslessPassthrough(e.target.checked)}
            />
            {t.image2pdf.losslessLabel}
          </label>
          <label className="flex items-center justify-between gap-2 text-xs text-[#6C757D]">
            <span>{t.image2pdf.jpegQualityLabel(jpegQuality)}</span>
            <Slider
              ariaLabel="JPEG Quality"
              min={40}
              max={100}
              step={1}
              value={jpegQuality}
              onChange={setJpegQuality}
              className="w-28"
            />
          </label>
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase text-[#6C757D]">
            {t.image2pdf.animatedHeading}
          </label>
          <Select
            ariaLabel={t.image2pdf.animatedHeading}
            value={animatedPolicy}
            onChange={(val) => setAnimatedPolicy(val as AnimatedImagePolicy)}
            className="w-full"
            options={[
              { value: "first_frame_only", label: t.image2pdf.animatedFirstFrame },
              { value: "unpack_all_frames", label: t.image2pdf.animatedUnpackAll },
            ]}
          />
        </div>

        <div className="space-y-2">
          <label className="block text-xs font-semibold uppercase text-[#6C757D]">
            {t.image2pdf.splitMbHeading}
          </label>
          <Select
            ariaLabel={t.image2pdf.splitMbHeading}
            value={splitMode}
            onChange={(val) =>
              setSplitMode(val as "none" | "max_mb" | "max_pages_per_file")
            }
            className="w-full"
            options={[
              { value: "none", label: t.image2pdf.splitModeNone },
              { value: "max_mb", label: t.image2pdf.splitModeMb },
              { value: "max_pages_per_file", label: t.image2pdf.splitModePages },
            ]}
          />
          {splitMode === "max_mb" && (
            <>
              <NumberInput
                ariaLabel={t.image2pdf.splitModeMb}
                min={0}
                step={1}
                value={maxMb.trim() !== "" && !Number.isNaN(Number(maxMb)) ? Number(maxMb) : 0}
                onChange={(val) => setMaxMb(val > 0 ? String(val) : "")}
                className="w-full"
              />
              <p className="text-[11px] text-[#6C757D]">{t.image2pdf.splitMbPlaceholder}</p>
            </>
          )}
          {splitMode === "max_pages_per_file" && (
            <>
              <NumberInput
                ariaLabel={t.image2pdf.splitModePages}
                min={1}
                step={1}
                value={maxPagesPerFile}
                onChange={(val) => setMaxPagesPerFile(Math.max(1, Math.round(val)))}
                className="w-full"
              />
              <p className="text-[11px] text-[#6C757D]">{t.image2pdf.splitPagesPlaceholder}</p>
            </>
          )}
          <label className="flex cursor-pointer items-center gap-2 pt-1 text-sm font-medium text-[#212529]">
            <input
              type="checkbox"
              checked={loadThumbs}
              onChange={(e) => setLoadThumbs(e.target.checked)}
            />
            <span>{t.image2pdf.loadThumbsLabel}</span>
          </label>
        </div>
      </div>

      <Dropzone
        title={t.image2pdf.dropzoneTitle}
        description={t.image2pdf.dropzoneDesc}
        onPickFiles={() => void handlePickFiles()}
        onPickFolder={() => void handlePickFolder()}
        filesLabel={t.image2pdf.pickFilesLabel}
        folderLabel={t.image2pdf.pickFolderLabel}
        loading={scanningPaths}
      />

      {scanningPaths && scanProgress && (
        <div className="space-y-1.5 rounded-[4px] border border-[#B8DAFF] bg-[#EDF6FF] px-3.5 py-2.5 text-xs text-[#004085]">
          <div className="flex items-center justify-between gap-2 font-medium">
            <span className="truncate">
              {t.image2pdf.scanningProgress(
                scanProgress.done,
                scanProgress.total,
                scanProgress.currentItem,
              )}
            </span>
            {scanProgress.total > 0 && (
              <span className="shrink-0 font-mono-code font-semibold">
                {Math.min(100, Math.round((scanProgress.done / scanProgress.total) * 100))}%
              </span>
            )}
          </div>
          {scanProgress.total > 0 && (
            <div className="h-1.5 w-full overflow-hidden rounded-[2px] bg-[#CCE5FF]">
              <div
                className="h-full bg-[#007BFF] transition-[width] duration-150"
                style={{
                  width: `${Math.min(100, (scanProgress.done / scanProgress.total) * 100)}%`,
                }}
              />
            </div>
          )}
        </div>
      )}

      {pages.length > 0 && (
        <div className={`grid grid-cols-1 gap-4 ${showBookmarks ? "lg:grid-cols-3" : ""}`}>
          <div className={`space-y-3 ${showBookmarks ? "lg:col-span-2" : ""}`}>
            {/* Grid Density, Auto Sort, Undo & Bookmark Toggle Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-[#DEE2E6] bg-white px-3.5 py-2">
              <div className="flex flex-wrap items-center gap-2 text-xs text-[#495057]">
                <GripVertical className="h-4 w-4 text-[#007BFF]" />
                <span className="text-[#6C757D]">{t.image2pdf.dragHint}</span>
                <div className="ml-1 flex items-center gap-1.5 border-l border-[#DEE2E6] pl-2.5">
                  <span className="font-semibold text-[#343A40]">{t.image2pdf.sortLabel}</span>
                  <Select
                    ariaLabel={t.image2pdf.sortLabel}
                    size="sm"
                    value={sortMode}
                    onChange={(val) => handleSortModeChange(val as ImageSortMode)}
                    className="w-36"
                    options={[
                      { value: "manual", label: t.image2pdf.sortManual },
                      { value: "import_order", label: t.image2pdf.sortImportOrder },
                      { value: "name", label: t.image2pdf.sortName },
                      { value: "size", label: t.image2pdf.sortSize },
                      { value: "type", label: t.image2pdf.sortType },
                    ]}
                  />
                  {sortMode !== "manual" && (
                    <button
                      type="button"
                      onClick={handleToggleSortDir}
                      title={sortDir === "asc" ? t.image2pdf.sortAsc : t.image2pdf.sortDesc}
                      className="knit-control-sm inline-flex items-center gap-1 rounded-[4px] border border-[#CED4DA] bg-[#F8F9FA] px-2 text-xs font-semibold text-[#343A40] hover:bg-[#E9ECEF]"
                    >
                      {sortDir === "asc" ? (
                        <ArrowUpAZ className="h-3.5 w-3.5 text-[#007BFF]" />
                      ) : (
                        <ArrowDownAZ className="h-3.5 w-3.5 text-[#007BFF]" />
                      )}
                      <span>{sortDir === "asc" ? t.image2pdf.sortAsc : t.image2pdf.sortDesc}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={undoCount === 0}
                    onClick={handleUndo}
                    title={t.image2pdf.undoTooltip}
                    className="knit-control-sm inline-flex items-center gap-1 rounded-[4px] border border-[#CED4DA] bg-[#F8F9FA] px-2 text-xs font-semibold text-[#343A40] hover:bg-[#E9ECEF] disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <Undo2 className="h-3.5 w-3.5" />
                    <span>{t.image2pdf.undoBtn}</span>
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-[#495057]">
                <span className="font-semibold">{t.image2pdf.gridColumnsLabel}</span>
                {GRID_COL_OPTIONS.map((cols) => (
                  <button
                    key={cols}
                    type="button"
                    onClick={() => setGridCols(cols)}
                    className={`knit-control-sm rounded-[4px] px-2.5 font-mono-code text-xs font-semibold ${
                      gridCols === cols
                        ? "bg-[#007BFF] text-white"
                        : "border border-[#CED4DA] bg-[#F8F9FA] text-[#343A40] hover:bg-[#E9ECEF]"
                    }`}
                  >
                    {cols}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setShowBookmarks((v) => !v)}
                  className="knit-control-sm ml-1 inline-flex items-center gap-1.5 rounded-[4px] border border-[#CED4DA] bg-[#F8F9FA] px-2.5 text-xs font-semibold text-[#343A40] hover:bg-[#E9ECEF]"
                >
                  {showBookmarks ? (
                    <PanelRightClose className="h-3.5 w-3.5 text-[#007BFF]" />
                  ) : (
                    <PanelRightOpen className="h-3.5 w-3.5 text-[#007BFF]" />
                  )}
                  {showBookmarks ? t.image2pdf.toggleBookmarksHide : t.image2pdf.toggleBookmarksShow}
                </button>
              </div>
            </div>

            {(() => {
              const isNoOpInsert =
                dragIndex !== null &&
                insertAt !== null &&
                (insertAt === dragIndex || insertAt === dragIndex + 1);
              const rowCount = Math.ceil(pages.length / gridCols);
              const safeStartRow = Math.max(
                0,
                Math.min(visibleRange.startRow, Math.max(0, rowCount - 1)),
              );
              const safeEndRow =
                rowCount === 0
                  ? -1
                  : Math.max(safeStartRow, Math.min(visibleRange.endRow, rowCount - 1));
              const startIdx = safeStartRow * gridCols;
              const endIdxExclusive =
                safeEndRow >= 0 ? Math.min(pages.length, (safeEndRow + 1) * gridCols) : 0;
              const visiblePages = pages.slice(startIdx, endIdxExclusive);
              const topPadPx = safeStartRow * rowStride;
              const bottomPadPx =
                rowCount > 0 && safeEndRow >= 0
                  ? Math.max(0, (rowCount - 1 - safeEndRow) * rowStride)
                  : 0;

              return (
                <div
                  ref={gridOuterRef}
                  style={{
                    paddingTop: `${topPadPx}px`,
                    paddingBottom: `${bottomPadPx}px`,
                  }}
                >
                  <div
                    className="grid gap-3 select-none"
                    style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}
                  >
                    {visiblePages.map((page, localIdx) => {
                      const idx = startIdx + localIdx;
                      const showBarLeft = !isNoOpInsert && insertAt === idx;
                      const showBarEnd =
                        !isNoOpInsert && insertAt === pages.length && idx === pages.length - 1;

                      return (
                        <PageCard
                          key={page.id}
                          page={page}
                          idx={idx}
                          thumbUrl={thumbCache[page.id]}
                          thumbBakedSig={thumbMetaCache[page.id]?.sig}
                          thumbBakedRot={thumbMetaCache[page.id]?.bakedRot ?? 0}
                          loadThumbs={loadThumbs}
                          isDragged={dragIndex === idx}
                          isDraggingAny={dragIndex !== null}
                          showBarLeft={showBarLeft}
                          showBarEnd={showBarEnd}
                          editedBadgeLabel={t.image2pdf.editedBadge}
                          rotateTitle={t.image2pdf.rotateTitle}
                          editBtnLabel={t.image2pdf.editBtn}
                          editBtnTitle={t.image2pdf.editBtnTitle}
                          deletePageTitle={t.image2pdf.deletePageTitle}
                          onRegisterRef={registerCardRef}
                          onPointerDownCard={handleCardPointerDown}
                          onDoubleClickCard={handleCardDoubleClick}
                          onRotate={rotatePage}
                          onEdit={handleEditPage}
                          onRemove={removePage}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>

          {showBookmarks && (
            <div>
              <BookmarkTreeEditor
                nodes={bookmarks}
                totalPages={pages.length}
                onChange={setBookmarks}
              />
            </div>
          )}
        </div>
      )}

      {dragIndex !== null && pages[dragIndex] && (
        <div
          ref={dragGhostRef}
          style={{
            left: 0,
            top: 0,
            transform: `translate3d(${initialGhostPosRef.current.x}px, ${initialGhostPosRef.current.y}px, 0)`,
            willChange: "transform",
          }}
          className="pointer-events-none fixed z-50 flex items-center gap-2 rounded-[4px] border border-[#007BFF] bg-white/95 px-2.5 py-1.5 text-xs font-semibold text-[#212529] shadow-lg"
        >
          <span className="rounded bg-[#007BFF] px-1.5 py-0.5 font-mono-code text-[11px] text-white">
            #{dragIndex + 1}
          </span>
          <span className="max-w-[180px] truncate">{pages[dragIndex].label}</span>
        </div>
      )}

      {/* Large Image Preview Modal (opened via Double-Click) */}
      {previewPage && (
        <div
          onClick={() => setPreviewPageId(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex h-[92vh] w-[94vw] max-w-[1400px] flex-col overflow-hidden rounded-[4px] border border-[#CED4DA] bg-white shadow-2xl"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-[#DEE2E6] bg-[#F8F9FA] px-4 py-2.5">
              <div className="min-w-0">
                <div className="truncate text-sm font-bold text-[#212529]">
                  {previewPage.label}
                </div>
                <div className="font-mono-code text-xs text-[#6C757D]">
                  {previewPage.width_px}x{previewPage.height_px}
                  {previewPage.rotation_deg % 360 !== 0
                    ? ` · ${previewPage.rotation_deg}°`
                    : ""}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!loadThumbs}
                  onClick={() => {
                    const id = previewPage.id;
                    setPreviewPageId(null);
                    setEditingPageId(id);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-[4px] bg-[#007BFF] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0069D9] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  {t.image2pdf.editBtn}
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewPageId(null)}
                  aria-label={t.common.close}
                  className="rounded-[4px] p-1.5 text-[#6C757D] hover:bg-[#E9ECEF] hover:text-[#212529]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="flex flex-1 items-center justify-center overflow-auto bg-[#212529] p-4">
              {(() => {
                const edited = hasPageEdits(previewPage);
                if (edited) {
                  const sig = pageEditSignature(previewPage);
                  const bakedSrc = editedPreviewCache[`${previewPage.id}:${sig}`];
                  if (bakedSrc) {
                    return (
                      <img
                        src={bakedSrc}
                        alt={previewPage.label}
                        className="max-h-full max-w-full object-contain shadow-lg"
                      />
                    );
                  }
                  const fallbackSrc = resolveFullResSrc(previewPage);
                  return fallbackSrc ? (
                    <img
                      src={fallbackSrc}
                      alt={previewPage.label}
                      className="max-h-full max-w-full object-contain shadow-lg"
                      style={{ transform: `rotate(${previewPage.rotation_deg}deg)` }}
                    />
                  ) : (
                    <Layers className="h-10 w-10 text-[#6C757D]" />
                  );
                }
                const uneditedSrc = resolveFullResSrc(previewPage);
                return uneditedSrc ? (
                  <img
                    src={uneditedSrc}
                    alt={previewPage.label}
                    className="max-h-full max-w-full object-contain shadow-lg"
                  />
                ) : (
                  <Layers className="h-10 w-10 text-[#6C757D]" />
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {editingPage && (
        <ImageCanvasEditorModal
          draft={editingPage}
          imageSrc={resolveFullResSrc(editingPage)}
          onClose={() => setEditingPageId(null)}
          onSave={(updated) => {
            pushUndoSnapshot();
            setPages((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
            setEditingPageId(null);
          }}
        />
      )}
    </div>
  );
};

function shiftBookmarks(nodes: BookmarkNode[], offset: number): BookmarkNode[] {
  return nodes.map((n) => ({
    ...n,
    target_page_index: n.target_page_index + offset,
    children: shiftBookmarks(n.children, offset),
  }));
}

function parseHexRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace(/^#/, "");
  if (clean.length !== 6) return { r: 248, g: 249, b: 250 };
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return { r: 248, g: 249, b: 250 };
  }
  return { r, g, b };
}
