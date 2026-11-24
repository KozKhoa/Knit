// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "../i18n";
import type { BookmarkNode } from "../types/ipc";
import { BookmarkTreeEditor } from "./BookmarkTreeEditor";
import { CardSizeSelector } from "./CardSizeSelector";
import { ExportFilenameControl } from "./ExportFilenameControl";
import { PdfPageContextMenu } from "../views/pdf-ops/PdfPageContextMenu";
import { SplitSectionCard } from "../views/pdf-ops/SplitSectionCard";
import { useVerticalResize } from "../hooks/useVerticalResize";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const wrap = (ui: React.ReactElement) => render(<I18nProvider>{ui}</I18nProvider>);

describe("Review 1.14 components", () => {
  it("CardSizeSelector switches small / medium / large presets", () => {
    const onChange = vi.fn();
    wrap(<CardSizeSelector value="small" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Vừa" }));
    fireEvent.click(screen.getByRole("button", { name: "Lớn" }));

    expect(onChange).toHaveBeenNthCalledWith(1, "medium");
    expect(onChange).toHaveBeenNthCalledWith(2, "large");
  });

  it("ExportFilenameControl renders simple inline size estimate (~223 MB) with no border box or icon", () => {
    wrap(
      <ExportFilenameControl
        value="output.pdf"
        onChange={vi.fn()}
        defaultExportDir="/tmp"
        existsAtDefaultDir={false}
        estimateText="~223 MB"
      />,
    );

    const badge = screen.getByTestId("export-size-estimate");
    expect(badge.textContent).toBe("~223 MB");
    expect(badge.className).not.toContain("border");
    expect(badge.querySelector("svg")).toBeNull();
  });

  it("BookmarkTreeEditor uses matched control height on warning badge and free height even with 1 bookmark", () => {
    window.localStorage.setItem("knit.img2pdf.bookmarkHeightPx", "240");
    const nodes: BookmarkNode[] = [
      { title: "Out of range", target_page_index: 9, children: [] },
    ];
    const { container } = wrap(
      <BookmarkTreeEditor nodes={nodes} totalPages={5} onChange={vi.fn()} />,
    );

    const badge = screen.getByTestId("bookmark-row-warning-0");
    expect(badge.className).toContain("knit-control-sm");
    expect(badge.className).toContain("min-w-8");

    const scrollContainer = container.querySelector(
      "[data-bookmark-editor] .overflow-y-auto",
    ) as HTMLElement | null;
    expect(scrollContainer).not.toBeNull();
    expect(scrollContainer?.style.height).toBe("240px");
    expect(scrollContainer?.style.maxHeight).toBe("");
  });

  it("BookmarkTreeEditor only nests inside when hovering the drag-grip icon, otherwise reorders before/after", () => {
    const nodes: BookmarkNode[] = [
      { title: "Alpha", target_page_index: 0, children: [] },
      { title: "Beta", target_page_index: 1, children: [] },
    ];
    const onChange = vi.fn();
    const { container } = wrap(
      <BookmarkTreeEditor nodes={nodes} totalPages={5} onChange={onChange} />,
    );

    const row0 = container.querySelector('[data-bookmark-path="0"]') as HTMLElement;
    const row1 = container.querySelector('[data-bookmark-path="1"]') as HTMLElement;
    const handle0 = row0.querySelector("[data-bookmark-drag-handle]") as HTMLElement;
    const grip1 = row1.querySelector("[data-bookmark-drag-handle]") as HTMLElement;

    vi.spyOn(row1, "getBoundingClientRect").mockReturnValue({
      top: 50,
      bottom: 90,
      left: 0,
      right: 300,
      width: 300,
      height: 40,
      x: 0,
      y: 50,
      toJSON: () => ({}),
    });

    const origElementsFromPoint = document.elementsFromPoint;

    try {
      // Case 1a: drop on row1 top half (NOT grip) => moves Alpha BEFORE Beta (stays [Alpha, Beta])
      document.elementsFromPoint = vi.fn(() => [row1]) as unknown as typeof document.elementsFromPoint;
      fireEvent(
        handle0,
        new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 10, clientY: 20 }),
      );
      act(() => {
        window.dispatchEvent(new MouseEvent("pointermove", { clientX: 10, clientY: 55 }));
        window.dispatchEvent(new MouseEvent("pointerup", { clientX: 10, clientY: 55 }));
      });
      expect(onChange).toHaveBeenCalledTimes(1);
      const beforeMove = onChange.mock.calls[0][0] as BookmarkNode[];
      expect(beforeMove.map((n) => n.title)).toEqual(["Alpha", "Beta"]);
      onChange.mockClear();

      // Case 1b: drop on row1 bottom half (NOT grip) => moves Alpha AFTER Beta
      fireEvent(
        handle0,
        new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 10, clientY: 20 }),
      );
      act(() => {
        window.dispatchEvent(new MouseEvent("pointermove", { clientX: 10, clientY: 85 }));
        window.dispatchEvent(new MouseEvent("pointerup", { clientX: 10, clientY: 85 }));
      });

      expect(onChange).toHaveBeenCalledTimes(1);
      const afterMove = onChange.mock.calls[0][0] as BookmarkNode[];
      expect(afterMove.map((n) => n.title)).toEqual(["Beta", "Alpha"]);

      // Case 2: drop directly on row1 grip handle => nests Alpha INSIDE Beta
      onChange.mockClear();
      document.elementsFromPoint = vi.fn(() => [grip1, row1]) as unknown as typeof document.elementsFromPoint;
      fireEvent(
        handle0,
        new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 10, clientY: 20 }),
      );
      act(() => {
        window.dispatchEvent(new MouseEvent("pointermove", { clientX: 10, clientY: 70 }));
        window.dispatchEvent(new MouseEvent("pointerup", { clientX: 10, clientY: 70 }));
      });

      expect(onChange).toHaveBeenCalledTimes(1);
      const insideMove = onChange.mock.calls[0][0] as BookmarkNode[];
      expect(insideMove).toHaveLength(1);
      expect(insideMove[0].title).toBe("Beta");
      expect(insideMove[0].children.map((c) => c.title)).toEqual(["Alpha"]);
    } finally {
      document.elementsFromPoint = origElementsFromPoint;
    }
  });

  it("BookmarkTreeEditor supports Undo button, scoped Ctrl+Z, native input Ctrl+Z preservation, and disabled lock", () => {
    const Harness: React.FC<{ disabled?: boolean }> = ({ disabled = false }) => {
      const [nodes, setNodes] = React.useState<BookmarkNode[]>([
        { title: "Ch1", target_page_index: 0, children: [] },
      ]);
      return (
        <div>
          <BookmarkTreeEditor
            nodes={nodes}
            totalPages={5}
            disabled={disabled}
            enableGlobalUndoShortcut={true}
            onChange={setNodes}
          />
          <div data-testid="count">{nodes.length}</div>
        </div>
      );
    };

    const { rerender } = wrap(<Harness />);
    expect(screen.getByTestId("count").textContent).toBe("1");

    // Add bookmark => pushes snapshot
    fireEvent.click(screen.getByRole("button", { name: "Thêm mục chính" }));
    expect(screen.getByTestId("count").textContent).toBe("2");

    // Double-click title to enter input mode; Ctrl+Z inside text input should NOT trigger bookmark tree undo
    const titleSpan = screen.getByText("Ch1");
    fireEvent.doubleClick(titleSpan);
    const titleInput = screen.getByDisplayValue("Ch1") as HTMLInputElement;
    titleInput.focus();
    fireEvent.keyDown(titleInput, { key: "z", ctrlKey: true });
    expect(screen.getByTestId("count").textContent).toBe("2");

    // Esc exits edit mode cleanly, and Ctrl+Z outside text input triggers bookmark tree undo
    fireEvent.keyDown(titleInput, { key: "Escape" });
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(screen.getByTestId("count").textContent).toBe("1");

    // Add again and undo via Undo button
    fireEvent.click(screen.getByRole("button", { name: "Thêm mục chính" }));
    expect(screen.getByTestId("count").textContent).toBe("2");
    fireEvent.click(screen.getByRole("button", { name: /Hoàn tác/i }));
    expect(screen.getByTestId("count").textContent).toBe("1");

    // When disabled=true, page inputs, add button, and double-click title editing are locked
    rerender(
      <I18nProvider>
        <Harness disabled />
      </I18nProvider>,
    );
    expect((screen.getByRole("button", { name: "Thêm mục chính" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("spinbutton") as HTMLInputElement).disabled).toBe(true);
    fireEvent.doubleClick(screen.getByText("Ch1"));
    expect(screen.queryByDisplayValue("Ch1")).toBeNull();
  });

  it("PdfPageContextMenu renders full actions in merge mode and preview/copy only in split mode", () => {
    const onRotateBy = vi.fn();
    const onDelete = vi.fn();
    const onAttachBookmark = vi.fn();
    const onZoom = vi.fn();
    const onCopyPath = vi.fn();
    const onClose = vi.fn();

    const { rerender } = wrap(
      <PdfPageContextMenu
        target={{
          mode: "merge",
          idx: 2,
          fileIndex: 0,
          pageIndex: 4,
          rotationDeg: 90,
          filePath: "/docs/sample.pdf",
          x: 100,
          y: 120,
        }}
        onClose={onClose}
        onRotateBy={onRotateBy}
        onDelete={onDelete}
        onAttachBookmark={onAttachBookmark}
        onZoom={onZoom}
        onCopyPath={onCopyPath}
      />,
    );

    expect(screen.getAllByRole("menuitem")).toHaveLength(7);
    expect(screen.getByText(/sample\.pdf/)).toBeTruthy();
    expect(screen.getByText("Trang xuất: #3")).toBeTruthy();

    fireEvent.click(screen.getByRole("menuitem", { name: "Xoay phải 90°" }));
    expect(onRotateBy).toHaveBeenCalledWith(2, 90);

    fireEvent.click(screen.getByRole("menuitem", { name: "Gắn bookmark tại trang này" }));
    expect(onAttachBookmark).toHaveBeenCalledWith(2, "/docs/sample.pdf", 4);

    // Split mode
    rerender(
      <I18nProvider>
        <PdfPageContextMenu
          target={{
            mode: "split",
            fileIndex: 0,
            pageIndex: 1,
            rotationDeg: 0,
            filePath: "/docs/split.pdf",
            x: 50,
            y: 60,
          }}
          onClose={onClose}
          onZoom={onZoom}
          onCopyPath={onCopyPath}
        />
      </I18nProvider>,
    );
    expect(screen.getAllByRole("menuitem")).toHaveLength(2);
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy đường dẫn file PDF" }));
    expect(onCopyPath).toHaveBeenCalledWith("/docs/split.pdf");
  });

  it("SplitSectionCard keeps constant 1px border on hover (no border-2 layout shift) and respects isLocked", () => {
    const { container } = wrap(
      <SplitSectionCard
        section={{ id: "s1", name: "sec_1", pages: [] }}
        sectionIndex={0}
        isActive={false}
        isHovered={true}
        insertIdx={null}
        dragSourceItemIdx={null}
        isDraggingAny={false}
        isLocked={true}
        canDelete={true}
        showFilePrefix={false}
        explicitSectionHeight={undefined}
        thumbs={{}}
        onActivate={vi.fn()}
        onRename={vi.fn()}
        onClear={vi.fn()}
        onDelete={vi.fn()}
        onResizeHeight={vi.fn()}
        onPointerDownItem={vi.fn()}
        onDoubleClickItem={vi.fn()}
        onRotateItem={vi.fn()}
        onRemoveItem={vi.fn()}
      />,
    );

    const card = container.querySelector('[data-split-section-id="s1"]') as HTMLElement;
    expect(card.className).toContain("border ");
    expect(card.className).toContain("border-dashed");
    expect(card.className).toContain("ring-2");
    expect(card.className).not.toContain("border-2");

    const nameInput = screen.getByDisplayValue("sec_1") as HTMLInputElement;
    expect(nameInput.disabled).toBe(true);
  });

  it("useVerticalResize auto-scrolls scrollable ancestor when dragging near bottom edge", () => {
    vi.useFakeTimers();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) =>
      window.setTimeout(() => cb(performance.now()), 16),
    );
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) =>
      window.clearTimeout(id),
    );
    const onCommit = vi.fn();

    const Harness: React.FC = () => {
      const { height, handlePointerDown } = useVerticalResize({
        value: 200,
        min: 100,
        max: 900,
        onCommit,
      });
      return (
        <div
          data-testid="scroller"
          style={{ overflowY: "auto", height: "400px" }}
        >
          <div style={{ height: `${height}px` }}>
            <div data-testid="handle" onPointerDown={handlePointerDown} />
          </div>
        </div>
      );
    };

    render(<Harness />);
    const scroller = screen.getByTestId("scroller") as HTMLElement;
    const handle = screen.getByTestId("handle") as HTMLElement;

    Object.defineProperty(scroller, "scrollHeight", { value: 1200, configurable: true });
    Object.defineProperty(scroller, "clientHeight", { value: 400, configurable: true });
    vi.spyOn(scroller, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 400,
      left: 0,
      right: 500,
      width: 500,
      height: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    fireEvent(
      handle,
      new MouseEvent("pointerdown", { bubbles: true, button: 0, clientY: 200 }),
    );
    // Drag near bottom edge (within 36px of bottom=400)
    act(() => {
      window.dispatchEvent(new MouseEvent("pointermove", { clientY: 390 }));
    });
    act(() => {
      vi.advanceTimersByTime(64);
    });
    act(() => {
      window.dispatchEvent(new MouseEvent("pointerup", { clientY: 390 }));
    });

    expect(scroller.scrollTop).toBeGreaterThan(0);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][0]).toBeGreaterThan(390);
  });
});
