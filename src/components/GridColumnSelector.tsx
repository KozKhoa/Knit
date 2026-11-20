import React from "react";

interface GridColumnSelectorProps {
  label: string;
  options: readonly number[];
  value: number;
  onChange: (cols: number) => void;
  compact?: boolean;
}

/** Compact button strip to switch grid columns / density (2..8). */
export const GridColumnSelector: React.FC<GridColumnSelectorProps> = ({
  label,
  options,
  value,
  onChange,
  compact = false,
}) => (
  <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#495057]">
    <span className="font-semibold">{label}</span>
    {options.map((cols) => (
      <button
        key={cols}
        type="button"
        onClick={() => onChange(cols)}
        className={`knit-control-sm rounded-[4px] border font-mono-code text-xs font-semibold ${
          compact ? "px-2" : "px-2.5"
        } ${
          value === cols
            ? "border-[#007BFF] bg-[#007BFF] text-white"
            : "border-[#CED4DA] bg-[#F8F9FA] text-[#343A40] hover:bg-[#E9ECEF]"
        }`}
      >
        {cols}
      </button>
    ))}
  </div>
);
