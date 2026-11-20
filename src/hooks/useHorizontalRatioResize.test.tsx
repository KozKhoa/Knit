// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useHorizontalRatioResize } from "./useHorizontalRatioResize";

afterEach(cleanup);

function Harness({
  value,
  onCommit,
}: {
  value: number;
  onCommit: (next: number) => void;
}) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const { ratio, isResizing, handlePointerDown } = useHorizontalRatioResize({
    value,
    min: 0.25,
    max: 0.75,
    containerRef,
    onCommit,
  });

  return (
    <div
      ref={(el) => {
        containerRef.current = el;
        if (el) {
          el.getBoundingClientRect = () =>
            ({ left: 100, width: 400, top: 0, right: 500, bottom: 100, height: 100 } as DOMRect);
        }
      }}
    >
      <span data-testid="ratio">{ratio}</span>
      <span data-testid="resizing">{String(isResizing)}</span>
      <div role="separator" onPointerDown={handlePointerDown} />
    </div>
  );
}

describe("useHorizontalRatioResize", () => {
  it("tracks horizontal pointer dragging clamped to [min, max] and commits rounded ratio", () => {
    const onCommit = vi.fn();
    render(<Harness value={0.4} onCommit={onCommit} />);

    const handle = screen.getByRole("separator");
    fireEvent(handle, new MouseEvent("pointerdown", { bubbles: true, clientX: 260, button: 0 }));
    expect(screen.getByTestId("resizing").textContent).toBe("true");

    // clientX = 340 -> (340 - 100) / 400 = 0.6
    fireEvent(window, new MouseEvent("pointermove", { bubbles: true, clientX: 340 }));
    expect(screen.getByTestId("ratio").textContent).toBe("0.6");
    expect(onCommit).not.toHaveBeenCalled();

    // Clamp at max 0.75
    fireEvent(window, new MouseEvent("pointermove", { bubbles: true, clientX: 900 }));
    expect(screen.getByTestId("ratio").textContent).toBe("0.75");

    fireEvent(window, new MouseEvent("pointerup", { bubbles: true }));
    expect(screen.getByTestId("resizing").textContent).toBe("false");
    expect(onCommit).toHaveBeenCalledWith(0.75);
  });

  it("updates cssVar directly via rAF without React re-renders during drag and commits once on release", () => {
    const onCommit = vi.fn();
    let renderCount = 0;

    function CssVarHarness() {
      renderCount += 1;
      const containerRef = React.useRef<HTMLDivElement | null>(null);
      const { ratio, isResizing, handlePointerDown } = useHorizontalRatioResize({
        value: 0.4,
        min: 0.25,
        max: 0.75,
        containerRef,
        cssVar: "--split-left",
        onCommit,
      });

      return (
        <div
          data-testid="box"
          ref={(el) => {
            containerRef.current = el;
            if (el) {
              el.getBoundingClientRect = () =>
                ({ left: 0, width: 500, top: 0, right: 500, bottom: 100, height: 100 } as DOMRect);
            }
          }}
        >
          <span data-testid="ratio">{ratio}</span>
          <span data-testid="resizing">{String(isResizing)}</span>
          <div role="separator" onPointerDown={handlePointerDown} />
        </div>
      );
    }

    const origRaf = window.requestAnimationFrame;
    const origCancel = window.cancelAnimationFrame;
    window.requestAnimationFrame = (cb) => {
      cb(0);
      return 1;
    };
    window.cancelAnimationFrame = () => {};

    try {
      render(<CssVarHarness />);
      const box = screen.getByTestId("box");
      expect(box.style.getPropertyValue("--split-left")).toBe("40.00%");

      const handle = screen.getByRole("separator");
      fireEvent(handle, new MouseEvent("pointerdown", { bubbles: true, clientX: 200, button: 0 }));
      const rendersAfterDown = renderCount;

      fireEvent(window, new MouseEvent("pointermove", { bubbles: true, clientX: 300 }));
      fireEvent(window, new MouseEvent("pointermove", { bubbles: true, clientX: 325 }));
      expect(box.style.getPropertyValue("--split-left")).toBe("65.00%");
      // Zero React re-renders during drag moves
      expect(renderCount).toBe(rendersAfterDown);
      expect(onCommit).not.toHaveBeenCalled();

      fireEvent(window, new MouseEvent("pointerup", { bubbles: true }));
      expect(screen.getByTestId("ratio").textContent).toBe("0.65");
      expect(onCommit).toHaveBeenCalledWith(0.65);
    } finally {
      window.requestAnimationFrame = origRaf;
      window.cancelAnimationFrame = origCancel;
    }
  });
});
