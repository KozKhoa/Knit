import React from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { FilePlus, Layers, Scissors } from "lucide-react";
import { ConfirmModal } from "../components/ConfirmModal";
import { Dropzone } from "../components/Dropzone";
import { ErrorBanner } from "../components/ErrorBanner";
import {
  ExportConflictModal,
  type ConflictResolution,
} from "../components/ExportConflictModal";
import { ExportFilenameControl } from "../components/ExportFilenameControl";
import {
  ImportFeedbackToast,
  useImportFeedback,
} from "../components/ImportFeedbackToast";
import { PdfFilePreviewModal } from "../components/PdfFilePreviewModal";
import { PdfPageZoomModal } from "../components/PdfPageZoomModal";
import { ViewHeader } from "../components/ViewHeader";
import { useThumbnailQueue } from "../hooks/useThumbnailQueue";
import { useI18n } from "../i18n";
import {
  checkExportConflicts,
  clearImagePreviewCache,
  formatBytes,
  inspectPdfFile,
  isJobCancelledError,
  isTauriRuntime,
  mergePdfFiles,
  pickDirectory,
  pickFiles,
  pickSaveFile,
  releasePdfCachedFiles,
  renderPdfThumbFile,
  splitMultiPdfFiles,
  splitPdfFile,
} from "../lib/ipc";
import {
  findActiveExportConflicts,
  joinDirAndFile,
  resolveUniqueNonActiveExportPath,
  useExportFilenameCheck,
} from "../lib/exportPath";
import type { CardSizePreset } from "../lib/imageGrid";
import { estimatePdfMergeOutput, estimatePdfSplitOutput } from "../lib/sizeEstimate";
import { usePersistentState } from "../lib/storage";
import type {
  BookmarkNode,
  JobEvent,
  PageSelection,
  PdfInfo,
  PdfSplitRule,
} from "../types/ipc";
import type { DroppedBatch } from "./Image2PdfView";
import { LoadedPdfList } from "./pdf-ops/LoadedPdfList";
import { PdfMergePane } from "./pdf-ops/PdfMergePane";
import {
  PdfPageContextMenu,
  type PdfContextMenuTarget,
} from "./pdf-ops/PdfPageContextMenu";
import { PdfSplitPane } from "./pdf-ops/PdfSplitPane";
import {
  analyzePerPageContiguity,
  buildSelectionsFromFileOrder,
  getOrigPdfStem,
  parsePageRangesClient,
  parseSourceKey,
  sourceKey,
  type PdfMergeMode,
  type SplitDragPayload,
  type SplitSectionDraft,
  type SplitSectionItem,
} from "./pdf-ops/pdfOpsTypes";

interface PdfOpsViewProps {
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

export const PdfOpsView: React.FC<PdfOpsViewProps> = ({
  onStartJob,
  onJobEvent,
  onFinishJob,
  busy,
  activeExportPaths = [],
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
  const [mergeCardSize, setMergeCardSize] = usePersistentState<CardSizePreset>(
    "knit.pdfops.mergeCardSize",
    "small",
  );
  const [mergeMode, setMergeMode] = usePersistentState<PdfMergeMode>(
    "knit.pdfops.mergeMode",
    "per_page",
  );
  const [mergeFileOrder, setMergeFileOrder] = React.useState<number[]>([]);
  const [pendingMergeModeReset, setPendingMergeModeReset] = React.useState(false);
  const [splitSourceCols, setSplitSourceCols] = usePersistentState<number>(
    "knit.pdfops.splitSourceCols",
    3,
  );
  const [splitCardSize, setSplitCardSize] = usePersistentState<CardSizePreset>(
    "knit.pdfops.splitCardSize",
    "small",
  );
  const [splitSourceFilterIdx, setSplitSourceFilterIdx] = React.useState<number | "all">("all");
  const [importingPdfs, setImportingPdfs] = React.useState(false);
  const [isPopulatingSections, setIsPopulatingSections] = React.useState(false);
  const populateRunIdRef = React.useRef(0);
  const [importProgress, setImportProgress] = React.useState<{
    done: number;
    total: number;
  } | null>(null);

  const [pendingClearAll, setPendingClearAll] = React.useState(false);
  const [pendingRemoveFileIdx, setPendingRemoveFileIdx] = React.useState<number | null>(null);
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
    sourcePageCount?: number;
    fileSizeBytes?: number;
    outputPageIndex?: number;
    fallbackThumbSrc?: string;
  } | null>(null);
  const [previewFileTarget, setPreviewFileTarget] = React.useState<PdfInfo | null>(null);
  const [contextMenu, setContextMenu] = React.useState<PdfContextMenuTarget | null>(null);
  const [pendingConflict, setPendingConflict] = React.useState<
    | { kind: "merge"; outPath: string; conflicts: string[]; lockedByActiveJob: boolean }
    | {
        kind: "split";
        inputs: string[];
        stems: string[];
        outDir: string;
        rule: PdfSplitRule;
        conflicts: string[];
        lockedByActiveJob: boolean;
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
  const [activeSectionId, setActiveSectionId] = React.useState<string | null>(null);

  const [sectionHeightsPx, setSectionHeightsPx] = usePersistentState<Record<string, number>>(
    "knit.pdfops.sectionHeightsPx",
    {},
  );
  const [splitLeftRatio, setSplitLeftRatio] = usePersistentState<number>(
    "knit.pdfops.splitLeftRatio",
    0.42,
  );
  const [sourcePaneHeightPx, setSourcePaneHeightPx] = usePersistentState<number>(
    "knit.pdfops.sourcePaneHeightPx",
    540,
  );
  const [sectionsPaneHeightPx, setSectionsPaneHeightPx] = usePersistentState<number>(
    "knit.pdfops.sectionsPaneHeightPx",
    540,
  );

  const filesRef = React.useRef(files);
  filesRef.current = files;
  const selectionsRef = React.useRef(selections);
  selectionsRef.current = selections;
  const splitSectionsRef = React.useRef(splitSections);
  splitSectionsRef.current = splitSections;
  const lastHandledDropSeq = React.useRef<number>(0);

  const thumbQueue = useThumbnailQueue({
    enabled: isTauriRuntime(),
    concurrency: 3,
    maxCacheEntries: 500,
    flushIntervalMs: 40,
    renderKey: async (key) => {
      const parsed = parseSourceKey(key);
      if (!parsed) return null;
      const info = filesRef.current[parsed.fileIndex];
      if (!info) return null;
      const thumbPath = await renderPdfThumbFile(info.path, parsed.pageIndex, 240);
      return { url: convertFileSrc(thumbPath) };
    },
  });

  const {
    enqueueKey: thumbEnqueueKey,
    visibleKeysRef: thumbVisibleKeysRef,
    setPinnedKeys: thumbSetPinnedKeys,
  } = thumbQueue;

  const mountedThumbRefCountsRef = React.useRef<Map<string, number>>(new Map());
  const registerThumbCardRef = React.useCallback(
    (key: string, el: HTMLDivElement | null) => {
      const counts = mountedThumbRefCountsRef.current;
      if (el) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
        thumbVisibleKeysRef.current.add(key);
        thumbEnqueueKey(key);
      } else {
        const next = (counts.get(key) ?? 1) - 1;
        if (next <= 0) {
          counts.delete(key);
          thumbVisibleKeysRef.current.delete(key);
        } else {
          counts.set(key, next);
        }
      }
    },
    [thumbEnqueueKey, thumbVisibleKeysRef],
  );

  React.useEffect(() => {
    const pinned = new Set<string>();
    if (tab === "split") {
      for (const sec of splitSections) {
        for (const item of sec.pages) {
          pinned.add(sourceKey(item.file_index, item.page_index));
        }
      }
    }
    // Chỉ bảo vệ khỏi LRU eviction, không enqueue trước các trang ngoài màn hình để ưu tiên trang đang hiển thị.
    thumbSetPinnedKeys(pinned, false);
  }, [splitSections, tab, thumbSetPinnedKeys]);

  React.useEffect(() => {
    if (typeof splitSourceFilterIdx === "number" && splitSourceFilterIdx >= files.length) {
      setSplitSourceFilterIdx("all");
    }
  }, [files.length, splitSourceFilterIdx]);

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

  const totalSplitSourcePages = React.useMemo(
    () => files.reduce((acc, f) => acc + f.page_count, 0),
    [files],
  );

  const getSplitStemForFile = React.useCallback(
    (info: PdfInfo, totalFiles: number): string => {
      const orig = getOrigPdfStem(info);
      const cleanPrefix = splitPrefixFilename.trim().replace(/\.pdf$/i, "");
      if (!cleanPrefix) return orig;
      return totalFiles <= 1 ? cleanPrefix : `${cleanPrefix}_${orig}`;
    },
    [splitPrefixFilename],
  );

  const makeDefaultSectionsForPdf = React.useCallback(
    (info: PdfInfo, totalFiles: number): SplitSectionDraft[] => {
      const stem = getSplitStemForFile(info, totalFiles);
      return [
        { id: crypto.randomUUID(), name: `${stem}_part01`, pages: [] },
        { id: crypto.randomUUID(), name: `${stem}_part02`, pages: [] },
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
              title: getOrigPdfStem(info),
              target_page_index: runningPageOffset,
              children: [],
            });
          }
          runningPageOffset += info.page_count;
        }

        const mergedFileCount = baseFileIdx + newInfos.length;
        setFiles((prev) => [...prev, ...newInfos]);
        setMergeFileOrder((prev) => [
          ...prev,
          ...newInfos.map((_, idx) => baseFileIdx + idx),
        ]);
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

  const effectiveMergeFileOrder = React.useMemo(
    () =>
      mergeFileOrder.length === files.length &&
      files.every((_, idx) => mergeFileOrder.includes(idx))
        ? mergeFileOrder
        : files.map((_, idx) => idx),
    [mergeFileOrder, files],
  );

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

  const reorderMergeFileOrder = React.useCallback(
    (fromOrderIdx: number, toOrderIdx: number) => {
      if (fromOrderIdx === toOrderIdx) return;
      const currentFiles = filesRef.current;
      const base =
        mergeFileOrder.length === currentFiles.length
          ? [...mergeFileOrder]
          : currentFiles.map((_, idx) => idx);
      if (
        fromOrderIdx < 0 ||
        toOrderIdx < 0 ||
        fromOrderIdx >= base.length ||
        toOrderIdx >= base.length
      ) {
        return;
      }
      const [moved] = base.splice(fromOrderIdx, 1);
      base.splice(toOrderIdx, 0, moved);
      setMergeFileOrder(base);
      setSelections(buildSelectionsFromFileOrder(base, currentFiles));
    },
    [mergeFileOrder],
  );

  const handleChangeMergeMode = React.useCallback(
    (nextMode: PdfMergeMode) => {
      if (nextMode === mergeMode) return;
      if (nextMode === "per_page") {
        setSelections(buildSelectionsFromFileOrder(effectiveMergeFileOrder, filesRef.current));
        setMergeMode("per_page");
        return;
      }
      const check = analyzePerPageContiguity(selectionsRef.current, filesRef.current);
      if (check.intact) {
        setMergeFileOrder(check.fileOrder);
        setMergeMode("per_file");
        return;
      }
      setPendingMergeModeReset(true);
    },
    [effectiveMergeFileOrder, mergeMode, setMergeMode],
  );

  const confirmResetToPerFileMode = React.useCallback(() => {
    const defaultOrder = filesRef.current.map((_, idx) => idx);
    setMergeFileOrder(defaultOrder);
    setSelections(buildSelectionsFromFileOrder(defaultOrder, filesRef.current));
    setMergeMode("per_file");
    setPendingMergeModeReset(false);
  }, [setMergeMode]);

  const handleRotateMergePageBy = React.useCallback((idx: number, deltaDeg: number) => {
    setSelections((prev) =>
      prev.map((s, i) =>
        i === idx ? { ...s, rotation_deg: (s.rotation_deg + deltaDeg + 360) % 360 } : s,
      ),
    );
  }, []);

  const handleRotateMergePage = React.useCallback(
    (idx: number) => handleRotateMergePageBy(idx, 90),
    [handleRotateMergePageBy],
  );

  const handleRemoveMergePage = React.useCallback((idx: number) => {
    setSelections((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handleAttachMergeBookmark = React.useCallback(
    (idx: number, filePath: string, sourcePageIndex: number) => {
      const fileName = filePath.split(/[\\/]/).pop() ?? filePath;
      const shortName = fileName.replace(/\.pdf$/i, "");
      setPreserveBookmarks(true);
      setShowMergeBookmarks(true);
      setMergeBookmarks((prev) => [
        ...prev,
        {
          title: `${shortName} · Tr. ${sourcePageIndex + 1}`,
          target_page_index: idx,
          children: [],
        },
      ]);
    },
    [setPreserveBookmarks, setShowMergeBookmarks],
  );

  const handleCopyPdfPath = React.useCallback(
    async (filePath: string) => {
      try {
        await navigator.clipboard.writeText(filePath);
        notifyImported(t.common.copiedToClipboard(filePath));
      } catch {
        // Ignore clipboard errors when window lacks focus
      }
    },
    [notifyImported, t.common],
  );

  const openZoomModal = React.useCallback(
    (
      filePath: string,
      pageIndex: number,
      rotationDeg: number,
      outputPageIndex?: number,
    ) => {
      const fIdx = filesRef.current.findIndex((f) => f.path === filePath);
      const info = fIdx >= 0 ? filesRef.current[fIdx] : undefined;
      const key = fIdx >= 0 ? sourceKey(fIdx, pageIndex) : "";
      setZoomTarget({
        path: filePath,
        pageIndex,
        rotationDeg,
        sourcePageCount: info?.page_count,
        fileSizeBytes: info?.file_size_bytes,
        outputPageIndex,
        fallbackThumbSrc: key ? thumbQueue.thumbsRef.current[key] : undefined,
      });
    },
    [thumbQueue.thumbsRef],
  );

  const handleDoubleClickMergePage = React.useCallback(
    (idx: number) => {
      const sel = selectionsRef.current[idx];
      if (!sel) return;
      const srcPath = filesRef.current[sel.file_index]?.path ?? "";
      if (!srcPath) return;
      openZoomModal(srcPath, sel.page_index, sel.rotation_deg, idx);
    },
    [openZoomModal],
  );

  const handleDoubleClickSplitPage = React.useCallback(
    (fileIndex: number, pageIndex: number, rotationDeg = 0) => {
      const src = filesRef.current[fileIndex];
      if (!src) return;
      openZoomModal(src.path, pageIndex, rotationDeg);
    },
    [openZoomModal],
  );

  const handleContextMenuMergePage = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement>, idx: number) => {
      const sel = selectionsRef.current[idx];
      if (!sel) return;
      const srcPath = filesRef.current[sel.file_index]?.path ?? "";
      if (!srcPath) return;
      setContextMenu({
        mode: "merge",
        idx,
        fileIndex: sel.file_index,
        pageIndex: sel.page_index,
        rotationDeg: sel.rotation_deg,
        filePath: srcPath,
        x: e.clientX,
        y: e.clientY,
      });
    },
    [],
  );

  const handleContextMenuSplitSource = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement>, fileIndex: number, pageIndex: number) => {
      const src = filesRef.current[fileIndex];
      if (!src) return;
      setContextMenu({
        mode: "split",
        fileIndex,
        pageIndex,
        rotationDeg: 0,
        filePath: src.path,
        x: e.clientX,
        y: e.clientY,
      });
    },
    [],
  );

  const handleContextMenuSplitSectionItem = React.useCallback(
    (
      e: React.MouseEvent<HTMLDivElement>,
      sectionId: string,
      uid: string,
      fileIndex: number,
      pageIndex: number,
      rotationDeg: number,
    ) => {
      const src = filesRef.current[fileIndex];
      if (!src) return;
      setContextMenu({
        mode: "split_item",
        sectionId,
        uid,
        fileIndex,
        pageIndex,
        rotationDeg,
        filePath: src.path,
        x: e.clientX,
        y: e.clientY,
      });
    },
    [],
  );

  const handleDoubleClickMergeFile = React.useCallback((fileIndex: number) => {
    const src = filesRef.current[fileIndex];
    if (!src) return;
    setPreviewFileTarget(src);
  }, []);

  const handleAttachBookmarkAtMergePageIdx = React.useCallback(
    (idx: number) => {
      const sel = selectionsRef.current[idx];
      if (!sel) return;
      const srcPath = filesRef.current[sel.file_index]?.path;
      if (!srcPath) return;
      handleAttachMergeBookmark(idx, srcPath, sel.page_index);
    },
    [handleAttachMergeBookmark],
  );

  const handleAttachBookmarkAtMergeFileOrderIdx = React.useCallback(
    (orderIdx: number) => {
      const fileIdx = effectiveMergeFileOrder[orderIdx];
      if (fileIdx === undefined) return;
      const src = filesRef.current[fileIdx];
      if (!src) return;
      const firstSelIdx = selectionsRef.current.findIndex((s) => s.file_index === fileIdx);
      const targetPageIdx = firstSelIdx >= 0 ? firstSelIdx : 0;
      const fileName = src.path.split(/[\\/]/).pop() ?? src.path;
      const shortName = fileName.replace(/\.pdf$/i, "");
      setPreserveBookmarks(true);
      setShowMergeBookmarks(true);
      setMergeBookmarks((prev) => [
        ...prev,
        {
          title: shortName,
          target_page_index: targetPageIdx,
          children: [],
        },
      ]);
    },
    [effectiveMergeFileOrder, setPreserveBookmarks, setShowMergeBookmarks],
  );

  const handleContextMenuMergeFile = React.useCallback(
    (e: React.MouseEvent<HTMLDivElement>, fileIndex: number) => {
      const src = filesRef.current[fileIndex];
      if (!src) return;
      setContextMenu({
        mode: "split",
        fileIndex,
        pageIndex: 0,
        rotationDeg: 0,
        filePath: src.path,
        x: e.clientX,
        y: e.clientY,
      });
    },
    [],
  );

  const confirmRemoveImportedFile = React.useCallback(() => {
    const removeIdx = pendingRemoveFileIdx;
    setPendingRemoveFileIdx(null);
    if (removeIdx === null || removeIdx < 0 || removeIdx >= files.length) return;
    const removedPath = files[removeIdx]?.path;

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
        return mapped === undefined ? children : [{ ...n, target_page_index: mapped, children }];
      });

    setFiles((prev) => prev.filter((_, idx) => idx !== removeIdx));
    setMergeFileOrder((prev) =>
      prev
        .filter((fIdx) => fIdx !== removeIdx)
        .map((fIdx) => (fIdx > removeIdx ? fIdx - 1 : fIdx)),
    );
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
    setSplitSourceFilterIdx((prev) => {
      if (typeof prev !== "number") return prev;
      if (prev === removeIdx) return "all";
      return prev > removeIdx ? prev - 1 : prev;
    });
    thumbQueue.remapCache((k) => {
      const parsed = parseSourceKey(k);
      if (!parsed || parsed.fileIndex === removeIdx) return null;
      const remappedFile =
        parsed.fileIndex > removeIdx ? parsed.fileIndex - 1 : parsed.fileIndex;
      return sourceKey(remappedFile, parsed.pageIndex);
    });
    if (removedPath) {
      void releasePdfCachedFiles([removedPath]);
    }
  }, [pendingRemoveFileIdx, files, selections, thumbQueue]);

  const handlePopulateSectionsFromRule = async () => {
    if (files.length === 0 || isPopulatingSections) return;
    setErrorMsg(null);
    const items = displayedSplitSourceItems;
    if (items.length === 0) return;

    const baseInfo =
      typeof splitSourceFilterIdx === "number" && files[splitSourceFilterIdx]
        ? files[splitSourceFilterIdx]
        : files[0];
    const stem = getSplitStemForFile(baseInfo, files.length);

    if (splitRuleKind === "every_n_pages") {
      const runId = ++populateRunIdRef.current;
      setIsPopulatingSections(true);
      try {
        const step = Math.max(1, everyN);
        const next: SplitSectionDraft[] = [];
        let part = 1;
        const CHUNK_SECTIONS = 200;
        let sectionsSinceYield = 0;
        for (let start = 0; start < items.length; start += step) {
          if (populateRunIdRef.current !== runId) return;
          const end = Math.min(items.length, start + step);
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
          sectionsSinceYield += 1;
          if (sectionsSinceYield >= CHUNK_SECTIONS && start + step < items.length) {
            sectionsSinceYield = 0;
            await new Promise<void>((r) => window.setTimeout(r, 0));
          }
        }
        if (populateRunIdRef.current !== runId) return;
        setSplitSections(next);
        if (next[0]) setActiveSectionId(next[0].id);
      } finally {
        if (populateRunIdRef.current === runId) {
          setIsPopulatingSections(false);
        }
      }
    } else if (splitRuleKind === "page_ranges") {
      const parsed = parsePageRangesClient(rangesStr, items.length);
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
    setSplitSections((prev) => [
      ...prev,
      { id, name: `${stem}_part${String(prev.length + 1).padStart(2, "0")}`, pages: [] },
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

  const applyDropOnSection = React.useCallback(
    (payload: SplitDragPayload, targetSectionId: string, insertAtIndex?: number) => {
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
            if (rawTarget === fromIdx || rawTarget === fromIdx + 1) return sec;
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

  const handleRotateSectionItemBy = React.useCallback(
    (sectionId: string, uid: string, deltaDeg: number) => {
      setSplitSections((prev) =>
        prev.map((s) =>
          s.id === sectionId
            ? {
                ...s,
                pages: s.pages.map((p) =>
                  p.uid === uid
                    ? { ...p, rotation_deg: (p.rotation_deg + deltaDeg + 360) % 360 }
                    : p,
                ),
              }
            : s,
        ),
      );
    },
    [],
  );

  const handleRotateSectionItem = React.useCallback(
    (sectionId: string, uid: string) => handleRotateSectionItemBy(sectionId, uid, 90),
    [handleRotateSectionItemBy],
  );

  const handleRemoveSectionItem = React.useCallback((sectionId: string, uid: string) => {
    setSplitSections((prev) =>
      prev.map((s) =>
        s.id === sectionId ? { ...s, pages: s.pages.filter((p) => p.uid !== uid) } : s,
      ),
    );
  }, []);

  const executeMerge = async (outPath: string) => {
    const jobId = crypto.randomUUID();
    const snapInputs = files.map((f) => f.path);
    const snapSelections = [...selections];
    const snapPreserve = preserveBookmarks;
    const snapCustomBookmarks = preserveBookmarks ? [...mergeBookmarks] : null;
    const emitEvent = (ev: JobEvent) => onJobEvent(ev, jobId);

    try {
      onStartJob(jobId, t.pdfOps.mergeJobTitle, [outPath]);
      const res = await mergePdfFiles(
        jobId,
        {
          inputs: snapInputs,
          selected_pages: snapSelections,
          output_path: outPath,
          preserve_bookmarks: snapPreserve,
          custom_bookmarks: snapCustomBookmarks,
        },
        emitEvent,
      );
      onFinishJob(
        t.pdfOps.mergeJobTitle,
        res.output_files,
        t.pdfOps.mergeDoneSummary(res.total_pages, formatBytes(res.total_bytes)),
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
        t.pdfOps.mergeJobTitle,
        [],
        msg,
        cancelled ? "cancelled" : "error",
        undefined,
        jobId,
      );
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

      const activeHits = findActiveExportConflicts([outPath], activeExportPaths);
      if (activeHits.length > 0) {
        setPendingConflict({
          kind: "merge",
          outPath,
          conflicts: activeHits,
          lockedByActiveJob: true,
        });
        return;
      }

      if (defaultMergeTargetPath) {
        const conflicts = await checkExportConflicts([outPath]);
        if (conflicts.length > 0) {
          setPendingConflict({
            kind: "merge",
            outPath,
            conflicts,
            lockedByActiveJob: false,
          });
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
    expectedOutputs: string[] = [],
  ) => {
    if (inputs.length === 0) return;
    const jobId = crypto.randomUUID();
    const emitEvent = (ev: JobEvent) => onJobEvent(ev, jobId);

    try {
      onStartJob(jobId, t.pdfOps.splitJobTitle, expectedOutputs);
      const res =
        inputs.length === 1 && rule.rule !== "custom_groups"
          ? await splitPdfFile(jobId, inputs[0], outDir, stems[0] ?? "split", rule, emitEvent)
          : await splitMultiPdfFiles(jobId, inputs, stems, outDir, rule, emitEvent);
      onFinishJob(
        t.pdfOps.splitJobTitle,
        res.output_files,
        t.pdfOps.splitDoneSummary(res.output_files.length, res.total_pages),
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
        t.pdfOps.splitJobTitle,
        [],
        msg,
        cancelled ? "cancelled" : "error",
        undefined,
        jobId,
      );
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
      const useCustomGroups = splitRuleKind !== "max_bytes" && nonEmptySections.length > 0;

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
        const activeHits = findActiveExportConflicts(candidates, activeExportPaths);
        if (activeHits.length > 0) {
          setPendingConflict({
            kind: "split",
            inputs,
            stems,
            outDir,
            rule,
            conflicts: activeHits,
            lockedByActiveJob: true,
          });
          return;
        }
        const conflicts = await checkExportConflicts(candidates);
        if (conflicts.length > 0) {
          setPendingConflict({
            kind: "split",
            inputs,
            stems,
            outDir,
            rule,
            conflicts,
            lockedByActiveJob: false,
          });
          return;
        }
      }

      await executeSplit(inputs, stems, outDir, rule, candidates);
    } catch (e) {
      setErrorMsg(String(e));
    }
  };

  const handleConflictResolution = async (choice: ConflictResolution) => {
    const pending = pendingConflict;
    setPendingConflict(null);
    if (!pending || choice === "cancel") return;
    if (pending.kind === "merge") {
      if (choice === "overwrite" && !pending.lockedByActiveJob) {
        await executeMerge(pending.outPath);
      } else {
        await executeMerge(
          await resolveUniqueNonActiveExportPath(pending.outPath, activeExportPaths),
        );
      }
      return;
    }

    if (choice === "overwrite" && !pending.lockedByActiveJob) {
      await executeSplit(pending.inputs, pending.stems, pending.outDir, pending.rule);
      return;
    }

    if (pending.rule.rule === "custom_groups") {
      const usedPaths = [...activeExportPaths];
      const renamedGroups = [];
      for (let idx = 0; idx < pending.rule.groups.length; idx++) {
        const g = pending.rule.groups[idx];
        const base =
          g.name.trim().replace(/\.pdf$/i, "") ||
          `section_${String(idx + 1).padStart(2, "0")}`;
        const uniquePath = await resolveUniqueNonActiveExportPath(
          joinDirAndFile(pending.outDir, `${base}.pdf`),
          usedPaths,
        );
        usedPaths.push(uniquePath);
        const uniqueName =
          uniquePath.split(/[\\/]/).pop()?.replace(/\.pdf$/i, "") || base;
        renamedGroups.push({ ...g, name: uniqueName });
      }
      const nextRule: PdfSplitRule = { rule: "custom_groups", groups: renamedGroups };
      await executeSplit(
        pending.inputs,
        pending.stems,
        pending.outDir,
        nextRule,
        renamedGroups.map((g) => joinDirAndFile(pending.outDir, `${g.name}.pdf`)),
      );
    } else {
      const suffix = Date.now().toString().slice(-4);
      const uniqueStems = pending.stems.map((s) => `${s}_${suffix}`);
      await executeSplit(pending.inputs, uniqueStems, pending.outDir, pending.rule);
    }
  };

  const activeEstimate = React.useMemo(() => {
    if (files.length === 0) return null;
    if (tab === "merge") {
      if (selections.length === 0) return null;
      const est = estimatePdfMergeOutput(files, selections);
      return t.common.estimatedOutputSummary(formatBytes(est.estimatedBytes), est.estimatedFiles);
    }
    const est = estimatePdfSplitOutput({
      files,
      sections: splitRuleKind !== "max_bytes" ? splitSections : [],
      ruleKind: splitRuleKind,
      everyN,
      splitMaxMb,
    });
    if (est.estimatedBytes <= 0) return null;
    return t.common.estimatedOutputSummary(formatBytes(est.estimatedBytes), est.estimatedFiles);
  }, [everyN, files, selections, splitMaxMb, splitRuleKind, splitSections, t.common, tab]);

  return (
    <div className="space-y-4">
      <ViewHeader
        title={t.pdfOps.title}
        subtitle={t.pdfOps.subtitle}
        actions={
          tab === "merge" ? (
            <button
              type="button"
              disabled={busy || files.length === 0 || selections.length === 0}
              onClick={() => void handleMerge()}
              className="knit-control knit-btn-primary inline-flex items-center gap-1.5 px-4 text-sm disabled:opacity-50"
            >
              <FilePlus className="h-4 w-4" />
              {t.pdfOps.mergeBtn(selections.length)}
            </button>
          ) : (
            <button
              type="button"
              disabled={busy || isPopulatingSections || files.length === 0}
              onClick={() => void handleSplit()}
              className="knit-control knit-btn-primary inline-flex items-center gap-1.5 px-4 text-sm disabled:opacity-50"
            >
              <Scissors className="h-4 w-4" />
              {splitRuleKind !== "max_bytes" && nonEmptySections.length > 0
                ? t.pdfOps.splitCustomBtn(nonEmptySections.length, totalCustomPages)
                : t.pdfOps.splitBtn}
            </button>
          )
        }
      />

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

      {/* Output Filename Bar */}
      <ExportFilenameControl
        value={tab === "merge" ? mergeExportFilename : splitPrefixFilename}
        onChange={tab === "merge" ? setMergeExportFilename : setSplitPrefixFilename}
        label={tab === "split" ? t.pdfOps.splitPrefixLabel : undefined}
        placeholder={tab === "merge" ? "merged.pdf" : t.pdfOps.splitPrefixPlaceholder}
        defaultExportDir={defaultExportDir}
        existsAtDefaultDir={tab === "merge" ? mergeExistsAtDefaultDir : false}
        estimateText={activeEstimate}
        className="bg-white"
      />

      <ErrorBanner message={errorMsg} />

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

      <LoadedPdfList
        files={files}
        highlighted={importHighlighted}
        onRequestClearAll={() => setPendingClearAll(true)}
        onRequestRemoveFile={setPendingRemoveFileIdx}
      />

      <PdfMergePane
        active={tab === "merge"}
        files={files}
        selections={selections}
        mergeMode={mergeMode}
        mergeFileOrder={effectiveMergeFileOrder}
        mergeBookmarks={mergeBookmarks}
        preserveBookmarks={preserveBookmarks}
        showMergeBookmarks={showMergeBookmarks}
        bookmarksDisabled={false}
        mergeGridCols={mergeGridCols}
        mergeCardSize={mergeCardSize}
        thumbs={thumbQueue.thumbs}
        onChangeMergeMode={handleChangeMergeMode}
        onTogglePreserveBookmarks={setPreserveBookmarks}
        onChangeMergeGridCols={setMergeGridCols}
        onChangeMergeCardSize={setMergeCardSize}
        onToggleShowBookmarks={() => setShowMergeBookmarks((v) => !v)}
        onChangeBookmarks={setMergeBookmarks}
        onReorderSelection={reorderMergeSelection}
        onReorderFileOrder={reorderMergeFileOrder}
        onRotatePage={handleRotateMergePage}
        onRemovePage={handleRemoveMergePage}
        onRemoveFile={setPendingRemoveFileIdx}
        onDoubleClickPage={handleDoubleClickMergePage}
        onDoubleClickFile={handleDoubleClickMergeFile}
        onContextMenuPage={handleContextMenuMergePage}
        onContextMenuFile={handleContextMenuMergeFile}
        onAttachBookmarkAtPage={handleAttachBookmarkAtMergePageIdx}
        onAttachBookmarkAtFile={handleAttachBookmarkAtMergeFileOrderIdx}
        onRegisterThumbRef={registerThumbCardRef}
        onEnqueueWindow={thumbQueue.enqueueWindow}
      />

      <PdfSplitPane
        active={tab === "split"}
        files={files}
        thumbs={thumbQueue.thumbs}
        thumbsRef={thumbQueue.thumbsRef}
        splitRuleKind={splitRuleKind}
        rangesStr={rangesStr}
        everyN={everyN}
        splitMaxMb={splitMaxMb}
        splitSections={splitSections}
        activeSectionId={activeSectionId}
        splitSourceCols={splitSourceCols}
        splitCardSize={splitCardSize}
        isPopulatingSections={isPopulatingSections}
        splitSourceFilterIdx={splitSourceFilterIdx}
        splitLeftRatio={splitLeftRatio}
        sourcePaneHeightPx={sourcePaneHeightPx}
        sectionsPaneHeightPx={sectionsPaneHeightPx}
        sectionHeightsPx={sectionHeightsPx}
        displayedSplitSourceItems={displayedSplitSourceItems}
        totalSplitSourcePages={totalSplitSourcePages}
        onChangeSplitRuleKind={setSplitRuleKind}
        onChangeRangesStr={setRangesStr}
        onChangeEveryN={setEveryN}
        onChangeSplitMaxMb={setSplitMaxMb}
        onPopulateSectionsFromRule={() => void handlePopulateSectionsFromRule()}
        onChangeSplitSourceCols={setSplitSourceCols}
        onChangeSplitCardSize={setSplitCardSize}
        onChangeSplitSourceFilterIdx={setSplitSourceFilterIdx}
        onChangeSplitLeftRatio={setSplitLeftRatio}
        onChangeSourcePaneHeightPx={setSourcePaneHeightPx}
        onChangeSectionsPaneHeightPx={setSectionsPaneHeightPx}
        onChangeSectionHeightPx={(secId, h) =>
          setSectionHeightsPx((prev) => ({ ...prev, [secId]: h }))
        }
        onSetActiveSectionId={setActiveSectionId}
        onAddSection={addSection}
        onRenameSection={(secId, name) =>
          setSplitSections((prev) => prev.map((s) => (s.id === secId ? { ...s, name } : s)))
        }
        onClearSection={(secId) =>
          setSplitSections((prev) =>
            prev.map((s) => (s.id === secId ? { ...s, pages: [] } : s)),
          )
        }
        onDeleteSection={(secId) =>
          setSplitSections((prev) => prev.filter((s) => s.id !== secId))
        }
        onAppendSourceItems={appendSourceItemsToSection}
        onApplyDropOnSection={applyDropOnSection}
        onRotateSectionItem={handleRotateSectionItem}
        onRemoveSectionItem={handleRemoveSectionItem}
        onDoubleClickSplitPage={handleDoubleClickSplitPage}
        onContextMenuSourcePage={handleContextMenuSplitSource}
        onContextMenuSectionItem={handleContextMenuSplitSectionItem}
        onRegisterThumbRef={registerThumbCardRef}
        onEnqueueWindow={thumbQueue.enqueueWindow}
      />

      <PdfPageZoomModal
        pdfPath={zoomTarget?.path ?? null}
        pageIndex={zoomTarget?.pageIndex ?? 0}
        rotationDeg={zoomTarget?.rotationDeg ?? 0}
        sourcePageCount={zoomTarget?.sourcePageCount}
        fileSizeBytes={zoomTarget?.fileSizeBytes}
        outputPageIndex={zoomTarget?.outputPageIndex}
        fallbackThumbSrc={zoomTarget?.fallbackThumbSrc}
        onClose={() => setZoomTarget(null)}
      />

      <PdfFilePreviewModal
        pdfInfo={previewFileTarget}
        onClose={() => setPreviewFileTarget(null)}
      />

      <PdfPageContextMenu
        target={contextMenu}
        onClose={() => setContextMenu(null)}
        onRotateBy={handleRotateMergePageBy}
        onDelete={handleRemoveMergePage}
        onRotateSplitItemBy={handleRotateSectionItemBy}
        onDeleteSplitItem={handleRemoveSectionItem}
        onAttachBookmark={handleAttachMergeBookmark}
        onZoom={openZoomModal}
        onCopyPath={(p) => void handleCopyPdfPath(p)}
      />

      <ConfirmModal
        open={pendingMergeModeReset}
        title={t.pdfOps.mergeModeResetTitle}
        description={t.pdfOps.mergeModeResetDesc}
        confirmLabel={t.pdfOps.mergeModeResetConfirmBtn}
        cancelLabel={t.common.cancel}
        closeAriaLabel={t.common.close}
        onConfirm={confirmResetToPerFileMode}
        onCancel={() => setPendingMergeModeReset(false)}
      />

      <ConfirmModal
        open={pendingRemoveFileIdx !== null && Boolean(files[pendingRemoveFileIdx])}
        title={t.pdfOps.removeFileConfirmTitle}
        description={
          pendingRemoveFileIdx !== null && files[pendingRemoveFileIdx]
            ? t.pdfOps.removeFileConfirmDesc(
                files[pendingRemoveFileIdx].path.split(/[\\/]/).pop() ??
                  files[pendingRemoveFileIdx].path,
                selections.filter((s) => s.file_index === pendingRemoveFileIdx).length,
              )
            : ""
        }
        confirmLabel={t.pdfOps.removeFileConfirmBtn}
        cancelLabel={t.common.cancel}
        closeAriaLabel={t.common.close}
        onConfirm={confirmRemoveImportedFile}
        onCancel={() => setPendingRemoveFileIdx(null)}
      />

      <ConfirmModal
        open={pendingClearAll && files.length > 0}
        title={t.pdfOps.clearAllConfirmTitle}
        description={t.pdfOps.clearAllConfirmDesc(
          files.length,
          files.reduce((acc, f) => acc + f.page_count, 0),
        )}
        confirmLabel={t.pdfOps.clearAllConfirmBtn}
        cancelLabel={t.common.cancel}
        closeAriaLabel={t.common.close}
        onConfirm={() => {
          populateRunIdRef.current += 1;
          setIsPopulatingSections(false);
          setPendingMergeModeReset(false);
          thumbQueue.resetAll();
          setPendingClearAll(false);
          setFiles([]);
          setMergeFileOrder([]);
          setSelections([]);
          setMergeBookmarks([]);
          setSplitSections([]);
          setSplitSourceFilterIdx("all");
          void clearImagePreviewCache();
        }}
        onCancel={() => setPendingClearAll(false)}
      />

      <ExportConflictModal
        conflictPaths={pendingConflict?.conflicts ?? []}
        isLockedByActiveJob={pendingConflict?.lockedByActiveJob}
        onResolve={(c) => void handleConflictResolution(c)}
      />

      <ImportFeedbackToast toast={importToast} />
    </div>
  );
};
