import React from "react";
import { GripHorizontal, GripVertical } from "lucide-react";

interface PaneResizeHandleProps {
  orientation: "horizontal" | "vertical";
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  title?: string;
  ariaLabel?: string;
  variant?: "flush" | "dashed" | "splitter";
  labelText?: string;
  className?: string;
}

/** Shared pointer-drag resize separator handle for horizontal and vertical panes. */
export const PaneResizeHandle: React.FC<PaneResizeHandleProps> = ({
  orientation,
  onPointerDown,
  title,
  ariaLabel,
  variant = "flush",
  labelText,
  className = "",
}) => {
  if (orientation === "vertical") {
    return (
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={ariaLabel}
        title={title}
        onPointerDown={onPointerDown}
        className={`hidden self-stretch min-h-[280px] cursor-col-resize select-none items-center justify-center rounded-[4px] border border-[#DEE2E6] bg-[#F8F9FA] text-[#868E96] transition-colors hover:border-[#B8DAFF] hover:bg-[#E7F1FF] hover:text-[#007BFF] lg:flex ${className}`}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </div>
    );
  }

  const variantClasses =
    variant === "dashed"
      ? "mt-1.5 flex h-5 cursor-ns-resize select-none items-center justify-center rounded-[4px] border border-dashed border-[#CED4DA] bg-[#F8F9FA] text-[#6C757D] transition-colors hover:border-[#007BFF] hover:bg-[#E7F1FF] hover:text-[#007BFF]"
      : "flex h-3 cursor-row-resize select-none items-center justify-center border-t border-[#E9ECEF] bg-[#F8F9FA] text-[#868E96] transition-colors hover:bg-[#E7F1FF] hover:text-[#007BFF]";

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={ariaLabel}
      title={title}
      onPointerDown={onPointerDown}
      className={`${variantClasses} ${className}`}
    >
      <GripHorizontal className={variant === "dashed" ? "h-4 w-4" : "h-3.5 w-3.5"} />
      {labelText ? (
        <span className="ml-2 font-mono-code text-[11px]">{labelText}</span>
      ) : null}
    </div>
  );
};
