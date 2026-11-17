import React from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { NumberInput } from "../components/NumberInput";
import { Select } from "../components/Select";
import {
  AlertTriangle,
  Eraser,
  FilePlus,
  GripHorizontal,
  GripVertical,
  Layers,
  PanelRightClose,
  PanelRightOpen,
  Scissors,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { BookmarkTreeEditor } from "../components/BookmarkTreeEditor";
import { Dropzone } from "../components/Dropzone";
import {
  ExportConflictModal,
  type ConflictResolution,
} from "../components/ExportConflictModal";
import { ExportFilenameControl } from "../components/ExportFilenameControl";
import {
  ImportFeedbackToast,
  useImportFeedback,
} from "../components/ImportFeedbackToast";
import {
  MergePageCard,
  SplitSectionItemCard,
  SplitSourceCard,
} from "../components/PdfPageCards";
import { PdfPageZoomModal } from "../components/PdfPageZoomModal";
import { useI18n } from "../i18n";
import {
  checkExportConflicts,
  formatBytes,
  inspectPdfFile,
  isTauriRuntime,
  mergePdfFiles,
  pickDirectory,
  pickFiles,
  pickSaveFile,
  renderPdfThumbFile,
  resolveUniqueExportPath,
  splitMultiPdfFiles,
  splitPdfFile,
} from "../lib/ipc";
import { joinDirAndFile, useExportFilenameCheck } from "../lib/exportPath";
import {
  computeVisibleRowRange,
  hitTestGridInsertIndex,
  mergeThumbCacheLru,
} from "../lib/imageGrid";
import { usePersistentState } from "../lib/storage";
import { useVerticalResize } from "../hooks/useVerticalResize";
import type {
  BookmarkNode,
  JobEvent,
  PageSelection,
  PdfInfo,
  PdfSplitRule,
} from "../types/ipc";
import type { DroppedBatch } from "./Image2PdfView";

const GRID_COL_OPTIONS = [2, 3, 4, 5, 6, 8] as const;

interface PdfOpsViewProps {
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
  defaultExportDir?: string;
}

interface SplitSectionItem {
  uid: string;
  file_index: number;
  page_index: number;
  rotation_deg: number;
}

interface SplitSectionDraft {
  id: string;
  name: string;
  pages: SplitSectionItem[];
}

type SplitDragPayload =
  | { kind: "source"; file_index: number; page_index: number }
  | { kind: "source_many"; items: { file_index: number; page_index: number }[] }
  | { kind: "section_item"; sectionId: string; itemIndex: number };

interface SplitDragVisual {
  label: string;
  count: number;
  fileIndex: number;
  pageIndex: number;
  rotationDeg: number;
  thumbUrl?: string;
  sourceSecId?: string;
  sourceItemIdx?: number;
}

function sourceKey(fileIndex: number, pageIndex: number): string {
  return `${fileIndex}:${pageIndex}`;
}

function parseSourceKey(key: string): { fileIndex: number; pageIndex: number } | null {
  const [fStr, pStr] = key.split(":");
  const fileIndex = Number(fStr);
  const pageIndex = Number(pStr);
  if (!Number.isInteger(fileIndex) || !Number.isInteger(pageIndex)) return null;
  return { fileIndex, pageIndex };
}

export const PdfOpsView: React.FC<PdfOpsViewProps> = ({
  onStartJob,
  onJobEvent,
  onFinishJob,
  busy,
  droppedBatch,
  defaultExportDir = "",
}) => {
  const { t } = useI18n();
  const { toast: importToast, highlighted: importHighlighted, notifyImported } =
    useImportFeedback();

  const [tab, setTab] = usePersistentState<"merge" | "split">("knit.pdfops.tab", "merge");
  const [files, setFiles] = React.useState<PdfInfo[]>([]);
  const [selections, setSelections] = React.useState<PageSelection[]>([]);
  const [mergeBookmarks, setMergeBookmarks] = React.useState<BookmarkNode[]>([]);
  const [showMergeBookmarks, setShowMergeBookmarks] = usePersistentState<boolean>(
    "knit.pdfops.showMergeBookmarks",
    true,
  );
  const [mergeGridCols, setMergeGridCols] = usePersistentState<number>(
    "knit.pdfops.mergeGridCols",
    5,
  );
  const [splitSourceCols, setSplitSourceCols] = usePersistentState<number>(
    "knit.pdfops.splitSourceCols",
    3,
  );
  const [importingPdfs, setImportingPdfs] = React.useState(false);
  const [importProgress, setImportProgress] = React.useState<{
    done: number;
    total: number;
  } | null>(null);

  // Merge virtualization & pointer drag state
  const [mergeDragIdx, setMergeDragIdx] = React.useState<number | null>(null);
  const [mergeInsertAt, setMergeInsertAt] = React.useState<number | null>(null);
  const mergeInsertAtRef = React.useRef<number | null>(null);
  mergeInsertAtRef.current = mergeInsertAt;
  const mergeGridOuterRef = React.useRef<HTMLDivElement | null>(null);
  const mergeGridInnerRef = React.useRef<HTMLDivElement | null>(null);
  const mergeDragGhostRef = React.useRef<HTMLDivElement | null>(null);
  const initialMergeGhostPosRef = React.useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const mergeColsRef = React.useRef<number>(mergeGridCols);
  mergeColsRef.current = mergeGridCols;
  const [mergeRowStride, setMergeRowStride] = React.useState<number>(216);
  const mergeRowStrideRef = React.useRef<number>(mergeRowStride);
  mergeRowStrideRef.current = mergeRowStride;
  const [mergeVisibleRange, setMergeVisibleRange] = React.useState<{
    startRow: number;
    endRow: number;
  }>({ startRow: 0, endRow: 12 });

  // Split source virtualization state
  const splitSourceGridOuterRef = React.useRef<HTMLDivElement | null>(null);
  const splitSourceGridInnerRef = React.useRef<HTMLDivElement | null>(null);
  const splitSourceColsRef = React.useRef<number>(splitSourceCols);
  splitSourceColsRef.current = splitSourceCols;
  const [splitSourceRowStride, setSplitSourceRowStride] = React.useState<number>(106);
  const splitSourceRowStrideRef = React.useRef<number>(splitSourceRowStride);
  splitSourceRowStrideRef.current = splitSourceRowStride;
  const [splitSourceVisibleRange, setSplitSourceVisibleRange] = React.useState<{
    startRow: number;
    endRow: number;
  }>({ startRow: 0, endRow: 14 });
  const [splitSourceFilterIdx, setSplitSourceFilterIdx] = React.useState<number | "all">("all");

  const selectionsLengthRef = React.useRef<number>(selections.length);
  selectionsLengthRef.current = selections.length;
  const filesRef = React.useRef<PdfInfo[]>(files);
  filesRef.current = files;
  const selectionsRef = React.useRef<PageSelection[]>(selections);
  selectionsRef.current = selections;
  const tabRef = React.useRef<"merge" | "split">(tab);
  tabRef.current = tab;

  const [pendingClearAll, setPendingClearAll] = React.useState(false);
  const [thumbs, setThumbs] = React.useState<Record<string, string>>({});
  const thumbsRef = React.useRef<Record<string, string>>(thumbs);
  thumbsRef.current = thumbs;
  const [preserveBookmarks, setPreserveBookmarks] = usePersistentState<boolean>(
    "knit.pdfops.preserveBookmarks",
    true,
  );
  const [mergeExportFilename, setMergeExportFilename] = usePersistentState<string>(
    "knit.pdfops.mergeExportFilename",
    "merged.pdf",
  );
  const [splitPrefixFilename, setSplitPrefixFilename] = usePersistentState<string>(
    "knit.pdfops.splitPrefixFilename",
    "",
  );
  const {
    effectiveFilename: effectiveMergeFilename,
    defaultTargetPath: defaultMergeTargetPath,
    existsAtDefaultDir: mergeExistsAtDefaultDir,
  } = useExportFilenameCheck(defaultExportDir, mergeExportFilename, "merged.pdf", ["pdf"]);
  const [zoomTarget, setZoomTarget] = React.useState<{
    path: string;
    pageIndex: number;
    rotationDeg: number;
    fallbackThumbSrc?: string;
  } | null>(null);
  const [pendingRemoveFileIdx, setPendingRemoveFileIdx] = React.useState<number | null>(null);
  const [pendingConflict, setPendingConflict] = React.useState<
    | { kind: "merge"; outPath: string; conflicts: string[] }
    | {
        kind: "split";
        inputs: string[];
        stems: string[];
        outDir: string;
        rule: PdfSplitRule;
        conflicts: string[];
      }
    | null
  >(null);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const [splitRuleKind, setSplitRuleKind] = usePersistentState<
    "page_ranges" | "every_n_pages" | "max_bytes"
  >("knit.pdfops.splitRuleKind", "every_n_pages");
  const [rangesStr, setRangesStr] = usePersistentState<string>("knit.pdfops.rangesStr", "1-2");
  const [everyN, setEveryN] = usePersistentState<number>("knit.pdfops.everyN", 2);
  const [splitMaxMb, setSplitMaxMb] = usePersistentState<number>("knit.pdfops.splitMaxMb", 20);

  const [splitSections, setSplitSections] = React.useState<SplitSectionDraft[]>([]);
  const splitSectionsRef = React.useRef<SplitSectionDraft[]>(splitSections);
  splitSectionsRef.current = splitSections;
  const [activeSectionId, setActiveSectionId] = React.useState<string | null>(null);
  const [hoverSectionId, setHoverSectionId] = React.useState<string | null>(null);
  const hoverSectionIdRef = React.useRef<string | null>(null);
  hoverSectionIdRef.current = hoverSectionId;
  const [splitInsertTarget, setSplitInsertTarget] = React.useState<{
    sectionId: string;
    index: number;
  } | null>(null);
  const splitInsertTargetRef = React.useRef<{ sectionId: string; index: number } | null>(null);
  splitInsertTargetRef.current = splitInsertTarget;

  const splitDragRef = React.useRef<SplitDragPayload | null>(null);
  const [splitDragActive, setSplitDragActive] = React.useState<SplitDragVisual | null>(null);
  const splitDragGhostRef = React.useRef<HTMLDivElement | null>(null);
  const initialSplitGhostPosRef = React.useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const splitSourceScrollRef = React.useRef<HTMLDivElement | null>(null);
  const splitSectionsScrollRef = React.useRef<HTMLDivElement | null>(null);

  // Per-section custom height (auto up to 280px by default, draggable 120..720px)
  const [sectionHeightsPx, setSectionHeightsPx] = usePersistentState<Record<string, number>>(
    "knit.pdfops.sectionHeightsPx",
    {},
  );
  const [resizingSecHeight, setResizingSecHeight] = React.useState<{
    id: string;
    height: number;
  } | null>(null);

  // Split workbench resize & source page multi-select
  const [splitLeftRatio, setSplitLeftRatio] = usePersistentState<number>(
    "knit.pdfops.splitLeftRatio",
    0.42,
  );
  const [liveSplitRatio, setLiveSplitRatio] = React.useState(splitLeftRatio);
  React.useEffect(() => {
    setLiveSplitRatio(splitLeftRatio);
  }, [splitLeftRatio]);

  const [sourcePaneHeightPx, setSourcePaneHeightPx] = usePersistentState<number>(
    "knit.pdfops.sourcePaneHeightPx",
    540,
  );
  const [sectionsPaneHeightPx, setSectionsPaneHeightPx] = usePersistentState<number>(
    "knit.pdfops.sectionsPaneHeightPx",
    540,
  );

  const { height: liveSourceHeightPx, handlePointerDown: handleSourceHeightResize } =
    useVerticalResize({
      value: sourcePaneHeightPx,
      min: 240,
      max: 1100,
      onCommit: setSourcePaneHeightPx,
    });
  const { height: liveSectionsHeightPx, handlePointerDown: handleSectionsHeightResize } =
    useVerticalResize({
      value: sectionsPaneHeightPx,
      min: 240,
      max: 1100,
      onCommit: setSectionsPaneHeightPx,
    });

  const splitGridRef = React.useRef<HTMLDivElement | null>(null);
  const handleSplitWidthResize = React.useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const container = splitGridRef.current;
      if (!container) return;
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      if (rect.width <= 0) return;
      let latest = liveSplitRatio;
      const clampRatio = (r: number) => Math.min(0.72, Math.max(0.24, r));

      const onMove = (ev: PointerEvent) => {
        latest = clampRatio((ev.clientX - rect.left) / rect.width);
        setLiveSplitRatio(latest);
      };
      const finish = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
        setSplitLeftRatio(Number(latest.toFixed(4)));
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
    },
    [liveSplitRatio, setSplitLeftRatio],
  );

  const handleSectionCardHeightResize = React.useCallback(
    (e: React.PointerEvent<HTMLElement>, sectionId: string) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const bodyEl = document.querySelector<HTMLElement>(
        `[data-split-section-scroll="${sectionId}"]`,
      );
      const startH =
        sectionHeightsPx[sectionId] ??
        Math.max(140, Math.round(bodyEl?.getBoundingClientRect().height ?? 220));
      const startY = e.clientY;
      let latest = startH;

      const clamp = (val: number) => Math.min(720, Math.max(120, Math.round(val)));

      const onMove = (ev: PointerEvent) => {
        latest = clamp(startH + (ev.clientY - startY));
        setResizingSecHeight({ id: sectionId, height: latest });
      };
      const finish = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
        setResizingSecHeight(null);
        setSectionHeightsPx((prev) => ({ ...prev, [sectionId]: latest }));
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
    },
    [sectionHeightsPx, setSectionHeightsPx],
  );

  // Flattened Split Source pages (all PDFs or filtered to 1 PDF)
  const displayedSplitSourceItems = React.useMemo(() => {
    const out: { fileIndex: number; pageIndex: number }[] = [];
    if (typeof splitSourceFilterIdx === "number" && files[splitSourceFilterIdx]) {
      const f = files[splitSourceFilterIdx];
      for (let p = 0; p < f.page_count; p++) {
        out.push({ fileIndex: splitSourceFilterIdx, pageIndex: p });
      }
      return out;
    }
    for (let fIdx = 0; fIdx < files.length; fIdx++) {
      const f = files[fIdx];
      for (let p = 0; p < f.page_count; p++) {
        out.push({ fileIndex: fIdx, pageIndex: p });
      }
    }
    return out;
  }, [files, splitSourceFilterIdx]);

  const displayedSplitSourceRef = React.useRef(displayedSplitSourceItems);
  displayedSplitSourceRef.current = displayedSplitSourceItems;

  const displayedIndexByKey = React.useMemo(() => {
    const m = new Map<string, number>();
    displayedSplitSourceItems.forEach((it, idx) => {
      m.set(sourceKey(it.fileIndex, it.pageIndex), idx);
    });
    return m;
  }, [displayedSplitSourceItems]);

  const [selectedSourceKeys, setSelectedSourceKeys] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [lastClickedSourcePos, setLastClickedSourcePos] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (typeof splitSourceFilterIdx === "number" && splitSourceFilterIdx >= files.length) {
      setSplitSourceFilterIdx("all");
    }
  }, [files.length, splitSourceFilterIdx]);

  const handleSourcePageClick = (
    e: React.MouseEvent,
    fileIndex: number,
    pageIndex: number,
  ) => {
    const key = sourceKey(fileIndex, pageIndex);
    const pos = displayedIndexByKey.get(key) ?? null;

    if (e.shiftKey && lastClickedSourcePos !== null && pos !== null) {
      const start = Math.min(lastClickedSourcePos, pos);
      const end = Math.max(lastClickedSourcePos, pos);
      setSelectedSourceKeys((prev) => {
        const next = e.ctrlKey || e.metaKey ? new Set(prev) : new Set<string>();
        for (let i = start; i <= end; i++) {
          const item = displayedSplitSourceItems[i];
          if (item) next.add(sourceKey(item.fileIndex, item.pageIndex));
        }
        return next;
      });
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      setSelectedSourceKeys((prev) => {
        const next = new Set(prev);
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
        return next;
      });
      setLastClickedSourcePos(pos);
      return;
    }
    setSelectedSourceKeys(new Set([key]));
    setLastClickedSourcePos(pos);
  };

  const sortedSelectedSourceItems = React.useMemo(() => {
    const items: { file_index: number; page_index: number }[] = [];
    selectedSourceKeys.forEach((k) => {
      const parsed = parseSourceKey(k);
      if (parsed) {
        items.push({ file_index: parsed.fileIndex, page_index: parsed.pageIndex });
      }
    });
    items.sort((a, b) =>
      a.file_index !== b.file_index ? a.file_index - b.file_index : a.page_index - b.page_index,
    );
    return items;
  }, [selectedSourceKeys]);

  const lastHandledDropSeq = React.useRef<number>(0);

  // Thumbnail queue & LRU cache (deterministic visible-range + section feeding)
  const visibleThumbKeysRef = React.useRef<Set<string>>(new Set());
  const sectionThumbKeysRef = React.useRef<Set<string>>(new Set());
  const queuedThumbSetRef = React.useRef<Set<string>>(new Set());
  const queuedThumbOrderRef = React.useRef<string[]>([]);
  const inFlightThumbKeysRef = React.useRef<Set<string>>(new Set());
  const failedThumbKeysRef = React.useRef<Set<string>>(new Set());
  const activeThumbWorkersRef = React.useRef<number>(0);
  const thumbGenRef = React.useRef<number>(0);
  const pendingThumbBatchRef = React.useRef<Record<string, string>>({});
  const thumbFlushTimerRef = React.useRef<number | null>(null);

  const flushPendingPdfThumbs = React.useCallback(() => {
    thumbFlushTimerRef.current = null;
    const batch = pendingThumbBatchRef.current;
    if (Object.keys(batch).length === 0) return;
    pendingThumbBatchRef.current = {};
    const protectedKeys = new Set<string>(visibleThumbKeysRef.current);
    sectionThumbKeysRef.current.forEach((k) => protectedKeys.add(k));
    const { nextCache } = mergeThumbCacheLru(thumbsRef.current, batch, 500, protectedKeys);
    thumbsRef.current = nextCache;
    setThumbs(nextCache);
  }, []);

  const schedulePdfThumbFlush = React.useCallback(() => {
    if (thumbFlushTimerRef.current !== null) return;
    thumbFlushTimerRef.current = window.setTimeout(flushPendingPdfThumbs, 40);
  }, [flushPendingPdfThumbs]);

  const pumpPdfThumbQueue = React.useCallback(() => {
    if (!isTauriRuntime()) return;
    const CONCURRENCY = 3;
    while (activeThumbWorkersRef.current < CONCURRENCY && queuedThumbOrderRef.current.length > 0) {
      const key = queuedThumbOrderRef.current.pop();
      if (!key) break;
      if (!queuedThumbSetRef.current.delete(key)) continue;
      if (!visibleThumbKeysRef.current.has(key) && !sectionThumbKeysRef.current.has(key)) {
        continue;
      }
      if (
        thumbsRef.current[key] ||
        inFlightThumbKeysRef.current.has(key) ||
        failedThumbKeysRef.current.has(key)
      ) {
        continue;
      }
      const parsed = parseSourceKey(key);
      if (!parsed) continue;
      const info = filesRef.current[parsed.fileIndex];
      if (!info) continue;

      inFlightThumbKeysRef.current.add(key);
      activeThumbWorkersRef.current += 1;
      const gen = thumbGenRef.current;

      void (async () => {
        try {
          const thumbPath = await renderPdfThumbFile(info.path, parsed.pageIndex, 240);
          if (thumbGenRef.current !== gen) return;
          const url = convertFileSrc(thumbPath);
          thumbsRef.current[key] = url;
          pendingThumbBatchRef.current[key] = url;
          schedulePdfThumbFlush();
        } catch {
          if (thumbGenRef.current === gen) {
            failedThumbKeysRef.current.add(key);
          }
        } finally {
          inFlightThumbKeysRef.current.delete(key);
          activeThumbWorkersRef.current = Math.max(0, activeThumbWorkersRef.current - 1);
          if (thumbGenRef.current === gen) {
            pumpPdfThumbQueue();
          }
        }
      })();
    }
  }, [schedulePdfThumbFlush]);

  const enqueuePdfThumb = React.useCallback(
    (key: string) => {
      if (!isTauriRuntime()) return;
      if (
        thumbsRef.current[key] ||
        inFlightThumbKeysRef.current.has(key) ||
        failedThumbKeysRef.current.has(key)
      ) {
        return;
      }
      if (!queuedThumbSetRef.current.has(key)) {
        queuedThumbSetRef.current.add(key);
        queuedThumbOrderRef.current.push(key);
      }
      pumpPdfThumbQueue();
    },
    [pumpPdfThumbQueue],
  );

  const enqueueThumbWindow = React.useCallback(
    (keys: string[]) => {
      if (!isTauriRuntime() || keys.length === 0) return;
      visibleThumbKeysRef.current = new Set(keys);
      // Push bottom-to-top so LIFO pop() renders top-most visible cards first
      for (let i = keys.length - 1; i >= 0; i--) {
        const key = keys[i];
        if (
          thumbsRef.current[key] ||
          inFlightThumbKeysRef.current.has(key) ||
          failedThumbKeysRef.current.has(key)
        ) {
          continue;
        }
        if (!queuedThumbSetRef.current.has(key)) {
          queuedThumbSetRef.current.add(key);
          queuedThumbOrderRef.current.push(key);
        }
      }
      pumpPdfThumbQueue();
    },
    [pumpPdfThumbQueue],
  );

  const registerThumbCardRef = React.useCallback(
    (key: string, el: HTMLDivElement | null) => {
      if (el) {
        visibleThumbKeysRef.current.add(key);
        enqueuePdfThumb(key);
      }
    },
    [enqueuePdfThumb],
  );

  React.useEffect(() => {
    const nextSectionKeys = new Set<string>();
    for (const sec of splitSections) {
      for (const item of sec.pages) {
        nextSectionKeys.add(sourceKey(item.file_index, item.page_index));
      }
    }
    sectionThumbKeysRef.current = nextSectionKeys;
    if (tab === "split" && nextSectionKeys.size > 0) {
      nextSectionKeys.forEach((k) => enqueuePdfThumb(k));
    }
  }, [splitSections, tab, enqueuePdfThumb]);

  React.useEffect(() => {
    return () => {
      if (thumbFlushTimerRef.current !== null) {
        window.clearTimeout(thumbFlushTimerRef.current);
      }
    };
  }, []);

  // Measure Merge grid geometry, virtualize visible rows & queue thumbnails for visible window
  const updateMergeVisibleRange = React.useCallback(() => {
    const gridEl = mergeGridOuterRef.current;
    const innerEl = mergeGridInnerRef.current;
    const cols = Math.max(1, mergeColsRef.current);
    if (innerEl) {
      const firstCard = innerEl.firstElementChild as HTMLElement | null;
      if (firstCard) {
        const h = firstCard.getBoundingClientRect().height;
        if (h > 40) {
          const nextStride = Math.round(h + 12);
          if (Math.abs(nextStride - mergeRowStrideRef.current) > 2) {
            mergeRowStrideRef.current = nextStride;
            setMergeRowStride(nextStride);
          }
        }
      }
    }

    const total = selectionsLengthRef.current;
    const scrollEl = gridEl?.closest("main") as HTMLElement | null;
    let startRow = 0;
    let endRow = Math.max(0, Math.min(Math.ceil(total / cols) - 1, 14));

    if (gridEl && scrollEl && scrollEl.clientHeight > 0) {
      const gridRect = gridEl.getBoundingClientRect();
      const scrollRect = scrollEl.getBoundingClientRect();
      const next = computeVisibleRowRange({
        totalItems: total,
        gridCols: cols,
        rowStride: mergeRowStrideRef.current,
        gridRectTop: gridRect.top,
        scrollRectTop: scrollRect.top,
        viewportHeight: scrollEl.clientHeight,
        overscanRows: 3,
      });
      startRow = next.startRow;
      endRow = next.endRow;
    }

    setMergeVisibleRange((prev) =>
      prev.startRow === startRow && prev.endRow === endRow ? prev : { startRow, endRow },
    );

    if (tabRef.current === "merge" && total > 0 && endRow >= startRow) {
      const startIdx = startRow * cols;
      const endExcl = Math.min(total, (endRow + 1) * cols);
      const keys: string[] = [];
      for (let i = startIdx; i < endExcl; i++) {
        const sel = selectionsRef.current[i];
        if (sel) keys.push(sourceKey(sel.file_index, sel.page_index));
      }
      enqueueThumbWindow(keys);
    }
  }, [enqueueThumbWindow]);

  React.useEffect(() => {
    if (tab !== "merge" || selections.length === 0) return;
    let rafId: number | null = null;
    const schedule = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        updateMergeVisibleRange();
      });
    };
    schedule();
    const gridEl = mergeGridOuterRef.current;
    const scrollEl = gridEl?.closest("main") ?? null;
    scrollEl?.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(schedule);
      if (gridEl) ro.observe(gridEl);
      if (scrollEl) ro.observe(scrollEl);
    }
    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      scrollEl?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      ro?.disconnect();
    };
  }, [tab, selections.length, mergeGridCols, updateMergeVisibleRange]);

  // Measure & virtualize Split Source Pages scrollbox + deterministically enqueue visible thumbs
  const updateSplitSourceVisibleRange = React.useCallback(() => {
    const scrollEl = splitSourceScrollRef.current;
    const gridEl = splitSourceGridOuterRef.current;
    const innerEl = splitSourceGridInnerRef.current;
    const cols = Math.max(1, splitSourceColsRef.current);

    if (innerEl) {
      const firstCard = innerEl.firstElementChild as HTMLElement | null;
      if (firstCard) {
        const h = firstCard.getBoundingClientRect().height;
        if (h > 40) {
          const nextStride = Math.round(h + 8); // gap-2 = 8px
          if (Math.abs(nextStride - splitSourceRowStrideRef.current) > 2) {
            splitSourceRowStrideRef.current = nextStride;
            setSplitSourceRowStride(nextStride);
          }
        }
      }
    }

    const list = displayedSplitSourceRef.current;
    const total = list.length;
    let startRow = 0;
    let endRow = Math.max(0, Math.min(Math.ceil(total / cols) - 1, 14));

    if (scrollEl && gridEl && scrollEl.clientHeight > 0) {
      const gridRect = gridEl.getBoundingClientRect();
      const scrollRect = scrollEl.getBoundingClientRect();
      const next = computeVisibleRowRange({
        totalItems: total,
        gridCols: cols,
        rowStride: splitSourceRowStrideRef.current,
        gridRectTop: gridRect.top,
        scrollRectTop: scrollRect.top,
        viewportHeight: scrollEl.clientHeight,
        overscanRows: 3,
      });
      startRow = next.startRow;
      endRow = next.endRow;
    }

    setSplitSourceVisibleRange((prev) =>
      prev.startRow === startRow && prev.endRow === endRow ? prev : { startRow, endRow },
    );

    if (tabRef.current === "split" && total > 0 && endRow >= startRow) {
      const startIdx = startRow * cols;
      const endExcl = Math.min(total, (endRow + 1) * cols);
      const keys: string[] = [];
      for (let i = startIdx; i < endExcl; i++) {
        const it = list[i];
        if (it) keys.push(sourceKey(it.fileIndex, it.pageIndex));
      }
      enqueueThumbWindow(keys);
    }
  }, [enqueueThumbWindow]);

  React.useEffect(() => {
    if (tab !== "split" || displayedSplitSourceItems.length === 0) return;
    let rafId: number | null = null;
    const schedule = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        updateSplitSourceVisibleRange();
      });
    };
    schedule();
    const scrollEl = splitSourceScrollRef.current;
    scrollEl?.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    let ro: ResizeObserver | null = null;
    if (scrollEl && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(schedule);
      ro.observe(scrollEl);
    }
    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      scrollEl?.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      ro?.disconnect();
    };
  }, [
    tab,
    displayedSplitSourceItems.length,
    splitSourceCols,
    liveSourceHeightPx,
    updateSplitSourceVisibleRange,
  ]);

  const getOrigStem = (info: PdfInfo): string =>
    info.path.split(/[\\/]/).pop()?.replace(/\.pdf$/i, "") || "split";

  const getSplitStemForFile = React.useCallback(
    (info: PdfInfo, totalFiles: number): string => {
      const orig = getOrigStem(info);
      const cleanPrefix = splitPrefixFilename.trim().replace(/\.pdf$/i, "");
      if (!cleanPrefix) return orig;
      return totalFiles <= 1 ? cleanPrefix : `${cleanPrefix}_${orig}`;
    },
    [splitPrefixFilename],
  );

  const makeDefaultSectionsForPdf = React.useCallback(
    (info: PdfInfo, totalFiles: number): SplitSectionDraft[] => {
      const stem = getSplitStemForFile(info, totalFiles);
      const firstId = crypto.randomUUID();
      const secondId = crypto.randomUUID();
      return [
        { id: firstId, name: `${stem}_part01`, pages: [] },
        { id: secondId, name: `${stem}_part02`, pages: [] },
      ];
    },
    [getSplitStemForFile],
  );

  const offsetBookmarks = React.useCallback(
    (nodes: BookmarkNode[], offset: number): BookmarkNode[] =>
      nodes.map((n) => ({
        ...n,
        target_page_index: n.target_page_index + offset,
        children: offsetBookmarks(n.children, offset),
      })),
    [],
  );

  const addPdfPaths = React.useCallback(
    async (picked: string[]) => {
      const pdfPaths = picked.filter((p) => p.toLowerCase().endsWith(".pdf"));
      if (pdfPaths.length === 0) return;
      setErrorMsg(null);
      setImportingPdfs(true);
      setImportProgress({ done: 0, total: pdfPaths.length });
      try {
        const baseFileIdx = filesRef.current.length;
        const basePageOffset = selectionsRef.current.length;
        const newInfos: PdfInfo[] = [];
        const newSelections: PageSelection[] = [];
        const addedBookmarks: BookmarkNode[] = [];

        let runningPageOffset = basePageOffset;
        for (let i = 0; i < pdfPaths.length; i++) {
          const info = await inspectPdfFile(pdfPaths[i]);
          setImportProgress({ done: i + 1, total: pdfPaths.length });
          const fIdx = baseFileIdx + i;
          newInfos.push(info);
          for (let p = 0; p < info.page_count; p++) {
            newSelections.push({ file_index: fIdx, page_index: p, rotation_deg: 0 });
          }
          if (info.bookmarks.length > 0) {
            addedBookmarks.push(...offsetBookmarks(info.bookmarks, runningPageOffset));
          } else if (info.page_count > 0) {
            addedBookmarks.push({
              title: getOrigStem(info),
              target_page_index: runningPageOffset,
              children: [],
            });
          }
          runningPageOffset += info.page_count;
        }

        const mergedFileCount = baseFileIdx + newInfos.length;
        setFiles((prev) => [...prev, ...newInfos]);
        setSelections((prev) => [...prev, ...newSelections]);
        setMergeBookmarks((prev) => [...prev, ...addedBookmarks]);

        if (splitSectionsRef.current.length === 0 && newInfos[0]) {
          const initialSections = makeDefaultSectionsForPdf(newInfos[0], mergedFileCount);
          setSplitSections(initialSections);
          setActiveSectionId(initialSections[0]?.id ?? null);
        }

        const label =
          newInfos.length === 1
            ? newInfos[0].path.split(/[\\/]/).pop() ?? "PDF"
            : `${newInfos.length} PDF`;
        notifyImported(t.common.importSuccessToast(label));
      } catch (e) {
        setErrorMsg(String(e));
      } finally {
        setImportingPdfs(false);
        setImportProgress(null);
      }
    },
    [makeDefaultSectionsForPdf, notifyImported, offsetBookmarks, t.common],
  );

  React.useEffect(() => {
    if (!droppedBatch || droppedBatch.seq === lastHandledDropSeq.current) return;
    lastHandledDropSeq.current = droppedBatch.seq;
    void addPdfPaths(droppedBatch.paths);
  }, [droppedBatch, addPdfPaths]);

  React.useEffect(() => {
    if (tab === "split" && files.length > 0 && splitSections.length === 0) {
      const initial = makeDefaultSectionsForPdf(files[0], files.length);
      setSplitSections(initial);
      setActiveSectionId(initial[0]?.id ?? null);
    }
  }, [tab, files, splitSections.length, makeDefaultSectionsForPdf]);

  const handleAddPdfs = async () => {
    setErrorMsg(null);
    try {
      const picked = await pickFiles({
        title: t.pdfOps.pickPdfDialog,
        multiple: true,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (picked.length === 0) return;
      await addPdfPaths(picked);
    } catch (e) {
      setErrorMsg(String(e));
    }
  };

  const reorderMergeSelection = React.useCallback((fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    setSelections((prev) => {
      if (fromIdx < 0 || toIdx < 0 || fromIdx >= prev.length || toIdx >= prev.length) {
        return prev;
      }
      const copy = [...prev];
      const [item] = copy.splice(fromIdx, 1);
      copy.splice(toIdx, 0, item);
      return copy;
    });
  }, []);

  const handleMergeCardPointerDown = React.useCallback(
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
        const gridEl = mergeGridOuterRef.current;
        if (!gridEl) return null;
        const rect = gridEl.getBoundingClientRect();
        return hitTestGridInsertIndex({
          gridLeft: rect.left,
          gridTop: rect.top,
          gridWidth: rect.width,
          gridCols: Math.max(1, mergeColsRef.current),
          gapPx: 12,
          rowStride: mergeRowStrideRef.current,
          totalItems: selectionsLengthRef.current,
          clientX,
          clientY,
        });
      };

      const tickDrag = () => {
        rafId = null;
        if (!dragging) return;

        if (mergeDragGhostRef.current) {
          mergeDragGhostRef.current.style.transform = `translate3d(${latestX + 14}px, ${latestY + 14}px, 0)`;
        }

        const scrollEl = mergeGridOuterRef.current?.closest("main");
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
        if (nextInsert !== mergeInsertAtRef.current) {
          mergeInsertAtRef.current = nextInsert;
          setMergeInsertAt(nextInsert);
        }
      };

      const onMove = (ev: PointerEvent) => {
        latestX = ev.clientX;
        latestY = ev.clientY;
        if (!dragging) {
          if (Math.hypot(latestX - startX, latestY - startY) < 5) return;
          dragging = true;
          initialMergeGhostPosRef.current = { x: latestX + 14, y: latestY + 14 };
          setMergeDragIdx(idx);
          document.body.style.userSelect = "none";
          document.body.style.cursor = "grabbing";
        }
        if (rafId === null) {
          rafId = window.requestAnimationFrame(tickDrag);
        }
      };

      const finish = (ev: PointerEvent) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
        if (rafId !== null) {
          window.cancelAnimationFrame(rafId);
          rafId = null;
        }
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        if (dragging) {
          const finalInsert = computeInsert(ev.clientX, ev.clientY) ?? mergeInsertAtRef.current;
          if (finalInsert !== null && finalInsert !== idx && finalInsert !== idx + 1) {
            const targetIdx = finalInsert > idx ? finalInsert - 1 : finalInsert;
            reorderMergeSelection(idx, targetIdx);
          }
          mergeInsertAtRef.current = null;
          setMergeDragIdx(null);
          setMergeInsertAt(null);
        }
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
    },
    [reorderMergeSelection],
  );

  const handleRotateMergePage = React.useCallback((idx: number) => {
    setSelections((prev) =>
      prev.map((s, i) =>
        i === idx ? { ...s, rotation_deg: (s.rotation_deg + 90) % 360 } : s,
      ),
    );
  }, []);

  const handleRemoveMergePage = React.useCallback((idx: number) => {
    setSelections((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handleDoubleClickMergePage = React.useCallback((idx: number) => {
    const sel = selectionsRef.current[idx];
    if (!sel) return;
    const srcPath = filesRef.current[sel.file_index]?.path ?? "";
    if (!srcPath) return;
    const key = sourceKey(sel.file_index, sel.page_index);
    setZoomTarget({
      path: srcPath,
      pageIndex: sel.page_index,
      rotationDeg: sel.rotation_deg,
      fallbackThumbSrc: thumbsRef.current[key],
    });
  }, []);

  const confirmRemoveImportedFile = React.useCallback(() => {
    const removeIdx = pendingRemoveFileIdx;
    setPendingRemoveFileIdx(null);
    if (removeIdx === null || removeIdx < 0 || removeIdx >= files.length) return;

    const oldIndexToNewIndex = new Map<number, number>();
    let nextMergedIdx = 0;
    const nextSelections: PageSelection[] = [];
    selections.forEach((sel, oldIdx) => {
      if (sel.file_index === removeIdx) return;
      oldIndexToNewIndex.set(oldIdx, nextMergedIdx);
      nextMergedIdx += 1;
      nextSelections.push({
        ...sel,
        file_index: sel.file_index > removeIdx ? sel.file_index - 1 : sel.file_index,
      });
    });

    const filterAndRemapBookmarks = (nodes: BookmarkNode[]): BookmarkNode[] =>
      nodes.flatMap((n) => {
        const mapped = oldIndexToNewIndex.get(n.target_page_index);
        const children = filterAndRemapBookmarks(n.children);
        if (mapped === undefined) {
          return children;
        }
        return [{ ...n, target_page_index: mapped, children }];
      });

    thumbGenRef.current += 1;
    queuedThumbSetRef.current.clear();
    queuedThumbOrderRef.current = [];
    failedThumbKeysRef.current.clear();
    pendingThumbBatchRef.current = {};
    visibleThumbKeysRef.current.clear();
    sectionThumbKeysRef.current.clear();

    setFiles((prev) => prev.filter((_, idx) => idx !== removeIdx));
    setSelections(nextSelections);
    setMergeBookmarks((prev) => filterAndRemapBookmarks(prev));
    setSplitSections((prev) =>
      prev.map((sec) => ({
        ...sec,
        pages: sec.pages
          .filter((p) => p.file_index !== removeIdx)
          .map((p) => ({
            ...p,
            file_index: p.file_index > removeIdx ? p.file_index - 1 : p.file_index,
          })),
      })),
    );
    setSelectedSourceKeys(new Set());
    setLastClickedSourcePos(null);
    setSplitSourceFilterIdx((prev) => {
      if (typeof prev !== "number") return prev;
      if (prev === removeIdx) return "all";
      return prev > removeIdx ? prev - 1 : prev;
    });
    setThumbs((prev) => {
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(prev)) {
        const parsed = parseSourceKey(k);
        if (!parsed || parsed.fileIndex === removeIdx) continue;
        const remappedFile =
          parsed.fileIndex > removeIdx ? parsed.fileIndex - 1 : parsed.fileIndex;
        next[sourceKey(remappedFile, parsed.pageIndex)] = v;
      }
      thumbsRef.current = next;
      return next;
    });
  }, [pendingRemoveFileIdx, files.length, selections]);

  const handlePopulateSectionsFromRule = () => {
    if (files.length === 0) return;
    setErrorMsg(null);
    const items = displayedSplitSourceItems;
    const total = items.length;
    if (total === 0) return;

    const baseInfo =
      typeof splitSourceFilterIdx === "number" && files[splitSourceFilterIdx]
        ? files[splitSourceFilterIdx]
        : files[0];
    const stem = getSplitStemForFile(baseInfo, files.length);

    if (splitRuleKind === "every_n_pages") {
      const step = Math.max(1, everyN);
      const next: SplitSectionDraft[] = [];
      let part = 1;
      for (let start = 0; start < total; start += step) {
        const end = Math.min(total, start + step);
        const pages: SplitSectionItem[] = [];
        for (let i = start; i < end; i++) {
          const it = items[i];
          pages.push({
            uid: crypto.randomUUID(),
            file_index: it.fileIndex,
            page_index: it.pageIndex,
            rotation_deg: 0,
          });
        }
        next.push({
          id: crypto.randomUUID(),
          name: `${stem}_part${String(part).padStart(2, "0")}`,
          pages,
        });
        part += 1;
      }
      setSplitSections(next);
      if (next[0]) setActiveSectionId(next[0].id);
    } else if (splitRuleKind === "page_ranges") {
      const parsed = parsePageRangesClient(rangesStr, total);
      if (!parsed || parsed.length === 0) {
        setErrorMsg("Khoảng trang không hợp lệ (ví dụ: 1-3, 5).");
        return;
      }
      const nextId = crypto.randomUUID();
      setSplitSections([
        {
          id: nextId,
          name: `${stem}_extracted`,
          pages: parsed.map((idx) => {
            const it = items[idx];
            return {
              uid: crypto.randomUUID(),
              file_index: it.fileIndex,
              page_index: it.pageIndex,
              rotation_deg: 0,
            };
          }),
        },
      ]);
      setActiveSectionId(nextId);
    }
  };

  const addSection = () => {
    const stem = files[0] ? getSplitStemForFile(files[0], files.length) : "split";
    const id = crypto.randomUUID();
    const num = splitSections.length + 1;
    setSplitSections((prev) => [
      ...prev,
      { id, name: `${stem}_part${String(num).padStart(2, "0")}`, pages: [] },
    ]);
    setActiveSectionId(id);
  };

  const appendSourceItemsToSection = React.useCallback(
    (sourceItems: { file_index: number; page_index: number }[], targetSectionId?: string) => {
      if (sourceItems.length === 0) return;
      const targetId = targetSectionId ?? activeSectionId ?? splitSectionsRef.current[0]?.id;
      if (!targetId) return;
      const items: SplitSectionItem[] = sourceItems.map((it) => ({
        uid: crypto.randomUUID(),
        file_index: it.file_index,
        page_index: it.page_index,
        rotation_deg: 0,
      }));
      setSplitSections((prev) =>
        prev.map((sec) =>
          sec.id === targetId ? { ...sec, pages: [...sec.pages, ...items] } : sec,
        ),
      );
    },
    [activeSectionId],
  );

  const handleDropOnSection = React.useCallback(
    (targetSectionId: string, insertAtIndex?: number) => {
      const payload = splitDragRef.current;
      splitDragRef.current = null;
      setHoverSectionId(null);
      setSplitInsertTarget(null);
      if (!payload) return;

      if (payload.kind === "source" || payload.kind === "source_many") {
        const rawItems =
          payload.kind === "source_many"
            ? payload.items
            : [{ file_index: payload.file_index, page_index: payload.page_index }];
        const items: SplitSectionItem[] = rawItems.map((it) => ({
          uid: crypto.randomUUID(),
          file_index: it.file_index,
          page_index: it.page_index,
          rotation_deg: 0,
        }));
        setSplitSections((prev) =>
          prev.map((sec) => {
            if (sec.id !== targetSectionId) return sec;
            const nextPages = [...sec.pages];
            const idx =
              insertAtIndex !== undefined
                ? Math.max(0, Math.min(nextPages.length, insertAtIndex))
                : nextPages.length;
            nextPages.splice(idx, 0, ...items);
            return { ...sec, pages: nextPages };
          }),
        );
        return;
      }

      const { sectionId: fromSecId, itemIndex: fromIdx } = payload;
      setSplitSections((prev) => {
        const fromSec = prev.find((s) => s.id === fromSecId);
        const moving = fromSec?.pages[fromIdx];
        if (!moving) return prev;

        if (fromSecId === targetSectionId) {
          return prev.map((sec) => {
            if (sec.id !== targetSectionId) return sec;
            const nextPages = [...sec.pages];
            const rawTarget = insertAtIndex ?? nextPages.length;
            if (rawTarget === fromIdx || rawTarget === fromIdx + 1) {
              return sec;
            }
            nextPages.splice(fromIdx, 1);
            const adjusted = fromIdx < rawTarget ? rawTarget - 1 : rawTarget;
            const bounded = Math.max(0, Math.min(nextPages.length, adjusted));
            nextPages.splice(bounded, 0, moving);
            return { ...sec, pages: nextPages };
          });
        }

        return prev.map((sec) => {
          if (sec.id === fromSecId) {
            return { ...sec, pages: sec.pages.filter((_, i) => i !== fromIdx) };
          }
          if (sec.id === targetSectionId) {
            const nextPages = [...sec.pages];
            const idx =
              insertAtIndex !== undefined
                ? Math.max(0, Math.min(nextPages.length, insertAtIndex))
                : nextPages.length;
            nextPages.splice(idx, 0, moving);
            return { ...sec, pages: nextPages };
          }
          return sec;
        });
      });
    },
    [],
  );

  const selectedSourceKeysRef = React.useRef(selectedSourceKeys);
  selectedSourceKeysRef.current = selectedSourceKeys;
  const sortedSelectedSourceItemsRef = React.useRef(sortedSelectedSourceItems);
  sortedSelectedSourceItemsRef.current = sortedSelectedSourceItems;
  const handleSourcePageClickRef = React.useRef(handleSourcePageClick);
  handleSourcePageClickRef.current = handleSourcePageClick;

  // Pointer drag for Split Source -> Output Sections and Section Item reordering (matching Image2Pdf UX)
  const startSplitPointerDrag = React.useCallback(
    (
      e: React.PointerEvent<HTMLDivElement>,
      buildPayload: () => { payload: SplitDragPayload; visual: SplitDragVisual },
      onNoDragClick?: () => void,
    ) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest("button")) return;

      const startX = e.clientX;
      const startY = e.clientY;
      let dragging = false;
      let latestX = startX;
      let latestY = startY;
      let rafId: number | null = null;

      // Per-section cached geometry during a drag so rAF never thrashes layout across sections
      const sectionMetricsCache = new Map<
        string,
        { cols: number; rowStride: number; totalItems: number }
      >();

      const getGridMetrics = (gridEl: HTMLElement, sectionId: string) => {
        const cached = sectionMetricsCache.get(sectionId);
        if (cached) return cached;
        const colsRaw = window.getComputedStyle(gridEl).gridTemplateColumns.trim();
        const cols = colsRaw ? Math.max(1, colsRaw.split(/\s+/).length) : 4;
        const firstCard = gridEl.firstElementChild as HTMLElement | null;
        const cardH = firstCard ? firstCard.getBoundingClientRect().height : 108;
        const rowStride = Math.max(60, Math.round(cardH + 8));
        const totalItems =
          splitSectionsRef.current.find((s) => s.id === sectionId)?.pages.length ?? 0;
        const entry = { cols, rowStride, totalItems };
        sectionMetricsCache.set(sectionId, entry);
        return entry;
      };

      const computeSectionInsert = (
        secEl: HTMLElement,
        clientX: number,
        clientY: number,
      ): number => {
        const sectionId = secEl.dataset.splitSectionId ?? "";
        const gridEl = secEl.querySelector<HTMLElement>("[data-split-section-grid]");
        if (!gridEl || !sectionId) {
          return splitSectionsRef.current.find((s) => s.id === sectionId)?.pages.length ?? 0;
        }
        const metrics = getGridMetrics(gridEl, sectionId);
        if (metrics.totalItems <= 0) return 0;
        const rect = gridEl.getBoundingClientRect();
        return (
          hitTestGridInsertIndex({
            gridLeft: rect.left,
            gridTop: rect.top,
            gridWidth: rect.width,
            gridCols: metrics.cols,
            gapPx: 8,
            rowStride: metrics.rowStride,
            totalItems: metrics.totalItems,
            clientX,
            clientY,
          }) ?? metrics.totalItems
        );
      };

      const autoScrollContainer = (el: HTMLElement | null, clientY: number) => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        const edge = 48;
        if (clientY < r.top || clientY > r.bottom) return false;
        let dy = 0;
        if (clientY < r.top + edge) {
          dy = -Math.ceil(((r.top + edge - clientY) / edge) * 14);
        } else if (clientY > r.bottom - edge) {
          dy = Math.ceil(((clientY - (r.bottom - edge)) / edge) * 14);
        }
        if (dy !== 0) {
          const prev = el.scrollTop;
          el.scrollTop += dy;
          return el.scrollTop !== prev;
        }
        return false;
      };

      const tickSplit = () => {
        rafId = null;
        if (!dragging) return;
        if (splitDragGhostRef.current) {
          splitDragGhostRef.current.style.transform = `translate3d(${latestX + 14}px, ${latestY + 14}px, 0)`;
        }

        const scrolledSec = autoScrollContainer(splitSectionsScrollRef.current, latestY);
        const scrolledMain = autoScrollContainer(
          splitGridRef.current?.closest("main") as HTMLElement | null,
          latestY,
        );

        const hit = document.elementFromPoint(latestX, latestY) as HTMLElement | null;
        const secScrollEl = hit?.closest("[data-split-section-scroll]") as HTMLElement | null;
        const scrolledInner = autoScrollContainer(secScrollEl, latestY);

        if (scrolledSec || scrolledMain || scrolledInner) {
          rafId = window.requestAnimationFrame(tickSplit);
        }

        const secEl = hit?.closest("[data-split-section-id]") as HTMLElement | null;
        const nextHover = secEl?.dataset.splitSectionId ?? null;
        if (nextHover !== hoverSectionIdRef.current) {
          hoverSectionIdRef.current = nextHover;
          setHoverSectionId(nextHover);
        }

        const nextTarget =
          secEl && nextHover
            ? {
                sectionId: nextHover,
                index: computeSectionInsert(secEl, latestX, latestY),
              }
            : null;
        const prevTarget = splitInsertTargetRef.current;
        if (
          nextTarget?.sectionId !== prevTarget?.sectionId ||
          nextTarget?.index !== prevTarget?.index
        ) {
          splitInsertTargetRef.current = nextTarget;
          setSplitInsertTarget(nextTarget);
        }
      };

      const onMove = (ev: PointerEvent) => {
        latestX = ev.clientX;
        latestY = ev.clientY;
        if (!dragging) {
          if (Math.hypot(latestX - startX, latestY - startY) < 5) return;
          dragging = true;
          const built = buildPayload();
          splitDragRef.current = built.payload;
          initialSplitGhostPosRef.current = { x: latestX + 14, y: latestY + 14 };
          setSplitDragActive(built.visual);
          document.body.style.userSelect = "none";
          document.body.style.cursor = "grabbing";
        }
        if (rafId === null) {
          rafId = window.requestAnimationFrame(tickSplit);
        }
      };

      const finish = (ev: PointerEvent) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
        if (rafId !== null) {
          window.cancelAnimationFrame(rafId);
          rafId = null;
        }
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        if (dragging) {
          const hit = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
          const secEl = hit?.closest("[data-split-section-id]") as HTMLElement | null;
          if (secEl && secEl.dataset.splitSectionId) {
            const targetSec = secEl.dataset.splitSectionId;
            const insertIdx = computeSectionInsert(secEl, ev.clientX, ev.clientY);
            handleDropOnSection(targetSec, insertIdx);
          } else if (splitInsertTargetRef.current) {
            handleDropOnSection(
              splitInsertTargetRef.current.sectionId,
              splitInsertTargetRef.current.index,
            );
          } else {
            splitDragRef.current = null;
            setHoverSectionId(null);
            setSplitInsertTarget(null);
          }
          setSplitDragActive(null);
        } else {
          onNoDragClick?.();
        }
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
    },
    [handleDropOnSection],
  );

  const handleSplitSourcePointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>, fileIndex: number, pageIndex: number) => {
      const clickSnapshot = {
        shiftKey: e.shiftKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
      } as React.MouseEvent;
      const key = sourceKey(fileIndex, pageIndex);
      startSplitPointerDrag(
        e,
        () => {
          const sel = selectedSourceKeysRef.current;
          const sorted = sortedSelectedSourceItemsRef.current;
          if (sel.has(key) && sorted.length > 1) {
            return {
              payload: { kind: "source_many", items: sorted },
              visual: {
                label: t.pdfOps.selectedCount(sorted.length),
                count: sorted.length,
                fileIndex,
                pageIndex,
                rotationDeg: 0,
                thumbUrl: thumbsRef.current[key],
              },
            };
          }
          return {
            payload: { kind: "source", file_index: fileIndex, page_index: pageIndex },
            visual: {
              label:
                filesRef.current.length > 1
                  ? `F${fileIndex + 1}·P${pageIndex + 1}`
                  : `P${pageIndex + 1}`,
              count: 1,
              fileIndex,
              pageIndex,
              rotationDeg: 0,
              thumbUrl: thumbsRef.current[key],
            },
          };
        },
        () => handleSourcePageClickRef.current(clickSnapshot, fileIndex, pageIndex),
      );
    },
    [startSplitPointerDrag, t.pdfOps],
  );

  const handleSplitSectionItemPointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>, sectionId: string, itemIndex: number) => {
      startSplitPointerDrag(e, () => {
        const sec = splitSectionsRef.current.find((s) => s.id === sectionId);
        const item = sec?.pages[itemIndex];
        const fileIndex = item?.file_index ?? 0;
        const pageIndex = item?.page_index ?? 0;
        const rotationDeg = item?.rotation_deg ?? 0;
        const key = sourceKey(fileIndex, pageIndex);
        return {
          payload: { kind: "section_item", sectionId, itemIndex },
          visual: {
            label:
              filesRef.current.length > 1
                ? `F${fileIndex + 1}·P${pageIndex + 1}`
                : `P${pageIndex + 1}`,
            count: 1,
            fileIndex,
            pageIndex,
            rotationDeg,
            thumbUrl: thumbsRef.current[key],
            sourceSecId: sectionId,
            sourceItemIdx: itemIndex,
          },
        };
      });
    },
    [startSplitPointerDrag],
  );

  const handleDoubleClickSplitPage = React.useCallback(
    (fileIndex: number, pageIndex: number, rotationDeg = 0) => {
      const src = filesRef.current[fileIndex];
      if (!src) return;
      setZoomTarget({
        path: src.path,
        pageIndex,
        rotationDeg,
        fallbackThumbSrc: thumbsRef.current[sourceKey(fileIndex, pageIndex)],
      });
    },
    [],
  );

  const handleDoubleClickSplitSource = React.useCallback(
    (fileIndex: number, pageIndex: number) => {
      handleDoubleClickSplitPage(fileIndex, pageIndex, 0);
    },
    [handleDoubleClickSplitPage],
  );

  const handleQuickAddSourcePage = React.useCallback(
    (fileIndex: number, pageIndex: number) => {
      appendSourceItemsToSection([{ file_index: fileIndex, page_index: pageIndex }]);
    },
    [appendSourceItemsToSection],
  );

  const handleRotateSectionItem = React.useCallback((sectionId: string, uid: string) => {
    setSplitSections((prev) =>
      prev.map((s) =>
        s.id === sectionId
          ? {
              ...s,
              pages: s.pages.map((p) =>
                p.uid === uid ? { ...p, rotation_deg: (p.rotation_deg + 90) % 360 } : p,
              ),
            }
          : s,
      ),
    );
  }, []);

  const handleRemoveSectionItem = React.useCallback((sectionId: string, uid: string) => {
    setSplitSections((prev) =>
      prev.map((s) =>
        s.id === sectionId ? { ...s, pages: s.pages.filter((p) => p.uid !== uid) } : s,
      ),
    );
  }, []);

  const executeMerge = async (outPath: string) => {
    try {
      const jobId = crypto.randomUUID();
      onStartJob(jobId, t.pdfOps.mergeJobTitle);
      const res = await mergePdfFiles(
        jobId,
        {
          inputs: files.map((f) => f.path),
          selected_pages: selections,
          output_path: outPath,
          preserve_bookmarks: preserveBookmarks,
          custom_bookmarks: preserveBookmarks ? mergeBookmarks : null,
        },
        onJobEvent,
      );
      onFinishJob(
        t.pdfOps.mergeJobTitle,
        res.output_files,
        t.pdfOps.mergeDoneSummary(res.total_pages, formatBytes(res.total_bytes)),
        "success",
      );
    } catch (e) {
      const msg = String(e);
      setErrorMsg(msg);
      onFinishJob(t.pdfOps.mergeJobTitle, [], msg, "error");
    }
  };

  const handleMerge = async () => {
    if (files.length === 0 || selections.length === 0 || busy) return;
    setErrorMsg(null);
    try {
      let outPath: string | null = defaultMergeTargetPath;
      if (!outPath) {
        outPath = await pickSaveFile({
          title: t.pdfOps.saveMergedDialog,
          defaultPath: effectiveMergeFilename,
          filters: [{ name: "PDF Document", extensions: ["pdf"] }],
        });
      }
      if (!outPath) return;

      if (defaultMergeTargetPath) {
        const conflicts = await checkExportConflicts([outPath]);
        if (conflicts.length > 0) {
          setPendingConflict({ kind: "merge", outPath, conflicts });
          return;
        }
      }
      await executeMerge(outPath);
    } catch (e) {
      setErrorMsg(String(e));
    }
  };

  const nonEmptySections = React.useMemo(
    () => splitSections.filter((s) => s.pages.length > 0),
    [splitSections],
  );
  const totalCustomPages = React.useMemo(
    () => nonEmptySections.reduce((acc, s) => acc + s.pages.length, 0),
    [nonEmptySections],
  );

  const executeSplit = async (
    inputs: string[],
    stems: string[],
    outDir: string,
    rule: PdfSplitRule,
  ) => {
    if (inputs.length === 0) return;
    try {
      const jobId = crypto.randomUUID();
      onStartJob(jobId, t.pdfOps.splitJobTitle);
      const res =
        inputs.length === 1 && rule.rule !== "custom_groups"
          ? await splitPdfFile(jobId, inputs[0], outDir, stems[0] ?? "split", rule, onJobEvent)
          : await splitMultiPdfFiles(jobId, inputs, stems, outDir, rule, onJobEvent);
      onFinishJob(
        t.pdfOps.splitJobTitle,
        res.output_files,
        t.pdfOps.splitDoneSummary(res.output_files.length, res.total_pages),
        "success",
      );
    } catch (e) {
      const msg = String(e);
      setErrorMsg(msg);
      onFinishJob(t.pdfOps.splitJobTitle, [], msg, "error");
    }
  };

  const computeExpectedSplitPaths = (
    outDir: string,
    stems: string[],
    pageCounts: number[],
    rule: PdfSplitRule,
  ): string[] => {
    if (rule.rule === "custom_groups") {
      return rule.groups.map((g, idx) => {
        const clean =
          g.name
            .trim()
            .replace(/\.pdf$/i, "")
            .replace(/[\\/:*?"<>|]/g, "_") || `section_${String(idx + 1).padStart(2, "0")}`;
        return joinDirAndFile(outDir, `${clean}.pdf`);
      });
    }
    const out: string[] = [];
    for (let i = 0; i < stems.length; i++) {
      const stem = stems[i] || "split";
      const totalPages = pageCounts[i] ?? 0;
      if (rule.rule === "page_ranges") {
        out.push(joinDirAndFile(outDir, `${stem}_extracted.pdf`));
      } else if (rule.rule === "extract_selected") {
        out.push(joinDirAndFile(outDir, `${stem}_selected.pdf`));
      } else if (rule.rule === "every_n_pages") {
        const step = Math.max(1, rule.n);
        let part = 1;
        for (let s = 0; s < totalPages; s += step) {
          out.push(joinDirAndFile(outDir, `${stem}_part${String(part).padStart(2, "0")}.pdf`));
          part += 1;
        }
      }
    }
    return out;
  };

  const handleSplit = async () => {
    if (files.length === 0 || busy) return;
    setErrorMsg(null);
    try {
      const trimmedDefaultDir = defaultExportDir.trim();
      const outDir = trimmedDefaultDir
        ? trimmedDefaultDir
        : await pickDirectory(t.pdfOps.pickSplitDirDialog);
      if (!outDir) return;

      const inputs = files.map((f) => f.path);
      const stems = files.map((f) => getSplitStemForFile(f, files.length));
      const fallbackStem = stems[0] || "split";

      const useCustomGroups =
        splitRuleKind !== "max_bytes" && nonEmptySections.length > 0;

      const rule: PdfSplitRule = useCustomGroups
        ? {
            rule: "custom_groups",
            groups: nonEmptySections.map((sec) => ({
              name: sec.name.trim() || fallbackStem,
              pages: sec.pages.map((p) => ({
                file_index: p.file_index,
                page_index: p.page_index,
                rotation_deg: p.rotation_deg,
              })),
            })),
          }
        : splitRuleKind === "page_ranges"
          ? { rule: "page_ranges", ranges: rangesStr }
          : splitRuleKind === "every_n_pages"
            ? { rule: "every_n_pages", n: everyN }
            : { rule: "max_bytes", max_mb: splitMaxMb };

      const candidates = computeExpectedSplitPaths(
        outDir,
        stems,
        files.map((f) => f.page_count),
        rule,
      );
      if (candidates.length > 0) {
        const conflicts = await checkExportConflicts(candidates);
        if (conflicts.length > 0) {
          setPendingConflict({
            kind: "split",
            inputs,
            stems,
            outDir,
            rule,
            conflicts,
          });
          return;
        }
      }

      await executeSplit(inputs, stems, outDir, rule);
    } catch (e) {
      setErrorMsg(String(e));
    }
  };

  const handleConflictResolution = async (choice: ConflictResolution) => {
    const pending = pendingConflict;
    setPendingConflict(null);
    if (!pending || choice === "cancel") return;
    if (pending.kind === "merge") {
      if (choice === "overwrite") {
        await executeMerge(pending.outPath);
      } else {
        const uniquePath = await resolveUniqueExportPath(pending.outPath);
        await executeMerge(uniquePath);
      }
      return;
    }

    if (choice === "overwrite") {
      await executeSplit(pending.inputs, pending.stems, pending.outDir, pending.rule);
      return;
    }

    if (pending.rule.rule === "custom_groups") {
      const renamedGroups = await Promise.all(
        pending.rule.groups.map(async (g, idx) => {
          const base =
            g.name.trim().replace(/\.pdf$/i, "") ||
            `section_${String(idx + 1).padStart(2, "0")}`;
          const uniquePath = await resolveUniqueExportPath(
            joinDirAndFile(pending.outDir, `${base}.pdf`),
          );
          const uniqueName =
            uniquePath.split(/[\\/]/).pop()?.replace(/\.pdf$/i, "") || base;
          return { ...g, name: uniqueName };
        }),
      );
      await executeSplit(pending.inputs, pending.stems, pending.outDir, {
        rule: "custom_groups",
        groups: renamedGroups,
      });
    } else {
      const suffix = Date.now().toString().slice(-4);
      const uniqueStems = pending.stems.map((s) => `${s}_${suffix}`);
      await executeSplit(pending.inputs, uniqueStems, pending.outDir, pending.rule);
    }
  };

  const totalSplitSourcePages = React.useMemo(
    () => files.reduce((acc, f) => acc + f.page_count, 0),
    [files],
  );
  const showFilePrefix = files.length > 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#212529]">{t.pdfOps.title}</h1>
          <p className="text-sm text-[#6C757D]">{t.pdfOps.subtitle}</p>
        </div>

        {tab === "merge" ? (
          <button
            type="button"
            disabled={busy || files.length === 0 || selections.length === 0}
            onClick={() => void handleMerge()}
            className="knit-control inline-flex items-center gap-1.5 rounded-[4px] bg-[#007BFF] px-4 text-sm font-semibold text-white hover:bg-[#0069D9] disabled:opacity-50"
          >
            <FilePlus className="h-4 w-4" />
            {t.pdfOps.mergeBtn(selections.length)}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy || files.length === 0}
            onClick={() => void handleSplit()}
            className="knit-control inline-flex items-center gap-1.5 rounded-[4px] bg-[#007BFF] px-4 text-sm font-semibold text-white hover:bg-[#0069D9] disabled:opacity-50"
          >
            <Scissors className="h-4 w-4" />
            {splitRuleKind !== "max_bytes" && nonEmptySections.length > 0
              ? t.pdfOps.splitCustomBtn(nonEmptySections.length, totalCustomPages)
              : t.pdfOps.splitBtn}
          </button>
        )}
      </div>

      {/* Mode Switcher Tabs */}
      <div className="inline-flex items-center gap-1 rounded-[4px] border border-[#CED4DA] bg-white p-1">
        <button
          type="button"
          onClick={() => setTab("merge")}
          className={`knit-control-sm flex items-center gap-1.5 rounded-[4px] border px-3 text-sm font-semibold ${
            tab === "merge"
              ? "border-[#007BFF] bg-[#007BFF] text-white"
              : "border-transparent text-[#495057] hover:bg-[#F8F9FA]"
          }`}
        >
          <Layers className="h-4 w-4" />
          {t.pdfOps.mergeTab}
        </button>
        <button
          type="button"
          onClick={() => setTab("split")}
          className={`knit-control-sm flex items-center gap-1.5 rounded-[4px] border px-3 text-sm font-semibold ${
            tab === "split"
              ? "border-[#007BFF] bg-[#007BFF] text-white"
              : "border-transparent text-[#495057] hover:bg-[#F8F9FA]"
          }`}
        >
          <Scissors className="h-4 w-4" />
          {t.pdfOps.splitTab}
        </button>
      </div>

      {/* Output Filename Bar (unified top position right below switcher) */}
      <ExportFilenameControl
        value={tab === "merge" ? mergeExportFilename : splitPrefixFilename}
        onChange={tab === "merge" ? setMergeExportFilename : setSplitPrefixFilename}
        label={tab === "split" ? t.pdfOps.splitPrefixLabel : undefined}
        placeholder={tab === "merge" ? "merged.pdf" : t.pdfOps.splitPrefixPlaceholder}
        defaultExportDir={defaultExportDir}
        existsAtDefaultDir={tab === "merge" ? mergeExistsAtDefaultDir : false}
        className="bg-white"
      />

      {errorMsg && (
        <div className="rounded-[4px] border border-[#F5C6CB] bg-[#F8D7DA] px-3.5 py-2.5 text-sm text-[#721C24]">
          {errorMsg}
        </div>
      )}

      <Dropzone
        title={tab === "merge" ? t.pdfOps.dropTitleMerge : t.pdfOps.dropTitleSplit}
        description={t.pdfOps.dropDesc}
        onPickFiles={() => void handleAddPdfs()}
        filesLabel={t.pdfOps.addPdfBtn}
        loading={importingPdfs}
        loadingLabel={
          importProgress && importProgress.total > 1
            ? t.pdfOps.importingProgress(importProgress.done, importProgress.total)
            : t.pdfOps.importingLabel
        }
      />

      {files.length > 0 && (
        <div
          className={`space-y-2 rounded-[4px] border p-3.5 transition-colors duration-300 ${
            importHighlighted
              ? "border-[#28A745] bg-[#D4EDDA]/45"
              : "border-[#DEE2E6] bg-white"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-[#343A40]">
              {t.pdfOps.loadedDocs(files.length)}
            </span>
            <button
              type="button"
              onClick={() => setPendingClearAll(true)}
              className="text-xs font-semibold text-[#DC3545] hover:underline"
            >
              {t.common.clearAll}
            </button>
          </div>
          {files.map((f, idx) => (
            <div
              key={`${f.path}-${idx}`}
              className={`flex items-center justify-between gap-2 rounded-[4px] border px-3 py-2 text-xs transition-colors duration-300 ${
                importHighlighted
                  ? "border-[#A3CFBB] bg-[#E9F7EF]"
                  : "border-[#E9ECEF] bg-[#F8F9FA]"
              }`}
            >
              <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2">
                <span className="font-mono-code truncate font-semibold text-[#212529]">
                  {idx + 1}. {f.path.split(/[\\/]/).pop()}
                </span>
                <span className="text-[#6C757D]">
                  {t.pdfOps.docMeta(f.page_count, formatBytes(f.file_size_bytes), f.bookmarks.length)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setPendingRemoveFileIdx(idx)}
                title={t.pdfOps.removeFileBtnTitle}
                className="shrink-0 rounded-[4px] p-1 text-[#DC3545] hover:bg-[#F8D7DA]"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {tab === "merge" && selections.length > 0 && (
        <div className="space-y-3">
          <div className="rounded-[4px] border border-[#DEE2E6] bg-white px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm font-semibold text-[#212529]">
                <input
                  type="checkbox"
                  checked={preserveBookmarks}
                  onChange={(e) => setPreserveBookmarks(e.target.checked)}
                />
                {t.pdfOps.preserveBookmarks}
              </label>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-[#495057]">
                  {t.pdfOps.gridColumnsLabel}
                </span>
                {GRID_COL_OPTIONS.map((cols) => (
                  <button
                    key={cols}
                    type="button"
                    onClick={() => setMergeGridCols(cols)}
                    className={`knit-control-sm rounded-[4px] border px-2.5 font-mono-code text-xs font-semibold ${
                      mergeGridCols === cols
                        ? "border-[#007BFF] bg-[#007BFF] text-white"
                        : "border-[#CED4DA] bg-[#F8F9FA] text-[#343A40] hover:bg-[#E9ECEF]"
                    }`}
                  >
                    {cols}
                  </button>
                ))}

                {preserveBookmarks && (
                  <button
                    type="button"
                    onClick={() => setShowMergeBookmarks((v) => !v)}
                    className="knit-control-sm inline-flex items-center gap-1.5 rounded-[4px] border border-[#CED4DA] bg-[#F8F9FA] px-2.5 text-xs font-semibold text-[#343A40] hover:bg-[#E9ECEF]"
                  >
                    {showMergeBookmarks ? (
                      <PanelRightClose className="h-3.5 w-3.5 text-[#007BFF]" />
                    ) : (
                      <PanelRightOpen className="h-3.5 w-3.5 text-[#007BFF]" />
                    )}
                    {showMergeBookmarks
                      ? t.pdfOps.toggleBookmarksHide
                      : t.pdfOps.toggleBookmarksShow}
                  </button>
                )}
              </div>
            </div>
          </div>

          <div
            className={`grid grid-cols-1 gap-4 ${
              preserveBookmarks && showMergeBookmarks ? "lg:grid-cols-3" : ""
            }`}
          >
            <div
              className={`space-y-2 ${
                preserveBookmarks && showMergeBookmarks ? "lg:col-span-2" : ""
              }`}
            >
              <div className="flex items-center gap-2 rounded-[4px] border border-[#DEE2E6] bg-white px-3.5 py-2 text-xs text-[#6C757D]">
                <GripVertical className="h-4 w-4 text-[#007BFF]" />
                <span>{t.pdfOps.mergeDragHint}</span>
              </div>

              {(() => {
                const cols = Math.max(1, mergeGridCols);
                const rowCount = Math.max(1, Math.ceil(selections.length / cols));
                const safeStartRow = Math.min(mergeVisibleRange.startRow, Math.max(0, rowCount - 1));
                const safeEndRow = Math.min(
                  rowCount - 1,
                  Math.max(safeStartRow, mergeVisibleRange.endRow),
                );
                const startIdx = safeStartRow * cols;
                const endIdxExclusive = Math.min(selections.length, (safeEndRow + 1) * cols);
                const visibleSelections = selections.slice(startIdx, endIdxExclusive);
                const topPadPx = safeStartRow * mergeRowStride;
                const bottomPadPx = Math.max(0, (rowCount - 1 - safeEndRow) * mergeRowStride);
                const isDraggingAny = mergeDragIdx !== null;
                const isNoOpInsert =
                  mergeDragIdx !== null &&
                  mergeInsertAt !== null &&
                  (mergeInsertAt === mergeDragIdx || mergeInsertAt === mergeDragIdx + 1);
                const draggedSel = mergeDragIdx !== null ? selections[mergeDragIdx] : undefined;
                const draggedThumbUrl = draggedSel
                  ? thumbs[sourceKey(draggedSel.file_index, draggedSel.page_index)]
                  : undefined;

                return (
                  <div
                    ref={mergeGridOuterRef}
                    style={{
                      paddingTop: topPadPx > 0 ? `${topPadPx}px` : undefined,
                      paddingBottom: bottomPadPx > 0 ? `${bottomPadPx}px` : undefined,
                    }}
                  >
                    <div
                      ref={mergeGridInnerRef}
                      className="grid auto-rows-max gap-3 select-none"
                      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
                    >
                      {visibleSelections.map((sel, localIdx) => {
                        const idx = startIdx + localIdx;
                        const key = sourceKey(sel.file_index, sel.page_index);
                        const showBarLeft = !isNoOpInsert && mergeInsertAt === idx;
                        const showBarEnd =
                          !isNoOpInsert &&
                          idx === selections.length - 1 &&
                          mergeInsertAt === selections.length;
                        return (
                          <MergePageCard
                            key={`${key}-${idx}`}
                            idx={idx}
                            fileIndex={sel.file_index}
                            pageIndex={sel.page_index}
                            rotationDeg={sel.rotation_deg}
                            thumbUrl={thumbs[key]}
                            isDragged={mergeDragIdx === idx}
                            isDraggingAny={isDraggingAny}
                            showBarLeft={showBarLeft}
                            showBarEnd={showBarEnd}
                            metaText={t.pdfOps.pageMeta(
                              sel.file_index + 1,
                              sel.page_index + 1,
                              sel.rotation_deg,
                            )}
                            rotateTitle={t.image2pdf.rotateTitle}
                            deleteTitle={t.image2pdf.deletePageTitle}
                            onRegisterRef={registerThumbCardRef}
                            onPointerDownCard={handleMergeCardPointerDown}
                            onDoubleClickCard={handleDoubleClickMergePage}
                            onRotate={handleRotateMergePage}
                            onRemove={handleRemoveMergePage}
                          />
                        );
                      })}
                    </div>

                    {draggedSel && mergeDragIdx !== null && (
                      <div
                        ref={mergeDragGhostRef}
                        aria-hidden="true"
                        style={{
                          transform: `translate3d(${initialMergeGhostPosRef.current.x}px, ${initialMergeGhostPosRef.current.y}px, 0)`,
                        }}
                        className="pointer-events-none fixed left-0 top-0 z-50 w-36 overflow-hidden rounded-[4px] border-2 border-[#007BFF] bg-white shadow-2xl"
                      >
                        <div className="relative flex h-28 items-center justify-center bg-[#F1F3F5] p-1">
                          {draggedThumbUrl ? (
                            <img
                              src={draggedThumbUrl}
                              alt=""
                              className="max-h-full max-w-full object-contain"
                              style={
                                draggedSel.rotation_deg % 360 !== 0
                                  ? { transform: `rotate(${draggedSel.rotation_deg}deg)` }
                                  : undefined
                              }
                            />
                          ) : (
                            <span className="font-mono-code text-xs text-[#6C757D]">
                              F{draggedSel.file_index + 1}·P{draggedSel.page_index + 1}
                            </span>
                          )}
                          <span className="absolute left-1 top-1 rounded-[4px] bg-[#007BFF] px-1.5 py-0.5 font-mono-code text-[11px] font-bold text-white">
                            #{mergeDragIdx + 1}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            {preserveBookmarks && showMergeBookmarks && (
              <div className="lg:col-span-1">
                <BookmarkTreeEditor
                  nodes={mergeBookmarks}
                  totalPages={selections.length}
                  onChange={setMergeBookmarks}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "split" && files.length > 0 && (
        <div className="space-y-4">
          {/* Quick Split Presets */}
          <div className="flex flex-wrap items-end gap-3 rounded-[4px] border border-[#DEE2E6] bg-white p-4">
            <div className="min-w-[220px] flex-1">
              <label className="block text-xs font-semibold uppercase text-[#6C757D]">
                {t.pdfOps.splitModeLabel}
              </label>
              <Select
                ariaLabel={t.pdfOps.splitModeLabel}
                value={splitRuleKind}
                onChange={(val) => setSplitRuleKind(val as typeof splitRuleKind)}
                className="mt-1 w-full"
                options={[
                  { value: "every_n_pages", label: t.pdfOps.splitEveryNOpt },
                  { value: "page_ranges", label: t.pdfOps.splitRangesOpt },
                  { value: "max_bytes", label: t.pdfOps.splitMaxBytesOpt },
                ]}
              />
            </div>

            {splitRuleKind === "page_ranges" && (
              <div className="min-w-[180px] flex-1">
                <label className="block text-xs font-semibold uppercase text-[#6C757D]">
                  {t.pdfOps.rangesLabel}
                </label>
                <input
                  type="text"
                  value={rangesStr}
                  onChange={(e) => setRangesStr(e.target.value)}
                  placeholder="1-3, 5, 8-10"
                  className="knit-control mt-1 w-full rounded-[4px] border border-[#CED4DA] px-2.5 font-mono-code text-xs"
                />
              </div>
            )}

            {splitRuleKind === "every_n_pages" && (
              <div className="w-40">
                <label className="block text-xs font-semibold uppercase text-[#6C757D]">
                  {t.pdfOps.everyNLabel}
                </label>
                <NumberInput
                  ariaLabel={t.pdfOps.everyNLabel}
                  min={1}
                  value={everyN}
                  onChange={setEveryN}
                  className="mt-1 w-full"
                />
              </div>
            )}

            {splitRuleKind === "max_bytes" && (
              <div className="w-44">
                <label className="block text-xs font-semibold uppercase text-[#6C757D]">
                  {t.pdfOps.maxMbLabel}
                </label>
                <NumberInput
                  ariaLabel={t.pdfOps.maxMbLabel}
                  min={0.5}
                  step={0.5}
                  value={splitMaxMb}
                  onChange={setSplitMaxMb}
                  className="mt-1 w-full"
                />
              </div>
            )}

            {splitRuleKind !== "max_bytes" && (
              <button
                type="button"
                onClick={handlePopulateSectionsFromRule}
                className="knit-control inline-flex items-center gap-1.5 rounded-[4px] border border-[#CED4DA] bg-[#F8F9FA] px-3 text-sm font-semibold text-[#343A40] hover:bg-[#E9ECEF]"
              >
                <Wand2 className="h-4 w-4 text-[#007BFF]" />
                {t.pdfOps.generateSectionsBtn}
              </button>
            )}
          </div>

          {/* Visual Drag-and-Drop Source Pages + Output Sections */}
          <div
            ref={splitGridRef}
            style={
              {
                "--split-left": `${(liveSplitRatio * 100).toFixed(2)}%`,
              } as React.CSSProperties
            }
            className="grid grid-cols-1 items-start gap-3 lg:gap-2 lg:[grid-template-columns:var(--split-left)_12px_minmax(0,1fr)]"
          >
            {/* Source PDF Pages Strip (Virtualized + pages/row selector + multi-file filter) */}
            <div className="flex min-w-0 flex-col overflow-hidden rounded-[4px] border border-[#DEE2E6] bg-white">
              <div className="space-y-2 border-b border-[#E9ECEF] p-3.5 pb-2.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-base font-bold text-[#343A40]">
                      {t.pdfOps.sourcePagesTitle(totalSplitSourcePages)}
                    </div>
                    <div className="text-sm text-[#6C757D]">{t.pdfOps.sourcePagesHint}</div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#495057]">
                    <span className="font-semibold">{t.pdfOps.gridColumnsLabel}</span>
                    {GRID_COL_OPTIONS.map((cols) => (
                      <button
                        key={cols}
                        type="button"
                        onClick={() => setSplitSourceCols(cols)}
                        className={`knit-control-sm rounded-[4px] border px-2 font-mono-code text-xs font-semibold ${
                          splitSourceCols === cols
                            ? "border-[#007BFF] bg-[#007BFF] text-white"
                            : "border-[#CED4DA] bg-[#F8F9FA] text-[#343A40] hover:bg-[#E9ECEF]"
                        }`}
                      >
                        {cols}
                      </button>
                    ))}
                  </div>
                </div>

                {files.length > 1 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <button
                      type="button"
                      onClick={() => setSplitSourceFilterIdx("all")}
                      className={`rounded-[4px] border px-2 py-0.5 text-xs font-semibold ${
                        splitSourceFilterIdx === "all"
                          ? "border-[#007BFF] bg-[#007BFF] text-white"
                          : "border-[#CED4DA] bg-[#F8F9FA] text-[#343A40] hover:bg-[#E9ECEF]"
                      }`}
                    >
                      {t.pdfOps.splitAllSourcesFilter} ({totalSplitSourcePages})
                    </button>
                    {files.map((f, fIdx) => {
                      const shortName =
                        f.path.split(/[\\/]/).pop()?.replace(/\.pdf$/i, "") ?? `PDF ${fIdx + 1}`;
                      return (
                        <button
                          key={`${f.path}-${fIdx}`}
                          type="button"
                          onClick={() => setSplitSourceFilterIdx(fIdx)}
                          title={shortName}
                          className={`max-w-[160px] truncate rounded-[4px] border px-2 py-0.5 text-xs font-semibold ${
                            splitSourceFilterIdx === fIdx
                              ? "border-[#007BFF] bg-[#007BFF] text-white"
                              : "border-[#CED4DA] bg-[#F8F9FA] text-[#343A40] hover:bg-[#E9ECEF]"
                          }`}
                        >
                          {t.pdfOps.splitSourceFileFilter(fIdx + 1, shortName, f.page_count)}
                        </button>
                      );
                    })}
                  </div>
                )}

                {sortedSelectedSourceItems.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-[#B8DAFF] bg-[#E7F1FF] px-2.5 py-1.5 text-sm">
                    <span className="font-semibold text-[#0056B3]">
                      {t.pdfOps.selectedCount(sortedSelectedSourceItems.length)}
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => appendSourceItemsToSection(sortedSelectedSourceItems)}
                        className="rounded-[4px] bg-[#007BFF] px-2.5 py-0.5 text-xs font-semibold text-white hover:bg-[#0069D9]"
                      >
                        {t.pdfOps.addSelectedBtn(sortedSelectedSourceItems.length)}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedSourceKeys(new Set());
                          setLastClickedSourcePos(null);
                        }}
                        className="rounded-[4px] border border-[#CED4DA] bg-white px-2.5 py-0.5 text-xs font-medium text-[#495057] hover:bg-[#F8F9FA]"
                      >
                        {t.pdfOps.clearSelectionBtn}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {(() => {
                const cols = Math.max(1, splitSourceCols);
                const total = displayedSplitSourceItems.length;
                const rowCount = Math.max(1, Math.ceil(total / cols));
                const safeStartRow = Math.min(
                  splitSourceVisibleRange.startRow,
                  Math.max(0, rowCount - 1),
                );
                const safeEndRow = Math.min(
                  rowCount - 1,
                  Math.max(safeStartRow, splitSourceVisibleRange.endRow),
                );
                const startIdx = safeStartRow * cols;
                const endIdxExclusive = Math.min(total, (safeEndRow + 1) * cols);
                const visibleItems = displayedSplitSourceItems.slice(startIdx, endIdxExclusive);
                const topPadPx = safeStartRow * splitSourceRowStride;
                const bottomPadPx = Math.max(0, (rowCount - 1 - safeEndRow) * splitSourceRowStride);

                return (
                  <div
                    ref={splitSourceScrollRef}
                    style={{ height: `${liveSourceHeightPx}px` }}
                    className="overflow-y-auto p-3.5"
                  >
                    <div
                      ref={splitSourceGridOuterRef}
                      style={{
                        paddingTop: topPadPx > 0 ? `${topPadPx}px` : undefined,
                        paddingBottom: bottomPadPx > 0 ? `${bottomPadPx}px` : undefined,
                      }}
                    >
                      <div
                        ref={splitSourceGridInnerRef}
                        className="grid auto-rows-max gap-2 select-none"
                        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
                      >
                        {visibleItems.map((it) => {
                          const key = sourceKey(it.fileIndex, it.pageIndex);
                          return (
                            <SplitSourceCard
                              key={key}
                              fileIndex={it.fileIndex}
                              pageIndex={it.pageIndex}
                              showFilePrefix={showFilePrefix}
                              thumbUrl={thumbs[key]}
                              isSelected={selectedSourceKeys.has(key)}
                              isDraggingAny={splitDragActive !== null}
                              onRegisterRef={registerThumbCardRef}
                              onPointerDownCard={handleSplitSourcePointerDown}
                              onDoubleClickCard={handleDoubleClickSplitSource}
                              onQuickAdd={handleQuickAddSourcePage}
                            />
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div
                role="separator"
                aria-orientation="horizontal"
                title={t.pdfOps.resizeHeightTitle}
                onPointerDown={handleSourceHeightResize}
                className="flex h-3 cursor-row-resize items-center justify-center border-t border-[#E9ECEF] bg-[#F8F9FA] text-[#868E96] transition-colors hover:bg-[#E7F1FF] hover:text-[#007BFF]"
              >
                <GripHorizontal className="h-3.5 w-3.5" />
              </div>
            </div>

            {/* Width Splitter (Desktop — matching height resizer bar styling) */}
            <div
              role="separator"
              aria-orientation="vertical"
              title={t.pdfOps.resizeWidthTitle}
              onPointerDown={handleSplitWidthResize}
              className="hidden self-stretch min-h-[280px] cursor-col-resize select-none items-center justify-center rounded-[4px] border border-[#DEE2E6] bg-[#F8F9FA] text-[#868E96] transition-colors hover:border-[#B8DAFF] hover:bg-[#E7F1FF] hover:text-[#007BFF] lg:flex"
            >
              <GripVertical className="h-3.5 w-3.5" />
            </div>

            {/* Output Sections Builder */}
            <div className="flex min-w-0 flex-col overflow-hidden rounded-[4px] border border-[#DEE2E6] bg-white">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E9ECEF] px-3.5 py-2.5">
                <div>
                  <span className="text-sm font-bold text-[#343A40]">
                    {t.pdfOps.splitBuilderTitle}
                  </span>
                  <div className="text-xs text-[#6C757D]">{t.pdfOps.sectionItemDragHint}</div>
                </div>
                <button
                  type="button"
                  onClick={addSection}
                  className="knit-control-sm inline-flex items-center gap-1 rounded-[4px] border border-[#007BFF] bg-[#E7F1FF] px-3 text-xs font-semibold text-[#0056B3] hover:bg-[#007BFF] hover:text-white"
                >
                  {t.pdfOps.addSectionBtn}
                </button>
              </div>

              <div
                ref={splitSectionsScrollRef}
                style={{ height: `${liveSectionsHeightPx}px` }}
                className="space-y-3 overflow-y-auto p-3.5"
              >
                {splitSections.map((section, sIdx) => {
                  const isActive = activeSectionId === section.id;
                  const isHovered = hoverSectionId === section.id;
                  const explicitSectionHeight =
                    resizingSecHeight?.id === section.id
                      ? resizingSecHeight.height
                      : sectionHeightsPx[section.id];

                  return (
                    <div
                      key={section.id}
                      data-split-section-id={section.id}
                      onClick={() => setActiveSectionId(section.id)}
                      className={`overflow-hidden rounded-[4px] border bg-white transition-colors ${
                        isHovered
                          ? "border-2 border-dashed border-[#007BFF] bg-[#E7F1FF]/40"
                          : isActive
                            ? "border-[#007BFF] ring-1 ring-[#007BFF]/40"
                            : "border-[#DEE2E6]"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E9ECEF] p-3 pb-2.5">
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] bg-[#343A40] font-mono-code text-xs font-bold text-white">
                            {sIdx + 1}
                          </span>
                          <input
                            type="text"
                            value={section.name}
                            onChange={(e) =>
                              setSplitSections((prev) =>
                                prev.map((s) =>
                                  s.id === section.id ? { ...s, name: e.target.value } : s,
                                ),
                              )
                            }
                            placeholder={t.pdfOps.sectionNamePlaceholder}
                            className="knit-control-sm min-w-0 flex-1 rounded-[4px] border border-[#CED4DA] px-2.5 font-mono-code text-xs text-[#212529]"
                          />
                          <span className="shrink-0 rounded-[4px] bg-[#E9ECEF] px-2 py-0.5 font-mono-code text-xs font-semibold text-[#495057]">
                            {t.pdfOps.sectionPagesCount(section.pages.length)}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSplitSections((prev) =>
                                prev.map((s) => (s.id === section.id ? { ...s, pages: [] } : s)),
                              );
                            }}
                            disabled={section.pages.length === 0}
                            title={t.pdfOps.clearSectionTitle}
                            className="knit-control-sm inline-flex items-center rounded-[4px] border border-[#CED4DA] px-2 text-xs text-[#6C757D] hover:bg-[#F8F9FA] disabled:opacity-30"
                          >
                            <Eraser className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSplitSections((prev) =>
                                prev.filter((s) => s.id !== section.id),
                              );
                            }}
                            disabled={splitSections.length <= 1}
                            title={t.pdfOps.deleteSectionTitle}
                            className="knit-control-sm inline-flex items-center rounded-[4px] border border-[#F5C6CB] px-2 text-xs text-[#DC3545] hover:bg-[#F8D7DA] disabled:opacity-30"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      <div
                        data-split-section-scroll={section.id}
                        style={
                          explicitSectionHeight !== undefined
                            ? { height: `${explicitSectionHeight}px` }
                            : undefined
                        }
                        className={`overflow-y-auto p-3 ${
                          explicitSectionHeight === undefined ? "max-h-[280px]" : ""
                        }`}
                      >
                        {section.pages.length === 0 ? (
                          <div className="flex h-full min-h-[72px] items-center justify-center rounded-[4px] border border-dashed border-[#CED4DA] bg-[#F8F9FA] py-5 text-center text-xs text-[#6C757D]">
                            {t.pdfOps.emptySectionHint}
                          </div>
                        ) : (
                          <div
                            data-split-section-grid={section.id}
                            className="grid auto-rows-max grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5"
                          >
                            {section.pages.map((item, itemIdx) => {
                              const isTargetSec = splitInsertTarget?.sectionId === section.id;
                              const insertIdx = isTargetSec ? splitInsertTarget.index : null;
                              const isSelfNoOp =
                                splitDragActive?.sourceSecId === section.id &&
                                splitDragActive?.sourceItemIdx !== undefined &&
                                insertIdx !== null &&
                                (insertIdx === splitDragActive.sourceItemIdx ||
                                  insertIdx === splitDragActive.sourceItemIdx + 1);
                              const showBarLeft = !isSelfNoOp && insertIdx === itemIdx;
                              const showBarEnd =
                                !isSelfNoOp &&
                                itemIdx === section.pages.length - 1 &&
                                insertIdx === section.pages.length;
                              const isDragged =
                                splitDragActive?.sourceSecId === section.id &&
                                splitDragActive?.sourceItemIdx === itemIdx;

                              return (
                                <SplitSectionItemCard
                                  key={item.uid}
                                  sectionId={section.id}
                                  itemIndex={itemIdx}
                                  uid={item.uid}
                                  fileIndex={item.file_index}
                                  pageIndex={item.page_index}
                                  showFilePrefix={showFilePrefix}
                                  rotationDeg={item.rotation_deg}
                                  thumbUrl={thumbs[sourceKey(item.file_index, item.page_index)]}
                                  isDragged={isDragged}
                                  isDraggingAny={splitDragActive !== null}
                                  showBarLeft={showBarLeft}
                                  showBarEnd={showBarEnd}
                                  rotateTitle={t.image2pdf.rotateTitle}
                                  deleteTitle={t.image2pdf.deletePageTitle}
                                  onPointerDownItem={handleSplitSectionItemPointerDown}
                                  onDoubleClickItem={handleDoubleClickSplitPage}
                                  onRotateItem={handleRotateSectionItem}
                                  onRemoveItem={handleRemoveSectionItem}
                                />
                              );
                            })}
                          </div>
                        )}
                      </div>

                      <div
                        role="separator"
                        aria-orientation="horizontal"
                        title={t.pdfOps.resizeSectionHeightTitle}
                        onPointerDown={(e) => handleSectionCardHeightResize(e, section.id)}
                        className="flex h-3 cursor-row-resize items-center justify-center border-t border-[#E9ECEF] bg-[#F8F9FA] text-[#868E96] transition-colors hover:bg-[#E7F1FF] hover:text-[#007BFF]"
                      >
                        <GripHorizontal className="h-3.5 w-3.5" />
                      </div>
                    </div>
                  );
                })}
              </div>

              {splitDragActive && (
                <div
                  ref={splitDragGhostRef}
                  aria-hidden="true"
                  style={{
                    transform: `translate3d(${initialSplitGhostPosRef.current.x}px, ${initialSplitGhostPosRef.current.y}px, 0)`,
                  }}
                  className="pointer-events-none fixed left-0 top-0 z-50 w-28 overflow-hidden rounded-[4px] border-2 border-[#007BFF] bg-white shadow-2xl"
                >
                  <div className="relative flex h-24 items-center justify-center bg-[#F1F3F5] p-1">
                    {splitDragActive.thumbUrl ? (
                      <img
                        src={splitDragActive.thumbUrl}
                        alt=""
                        className="max-h-full max-w-full object-contain"
                        style={
                          splitDragActive.rotationDeg % 360 !== 0
                            ? { transform: `rotate(${splitDragActive.rotationDeg}deg)` }
                            : undefined
                        }
                      />
                    ) : (
                      <span className="font-mono-code text-xs text-[#6C757D]">
                        {splitDragActive.label}
                      </span>
                    )}
                    <span className="absolute left-1 top-1 rounded-[4px] bg-[#007BFF] px-1.5 py-0.5 font-mono-code text-[11px] font-bold text-white">
                      {splitDragActive.count > 1
                        ? `+${splitDragActive.count}`
                        : splitDragActive.label}
                    </span>
                  </div>
                </div>
              )}

              <div
                role="separator"
                aria-orientation="horizontal"
                title={t.pdfOps.resizeHeightTitle}
                onPointerDown={handleSectionsHeightResize}
                className="flex h-3 cursor-row-resize items-center justify-center border-t border-[#E9ECEF] bg-[#F8F9FA] text-[#868E96] transition-colors hover:bg-[#E7F1FF] hover:text-[#007BFF]"
              >
                <GripHorizontal className="h-3.5 w-3.5" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PDF Page Zoom Modal */}
      <PdfPageZoomModal
        pdfPath={zoomTarget?.path ?? null}
        pageIndex={zoomTarget?.pageIndex ?? 0}
        rotationDeg={zoomTarget?.rotationDeg ?? 0}
        fallbackThumbSrc={zoomTarget?.fallbackThumbSrc}
        onClose={() => setZoomTarget(null)}
      />

      {/* Confirm Remove Imported PDF Modal */}
      {pendingRemoveFileIdx !== null && files[pendingRemoveFileIdx] && (
        <div
          onClick={() => setPendingRemoveFileIdx(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <div
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-[4px] border border-[#DEE2E6] bg-white shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-[#DEE2E6] bg-[#FFF3CD] px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-bold text-[#856404]">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{t.pdfOps.removeFileConfirmTitle}</span>
              </div>
              <button
                type="button"
                onClick={() => setPendingRemoveFileIdx(null)}
                aria-label={t.common.close}
                className="rounded-[4px] p-1 text-[#856404] hover:bg-[#FFEEBA]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 text-sm text-[#212529]">
              {t.pdfOps.removeFileConfirmDesc(
                files[pendingRemoveFileIdx].path.split(/[\\/]/).pop() ??
                  files[pendingRemoveFileIdx].path,
                selections.filter((s) => s.file_index === pendingRemoveFileIdx).length,
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-[#DEE2E6] bg-[#F8F9FA] px-4 py-3">
              <button
                type="button"
                onClick={() => setPendingRemoveFileIdx(null)}
                className="knit-control-sm rounded-[4px] border border-[#CED4DA] bg-white px-3 text-xs font-semibold text-[#343A40] hover:bg-[#E9ECEF]"
              >
                {t.common.cancel}
              </button>
              <button
                type="button"
                onClick={confirmRemoveImportedFile}
                className="knit-control-sm rounded-[4px] bg-[#DC3545] px-3 text-xs font-semibold text-white hover:bg-[#C82333]"
              >
                {t.pdfOps.removeFileConfirmBtn}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Clear All PDFs Modal */}
      {pendingClearAll && files.length > 0 && (
        <div
          onClick={() => setPendingClearAll(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <div
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-[4px] border border-[#DEE2E6] bg-white shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-[#DEE2E6] bg-[#FFF3CD] px-4 py-3">
              <div className="flex items-center gap-2 text-sm font-bold text-[#856404]">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{t.pdfOps.clearAllConfirmTitle}</span>
              </div>
              <button
                type="button"
                onClick={() => setPendingClearAll(false)}
                aria-label={t.common.close}
                className="rounded-[4px] p-1 text-[#856404] hover:bg-[#FFEEBA]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-4 text-sm text-[#212529]">
              {t.pdfOps.clearAllConfirmDesc(
                files.length,
                files.reduce((acc, f) => acc + f.page_count, 0),
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-[#DEE2E6] bg-[#F8F9FA] px-4 py-3">
              <button
                type="button"
                onClick={() => setPendingClearAll(false)}
                className="knit-control-sm rounded-[4px] border border-[#CED4DA] bg-white px-3 text-xs font-semibold text-[#343A40] hover:bg-[#E9ECEF]"
              >
                {t.common.cancel}
              </button>
              <button
                type="button"
                onClick={() => {
                  thumbGenRef.current += 1;
                  queuedThumbSetRef.current.clear();
                  queuedThumbOrderRef.current = [];
                  failedThumbKeysRef.current.clear();
                  pendingThumbBatchRef.current = {};
                  visibleThumbKeysRef.current.clear();
                  sectionThumbKeysRef.current.clear();
                  thumbsRef.current = {};
                  setPendingClearAll(false);
                  setFiles([]);
                  setSelections([]);
                  setMergeBookmarks([]);
                  setThumbs({});
                  setSplitSections([]);
                  setSelectedSourceKeys(new Set());
                  setLastClickedSourcePos(null);
                  setSplitSourceFilterIdx("all");
                }}
                className="knit-control-sm rounded-[4px] bg-[#DC3545] px-3 text-xs font-semibold text-white hover:bg-[#C82333]"
              >
                {t.pdfOps.clearAllConfirmBtn}
              </button>
            </div>
          </div>
        </div>
      )}

      <ExportConflictModal
        conflictPaths={pendingConflict?.conflicts ?? []}
        onResolve={(c) => void handleConflictResolution(c)}
      />

      <ImportFeedbackToast toast={importToast} />
    </div>
  );
};

function parsePageRangesClient(spec: string, totalPages: number): number[] | null {
  if (totalPages <= 0) return null;
  const out: number[] = [];
  for (const rawPart of spec.split(",")) {
    const part = rawPart.trim();
    if (!part) continue;
    const dashIdx = part.indexOf("-");
    if (dashIdx >= 0) {
      const a = Number.parseInt(part.slice(0, dashIdx).trim(), 10);
      const b = Number.parseInt(part.slice(dashIdx + 1).trim(), 10);
      if (
        !Number.isFinite(a) ||
        !Number.isFinite(b) ||
        a < 1 ||
        b < 1 ||
        a > totalPages ||
        b > totalPages
      ) {
        return null;
      }
      if (a <= b) {
        for (let p = a; p <= b; p++) out.push(p - 1);
      } else {
        for (let p = a; p >= b; p--) out.push(p - 1);
      }
    } else {
      const p = Number.parseInt(part, 10);
      if (!Number.isFinite(p) || p < 1 || p > totalPages) return null;
      out.push(p - 1);
    }
  }
  return out;
}
