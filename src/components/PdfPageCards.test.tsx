// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MergePageCard, SplitSectionItemCard, SplitSourceCard } from "./PdfPageCards";

afterEach(cleanup);

describe("PdfPageCards review v1.11 interactions", () => {
  it("does not trigger double-click zoom when double-clicking Rotate or Remove buttons on MergePageCard", () => {
    const onDoubleClickCard = vi.fn();
    const onRotate = vi.fn();
    const onRemove = vi.fn();

    render(
      <MergePageCard
        idx={0}
        fileIndex={0}
        pageIndex={2}
        rotationDeg={0}
        thumbUrl={undefined}
        isDragged={false}
        isDraggingAny={false}
        showBarLeft={false}
        showBarEnd={false}
        metaText="File 1 · Pg 3 (0°)"
        rotateTitle="Rotate 90"
        deleteTitle="Delete page"
        onRegisterRef={() => {}}
        onPointerDownCard={() => {}}
        onDoubleClickCard={onDoubleClickCard}
        onRotate={onRotate}
        onRemove={onRemove}
      />,
    );

    const rotateBtn = screen.getByTitle("Rotate 90");
    fireEvent.doubleClick(rotateBtn);
    expect(onDoubleClickCard).not.toHaveBeenCalled();

    const removeBtn = screen.getByTitle("Delete page");
    fireEvent.doubleClick(removeBtn);
    expect(onDoubleClickCard).not.toHaveBeenCalled();

    fireEvent.doubleClick(screen.getByText("F1·P3"));
    expect(onDoubleClickCard).toHaveBeenCalledWith(0);
  });

  it("supports multi-file badges, insertion bars, and double-click zoom on SplitSectionItemCard & SplitSourceCard", () => {
    const onDoubleClickItem = vi.fn();
    const onDoubleClickSource = vi.fn();
    const onQuickAdd = vi.fn();

    render(
      <div>
        <SplitSourceCard
          fileIndex={1}
          pageIndex={4}
          showFilePrefix={true}
          thumbUrl={undefined}
          isSelected={false}
          isDraggingAny={false}
          onRegisterRef={() => {}}
          onPointerDownCard={() => {}}
          onDoubleClickCard={onDoubleClickSource}
          onQuickAdd={onQuickAdd}
        />
        <SplitSectionItemCard
          sectionId="sec-1"
          itemIndex={0}
          uid="u-1"
          fileIndex={1}
          pageIndex={4}
          showFilePrefix={true}
          rotationDeg={90}
          thumbUrl={undefined}
          isDragged={false}
          isDraggingAny={false}
          showBarLeft={true}
          showBarEnd={false}
          rotateTitle="Rotate item"
          deleteTitle="Remove item"
          onPointerDownItem={() => {}}
          onDoubleClickItem={onDoubleClickItem}
          onRotateItem={() => {}}
          onRemoveItem={() => {}}
        />
      </div>,
    );

    const quickAddBtn = screen.getByTitle("Add to active section");
    fireEvent.doubleClick(quickAddBtn);
    expect(onDoubleClickSource).not.toHaveBeenCalled();

    const badges = screen.getAllByText("F2·P5");
    expect(badges.length).toBeGreaterThanOrEqual(2);

    fireEvent.doubleClick(screen.getByTitle("Rotate item"));
    expect(onDoubleClickItem).not.toHaveBeenCalled();

    fireEvent.doubleClick(badges[badges.length - 1]);
    expect(onDoubleClickItem).toHaveBeenCalledWith(1, 4, 90);
  });
});
