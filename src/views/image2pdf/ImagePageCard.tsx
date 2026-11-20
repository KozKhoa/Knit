import React from "react";
import { AlertTriangle, Check, Edit3, GripVertical, Layers, RotateCw, Trash2 } from "lucide-react";
import { BookmarkPageBadge } from "../../components/BookmarkPageBadge";
import type { CardSizePreset } from "../../lib/imageGrid";
import { hasPageEdits, pageEditSignature } from "../../lib/imageSort";
import type { PageDraft } from "../../types/ipc";

interface ImagePageCardProps {
  page: PageDraft;
  idx: number;
  cardSize?: CardSizePreset;
  thumbUrl: string | undefined;
  thumbBakedSig: string | undefined;
  thumbBakedRot: number;
  loadThumbs: boolean;
  selectionMode?: boolean;
  isSelected?: boolean;
  isMissing?: boolean;
  missingBadgeLabel?: string;
  bookmarkTitles?: string[];
  bookmarkTooltip?: string;
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
  onContextMenuCard?: (e: React.MouseEvent<HTMLDivElement>, pageId: string, idx: number) => void;
  onRotate: (id: string) => void;
  onEdit: (id: string) => void;
  onRemove: (id: string) => void;
}

export const ImagePageCard: React.FC<ImagePageCardProps> = React.memo(
  ({
    page,
    idx,
    cardSize = "small",
    thumbUrl,
    thumbBakedSig,
    thumbBakedRot,
    loadThumbs,
    selectionMode = false,
    isSelected = false,
    isMissing = false,
    missingBadgeLabel,
    bookmarkTitles,
    bookmarkTooltip,
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
    onContextMenuCard,
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
        if ((e.target as HTMLElement).closest("button")) return;
        onDoubleClickCard(e, page.id);
      },
      [onDoubleClickCard, page.id],
    );

    const handleContextMenu = React.useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        if (!onContextMenuCard) return;
        e.preventDefault();
        e.stopPropagation();
        onContextMenuCard(e, page.id, idx);
      },
      [onContextMenuCard, page.id, idx],
    );

    return (
      <div
        data-page-id={page.id}
        ref={cardRefCb}
        onPointerDown={handlePointerDown}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
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
          className={`flex flex-col overflow-hidden rounded-[4px] border bg-white transition-colors ${
            selectionMode
              ? "cursor-pointer"
              : isDraggingAny
                ? "cursor-grabbing"
                : "cursor-grab"
          } ${
            isMissing
              ? "border-[#FFC107] bg-[#FFF8E1]/50 ring-1 ring-[#FFC107]"
              : isSelected
                ? "border-[#007BFF] ring-2 ring-[#007BFF]"
                : "border-[#DEE2E6] hover:border-[#007BFF]"
          } ${isDragged ? "opacity-40 ring-2 ring-[#007BFF]" : "opacity-100"}`}
        >
          {loadThumbs && (
            <div
              className={`relative flex items-center justify-center overflow-hidden p-2 ${
                cardSize === "large" ? "h-72" : cardSize === "medium" ? "h-52" : "h-36"
              } ${
                isSelected ? "bg-[#EDF6FF]" : "bg-[#F1F3F5]"
              }`}
            >
              {thumbUrl ? (
                <img
                  src={thumbUrl}
                  alt={page.label}
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  className={`pointer-events-none object-contain ${
                    isQuarterRotated
                      ? cardSize === "large"
                        ? "max-h-[248px] max-w-[248px]"
                        : cardSize === "medium"
                          ? "max-h-[168px] max-w-[168px]"
                          : "max-h-[112px] max-w-[112px]"
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
              <div className="absolute right-1.5 top-1.5 flex items-center gap-1">
                {isMissing && missingBadgeLabel && (
                  <span
                    data-testid={`missing-image-badge-${page.id}`}
                    className="inline-flex items-center gap-1 rounded-[4px] border border-[#FFC107] bg-[#FFF3CD] px-1.5 py-0.5 text-[11px] font-semibold text-[#856404]"
                  >
                    <AlertTriangle className="h-3 w-3 shrink-0 text-[#D39E00]" />
                    {missingBadgeLabel}
                  </span>
                )}
                {hasEdits && (
                  <span className="rounded-[4px] bg-[#17A2B8] px-1.5 py-0.5 text-[11px] font-semibold text-white">
                    {editedBadgeLabel}
                  </span>
                )}
                {selectionMode && (
                  <span
                    className={`flex h-5 w-5 items-center justify-center rounded-[4px] border ${
                      isSelected
                        ? "border-[#007BFF] bg-[#007BFF] text-white"
                        : "border-[#ADB5BD] bg-white/95 text-transparent"
                    }`}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </span>
                )}
              </div>
              <BookmarkPageBadge
                titles={bookmarkTitles}
                tooltipText={bookmarkTooltip}
                className="pointer-events-none absolute bottom-1.5 left-1.5"
              />
            </div>
          )}
          <div className="border-t border-[#DEE2E6] p-2">
            {!loadThumbs && (
              <div className="mb-1 flex flex-wrap items-center justify-between gap-1">
                <div className="flex flex-wrap items-center gap-1">
                  <span className="rounded-[4px] bg-[#343A40] px-1.5 py-0.5 font-mono-code text-[10px] text-white">
                    #{idx + 1}
                  </span>
                  {isMissing && missingBadgeLabel && (
                    <span
                      data-testid={`missing-image-badge-${page.id}`}
                      className="inline-flex items-center gap-1 rounded-[4px] border border-[#FFC107] bg-[#FFF3CD] px-1.5 py-0.5 text-[10px] font-semibold text-[#856404]"
                    >
                      <AlertTriangle className="h-3 w-3 shrink-0 text-[#D39E00]" />
                      {missingBadgeLabel}
                    </span>
                  )}
                  <BookmarkPageBadge titles={bookmarkTitles} tooltipText={bookmarkTooltip} />
                </div>
                {selectionMode && (
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded-[4px] border ${
                      isSelected
                        ? "border-[#007BFF] bg-[#007BFF] text-white"
                        : "border-[#ADB5BD] bg-white text-transparent"
                    }`}
                  >
                    <Check className="h-3 w-3" />
                  </span>
                )}
              </div>
            )}
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
                onClick={(e) => {
                  e.stopPropagation();
                  onRotate(page.id);
                }}
                onDoubleClick={(e) => e.stopPropagation()}
                className="rounded-[4px] border border-[#DEE2E6] p-1 text-[#495057] hover:bg-[#F8F9FA]"
                title={rotateTitle}
              >
                <RotateCw className="h-3.5 w-3.5" />
              </button>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={!loadThumbs}
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(page.id);
                  }}
                  onDoubleClick={(e) => e.stopPropagation()}
                  className="rounded-[4px] border border-[#007BFF] px-2 py-0.5 text-xs font-semibold text-[#007BFF] hover:bg-[#007BFF] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                  title={editBtnTitle}
                >
                  <Edit3 className="mr-0.5 inline h-3 w-3" />
                  {editBtnLabel}
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(page.id);
                  }}
                  onDoubleClick={(e) => e.stopPropagation()}
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
