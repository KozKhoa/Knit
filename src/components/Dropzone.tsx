import React from "react";
import { FolderOpen, Loader2, Upload } from "lucide-react";
import { useI18n } from "../i18n";

interface DropzoneProps {
  title: string;
  description: string;
  onPickFiles?: () => void;
  onPickFolder?: () => void;
  filesLabel?: string;
  folderLabel?: string;
  loading?: boolean;
  loadingLabel?: string;
}

export const Dropzone: React.FC<DropzoneProps> = React.memo(({
  title,
  description,
  onPickFiles,
  onPickFolder,
  filesLabel,
  folderLabel,
  loading = false,
  loadingLabel,
}) => {
  const { t } = useI18n();

  return (
    <div className="flex flex-col items-center justify-center rounded-[4px] border-2 border-dashed border-[#CED4DA] bg-white px-6 py-7 text-center">
      <div className="mb-2.5 flex h-10 w-10 items-center justify-center rounded-[4px] border border-[#DEE2E6] bg-[#F8F9FA] text-[#007BFF]">
        {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
      </div>
      <div className="text-base font-bold text-[#212529]">{title}</div>
      <p className="mt-1 max-w-xl text-sm text-[#6C757D]">{description}</p>
      {loading && (
        <div className="mt-2.5 inline-flex items-center gap-1.5 rounded-[4px] border border-[#B8DAFF] bg-[#E7F1FF] px-3 py-1 text-xs font-semibold text-[#0056B3]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>{loadingLabel ?? t.common.loadingFolder}</span>
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
        {onPickFiles && (
          <button
            type="button"
            disabled={loading}
            onClick={onPickFiles}
            className="knit-control flex items-center gap-1.5 rounded-[4px] bg-[#007BFF] px-4 text-sm font-semibold text-white hover:bg-[#0069D9] disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Upload className="h-4 w-4" />
            {filesLabel ?? t.common.chooseFiles}
          </button>
        )}
        {onPickFolder && (
          <button
            type="button"
            disabled={loading}
            onClick={onPickFolder}
            className="knit-control flex items-center gap-1.5 rounded-[4px] border border-[#CED4DA] bg-white px-4 text-sm font-semibold text-[#343A40] hover:bg-[#F8F9FA] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin text-[#007BFF]" />
            ) : (
              <FolderOpen className="h-4 w-4" />
            )}
            {folderLabel ?? t.common.chooseFolder}
          </button>
        )}
      </div>
    </div>
  );
});
