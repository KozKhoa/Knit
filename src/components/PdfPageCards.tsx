import React from "react";
import { Check, GripVertical, Plus, RotateCw, Trash2 } from "lucide-react";

interface MergePageCardProps {
  idx: number;
  fileIndex: number;
  pageIndex: number;
  rotationDeg: number;
  thumbUrl: string | undefined;
  isDragged: boolean;
  isDraggingAny: boolean;
  showBarLeft: boolean;
  showBarEnd: boolean;
  metaText: string;
  rotateTitle: string;
  deleteTitle: string;
  onRegisterRef: (key: string, el: HTMLDivElement | null) => void;
  onPointerDownCard: (e: React.PointerEvent<HTMLDivElement>, idx: number) => void;
  onDoubleClickCard: (idx: number) => void;
  onRotate: (idx: number) => void;
  onRemove: (idx: number) => void;
}

export const MergePageCard: React.FC<MergePageCardProps> = React.memo(
  ({
    idx,
    fileIndex,
    pageIndex,
    rotationDeg,
    thumbUrl,
    isDragged,
    isDraggingAny,
    showBarLeft,
    showBarEnd,
    metaText,
    rotateTitle,
    deleteTitle,
    onRegisterRef,
    onPointerDownCard,
    onDoubleClickCard,
    onRotate,
    onRemove,
  }) => {
    const thumbKey = `${fileIndex}:${pageIndex}`;
    const isQuarterRotated = Math.abs(rotationDeg % 180) === 90;

    const cardRefCb = React.useCallback(
      (el: HTMLDivElement | null) => {
        onRegisterRef(thumbKey, el);
      },
      [thumbKey, onRegisterRef],
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
        onDoubleClickCard(idx);
      },
      [onDoubleClickCard, idx],
    );

    return (
      <div
        data-pdf-thumb-key={thumbKey}
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
          className={`flex select-none flex-col overflow-hidden rounded-[4px] border bg-white ${
            isDraggingAny ? "cursor-grabbing" : "cursor-grab"
          } ${
            isDragged
              ? "border-[#007BFF] opacity-40 ring-2 ring-[#007BFF]"
              : "border-[#DEE2E6] hover:border-[#007BFF]"
          }`}
        >
          <div className="relative flex h-32 shrink-0 items-center justify-center overflow-hidden bg-[#F1F3F5] p-1">
            {thumbUrl ? (
              <img
                src={thumbUrl}
                alt={`File ${fileIndex + 1} P${pageIndex + 1}`}
                loading="lazy"
                decoding="async"
                draggable={false}
                className={`pointer-events-none object-contain ${
                  isQuarterRotated
                    ? "max-h-[108px] max-w-[108px]"
                    : "max-h-full max-w-full"
                }`}
                style={
                  rotationDeg % 360 !== 0
                    ? { transform: `rotate(${rotationDeg}deg)` }
                    : undefined
                }
              />
            ) : (
              <span className="font-mono-code text-xs text-[#6C757D]">
                F{fileIndex + 1}·P{pageIndex + 1}
              </span>
            )}
            <span className="absolute left-1 top-1 flex items-center gap-0.5 rounded-[4px] bg-[#343A40] px-1.5 py-0.5 font-mono-code text-[11px] text-white">
              <GripVertical className="h-3 w-3 text-[#ADB5BD]" />#{idx + 1}
            </span>
          </div>
          <div className="border-t border-[#DEE2E6] p-2">
            <div className="font-mono-code text-xs text-[#6C757D]">{metaText}</div>
            <div className="mt-1.5 flex items-center justify-between">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRotate(idx);
                }}
                onDoubleClick={(e) => e.stopPropagation()}
                title={rotateTitle}
                className="rounded-[4px] border border-[#DEE2E6] p-1 text-[#495057] hover:bg-[#F8F9FA]"
              >
                <RotateCw className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(idx);
                }}
                onDoubleClick={(e) => e.stopPropagation()}
                title={deleteTitle}
                className="rounded-[4px] p-1 text-[#DC3545] hover:bg-[#F8D7DA]"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  },
);

interface SplitSourceCardProps {
  fileIndex: number;
  pageIndex: number;
  showFilePrefix: boolean;
  thumbUrl: string | undefined;
  isSelected: boolean;
  isDraggingAny: boolean;
  onRegisterRef: (key: string, el: HTMLDivElement | null) => void;
  onPointerDownCard: (
    e: React.PointerEvent<HTMLDivElement>,
    fileIndex: number,
    pageIndex: number,
  ) => void;
  onDoubleClickCard: (fileIndex: number, pageIndex: number) => void;
  onQuickAdd: (fileIndex: number, pageIndex: number) => void;
}

export const SplitSourceCard: React.FC<SplitSourceCardProps> = React.memo(
  ({
    fileIndex,
    pageIndex,
    showFilePrefix,
    thumbUrl,
    isSelected,
    isDraggingAny,
    onRegisterRef,
    onPointerDownCard,
    onDoubleClickCard,
    onQuickAdd,
  }) => {
    const thumbKey = `${fileIndex}:${pageIndex}`;
    const label = showFilePrefix
      ? `F${fileIndex + 1}·P${pageIndex + 1}`
      : `${pageIndex + 1}`;
    const placeholderLabel = showFilePrefix
      ? `F${fileIndex + 1}·P${pageIndex + 1}`
      : `P${pageIndex + 1}`;

    const cardRefCb = React.useCallback(
      (el: HTMLDivElement | null) => {
        onRegisterRef(thumbKey, el);
      },
      [thumbKey, onRegisterRef],
    );

    const handlePointerDown = React.useCallback(
      (e: React.PointerEvent<HTMLDivElement>) => {
        onPointerDownCard(e, fileIndex, pageIndex);
      },
      [onPointerDownCard, fileIndex, pageIndex],
    );

    const handleDoubleClick = React.useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        e.stopPropagation();
        if ((e.target as HTMLElement).closest("button")) return;
        onDoubleClickCard(fileIndex, pageIndex);
      },
      [onDoubleClickCard, fileIndex, pageIndex],
    );

    return (
      <div
        data-pdf-thumb-key={thumbKey}
        ref={cardRefCb}
        onPointerDown={handlePointerDown}
        onDoubleClick={handleDoubleClick}
        className={`group flex select-none flex-col overflow-hidden rounded-[4px] border ${
          isDraggingAny ? "cursor-grabbing" : "cursor-grab"
        } ${
          isSelected
            ? "border-[#007BFF] bg-[#E7F1FF] ring-2 ring-[#007BFF]/40"
            : "border-[#DEE2E6] bg-[#F8F9FA] hover:border-[#007BFF]"
        }`}
      >
        <div className="relative flex h-24 shrink-0 items-center justify-center overflow-hidden bg-white p-1">
          {thumbUrl ? (
            <img
              src={thumbUrl}
              alt={placeholderLabel}
              loading="lazy"
              decoding="async"
              draggable={false}
              className="pointer-events-none max-h-full max-w-full object-contain"
            />
          ) : (
            <span className="font-mono-code text-sm text-[#6C757D]">
              {placeholderLabel}
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
            {label}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onQuickAdd(fileIndex, pageIndex);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            title="Add to active section"
            className="absolute bottom-1 right-1 flex h-6 w-6 items-center justify-center rounded-[4px] bg-[#007BFF] text-white opacity-90 hover:opacity-100"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  },
);

interface SplitSectionItemCardProps {
  sectionId: string;
  itemIndex: number;
  uid: string;
  fileIndex: number;
  pageIndex: number;
  showFilePrefix: boolean;
  rotationDeg: number;
  thumbUrl: string | undefined;
  isDragged: boolean;
  isDraggingAny: boolean;
  showBarLeft: boolean;
  showBarEnd: boolean;
  rotateTitle: string;
  deleteTitle: string;
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
  onRotateItem: (sectionId: string, uid: string) => void;
  onRemoveItem: (sectionId: string, uid: string) => void;
}

export const SplitSectionItemCard: React.FC<SplitSectionItemCardProps> = React.memo(
  ({
    sectionId,
    itemIndex,
    uid,
    fileIndex,
    pageIndex,
    showFilePrefix,
    rotationDeg,
    thumbUrl,
    isDragged,
    isDraggingAny,
    showBarLeft,
    showBarEnd,
    rotateTitle,
    deleteTitle,
    onPointerDownItem,
    onDoubleClickItem,
    onRotateItem,
    onRemoveItem,
  }) => {
    const badgeLabel = showFilePrefix
      ? `F${fileIndex + 1}·P${pageIndex + 1}`
      : `P${pageIndex + 1}`;
    const isQuarterRotated = Math.abs(rotationDeg % 180) === 90;

    const handlePointerDown = React.useCallback(
      (e: React.PointerEvent<HTMLDivElement>) => {
        onPointerDownItem(e, sectionId, itemIndex);
      },
      [onPointerDownItem, sectionId, itemIndex],
    );

    const handleDoubleClick = React.useCallback(
      (e: React.MouseEvent<HTMLDivElement>) => {
        e.stopPropagation();
        if ((e.target as HTMLElement).closest("button")) return;
        onDoubleClickItem(fileIndex, pageIndex, rotationDeg);
      },
      [onDoubleClickItem, fileIndex, pageIndex, rotationDeg],
    );

    return (
      <div
        data-split-item-sec={sectionId}
        data-split-item-idx={itemIndex}
        onPointerDown={handlePointerDown}
        onDoubleClick={handleDoubleClick}
        className="relative"
      >
        {showBarLeft && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -left-[6px] bottom-0 top-0 z-30 w-1.5 rounded-full bg-[#007BFF] shadow-[0_0_8px_rgba(0,123,255,0.75)]"
          />
        )}
        {showBarEnd && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-[6px] bottom-0 top-0 z-30 w-1.5 rounded-full bg-[#007BFF] shadow-[0_0_8px_rgba(0,123,255,0.75)]"
          />
        )}
        <div
          className={`flex select-none flex-col overflow-hidden rounded-[4px] border bg-[#F8F9FA] ${
            isDraggingAny ? "cursor-grabbing" : "cursor-grab"
          } ${
            isDragged
              ? "border-[#007BFF] opacity-40 ring-2 ring-[#007BFF]"
              : "border-[#DEE2E6] hover:border-[#007BFF]"
          }`}
        >
          <div className="relative flex h-20 shrink-0 items-center justify-center overflow-hidden bg-white p-1">
            {thumbUrl ? (
              <img
                src={thumbUrl}
                alt={badgeLabel}
                loading="lazy"
                decoding="async"
                draggable={false}
                className={`pointer-events-none object-contain ${
                  isQuarterRotated
                    ? "max-h-[68px] max-w-[68px]"
                    : "max-h-full max-w-full"
                }`}
                style={
                  rotationDeg % 360 !== 0
                    ? { transform: `rotate(${rotationDeg}deg)` }
                    : undefined
                }
              />
            ) : (
              <span className="font-mono-code text-xs text-[#6C757D]">
                {badgeLabel}
              </span>
            )}
            <span className="absolute left-1 top-1 rounded-[4px] bg-[#007BFF] px-1 py-0.5 font-mono-code text-[10px] text-white">
              {badgeLabel}
            </span>
          </div>
          <div className="flex items-center justify-between border-t border-[#DEE2E6] px-1.5 py-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRotateItem(sectionId, uid);
              }}
              onDoubleClick={(e) => e.stopPropagation()}
              title={rotateTitle}
              className="rounded-[4px] p-0.5 text-[#495057] hover:bg-[#E9ECEF]"
            >
              <RotateCw className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemoveItem(sectionId, uid);
              }}
              onDoubleClick={(e) => e.stopPropagation()}
              title={deleteTitle}
              className="rounded-[4px] p-0.5 text-[#DC3545] hover:bg-[#F8D7DA]"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>
    );
  },
);
