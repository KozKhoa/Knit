import React from "react";
import { CheckCircle2, FolderOpen, X } from "lucide-react";
import { useI18n } from "../i18n";
import { revealInExplorer } from "../lib/ipc";

export interface CompletedExportInfo {
  title: string;
  summary: string;
  outputs: string[];
}

interface ExportSuccessToastProps {
  result: CompletedExportInfo | null;
  onClose: () => void;
  autoCloseMs?: number;
}

export const ExportSuccessToast: React.FC<ExportSuccessToastProps> = ({
  result,
  onClose,
  autoCloseMs = 3000,
}) => {
  const { t } = useI18n();
  const [hovered, setHovered] = React.useState(false);

  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  React.useEffect(() => {
    setHovered(false);
  }, [result]);

  React.useEffect(() => {
    if (!result || hovered || autoCloseMs <= 0) return;
    const timer = window.setTimeout(() => {
      onCloseRef.current();
    }, autoCloseMs);
    return () => window.clearTimeout(timer);
  }, [result, hovered, autoCloseMs]);

  if (!result) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="fixed bottom-4 right-4 z-50 w-[min(26rem,calc(100vw-2rem))] rounded-[6px] border border-[#CED4DA] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.16)]"
    >
      <div className="flex items-start justify-between gap-2 border-b border-[#DEE2E6] px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-[#28A745]" />
          <div className="truncate text-sm font-bold text-[#212529]">
            {t.common.exportSuccessTitle}: {result.title}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-[4px] p-0.5 text-[#6C757D] hover:bg-[#F8F9FA] hover:text-[#212529]"
          aria-label={t.common.close}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-2 px-3.5 py-2.5 text-xs text-[#212529]">
        <p className="text-[#495057]">{result.summary || t.common.exportSuccessSubtitle}</p>

        {result.outputs.length > 0 && (
          <div className="max-h-28 space-y-1 overflow-y-auto rounded-[4px] border border-[#DEE2E6] bg-[#F8F9FA] p-1.5">
            {result.outputs.map((outPath) => (
              <div
                key={outPath}
                className="flex items-center justify-between gap-2 rounded-[4px] border border-[#E9ECEF] bg-white px-2 py-1"
              >
                <span className="font-mono-code truncate text-[11px] text-[#343A40]" title={outPath}>
                  {outPath}
                </span>
                <button
                  type="button"
                  onClick={() => void revealInExplorer(outPath)}
                  className="flex shrink-0 items-center gap-1 rounded-[4px] border border-[#CED4DA] bg-[#F8F9FA] px-1.5 py-0.5 text-[11px] font-semibold text-[#343A40] hover:bg-[#E9ECEF]"
                >
                  <FolderOpen className="h-3 w-3 text-[#007BFF]" />
                  {t.common.openFolder}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
