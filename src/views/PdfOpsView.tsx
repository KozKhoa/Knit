import React from "react";
import { NumberInput } from "../components/NumberInput";
import { Select } from "../components/Select";
import {
  AlertTriangle,
  Check,
  Eraser,
  FilePlus,
  GripHorizontal,
  GripVertical,
  Layers,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RotateCw,
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
import { PdfPageZoomModal } from "../components/PdfPageZoomModal";
import { useI18n } from "../i18n";
import {
  checkExportConflicts,
  formatBytes,
  inspectPdfFile,
  mergePdfFiles,
  pickDirectory,
  pickFiles,
  pickSaveFile,
  renderPdfThumbBase64,
  resolveUniqueExportPath,
  splitPdfFile,
} from "../lib/ipc";
import { joinDirAndFile, useExportFilenameCheck } from "../lib/exportPath";
import { hitTestGridInsertIndex } from "../lib/imageGrid";
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

const MERGE_GRID_OPTIONS = [2, 3, 4, 5, 6] as const;
const MERGE_GRID_CLASS: Record<number, string> = {
  2: "grid-cols-2",
  3: "grid-cols-2 sm:grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-3 md:grid-cols-4",
  5: "grid-cols-2 sm:grid-cols-3 md:grid-cols-5",
  6: "grid-cols-2 sm:grid-cols-4 md:grid-cols-6",
};

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
  page_index: number;
  rotation_deg: number;
}

interface SplitSectionDraft {
  id: string;
  name: string;
  pages: SplitSectionItem[];
}

type SplitDragPayload =
  | { kind: "source"; page_index: number }
  | { kind: "source_many"; page_indices: number[] }
  | { kind: "section_item"; sectionId: string; itemIndex: number };

const INITIAL_THUMB_LIMIT = 48;

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
  const [mergeDragIdx, setMergeDragIdx] = React.useState<number | null>(null);
  const [mergeInsertAt, setMergeInsertAt] = React.useState<number | null>(null);
  const mergeGridRef = React.useRef<HTMLDivElement | null>(null);
  const selectionsLengthRef = React.useRef<number>(selections.length);
  selectionsLengthRef.current = selections.length;
  const [pendingClearAll, setPendingClearAll] = React.useState(false);
  const [thumbs, setThumbs] = React.useState<Record<string, string>>({});
  const [thumbLimit, setThumbLimit] = React.useState<number>(INITIAL_THUMB_LIMIT);
  const [preserveBookmarks, setPreserveBookmarks] = usePersistentState<boolean>(
    "knit.pdfops.preserveBookmarks",
    true,
  );
  const [mergeExportFilename, setMergeExportFilename] = usePersistentState<string>(
    "knit.pdfops.mergeExportFilename",
    "merged.pdf",
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
    | { kind: "split"; outDir: string; stem: string; rule: PdfSplitRule; conflicts: string[] }
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
  const [hoverSectionId, setHoverSectionId] = React.useState<string | null>(null);
  const splitDragRef = React.useRef<SplitDragPayload | null>(null);

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

  const [selectedSourcePages, setSelectedSourcePages] = React.useState<Set<number>>(
    () => new Set(),
  );
  const [lastClickedSourceIdx, setLastClickedSourceIdx] = React.useState<number | null>(null);

  const sourcePdfPath = files[0]?.path ?? null;
  React.useEffect(() => {
    setSelectedSourcePages(new Set());
    setLastClickedSourceIdx(null);
  }, [sourcePdfPath]);

  const handleSourcePageClick = (e: React.MouseEvent, pIdx: number) => {
    if (e.shiftKey && lastClickedSourceIdx !== null) {
      const start = Math.min(lastClickedSourceIdx, pIdx);
      const end = Math.max(lastClickedSourceIdx, pIdx);
      setSelectedSourcePages((prev) => {
        const next = e.ctrlKey || e.metaKey ? new Set(prev) : new Set<number>();
        for (let i = start; i <= end; i++) next.add(i);
        return next;
      });
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      setSelectedSourcePages((prev) => {
        const next = new Set(prev);
        if (next.has(pIdx)) {
          next.delete(pIdx);
        } else {
          next.add(pIdx);
        }
        return next;
      });
      setLastClickedSourceIdx(pIdx);
      return;
    }
    setSelectedSourcePages(new Set([pIdx]));
    setLastClickedSourceIdx(pIdx);
  };

  const sortedSelectedSourcePages = React.useMemo(
    () => Array.from(selectedSourcePages).sort((a, b) => a - b),
    [selectedSourcePages],
  );
  const lastHandledDropSeq = React.useRef<number>(0);

  const loadPdfThumbsRange = React.useCallback(
    async (fileIndex: number, info: PdfInfo, startPage: number, endPageExclusive: number) => {
      const cap = Math.min(info.page_count, endPageExclusive);
      for (let p = startPage; p < cap; p++) {
        const key = `${fileIndex}:${p}`;
        try {
          const b64 = await renderPdfThumbBase64(info.path, p, 220);
          setThumbs((prev) => ({ ...prev, [key]: `data:image/png;base64,${b64}` }));
        } catch {
          // ignore thumbnail error for malformed fonts
        }
      }
    },
    [],
  );

  const getSplitStem = (info: PdfInfo): string =>
    info.path.split(/[\\/]/).pop()?.replace(/\.pdf$/i, "") || "split";

  const makeDefaultSectionsForPdf = React.useCallback((info: PdfInfo): SplitSectionDraft[] => {
    const stem = getSplitStem(info);
    const firstId = crypto.randomUUID();
    const secondId = crypto.randomUUID();
    setActiveSectionId(firstId);
    return [
      { id: firstId, name: `${stem}_part01`, pages: [] },
      { id: secondId, name: `${stem}_part02`, pages: [] },
    ];
  }, []);

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
      try {
        const baseFileIdx = tab === "split" ? 0 : files.length;
        const basePageOffset = tab === "split" ? 0 : selections.length;
        const newInfos: PdfInfo[] = [];
        const newSelections: PageSelection[] = [];
        const addedBookmarks: BookmarkNode[] = [];

        let runningPageOffset = basePageOffset;
        for (let i = 0; i < pdfPaths.length; i++) {
          const info = await inspectPdfFile(pdfPaths[i]);
          const fIdx = baseFileIdx + i;
          newInfos.push(info);
          for (let p = 0; p < info.page_count; p++) {
            newSelections.push({ file_index: fIdx, page_index: p, rotation_deg: 0 });
          }
          if (info.bookmarks.length > 0) {
            addedBookmarks.push(...offsetBookmarks(info.bookmarks, runningPageOffset));
          } else if (info.page_count > 0) {
            addedBookmarks.push({
              title: getSplitStem(info),
              target_page_index: runningPageOffset,
              children: [],
            });
          }
          runningPageOffset += info.page_count;
          void loadPdfThumbsRange(fIdx, info, 0, INITIAL_THUMB_LIMIT);
        }

        if (tab === "split") {
          const first = newInfos[0];
          setThumbLimit(INITIAL_THUMB_LIMIT);
          setFiles([first]);
          setSelections(newSelections.filter((s) => s.file_index === 0));
          setSplitSections(makeDefaultSectionsForPdf(first));
          setMergeBookmarks(addedBookmarks.filter((_, idx) => idx === 0 || newInfos.length === 1));
        } else {
          setFiles((prev) => [...prev, ...newInfos]);
          setSelections((prev) => [...prev, ...newSelections]);
          setMergeBookmarks((prev) => [...prev, ...addedBookmarks]);
        }

        const label =
          newInfos.length === 1
            ? newInfos[0].path.split(/[\\/]/).pop() ?? "PDF"
            : `${newInfos.length} PDF`;
        notifyImported(t.common.importSuccessToast(label));
      } catch (e) {
        setErrorMsg(String(e));
      }
    },
    [
      files.length,
      selections.length,
      loadPdfThumbsRange,
      makeDefaultSectionsForPdf,
      notifyImported,
      offsetBookmarks,
      t.common,
      tab,
    ],
  );

  React.useEffect(() => {
    if (!droppedBatch || droppedBatch.seq === lastHandledDropSeq.current) return;
    lastHandledDropSeq.current = droppedBatch.seq;
    void addPdfPaths(droppedBatch.paths);
  }, [droppedBatch, addPdfPaths]);

  React.useEffect(() => {
    if (tab === "split" && files.length > 0 && splitSections.length === 0) {
      setSplitSections(makeDefaultSectionsForPdf(files[0]));
    }
  }, [tab, files, splitSections.length, makeDefaultSectionsForPdf]);

  const handleAddPdfs = async () => {
    setErrorMsg(null);
    try {
      const picked = await pickFiles({
        title: t.pdfOps.pickPdfDialog,
        multiple: tab === "merge",
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
        const gridEl = mergeGridRef.current;
        if (!gridEl) return null;
        const rect = gridEl.getBoundingClientRect();
        const colsRaw = window.getComputedStyle(gridEl).gridTemplateColumns.trim();
        const colCount = colsRaw ? colsRaw.split(/\s+/).length : mergeGridCols;
        const firstCard = gridEl.firstElementChild as HTMLElement | null;
        const cardHeight = firstCard ? firstCard.getBoundingClientRect().height : 200;
        const gapPx = 12;
        return hitTestGridInsertIndex({
          gridLeft: rect.left,
          gridTop: rect.top,
          gridWidth: rect.width,
          gridCols: Math.max(1, colCount),
          gapPx,
          rowStride: cardHeight + gapPx,
          totalItems: selectionsLengthRef.current,
          clientX,
          clientY,
        });
      };

      const onMove = (ev: PointerEvent) => {
        latestX = ev.clientX;
        latestY = ev.clientY;
        if (!dragging && Math.hypot(latestX - startX, latestY - startY) < 6) {
          return;
        }
        if (!dragging) {
          dragging = true;
          setMergeDragIdx(idx);
          document.body.style.userSelect = "none";
          document.body.style.cursor = "grabbing";
        }
        if (rafId !== null) return;
        rafId = window.requestAnimationFrame(() => {
          rafId = null;
          setMergeInsertAt(computeInsert(latestX, latestY));
        });
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
          const finalInsert = computeInsert(ev.clientX, ev.clientY);
          if (finalInsert !== null) {
            const targetIdx = finalInsert > idx ? finalInsert - 1 : finalInsert;
            if (targetIdx !== idx) {
              reorderMergeSelection(idx, targetIdx);
            }
          }
        }
        setMergeDragIdx(null);
        setMergeInsertAt(null);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
    },
    [mergeGridCols, reorderMergeSelection],
  );

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

    setFiles((prev) => prev.filter((_, idx) => idx !== removeIdx));
    setSelections(nextSelections);
    setMergeBookmarks((prev) => filterAndRemapBookmarks(prev));
    setThumbs((prev) => {
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(prev)) {
        const [fStr, pStr] = k.split(":");
        const fNum = Number(fStr);
        if (fNum === removeIdx) continue;
        const remappedFile = fNum > removeIdx ? fNum - 1 : fNum;
        next[`${remappedFile}:${pStr}`] = v;
      }
      return next;
    });
    if (tab === "split" && removeIdx === 0) {
      setSplitSections([]);
    }
  }, [pendingRemoveFileIdx, files.length, selections, tab]);

  const handleLoadMoreSplitThumbs = () => {
    if (files.length === 0) return;
    const src = files[0];
    const nextLimit = Math.min(src.page_count, thumbLimit + INITIAL_THUMB_LIMIT);
    void loadPdfThumbsRange(0, src, thumbLimit, nextLimit);
    setThumbLimit(nextLimit);
  };

  const handlePopulateSectionsFromRule = () => {
    if (files.length === 0) return;
    setErrorMsg(null);
    const src = files[0];
    const total = src.page_count;
    const stem = getSplitStem(src);

    if (splitRuleKind === "every_n_pages") {
      const step = Math.max(1, everyN);
      const next: SplitSectionDraft[] = [];
      let part = 1;
      for (let start = 0; start < total; start += step) {
        const end = Math.min(total, start + step);
        const pages: SplitSectionItem[] = [];
        for (let p = start; p < end; p++) {
          pages.push({ uid: crypto.randomUUID(), page_index: p, rotation_deg: 0 });
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
          pages: parsed.map((p) => ({ uid: crypto.randomUUID(), page_index: p, rotation_deg: 0 })),
        },
      ]);
      setActiveSectionId(nextId);
    }
  };

  const addSection = () => {
    const stem = files[0] ? getSplitStem(files[0]) : "split";
    const id = crypto.randomUUID();
    const num = splitSections.length + 1;
    setSplitSections((prev) => [
      ...prev,
      { id, name: `${stem}_part${String(num).padStart(2, "0")}`, pages: [] },
    ]);
    setActiveSectionId(id);
  };

  const appendSourcePagesToSection = (pageIndices: number[], targetSectionId?: string) => {
    if (pageIndices.length === 0) return;
    const targetId = targetSectionId ?? activeSectionId ?? splitSections[0]?.id;
    if (!targetId) return;
    const items: SplitSectionItem[] = pageIndices.map((pageIndex) => ({
      uid: crypto.randomUUID(),
      page_index: pageIndex,
      rotation_deg: 0,
    }));
    setSplitSections((prev) =>
      prev.map((sec) =>
        sec.id === targetId
          ? {
              ...sec,
              pages: [...sec.pages, ...items],
            }
          : sec,
      ),
    );
  };

  const appendSourcePageToSection = (pageIndex: number, targetSectionId?: string) => {
    appendSourcePagesToSection([pageIndex], targetSectionId);
  };

  const handleDropOnSection = (targetSectionId: string, insertAtIndex?: number) => {
    const payload = splitDragRef.current;
    splitDragRef.current = null;
    setHoverSectionId(null);
    if (!payload) return;

    if (payload.kind === "source" || payload.kind === "source_many") {
      const indices =
        payload.kind === "source_many" ? payload.page_indices : [payload.page_index];
      const items: SplitSectionItem[] = indices.map((page_index) => ({
        uid: crypto.randomUUID(),
        page_index,
        rotation_deg: 0,
      }));
      setSplitSections((prev) =>
        prev.map((sec) => {
          if (sec.id !== targetSectionId) return sec;
          const nextPages = [...sec.pages];
          const idx =
            insertAtIndex !== undefined ? Math.max(0, Math.min(nextPages.length, insertAtIndex)) : nextPages.length;
          nextPages.splice(idx, 0, ...items);
          return { ...sec, pages: nextPages };
        }),
      );
      return;
    }

    // Moving from one section item to another slot / another section
    const { sectionId: fromSecId, itemIndex: fromIdx } = payload;
    setSplitSections((prev) => {
      const fromSec = prev.find((s) => s.id === fromSecId);
      const moving = fromSec?.pages[fromIdx];
      if (!moving) return prev;

      if (fromSecId === targetSectionId) {
        return prev.map((sec) => {
          if (sec.id !== targetSectionId) return sec;
          const nextPages = [...sec.pages];
          nextPages.splice(fromIdx, 1);
          const rawTarget = insertAtIndex ?? nextPages.length;
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
            insertAtIndex !== undefined ? Math.max(0, Math.min(nextPages.length, insertAtIndex)) : nextPages.length;
          nextPages.splice(idx, 0, moving);
          return { ...sec, pages: nextPages };
        }
        return sec;
      });
    });
  };

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

  const executeSplit = async (outDir: string, stem: string, rule: PdfSplitRule) => {
    const src = files[0];
    if (!src) return;
    try {
      const jobId = crypto.randomUUID();
      onStartJob(jobId, t.pdfOps.splitJobTitle);
      const res = await splitPdfFile(jobId, src.path, outDir, stem, rule, onJobEvent);
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
    stem: string,
    rule: PdfSplitRule,
    totalPages: number,
  ): string[] => {
    if (rule.rule === "page_ranges") {
      return [joinDirAndFile(outDir, `${stem}_extracted.pdf`)];
    }
    if (rule.rule === "extract_selected") {
      return [joinDirAndFile(outDir, `${stem}_selected.pdf`)];
    }
    if (rule.rule === "every_n_pages") {
      const step = Math.max(1, rule.n);
      const out: string[] = [];
      let part = 1;
      for (let s = 0; s < totalPages; s += step) {
        out.push(joinDirAndFile(outDir, `${stem}_part${String(part).padStart(2, "0")}.pdf`));
        part += 1;
      }
      return out;
    }
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
    return [];
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

      const src = files[0];
      const stem = getSplitStem(src);

      const useCustomGroups =
        splitRuleKind !== "max_bytes" && nonEmptySections.length > 0;

      const rule: PdfSplitRule = useCustomGroups
        ? {
            rule: "custom_groups",
            groups: nonEmptySections.map((sec) => ({
              name: sec.name.trim() || stem,
              pages: sec.pages.map((p) => ({
                file_index: 0,
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

      const candidates = computeExpectedSplitPaths(outDir, stem, rule, src.page_count);
      if (candidates.length > 0) {
        const conflicts = await checkExportConflicts(candidates);
        if (conflicts.length > 0) {
          setPendingConflict({ kind: "split", outDir, stem, rule, conflicts });
          return;
        }
      }

      await executeSplit(outDir, stem, rule);
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
      await executeSplit(pending.outDir, pending.stem, pending.rule);
      return;
    }

    // Auto-rename stem or custom group names so they don't overwrite
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
      await executeSplit(pending.outDir, pending.stem, {
        rule: "custom_groups",
        groups: renamedGroups,
      });
    } else {
      const uniqueStem = `${pending.stem}_${Date.now().toString().slice(-4)}`;
      await executeSplit(pending.outDir, uniqueStem, pending.rule);
    }
  };

  const sourcePdf = files[0] ?? null;

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
            disabled={busy || !sourcePdf}
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

      {errorMsg && (
        <div className="rounded-[4px] border border-[#F5C6CB] bg-[#F8D7DA] px-3.5 py-2.5 text-sm text-[#721C24]">
          {errorMsg}
        </div>
      )}

      <Dropzone
        title={tab === "merge" ? t.pdfOps.dropTitleMerge : t.pdfOps.dropTitleSplit}
        description={t.pdfOps.dropDesc}
        onPickFiles={() => void handleAddPdfs()}
        filesLabel={tab === "merge" ? t.pdfOps.addPdfBtn : t.pdfOps.pickPdfBtn}
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
              <span className="font-mono-code min-w-0 flex-1 truncate">{f.path}</span>
              <span className="ml-2 shrink-0 font-mono-code text-[#6C757D]">
                {t.pdfOps.docMeta(f.page_count, formatBytes(f.file_size_bytes), f.bookmarks.length)}
              </span>
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
          <div className="space-y-2.5 rounded-[4px] border border-[#DEE2E6] bg-white px-4 py-3">
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
                {MERGE_GRID_OPTIONS.map((cols) => (
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

            <ExportFilenameControl
              value={mergeExportFilename}
              onChange={setMergeExportFilename}
              placeholder="merged.pdf"
              defaultExportDir={defaultExportDir}
              existsAtDefaultDir={mergeExistsAtDefaultDir}
            />
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

              <div
                ref={mergeGridRef}
                className={`grid gap-3 ${MERGE_GRID_CLASS[mergeGridCols] ?? "grid-cols-2 md:grid-cols-5"}`}
              >
                {selections.map((sel, idx) => {
                  const key = `${sel.file_index}:${sel.page_index}`;
                  const isDragging = mergeDragIdx === idx;
                  const isNoOpInsert =
                    mergeDragIdx !== null &&
                    mergeInsertAt !== null &&
                    (mergeInsertAt === mergeDragIdx || mergeInsertAt === mergeDragIdx + 1);
                  const showBarLeft = !isNoOpInsert && mergeInsertAt === idx;
                  const showBarEnd =
                    !isNoOpInsert &&
                    idx === selections.length - 1 &&
                    mergeInsertAt === selections.length;
                  const srcPath = files[sel.file_index]?.path ?? "";
                  return (
                    <div
                      key={`${key}-${idx}`}
                      onPointerDown={(e) => handleMergeCardPointerDown(e, idx)}
                      onDoubleClick={() => {
                        if (!srcPath) return;
                        setZoomTarget({
                          path: srcPath,
                          pageIndex: sel.page_index,
                          rotationDeg: sel.rotation_deg,
                          fallbackThumbSrc: thumbs[key],
                        });
                      }}
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
                        className={`flex select-none flex-col overflow-hidden rounded-[4px] border bg-white ${
                          mergeDragIdx !== null ? "cursor-grabbing" : "cursor-grab"
                        } ${
                          isDragging
                            ? "border-[#007BFF] opacity-40 ring-2 ring-[#007BFF]"
                            : "border-[#DEE2E6] hover:border-[#007BFF]"
                        }`}
                      >
                        <div className="relative flex h-32 items-center justify-center bg-[#F1F3F5] p-1">
                          {thumbs[key] ? (
                            <img
                              src={thumbs[key]}
                              alt={`File ${sel.file_index + 1} P${sel.page_index + 1}`}
                              draggable={false}
                              className="pointer-events-none max-h-full max-w-full object-contain"
                              style={{ transform: `rotate(${sel.rotation_deg}deg)` }}
                            />
                          ) : (
                            <span className="font-mono-code text-xs text-[#6C757D]">
                              F{sel.file_index + 1}·P{sel.page_index + 1}
                            </span>
                          )}
                          <span className="absolute left-1 top-1 flex items-center gap-0.5 rounded-[4px] bg-[#343A40] px-1.5 py-0.5 font-mono-code text-[11px] text-white">
                            <GripVertical className="h-3 w-3 text-[#ADB5BD]" />#{idx + 1}
                          </span>
                        </div>
                        <div className="border-t border-[#DEE2E6] p-2">
                          <div className="font-mono-code text-xs text-[#6C757D]">
                            {t.pdfOps.pageMeta(
                              sel.file_index + 1,
                              sel.page_index + 1,
                              sel.rotation_deg,
                            )}
                          </div>
                          <div className="mt-1.5 flex items-center justify-between">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelections((prev) =>
                                  prev.map((s, i) =>
                                    i === idx
                                      ? { ...s, rotation_deg: (s.rotation_deg + 90) % 360 }
                                      : s,
                                  ),
                                );
                              }}
                              title={t.image2pdf.rotateTitle}
                              className="rounded-[4px] border border-[#DEE2E6] p-1 text-[#495057] hover:bg-[#F8F9FA]"
                            >
                              <RotateCw className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelections((prev) => prev.filter((_, i) => i !== idx));
                              }}
                              title={t.image2pdf.deletePageTitle}
                              className="rounded-[4px] p-1 text-[#DC3545] hover:bg-[#F8D7DA]"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
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

      {tab === "split" && sourcePdf && (
        <div className="space-y-4">
          {/* Quick Split Presets + Main Split CTA */}
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
            className="grid grid-cols-1 items-start gap-3 lg:gap-0 lg:[grid-template-columns:var(--split-left)_12px_minmax(0,1fr)]"
          >
            {/* Source PDF Pages Strip */}
            <div className="flex min-w-0 flex-col overflow-hidden rounded-[4px] border border-[#DEE2E6] bg-white">
              <div className="space-y-2 border-b border-[#E9ECEF] p-3.5 pb-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-base font-bold text-[#343A40]">
                      {t.pdfOps.sourcePagesTitle(sourcePdf.page_count)}
                    </div>
                    <div className="text-sm text-[#6C757D]">{t.pdfOps.sourcePagesHint}</div>
                  </div>
                  {sourcePdf.page_count > thumbLimit && (
                    <button
                      type="button"
                      onClick={handleLoadMoreSplitThumbs}
                      className="knit-control-sm rounded-[4px] border border-[#CED4DA] bg-[#F8F9FA] px-2.5 text-sm font-semibold text-[#343A40] hover:bg-[#E9ECEF]"
                    >
                      {t.pdfOps.loadMoreThumbsBtn(thumbLimit, sourcePdf.page_count)}
                    </button>
                  )}
                </div>

                {sortedSelectedSourcePages.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-[#B8DAFF] bg-[#E7F1FF] px-2.5 py-1.5 text-sm">
                    <span className="font-semibold text-[#0056B3]">
                      {t.pdfOps.selectedCount(sortedSelectedSourcePages.length)}
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          appendSourcePagesToSection(sortedSelectedSourcePages)
                        }
                        className="rounded-[4px] bg-[#007BFF] px-2.5 py-0.5 text-xs font-semibold text-white hover:bg-[#0069D9]"
                      >
                        {t.pdfOps.addSelectedBtn(sortedSelectedSourcePages.length)}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedSourcePages(new Set());
                          setLastClickedSourceIdx(null);
                        }}
                        className="rounded-[4px] border border-[#CED4DA] bg-white px-2.5 py-0.5 text-xs font-medium text-[#495057] hover:bg-[#F8F9FA]"
                      >
                        {t.pdfOps.clearSelectionBtn}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div
                style={{ height: `${liveSourceHeightPx}px` }}
                className="grid grid-cols-3 content-start gap-2 overflow-y-auto p-3.5 sm:grid-cols-4 lg:grid-cols-3"
              >
                {Array.from({ length: sourcePdf.page_count }, (_, pIdx) => {
                  const thumbKey = `0:${pIdx}`;
                  const isSelected = selectedSourcePages.has(pIdx);
                  return (
                    <div
                      key={pIdx}
                      draggable
                      onClick={(e) => handleSourcePageClick(e, pIdx)}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setZoomTarget({
                          path: sourcePdf.path,
                          pageIndex: pIdx,
                          rotationDeg: 0,
                          fallbackThumbSrc: thumbs[thumbKey],
                        });
                      }}
                      onDragStart={(e) => {
                        if (isSelected && sortedSelectedSourcePages.length > 1) {
                          splitDragRef.current = {
                            kind: "source_many",
                            page_indices: sortedSelectedSourcePages,
                          };
                          e.dataTransfer.setData(
                            "text/plain",
                            `source_many:${sortedSelectedSourcePages.join(",")}`,
                          );
                        } else {
                          splitDragRef.current = { kind: "source", page_index: pIdx };
                          e.dataTransfer.setData("text/plain", `source:${pIdx}`);
                        }
                        e.dataTransfer.effectAllowed = "copy";
                      }}
                      onDragEnd={() => {
                        splitDragRef.current = null;
                        setHoverSectionId(null);
                      }}
                      className={`group flex cursor-grab select-none flex-col overflow-hidden rounded-[4px] border active:cursor-grabbing ${
                        isSelected
                          ? "border-[#007BFF] bg-[#E7F1FF] ring-2 ring-[#007BFF]/40"
                          : "border-[#DEE2E6] bg-[#F8F9FA] hover:border-[#007BFF]"
                      }`}
                    >
                      <div className="relative flex h-24 items-center justify-center bg-white p-1">
                        {thumbs[thumbKey] ? (
                          <img
                            src={thumbs[thumbKey]}
                            alt={`P${pIdx + 1}`}
                            draggable={false}
                            className="pointer-events-none max-h-full max-w-full object-contain"
                          />
                        ) : (
                          <span className="font-mono-code text-sm text-[#6C757D]">
                            P{pIdx + 1}
                          </span>
                        )}
                        <span
                          className={`absolute left-1 top-1 flex items-center gap-0.5 rounded-[4px] px-1.5 py-0.5 font-mono-code text-xs text-white ${
                            isSelected ? "bg-[#007BFF]" : "bg-[#343A40]"
                          }`}
                        >
                          {isSelected ? (
                            <Check className="h-3 w-3" />
                          ) : (
                            <GripVertical className="h-3 w-3 text-[#ADB5BD]" />
                          )}
                          {pIdx + 1}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            appendSourcePageToSection(pIdx);
                          }}
                          title="Add to active section"
                          className="absolute bottom-1 right-1 flex h-6 w-6 items-center justify-center rounded-[4px] bg-[#007BFF] text-white opacity-90 hover:opacity-100"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

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

            {/* Width Splitter (Desktop) */}
            <div
              role="separator"
              aria-orientation="vertical"
              title={t.pdfOps.resizeWidthTitle}
              onPointerDown={handleSplitWidthResize}
              className="hidden h-full min-h-[280px] cursor-col-resize select-none items-center justify-center lg:flex"
            >
              <div className="h-14 w-1 rounded-[2px] bg-[#CED4DA] transition-colors hover:bg-[#007BFF]" />
            </div>

            {/* Output Sections Builder */}
            <div className="flex min-w-0 flex-col overflow-hidden rounded-[4px] border border-[#DEE2E6] bg-white">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E9ECEF] px-3.5 py-2.5">
                <span className="text-sm font-bold text-[#343A40]">
                  {t.pdfOps.splitBuilderTitle}
                </span>
                <button
                  type="button"
                  onClick={addSection}
                  className="knit-control-sm inline-flex items-center gap-1 rounded-[4px] border border-[#007BFF] bg-[#E7F1FF] px-3 text-xs font-semibold text-[#0056B3] hover:bg-[#007BFF] hover:text-white"
                >
                  {t.pdfOps.addSectionBtn}
                </button>
              </div>

              <div
                style={{ height: `${liveSectionsHeightPx}px` }}
                className="space-y-3 overflow-y-auto p-3.5"
              >
                {splitSections.map((section, sIdx) => {
                  const isActive = activeSectionId === section.id;
                  const isHovered = hoverSectionId === section.id;
                  return (
                    <div
                      key={section.id}
                      onClick={() => setActiveSectionId(section.id)}
                      onDragOver={(e) => {
                        if (!splitDragRef.current) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect =
                          splitDragRef.current.kind === "source" ||
                          splitDragRef.current.kind === "source_many"
                            ? "copy"
                            : "move";
                        if (hoverSectionId !== section.id) setHoverSectionId(section.id);
                      }}
                      onDragLeave={() => {
                        if (hoverSectionId === section.id) setHoverSectionId(null);
                      }}
                      onDrop={(e) => {
                        if (!splitDragRef.current) return;
                        e.preventDefault();
                        e.stopPropagation();
                        handleDropOnSection(section.id);
                      }}
                      className={`rounded-[4px] border bg-white p-3 transition-colors ${
                        isHovered
                          ? "border-2 border-dashed border-[#007BFF] bg-[#E7F1FF]/40"
                          : isActive
                            ? "border-[#007BFF] ring-1 ring-[#007BFF]/40"
                            : "border-[#DEE2E6]"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E9ECEF] pb-2.5">
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

                      {section.pages.length === 0 ? (
                        <div className="mt-2.5 rounded-[4px] border border-dashed border-[#CED4DA] bg-[#F8F9FA] py-5 text-center text-xs text-[#6C757D]">
                          {t.pdfOps.emptySectionHint}
                        </div>
                      ) : (
                        <div className="mt-2.5 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                          {section.pages.map((item, itemIdx) => {
                            const thumbKey = `0:${item.page_index}`;
                            return (
                              <div
                                key={item.uid}
                                draggable
                                onDragStart={(e) => {
                                  e.stopPropagation();
                                  splitDragRef.current = {
                                    kind: "section_item",
                                    sectionId: section.id,
                                    itemIndex: itemIdx,
                                  };
                                  e.dataTransfer.effectAllowed = "move";
                                  e.dataTransfer.setData("text/plain", item.uid);
                                }}
                                onDragOver={(e) => {
                                  if (!splitDragRef.current) return;
                                  e.preventDefault();
                                  e.stopPropagation();
                                  if (hoverSectionId !== section.id) setHoverSectionId(section.id);
                                }}
                                onDrop={(e) => {
                                  if (!splitDragRef.current) return;
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handleDropOnSection(section.id, itemIdx);
                                }}
                                onDragEnd={() => {
                                  splitDragRef.current = null;
                                  setHoverSectionId(null);
                                }}
                                className="flex cursor-grab flex-col overflow-hidden rounded-[4px] border border-[#DEE2E6] bg-[#F8F9FA] active:cursor-grabbing"
                              >
                                <div className="relative flex h-20 items-center justify-center bg-white p-1">
                                  {thumbs[thumbKey] ? (
                                    <img
                                      src={thumbs[thumbKey]}
                                      alt={`Pg ${item.page_index + 1}`}
                                      draggable={false}
                                      className="pointer-events-none max-h-full max-w-full object-contain"
                                      style={{ transform: `rotate(${item.rotation_deg}deg)` }}
                                    />
                                  ) : (
                                    <span className="font-mono-code text-xs text-[#6C757D]">
                                      P{item.page_index + 1}
                                    </span>
                                  )}
                                  <span className="absolute left-1 top-1 rounded-[4px] bg-[#007BFF] px-1 py-0.5 font-mono-code text-[10px] text-white">
                                    P{item.page_index + 1}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between border-t border-[#DEE2E6] px-1.5 py-1">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSplitSections((prev) =>
                                        prev.map((s) =>
                                          s.id === section.id
                                            ? {
                                                ...s,
                                                pages: s.pages.map((p) =>
                                                  p.uid === item.uid
                                                    ? { ...p, rotation_deg: (p.rotation_deg + 90) % 360 }
                                                    : p,
                                                ),
                                              }
                                            : s,
                                        ),
                                      );
                                    }}
                                    className="rounded-[4px] p-0.5 text-[#495057] hover:bg-[#E9ECEF]"
                                  >
                                    <RotateCw className="h-3 w-3" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setSplitSections((prev) =>
                                        prev.map((s) =>
                                          s.id === section.id
                                            ? {
                                                ...s,
                                                pages: s.pages.filter((p) => p.uid !== item.uid),
                                              }
                                            : s,
                                        ),
                                      );
                                    }}
                                    className="rounded-[4px] p-0.5 text-[#DC3545] hover:bg-[#F8D7DA]"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

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
                  setPendingClearAll(false);
                  setFiles([]);
                  setSelections([]);
                  setMergeBookmarks([]);
                  setThumbs({});
                  setSplitSections([]);
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
      if (!Number.isFinite(a) || !Number.isFinite(b) || a < 1 || b < 1 || a > totalPages || b > totalPages) {
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
