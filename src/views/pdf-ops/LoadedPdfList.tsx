import React from "react";
import { Info, Trash2 } from "lucide-react";
import { useI18n } from "../../i18n";
import { normalizeComparePath } from "../../lib/exportPath";
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

  const { sameNameSet, exactDuplicatePaths } = React.useMemo(() => {
    const nameCounts = new Map<string, number>();
    const pathCounts = new Map<string, number>();
    for (const f of files) {
      const name = (f.path.split(/[\\/]/).pop() ?? f.path).toLowerCase();
      nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
      const normPath = normalizeComparePath(f.path);
      pathCounts.set(normPath, (pathCounts.get(normPath) ?? 0) + 1);
    }
    const sameNames = new Set<string>();
    for (const [name, c] of nameCounts.entries()) {
      if (c > 1) sameNames.add(name);
    }
    const exactDups = new Set<string>();
    for (const [normPath, c] of pathCounts.entries()) {
      if (c > 1) exactDups.add(normPath);
    }
    return { sameNameSet: sameNames, exactDuplicatePaths: exactDups };
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
        const isSameName = sameNameSet.has(baseName.toLowerCase());
        const isExactDuplicate = exactDuplicatePaths.has(normalizeComparePath(f.path));

        return (
          <div
            key={`${f.path}-${idx}`}
            className={`flex items-center justify-between gap-2 rounded-[4px] border px-3 py-2 text-sm transition-colors duration-300 ${
              highlighted
                ? "border-[#A3CFBB] bg-[#E9F7EF]"
                : "border-[#E9ECEF] bg-[#F8F9FA]"
            }`}
          >
            <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span className="font-mono-code shrink-0 font-semibold text-[#212529]">
                  {idx + 1}. {baseName}
                </span>
                {isExactDuplicate && (
                  <span
                    data-testid={`duplicate-pdf-badge-${idx}`}
                    className="inline-flex shrink-0 items-center gap-1 rounded-[4px] border border-[#B8DAFF] bg-[#E7F1FF] px-1.5 py-0.5 text-sm font-semibold text-[#0056B3]"
                  >
                    <Info className="h-3.5 w-3.5 shrink-0 text-[#007BFF]" />
                    {t.pdfOps.duplicateFileBadge}
                  </span>
                )}
                {isSameName && (
                  <span
                    data-testid={`duplicate-pdf-path-${idx}`}
                    title={f.path}
                    className="font-mono-code min-w-0 truncate rounded-[4px] bg-[#E9ECEF] px-1.5 py-0.5 text-sm text-[#495057]"
                  >
                    {f.path}
                  </span>
                )}
              </div>
              <span className="shrink-0 text-[#6C757D]">
                {t.pdfOps.docMeta(f.page_count, formatBytes(f.file_size_bytes), f.bookmarks.length)}
              </span>
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
