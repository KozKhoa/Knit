import React from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface SelectProps<T extends string = string> {
  value: T;
  onChange: (value: T) => void;
  options: readonly SelectOption<T>[];
  disabled?: boolean;
  size?: "md" | "sm";
  className?: string;
  id?: string;
  ariaLabel?: string;
  placeholder?: string;
  dataTestId?: string;
}

export function Select<T extends string = string>({
  value,
  onChange,
  options,
  disabled = false,
  size = "md",
  className = "",
  id,
  ariaLabel,
  placeholder,
  dataTestId,
}: SelectProps<T>) {
  const [open, setOpen] = React.useState(false);
  const [highlightedIdx, setHighlightedIdx] = React.useState<number>(-1);
  const [menuPos, setMenuPos] = React.useState<{
    top: number;
    left: number;
    width: number;
    openUp: boolean;
  }>({ top: 0, left: 0, width: 160, openUp: false });

  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const itemRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const listId = React.useId();

  const selectedOption = React.useMemo(
    () => options.find((opt) => opt.value === value),
    [options, value],
  );

  const updateMenuPosition = React.useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const estimatedHeight = Math.min(260, options.length * 36 + 12);
    const openUp = spaceBelow < estimatedHeight && rect.top > spaceBelow;
    setMenuPos({
      top: openUp ? rect.top - 4 : rect.bottom + 4,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8)),
      width: Math.max(rect.width, 120),
      openUp,
    });
  }, [options.length]);

  const findNextEnabled = React.useCallback(
    (startIdx: number, step: 1 | -1) => {
      if (options.length === 0) return -1;
      for (let i = 0; i < options.length; i++) {
        const idx = (startIdx + step * i + options.length) % options.length;
        if (!options[idx].disabled) return idx;
      }
      return -1;
    },
    [options],
  );

  const openMenu = React.useCallback(() => {
    if (disabled || options.length === 0) return;
    updateMenuPosition();
    const selectedIdx = options.findIndex((o) => o.value === value && !o.disabled);
    setHighlightedIdx(selectedIdx >= 0 ? selectedIdx : findNextEnabled(0, 1));
    setOpen(true);
  }, [disabled, options, value, updateMenuPosition, findNextEnabled]);

  const closeMenu = React.useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) {
      triggerRef.current?.focus();
    }
  }, []);

  const commitOption = React.useCallback(
    (opt: SelectOption<T>) => {
      if (opt.disabled) return;
      onChange(opt.value);
      closeMenu(true);
    },
    [onChange, closeMenu],
  );

  React.useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (
        target &&
        !triggerRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        closeMenu(false);
      }
    };
    const handleReposition = () => updateMenuPosition();
    const handleKeyGlobal = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeMenu(true);
      }
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    window.addEventListener("keydown", handleKeyGlobal);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
      window.removeEventListener("keydown", handleKeyGlobal);
    };
  }, [open, closeMenu, updateMenuPosition]);

  React.useEffect(() => {
    if (!open || highlightedIdx < 0) return;
    const item = itemRefs.current[highlightedIdx];
    item?.scrollIntoView?.({ block: "nearest" });
  }, [open, highlightedIdx]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        openMenu();
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        const next = findNextEnabled(highlightedIdx + 1, 1);
        if (next >= 0) setHighlightedIdx(next);
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        const prev = findNextEnabled(
          highlightedIdx <= 0 ? options.length - 1 : highlightedIdx - 1,
          -1,
        );
        if (prev >= 0) setHighlightedIdx(prev);
        break;
      }
      case "Home": {
        e.preventDefault();
        const first = findNextEnabled(0, 1);
        if (first >= 0) setHighlightedIdx(first);
        break;
      }
      case "End": {
        e.preventDefault();
        const last = findNextEnabled(options.length - 1, -1);
        if (last >= 0) setHighlightedIdx(last);
        break;
      }
      case "Enter":
      case " ": {
        e.preventDefault();
        if (highlightedIdx >= 0 && options[highlightedIdx]) {
          commitOption(options[highlightedIdx]);
        }
        break;
      }
      case "Escape": {
        e.preventDefault();
        closeMenu(true);
        break;
      }
      case "Tab": {
        closeMenu(false);
        break;
      }
    }
  };

  const sizeClass = size === "sm" ? "knit-control-sm px-2 text-xs" : "knit-control px-2.5 text-sm";

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        data-testid={dataTestId}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (open ? closeMenu(false) : openMenu())}
        onKeyDown={handleKeyDown}
        className={`inline-flex items-center justify-between gap-2 rounded-[4px] border border-[#CED4DA] bg-white text-left text-[#212529] transition-colors hover:border-[#ADB5BD] focus:border-[#007BFF] focus:outline-none focus:ring-2 focus:ring-[#007BFF]/20 disabled:cursor-not-allowed disabled:bg-[#F1F3F5] disabled:text-[#6C757D] ${sizeClass} ${className}`}
      >
        <span className="min-w-0 flex-1 truncate">
          {selectedOption ? selectedOption.label : placeholder ?? ""}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-[#6C757D] transition-transform duration-150 ${
            open ? "rotate-180 text-[#007BFF]" : ""
          }`}
        />
      </button>

      {open &&
        createPortal(
          <div
            ref={menuRef}
            id={listId}
            role="listbox"
            aria-label={ariaLabel}
            style={{
              position: "fixed",
              top: menuPos.top,
              left: menuPos.left,
              minWidth: menuPos.width,
              maxWidth: "min(92vw, 380px)",
              transform: menuPos.openUp ? "translateY(-100%)" : undefined,
              zIndex: 9999,
            }}
            className="overscroll-contain max-h-64 overflow-y-auto rounded-[4px] border border-[#CED4DA] bg-white p-1 shadow-lg"
          >
            {options.map((opt, idx) => {
              const selected = opt.value === value;
              const highlighted = idx === highlightedIdx;
              return (
                <button
                  key={opt.value}
                  ref={(el) => {
                    itemRefs.current[idx] = el;
                  }}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  disabled={opt.disabled}
                  onMouseEnter={() => {
                    if (!opt.disabled) setHighlightedIdx(idx);
                  }}
                  onClick={() => commitOption(opt)}
                  className={`flex w-full items-center justify-between gap-2 rounded-[3px] px-2.5 py-1.5 text-left transition-colors ${
                    size === "sm" ? "text-xs" : "text-sm"
                  } ${
                    opt.disabled
                      ? "cursor-not-allowed text-[#ADB5BD]"
                      : highlighted
                        ? "bg-[#E7F1FF] text-[#0056B3]"
                        : selected
                          ? "bg-[#F8F9FA] font-semibold text-[#212529]"
                          : "text-[#212529] hover:bg-[#F1F3F5]"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                  {selected && <Check className="h-3.5 w-3.5 shrink-0 text-[#007BFF]" />}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
