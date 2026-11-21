import React from "react";
import { FileText, Search, X } from "lucide-react";
import { useI18n } from "../i18n";
import { formatBytes, isTauriRuntime, readPdfFileBytes } from "../lib/ipc";
import type { PdfInfo } from "../types/ipc";
import { DocumentFindBar } from "./DocumentFindBar";
import { PdfJsPreview, type PdfJsPreviewHandle } from "./PdfJsPreview";

interface PdfFilePreviewModalProps {
  pdfInfo: PdfInfo | null;
  onClose: () => void;
}

export const PdfFilePreviewModal: React.FC<PdfFilePreviewModalProps> = ({
  pdfInfo,
  onClose,
}) => {
  const { t } = useI18n();
  const [pdfBytes, setPdfBytes] = React.useState<Uint8Array | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [totalPages, setTotalPages] = React.useState(0);
  const [findOpen, setFindOpen] = React.useState(false);
  const [findQuery, setFindQuery] = React.useState("");
  const [findIdx, setFindIdx] = React.useState(0);
  const [matchCount, setMatchCount] = React.useState(0);
  const previewRef = React.useRef<PdfJsPreviewHandle | null>(null);
  const findInputRef = React.useRef<HTMLInputElement | null>(null);

  const openFind = React.useCallback(() => {
    setFindOpen(true);
    window.requestAnimationFrame(() => {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    });
  }, []);

  React.useEffect(() => {
    if (!pdfInfo) {
      setPdfBytes(null);
      setError(null);
      setFindOpen(false);
      setFindQuery("");
      return;
    }

    if (!isTauriRuntime()) {
      setPdfBytes(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setPdfBytes(null);
    void readPdfFileBytes(pdfInfo.path)
      .then((bytes) => {
        if (!cancelled) setPdfBytes(bytes);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [pdfInfo]);

  React.useEffect(() => {
    if (!pdfInfo) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        e.stopPropagation();
        openFind();
      } else if (e.key === "Escape") {
        if (findOpen) {
          e.stopPropagation();
          setFindOpen(false);
          setFindQuery("");
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [pdfInfo, findOpen, openFind, onClose]);

  const activeMatchIdx =
    findOpen && findQuery.trim() && matchCount > 0
      ? ((findIdx % matchCount) + matchCount) % matchCount
      : null;

  React.useEffect(() => {
    if (activeMatchIdx !== null) {
      previewRef.current?.scrollToMatch(activeMatchIdx);
    }
  }, [activeMatchIdx]);

  if (!pdfInfo) return null;

  const fileName = pdfInfo.path.split(/[\\/]/).pop() ?? pdfInfo.path;

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
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#DEE2E6] bg-[#F8F9FA] px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 shrink-0 text-[#007BFF]" />
              <span className="truncate text-sm font-bold text-[#212529]">{fileName}</span>
              <span className="rounded-[4px] bg-[#E9ECEF] px-2 py-0.5 font-mono-code text-xs font-semibold text-[#495057]">
                {totalPages > 0 ? totalPages : pdfInfo.page_count} p.
              </span>
              {pdfInfo.file_size_bytes > 0 && (
                <span className="font-mono-code text-xs text-[#6C757D]">
                  {formatBytes(pdfInfo.file_size_bytes)}
                </span>
              )}
            </div>
            <div
              title={pdfInfo.path}
              className="font-mono-code mt-0.5 truncate text-[11px] text-[#495057]"
            >
              {pdfInfo.path}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={openFind}
              title="Ctrl+F"
              className="knit-control-sm inline-flex items-center gap-1 rounded-[4px] border border-[#CED4DA] bg-white px-2.5 text-xs font-semibold text-[#343A40] hover:bg-[#E9ECEF]"
            >
              <Search className="h-3.5 w-3.5 text-[#007BFF]" />
              <span>Ctrl+F</span>
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

        <DocumentFindBar
          open={findOpen}
          query={findQuery}
          activeMatchIndex={activeMatchIdx}
          matchCount={matchCount}
          placeholder={t.docs2pdf.findPreviewPlaceholder}
          prevTitle={t.docs2pdf.findPrevTitle}
          nextTitle={t.docs2pdf.findNextTitle}
          closeAriaLabel={t.common.close}
          counterColorClass="text-[#856404]"
          inputRef={findInputRef}
          onQueryChange={(val) => {
            setFindQuery(val);
            setFindIdx(0);
          }}
          onPrev={() => setFindIdx((i) => i - 1)}
          onNext={() => setFindIdx((i) => i + 1)}
          onClose={() => {
            setFindOpen(false);
            setFindQuery("");
          }}
        />

        <div className="min-h-0 flex-1">
          <PdfJsPreview
            ref={previewRef}
            pdfBytes={pdfBytes}
            loading={loading}
            error={error}
            emptyText={t.docs2pdf.previewEmpty}
            loadingText={t.docs2pdf.previewRendering}
            onPageCountChange={setTotalPages}
            searchQuery={findOpen ? findQuery : ""}
            activeMatchIndex={activeMatchIdx}
            onSearchMatchCountChange={setMatchCount}
            copyTextLabel={t.docs2pdf.copyText}
            onOpenFind={openFind}
          />
        </div>
      </div>
    </div>
  );
};
