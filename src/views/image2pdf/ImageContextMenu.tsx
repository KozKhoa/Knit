import React from "react";
import {
  BookmarkMinus,
  BookmarkPlus,
  CheckSquare,
  Copy,
  FolderOpen,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Trash2,
  ZoomIn,
} from "lucide-react";
import { useI18n } from "../../i18n";
import type { PageDraft } from "../../types/ipc";

interface ImageContextMenuProps {
  page: PageDraft | null;
  pageIndex: number;
  hasBookmark?: boolean;
  x: number;
  y: number;
  onClose: () => void;
  onRotateBy: (pageId: string, deltaDeg: number) => void;
  onDelete: (pageId: string) => void;
  onPreviewInfo: (pageId: string) => void;
  onCopyImagePath: (path: string) => void;
  onCopyFolderPath: (path: string) => void;
  onAttachBookmark: (page: PageDraft, pageIndex: number) => void;
  onRemoveBookmark?: (pageIndex: number) => void;
  onSelectPage: (pageId: string) => void;
}

export const ImageContextMenu: React.FC<ImageContextMenuProps> = ({
  page,
  pageIndex,
  hasBookmark = false,
  x,
  y,
  onClose,
  onRotateBy,
  onDelete,
  onPreviewInfo,
  onCopyImagePath,
  onCopyFolderPath,
  onAttachBookmark,
  onRemoveBookmark,
  onSelectPage,
}) => {
  const { t } = useI18n();
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = React.useState<{ left: number; top: number }>({ left: x, top: y });

  React.useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    const clampedLeft = Math.max(
      pad,
      Math.min(x, window.innerWidth - rect.width - pad),
    );
    const clampedTop = Math.max(
      pad,
      Math.min(y, window.innerHeight - rect.height - pad),
    );
    setPos({ left: clampedLeft, top: clampedTop });
  }, [x, y, page]);

  React.useEffect(() => {
    if (!page) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const handleScroll = () => onClose();

    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [page, onClose]);

  if (!page) return null;

  const itemClass =
    "flex w-full items-center gap-2 rounded-[4px] px-2.5 py-1.5 text-left text-xs font-medium text-[#212529] transition-colors hover:bg-[#E7F1FF] hover:text-[#0056B3]";

  return (
    <div
      ref={menuRef}
      role="menu"
      data-testid="image-context-menu"
      style={{ left: `${pos.left}px`, top: `${pos.top}px` }}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-50 min-w-[230px] rounded-[4px] border border-[#CED4DA] bg-white p-1.5 shadow-[0_2px_8px_rgba(0,0,0,0.08)]"
    >
      <div className="mb-1 border-b border-[#E9ECEF] px-2 py-1 text-[11px] font-semibold text-[#6C757D]">
        <span className="font-mono-code mr-1 text-[#343A40]">#{pageIndex + 1}</span>
        <span className="truncate">{page.label}</span>
      </div>

      <button
        type="button"
        role="menuitem"
        className={itemClass}
        onClick={() => {
          onRotateBy(page.id, 90);
          onClose();
        }}
      >
        <RotateCw className="h-3.5 w-3.5 shrink-0 text-[#007BFF]" />
        <span>{t.image2pdf.ctxRotateRight90}</span>
      </button>

      <button
        type="button"
        role="menuitem"
        className={itemClass}
        onClick={() => {
          onRotateBy(page.id, 180);
          onClose();
        }}
      >
        <RefreshCw className="h-3.5 w-3.5 shrink-0 text-[#007BFF]" />
        <span>{t.image2pdf.ctxRotate180}</span>
      </button>

      <button
        type="button"
        role="menuitem"
        className={itemClass}
        onClick={() => {
          onRotateBy(page.id, 270);
          onClose();
        }}
      >
        <RotateCcw className="h-3.5 w-3.5 shrink-0 text-[#007BFF]" />
        <span>{t.image2pdf.ctxRotateLeft90}</span>
      </button>

      <div className="my-1 border-t border-[#E9ECEF]" />

      <button
        type="button"
        role="menuitem"
        className={itemClass}
        onClick={() => {
          onPreviewInfo(page.id);
          onClose();
        }}
      >
        <ZoomIn className="h-3.5 w-3.5 shrink-0 text-[#17A2B8]" />
        <span>{t.image2pdf.ctxPreviewInfo}</span>
      </button>

      <button
        type="button"
        role="menuitem"
        className={itemClass}
        onClick={() => {
          onAttachBookmark(page, pageIndex);
          onClose();
        }}
      >
        <BookmarkPlus className="h-3.5 w-3.5 shrink-0 text-[#007BFF]" />
        <span>{t.image2pdf.ctxAttachBookmark}</span>
      </button>

      {hasBookmark && onRemoveBookmark && (
        <button
          type="button"
          role="menuitem"
          className={itemClass}
          onClick={() => {
            onRemoveBookmark(pageIndex);
            onClose();
          }}
        >
          <BookmarkMinus className="h-3.5 w-3.5 shrink-0 text-[#DC3545]" />
          <span>{t.image2pdf.ctxRemoveBookmark}</span>
        </button>
      )}

      <button
        type="button"
        role="menuitem"
        className={itemClass}
        onClick={() => {
          onSelectPage(page.id);
          onClose();
        }}
      >
        <CheckSquare className="h-3.5 w-3.5 shrink-0 text-[#007BFF]" />
        <span>{t.image2pdf.ctxSelectPage}</span>
      </button>

      <div className="my-1 border-t border-[#E9ECEF]" />

      <button
        type="button"
        role="menuitem"
        className={itemClass}
        onClick={() => {
          onCopyImagePath(page.source.path);
          onClose();
        }}
      >
        <Copy className="h-3.5 w-3.5 shrink-0 text-[#495057]" />
        <span>{t.image2pdf.ctxCopyImagePath}</span>
      </button>

      <button
        type="button"
        role="menuitem"
        className={itemClass}
        onClick={() => {
          onCopyFolderPath(page.source.path);
          onClose();
        }}
      >
        <FolderOpen className="h-3.5 w-3.5 shrink-0 text-[#495057]" />
        <span>{t.image2pdf.ctxCopyFolderPath}</span>
      </button>

      <div className="my-1 border-t border-[#E9ECEF]" />

      <button
        type="button"
        role="menuitem"
        className="flex w-full items-center gap-2 rounded-[4px] px-2.5 py-1.5 text-left text-xs font-medium text-[#DC3545] transition-colors hover:bg-[#F8D7DA]"
        onClick={() => {
          onDelete(page.id);
          onClose();
        }}
      >
        <Trash2 className="h-3.5 w-3.5 shrink-0" />
        <span>{t.image2pdf.ctxDelete}</span>
      </button>
    </div>
  );
};
