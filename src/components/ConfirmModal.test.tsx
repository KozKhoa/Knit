// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ConfirmModal } from "./ConfirmModal";

afterEach(cleanup);

describe("ConfirmModal", () => {
  it("renders dialog when open and handles confirm, cancel, backdrop, and Escape", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ConfirmModal
        open={true}
        title="Confirm Remove"
        description="Delete all items?"
        confirmLabel="Remove"
        cancelLabel="Cancel"
        closeAriaLabel="Close"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Confirm Remove")).toBeTruthy();
    expect(screen.getByText("Delete all items?")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <ConfirmModal
        open={false}
        title="Hidden"
        description="Hidden"
        confirmLabel="Yes"
        cancelLabel="No"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
