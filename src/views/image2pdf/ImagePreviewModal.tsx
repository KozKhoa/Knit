import React from "react";
import { Edit3, Layers, X } from "lucide-react";
import { ZoomPanViewport } from "../../components/ZoomPanViewport";
import { useI18n } from "../../i18n";
import { hasPageEdits, pageEditSignature } from "../../lib/imageSort";
import { formatBytes } from "../../lib/ipc";
import type { PageDraft } from "../../types/ipc";

interface ImagePreviewModalProps {
  page: PageDraft | null;
  loadThumbs: boolean;
  editedPreviewCache: Record<string, string>;
  resolveFullResSrc: (page: PageDraft | null) => string;
  onClose: () => void;
  onOpenEditor: (pageId: string) => void;
}

export const ImagePreviewModal: React.FC<ImagePreviewModalProps> = ({
  page,
  loadThumbs,
  editedPreviewCache,
  resolveFullResSrc,
  onClose,
  onOpenEditor,
}) => {
  const { t } = useI18n();

  React.useEffect(() => {
    if (!page) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [page, onClose]);

  if (!page) return null;

  const edited = hasPageEdits(page);
  const sig = edited ? pageEditSignature(page) : "";
  const bakedSrc = edited ? editedPreviewCache[`${page.id}:${sig}`] : undefined;
  const fallbackSrc = resolveFullResSrc(page);

  const editParts: string[] = [];
  if (page.rotation_deg % 360 !== 0) editParts.push(`${page.rotation_deg}°`);
  if (page.crop) editParts.push(t.image2pdf.infoEditsCropped);
  if (page.annotations.texts.length > 0 || page.annotations.strokes.length > 0) {
    editParts.push(
      t.image2pdf.infoEditsAnnotations(
        page.annotations.texts.length,
        page.annotations.strokes.length,
      ),
    );
  }
  const editsSummary = editParts.length > 0 ? editParts.join(" · ") : t.image2pdf.infoEditsNone;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="flex h-[92vh] w-[94vw] max-w-[1400px] flex-col overflow-hidden rounded-[4px] border border-[#CED4DA] bg-white shadow-2xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[#DEE2E6] bg-[#F8F9FA] px-4 py-2.5">
          <div className="min-w-0 flex-1 pr-3">
            <div className="truncate text-sm font-bold text-[#212529]">{page.label}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[#6C757D]">
              <span>
                {t.image2pdf.infoDimsLabel}{" "}
                <span className="font-mono-code font-semibold text-[#212529]">
                  {page.width_px}×{page.height_px}
                </span>
              </span>
              {page.file_size_bytes && page.file_size_bytes > 0 ? (
                <span>
                  {t.image2pdf.infoSizeLabel}{" "}
                  <span className="font-mono-code font-semibold text-[#212529]">
                    {formatBytes(page.file_size_bytes)}
                  </span>
                </span>
              ) : null}
              <span>
                {t.image2pdf.infoEditsLabel}{" "}
                <span className="font-medium text-[#212529]">{editsSummary}</span>
              </span>
            </div>
            <div
              title={page.source.path}
              className="mt-0.5 truncate font-mono-code text-[11px] text-[#495057]"
            >
              {t.image2pdf.infoPathLabel} {page.source.path}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              disabled={!loadThumbs}
              onClick={() => onOpenEditor(page.id)}
              className="knit-btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Edit3 className="h-3.5 w-3.5" />
              {t.image2pdf.editBtn}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label={t.common.close}
              className="rounded-[4px] p-1.5 text-[#6C757D] hover:bg-[#E9ECEF] hover:text-[#212529]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <ZoomPanViewport resetKey={page.id}>
          {bakedSrc ? (
            <img
              src={bakedSrc}
              alt={page.label}
              draggable={false}
              className="pointer-events-none max-h-full max-w-full object-contain shadow-lg"
            />
          ) : fallbackSrc ? (
            <img
              src={fallbackSrc}
              alt={page.label}
              draggable={false}
              className="pointer-events-none max-h-full max-w-full object-contain shadow-lg"
              style={edited ? { transform: `rotate(${page.rotation_deg}deg)` } : undefined}
            />
          ) : (
            <Layers className="h-10 w-10 text-[#6C757D]" />
          )}
        </ZoomPanViewport>
      </div>
    </div>
  );
};
