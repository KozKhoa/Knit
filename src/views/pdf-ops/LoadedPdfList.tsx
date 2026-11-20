import React from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import { useI18n } from "../../i18n";
import { formatBytes } from "../../lib/ipc";
import type { PdfInfo } from "../../types/ipc";

interface LoadedPdfListProps {
  files: PdfInfo[];
  highlighted: boolean;
  onRequestClearAll: () => void;
  onRequestRemoveFile: (idx: number) => void;
}

export const LoadedPdfList: React.FC<LoadedPdfListProps> = ({
  files,
  highlighted,
  onRequestClearAll,
  onRequestRemoveFile,
}) => {
  const { t } = useI18n();

  const duplicateNames = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of files) {
      const name = (f.path.split(/[\\/]/).pop() ?? f.path).toLowerCase();
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    const dups = new Set<string>();
    for (const [name, c] of counts.entries()) {
      if (c > 1) dups.add(name);
    }
    return dups;
  }, [files]);

  if (files.length === 0) return null;

  return (
    <div
      className={`space-y-2 rounded-[4px] border p-3.5 transition-colors duration-300 ${
        highlighted
          ? "border-[#28A745] bg-[#D4EDDA]/45"
          : "border-[#DEE2E6] bg-white"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-[#343A40]">
          {t.pdfOps.loadedDocs(files.length)}
        </span>
        <button
          type="button"
          onClick={onRequestClearAll}
          className="text-xs font-semibold text-[#DC3545] hover:underline"
        >
          {t.common.clearAll}
        </button>
      </div>
      {files.map((f, idx) => {
        const baseName = f.path.split(/[\\/]/).pop() ?? f.path;
        const isDuplicate = duplicateNames.has(baseName.toLowerCase());

        return (
          <div
            key={`${f.path}-${idx}`}
            className={`flex items-center justify-between gap-2 rounded-[4px] border px-3 py-2 text-xs transition-colors duration-300 ${
              highlighted
                ? "border-[#A3CFBB] bg-[#E9F7EF]"
                : isDuplicate
                  ? "border-[#FFC107] bg-[#FFF8E1]/50"
                  : "border-[#E9ECEF] bg-[#F8F9FA]"
            }`}
          >
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="font-mono-code truncate font-semibold text-[#212529]">
                    {idx + 1}. {baseName}
                  </span>
                  {isDuplicate && (
                    <span
                      data-testid={`duplicate-pdf-badge-${idx}`}
                      className="inline-flex shrink-0 items-center gap-1 rounded-[4px] border border-[#FFC107] bg-[#FFF3CD] px-1.5 py-0.5 text-[10px] font-semibold text-[#856404]"
                    >
                      <AlertTriangle className="h-3 w-3 shrink-0 text-[#D39E00]" />
                      {t.pdfOps.duplicateNameBadge}
                    </span>
                  )}
                </div>
                <span className="shrink-0 text-[#6C757D]">
                  {t.pdfOps.docMeta(f.page_count, formatBytes(f.file_size_bytes), f.bookmarks.length)}
                </span>
              </div>
              {isDuplicate && (
                <div
                  data-testid={`duplicate-pdf-path-${idx}`}
                  title={f.path}
                  className="font-mono-code mt-0.5 truncate text-[11px] text-[#495057]"
                >
                  {f.path}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => onRequestRemoveFile(idx)}
              title={t.pdfOps.removeFileBtnTitle}
              className="shrink-0 rounded-[4px] p-1 text-[#DC3545] hover:bg-[#F8D7DA]"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
