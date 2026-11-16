import React from "react";
import { AlertTriangle, X } from "lucide-react";
import { useI18n } from "../i18n";

export type ConflictResolution = "overwrite" | "auto_rename" | "cancel";

interface ExportConflictModalProps {
  conflictPaths: string[];
  onResolve: (choice: ConflictResolution) => void;
}

export const ExportConflictModal: React.FC<ExportConflictModalProps> = ({
  conflictPaths,
  onResolve,
}) => {
  const { t } = useI18n();

  React.useEffect(() => {
    if (conflictPaths.length === 0) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onResolve("cancel");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [conflictPaths.length, onResolve]);

  if (conflictPaths.length === 0) return null;

  return (
    <div
      onClick={() => onResolve("cancel")}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-[4px] border border-[#DEE2E6] bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-[#DEE2E6] bg-[#FFF3CD] px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-bold text-[#856404]">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{t.common.exportConflictTitle}</span>
          </div>
          <button
            type="button"
            onClick={() => onResolve("cancel")}
            aria-label={t.common.close}
            className="rounded-[4px] p-1 text-[#856404] hover:bg-[#FFEEBA]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 p-4 text-sm text-[#212529]">
          <p className="whitespace-pre-line">{t.common.exportConflictDesc(conflictPaths)}</p>
          {conflictPaths.length > 1 && (
            <ul className="max-h-40 space-y-1 overflow-y-auto rounded-[4px] border border-[#DEE2E6] bg-[#F8F9FA] p-2.5 font-mono-code text-xs text-[#343A40]">
              {conflictPaths.map((p) => (
                <li key={p} className="truncate" title={p}>
                  {p}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[#DEE2E6] bg-[#F8F9FA] px-4 py-3">
          <button
            type="button"
            onClick={() => onResolve("cancel")}
            className="knit-control-sm rounded-[4px] border border-[#CED4DA] bg-white px-3 text-xs font-semibold text-[#343A40] hover:bg-[#E9ECEF]"
          >
            {t.common.exportRenameBtn}
          </button>
          <button
            type="button"
            onClick={() => onResolve("auto_rename")}
            className="knit-control-sm rounded-[4px] border border-[#007BFF] bg-[#E7F1FF] px-3 text-xs font-semibold text-[#0056B3] hover:bg-[#007BFF] hover:text-white"
          >
            {t.common.exportAutoRenameBtn}
          </button>
          <button
            type="button"
            onClick={() => onResolve("overwrite")}
            className="knit-control-sm rounded-[4px] bg-[#DC3545] px-3 text-xs font-semibold text-white hover:bg-[#C82333]"
          >
            {t.common.exportOverwriteBtn}
          </button>
        </div>
      </div>
    </div>
  );
};
