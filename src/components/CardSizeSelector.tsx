import React from "react";
import { useI18n } from "../i18n";
import type { CardSizePreset } from "../lib/imageGrid";

interface CardSizeSelectorProps {
  value: CardSizePreset;
  onChange: (size: CardSizePreset) => void;
  compact?: boolean;
}

const SIZE_OPTIONS: readonly CardSizePreset[] = ["small", "medium", "large"];

/** Compact segmented control for switching card thumbnail sizes (small / medium / large). */
export const CardSizeSelector: React.FC<CardSizeSelectorProps> = ({
  value,
  onChange,
  compact = false,
}) => {
  const { t } = useI18n();

  const labelFor = (preset: CardSizePreset) => {
    switch (preset) {
      case "small":
        return t.common.cardSizeSmall;
      case "medium":
        return t.common.cardSizeMedium;
      case "large":
        return t.common.cardSizeLarge;
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#495057]">
      <span className="font-semibold">{t.common.cardSizeLabel}</span>
      {SIZE_OPTIONS.map((preset) => (
        <button
          key={preset}
          type="button"
          onClick={() => onChange(preset)}
          className={`knit-control-sm rounded-[4px] border text-xs font-semibold ${
            compact ? "px-2" : "px-2.5"
          } ${
            value === preset
              ? "border-[#007BFF] bg-[#007BFF] text-white"
              : "border-[#CED4DA] bg-[#F8F9FA] text-[#343A40] hover:bg-[#E9ECEF]"
          }`}
        >
          {labelFor(preset)}
        </button>
      ))}
    </div>
  );
};
