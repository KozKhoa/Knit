import React from "react";
import { AlertTriangle, X } from "lucide-react";

interface ConfirmModalProps {
  open: boolean;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  closeAriaLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Accessible warning confirmation dialog for destructive list actions. */
export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  closeAriaLabel = cancelLabel,
  onConfirm,
  onCancel,
}) => {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      onClick={onCancel}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-[4px] border border-[#DEE2E6] bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-[#DEE2E6] bg-[#FFF3CD] px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-bold text-[#856404]">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{title}</span>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label={closeAriaLabel}
            className="rounded-[4px] p-1 text-[#856404] hover:bg-[#FFEEBA]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 text-sm text-[#212529]">{description}</div>

        <div className="flex items-center justify-end gap-2 border-t border-[#DEE2E6] bg-[#F8F9FA] px-4 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="knit-control-sm rounded-[4px] border border-[#CED4DA] bg-white px-3 text-xs font-semibold text-[#343A40] hover:bg-[#E9ECEF]"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="knit-control-sm knit-btn-danger px-3 text-xs"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
