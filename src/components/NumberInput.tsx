import React from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

export interface NumberInputProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  size?: "md" | "sm";
  className?: string;
  inputClassName?: string;
  id?: string;
  ariaLabel?: string;
  disabled?: boolean;
}

function stepDecimals(step: number): number {
  const s = String(step);
  const dot = s.indexOf(".");
  return dot >= 0 ? s.length - dot - 1 : 0;
}

export const NumberInput: React.FC<NumberInputProps> = ({
  value,
  onChange,
  min,
  max,
  step = 1,
  size = "md",
  className = "",
  inputClassName = "",
  id,
  ariaLabel,
  disabled = false,
}) => {
  const [text, setText] = React.useState(String(value));
  const [focused, setFocused] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!focused) {
      setText(String(value));
    }
  }, [value, focused]);

  const clampAndRound = React.useCallback(
    (num: number): number => {
      let n = num;
      if (min !== undefined) n = Math.max(min, n);
      if (max !== undefined) n = Math.min(max, n);
      const dec = stepDecimals(step);
      return dec > 0 ? Number(n.toFixed(dec)) : Math.round(n * 1e6) / 1e6;
    },
    [min, max, step],
  );

  const commitText = React.useCallback(
    (raw: string) => {
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || raw.trim() === "") {
        setText(String(value));
        return;
      }
      const next = clampAndRound(parsed);
      setText(String(next));
      if (next !== value) {
        onChange(next);
      }
    },
    [clampAndRound, onChange, value],
  );

  const stepBy = React.useCallback(
    (dir: 1 | -1) => {
      if (disabled) return;
      const base = Number.isFinite(Number(text)) && text.trim() !== "" ? Number(text) : value;
      const next = clampAndRound(base + dir * step);
      setText(String(next));
      onChange(next);
    },
    [disabled, text, value, clampAndRound, step, onChange],
  );

  const stepByRef = React.useRef(stepBy);
  React.useEffect(() => {
    stepByRef.current = stepBy;
  }, [stepBy]);

  const wheelCleanupRef = React.useRef<(() => void) | null>(null);

  const detachWheel = React.useCallback(() => {
    wheelCleanupRef.current?.();
    wheelCleanupRef.current = null;
  }, []);

  const attachWheel = React.useCallback(() => {
    const el = containerRef.current;
    if (!el || disabled || wheelCleanupRef.current) return;
    const onWheel = (e: WheelEvent) => {
      if (document.activeElement !== inputRef.current) return;
      e.preventDefault();
      if (e.deltaY < 0) {
        stepByRef.current(1);
      } else if (e.deltaY > 0) {
        stepByRef.current(-1);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    wheelCleanupRef.current = () => {
      el.removeEventListener("wheel", onWheel);
    };
  }, [disabled]);

  React.useEffect(() => {
    if (disabled) detachWheel();
    return () => detachWheel();
  }, [disabled, detachWheel]);

  const sizeClass = size === "sm" ? "knit-control-sm text-xs" : "knit-control text-xs";

  return (
    <div
      ref={containerRef}
      className={`inline-flex items-stretch overflow-hidden rounded-[4px] border bg-white transition-colors ${
        focused ? "border-[#007BFF] ring-2 ring-[#007BFF]/20" : "border-[#CED4DA] hover:border-[#ADB5BD]"
      } ${disabled ? "cursor-not-allowed bg-[#F1F3F5] opacity-70" : ""} ${sizeClass} ${className}`}
    >
      <input
        ref={inputRef}
        id={id}
        type="text"
        inputMode="decimal"
        role="spinbutton"
        aria-label={ariaLabel}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        disabled={disabled}
        value={text}
        onFocus={() => {
          setFocused(true);
          attachWheel();
        }}
        onBlur={() => {
          setFocused(false);
          detachWheel();
          commitText(text);
        }}
        onChange={(e) => {
          const raw = e.target.value;
          setText(raw);
          const parsed = Number(raw);
          if (raw.trim() !== "" && Number.isFinite(parsed)) {
            onChange(clampAndRound(parsed));
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") {
            e.preventDefault();
            stepBy(1);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            stepBy(-1);
          } else if (e.key === "Enter") {
            commitText(text);
          }
        }}
        className={`min-w-0 flex-1 bg-transparent px-2 tabular-nums text-[#212529] focus:outline-none disabled:cursor-not-allowed ${inputClassName}`}
      />
      <div className="flex w-5 shrink-0 flex-col border-l border-[#DEE2E6] bg-[#F8F9FA]">
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Increase ${ariaLabel || "value"}`}
          disabled={disabled || (max !== undefined && value >= max)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            inputRef.current?.focus();
            stepBy(1);
          }}
          className="flex flex-1 items-center justify-center border-b border-[#DEE2E6] text-[#495057] transition-colors hover:bg-[#E7F1FF] hover:text-[#007BFF] disabled:cursor-not-allowed disabled:opacity-35"
        >
          <ChevronUp className="h-3 w-3" />
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Decrease ${ariaLabel || "value"}`}
          disabled={disabled || (min !== undefined && value <= min)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            inputRef.current?.focus();
            stepBy(-1);
          }}
          className="flex flex-1 items-center justify-center text-[#495057] transition-colors hover:bg-[#E7F1FF] hover:text-[#007BFF] disabled:cursor-not-allowed disabled:opacity-35"
        >
          <ChevronDown className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
};
