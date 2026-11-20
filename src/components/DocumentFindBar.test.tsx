// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DocumentFindBar } from "./DocumentFindBar";

afterEach(cleanup);

describe("DocumentFindBar", () => {
  it("shows counter and dispatches Enter, Shift+Enter, Escape, and button navigation", () => {
    const onQueryChange = vi.fn();
    const onPrev = vi.fn();
    const onNext = vi.fn();
    const onClose = vi.fn();

    render(
      <DocumentFindBar
        open={true}
        query="hello"
        activeMatchIndex={1}
        matchCount={4}
        placeholder="Find..."
        prevTitle="Prev"
        nextTitle="Next"
        closeAriaLabel="Close"
        onQueryChange={onQueryChange}
        onPrev={onPrev}
        onNext={onNext}
        onClose={onClose}
      />,
    );

    expect(screen.getByText("2/4")).toBeTruthy();
    const input = screen.getByPlaceholderText("Find...");

    fireEvent.change(input, { target: { value: "world" } });
    expect(onQueryChange).toHaveBeenCalledWith("world");

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onNext).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(onPrev).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTitle("Prev"));
    expect(onPrev).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
