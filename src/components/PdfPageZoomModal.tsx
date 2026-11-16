import React from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Loader2, X } from "lucide-react";
import { useI18n } from "../i18n";
import { isTauriRuntime, renderPdfPagePreviewFile } from "../lib/ipc";

interface PdfPageZoomModalProps {
  pdfPath: string | null;
  pageIndex: number;
  rotationDeg?: number;
  title?: string;
  fallbackThumbSrc?: string;
  onClose: () => void;
}

export const PdfPageZoomModal: React.FC<PdfPageZoomModalProps> = ({
  pdfPath,
  pageIndex,
  rotationDeg = 0,
  title,
  fallbackThumbSrc,
  onClose,
}) => {
  const { t } = useI18n();
  const [hiResUrl, setHiResUrl] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!pdfPath) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pdfPath, onClose]);

  React.useEffect(() => {
    if (!pdfPath || !isTauriRuntime()) {
      setHiResUrl(null);
      return;
    }
    let cancelled = false;
    setHiResUrl(null);
    setLoading(true);
    void renderPdfPagePreviewFile(pdfPath, pageIndex, 1400)
      .then((filePath) => {
        if (!cancelled) {
          setHiResUrl(convertFileSrc(filePath));
        }
      })
      .catch(() => {
        if (!cancelled) setHiResUrl(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pdfPath, pageIndex]);

  if (!pdfPath) return null;

  const imgSrc = hiResUrl ?? fallbackThumbSrc ?? null;

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="flex h-[90vh] w-[92vw] max-w-[1280px] flex-col overflow-hidden rounded-[4px] border border-[#CED4DA] bg-white shadow-2xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-[#DEE2E6] bg-[#F8F9FA] px-4 py-2.5">
          <div className="min-w-0">
            <div className="truncate text-sm font-bold text-[#212529]">
              {title ?? t.pdfOps.zoomModalTitle(pageIndex + 1)}
            </div>
            <div className="font-mono-code truncate text-xs text-[#6C757D]">
              {pdfPath}
              {rotationDeg % 360 !== 0 ? ` · ${rotationDeg}°` : ""}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.common.close}
            className="rounded-[4px] p-1.5 text-[#6C757D] hover:bg-[#E9ECEF] hover:text-[#212529]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="relative flex flex-1 items-center justify-center overflow-auto bg-[#212529] p-4">
          {imgSrc ? (
            <img
              src={imgSrc}
              alt={t.pdfOps.zoomModalTitle(pageIndex + 1)}
              className="max-h-full max-w-full object-contain shadow-lg"
              style={
                rotationDeg % 360 !== 0
                  ? { transform: `rotate(${rotationDeg}deg)` }
                  : undefined
              }
            />
          ) : null}
          {loading && !hiResUrl && (
            <div className="absolute bottom-4 right-4 flex items-center gap-2 rounded-[4px] bg-[#343A40]/90 px-3 py-1.5 text-xs text-white">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>{t.pdfOps.zoomLoading}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
