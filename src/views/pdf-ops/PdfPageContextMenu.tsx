import React from "react";
import {
  BookmarkMinus,
  BookmarkPlus,
  Copy,
  FileSearch,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Trash2,
  ZoomIn,
} from "lucide-react";
import { useI18n } from "../../i18n";

export type PdfContextMenuTarget =
  | {
      mode: "merge";
      idx: number;
      fileIndex: number;
      pageIndex: number;
      rotationDeg: number;
      filePath: string;
      hasBookmark?: boolean;
      x: number;
      y: number;
    }
  | {
      mode: "merge_file";
      fileIndex: number;
      fileOrderIdx: number;
      targetPageIdx: number;
      filePath: string;
      hasBookmark?: boolean;
      x: number;
      y: number;
    }
  | {
      mode: "split";
      fileIndex: number;
      pageIndex: number;
      rotationDeg: number;
      filePath: string;
      x: number;
      y: number;
    }
  | {
      mode: "split_item";
      sectionId: string;
      uid: string;
      fileIndex: number;
      pageIndex: number;
      rotationDeg: number;
      filePath: string;
      x: number;
      y: number;
    };

interface PdfPageContextMenuProps {
  target: PdfContextMenuTarget | null;
  onClose: () => void;
  onRotateBy?: (idx: number, deltaDeg: number) => void;
  onDelete?: (idx: number) => void;
  onRotateSplitItemBy?: (sectionId: string, uid: string, deltaDeg: number) => void;
  onDeleteSplitItem?: (sectionId: string, uid: string) => void;
  onAttachBookmark?: (idx: number, filePath: string, sourcePageIndex: number) => void;
  onRemoveBookmark?: (outputPageIndex: number) => void;
  onPreviewFile?: (fileIndex: number) => void;
  onZoom: (filePath: string, pageIndex: number, rotationDeg: number, outputIdx?: number) => void;
  onCopyPath: (filePath: string) => void;
}

export const PdfPageContextMenu: React.FC<PdfPageContextMenuProps> = ({
  target,
  onClose,
  onRotateBy,
  onDelete,
  onRotateSplitItemBy,
  onDeleteSplitItem,
  onAttachBookmark,
  onRemoveBookmark,
  onPreviewFile,
  onZoom,
  onCopyPath,
}) => {
  const { t } = useI18n();
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = React.useState<{ left: number; top: number }>({
    left: target?.x ?? 0,
    top: target?.y ?? 0,
  });

  React.useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el || !target) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    setPos({
      left: Math.max(pad, Math.min(target.x, window.innerWidth - rect.width - pad)),
      top: Math.max(pad, Math.min(target.y, window.innerHeight - rect.height - pad)),
    });
  }, [target]);

  React.useEffect(() => {
    if (!target) return;
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onScroll = () => onClose();

    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [target, onClose]);

  if (!target) return null;

  const fileName = target.filePath.split(/[\\/]/).pop() ?? target.filePath;
  const itemClass =
    "flex w-full items-center gap-2 rounded-[4px] px-2.5 py-1.5 text-left text-xs font-medium text-[#212529] transition-colors hover:bg-[#E7F1FF] hover:text-[#0056B3]";

  const canRotate =
    (target.mode === "merge" && Boolean(onRotateBy)) ||
    (target.mode === "split_item" && Boolean(onRotateSplitItemBy));
  const canDelete =
    (target.mode === "merge" && Boolean(onDelete)) ||
    (target.mode === "split_item" && Boolean(onDeleteSplitItem));

  const triggerRotate = (deltaDeg: number) => {
    if (target.mode === "merge" && onRotateBy) {
      onRotateBy(target.idx, deltaDeg);
    } else if (target.mode === "split_item" && onRotateSplitItemBy) {
      onRotateSplitItemBy(target.sectionId, target.uid, deltaDeg);
    }
    onClose();
  };

  const triggerDelete = () => {
    if (target.mode === "merge" && onDelete) {
      onDelete(target.idx);
    } else if (target.mode === "split_item" && onDeleteSplitItem) {
      onDeleteSplitItem(target.sectionId, target.uid);
    }
    onClose();
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      data-testid="pdf-context-menu"
      style={{ left: `${pos.left}px`, top: `${pos.top}px` }}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-50 min-w-[240px] max-w-[320px] rounded-[4px] border border-[#CED4DA] bg-white p-1.5 shadow-[0_2px_8px_rgba(0,0,0,0.08)]"
    >
      <div
        title={target.filePath}
        className="mb-1 border-b border-[#E9ECEF] px-2 py-1.5 text-[11px] text-[#495057]"
      >
        <div className="truncate font-semibold text-[#212529]">
          {target.mode === "merge_file"
            ? `${target.fileIndex + 1}. ${fileName}`
            : t.pdfOps.ctxSourceFileInfo(target.fileIndex + 1, fileName, target.pageIndex + 1)}
        </div>
        <div className="mt-0.5 flex items-center gap-2 font-mono-code text-[10px] text-[#6C757D]">
          {target.mode === "merge" && (
            <span>{t.pdfOps.ctxOutputPageInfo(target.idx + 1)}</span>
          )}
          {target.mode === "merge_file" && (
            <span>{t.pdfOps.ctxOutputPageInfo(target.targetPageIdx + 1)}</span>
          )}
          {target.mode !== "merge_file" && target.rotationDeg % 360 !== 0 && (
            <span>{target.rotationDeg}°</span>
          )}
        </div>
      </div>

      {canRotate && (
        <>
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => triggerRotate(90)}
          >
            <RotateCw className="h-3.5 w-3.5 shrink-0 text-[#007BFF]" />
            <span>{t.pdfOps.ctxRotateRight90}</span>
          </button>

          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => triggerRotate(180)}
          >
            <RefreshCw className="h-3.5 w-3.5 shrink-0 text-[#007BFF]" />
            <span>{t.pdfOps.ctxRotate180}</span>
          </button>

          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => triggerRotate(270)}
          >
            <RotateCcw className="h-3.5 w-3.5 shrink-0 text-[#007BFF]" />
            <span>{t.pdfOps.ctxRotateLeft90}</span>
          </button>

          <div className="my-1 border-t border-[#E9ECEF]" />
        </>
      )}

      {target.mode === "merge_file" ? (
        <button
          type="button"
          role="menuitem"
          className={itemClass}
          onClick={() => {
            onPreviewFile?.(target.fileIndex);
            onClose();
          }}
        >
          <FileSearch className="h-3.5 w-3.5 shrink-0 text-[#17A2B8]" />
          <span>{t.pdfOps.ctxPreviewPdfFile}</span>
        </button>
      ) : (
        <button
          type="button"
          role="menuitem"
          className={itemClass}
          onClick={() => {
            onZoom(
              target.filePath,
              target.pageIndex,
              target.rotationDeg,
              target.mode === "merge" ? target.idx : undefined,
            );
            onClose();
          }}
        >
          <ZoomIn className="h-3.5 w-3.5 shrink-0 text-[#17A2B8]" />
          <span>{t.pdfOps.ctxPreviewInfo}</span>
        </button>
      )}

      {(target.mode === "merge" || target.mode === "merge_file") && onAttachBookmark && (
        <button
          type="button"
          role="menuitem"
          className={itemClass}
          onClick={() => {
            if (target.mode === "merge") {
              onAttachBookmark(target.idx, target.filePath, target.pageIndex);
            } else {
              onAttachBookmark(target.targetPageIdx, target.filePath, 0);
            }
            onClose();
          }}
        >
          <BookmarkPlus className="h-3.5 w-3.5 shrink-0 text-[#007BFF]" />
          <span>{t.pdfOps.ctxAttachBookmark}</span>
        </button>
      )}

      {(target.mode === "merge" || target.mode === "merge_file") &&
        target.hasBookmark &&
        onRemoveBookmark && (
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => {
              onRemoveBookmark(
                target.mode === "merge" ? target.idx : target.targetPageIdx,
              );
              onClose();
            }}
          >
            <BookmarkMinus className="h-3.5 w-3.5 shrink-0 text-[#DC3545]" />
            <span>{t.pdfOps.ctxRemoveBookmark}</span>
          </button>
        )}

      <button
        type="button"
        role="menuitem"
        className={itemClass}
        onClick={() => {
          onCopyPath(target.filePath);
          onClose();
        }}
      >
        <Copy className="h-3.5 w-3.5 shrink-0 text-[#495057]" />
        <span>{t.pdfOps.ctxCopyPdfPath}</span>
      </button>

      {canDelete && (
        <>
          <div className="my-1 border-t border-[#E9ECEF]" />
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-[4px] px-2.5 py-1.5 text-left text-xs font-medium text-[#DC3545] transition-colors hover:bg-[#F8D7DA]"
            onClick={triggerDelete}
          >
            <Trash2 className="h-3.5 w-3.5 shrink-0" />
            <span>{t.pdfOps.ctxDeletePage}</span>
          </button>
        </>
      )}
    </div>
  );
};
