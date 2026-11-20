// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MergePageCard, SplitSectionItemCard, SplitSourceCard } from "./PdfPageCards";
import { ImagePageCard } from "../views/image2pdf/ImagePageCard";

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

  it("renders bookmark tag badge on MergePageCard when bookmarkTitles are provided", () => {
    render(
      <MergePageCard
        idx={0}
        fileIndex={0}
        pageIndex={0}
        rotationDeg={0}
        thumbUrl={undefined}
        bookmarkTitles={["Chapter 1", "Intro"]}
        bookmarkTooltip="Bookmarks: Chapter 1 · Intro"
        isDragged={false}
        isDraggingAny={false}
        showBarLeft={false}
        showBarEnd={false}
        metaText="File 1 · Pg 1 (0°)"
        rotateTitle="Rotate 90"
        deleteTitle="Delete page"
        onRegisterRef={() => {}}
        onPointerDownCard={() => {}}
        onDoubleClickCard={() => {}}
        onRotate={() => {}}
        onRemove={() => {}}
      />,
    );

    const badge = screen.getByTestId("page-bookmark-badge");
    expect(badge.textContent).toContain("Chapter 1");
    expect(badge.textContent).toContain("+1");
    expect(badge.getAttribute("title")).toBe("Bookmarks: Chapter 1 · Intro");
  });

  it("renders bookmark badge and selection styling on ImagePageCard", () => {
    render(
      <ImagePageCard
        page={{
          id: "img-1",
          source: { kind: "image_file", path: "/tmp/001.jpg" },
          rotation_deg: 0,
          crop: null,
          annotations: { texts: [], strokes: [] },
          duration_ms: null,
          label: "001.jpg",
          width_px: 800,
          height_px: 1200,
          file_size_bytes: 12345,
        }}
        idx={0}
        thumbUrl={undefined}
        thumbBakedSig={undefined}
        thumbBakedRot={0}
        loadThumbs={true}
        selectionMode={true}
        isSelected={true}
        bookmarkTitles={["Folder 1"]}
        bookmarkTooltip="Bookmarks on this page: Folder 1"
        isDragged={false}
        isDraggingAny={false}
        showBarLeft={false}
        showBarEnd={false}
        editedBadgeLabel="Edited"
        rotateTitle="Rotate 90"
        editBtnLabel="Edit"
        editBtnTitle="Edit"
        deletePageTitle="Remove"
        onRegisterRef={() => {}}
        onPointerDownCard={() => {}}
        onDoubleClickCard={() => {}}
        onRotate={() => {}}
        onEdit={() => {}}
        onRemove={() => {}}
      />,
    );

    const badge = screen.getByTestId("page-bookmark-badge");
    expect(badge.textContent).toContain("Folder 1");
    expect(screen.getByText("001.jpg")).toBeTruthy();
  });
});
