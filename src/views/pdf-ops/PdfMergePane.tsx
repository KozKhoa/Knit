import React from "react";
import { GripVertical, PanelRightClose, PanelRightOpen } from "lucide-react";
import { BookmarkTreeEditor } from "../../components/BookmarkTreeEditor";
import { CardSizeSelector } from "../../components/CardSizeSelector";
import { GridColumnSelector } from "../../components/GridColumnSelector";
import { PaneResizeHandle } from "../../components/PaneResizeHandle";
import { MergeFileCard, MergePageCard } from "../../components/PdfPageCards";
import { useHorizontalRatioResize } from "../../hooks/useHorizontalRatioResize";
import { useVirtualizedGrid } from "../../hooks/useVirtualizedGrid";
import { useI18n } from "../../i18n";
import { buildPageBookmarkMap } from "../../lib/bookmarks";
import { hitTestGridInsertIndex, type CardSizePreset } from "../../lib/imageGrid";
import { formatBytes } from "../../lib/ipc";
import { usePersistentState } from "../../lib/storage";
import type { BookmarkNode, PageSelection, PdfInfo } from "../../types/ipc";
import { PDF_GRID_COL_OPTIONS, sourceKey, type PdfMergeMode } from "./pdfOpsTypes";

interface PdfMergePaneProps {
  active: boolean;
  files: PdfInfo[];
  selections: PageSelection[];
  mergeMode: PdfMergeMode;
  mergeFileOrder: number[];
  mergeBookmarks: BookmarkNode[];
  preserveBookmarks: boolean;
  showMergeBookmarks: boolean;
  bookmarksDisabled?: boolean;
  mergeGridCols: number;
  mergeCardSize: CardSizePreset;
  thumbs: Record<string, string>;
  onChangeMergeMode: (mode: PdfMergeMode) => void;
  onTogglePreserveBookmarks: (checked: boolean) => void;
  onChangeMergeGridCols: (cols: number) => void;
  onChangeMergeCardSize: (size: CardSizePreset) => void;
  onToggleShowBookmarks: () => void;
  onChangeBookmarks: (next: BookmarkNode[]) => void;
  onReorderSelection: (fromIdx: number, toIdx: number) => void;
  onReorderFileOrder: (fromOrderIdx: number, toOrderIdx: number) => void;
  onRotatePage: (idx: number) => void;
  onRemovePage: (idx: number) => void;
  onRemoveFile: (fileIndex: number) => void;
  onDoubleClickPage: (idx: number) => void;
  onDoubleClickFile: (fileIndex: number) => void;
  onContextMenuPage: (e: React.MouseEvent<HTMLDivElement>, idx: number) => void;
  onContextMenuFile: (e: React.MouseEvent<HTMLDivElement>, fileIndex: number) => void;
  onAttachBookmarkAtPage?: (idx: number) => void;
  onAttachBookmarkAtFile?: (orderIdx: number) => void;
  onRegisterThumbRef: (key: string, el: HTMLDivElement | null) => void;
  onEnqueueWindow: (keys: string[]) => void;
}

export const PdfMergePane: React.FC<PdfMergePaneProps> = ({
  active,
  files,
  selections,
  mergeMode,
  mergeFileOrder,
  mergeBookmarks,
  preserveBookmarks,
  showMergeBookmarks,
  bookmarksDisabled = false,
  mergeGridCols,
  mergeCardSize,
  thumbs,
  onChangeMergeMode,
  onTogglePreserveBookmarks,
  onChangeMergeGridCols,
  onChangeMergeCardSize,
  onToggleShowBookmarks,
  onChangeBookmarks,
  onReorderSelection,
  onReorderFileOrder,
  onRotatePage,
  onRemovePage,
  onRemoveFile,
  onDoubleClickPage,
  onDoubleClickFile,
  onContextMenuPage,
  onContextMenuFile,
  onAttachBookmarkAtPage,
  onAttachBookmarkAtFile,
  onRegisterThumbRef,
  onEnqueueWindow,
}) => {
  const { t } = useI18n();
  const [mergeLeftRatio, setMergeLeftRatio] = usePersistentState<number>(
    "knit.pdfops.mergeLeftRatio",
    0.66,
  );
  const mergeSplitContainerRef = React.useRef<HTMLDivElement | null>(null);
  const {
    ratio: liveMergeLeftRatio,
    isResizing: isResizingWidth,
    handlePointerDown: handleMergeWidthResize,
  } = useHorizontalRatioResize({
    value: mergeLeftRatio,
    min: 0.35,
    max: 0.82,
    containerRef: mergeSplitContainerRef,
    cssVar: "--merge-left",
    onCommit: setMergeLeftRatio,
  });

  const [mergeDragIdx, setMergeDragIdx] = React.useState<number | null>(null);
  const [mergeInsertAt, setMergeInsertAt] = React.useState<number | null>(null);
  const mergeInsertAtRef = React.useRef<number | null>(null);
  mergeInsertAtRef.current = mergeInsertAt;

  const mergeGridOuterRef = React.useRef<HTMLDivElement | null>(null);
  const mergeGridInnerRef = React.useRef<HTMLDivElement | null>(null);
  const mergeDragGhostRef = React.useRef<HTMLDivElement | null>(null);
  const initialGhostPosRef = React.useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const selectionsRef = React.useRef(selections);
  selectionsRef.current = selections;
  const mergeFileOrderRef = React.useRef(mergeFileOrder);
  mergeFileOrderRef.current = mergeFileOrder;
  const mergeModeRef = React.useRef(mergeMode);
  mergeModeRef.current = mergeMode;

  const isPerFile = mergeMode === "per_file";
  const totalGridItems = isPerFile ? mergeFileOrder.length : selections.length;

  const pageBookmarkMap = React.useMemo(
    () => (preserveBookmarks ? buildPageBookmarkMap(mergeBookmarks) : new Map<number, string[]>()),
    [preserveBookmarks, mergeBookmarks],
  );

  const mergeRowStridePx =
    mergeCardSize === "large" ? 344 : mergeCardSize === "medium" ? 280 : 216;

  const grid = useVirtualizedGrid({
    outerRef: mergeGridOuterRef,
    innerRef: mergeGridInnerRef,
    getScrollEl: () => mergeGridOuterRef.current?.closest("main") as HTMLElement | null,
    totalItems: totalGridItems,
    cols: mergeGridCols,
    gapPx: 12,
    initialRowStridePx: mergeRowStridePx,
    overscanRows: 3,
    enabled: active && !isResizingWidth && totalGridItems > 0,
    extraDeps: [mergeCardSize, mergeMode],
    onVisibleWindowChange: (startIdx, endExcl) => {
      if (!active) return;
      const keys: string[] = [];
      if (mergeModeRef.current === "per_file") {
        for (let i = startIdx; i < endExcl; i++) {
          const fIdx = mergeFileOrderRef.current[i];
          if (fIdx !== undefined) keys.push(sourceKey(fIdx, 0));
        }
      } else {
        for (let i = startIdx; i < endExcl; i++) {
          const sel = selectionsRef.current[i];
          if (sel) keys.push(sourceKey(sel.file_index, sel.page_index));
        }
      }
      onEnqueueWindow(keys);
    },
  });

  const handleCardPointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>, idx: number) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest("button")) return;

      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        if (mergeModeRef.current === "per_file") {
          onAttachBookmarkAtFile?.(idx);
        } else {
          onAttachBookmarkAtPage?.(idx);
        }
        return;
      }

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
        const itemTotal =
          mergeModeRef.current === "per_file"
            ? mergeFileOrderRef.current.length
            : selectionsRef.current.length;
        return hitTestGridInsertIndex({
          gridLeft: rect.left,
          gridTop: rect.top,
          gridWidth: rect.width,
          gridCols: grid.colsRef.current,
          gapPx: 12,
          rowStride: grid.rowStrideRef.current,
          totalItems: itemTotal,
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
          initialGhostPosRef.current = { x: latestX + 14, y: latestY + 14 };
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
            if (mergeModeRef.current === "per_file") {
              onReorderFileOrder(idx, targetIdx);
            } else {
              onReorderSelection(idx, targetIdx);
            }
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
    [
      grid.colsRef,
      grid.rowStrideRef,
      onAttachBookmarkAtFile,
      onAttachBookmarkAtPage,
      onReorderFileOrder,
      onReorderSelection,
    ],
  );

  if (!active || (isPerFile ? mergeFileOrder.length === 0 : selections.length === 0)) return null;

  const visibleSelections = isPerFile ? [] : selections.slice(grid.startIdx, grid.endIdxExclusive);
  const visibleFileOrder = isPerFile ? mergeFileOrder.slice(grid.startIdx, grid.endIdxExclusive) : [];
  const isDraggingAny = mergeDragIdx !== null;
  const isNoOpInsert =
    mergeDragIdx !== null &&
    mergeInsertAt !== null &&
    (mergeInsertAt === mergeDragIdx || mergeInsertAt === mergeDragIdx + 1);
  const draggedSel = !isPerFile && mergeDragIdx !== null ? selections[mergeDragIdx] : undefined;
  const draggedFileIdx =
    isPerFile && mergeDragIdx !== null ? mergeFileOrder[mergeDragIdx] : undefined;
  const draggedThumbUrl = isPerFile
    ? draggedFileIdx !== undefined
      ? thumbs[sourceKey(draggedFileIdx, 0)]
      : undefined
    : draggedSel
      ? thumbs[sourceKey(draggedSel.file_index, draggedSel.page_index)]
      : undefined;

  return (
    <div className="space-y-3">
      <div className="knit-card px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 text-xs">
              <span className="font-semibold text-[#495057]">{t.pdfOps.mergeModeLabel}</span>
              <div className="inline-flex rounded-[4px] border border-[#CED4DA] bg-[#F8F9FA] p-0.5">
                <button
                  type="button"
                  onClick={() => onChangeMergeMode("per_page")}
                  className={`rounded-[3px] px-2.5 py-1 text-xs font-semibold transition-colors ${
                    mergeMode === "per_page"
                      ? "bg-[#007BFF] text-white"
                      : "text-[#495057] hover:text-[#212529]"
                  }`}
                >
                  {t.pdfOps.mergeModePerPage}
                </button>
                <button
                  type="button"
                  onClick={() => onChangeMergeMode("per_file")}
                  className={`rounded-[3px] px-2.5 py-1 text-xs font-semibold transition-colors ${
                    mergeMode === "per_file"
                      ? "bg-[#007BFF] text-white"
                      : "text-[#495057] hover:text-[#212529]"
                  }`}
                >
                  {t.pdfOps.mergeModePerFile}
                </button>
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm font-semibold text-[#212529]">
              <input
                type="checkbox"
                checked={preserveBookmarks}
                onChange={(e) => onTogglePreserveBookmarks(e.target.checked)}
              />
              {t.pdfOps.preserveBookmarks}
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <CardSizeSelector value={mergeCardSize} onChange={onChangeMergeCardSize} />
            <GridColumnSelector
              label={t.pdfOps.gridColumnsLabel}
              options={PDF_GRID_COL_OPTIONS}
              value={mergeGridCols}
              onChange={onChangeMergeGridCols}
            />

            {preserveBookmarks && (
              <button
                type="button"
                onClick={onToggleShowBookmarks}
                className="knit-control-sm knit-btn-secondary inline-flex items-center gap-1.5 px-2.5 text-xs"
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
        ref={mergeSplitContainerRef}
        style={
          preserveBookmarks && showMergeBookmarks
            ? ({ "--merge-left": `${(liveMergeLeftRatio * 100).toFixed(2)}%` } as React.CSSProperties)
            : undefined
        }
        className={
          preserveBookmarks && showMergeBookmarks
            ? "grid grid-cols-1 items-start gap-4 lg:gap-2 lg:[grid-template-columns:var(--merge-left)_12px_minmax(0,1fr)]"
            : "grid grid-cols-1 gap-4"
        }
      >
        <div className="min-w-0 space-y-2">
          <div className="knit-card flex items-center gap-2 px-3.5 py-2 text-xs text-[#6C757D]">
            <GripVertical className="h-4 w-4 text-[#007BFF]" />
            <span>{isPerFile ? t.pdfOps.mergePerFileHint : t.pdfOps.mergeDragHint}</span>
          </div>

          <div
            ref={mergeGridOuterRef}
            style={{
              paddingTop: grid.topPadPx > 0 ? `${grid.topPadPx}px` : undefined,
              paddingBottom: grid.bottomPadPx > 0 ? `${grid.bottomPadPx}px` : undefined,
            }}
          >
            <div
              ref={mergeGridInnerRef}
              className="grid auto-rows-max gap-3 select-none"
              style={{ gridTemplateColumns: `repeat(${mergeGridCols}, minmax(0, 1fr))` }}
            >
              {isPerFile
                ? visibleFileOrder.map((fileIndex, localIdx) => {
                    const orderIdx = grid.startIdx + localIdx;
                    const info = files[fileIndex];
                    if (!info) return null;
                    const parts = info.path.split(/[\\/]/).filter(Boolean);
                    const baseName = parts[parts.length - 1] ?? `PDF ${fileIndex + 1}`;
                    const shortName = baseName.replace(/\.pdf$/i, "");
                    const isDup =
                      files.filter(
                        (other) =>
                          (other.path.split(/[\\/]/).pop() ?? "").toLowerCase() ===
                          baseName.toLowerCase(),
                      ).length > 1;
                    const parentFolder = parts.length > 1 ? parts[parts.length - 2] : "";
                    const displayName =
                      isDup && parentFolder ? `${shortName} (${parentFolder})` : baseName;
                    const showBarLeft = !isNoOpInsert && mergeInsertAt === orderIdx;
                    const showBarEnd =
                      !isNoOpInsert &&
                      orderIdx === mergeFileOrder.length - 1 &&
                      mergeInsertAt === mergeFileOrder.length;
                    return (
                      <MergeFileCard
                        key={`${info.path}-${fileIndex}`}
                        orderIdx={orderIdx}
                        fileIndex={fileIndex}
                        displayName={displayName}
                        fullPath={info.path}
                        metaText={t.pdfOps.mergeFileCardMeta(
                          info.page_count,
                          formatBytes(info.file_size_bytes),
                        )}
                        cardSize={mergeCardSize}
                        thumbUrl={thumbs[sourceKey(fileIndex, 0)]}
                        isDragged={mergeDragIdx === orderIdx}
                        isDraggingAny={isDraggingAny}
                        showBarLeft={showBarLeft}
                        showBarEnd={showBarEnd}
                        deleteTitle={t.pdfOps.removeFileBtnTitle}
                        onRegisterRef={onRegisterThumbRef}
                        onPointerDownCard={handleCardPointerDown}
                        onDoubleClickCard={onDoubleClickFile}
                        onContextMenuCard={onContextMenuFile}
                        onRemove={onRemoveFile}
                      />
                    );
                  })
                : visibleSelections.map((sel, localIdx) => {
                    const idx = grid.startIdx + localIdx;
                    const key = sourceKey(sel.file_index, sel.page_index);
                    const pageBookmarks = pageBookmarkMap.get(idx);
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
                        cardSize={mergeCardSize}
                        thumbUrl={thumbs[key]}
                        bookmarkTitles={pageBookmarks}
                        bookmarkTooltip={
                          pageBookmarks ? t.image2pdf.bookmarkBadgeTitle(pageBookmarks) : undefined
                        }
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
                        onRegisterRef={onRegisterThumbRef}
                        onPointerDownCard={handleCardPointerDown}
                        onDoubleClickCard={onDoubleClickPage}
                        onContextMenuCard={onContextMenuPage}
                        onRotate={onRotatePage}
                        onRemove={onRemovePage}
                      />
                    );
                  })}
            </div>

            {mergeDragIdx !== null && (draggedSel || draggedFileIdx !== undefined) && (
              <div
                ref={mergeDragGhostRef}
                aria-hidden="true"
                style={{
                  transform: `translate3d(${initialGhostPosRef.current.x}px, ${initialGhostPosRef.current.y}px, 0)`,
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
                        draggedSel && draggedSel.rotation_deg % 360 !== 0
                          ? { transform: `rotate(${draggedSel.rotation_deg}deg)` }
                          : undefined
                      }
                    />
                  ) : (
                    <span className="font-mono-code text-xs text-[#6C757D]">
                      {draggedSel
                        ? `F${draggedSel.file_index + 1}·P${draggedSel.page_index + 1}`
                        : `F${(draggedFileIdx ?? 0) + 1}`}
                    </span>
                  )}
                  <span className="absolute left-1 top-1 rounded-[4px] bg-[#007BFF] px-1.5 py-0.5 font-mono-code text-[11px] font-bold text-white">
                    #{mergeDragIdx + 1}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {preserveBookmarks && showMergeBookmarks && (
          <>
            <PaneResizeHandle
              orientation="vertical"
              title={t.pdfOps.resizeWidthTitle}
              ariaLabel={t.pdfOps.resizeWidthTitle}
              onPointerDown={handleMergeWidthResize}
            />
            <div className="min-w-0 lg:sticky lg:top-0 lg:self-start">
              <BookmarkTreeEditor
                nodes={mergeBookmarks}
                totalPages={selections.length}
                disabled={bookmarksDisabled}
                enableGlobalUndoShortcut={true}
                onChange={onChangeBookmarks}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
};
