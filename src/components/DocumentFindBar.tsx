import React from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";

interface DocumentFindBarProps {
  open: boolean;
  query: string;
  activeMatchIndex: number | null;
  matchCount: number;
  placeholder: string;
  prevTitle: string;
  nextTitle: string;
  closeAriaLabel: string;
  counterColorClass?: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  onQueryChange: (value: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}

/** Reusable Ctrl+F find bar shared by Markdown Editor and PDF Preview panes. */
export const DocumentFindBar: React.FC<DocumentFindBarProps> = ({
  open,
  query,
  activeMatchIndex,
  matchCount,
  placeholder,
  prevTitle,
  nextTitle,
  closeAriaLabel,
  counterColorClass = "text-[#0056B3]",
  inputRef,
  onQueryChange,
  onPrev,
  onNext,
  onClose,
}) => {
  if (!open) return null;

  return (
    <div className="flex shrink-0 items-center gap-1.5 border-b border-[#B6D4FE] bg-[#F8FAFF] px-3 py-1.5 text-xs">
      <Search className="h-3.5 w-3.5 shrink-0 text-[#007BFF]" />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && matchCount > 0) {
            e.preventDefault();
            if (e.shiftKey) {
              onPrev();
            } else {
              onNext();
            }
          } else if (e.key === "Escape") {
            onClose();
          }
        }}
        placeholder={placeholder}
        className="knit-control-sm min-w-0 flex-1 rounded-[4px] border border-[#CED4DA] bg-white px-2 text-xs text-[#212529]"
      />
      {query.trim() !== "" && (
        <span className={`font-mono-code text-[11px] font-semibold ${counterColorClass}`}>
          {matchCount > 0 ? `${(activeMatchIndex ?? 0) + 1}/${matchCount}` : "0/0"}
        </span>
      )}
      <button
        type="button"
        disabled={matchCount === 0}
        onClick={onPrev}
        title={prevTitle}
        className="flex h-6 w-6 items-center justify-center rounded-[4px] border border-[#CED4DA] bg-white text-[#343A40] hover:bg-[#E9ECEF] disabled:opacity-40"
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        disabled={matchCount === 0}
        onClick={onNext}
        title={nextTitle}
        className="flex h-6 w-6 items-center justify-center rounded-[4px] border border-[#CED4DA] bg-white text-[#343A40] hover:bg-[#E9ECEF] disabled:opacity-40"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label={closeAriaLabel}
        className="flex h-6 w-6 items-center justify-center rounded-[4px] text-[#6C757D] hover:bg-[#E9ECEF]"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};
