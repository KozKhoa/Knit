// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useVirtualizedGrid } from "./useVirtualizedGrid";

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe("useVirtualizedGrid", () => {
  it("computes overscanned row slice and notifies visible window on mount/refresh", () => {
    const onVisibleWindowChange = vi.fn();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      cb(0);
      return 1;
    });

    function Harness({ totalItems }: { totalItems: number }) {
      const outerRef = React.useRef<HTMLDivElement | null>(null);
      const innerRef = React.useRef<HTMLDivElement | null>(null);
      const scrollRef = React.useRef<HTMLDivElement | null>(null);

      const grid = useVirtualizedGrid({
        outerRef,
        innerRef,
        getScrollEl: () => scrollRef.current,
        totalItems,
        cols: 4,
        gapPx: 12,
        initialRowStridePx: 100,
        overscanRows: 1,
        onVisibleWindowChange,
      });

      return (
        <div
          ref={(el) => {
            scrollRef.current = el;
            if (el) {
              Object.defineProperty(el, "clientHeight", { value: 200, configurable: true });
              el.getBoundingClientRect = () =>
                ({ top: 0, left: 0, width: 400, height: 200 } as DOMRect);
            }
          }}
        >
          <div
            ref={(el) => {
              outerRef.current = el;
              if (el) {
                el.getBoundingClientRect = () =>
                  ({ top: 0, left: 0, width: 400, height: 1000 } as DOMRect);
              }
            }}
          >
            <div ref={innerRef} />
            <span data-testid="slice">{`${grid.startIdx}:${grid.endIdxExclusive}`}</span>
            <span data-testid="pads">{`${grid.topPadPx}:${grid.bottomPadPx}`}</span>
          </div>
        </div>
      );
    }

    render(<Harness totalItems={40} />);
    // 40 items / 4 cols = 10 rows; viewport 200px @ stride 100 -> rows 0..2 + overscan 1 => rows 0..3 (16 items)
    act(() => {});
    expect(screen.getByTestId("slice").textContent).toBe("0:16");
    expect(screen.getByTestId("pads").textContent).toBe("0:600");
    expect(onVisibleWindowChange).toHaveBeenCalledWith(0, 16);
  });
});
