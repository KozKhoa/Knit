import React from "react";
import { Eraser, Trash2 } from "lucide-react";
import { PaneResizeHandle } from "../../components/PaneResizeHandle";
import { SplitSectionItemCard } from "../../components/PdfPageCards";
import { useVirtualizedGrid } from "../../hooks/useVirtualizedGrid";
import { useI18n } from "../../i18n";
import type { CardSizePreset } from "../../lib/imageGrid";
import { sourceKey, type SplitSectionDraft } from "./pdfOpsTypes";

interface SplitSectionCardProps {
  section: SplitSectionDraft;
  sectionIndex: number;
  isActive: boolean;
  isHovered: boolean;
  insertIdx: number | null;
  dragSourceItemIdx: number | null;
  isDraggingAny: boolean;
  isResizingWidth?: boolean;
  isLocked?: boolean;
  cardSize?: CardSizePreset;
  canDelete: boolean;
  showFilePrefix: boolean;
  explicitSectionHeight: number | undefined;
  thumbs: Record<string, string>;
  onMeasureOuterHeight?: (sectionId: string, height: number) => void;
  onActivate: (sectionId: string) => void;
  onRename: (sectionId: string, name: string) => void;
  onClear: (sectionId: string) => void;
  onDelete: (sectionId: string) => void;
  onResizeHeight: (e: React.PointerEvent<HTMLElement>, sectionId: string) => void;
  onPointerDownItem: (
    e: React.PointerEvent<HTMLDivElement>,
    sectionId: string,
    itemIndex: number,
  ) => void;
  onDoubleClickItem: (
    fileIndex: number,
    pageIndex: number,
    rotationDeg: number,
  ) => void;
  onContextMenuItem?: (
    e: React.MouseEvent<HTMLDivElement>,
    sectionId: string,
    uid: string,
    fileIndex: number,
    pageIndex: number,
    rotationDeg: number,
  ) => void;
  onRotateItem: (sectionId: string, uid: string) => void;
  onRemoveItem: (sectionId: string, uid: string) => void;
}

const VIRTUALIZE_THRESHOLD = 40;

export const SplitSectionCard: React.FC<SplitSectionCardProps> = React.memo(
  ({
    section,
    sectionIndex,
    isActive,
    isHovered,
    insertIdx,
    dragSourceItemIdx,
    isDraggingAny,
    isResizingWidth = false,
    isLocked = false,
    cardSize = "small",
    canDelete,
    showFilePrefix,
    explicitSectionHeight,
    thumbs,
    onMeasureOuterHeight,
    onActivate,
    onRename,
    onClear,
    onDelete,
    onResizeHeight,
    onPointerDownItem,
    onDoubleClickItem,
    onContextMenuItem,
    onRotateItem,
    onRemoveItem,
  }) => {
    const { t } = useI18n();
    const cardOuterRef = React.useRef<HTMLDivElement | null>(null);
    const scrollRef = React.useRef<HTMLDivElement | null>(null);
    const outerRef = React.useRef<HTMLDivElement | null>(null);
    const innerRef = React.useRef<HTMLDivElement | null>(null);
    const [cols, setCols] = React.useState(5);

    const shouldVirtualize = section.pages.length > VIRTUALIZE_THRESHOLD;

    React.useLayoutEffect(() => {
      if (!onMeasureOuterHeight || isResizingWidth) return;
      const el = cardOuterRef.current;
      if (!el) return;
      const h = el.offsetHeight;
      if (h > 0) onMeasureOuterHeight(section.id, h);
    }, [section.id, section.pages.length, explicitSectionHeight, isResizingWidth, onMeasureOuterHeight]);

    React.useEffect(() => {
      if (!shouldVirtualize || isResizingWidth) return;
      const el = innerRef.current;
      if (!el) return;
      const updateCols = () => {
        const raw = window.getComputedStyle(el).gridTemplateColumns.trim();
        const count = raw ? Math.max(1, raw.split(/\s+/).length) : 5;
        setCols((prev) => (prev === count ? prev : count));
      };
      updateCols();
      const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateCols) : null;
      ro?.observe(el);
      return () => ro?.disconnect();
    }, [shouldVirtualize, isResizingWidth]);

    const initialRowStridePx = cardSize === "large" ? 210 : cardSize === "medium" ? 162 : 114;

    const grid = useVirtualizedGrid({
      outerRef,
      innerRef,
      getScrollEl: () => scrollRef.current,
      totalItems: section.pages.length,
      cols,
      gapPx: 8,
      initialRowStridePx,
      overscanRows: 3,
      enabled: shouldVirtualize && !isResizingWidth,
      extraDeps: [explicitSectionHeight, cardSize],
    });

    const startIdx = shouldVirtualize ? grid.startIdx : 0;
    const endIdxExcl = shouldVirtualize ? grid.endIdxExclusive : section.pages.length;
    const visiblePages = shouldVirtualize
      ? section.pages.slice(startIdx, endIdxExcl)
      : section.pages;

    const isSelfNoOp =
      dragSourceItemIdx !== null &&
      insertIdx !== null &&
      (insertIdx === dragSourceItemIdx || insertIdx === dragSourceItemIdx + 1);

    return (
      <div
        ref={cardOuterRef}
        data-split-section-id={section.id}
        onClick={() => onActivate(section.id)}
        style={{
          contentVisibility: "auto",
          containIntrinsicSize: "auto 180px",
        }}
        className={`overflow-hidden rounded-[4px] border bg-white transition-colors ${
          isHovered
            ? "border-dashed border-[#007BFF] bg-[#E7F1FF]/40 ring-2 ring-[#007BFF]/30"
            : isActive
              ? "border-[#007BFF] ring-1 ring-[#007BFF]/40"
              : "border-[#DEE2E6]"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E9ECEF] p-3 pb-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] bg-[#343A40] font-mono-code text-xs font-bold text-white">
              {sectionIndex + 1}
            </span>
            <input
              type="text"
              value={section.name}
              onChange={(e) => onRename(section.id, e.target.value)}
              disabled={isLocked}
              placeholder={t.pdfOps.sectionNamePlaceholder}
              className="knit-control-sm knit-input min-w-0 flex-1 px-2.5 font-mono-code text-xs disabled:opacity-50"
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
                onClear(section.id);
              }}
              disabled={isLocked || section.pages.length === 0}
              title={t.pdfOps.clearSectionTitle}
              className="knit-control-sm inline-flex items-center rounded-[4px] border border-[#CED4DA] px-2 text-xs text-[#6C757D] hover:bg-[#F8F9FA] disabled:opacity-30"
            >
              <Eraser className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(section.id);
              }}
              disabled={isLocked || !canDelete}
              title={t.pdfOps.deleteSectionTitle}
              className="knit-control-sm inline-flex items-center rounded-[4px] border border-[#F5C6CB] px-2 text-xs text-[#DC3545] hover:bg-[#F8D7DA] disabled:opacity-30"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div
          ref={scrollRef}
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
              ref={outerRef}
              style={{
                paddingTop: shouldVirtualize && grid.topPadPx > 0 ? `${grid.topPadPx}px` : undefined,
                paddingBottom:
                  shouldVirtualize && grid.bottomPadPx > 0 ? `${grid.bottomPadPx}px` : undefined,
              }}
            >
              <div
                ref={innerRef}
                data-split-section-grid={section.id}
                className="grid auto-rows-max grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5"
              >
                {visiblePages.map((item, localIdx) => {
                  const itemIdx = startIdx + localIdx;
                  const showBarLeft = !isSelfNoOp && insertIdx === itemIdx;
                  const showBarEnd =
                    !isSelfNoOp &&
                    itemIdx === section.pages.length - 1 &&
                    insertIdx === section.pages.length;
                  const isDragged = dragSourceItemIdx === itemIdx;

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
                      cardSize={cardSize}
                      thumbUrl={thumbs[sourceKey(item.file_index, item.page_index)]}
                      isDragged={isDragged}
                      isDraggingAny={isDraggingAny}
                      showBarLeft={showBarLeft}
                      showBarEnd={showBarEnd}
                      rotateTitle={t.image2pdf.rotateTitle}
                      deleteTitle={t.image2pdf.deletePageTitle}
                      onPointerDownItem={onPointerDownItem}
                      onDoubleClickItem={onDoubleClickItem}
                      onContextMenuItem={onContextMenuItem}
                      onRotateItem={onRotateItem}
                      onRemoveItem={onRemoveItem}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <PaneResizeHandle
          orientation="horizontal"
          title={t.pdfOps.resizeSectionHeightTitle}
          onPointerDown={(e) => onResizeHeight(e, section.id)}
        />
      </div>
    );
  },
);
