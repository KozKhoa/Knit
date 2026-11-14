import React from "react";
import { FolderOpen, Upload } from "lucide-react";
import { useI18n } from "../i18n";

interface DropzoneProps {
  title: string;
  description: string;
  onPickFiles?: () => void;
  onPickFolder?: () => void;
  filesLabel?: string;
  folderLabel?: string;
}

export const Dropzone: React.FC<DropzoneProps> = ({
  title,
  description,
  onPickFiles,
  onPickFolder,
  filesLabel,
  folderLabel,
}) => {
  const { t } = useI18n();

  return (
    <div className="flex flex-col items-center justify-center rounded-[4px] border-2 border-dashed border-[#CED4DA] bg-white px-6 py-7 text-center">
      <div className="mb-2.5 flex h-10 w-10 items-center justify-center rounded-[4px] border border-[#DEE2E6] bg-[#F8F9FA] text-[#007BFF]">
        <Upload className="h-5 w-5" />
      </div>
      <div className="text-base font-bold text-[#212529]">{title}</div>
      <p className="mt-1 max-w-xl text-sm text-[#6C757D]">{description}</p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
        {onPickFiles && (
          <button
            type="button"
            onClick={onPickFiles}
            className="knit-control flex items-center gap-1.5 rounded-[4px] bg-[#007BFF] px-4 text-sm font-semibold text-white hover:bg-[#0069D9]"
          >
            <Upload className="h-4 w-4" />
            {filesLabel ?? t.common.chooseFiles}
          </button>
        )}
        {onPickFolder && (
          <button
            type="button"
            onClick={onPickFolder}
            className="knit-control flex items-center gap-1.5 rounded-[4px] border border-[#CED4DA] bg-white px-4 text-sm font-semibold text-[#343A40] hover:bg-[#F8F9FA]"
          >
            <FolderOpen className="h-4 w-4" />
            {folderLabel ?? t.common.chooseFolder}
          </button>
        )}
      </div>
    </div>
  );
};
