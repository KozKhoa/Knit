import React from "react";

export interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  onValueCommit?: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  className?: string;
  id?: string;
  ariaLabel?: string;
}

export const Slider: React.FC<SliderProps> = ({
  value,
  onChange,
  onValueCommit,
  min,
  max,
  step = 1,
  disabled = false,
  className = "",
  id,
  ariaLabel,
}) => {
  const trackRef = React.useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = React.useState(false);

  const span = Math.max(1e-6, max - min);
  const clamped = Math.min(max, Math.max(min, value));
  const pct = Math.min(100, Math.max(0, ((clamped - min) / span) * 100));

  const valueFromClientX = React.useCallback(
    (clientX: number): number => {
      const track = trackRef.current;
      if (!track) return clamped;
      const rect = track.getBoundingClientRect();
      if (rect.width <= 0) return clamped;
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const raw = min + ratio * (max - min);
      const stepped = Math.round((raw - min) / step) * step + min;
      return Number(Math.min(max, Math.max(min, stepped)).toFixed(6));
    },
    [clamped, min, max, step],
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.preventDefault();
    e.currentTarget.focus();
    setDragging(true);

    let latest = Number.isFinite(e.clientX) ? valueFromClientX(e.clientX) : clamped;
    onChange(latest);

    const onMove = (ev: PointerEvent) => {
      if (!Number.isFinite(ev.clientX)) return;
      latest = valueFromClientX(ev.clientX);
      onChange(latest);
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (Number.isFinite(ev.clientX)) {
        latest = valueFromClientX(ev.clientX);
      }
      setDragging(false);
      onChange(latest);
      onValueCommit?.(latest);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      next = Math.min(max, clamped + step);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      next = Math.max(min, clamped - step);
    } else if (e.key === "Home") {
      next = min;
    } else if (e.key === "End") {
      next = max;
    }
    if (next !== null) {
      e.preventDefault();
      const rounded = Number(next.toFixed(6));
      onChange(rounded);
      onValueCommit?.(rounded);
    }
  };

  return (
    <div
      ref={trackRef}
      id={id}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={clamped}
      aria-disabled={disabled}
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
      className={`group relative flex h-6 select-none items-center touch-none focus:outline-none ${
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      } ${className}`}
    >
      {/* Background Rail */}
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-[#DEE2E6]">
        {/* Filled Track */}
        <div
          style={{ width: `${pct}%` }}
          className="h-full rounded-full bg-[#007BFF]"
        />
      </div>

      {/* Custom Thumb */}
      <div
        style={{ left: `calc(${pct}% - 8px)` }}
        className={`pointer-events-none absolute h-4 w-4 rounded-full border-2 border-[#007BFF] bg-white shadow-sm transition-transform ${
          dragging
            ? "scale-115 ring-4 ring-[#007BFF]/25"
            : "group-hover:scale-110 group-focus-visible:ring-4 group-focus-visible:ring-[#007BFF]/25"
        }`}
      />
    </div>
  );
};
