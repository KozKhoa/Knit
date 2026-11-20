import React from "react";
import { Loader2, Wand2 } from "lucide-react";
import { CardSizeSelector } from "../../components/CardSizeSelector";
import { GridColumnSelector } from "../../components/GridColumnSelector";
import { NumberInput } from "../../components/NumberInput";
import { PaneResizeHandle } from "../../components/PaneResizeHandle";
import { SplitSourceCard } from "../../components/PdfPageCards";
import { Select } from "../../components/Select";
import { SplitSectionCard } from "./SplitSectionCard";
import { useHorizontalRatioResize } from "../../hooks/useHorizontalRatioResize";
import { findScrollableAncestor, useVerticalResize } from "../../hooks/useVerticalResize";
import { useVirtualizedGrid } from "../../hooks/useVirtualizedGrid";
import { useI18n } from "../../i18n";
import { hitTestGridInsertIndex, type CardSizePreset } from "../../lib/imageGrid";
import type { PdfInfo } from "../../types/ipc";
import {
  PDF_GRID_COL_OPTIONS,
  parseSourceKey,
  sourceKey,
  type SplitDragPayload,
  type SplitDragVisual,
  type SplitSectionDraft,
} from "./pdfOpsTypes";

interface PdfSplitPaneProps {
  active: boolean;
  files: PdfInfo[];
  thumbs: Record<string, string>;
  thumbsRef: React.MutableRefObject<Record<string, string>>;
  splitRuleKind: "page_ranges" | "every_n_pages" | "max_bytes";
  rangesStr: string;
  everyN: number;
  splitMaxMb: number;
  splitSections: SplitSectionDraft[];
  activeSectionId: string | null;
  splitSourceCols: number;
  splitCardSize: CardSizePreset;
  isPopulatingSections?: boolean;
  splitSourceFilterIdx: number | "all";
  splitLeftRatio: number;
  sourcePaneHeightPx: number;
  sectionsPaneHeightPx: number;
  sectionHeightsPx: Record<string, number>;
  displayedSplitSourceItems: { fileIndex: number; pageIndex: number }[];
  totalSplitSourcePages: number;
  onChangeSplitRuleKind: (kind: "page_ranges" | "every_n_pages" | "max_bytes") => void;
  onChangeRangesStr: (val: string) => void;
  onChangeEveryN: (val: number) => void;
  onChangeSplitMaxMb: (val: number) => void;
  onPopulateSectionsFromRule: () => void;
  onChangeSplitSourceCols: (cols: number) => void;
  onChangeSplitCardSize: (size: CardSizePreset) => void;
  onChangeSplitSourceFilterIdx: (idx: number | "all") => void;
  onChangeSplitLeftRatio: (ratio: number) => void;
  onChangeSourcePaneHeightPx: (h: number) => void;
  onChangeSectionsPaneHeightPx: (h: number) => void;
  onChangeSectionHeightPx: (sectionId: string, h: number) => void;
  onSetActiveSectionId: (id: string) => void;
  onAddSection: () => void;
  onRenameSection: (sectionId: string, name: string) => void;
  onClearSection: (sectionId: string) => void;
  onDeleteSection: (sectionId: string) => void;
  onAppendSourceItems: (
    items: { file_index: number; page_index: number }[],
    targetSectionId?: string,
  ) => void;
  onApplyDropOnSection: (
    payload: SplitDragPayload,
    targetSectionId: string,
    insertAtIndex?: number,
  ) => void;
  onRotateSectionItem: (sectionId: string, uid: string) => void;
  onRemoveSectionItem: (sectionId: string, uid: string) => void;
  onDoubleClickSplitPage: (fileIndex: number, pageIndex: number, rotationDeg?: number) => void;
  onContextMenuSourcePage: (
    e: React.MouseEvent<HTMLDivElement>,
    fileIndex: number,
    pageIndex: number,
  ) => void;
  onContextMenuSectionItem: (
    e: React.MouseEvent<HTMLDivElement>,
    sectionId: string,
    uid: string,
    fileIndex: number,
    pageIndex: number,
    rotationDeg: number,
  ) => void;
  onRegisterThumbRef: (key: string, el: HTMLDivElement | null) => void;
  onEnqueueWindow: (keys: string[]) => void;
}

export const PdfSplitPane: React.FC<PdfSplitPaneProps> = ({
  active,
  files,
  thumbs,
  thumbsRef,
  splitRuleKind,
  rangesStr,
  everyN,
  splitMaxMb,
  splitSections,
  activeSectionId,
  splitSourceCols,
  splitCardSize,
  isPopulatingSections = false,
  splitSourceFilterIdx,
  splitLeftRatio,
  sourcePaneHeightPx,
  sectionsPaneHeightPx,
  sectionHeightsPx,
  displayedSplitSourceItems,
  totalSplitSourcePages,
  onChangeSplitRuleKind,
  onChangeRangesStr,
  onChangeEveryN,
  onChangeSplitMaxMb,
  onPopulateSectionsFromRule,
  onChangeSplitSourceCols,
  onChangeSplitCardSize,
  onChangeSplitSourceFilterIdx,
  onChangeSplitLeftRatio,
  onChangeSourcePaneHeightPx,
  onChangeSectionsPaneHeightPx,
  onChangeSectionHeightPx,
  onSetActiveSectionId,
  onAddSection,
  onRenameSection,
  onClearSection,
  onDeleteSection,
  onAppendSourceItems,
  onApplyDropOnSection,
  onRotateSectionItem,
  onRemoveSectionItem,
  onDoubleClickSplitPage,
  onContextMenuSourcePage,
  onContextMenuSectionItem,
  onRegisterThumbRef,
  onEnqueueWindow,
}) => {
  const { t } = useI18n();
  const splitGridRef = React.useRef<HTMLDivElement | null>(null);
  const splitSourceScrollRef = React.useRef<HTMLDivElement | null>(null);
  const splitSourceGridOuterRef = React.useRef<HTMLDivElement | null>(null);
  const splitSourceGridInnerRef = React.useRef<HTMLDivElement | null>(null);
  const splitSectionsScrollRef = React.useRef<HTMLDivElement | null>(null);

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

  const [resizingSecHeight, setResizingSecHeight] = React.useState<{
    id: string;
    height: number;
  } | null>(null);

  const [selectedSourceKeys, setSelectedSourceKeys] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [lastClickedSourcePos, setLastClickedSourcePos] = React.useState<number | null>(null);

  React.useEffect(() => {
    setSelectedSourceKeys(new Set());
    setLastClickedSourcePos(null);
  }, [files.length]);

  const {
    ratio: liveSplitRatio,
    isResizing: isResizingWidth,
    handlePointerDown: handleSplitWidthResize,
  } = useHorizontalRatioResize({
    value: splitLeftRatio,
    min: 0.24,
    max: 0.72,
    containerRef: splitGridRef,
    cssVar: "--split-left",
    onCommit: onChangeSplitLeftRatio,
  });

  const { height: liveSourceHeightPx, handlePointerDown: handleSourceHeightResize } =
    useVerticalResize({
      value: sourcePaneHeightPx,
      min: 240,
      max: 1100,
      onCommit: onChangeSourcePaneHeightPx,
    });

  const { height: liveSectionsHeightPx, handlePointerDown: handleSectionsHeightResize } =
    useVerticalResize({
      value: sectionsPaneHeightPx,
      min: 240,
      max: 1100,
      onCommit: onChangeSectionsPaneHeightPx,
    });

  const displayedRef = React.useRef(displayedSplitSourceItems);
  displayedRef.current = displayedSplitSourceItems;
  const splitSectionsRef = React.useRef(splitSections);
  splitSectionsRef.current = splitSections;
  const filesRef = React.useRef(files);
  filesRef.current = files;

  const sourceRowStridePx =
    splitCardSize === "large" ? 202 : splitCardSize === "medium" ? 154 : 106;

  const sourceGrid = useVirtualizedGrid({
    outerRef: splitSourceGridOuterRef,
    innerRef: splitSourceGridInnerRef,
    getScrollEl: () => splitSourceScrollRef.current,
    totalItems: displayedSplitSourceItems.length,
    cols: splitSourceCols,
    gapPx: 8,
    initialRowStridePx: sourceRowStridePx,
    overscanRows: 3,
    enabled: active && !isResizingWidth && displayedSplitSourceItems.length > 0,
    extraDeps: [liveSourceHeightPx, splitCardSize],
    onVisibleWindowChange: (startIdx, endExcl) => {
      if (!active) return;
      const keys: string[] = [];
      for (let i = startIdx; i < endExcl; i++) {
        const it = displayedRef.current[i];
        if (it) keys.push(sourceKey(it.fileIndex, it.pageIndex));
      }
      onEnqueueWindow(keys);
    },
  });

  // Outer virtualization for large Output PDF Sections lists (> 30 sections)
  const measuredSectionHeightsRef = React.useRef<Map<string, number>>(new Map());
  const sectionHeightsPxRef = React.useRef(sectionHeightsPx);
  sectionHeightsPxRef.current = sectionHeightsPx;
  const [sectionWindow, setSectionWindow] = React.useState<{
    start: number;
    end: number;
    topPad: number;
    bottomPad: number;
  }>({ start: 0, end: 30, topPad: 0, bottomPad: 0 });

  const recomputeSectionWindow = React.useCallback(() => {
    const secs = splitSectionsRef.current;
    if (secs.length <= 30) {
      setSectionWindow((prev) =>
        prev.start === 0 && prev.end === secs.length && prev.topPad === 0 && prev.bottomPad === 0
          ? prev
          : { start: 0, end: secs.length, topPad: 0, bottomPad: 0 },
      );
      return;
    }

    const scrollEl = splitSectionsScrollRef.current;
    const scrollTop = scrollEl ? scrollEl.scrollTop : 0;
    const viewportH = scrollEl && scrollEl.clientHeight > 0 ? scrollEl.clientHeight : 600;
    const overscanPx = 600;
    const minVisibleY = Math.max(0, scrollTop - overscanPx);
    const maxVisibleY = scrollTop + viewportH + overscanPx;
    const gapPx = 12;

    let accY = 0;
    let start = secs.length;
    let end = 0;
    let topPad = 0;
    let totalHeight = 0;

    for (let i = 0; i < secs.length; i++) {
      const sec = secs[i];
      const measured = measuredSectionHeightsRef.current.get(sec.id);
      const explicit = sectionHeightsPxRef.current[sec.id];
      const estH =
        measured ?? (explicit !== undefined ? explicit + 92 : sec.pages.length === 0 ? 150 : 280);
      const itemBottom = accY + estH;
      if (itemBottom >= minVisibleY && accY <= maxVisibleY) {
        if (i < start) {
          start = i;
          topPad = accY;
        }
        end = i + 1;
      }
      accY = itemBottom + (i < secs.length - 1 ? gapPx : 0);
      totalHeight = itemBottom;
    }

    if (start >= secs.length) {
      start = 0;
      end = Math.min(secs.length, 15);
      topPad = 0;
    }

    // Compute bottomPad from end..secs.length
    let renderedBottom = topPad;
    for (let i = start; i < end; i++) {
      const sec = secs[i];
      const measured = measuredSectionHeightsRef.current.get(sec.id);
      const explicit = sectionHeightsPxRef.current[sec.id];
      const estH =
        measured ?? (explicit !== undefined ? explicit + 92 : sec.pages.length === 0 ? 150 : 280);
      renderedBottom += estH + (i < end - 1 ? gapPx : 0);
    }
    const bottomPad = Math.max(0, totalHeight - renderedBottom);

    setSectionWindow((prev) =>
      prev.start === start &&
      prev.end === end &&
      Math.abs(prev.topPad - topPad) < 4 &&
      Math.abs(prev.bottomPad - bottomPad) < 4
        ? prev
        : { start, end, topPad, bottomPad },
    );
  }, []);

  React.useEffect(() => {
    recomputeSectionWindow();
  }, [splitSections.length, liveSectionsHeightPx, sectionHeightsPx, recomputeSectionWindow]);

  React.useEffect(() => {
    if (!active || splitSections.length <= 30) return;
    const scrollEl = splitSectionsScrollRef.current;
    if (!scrollEl) return;
    let rafId: number | null = null;
    const schedule = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        recomputeSectionWindow();
      });
    };
    scrollEl.addEventListener("scroll", schedule, { passive: true });
    return () => {
      scrollEl.removeEventListener("scroll", schedule);
      if (rafId !== null) window.cancelAnimationFrame(rafId);
    };
  }, [active, splitSections.length, recomputeSectionWindow]);

  const handleMeasureSectionHeight = React.useCallback(
    (sectionId: string, height: number) => {
      const prev = measuredSectionHeightsRef.current.get(sectionId);
      if (prev !== height) {
        measuredSectionHeightsRef.current.set(sectionId, height);
      }
    },
    [],
  );

  const displayedIndexByKey = React.useMemo(() => {
    const m = new Map<string, number>();
    displayedSplitSourceItems.forEach((it, idx) => {
      m.set(sourceKey(it.fileIndex, it.pageIndex), idx);
    });
    return m;
  }, [displayedSplitSourceItems]);

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
        if (next.has(key)) next.delete(key);
        else next.add(key);
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
      if (parsed) items.push({ file_index: parsed.fileIndex, page_index: parsed.pageIndex });
    });
    items.sort((a, b) =>
      a.file_index !== b.file_index ? a.file_index - b.file_index : a.page_index - b.page_index,
    );
    return items;
  }, [selectedSourceKeys]);

  const selectedSourceKeysRef = React.useRef(selectedSourceKeys);
  selectedSourceKeysRef.current = selectedSourceKeys;
  const sortedSelectedSourceItemsRef = React.useRef(sortedSelectedSourceItems);
  sortedSelectedSourceItemsRef.current = sortedSelectedSourceItems;
  const handleSourcePageClickRef = React.useRef(handleSourcePageClick);
  handleSourcePageClickRef.current = handleSourcePageClick;

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
      let latestY = e.clientY;
      let latest = startH;

      const scrollAncestor = bodyEl ? findScrollableAncestor(bodyEl) : null;
      const getScrollTop = () =>
        scrollAncestor
          ? scrollAncestor.scrollTop
          : window.scrollY || document.documentElement.scrollTop || 0;
      const startScrollTop = getScrollTop();

      const clamp = (val: number) => Math.min(720, Math.max(120, Math.round(val)));

      const updateHeight = () => {
        const scrollDelta = getScrollTop() - startScrollTop;
        latest = clamp(startH + (latestY - startY) + scrollDelta);
        setResizingSecHeight({ id: sectionId, height: latest });
      };

      const EDGE_PX = 36;
      const MAX_STEP = 14;
      let rafId: number | null = null;
      const autoScrollTick = () => {
        rafId = null;
        let dy = 0;
        const rect = scrollAncestor
          ? scrollAncestor.getBoundingClientRect()
          : ({ top: 0, bottom: window.innerHeight } as const);
        if (latestY > rect.bottom - EDGE_PX) {
          const ratio = Math.min(1, (latestY - (rect.bottom - EDGE_PX)) / EDGE_PX);
          dy = Math.ceil(4 + ratio * MAX_STEP);
        } else if (latestY < rect.top + EDGE_PX) {
          const ratio = Math.min(1, (rect.top + EDGE_PX - latestY) / EDGE_PX);
          dy = -Math.ceil(4 + ratio * MAX_STEP);
        }
        if (dy !== 0) {
          if (scrollAncestor) {
            const prev = scrollAncestor.scrollTop;
            scrollAncestor.scrollTop += dy;
            if (scrollAncestor.scrollTop !== prev) updateHeight();
          } else {
            const prev = window.scrollY || document.documentElement.scrollTop || 0;
            window.scrollBy(0, dy);
            const next = window.scrollY || document.documentElement.scrollTop || 0;
            if (next !== prev) updateHeight();
          }
          rafId = window.requestAnimationFrame(autoScrollTick);
        }
      };

      const onMove = (ev: PointerEvent) => {
        latestY = ev.clientY;
        updateHeight();
        const rect = scrollAncestor
          ? scrollAncestor.getBoundingClientRect()
          : ({ top: 0, bottom: window.innerHeight } as const);
        const nearEdge = latestY > rect.bottom - EDGE_PX || latestY < rect.top + EDGE_PX;
        if (nearEdge && rafId === null) {
          rafId = window.requestAnimationFrame(autoScrollTick);
        } else if (!nearEdge && rafId !== null) {
          window.cancelAnimationFrame(rafId);
          rafId = null;
        }
      };
      const finish = () => {
        if (rafId !== null) {
          window.cancelAnimationFrame(rafId);
          rafId = null;
        }
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
        setResizingSecHeight(null);
        onChangeSectionHeightPx(sectionId, latest);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
    },
    [sectionHeightsPx, onChangeSectionHeightPx],
  );

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
            ? { sectionId: nextHover, index: computeSectionInsert(secEl, latestX, latestY) }
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
          const payload = splitDragRef.current;
          splitDragRef.current = null;
          setHoverSectionId(null);
          setSplitInsertTarget(null);
          if (payload && secEl?.dataset.splitSectionId) {
            const targetSec = secEl.dataset.splitSectionId;
            const insertIdx = computeSectionInsert(secEl, ev.clientX, ev.clientY);
            onApplyDropOnSection(payload, targetSec, insertIdx);
          } else if (payload && splitInsertTargetRef.current) {
            onApplyDropOnSection(
              payload,
              splitInsertTargetRef.current.sectionId,
              splitInsertTargetRef.current.index,
            );
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
    [onApplyDropOnSection],
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
    [startSplitPointerDrag, t.pdfOps, thumbsRef],
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
    [startSplitPointerDrag, thumbsRef],
  );

  const handleDoubleClickSplitSource = React.useCallback(
    (fileIndex: number, pageIndex: number) => {
      onDoubleClickSplitPage(fileIndex, pageIndex, 0);
    },
    [onDoubleClickSplitPage],
  );

  const handleQuickAddSourcePage = React.useCallback(
    (fileIndex: number, pageIndex: number) => {
      onAppendSourceItems([{ file_index: fileIndex, page_index: pageIndex }]);
    },
    [onAppendSourceItems],
  );

  if (!active || files.length === 0) return null;

  const showFilePrefix = files.length > 1;
  const visibleSourceItems = displayedSplitSourceItems.slice(
    sourceGrid.startIdx,
    sourceGrid.endIdxExclusive,
  );

  return (
    <div className="space-y-4">
      <div className="knit-card flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-[220px] flex-1">
          <label className="block text-xs font-semibold uppercase text-[#6C757D]">
            {t.pdfOps.splitModeLabel}
          </label>
          <Select
            ariaLabel={t.pdfOps.splitModeLabel}
            value={splitRuleKind}
            disabled={isPopulatingSections}
            onChange={(val) => onChangeSplitRuleKind(val as typeof splitRuleKind)}
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
              disabled={isPopulatingSections}
              onChange={(e) => onChangeRangesStr(e.target.value)}
              placeholder="1-3, 5, 8-10"
              className="knit-control knit-input mt-1 w-full px-2.5 font-mono-code text-xs disabled:opacity-50"
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
              disabled={isPopulatingSections}
              onChange={onChangeEveryN}
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
              disabled={isPopulatingSections}
              onChange={onChangeSplitMaxMb}
              className="mt-1 w-full"
            />
          </div>
        )}

        {splitRuleKind !== "max_bytes" && (
          <button
            type="button"
            disabled={isPopulatingSections}
            onClick={onPopulateSectionsFromRule}
            className="knit-control knit-btn-secondary inline-flex items-center gap-1.5 px-3 text-sm disabled:opacity-60"
          >
            {isPopulatingSections ? (
              <Loader2 className="h-4 w-4 animate-spin text-[#007BFF]" />
            ) : (
              <Wand2 className="h-4 w-4 text-[#007BFF]" />
            )}
            {isPopulatingSections
              ? t.pdfOps.populatingSectionsBtn
              : t.pdfOps.generateSectionsBtn}
          </button>
        )}
      </div>

      <div
        ref={splitGridRef}
        style={
          {
            "--split-left": `${(liveSplitRatio * 100).toFixed(2)}%`,
          } as React.CSSProperties
        }
        className="grid grid-cols-1 items-start gap-3 lg:gap-2 lg:[grid-template-columns:var(--split-left)_12px_minmax(0,1fr)]"
      >
        {/* Source PDF Pages Strip */}
        <div className="knit-card flex min-w-0 flex-col overflow-hidden">
          <div className="space-y-2 border-b border-[#E9ECEF] p-3.5 pb-2.5">
            <div>
              <div className="text-base font-bold text-[#343A40]">
                {t.pdfOps.sourcePagesTitle(totalSplitSourcePages)}
              </div>
              <div className="text-sm text-[#6C757D]">{t.pdfOps.sourcePagesHint}</div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <GridColumnSelector
                label={t.pdfOps.gridColumnsLabel}
                options={PDF_GRID_COL_OPTIONS}
                value={splitSourceCols}
                onChange={onChangeSplitSourceCols}
                compact
              />
              <CardSizeSelector
                value={splitCardSize}
                onChange={onChangeSplitCardSize}
                compact
              />
            </div>

            {files.length > 1 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                <button
                  type="button"
                  onClick={() => onChangeSplitSourceFilterIdx("all")}
                  className={`rounded-[4px] border px-2 py-0.5 text-xs font-semibold ${
                    splitSourceFilterIdx === "all"
                      ? "border-[#007BFF] bg-[#007BFF] text-white"
                      : "border-[#CED4DA] bg-[#F8F9FA] text-[#343A40] hover:bg-[#E9ECEF]"
                  }`}
                >
                  {t.pdfOps.splitAllSourcesFilter} ({totalSplitSourcePages})
                </button>
                {files.map((f, fIdx) => {
                  const parts = f.path.split(/[\\/]/).filter(Boolean);
                  const fileName = parts[parts.length - 1] ?? `PDF ${fIdx + 1}`;
                  const shortName = fileName.replace(/\.pdf$/i, "");
                  const isDup =
                    files.filter(
                      (other) =>
                        (other.path.split(/[\\/]/).pop() ?? "").toLowerCase() ===
                        fileName.toLowerCase(),
                    ).length > 1;
                  const parentFolder = parts.length > 1 ? parts[parts.length - 2] : "";
                  const displayName =
                    isDup && parentFolder ? `${shortName} (${parentFolder})` : shortName;
                  return (
                    <button
                      key={`${f.path}-${fIdx}`}
                      type="button"
                      onClick={() => onChangeSplitSourceFilterIdx(fIdx)}
                      title={f.path}
                      className={`max-w-[220px] truncate rounded-[4px] border px-2 py-0.5 text-xs font-semibold ${
                        splitSourceFilterIdx === fIdx
                          ? "border-[#007BFF] bg-[#007BFF] text-white"
                          : "border-[#CED4DA] bg-[#F8F9FA] text-[#343A40] hover:bg-[#E9ECEF]"
                      }`}
                    >
                      {t.pdfOps.splitSourceFileFilter(fIdx + 1, displayName, f.page_count)}
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
                    disabled={isPopulatingSections}
                    onClick={() => onAppendSourceItems(sortedSelectedSourceItems)}
                    className="rounded-[4px] bg-[#007BFF] px-2.5 py-0.5 text-xs font-semibold text-white hover:bg-[#0069D9] disabled:opacity-50"
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

          <div
            ref={splitSourceScrollRef}
            style={{ height: `${liveSourceHeightPx}px` }}
            className={`overflow-y-auto p-3.5 ${isResizingWidth ? "pointer-events-none" : ""}`}
          >
            <div
              ref={splitSourceGridOuterRef}
              style={{
                paddingTop: sourceGrid.topPadPx > 0 ? `${sourceGrid.topPadPx}px` : undefined,
                paddingBottom:
                  sourceGrid.bottomPadPx > 0 ? `${sourceGrid.bottomPadPx}px` : undefined,
              }}
            >
              <div
                ref={splitSourceGridInnerRef}
                className="grid auto-rows-max gap-2 select-none"
                style={{ gridTemplateColumns: `repeat(${splitSourceCols}, minmax(0, 1fr))` }}
              >
                {visibleSourceItems.map((it) => {
                  const key = sourceKey(it.fileIndex, it.pageIndex);
                  return (
                    <SplitSourceCard
                      key={key}
                      fileIndex={it.fileIndex}
                      pageIndex={it.pageIndex}
                      showFilePrefix={showFilePrefix}
                      cardSize={splitCardSize}
                      thumbUrl={thumbs[key]}
                      isSelected={selectedSourceKeys.has(key)}
                      isDraggingAny={splitDragActive !== null}
                      quickAddTitle={t.pdfOps.quickAddToSectionTitle}
                      onRegisterRef={onRegisterThumbRef}
                      onPointerDownCard={handleSplitSourcePointerDown}
                      onDoubleClickCard={handleDoubleClickSplitSource}
                      onContextMenuCard={onContextMenuSourcePage}
                      onQuickAdd={handleQuickAddSourcePage}
                    />
                  );
                })}
              </div>
            </div>
          </div>

          <PaneResizeHandle
            orientation="horizontal"
            title={t.pdfOps.resizeHeightTitle}
            onPointerDown={handleSourceHeightResize}
          />
        </div>

        <PaneResizeHandle
          orientation="vertical"
          title={t.pdfOps.resizeWidthTitle}
          onPointerDown={handleSplitWidthResize}
        />

        {/* Output Sections Builder */}
        <div className="knit-card flex min-w-0 flex-col overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E9ECEF] px-3.5 py-2.5">
            <div>
              <span className="text-sm font-bold text-[#343A40]">
                {t.pdfOps.splitBuilderTitle}
              </span>
              <div className="text-xs text-[#6C757D]">{t.pdfOps.sectionItemDragHint}</div>
            </div>
            <button
              type="button"
              disabled={isPopulatingSections}
              onClick={onAddSection}
              className="knit-control-sm inline-flex items-center gap-1 rounded-[4px] border border-[#007BFF] bg-[#E7F1FF] px-3 text-xs font-semibold text-[#0056B3] hover:bg-[#007BFF] hover:text-white disabled:opacity-50"
            >
              {t.pdfOps.addSectionBtn}
            </button>
          </div>

          <div
            ref={splitSectionsScrollRef}
            style={{ height: `${liveSectionsHeightPx}px` }}
            className={`overflow-y-auto p-3.5 ${isResizingWidth ? "pointer-events-none" : ""}`}
          >
            <div
              style={{
                paddingTop:
                  splitSections.length > 30 && sectionWindow.topPad > 0
                    ? `${sectionWindow.topPad}px`
                    : undefined,
                paddingBottom:
                  splitSections.length > 30 && sectionWindow.bottomPad > 0
                    ? `${sectionWindow.bottomPad}px`
                    : undefined,
              }}
              className="space-y-3"
            >
              {(splitSections.length > 30
                ? splitSections.slice(sectionWindow.start, sectionWindow.end)
                : splitSections
              ).map((section, localIdx) => {
                const sIdx =
                  splitSections.length > 30 ? sectionWindow.start + localIdx : localIdx;
                const explicitSectionHeight =
                  resizingSecHeight?.id === section.id
                    ? resizingSecHeight.height
                    : sectionHeightsPx[section.id];
                const insertIdx =
                  splitInsertTarget?.sectionId === section.id ? splitInsertTarget.index : null;
                const dragSourceItemIdx =
                  splitDragActive?.sourceSecId === section.id &&
                  splitDragActive.sourceItemIdx !== undefined
                    ? splitDragActive.sourceItemIdx
                    : null;

                return (
                  <SplitSectionCard
                    key={section.id}
                    section={section}
                    sectionIndex={sIdx}
                    isActive={activeSectionId === section.id}
                    isHovered={hoverSectionId === section.id}
                    insertIdx={insertIdx}
                    dragSourceItemIdx={dragSourceItemIdx}
                    isDraggingAny={splitDragActive !== null}
                    isResizingWidth={isResizingWidth}
                    isLocked={isPopulatingSections}
                    cardSize={splitCardSize}
                    canDelete={splitSections.length > 1}
                    showFilePrefix={showFilePrefix}
                    explicitSectionHeight={explicitSectionHeight}
                    thumbs={thumbs}
                    onMeasureOuterHeight={handleMeasureSectionHeight}
                    onActivate={onSetActiveSectionId}
                    onRename={onRenameSection}
                    onClear={onClearSection}
                    onDelete={onDeleteSection}
                    onResizeHeight={handleSectionCardHeightResize}
                    onPointerDownItem={handleSplitSectionItemPointerDown}
                    onDoubleClickItem={onDoubleClickSplitPage}
                    onContextMenuItem={onContextMenuSectionItem}
                    onRotateItem={onRotateSectionItem}
                    onRemoveItem={onRemoveSectionItem}
                  />
                );
              })}
            </div>
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

          <PaneResizeHandle
            orientation="horizontal"
            title={t.pdfOps.resizeHeightTitle}
            onPointerDown={handleSectionsHeightResize}
          />
        </div>
      </div>
    </div>
  );
};
