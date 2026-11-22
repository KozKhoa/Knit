// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "../i18n";
import { reorderSelectedPages } from "../lib/imageSort";
import { isJobCancelledError } from "../lib/ipc";
import type { PageDraft, PdfInfo } from "../types/ipc";
import { Docs2PdfSettingsCard } from "../views/docs2pdf/Docs2PdfSettingsCard";
import { ImagePageCard } from "../views/image2pdf/ImagePageCard";
import { PdfPageContextMenu } from "../views/pdf-ops/PdfPageContextMenu";
import {
  analyzePerPageContiguity,
  buildSelectionsFromFileOrder,
} from "../views/pdf-ops/pdfOpsTypes";
import { ZoomPanViewport } from "./ZoomPanViewport";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

const wrap = (ui: React.ReactElement) => render(<I18nProvider>{ui}</I18nProvider>);

function makeDraft(id: string, name: string): PageDraft {
  return {
    id,
    source: { kind: "image_file", path: `/imgs/${name}` },
    rotation_deg: 0,
    crop: null,
    annotations: { texts: [], strokes: [] },
    duration_ms: null,
    label: name,
    width_px: 100,
    height_px: 100,
    file_size_bytes: 1024,
  };
}

describe("Review 1.15 features", () => {
  it("analyzePerPageContiguity permits file-level reorder and flags interleaving or page edits", () => {
    const files: PdfInfo[] = [
      { path: "/a.pdf", page_count: 2, file_size_bytes: 1000, bookmarks: [] },
      { path: "/b.pdf", page_count: 2, file_size_bytes: 2000, bookmarks: [] },
    ];

    // Reordered whole files (B then A) -> intact!
    const wholeReordered = buildSelectionsFromFileOrder([1, 0], files);
    expect(wholeReordered).toHaveLength(4);
    expect(analyzePerPageContiguity(wholeReordered, files)).toEqual({
      intact: true,
      fileOrder: [1, 0],
    });

    // Interleaved pages -> not intact
    const interleaved = [
      wholeReordered[2], // F0 P0
      wholeReordered[0], // F1 P0
      wholeReordered[3], // F0 P1
      wholeReordered[1], // F1 P1
    ];
    expect(analyzePerPageContiguity(interleaved, files).intact).toBe(false);
    expect(analyzePerPageContiguity(interleaved, files).reason).toBe("interleaved");

    // Deleted or rotated page within one file -> not intact
    const edited = wholeReordered.map((s, idx) =>
      idx === 0 ? { ...s, rotation_deg: 90 } : s,
    );
    expect(analyzePerPageContiguity(edited, files).intact).toBe(false);
    expect(analyzePerPageContiguity(edited, files).reason).toBe("edited");
  });

  it("PdfPageContextMenu renders rotate and delete actions for split_item cards", () => {
    const onRotateSplitItemBy = vi.fn();
    const onDeleteSplitItem = vi.fn();
    const onZoom = vi.fn();
    const onCopyPath = vi.fn();
    const onClose = vi.fn();

    wrap(
      <PdfPageContextMenu
        target={{
          mode: "split_item",
          sectionId: "sec-1",
          uid: "item-uid-1",
          fileIndex: 0,
          pageIndex: 3,
          rotationDeg: 90,
          filePath: "/docs/book.pdf",
          x: 80,
          y: 90,
        }}
        onClose={onClose}
        onRotateSplitItemBy={onRotateSplitItemBy}
        onDeleteSplitItem={onDeleteSplitItem}
        onZoom={onZoom}
        onCopyPath={onCopyPath}
      />,
    );

    expect(screen.getAllByRole("menuitem")).toHaveLength(6);
    fireEvent.click(screen.getByRole("menuitem", { name: "Xoay trái 90°" }));
    expect(onRotateSplitItemBy).toHaveBeenCalledWith("sec-1", "item-uid-1", 270);

    fireEvent.click(screen.getByRole("menuitem", { name: "Xóa trang" }));
    expect(onDeleteSplitItem).toHaveBeenCalledWith("sec-1", "item-uid-1");
  });

  it("ZoomPanViewport zooms on mouse wheel hover, pans on drag, and resets when resetKey changes", () => {
    const { rerender } = wrap(
      <ZoomPanViewport resetKey="img-1">
        <img src="x.png" alt="sample" />
      </ZoomPanViewport>,
    );

    const viewport = screen.getByTestId("zoom-pan-viewport");
    const stage = screen.getByTestId("zoom-pan-stage") as HTMLElement;
    expect(screen.getByTestId("zoom-pan-pct").textContent).toBe("100%");

    // Wheel zoom in
    fireEvent.wheel(viewport, { deltaY: -120, clientX: 200, clientY: 200 });
    expect(screen.getByTestId("zoom-pan-pct").textContent).not.toBe("100%");

    // Drag pan while zoomed
    fireEvent(
      viewport,
      new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 100, clientY: 100 }),
    );
    act(() => {
      window.dispatchEvent(new MouseEvent("pointermove", { clientX: 145, clientY: 130 }));
      window.dispatchEvent(new MouseEvent("pointerup"));
    });
    expect(stage.style.transform).toContain("scale(");
    expect(stage.style.transform).toContain("translate3d(");

    // Changing resetKey restores 100%
    rerender(
      <I18nProvider>
        <ZoomPanViewport resetKey="img-2">
          <img src="y.png" alt="sample2" />
        </ZoomPanViewport>
      </I18nProvider>,
    );
    expect(screen.getByTestId("zoom-pan-pct").textContent).toBe("100%");
  });

  it("isJobCancelledError matches English and Vietnamese cancel messages", () => {
    expect(isJobCancelledError("Job cancelled by user")).toBe(true);
    expect(isJobCancelledError("Tác vụ đã bị hủy bởi người dùng")).toBe(true);
    expect(isJobCancelledError("Tac vu da bi huy")).toBe(true);
    expect(isJobCancelledError("Permission denied")).toBe(false);
  });

  it("Docs2PdfSettingsCard allows start numbering at 0", () => {
    const onChangeStart = vi.fn();
    wrap(
      <Docs2PdfSettingsCard
        theme="github"
        pdfFont="default"
        mermaidTheme="default"
        pageSize="a4"
        orientation="portrait"
        marginMm={20}
        fontSizePt={11}
        lineSpacing={1.45}
        titleOverride=""
        includeToc={false}
        tocPage={1}
        pageNumEnabled={true}
        pageNumPosition="bottom_center"
        pageNumFormat="page_of_total"
        pageNumStartNumber={1}
        pageNumStartFromPage={1}
        onChangeTheme={vi.fn()}
        onChangePdfFont={vi.fn()}
        onChangeMermaidTheme={vi.fn()}
        onChangePageSize={vi.fn()}
        onChangeOrientation={vi.fn()}
        onChangeMarginMm={vi.fn()}
        onChangeFontSizePt={vi.fn()}
        onChangeLineSpacing={vi.fn()}
        onChangeTitleOverride={vi.fn()}
        onChangeIncludeToc={vi.fn()}
        onChangeTocPage={vi.fn()}
        onChangePageNumEnabled={vi.fn()}
        onChangePageNumPosition={vi.fn()}
        onChangePageNumFormat={vi.fn()}
        onChangePageNumStartNumber={onChangeStart}
        onChangePageNumStartFromPage={vi.fn()}
      />,
    );

    const decreaseBtn = screen.getByRole("button", { name: "Decrease Bắt đầu từ số" });
    fireEvent.click(decreaseBtn);
    expect(onChangeStart).toHaveBeenCalledWith(0);
  });

  it("ImagePageCard renders missing-file warning badge when isMissing is true", () => {
    const page = makeDraft("p1", "deleted.jpg");
    wrap(
      <ImagePageCard
        page={page}
        idx={0}
        thumbUrl={undefined}
        thumbBakedSig={undefined}
        thumbBakedRot={0}
        loadThumbs={true}
        isMissing={true}
        missingBadgeLabel="Thiếu tệp"
        isDragged={false}
        isDraggingAny={false}
        showBarLeft={false}
        showBarEnd={false}
        editedBadgeLabel="Đã sửa"
        rotateTitle="Xoay"
        editBtnLabel="Sửa"
        editBtnTitle="Sửa"
        deletePageTitle="Xóa"
        onRegisterRef={vi.fn()}
        onPointerDownCard={vi.fn()}
        onDoubleClickCard={vi.fn()}
        onRotate={vi.fn()}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    expect(screen.getByTestId("missing-image-badge-p1").textContent).toContain("Thiếu tệp");
  });

  it("reorderSelectedPages moves non-adjacent selected images cleanly into a contiguous block at drop slot", () => {
    const pages = ["a", "b", "c", "d", "e"].map((id) => makeDraft(id, `${id}.png`));
    const selected = new Set(["a", "c", "e"]);

    // Drag selected group ("c" handle) and drop before index 2 (after "b")
    const movedMiddle = reorderSelectedPages(pages, selected, "c", 2);
    expect(movedMiddle.map((p) => p.id)).toEqual(["b", "a", "c", "e", "d"]);

    // Drop before index 0 -> selected block moves to front
    const movedFront = reorderSelectedPages(pages, selected, "e", 0);
    expect(movedFront.map((p) => p.id)).toEqual(["a", "c", "e", "b", "d"]);

    // Drop at end -> selected block moves to tail
    const movedEnd = reorderSelectedPages(pages, selected, "a", 5);
    expect(movedEnd.map((p) => p.id)).toEqual(["b", "d", "a", "c", "e"]);
  });

  it("Docs2PdfSettingsCard exposes HTML render modes and event step controls for HTML files", () => {
    const onChangeMode = vi.fn();
    const onChangeKind = vi.fn();
    const onChangeSelector = vi.fn();
    const onTogglePick = vi.fn();
    const { rerender } = wrap(
      <Docs2PdfSettingsCard
        isHtmlFile={true}
        htmlRenderMode="slide_step"
        htmlStepKind="click_selector"
        htmlStepSelector=".next-slide"
        onChangeHtmlRenderMode={onChangeMode}
        onChangeHtmlStepKind={onChangeKind}
        onChangeHtmlStepSelector={onChangeSelector}
        onTogglePickClickPoint={onTogglePick}
        theme="github"
        pdfFont="default"
        mermaidTheme="default"
        pageSize="a4"
        orientation="portrait"
        marginMm={20}
        fontSizePt={11}
        lineSpacing={1.45}
        titleOverride=""
        includeToc={false}
        tocPage={1}
        pageNumEnabled={false}
        pageNumPosition="bottom_center"
        pageNumFormat="page_of_total"
        pageNumStartNumber={1}
        pageNumStartFromPage={1}
        onChangeTheme={vi.fn()}
        onChangePdfFont={vi.fn()}
        onChangeMermaidTheme={vi.fn()}
        onChangePageSize={vi.fn()}
        onChangeOrientation={vi.fn()}
        onChangeMarginMm={vi.fn()}
        onChangeFontSizePt={vi.fn()}
        onChangeLineSpacing={vi.fn()}
        onChangeTitleOverride={vi.fn()}
        onChangeIncludeToc={vi.fn()}
        onChangeTocPage={vi.fn()}
        onChangePageNumEnabled={vi.fn()}
        onChangePageNumPosition={vi.fn()}
        onChangePageNumFormat={vi.fn()}
        onChangePageNumStartNumber={vi.fn()}
        onChangePageNumStartFromPage={vi.fn()}
      />,
    );

    const selectorInput = screen.getByLabelText("CSS Selector nút Next") as HTMLInputElement;
    expect(selectorInput.value).toBe(".next-slide");
    fireEvent.change(selectorInput, { target: { value: "#goNext" } });
    expect(onChangeSelector).toHaveBeenCalledWith("#goNext");

    rerender(
      <Docs2PdfSettingsCard
        isHtmlFile={true}
        htmlRenderMode="slide_step"
        htmlStepKind="click_point"
        htmlStepClickX={0.85}
        htmlStepClickY={0.5}
        onChangeHtmlRenderMode={onChangeMode}
        onChangeHtmlStepKind={onChangeKind}
        onChangeHtmlStepClickX={vi.fn()}
        onChangeHtmlStepClickY={vi.fn()}
        onTogglePickClickPoint={onTogglePick}
        theme="github"
        pdfFont="default"
        mermaidTheme="default"
        pageSize="a4"
        orientation="portrait"
        marginMm={20}
        fontSizePt={11}
        lineSpacing={1.45}
        titleOverride=""
        includeToc={false}
        tocPage={1}
        pageNumEnabled={false}
        pageNumPosition="bottom_center"
        pageNumFormat="page_of_total"
        pageNumStartNumber={1}
        pageNumStartFromPage={1}
        onChangeTheme={vi.fn()}
        onChangePdfFont={vi.fn()}
        onChangeMermaidTheme={vi.fn()}
        onChangePageSize={vi.fn()}
        onChangeOrientation={vi.fn()}
        onChangeMarginMm={vi.fn()}
        onChangeFontSizePt={vi.fn()}
        onChangeLineSpacing={vi.fn()}
        onChangeTitleOverride={vi.fn()}
        onChangeIncludeToc={vi.fn()}
        onChangeTocPage={vi.fn()}
        onChangePageNumEnabled={vi.fn()}
        onChangePageNumPosition={vi.fn()}
        onChangePageNumFormat={vi.fn()}
        onChangePageNumStartNumber={vi.fn()}
        onChangePageNumStartFromPage={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Chọn trên Preview" }));
    expect(onTogglePick).toHaveBeenCalledTimes(1);
  });
});
