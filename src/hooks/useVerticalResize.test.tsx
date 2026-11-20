// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useVerticalResize } from "./useVerticalResize";

afterEach(() => {
  cleanup();
});

function Harness({
  value,
  min,
  max,
  onCommit,
}: {
  value: number;
  min: number;
  max?: number;
  onCommit: (next: number) => void;
}) {
  const { height, isResizing, handlePointerDown } = useVerticalResize({
    value,
    min,
    max,
    onCommit,
  });

  return (
    <div>
      <span data-testid="height">{height}</span>
      <span data-testid="resizing">{String(isResizing)}</span>
      <div role="separator" onPointerDown={handlePointerDown} />
    </div>
  );
}

describe("useVerticalResize", () => {
  it("clamps initial and updated external value to [min, max]", () => {
    const onCommit = vi.fn();
    const { rerender } = render(<Harness value={50} min={100} max={500} onCommit={onCommit} />);
    expect(screen.getByTestId("height").textContent).toBe("100");

    rerender(<Harness value={900} min={100} max={500} onCommit={onCommit} />);
    expect(screen.getByTestId("height").textContent).toBe("500");
  });

  it("updates live height during pointermove and commits once on pointerup", () => {
    const onCommit = vi.fn();
    render(<Harness value={300} min={150} max={600} onCommit={onCommit} />);

    const handle = screen.getByRole("separator");
    fireEvent(handle, new MouseEvent("pointerdown", { bubbles: true, clientY: 100, button: 0 }));
    expect(screen.getByTestId("resizing").textContent).toBe("true");

    fireEvent(window, new MouseEvent("pointermove", { bubbles: true, clientY: 180 }));
    expect(screen.getByTestId("height").textContent).toBe("380");
    expect(onCommit).not.toHaveBeenCalled();

    // Clamp at max
    fireEvent(window, new MouseEvent("pointermove", { bubbles: true, clientY: 999 }));
    expect(screen.getByTestId("height").textContent).toBe("600");

    fireEvent(window, new MouseEvent("pointerup", { bubbles: true }));
    expect(screen.getByTestId("resizing").textContent).toBe("false");
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(600);
  });

  it("handles pointercancel and cleans up window listeners on unmount", () => {
    const onCommit = vi.fn();
    const { unmount } = render(<Harness value={250} min={100} max={400} onCommit={onCommit} />);
    const handle = screen.getByRole("separator");

    fireEvent(handle, new MouseEvent("pointerdown", { bubbles: true, clientY: 200, button: 0 }));
    fireEvent(window, new MouseEvent("pointermove", { bubbles: true, clientY: 150 }));
    expect(screen.getByTestId("height").textContent).toBe("200");

    fireEvent(window, new MouseEvent("pointercancel", { bubbles: true }));
    expect(screen.getByTestId("resizing").textContent).toBe("false");
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(200);

    // Start another drag and unmount mid-drag -> further pointermove must not commit
    fireEvent(handle, new MouseEvent("pointerdown", { bubbles: true, clientY: 100, button: 0 }));
    unmount();
    fireEvent(window, new MouseEvent("pointermove", { bubbles: true, clientY: 150 }));
    fireEvent(window, new MouseEvent("pointerup", { bubbles: true }));
    expect(onCommit).toHaveBeenCalledTimes(1);
  });

  it("allows unlimited growth when max is omitted", () => {
    const onCommit = vi.fn();
    render(<Harness value={300} min={180} onCommit={onCommit} />);
    const handle = screen.getByRole("separator");

    fireEvent(handle, new MouseEvent("pointerdown", { bubbles: true, clientY: 100, button: 0 }));
    fireEvent(window, new MouseEvent("pointermove", { bubbles: true, clientY: 1500 }));
    expect(screen.getByTestId("height").textContent).toBe("1700");

    fireEvent(window, new MouseEvent("pointerup", { bubbles: true }));
    expect(onCommit).toHaveBeenCalledWith(1700);
  });
});
