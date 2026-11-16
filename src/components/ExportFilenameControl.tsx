import React from "react";
import { AlertTriangle, FileOutput, FolderCheck } from "lucide-react";
import { useI18n } from "../i18n";

interface ExportFilenameControlProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  defaultExportDir: string;
  existsAtDefaultDir: boolean;
  className?: string;
}

export const ExportFilenameControl: React.FC<ExportFilenameControlProps> = ({
  value,
  onChange,
  placeholder,
  defaultExportDir,
  existsAtDefaultDir,
  className = "",
}) => {
  const { t } = useI18n();
  const hasDefaultDir = defaultExportDir.trim().length > 0;

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-2 rounded-[4px] border border-[#DEE2E6] bg-[#F8F9FA] px-3 py-2 text-xs ${className}`}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <span className="flex shrink-0 items-center gap-1.5 font-semibold text-[#343A40]">
          <FileOutput className="h-3.5 w-3.5 text-[#007BFF]" />
          {t.common.exportFilenameLabel}
        </span>
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? t.common.exportFilenamePlaceholder}
          className="knit-control-sm min-w-[180px] flex-1 max-w-xs rounded-[4px] border border-[#CED4DA] bg-white px-2.5 font-mono-code text-xs text-[#212529] focus:border-[#007BFF] focus:outline-none"
        />
        {existsAtDefaultDir && (
          <span className="inline-flex items-center gap-1 rounded-[4px] border border-[#FFEEBA] bg-[#FFF3CD] px-2 py-0.5 font-medium text-[#856404]">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {t.common.exportExistsWarning}
          </span>
        )}
      </div>

      {hasDefaultDir && (
        <div
          title={defaultExportDir}
          className="flex min-w-0 max-w-full items-center gap-1 text-[#28A745]"
        >
          <FolderCheck className="h-3.5 w-3.5 shrink-0" />
          <span className="font-mono-code truncate">
            {t.common.exportUsingDefaultDir(defaultExportDir)}
          </span>
        </div>
      )}
    </div>
  );
};
