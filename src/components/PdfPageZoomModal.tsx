import React from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { Loader2, X } from "lucide-react";
import { useI18n } from "../i18n";
import { formatBytes, isTauriRuntime, renderPdfPagePreviewFile } from "../lib/ipc";
import { ZoomPanViewport } from "./ZoomPanViewport";

interface PdfPageZoomModalProps {
  pdfPath: string | null;
  pageIndex: number;
  rotationDeg?: number;
  sourcePageCount?: number;
  fileSizeBytes?: number;
  outputPageIndex?: number;
  title?: string;
  imageDataUrl?: string | null;
  fallbackThumbSrc?: string;
  onClose: () => void;
}

export const PdfPageZoomModal: React.FC<PdfPageZoomModalProps> = ({
  pdfPath,
  pageIndex,
  rotationDeg = 0,
  sourcePageCount,
  fileSizeBytes,
  outputPageIndex,
  title,
  imageDataUrl,
  fallbackThumbSrc,
  onClose,
}) => {
  const { t } = useI18n();
  const [hiResUrl, setHiResUrl] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const isOpen = Boolean(pdfPath || imageDataUrl);

  React.useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  React.useEffect(() => {
    if (imageDataUrl || !pdfPath || !isTauriRuntime()) {
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
  }, [imageDataUrl, pdfPath, pageIndex]);

  if (!isOpen) return null;

  const imgSrc = imageDataUrl ?? hiResUrl ?? fallbackThumbSrc ?? null;
  const fileName = pdfPath ? (pdfPath.split(/[\\/]/).pop() ?? pdfPath) : "";

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
          <div className="min-w-0 flex-1 pr-3">
            <div className="truncate text-sm font-bold text-[#212529]">
              {title ??
                (fileName
                  ? `${fileName} — ${t.pdfOps.zoomModalTitle(pageIndex + 1)}`
                  : t.pdfOps.zoomModalTitle(pageIndex + 1))}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[#6C757D]">
              {sourcePageCount !== undefined && (
                <span>
                  {t.pdfOps.zoomSourcePagesLabel}{" "}
                  <span className="font-mono-code font-semibold text-[#212529]">
                    {pageIndex + 1} / {sourcePageCount}
                  </span>
                </span>
              )}
              {outputPageIndex !== undefined && (
                <span>
                  {t.pdfOps.zoomOutputPosLabel}{" "}
                  <span className="font-mono-code font-semibold text-[#212529]">
                    #{outputPageIndex + 1}
                  </span>
                </span>
              )}
              {fileSizeBytes !== undefined && fileSizeBytes > 0 && (
                <span>
                  {t.pdfOps.zoomFileSizeLabel}{" "}
                  <span className="font-mono-code font-semibold text-[#212529]">
                    {formatBytes(fileSizeBytes)}
                  </span>
                </span>
              )}
              {rotationDeg % 360 !== 0 && (
                <span className="font-mono-code font-semibold text-[#007BFF]">
                  {rotationDeg}°
                </span>
              )}
            </div>
            {pdfPath && (
              <div
                title={pdfPath}
                className="font-mono-code mt-0.5 truncate text-[11px] text-[#495057]"
              >
                {pdfPath}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.common.close}
            className="shrink-0 rounded-[4px] p-1.5 text-[#6C757D] hover:bg-[#E9ECEF] hover:text-[#212529]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <ZoomPanViewport resetKey={`${pdfPath ?? "doc"}-${pageIndex}-${rotationDeg}`}>
          {imgSrc ? (
            <img
              src={imgSrc}
              alt={t.pdfOps.zoomModalTitle(pageIndex + 1)}
              draggable={false}
              className="pointer-events-none max-h-full max-w-full object-contain shadow-lg"
              style={
                rotationDeg % 360 !== 0
                  ? { transform: `rotate(${rotationDeg}deg)` }
                  : undefined
              }
            />
          ) : null}
          {loading && !hiResUrl && !imageDataUrl && (
            <div className="absolute bottom-4 right-4 z-20 flex items-center gap-2 rounded-[4px] bg-[#343A40]/90 px-3 py-1.5 text-xs text-white">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>{t.pdfOps.zoomLoading}</span>
            </div>
          )}
        </ZoomPanViewport>
      </div>
    </div>
  );
};
