import React from "react";
import { CheckCircle2, FolderOpen, X } from "lucide-react";
import { useI18n } from "../i18n";
import { revealInExplorer } from "../lib/ipc";

export interface CompletedExportInfo {
  title: string;
  summary: string;
  outputs: string[];
}

interface ExportSuccessModalProps {
  result: CompletedExportInfo | null;
  onClose: () => void;
}

export const ExportSuccessModal: React.FC<ExportSuccessModalProps> = ({ result, onClose }) => {
  const { t } = useI18n();

  if (!result) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-success-title"
    >
      <div className="w-full max-w-lg rounded-[4px] border border-[#CED4DA] bg-white">
        <div className="flex items-center justify-between border-b border-[#DEE2E6] px-4 py-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-[#28A745]" />
            <h2 id="export-success-title" className="text-base font-bold text-[#212529]">
              {t.common.exportSuccessTitle}: {result.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[4px] p-1 text-[#6C757D] hover:bg-[#F8F9FA] hover:text-[#212529]"
            aria-label={t.common.close}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 p-4 text-sm text-[#212529]">
          <p className="text-[#495057]">{result.summary || t.common.exportSuccessSubtitle}</p>

          {result.outputs.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-xs font-semibold uppercase tracking-wide text-[#6C757D]">
                {t.common.outputFilesLabel} ({result.outputs.length})
              </div>
              <div className="max-h-48 space-y-1.5 overflow-y-auto rounded-[4px] border border-[#DEE2E6] bg-[#F8F9FA] p-2">
                {result.outputs.map((outPath) => (
                  <div
                    key={outPath}
                    className="flex items-center justify-between gap-2 rounded-[4px] border border-[#E9ECEF] bg-white px-2.5 py-1.5"
                  >
                    <span className="font-mono-code truncate text-xs text-[#343A40]" title={outPath}>
                      {outPath}
                    </span>
                    <button
                      type="button"
                      onClick={() => void revealInExplorer(outPath)}
                      className="flex shrink-0 items-center gap-1 rounded-[4px] border border-[#CED4DA] bg-[#F8F9FA] px-2 py-1 text-xs font-semibold text-[#343A40] hover:bg-[#E9ECEF]"
                    >
                      <FolderOpen className="h-3.5 w-3.5 text-[#007BFF]" />
                      {t.common.openFolder}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[#DEE2E6] px-4 py-3">
          {result.outputs.length > 0 && (
            <button
              type="button"
              onClick={() => void revealInExplorer(result.outputs[0])}
              className="flex items-center gap-1.5 rounded-[4px] border border-[#CED4DA] bg-white px-3.5 py-1.5 text-sm font-semibold text-[#343A40] hover:bg-[#F8F9FA]"
            >
              <FolderOpen className="h-4 w-4 text-[#007BFF]" />
              {t.common.openFolder}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-[4px] bg-[#007BFF] px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#0069D9]"
          >
            {t.common.close}
          </button>
        </div>
      </div>
    </div>
  );
};
