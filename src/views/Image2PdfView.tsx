import React from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  ArrowDownAZ,
  ArrowUpAZ,
  CheckSquare,
  FileOutput,
  GripVertical,
  PanelRightClose,
  PanelRightOpen,
  RotateCw,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { BookmarkTreeEditor } from "../components/BookmarkTreeEditor";
import { CardSizeSelector } from "../components/CardSizeSelector";
import { Dropzone } from "../components/Dropzone";
import { ErrorBanner } from "../components/ErrorBanner";
import {
  ExportConflictModal,
  type ConflictResolution,
} from "../components/ExportConflictModal";
import { ExportFilenameControl } from "../components/ExportFilenameControl";
import { GridColumnSelector } from "../components/GridColumnSelector";
import { ImageCanvasEditorModal } from "../components/ImageCanvasEditorModal";
import {
  ImportFeedbackToast,
  useImportFeedback,
} from "../components/ImportFeedbackToast";
import { PaneResizeHandle } from "../components/PaneResizeHandle";
import { Select } from "../components/Select";
import { ViewHeader } from "../components/ViewHeader";
import { useHorizontalRatioResize } from "../hooks/useHorizontalRatioResize";
import { useThumbnailQueue } from "../hooks/useThumbnailQueue";
import { useVirtualizedGrid } from "../hooks/useVirtualizedGrid";
import { useI18n } from "../i18n";
import { buildPageBookmarkMap, remapBookmarksAfterPageRemoval } from "../lib/bookmarks";
import {
  findActiveExportConflicts,
  resolveUniqueNonActiveExportPath,
  useExportFilenameCheck,
} from "../lib/exportPath";
import { estimateImage2PdfOutput } from "../lib/sizeEstimate";
import {
  hitTestGridInsertIndex,
  IMAGE_GRID_GAP_PX,
  THUMB_CACHE_MAX_ENTRIES,
  type CardSizePreset,
} from "../lib/imageGrid";
import {
  hasPageEdits,
  pageEditSignature,
  reorderSelectedPages,
  sortPageDrafts,
  type ImageSortMode,
  type SortDirection,
} from "../lib/imageSort";
import {
  buildImage2Pdf,
  checkExportConflicts,
  checkMissingFiles,
  clearImagePreviewCache,
  formatBytes,
  isJobCancelledError,
  isTauriRuntime,
  pickDirectory,
  pickFiles,
  pickSaveFile,
  renderImageThumbBase64,
  renderImageThumbFile,
  renderPageDraftPreviewFile,
  scanImagesForPdf,
  syncAnimatedDrafts,
} from "../lib/ipc";
import { usePersistentState } from "../lib/storage";
import type {
  AnimatedImagePolicy,
  BookmarkNode,
  Image2PdfConfig,
  JobEvent,
  PageBackground,
  PageDraft,
  PageLayoutPolicy,
  PdfExportMode,
} from "../types/ipc";
import {
  Image2PdfSettingsCard,
  type BgMode,
  type MarginUnit,
} from "./image2pdf/Image2PdfSettingsCard";
import { ImageContextMenu } from "./image2pdf/ImageContextMenu";
import { ImagePageCard } from "./image2pdf/ImagePageCard";
import { ImagePreviewModal } from "./image2pdf/ImagePreviewModal";

export interface DroppedBatch {
  seq: number;
  paths: string[];
}

interface Image2PdfViewProps {
  onStartJob: (jobId: string, label: string, outputPaths?: string[]) => void;
  onJobEvent: (ev: JobEvent, jobId?: string) => void;
  onFinishJob: (
    title: string,
    outputs: string[],
    summary: string,
    status: "success" | "error" | "cancelled",
    heading?: string,
    jobId?: string,
  ) => void;
  busy: boolean;
  activeExportPaths?: string[];
  droppedBatch?: DroppedBatch | null;
  defaultExportDir?: string;
}

const PT_PER_MM = 72 / 25.4;
const GRID_COL_OPTIONS = [2, 3, 4, 5, 6, 8] as const;

export const Image2PdfView: React.FC<Image2PdfViewProps> = ({
  onStartJob,
  onJobEvent,
  onFinishJob,
  busy,
  activeExportPaths = [],
  droppedBatch,
  defaultExportDir = "",
}) => {
  const { t } = useI18n();
  const { toast: importToast, notifyImported } = useImportFeedback();
  const [exportFilename, setExportFilename] = usePersistentState<string>(
    "knit.img2pdf.exportFilename",
    "output.pdf",
  );
  const { effectiveFilename, defaultTargetPath, existsAtDefaultDir } =
    useExportFilenameCheck(defaultExportDir, exportFilename, "output.pdf", ["pdf"]);
  const [pendingConflict, setPendingConflict] = React.useState<{
    outPath: string;
    conflicts: string[];
    lockedByActiveJob: boolean;
  } | null>(null);

  const [pages, setPages] = React.useState<PageDraft[]>([]);
  const [bookmarks, setBookmarks] = React.useState<BookmarkNode[]>([]);
  const [hiResCache, setHiResCache] = React.useState<Record<string, string>>({});
  const [editedPreviewCache, setEditedPreviewCache] = React.useState<Record<string, string>>({});
  const [previewPageId, setPreviewPageId] = React.useState<string | null>(null);
  const [editingPageId, setEditingPageId] = React.useState<string | null>(null);
  const [showBookmarks, setShowBookmarks] = usePersistentState<boolean>(
    "knit.img2pdf.showBookmarks",
    true,
  );
  const [leftPaneRatio, setLeftPaneRatio] = usePersistentState<number>(
    "knit.img2pdf.leftRatio",
    0.66,
  );
  const [contextMenu, setContextMenu] = React.useState<{
    pageId: string;
    pageIndex: number;
    x: number;
    y: number;
  } | null>(null);
  const [loadThumbs, setLoadThumbs] = usePersistentState<boolean>(
    "knit.img2pdf.loadThumbs",
    true,
  );
  const [prependNewFiles, setPrependNewFiles] = usePersistentState<boolean>(
    "knit.img2pdf.prependNewFiles",
    false,
  );
  const prependNewFilesRef = React.useRef<boolean>(prependNewFiles);
  prependNewFilesRef.current = prependNewFiles;

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
  const [exportMode, setExportMode] = usePersistentState<PdfExportMode>(
    "knit.img2pdf.exportMode",
    "balanced",
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
  const [cardSize, setCardSize] = usePersistentState<CardSizePreset>(
    "knit.img2pdf.cardSize",
    "small",
  );
  const [autoUpdateBookmarksOnDelete, setAutoUpdateBookmarksOnDelete] =
    usePersistentState<boolean>("knit.img2pdf.autoUpdateBookmarksOnDelete", true);
  const [selectionMode, setSelectionMode] = React.useState(false);
  const [selectedPageIds, setSelectedPageIds] = React.useState<Set<string>>(() => new Set());

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
  const autoUpdateBookmarksRef = React.useRef<boolean>(autoUpdateBookmarksOnDelete);
  autoUpdateBookmarksRef.current = autoUpdateBookmarksOnDelete;
  const selectionModeRef = React.useRef<boolean>(selectionMode);
  selectionModeRef.current = selectionMode;
  const selectedPageIdsRef = React.useRef<Set<string>>(selectedPageIds);
  selectedPageIdsRef.current = selectedPageIds;
  const lastSelectedAnchorIdRef = React.useRef<string | null>(null);

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
  const [draggingPageIds, setDraggingPageIds] = React.useState<Set<string>>(() => new Set());
  const [insertAt, setInsertAt] = React.useState<number | null>(null);
  const [missingSourcePaths, setMissingSourcePaths] = React.useState<Set<string>>(() => new Set());
  const [scanningPaths, setScanningPaths] = React.useState(false);
  const [scanProgress, setScanProgress] = React.useState<{
    done: number;
    total: number;
    currentItem: string;
  } | null>(null);
  const [scanWarnings, setScanWarnings] = React.useState<string[]>([]);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);
  const lastHandledDropSeq = React.useRef<number>(0);

  const splitContainerRef = React.useRef<HTMLDivElement | null>(null);
  const {
    ratio: liveLeftRatio,
    isResizing: isResizingWidth,
    handlePointerDown: handleSplitWidthResize,
  } = useHorizontalRatioResize({
    value: leftPaneRatio,
    min: 0.35,
    max: 0.82,
    containerRef: splitContainerRef,
    cssVar: "--img-left",
    onCommit: setLeftPaneRatio,
  });

  const gridOuterRef = React.useRef<HTMLDivElement | null>(null);
  const gridInnerRef = React.useRef<HTMLDivElement | null>(null);
  const dragGhostRef = React.useRef<HTMLDivElement | null>(null);
  const initialGhostPosRef = React.useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const insertAtRef = React.useRef<number | null>(null);
  const pagesByIdRef = React.useRef<Map<string, PageDraft>>(new Map());
  const pageIndexByIdRef = React.useRef<Map<string, number>>(new Map());
  const suppressClickUntilRef = React.useRef<number>(0);
  const lastPointerDownRef = React.useRef<{ pageId: string; timeStamp: number }>({
    pageId: "",
    timeStamp: 0,
  });

  React.useEffect(() => {
    const map = new Map<string, PageDraft>();
    const idxMap = new Map<string, number>();
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      map.set(p.id, p);
      idxMap.set(p.id, i);
    }
    pagesByIdRef.current = map;
    pageIndexByIdRef.current = idxMap;
  }, [pages]);

  const thumbQueue = useThumbnailQueue<{ sig: string; bakedRot: number }>({
    enabled: isTauriRuntime() && loadThumbs,
    concurrency: 3,
    maxCacheEntries: THUMB_CACHE_MAX_ENTRIES,
    flushIntervalMs: 40,
    getKeySignature: (pageId) => {
      const page = pagesByIdRef.current.get(pageId);
      return page ? pageEditSignature(page) : null;
    },
    renderKey: async (pageId) => {
      const page = pagesByIdRef.current.get(pageId);
      if (!page) return null;
      const sig = pageEditSignature(page);
      const edited = hasPageEdits(page);
      const needsDraftPreview =
        edited ||
        page.source.kind === "animated_frame" ||
        page.source.path.toLowerCase().endsWith(".svg");
      const thumbPath = needsDraftPreview
        ? await renderPageDraftPreviewFile(page, 360)
        : await renderImageThumbFile(page.source.path, 360);
      return {
        url: convertFileSrc(thumbPath),
        meta: {
          sig,
          bakedRot: edited ? ((page.rotation_deg % 360) + 360) % 360 : 0,
        },
      };
    },
  });

  const thumbThumbHeightPx = cardSize === "large" ? 288 : cardSize === "medium" ? 208 : 144;
  const grid = useVirtualizedGrid({
    outerRef: gridOuterRef,
    innerRef: gridInnerRef,
    getScrollEl: () => gridOuterRef.current?.closest("main") as HTMLElement | null,
    totalItems: pages.length,
    cols: gridCols,
    gapPx: IMAGE_GRID_GAP_PX,
    initialRowStridePx: (loadThumbs ? thumbThumbHeightPx + 92 : 92) + IMAGE_GRID_GAP_PX,
    overscanRows: 3,
    enabled: pages.length > 0 && !isResizingWidth,
    extraDeps: [loadThumbs, showBookmarks, cardSize],
    onVisibleWindowChange: (startIdx, endExcl) => {
      const keys: string[] = [];
      for (let i = startIdx; i < endExcl; i++) {
        const p = pagesStateRef.current[i];
        if (p) keys.push(p.id);
      }
      thumbQueue.enqueueWindow(keys);
    },
  });

  const {
    enqueueKey: thumbEnqueueKey,
    visibleKeysRef: thumbVisibleKeysRef,
    thumbSigsRef,
    clearFailedKey: thumbClearFailedKey,
  } = thumbQueue;

  const mountedCardIdsRef = React.useRef<Set<string>>(new Set());
  const registerCardRef = React.useCallback(
    (id: string, el: HTMLDivElement | null) => {
      if (el) {
        mountedCardIdsRef.current.add(id);
        thumbVisibleKeysRef.current.add(id);
        thumbEnqueueKey(id);
      } else {
        mountedCardIdsRef.current.delete(id);
        thumbVisibleKeysRef.current.delete(id);
      }
    },
    [thumbEnqueueKey, thumbVisibleKeysRef],
  );

  React.useEffect(() => {
    if (!loadThumbs || !isTauriRuntime()) return;
    // Chỉ duyệt các card đang hiển thị trong viewport thay vì quét O(N) toàn bộ mảng pages.
    thumbVisibleKeysRef.current.forEach((id) => {
      const p = pagesByIdRef.current.get(id);
      if (!p) return;
      const sig = pageEditSignature(p);
      if (thumbSigsRef.current[id] && thumbSigsRef.current[id] !== sig) {
        thumbClearFailedKey(id);
        thumbEnqueueKey(id);
      }
    });
  }, [pages, loadThumbs, thumbVisibleKeysRef, thumbSigsRef, thumbClearFailedKey, thumbEnqueueKey]);

  const resolveFullResSrc = React.useCallback(
    (page: PageDraft | null): string => {
      if (!page) return "";
      const lower = page.source.path.toLowerCase();
      if (hiResCache[page.id]) return hiResCache[page.id];
      if (
        page.source.kind !== "animated_frame" &&
        (lower.endsWith(".gif") || lower.endsWith(".webp") || lower.endsWith(".apng"))
      ) {
        if (isTauriRuntime()) return convertFileSrc(page.source.path);
      }
      if (page.source.kind === "image_file") {
        if (
          !lower.endsWith(".avif") &&
          !lower.endsWith(".tiff") &&
          !lower.endsWith(".tif") &&
          !lower.endsWith(".svg")
        ) {
          if (isTauriRuntime()) return convertFileSrc(page.source.path);
        }
      }
      return thumbQueue.thumbs[page.id] || "";
    },
    [hiResCache, thumbQueue.thumbs],
  );

  React.useEffect(() => {
    const activeId = editingPageId || previewPageId;
    if (!activeId || !isTauriRuntime()) return;
    const page = pagesByIdRef.current.get(activeId) ?? pages.find((p) => p.id === activeId);
    if (!page || hiResCache[page.id]) return;
    const lower = page.source.path.toLowerCase();
    const isAnimatedFrame = page.source.kind === "animated_frame";
    const needsRustDecode =
      isAnimatedFrame ||
      lower.endsWith(".avif") ||
      lower.endsWith(".tiff") ||
      lower.endsWith(".tif") ||
      lower.endsWith(".svg");
    if (!needsRustDecode) return;

    let cancelled = false;
    if (isAnimatedFrame) {
      void renderPageDraftPreviewFile(
        {
          ...page,
          rotation_deg: 0,
          crop: null,
          annotations: { texts: [], strokes: [] },
        },
        1600,
      )
        .then((filePath) => {
          if (!cancelled) {
            setHiResCache((prev) => ({ ...prev, [page.id]: convertFileSrc(filePath) }));
          }
        })
        .catch(() => {});
    } else {
      void renderImageThumbBase64(page.source.path, 1600)
        .then((b64) => {
          if (!cancelled) {
            setHiResCache((prev) => ({ ...prev, [page.id]: `data:image/png;base64,${b64}` }));
          }
        })
        .catch(() => {});
    }
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

  React.useEffect(() => {
    if (!previewPageId || !isTauriRuntime()) return;
    const page = pagesByIdRef.current.get(previewPageId) ?? pages.find((p) => p.id === previewPageId);
    if (!page || !hasPageEdits(page)) return;
    const sig = pageEditSignature(page);
    const cacheKey = `${page.id}:${sig}`;
    if (editedPreviewCache[cacheKey]) return;

    let cancelled = false;
    void renderPageDraftPreviewFile(page, 1800)
      .then((filePath) => {
        if (!cancelled) {
          setEditedPreviewCache((prev) => ({ ...prev, [cacheKey]: convertFileSrc(filePath) }));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [previewPageId, pages, editedPreviewCache]);

  React.useEffect(() => {
    const onUndoKey = (e: KeyboardEvent) => {
      if (editingPageId) return;
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== "z") return;
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
        const prepend = prependNewFilesRef.current;
        const offset = pagesStateRef.current.length;
        if (prepend) {
          setBookmarks((bPrev) => [
            ...scan.bookmarks,
            ...shiftBookmarks(bPrev, scan.pages.length),
          ]);
        } else if (scan.bookmarks.length > 0) {
          const shifted = shiftBookmarks(scan.bookmarks, offset);
          setBookmarks((bPrev) => [...bPrev, ...shifted]);
        }
        setPages((prev) => {
          const combined = prepend ? [...scan.pages, ...prev] : [...prev, ...scan.pages];
          return sortModeRef.current !== "manual"
            ? sortPageDrafts(
                combined,
                sortModeRef.current,
                sortDirRef.current,
                importOrderMapRef.current,
              )
            : combined;
        });
        notifyImported(t.common.importSuccessToast(`${scan.pages.length}`));
      } catch (e) {
        setErrorMsg(String(e));
      } finally {
        setScanningPaths(false);
        setScanProgress(null);
      }
    },
    [animatedPolicy, notifyImported, t.common],
  );

  React.useEffect(() => {
    if (!droppedBatch || droppedBatch.seq === lastHandledDropSeq.current) return;
    lastHandledDropSeq.current = droppedBatch.seq;
    void appendScanPaths(droppedBatch.paths, false);
  }, [droppedBatch, appendScanPaths]);

  const handlePickFiles = React.useCallback(async () => {
    setErrorMsg(null);
    try {
      const selected = await pickFiles({
        title: t.image2pdf.pickFilesDialog,
        multiple: true,
        filters: [
          {
            name: "Images",
            extensions: [
              "jpg",
              "jpeg",
              "jfif",
              "png",
              "webp",
              "avif",
              "gif",
              "bmp",
              "tiff",
              "tif",
              "svg",
            ],
          },
        ],
      });
      if (selected.length === 0) return;
      await appendScanPaths(selected, false);
    } catch (e) {
      setErrorMsg(String(e));
    }
  }, [appendScanPaths, t.image2pdf.pickFilesDialog]);

  const handlePickFolder = React.useCallback(async () => {
    setErrorMsg(null);
    try {
      const dir = await pickDirectory(t.image2pdf.pickFolderDialog);
      if (!dir) return;
      await appendScanPaths([dir], true);
    } catch (e) {
      setErrorMsg(String(e));
    }
  }, [appendScanPaths, t.image2pdf.pickFolderDialog]);

  const reorderGroupPages = React.useCallback(
    (draggedId: string, insertAtIndex: number) => {
      const current = pagesStateRef.current;
      const next = reorderSelectedPages(
        current,
        selectedPageIdsRef.current,
        draggedId,
        insertAtIndex,
      );
      if (next === current) return;
      pushUndoSnapshot();
      setSortMode("manual");
      setPages(next);
    },
    [pushUndoSnapshot, setSortMode],
  );

  const rotatePageBy = React.useCallback(
    (id: string, deltaDeg: number) => {
      pushUndoSnapshot();
      setPages((prev) =>
        prev.map((p) =>
          p.id === id ? { ...p, rotation_deg: (((p.rotation_deg + deltaDeg) % 360) + 360) % 360 } : p,
        ),
      );
    },
    [pushUndoSnapshot],
  );

  const rotatePage = React.useCallback(
    (id: string) => {
      rotatePageBy(id, 90);
    },
    [rotatePageBy],
  );

  const copyTextWithToast = React.useCallback(
    async (text: string) => {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        }
        notifyImported(t.common.copiedToClipboard(text));
      } catch (e) {
        setErrorMsg(String(e));
      }
    },
    [notifyImported, t.common],
  );

  const handleCopyImagePath = React.useCallback(
    (path: string) => {
      void copyTextWithToast(path);
    },
    [copyTextWithToast],
  );

  const handleCopyFolderPath = React.useCallback(
    (path: string) => {
      const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
      const folder = idx > 0 ? path.slice(0, idx) : path;
      void copyTextWithToast(folder);
    },
    [copyTextWithToast],
  );

  const handleAttachBookmarkAtPage = React.useCallback(
    (page: PageDraft, pageIndex: number) => {
      const cleanTitle = page.label.replace(/\.[^.]+$/, "").trim() || t.bookmarks.defaultRootTitle(bookmarksStateRef.current.length + 1);
      pushUndoSnapshot();
      setBookmarks((prev) => [
        ...prev,
        {
          title: cleanTitle,
          target_page_index: pageIndex,
          children: [],
        },
      ]);
      setShowBookmarks(true);
    },
    [pushUndoSnapshot, setShowBookmarks, t.bookmarks],
  );

  const handleSelectSingleFromContext = React.useCallback((pageId: string) => {
    setSelectionMode(true);
    setSelectedPageIds((prev) => {
      const next = new Set(prev);
      next.add(pageId);
      return next;
    });
    lastSelectedAnchorIdRef.current = pageId;
  }, []);

  const handleCardContextMenu = React.useCallback(
    (_e: React.MouseEvent<HTMLDivElement>, pageId: string, idx: number) => {
      setContextMenu({ pageId, pageIndex: idx, x: _e.clientX, y: _e.clientY });
    },
    [],
  );

  const removePage = React.useCallback(
    (id: string) => {
      const currentPages = pagesStateRef.current;
      const removedIdx = pageIndexByIdRef.current.get(id) ?? currentPages.findIndex((p) => p.id === id);
      pushUndoSnapshot();
      thumbQueue.remapCache((k) => (k === id ? null : k));
      setPages((prev) => prev.filter((p) => p.id !== id));
      if (autoUpdateBookmarksRef.current && removedIdx !== -1) {
        setBookmarks((prev) =>
          remapBookmarksAfterPageRemoval(prev, currentPages.length, new Set([removedIdx])),
        );
      }
      setSelectedPageIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setHiResCache((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    [pushUndoSnapshot, thumbQueue],
  );

  const exitSelectionMode = React.useCallback(() => {
    setSelectionMode(false);
    setSelectedPageIds(new Set());
    setMissingSourcePaths(new Set());
    setDraggingPageIds(new Set());
    lastSelectedAnchorIdRef.current = null;
  }, []);

  const toggleSelectionPage = React.useCallback((id: string) => {
    setSelectionMode(true);
    setSelectedPageIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    lastSelectedAnchorIdRef.current = id;
  }, []);

  const selectRangeToIndex = React.useCallback((targetIdx: number) => {
    const list = pagesStateRef.current;
    const targetPage = list[targetIdx];
    if (!targetPage) return;
    const anchorId = lastSelectedAnchorIdRef.current;
    const anchorIdx = anchorId
      ? (pageIndexByIdRef.current.get(anchorId) ?? list.findIndex((p) => p.id === anchorId))
      : -1;
    const start = anchorIdx >= 0 ? Math.min(anchorIdx, targetIdx) : targetIdx;
    const end = anchorIdx >= 0 ? Math.max(anchorIdx, targetIdx) : targetIdx;
    setSelectionMode(true);
    setSelectedPageIds((prev) => {
      const next = new Set(prev);
      for (let i = start; i <= end; i++) {
        if (list[i]) next.add(list[i].id);
      }
      return next;
    });
    lastSelectedAnchorIdRef.current = targetPage.id;
  }, []);

  const rotateSelectedPages = React.useCallback(() => {
    const selected = selectedPageIdsRef.current;
    if (selected.size === 0) return;
    pushUndoSnapshot();
    setPages((prev) =>
      prev.map((p) =>
        selected.has(p.id) ? { ...p, rotation_deg: (p.rotation_deg + 90) % 360 } : p,
      ),
    );
  }, [pushUndoSnapshot]);

  const deleteSelectedPages = React.useCallback(() => {
    const selected = selectedPageIdsRef.current;
    if (selected.size === 0) return;
    const currentPages = pagesStateRef.current;
    const removedIndices = new Set<number>();
    currentPages.forEach((p, idx) => {
      if (selected.has(p.id)) removedIndices.add(idx);
    });
    if (removedIndices.size === 0) return;

    pushUndoSnapshot();
    thumbQueue.remapCache((k) => (selected.has(k) ? null : k));
    setPages((prev) => prev.filter((p) => !selected.has(p.id)));
    if (autoUpdateBookmarksRef.current) {
      setBookmarks((prev) =>
        remapBookmarksAfterPageRemoval(prev, currentPages.length, removedIndices),
      );
    }
    setHiResCache((prev) => {
      let changed = false;
      const next = { ...prev };
      selected.forEach((id) => {
        if (id in next) {
          delete next[id];
          changed = true;
        }
      });
      return changed ? next : prev;
    });
    setSelectionMode(false);
    setSelectedPageIds(new Set());
    setMissingSourcePaths(new Set());
    setDraggingPageIds(new Set());
    lastSelectedAnchorIdRef.current = null;
  }, [pushUndoSnapshot, thumbQueue]);

  React.useEffect(() => {
    if (!selectionMode || previewPageId || editingPageId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        exitSelectionMode();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectionMode, previewPageId, editingPageId, exitSelectionMode]);

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

  const switchMarginUnit = React.useCallback(
    (nextUnit: MarginUnit) => {
      if (nextUnit === marginUnit) return;
      const converted = nextUnit === "mm" ? marginValue / PT_PER_MM : marginValue * PT_PER_MM;
      setMarginValue(Math.round(converted * 10) / 10);
      setMarginUnit(nextUnit);
    },
    [marginUnit, marginValue, setMarginUnit, setMarginValue],
  );

  const { resetAll: resetThumbQueue } = thumbQueue;
  const handleChangeLoadThumbs = React.useCallback(
    (checked: boolean) => {
      setLoadThumbs(checked);
      if (!checked) resetThumbQueue();
    },
    [resetThumbQueue, setLoadThumbs],
  );

  const handleChangeAnimatedPolicy = React.useCallback(
    async (nextPolicy: AnimatedImagePolicy) => {
      setAnimatedPolicy(nextPolicy);
      const currentPages = pagesStateRef.current;
      if (!isTauriRuntime() || currentPages.length === 0) return;
      const hasAnimatedCandidate = currentPages.some((p) => {
        const lower = p.source.path.toLowerCase();
        return (
          p.source.kind === "animated_frame" ||
          lower.endsWith(".gif") ||
          lower.endsWith(".webp")
        );
      });
      if (!hasAnimatedCandidate) return;
      try {
        const synced = await syncAnimatedDrafts(
          currentPages,
          bookmarksStateRef.current,
          nextPolicy,
        );
        if (
          synced.pages.length !== pagesStateRef.current.length ||
          synced.pages.some((p, i) => p.source.kind !== pagesStateRef.current[i]?.source.kind)
        ) {
          pushUndoSnapshot();
          setPages(synced.pages);
          setBookmarks(synced.bookmarks);
        }
      } catch (e) {
        setErrorMsg(String(e));
      }
    },
    [pushUndoSnapshot, setAnimatedPolicy],
  );

  const buildPageBackground = (): PageBackground => {
    switch (bgMode) {
      case "transparent":
        return { kind: "transparent" };
      case "white":
        return { kind: "white" };
      case "black":
        return { kind: "black" };
      case "custom":
        return { kind: "custom", ...parseHexRgb(bgCustomHex) };
    }
  };

  const executeExportPdf = async (outPath: string) => {
    const jobId = crypto.randomUUID();
    const pagesSnapshot = [...pages];
    const bookmarksSnapshot = [...bookmarks];
    const emitEvent = (ev: JobEvent) => onJobEvent(ev, jobId);

    try {
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
        lossless_passthrough: exportMode === "fast" ? true : losslessPassthrough,
        animated_policy: animatedPolicy,
        export_mode: exportMode,
        max_mb:
          exportMode !== "fast" &&
          splitMode === "max_mb" &&
          maxMb.trim() !== "" &&
          !Number.isNaN(parsedMax) &&
          parsedMax > 0
            ? parsedMax
            : null,
        max_pages_per_file:
          exportMode !== "fast" &&
          splitMode === "max_pages_per_file" &&
          Number.isFinite(parsedMaxPages) &&
          parsedMaxPages > 0
            ? parsedMaxPages
            : null,
      };

      onStartJob(jobId, t.shell.nav.image2pdf.label, [outPath]);
      const res = await buildImage2Pdf(
        jobId,
        pagesSnapshot,
        bookmarksSnapshot,
        config,
        emitEvent,
      );
      onFinishJob(
        t.shell.nav.image2pdf.label,
        res.output_files,
        t.image2pdf.exportDoneSummary(res.total_pages, res.output_files.length, res.passthrough_pages),
        "success",
        undefined,
        jobId,
      );
    } catch (e) {
      const rawMsg = String(e);
      const cancelled = isJobCancelledError(rawMsg);
      const msg = cancelled ? t.common.jobCancelledMsg : rawMsg;
      setErrorMsg(msg);
      onFinishJob(
        t.shell.nav.image2pdf.label,
        [],
        msg,
        cancelled ? "cancelled" : "error",
        undefined,
        jobId,
      );
    }
  };

  const handleExportPdf = async () => {
    if (pages.length === 0 || busy) return;
    setErrorMsg(null);
    try {
      const uniquePaths = Array.from(new Set(pages.map((p) => p.source.path)));
      const missing = await checkMissingFiles(uniquePaths);
      if (missing.length > 0) {
        setMissingSourcePaths(new Set(missing));
        const samples = missing
          .slice(0, 3)
          .map((p) => p.split(/[\\/]/).pop() ?? p);
        setErrorMsg(t.image2pdf.missingFilesError(missing.length, samples));
        return;
      }
      if (missingSourcePaths.size > 0) {
        setMissingSourcePaths(new Set());
      }

      let outPath: string | null = defaultTargetPath;
      if (!outPath) {
        outPath = await pickSaveFile({
          title: t.image2pdf.savePdfDialog,
          defaultPath: effectiveFilename,
          filters: [{ name: "PDF Document", extensions: ["pdf"] }],
        });
      }
      if (!outPath) return;

      const activeHits = findActiveExportConflicts([outPath], activeExportPaths);
      if (activeHits.length > 0) {
        setPendingConflict({ outPath, conflicts: activeHits, lockedByActiveJob: true });
        return;
      }

      if (defaultTargetPath) {
        const conflicts = await checkExportConflicts([outPath]);
        if (conflicts.length > 0) {
          setPendingConflict({ outPath, conflicts, lockedByActiveJob: false });
          return;
        }
      }
      await executeExportPdf(outPath);
    } catch (e) {
      setErrorMsg(String(e));
    }
  };

  const handleConflictResolution = async (choice: ConflictResolution) => {
    const pending = pendingConflict;
    setPendingConflict(null);
    if (!pending || choice === "cancel") return;
    if (choice === "overwrite" && !pending.lockedByActiveJob) {
      await executeExportPdf(pending.outPath);
      return;
    }
    const nextPath = await resolveUniqueNonActiveExportPath(pending.outPath, activeExportPaths);
    await executeExportPdf(nextPath);
  };

  const handleCardPointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>, idx: number) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest("button")) return;

      const targetPage = pagesStateRef.current[idx];
      if (!targetPage) return;

      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        suppressClickUntilRef.current = performance.now() + 300;
        handleAttachBookmarkAtPage(targetPage, idx);
        return;
      }

      const hasModifier = e.ctrlKey || e.metaKey || e.shiftKey;
      const inSelectionMode = selectionModeRef.current;
      const downEventTs = e.timeStamp;
      const prevDown = lastPointerDownRef.current;
      const isLikelyDoubleClick =
        e.detail >= 2 ||
        (prevDown.pageId === targetPage.id &&
          downEventTs >= prevDown.timeStamp &&
          downEventTs - prevDown.timeStamp < 420);
      lastPointerDownRef.current = { pageId: targetPage.id, timeStamp: downEventTs };

      const startX = e.clientX;
      const startY = e.clientY;
      let dragging = false;
      let holdTriggered = false;
      let movedTooFar = false;
      let latestX = startX;
      let latestY = startY;
      let rafId: number | null = null;
      let holdTimerId: number | null = null;

      if (!hasModifier && !inSelectionMode && !isLikelyDoubleClick) {
        holdTimerId = window.setTimeout(() => {
          holdTimerId = null;
          if (movedTooFar || dragging) return;
          holdTriggered = true;
          suppressClickUntilRef.current = performance.now() + 300;
          setSelectionMode(true);
          setSelectedPageIds((prev) => {
            const next = new Set(prev);
            next.add(targetPage.id);
            return next;
          });
          lastSelectedAnchorIdRef.current = targetPage.id;
        }, 400);
      }

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
          gridCols: grid.colsRef.current,
          gapPx: IMAGE_GRID_GAP_PX,
          rowStride: grid.rowStrideRef.current,
          totalItems: pagesStateRef.current.length,
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
        if (Math.hypot(latestX - startX, latestY - startY) < 5) return;
        movedTooFar = true;
        if (holdTimerId !== null) {
          window.clearTimeout(holdTimerId);
          holdTimerId = null;
        }
        // Khi giữ phím bổ trợ hoặc đang bật hold-menu thì không kích hoạt kéo thả.
        if (hasModifier || holdTriggered) return;
        if (!dragging) {
          dragging = true;
          suppressClickUntilRef.current = performance.now() + 300;
          initialGhostPosRef.current = { x: latestX + 14, y: latestY + 14 };
          const selectedSet = selectedPageIdsRef.current;
          const movingIds =
            inSelectionMode && selectedSet.has(targetPage.id) && selectedSet.size > 1
              ? new Set(selectedSet)
              : new Set([targetPage.id]);
          setDragIndex(idx);
          setDraggingPageIds(movingIds);
        }
        if (rafId === null) {
          rafId = window.requestAnimationFrame(tickDrag);
        }
      };

      const onUp = (ev: PointerEvent) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        if (holdTimerId !== null) {
          window.clearTimeout(holdTimerId);
          holdTimerId = null;
        }
        if (rafId !== null) {
          window.cancelAnimationFrame(rafId);
          rafId = null;
        }

        if (dragging) {
          suppressClickUntilRef.current = performance.now() + 250;
          const targetInsert = computeInsert(latestX, latestY) ?? insertAtRef.current;
          if (targetInsert !== null) {
            reorderGroupPages(targetPage.id, targetInsert);
          }
          insertAtRef.current = null;
          setDragIndex(null);
          setDraggingPageIds(new Set());
          setInsertAt(null);
          return;
        }

        if (holdTriggered) {
          // Chống nhận nhầm click/double-click thành hold khi main thread bị lag >= 400ms.
          const physicalHoldMs = ev.timeStamp - downEventTs;
          if (physicalHoldMs > 0 && physicalHoldMs < 350) {
            suppressClickUntilRef.current = 0;
            setSelectionMode(false);
            setSelectedPageIds((prev) => {
              if (!prev.has(targetPage.id)) return prev;
              const next = new Set(prev);
              next.delete(targetPage.id);
              return next;
            });
            lastSelectedAnchorIdRef.current = null;
          }
          return;
        }
        if (movedTooFar) return;

        if (ev.shiftKey) {
          selectRangeToIndex(idx);
        } else if (ev.ctrlKey || ev.metaKey || inSelectionMode) {
          toggleSelectionPage(targetPage.id);
        }
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [
      grid.colsRef,
      grid.rowStrideRef,
      handleAttachBookmarkAtPage,
      reorderGroupPages,
      selectRangeToIndex,
      toggleSelectionPage,
    ],
  );

  const handleCardDoubleClick = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement>, pageId: string) => {
      if (e.altKey) return;
      if ((e.target as HTMLElement).closest("button")) return;
      if (performance.now() < suppressClickUntilRef.current) return;
      setPreviewPageId(pageId);
    },
    [],
  );

  const handleClearList = () => {
    thumbQueue.resetAll();
    undoStackRef.current = [];
    setUndoCount(0);
    importOrderMapRef.current = {};
    nextImportOrderRef.current = 1;
    pagesByIdRef.current.clear();
    pageIndexByIdRef.current.clear();
    setPages([]);
    setBookmarks([]);
    setSelectionMode(false);
    setSelectedPageIds(new Set());
    setMissingSourcePaths(new Set());
    setDraggingPageIds(new Set());
    lastSelectedAnchorIdRef.current = null;
    setHiResCache({});
    setEditedPreviewCache({});
    setPreviewPageId(null);
    setEditingPageId(null);
    void clearImagePreviewCache();
  };

  const pageBookmarkMap = React.useMemo(() => buildPageBookmarkMap(bookmarks), [bookmarks]);
  const previewPage = previewPageId
    ? (pagesByIdRef.current.get(previewPageId) ?? pages.find((p) => p.id === previewPageId) ?? null)
    : null;
  const editingPage = editingPageId
    ? (pagesByIdRef.current.get(editingPageId) ?? pages.find((p) => p.id === editingPageId) ?? null)
    : null;
  const visiblePages = pages.slice(grid.startIdx, grid.endIdxExclusive);
  const isNoOpInsert =
    dragIndex !== null &&
    draggingPageIds.size <= 1 &&
    insertAt !== null &&
    (insertAt === dragIndex || insertAt === dragIndex + 1);

  const pdfEstimateText = React.useMemo(() => {
    if (pages.length === 0) return null;
    const est = estimateImage2PdfOutput({
      pages,
      exportMode,
      losslessPassthrough,
      jpegQuality,
      splitMode,
      maxMb,
      maxPagesPerFile,
    });
    if (est.estimatedBytes <= 0) return null;
    return t.common.estimatedOutputSummary(formatBytes(est.estimatedBytes), est.estimatedFiles);
  }, [pages, exportMode, losslessPassthrough, jpegQuality, splitMode, maxMb, maxPagesPerFile, t.common]);

  const contextMenuPage = contextMenu
    ? (pagesByIdRef.current.get(contextMenu.pageId) ??
        pages.find((p) => p.id === contextMenu.pageId) ??
        null)
    : null;

  return (
    <div className="space-y-4">
      <ViewHeader
        title={t.image2pdf.title}
        subtitle={t.image2pdf.subtitle}
        actions={
          <>
            {pages.length > 0 && (
              <button
                type="button"
                onClick={handleClearList}
                className="rounded-[4px] border border-[#CED4DA] bg-white px-3.5 py-2 text-sm font-semibold text-[#DC3545] hover:bg-[#F8D7DA]"
              >
                {t.image2pdf.clearList}
              </button>
            )}
            <button
              type="button"
              disabled={pages.length === 0 || busy}
              onClick={() => void handleExportPdf()}
              className="knit-btn-primary flex items-center gap-1.5 px-4 py-2 text-sm disabled:opacity-50"
            >
              <FileOutput className="h-4 w-4" />
              {t.image2pdf.exportBtn(pages.length)}
            </button>
          </>
        }
      />

      <ErrorBanner message={errorMsg} />

      <ExportFilenameControl
        value={exportFilename}
        onChange={setExportFilename}
        placeholder="output.pdf"
        defaultExportDir={defaultExportDir}
        existsAtDefaultDir={existsAtDefaultDir}
        estimateText={pdfEstimateText}
      />

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

      <Image2PdfSettingsCard
        layoutMode={layoutMode}
        dpi={dpi}
        marginValue={marginValue}
        marginUnit={marginUnit}
        bgMode={bgMode}
        bgCustomHex={bgCustomHex}
        exportMode={exportMode}
        jpegQuality={jpegQuality}
        losslessPassthrough={losslessPassthrough}
        animatedPolicy={animatedPolicy}
        splitMode={splitMode}
        maxMb={maxMb}
        maxPagesPerFile={maxPagesPerFile}
        onChangeLayoutMode={setLayoutMode}
        onChangeDpi={setDpi}
        onChangeMarginValue={setMarginValue}
        onSwitchMarginUnit={switchMarginUnit}
        onChangeBgMode={setBgMode}
        onChangeBgCustomHex={setBgCustomHex}
        onChangeExportMode={setExportMode}
        onChangeJpegQuality={setJpegQuality}
        onChangeLosslessPassthrough={setLosslessPassthrough}
        onChangeAnimatedPolicy={(p) => void handleChangeAnimatedPolicy(p)}
        onChangeSplitMode={setSplitMode}
        onChangeMaxMb={setMaxMb}
        onChangeMaxPagesPerFile={setMaxPagesPerFile}
      />

      <div className="knit-card flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <span className="text-xs font-semibold uppercase text-[#6C757D]">
          {t.image2pdf.viewAndImportHeading}
        </span>
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-[#212529]">
          <input
            type="checkbox"
            checked={loadThumbs}
            onChange={(e) => handleChangeLoadThumbs(e.target.checked)}
          />
          <span>{t.image2pdf.loadThumbsLabel}</span>
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-[#212529]">
          <input
            type="checkbox"
            checked={prependNewFiles}
            onChange={(e) => setPrependNewFiles(e.target.checked)}
          />
          <span>{t.image2pdf.prependNewFilesLabel}</span>
        </label>
      </div>

      <Dropzone
        title={t.image2pdf.dropzoneTitle}
        description={t.image2pdf.dropzoneDesc}
        onPickFiles={handlePickFiles}
        onPickFolder={handlePickFolder}
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
        <div className="space-y-3">
          <div className="knit-card flex flex-wrap items-center justify-between gap-2 px-3.5 py-2">
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
                    className="knit-control-sm knit-btn-secondary inline-flex items-center gap-1 px-2 text-xs"
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
                  className="knit-control-sm knit-btn-secondary inline-flex items-center gap-1 px-2 text-xs disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Undo2 className="h-3.5 w-3.5" />
                  <span>{t.image2pdf.undoBtn}</span>
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (selectionMode) {
                    exitSelectionMode();
                  } else {
                    setSelectionMode(true);
                  }
                }}
                className={`knit-control-sm inline-flex items-center gap-1.5 rounded-[4px] border px-2.5 text-xs font-semibold ${
                  selectionMode
                    ? "border-[#007BFF] bg-[#007BFF] text-white"
                    : "border-[#CED4DA] bg-white text-[#212529] hover:bg-[#F8F9FA]"
                }`}
              >
                <CheckSquare className="h-3.5 w-3.5" />
                <span>{t.image2pdf.selectModeBtn}</span>
              </button>
              <GridColumnSelector
                label={t.image2pdf.gridColumnsLabel}
                options={GRID_COL_OPTIONS}
                value={gridCols}
                onChange={setGridCols}
              />
              <CardSizeSelector value={cardSize} onChange={setCardSize} />
              {bookmarks.length > 0 && (
                <label className="flex cursor-pointer items-center gap-1.5 rounded-[4px] border border-[#DEE2E6] bg-[#F8F9FA] px-2 py-1 text-xs font-medium text-[#212529]">
                  <input
                    type="checkbox"
                    checked={autoUpdateBookmarksOnDelete}
                    onChange={(e) => setAutoUpdateBookmarksOnDelete(e.target.checked)}
                  />
                  <span>{t.image2pdf.autoUpdateBookmarksLabel}</span>
                </label>
              )}
              <button
                type="button"
                onClick={() => setShowBookmarks((v) => !v)}
                className="knit-control-sm knit-btn-secondary ml-1 inline-flex items-center gap-1.5 px-2.5 text-xs"
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

          {selectionMode && (
            <div className="knit-card flex flex-wrap items-center justify-between gap-2 border-[#007BFF] bg-[#EDF6FF] px-3.5 py-2 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-[4px] bg-[#007BFF] px-2 py-0.5 font-semibold text-white">
                  {t.image2pdf.selectionSelectedCount(selectedPageIds.size)}
                </span>
                <span className="text-[#495057]">{t.image2pdf.selectionHint}</span>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedPageIds(new Set(pages.map((p) => p.id)));
                    lastSelectedAnchorIdRef.current = pages[pages.length - 1]?.id ?? null;
                  }}
                  className="knit-control-sm knit-btn-secondary px-2 text-xs"
                >
                  {t.image2pdf.selectionSelectAll}
                </button>
                <button
                  type="button"
                  disabled={selectedPageIds.size === 0}
                  onClick={() => {
                    setSelectedPageIds(new Set());
                    lastSelectedAnchorIdRef.current = null;
                  }}
                  className="knit-control-sm knit-btn-secondary px-2 text-xs disabled:opacity-45"
                >
                  {t.image2pdf.selectionClear}
                </button>
                <button
                  type="button"
                  disabled={selectedPageIds.size === 0}
                  onClick={rotateSelectedPages}
                  className="knit-control-sm knit-btn-secondary inline-flex items-center gap-1 px-2 text-xs disabled:opacity-45"
                >
                  <RotateCw className="h-3.5 w-3.5 text-[#007BFF]" />
                  <span>{t.image2pdf.selectionRotate90}</span>
                </button>
                <button
                  type="button"
                  disabled={selectedPageIds.size === 0}
                  onClick={deleteSelectedPages}
                  className="knit-control-sm inline-flex items-center gap-1 rounded-[4px] border border-[#F5C2C7] bg-[#F8D7DA] px-2 text-xs font-semibold text-[#842029] hover:bg-[#F1AEB5] disabled:opacity-45"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>{t.image2pdf.selectionDelete}</span>
                </button>
                <button
                  type="button"
                  onClick={exitSelectionMode}
                  className="knit-control-sm knit-btn-secondary inline-flex items-center gap-1 px-2 text-xs"
                >
                  <X className="h-3.5 w-3.5" />
                  <span>{t.image2pdf.selectionDone}</span>
                </button>
              </div>
            </div>
          )}

          <div
            ref={splitContainerRef}
            style={
              showBookmarks
                ? ({ "--img-left": `${(liveLeftRatio * 100).toFixed(2)}%` } as React.CSSProperties)
                : undefined
            }
            className={
              showBookmarks
                ? "grid grid-cols-1 items-start gap-4 lg:gap-2 lg:[grid-template-columns:var(--img-left)_12px_minmax(0,1fr)]"
                : "grid grid-cols-1 gap-4"
            }
          >
            <div className="min-w-0 space-y-3">
              <div
                ref={gridOuterRef}
                style={{
                  paddingTop: `${grid.topPadPx}px`,
                  paddingBottom: `${grid.bottomPadPx}px`,
                }}
              >
                <div
                  ref={gridInnerRef}
                  className="grid gap-3 select-none"
                  style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}
                >
                  {visiblePages.map((page, localIdx) => {
                    const idx = grid.startIdx + localIdx;
                    const showBarLeft = !isNoOpInsert && insertAt === idx;
                    const showBarEnd =
                      !isNoOpInsert && insertAt === pages.length && idx === pages.length - 1;
                    const pageBookmarks = pageBookmarkMap.get(idx);

                    return (
                      <ImagePageCard
                        key={page.id}
                        page={page}
                        idx={idx}
                        cardSize={cardSize}
                        thumbUrl={thumbQueue.thumbs[page.id]}
                        thumbBakedSig={thumbQueue.thumbMetas[page.id]?.sig}
                        thumbBakedRot={thumbQueue.thumbMetas[page.id]?.bakedRot ?? 0}
                        loadThumbs={loadThumbs}
                        selectionMode={selectionMode}
                        isSelected={selectedPageIds.has(page.id)}
                        isMissing={missingSourcePaths.has(page.source.path)}
                        missingBadgeLabel={t.image2pdf.missingFileBadge}
                        bookmarkTitles={pageBookmarkMap.get(idx)}
                        bookmarkTooltip={
                          pageBookmarks ? t.image2pdf.bookmarkBadgeTitle(pageBookmarks) : undefined
                        }
                        isDragged={dragIndex !== null && (dragIndex === idx || draggingPageIds.has(page.id))}
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
                        onContextMenuCard={handleCardContextMenu}
                        onRotate={rotatePage}
                        onEdit={handleEditPage}
                        onRemove={removePage}
                      />
                    );
                  })}
                </div>
              </div>
            </div>

            {showBookmarks && (
              <>
                <PaneResizeHandle
                  orientation="vertical"
                  title={t.image2pdf.resizeWidthTitle}
                  ariaLabel={t.image2pdf.resizeWidthTitle}
                  onPointerDown={handleSplitWidthResize}
                />
                <div className="min-w-0 space-y-2 lg:sticky lg:-top-3 lg:self-start">
                  <BookmarkTreeEditor
                    nodes={bookmarks}
                    totalPages={pages.length}
                    enableGlobalUndoShortcut={false}
                    onChange={setBookmarks}
                  />
                </div>
              </>
            )}
          </div>
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
            {draggingPageIds.size > 1 ? `${draggingPageIds.size}×` : `#${dragIndex + 1}`}
          </span>
          <span className="max-w-[180px] truncate">
            {draggingPageIds.size > 1
              ? t.image2pdf.multiDragGhostLabel(draggingPageIds.size)
              : pages[dragIndex].label}
          </span>
        </div>
      )}

      <ImagePreviewModal
        page={previewPage}
        loadThumbs={loadThumbs}
        editedPreviewCache={editedPreviewCache}
        resolveFullResSrc={resolveFullResSrc}
        onClose={() => setPreviewPageId(null)}
        onOpenEditor={(id) => {
          setPreviewPageId(null);
          setEditingPageId(id);
        }}
      />

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

      <ExportConflictModal
        conflictPaths={pendingConflict?.conflicts ?? []}
        isLockedByActiveJob={pendingConflict?.lockedByActiveJob}
        onResolve={(c) => void handleConflictResolution(c)}
      />

      <ImageContextMenu
        page={contextMenuPage}
        pageIndex={contextMenu?.pageIndex ?? 0}
        x={contextMenu?.x ?? 0}
        y={contextMenu?.y ?? 0}
        onClose={() => setContextMenu(null)}
        onRotateBy={rotatePageBy}
        onDelete={removePage}
        onPreviewInfo={(id) => setPreviewPageId(id)}
        onCopyImagePath={handleCopyImagePath}
        onCopyFolderPath={handleCopyFolderPath}
        onAttachBookmark={handleAttachBookmarkAtPage}
        onSelectPage={handleSelectSingleFromContext}
      />

      <ImportFeedbackToast toast={importToast} />
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
