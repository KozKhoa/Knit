// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const {
  mockPickFiles,
  mockPickSaveFile,
  mockInspectPdf2Md,
  mockExportPdf2Md,
  mockConvertPdfFileToMd,
  mockRefinePdfMdGemini,
  mockGetGeminiKeyStatus,
  mockSaveGeminiKey,
  mockClearGeminiKey,
  mockTestGeminiKey,
} = vi.hoisted(() => ({
  mockPickFiles: vi.fn(),
  mockPickSaveFile: vi.fn(),
  mockInspectPdf2Md: vi.fn(),
  mockExportPdf2Md: vi.fn(),
  mockConvertPdfFileToMd: vi.fn(),
  mockRefinePdfMdGemini: vi.fn(),
  mockGetGeminiKeyStatus: vi.fn(),
  mockSaveGeminiKey: vi.fn(),
  mockClearGeminiKey: vi.fn(),
  mockTestGeminiKey: vi.fn(),
}));

vi.mock("../lib/ipc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/ipc")>();
  return {
    ...actual,
    pickFiles: (...args: Parameters<typeof actual.pickFiles>) =>
      mockPickFiles(...args),
    pickSaveFile: (...args: Parameters<typeof actual.pickSaveFile>) =>
      mockPickSaveFile(...args),
    inspectAndExtractPdfToMd: (
      ...args: Parameters<typeof actual.inspectAndExtractPdfToMd>
    ) => mockInspectPdf2Md(...args),
    exportPdfToMd: (...args: Parameters<typeof actual.exportPdfToMd>) =>
      mockExportPdf2Md(...args),
    convertPdfFileToMd: (
      ...args: Parameters<typeof actual.convertPdfFileToMd>
    ) => mockConvertPdfFileToMd(...args),
    refinePdfMdWithGemini: (
      ...args: Parameters<typeof actual.refinePdfMdWithGemini>
    ) => mockRefinePdfMdGemini(...args),
    getGeminiKeyStatus: (...args: Parameters<typeof actual.getGeminiKeyStatus>) =>
      mockGetGeminiKeyStatus(...args),
    saveGeminiKey: (...args: Parameters<typeof actual.saveGeminiKey>) =>
      mockSaveGeminiKey(...args),
    clearGeminiKey: (...args: Parameters<typeof actual.clearGeminiKey>) =>
      mockClearGeminiKey(...args),
    testGeminiKey: (...args: Parameters<typeof actual.testGeminiKey>) =>
      mockTestGeminiKey(...args),
  };
});

import { I18nProvider } from "../i18n";
import type { BookmarkNode, PageDraft } from "../types/ipc";
import { BookmarkTreeEditor } from "./BookmarkTreeEditor";
import { WorkbenchShell } from "./WorkbenchShell";
import { ImageContextMenu } from "../views/image2pdf/ImageContextMenu";
import { PdfPageContextMenu } from "../views/pdf-ops/PdfPageContextMenu";
import { Pdf2MdView } from "../views/Pdf2MdView";
import { SettingsView } from "../views/SettingsView";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

const wrap = (ui: React.ReactElement) => render(<I18nProvider>{ui}</I18nProvider>);

describe("Review 1.20 components", () => {
  it("Item 5 & 8: BookmarkTreeEditor uses text title by default, edits on double-click, drags on title, renders tree guides, supports Ctrl+C/X/V, and prepends/appends", () => {
    const initial: BookmarkNode[] = [
      {
        title: "Chapter 1",
        target_page_index: 0,
        children: [{ title: "Sub 1.1", target_page_index: 1, children: [] }],
      },
      { title: "Chapter 2", target_page_index: 3, children: [] },
    ];

    const Harness: React.FC = () => {
      const [nodes, setNodes] = React.useState<BookmarkNode[]>(initial);
      return (
        <div>
          <BookmarkTreeEditor
            nodes={nodes}
            totalPages={10}
            presets={[
              { id: "p1", label: "Preset Sample" },
            ]}
            onApplyPreset={() => [{ title: "Preset Root", target_page_index: 0, children: [] }]}
            onChange={setNodes}
          />
          <pre data-testid="bm-json">{JSON.stringify(nodes)}</pre>
        </div>
      );
    };

    const { container } = wrap(<Harness />);

    // Scroll container has overscroll-contain (Item 4)
    const scrollBox = container.querySelector("[data-bookmark-editor] .overflow-y-auto") as HTMLElement;
    expect(scrollBox.className).toContain("overscroll-contain");

    // Hierarchy tree guide lines rendered for nested node [0,0]
    expect(screen.getByTestId("bookmark-tree-guide-0.0")).toBeTruthy();

    // Title is NOT an input by default (only NumberInput spinbutton exists)
    expect(screen.queryByDisplayValue("Chapter 1")).toBeNull();
    const title1 = screen.getByText("Chapter 1");

    // Double-click title -> opens input; Escape cancels; Enter commits
    fireEvent.doubleClick(title1);
    const inputEsc = screen.getByDisplayValue("Chapter 1") as HTMLInputElement;
    fireEvent.change(inputEsc, { target: { value: "Temp" } });
    fireEvent.keyDown(inputEsc, { key: "Escape" });
    expect(screen.getByText("Chapter 1")).toBeTruthy();

    fireEvent.doubleClick(screen.getByText("Chapter 1"));
    const inputCommit = screen.getByDisplayValue("Chapter 1") as HTMLInputElement;
    fireEvent.change(inputCommit, { target: { value: "Chapter One" } });
    fireEvent.keyDown(inputCommit, { key: "Enter" });
    expect(screen.getByText("Chapter One")).toBeTruthy();

    // Ctrl+C marks row0 (and child) as copied, then Ctrl+V duplicates right after itself
    const row0 = container.querySelector('[data-bookmark-path="0"]') as HTMLElement;
    fireEvent.pointerDown(row0, { clientX: 100, clientY: 20, button: 0, pointerType: "mouse" });
    fireEvent.pointerUp(window, { clientX: 100, clientY: 20 });

    const editorEl = container.querySelector('[data-bookmark-editor="true"]') as HTMLElement;
    fireEvent.keyDown(editorEl, { key: "c", ctrlKey: true });
    expect(screen.getByTestId("bookmark-clipboard-notice")).toBeTruthy();
    expect(container.querySelector('[data-bookmark-path="0"]')?.getAttribute("data-bookmark-clipboard")).toBe("copy");
    expect(container.querySelector('[data-bookmark-path="0.0"]')?.getAttribute("data-bookmark-clipboard")).toBe("copy");
    expect(container.querySelector('[data-bookmark-path="0"]')?.className).toContain("bg-[#E9ECEF]");

    fireEvent.keyDown(editorEl, { key: "v", ctrlKey: true });

    const afterPaste = JSON.parse(screen.getByTestId("bm-json").textContent ?? "[]") as BookmarkNode[];
    expect(afterPaste.map((n) => n.title)).toEqual(["Chapter One", "Chapter One", "Chapter 2"]);
    expect(afterPaste[1].children.map((c) => c.title)).toEqual(["Sub 1.1"]);

    // Ctrl+X marks row1 as cut (faded opacity-50 + gray), then Ctrl+V on row2 moves it after Chapter 2
    const row1 = container.querySelector('[data-bookmark-path="1"]') as HTMLElement;
    fireEvent.pointerDown(row1, { clientX: 100, clientY: 60, button: 0, pointerType: "mouse" });
    fireEvent.pointerUp(window, { clientX: 100, clientY: 60 });
    fireEvent.keyDown(editorEl, { key: "x", ctrlKey: true });
    const cutRow1 = container.querySelector('[data-bookmark-path="1"]') as HTMLElement;
    expect(cutRow1.getAttribute("data-bookmark-clipboard")).toBe("cut");
    expect(cutRow1.className).toContain("opacity-50");
    expect(cutRow1.className).toContain("bg-[#E9ECEF]");

    const row2BeforePaste = container.querySelector('[data-bookmark-path="2"]') as HTMLElement;
    fireEvent.pointerDown(row2BeforePaste, { clientX: 100, clientY: 100, button: 0, pointerType: "mouse" });
    fireEvent.pointerUp(window, { clientX: 100, clientY: 100 });
    fireEvent.keyDown(editorEl, { key: "v", ctrlKey: true });

    const afterCutPaste = JSON.parse(screen.getByTestId("bm-json").textContent ?? "[]") as BookmarkNode[];
    expect(afterCutPaste.map((n) => n.title)).toEqual(["Chapter One", "Chapter 2", "Chapter One"]);
    expect(container.querySelector('[data-bookmark-clipboard="cut"]')).toBeNull();

    // Delete the moved duplicate at index 2 so prepend/drag assertions below remain cleanly on 2 nodes
    const deleteMovedBtn = container.querySelector(
      '[data-bookmark-path="2"] button[title="Xóa mục này"]',
    ) as HTMLButtonElement;
    fireEvent.click(deleteMovedBtn);
    const afterCleanup = JSON.parse(screen.getByTestId("bm-json").textContent ?? "[]") as BookmarkNode[];
    expect(afterCleanup.map((n) => n.title)).toEqual(["Chapter One", "Chapter 2"]);

    // Toggle insert position to "Đầu cây" (start) and add root bookmark
    fireEvent.click(screen.getByTestId("bookmark-insert-start-btn"));
    fireEvent.click(screen.getByRole("button", { name: "Thêm mục chính" }));
    const afterPrepend = JSON.parse(screen.getByTestId("bm-json").textContent ?? "[]") as BookmarkNode[];
    expect(afterPrepend[0].title).toBe("Mục lục 3");

    // Dragging directly on title reorders Chapter 2 before Chapter One
    const rowCh2 = container.querySelector('[data-bookmark-path="2"]') as HTMLElement;
    const rowCh1 = container.querySelector('[data-bookmark-path="1"]') as HTMLElement;
    const ch2Title = rowCh2.querySelector("[data-bookmark-title]") as HTMLElement;

    vi.spyOn(rowCh1, "getBoundingClientRect").mockReturnValue({
      top: 40,
      bottom: 80,
      left: 0,
      right: 300,
      width: 300,
      height: 40,
      x: 0,
      y: 40,
      toJSON: () => ({}),
    });
    const origElementsFromPoint = document.elementsFromPoint;
    try {
      document.elementsFromPoint = vi.fn(() => [rowCh1]) as unknown as typeof document.elementsFromPoint;
      const titleMouseDown = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 });
      ch2Title.dispatchEvent(titleMouseDown);
      expect(titleMouseDown.defaultPrevented).toBe(true);
      expect(rowCh2.className).toContain("select-none");

      fireEvent(ch2Title, new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 120, clientY: 100 }));
      act(() => {
        window.dispatchEvent(new MouseEvent("pointermove", { clientX: 120, clientY: 45 }));
        window.dispatchEvent(new MouseEvent("pointerup", { clientX: 120, clientY: 45 }));
      });
      const afterTitleDrag = JSON.parse(screen.getByTestId("bm-json").textContent ?? "[]") as BookmarkNode[];
      expect(afterTitleDrag.map((n) => n.title)).toEqual(["Mục lục 3", "Chapter 2", "Chapter One"]);
    } finally {
      document.elementsFromPoint = origElementsFromPoint;
    }

    // Apply preset via dropdown and verify selected label stays visible on combobox
    const presetCombo = screen.getByRole("combobox", { name: "Preset:" });
    fireEvent.click(presetCombo);
    fireEvent.click(screen.getByRole("option", { name: "Preset Sample" }));
    expect(presetCombo.textContent).toContain("Preset Sample");
    const afterPreset = JSON.parse(screen.getByTestId("bm-json").textContent ?? "[]") as BookmarkNode[];
    expect(afterPreset).toEqual([{ title: "Preset Root", target_page_index: 0, children: [] }]);
  });

  it("Item 2 & 6: PdfPageContextMenu handles merge_file preview + attach/remove bookmark, and ImageContextMenu toggles remove bookmark", () => {
    const onPreviewFile = vi.fn();
    const onAttachBookmark = vi.fn();
    const onRemoveBookmark = vi.fn();
    const onZoom = vi.fn();

    const { rerender } = wrap(
      <PdfPageContextMenu
        target={{
          mode: "merge_file",
          fileIndex: 1,
          fileOrderIdx: 0,
          targetPageIdx: 4,
          filePath: "/docs/vol2.pdf",
          hasBookmark: true,
          x: 50,
          y: 50,
        }}
        onClose={vi.fn()}
        onPreviewFile={onPreviewFile}
        onAttachBookmark={onAttachBookmark}
        onRemoveBookmark={onRemoveBookmark}
        onZoom={onZoom}
        onCopyPath={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("menuitem", { name: "Xem preview toàn bộ tệp PDF" }));
    expect(onPreviewFile).toHaveBeenCalledWith(1);
    expect(onZoom).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("menuitem", { name: "Gắn bookmark tại trang này" }));
    expect(onAttachBookmark).toHaveBeenCalledWith(4, "/docs/vol2.pdf", 0);

    fireEvent.click(screen.getByRole("menuitem", { name: "Xóa bookmark tại trang này" }));
    expect(onRemoveBookmark).toHaveBeenCalledWith(4);

    // ImageContextMenu with hasBookmark=true shows Remove bookmark
    const samplePage: PageDraft = {
      id: "p1",
      source: { kind: "image_file", path: "/img/001.jpg" },
      rotation_deg: 0,
      crop: null,
      annotations: { texts: [], strokes: [] },
      duration_ms: null,
      label: "001.jpg",
      width_px: 100,
      height_px: 100,
    };
    const onRemoveImgBm = vi.fn();
    rerender(
      <I18nProvider>
        <ImageContextMenu
          page={samplePage}
          pageIndex={2}
          hasBookmark={true}
          x={50}
          y={50}
          onClose={vi.fn()}
          onRotateBy={vi.fn()}
          onDelete={vi.fn()}
          onPreviewInfo={vi.fn()}
          onCopyImagePath={vi.fn()}
          onCopyFolderPath={vi.fn()}
          onAttachBookmark={vi.fn()}
          onRemoveBookmark={onRemoveImgBm}
          onSelectPage={vi.fn()}
        />
      </I18nProvider>,
    );

    fireEvent.click(screen.getByRole("menuitem", { name: "Xóa bookmark tại ảnh này" }));
    expect(onRemoveImgBm).toHaveBeenCalledWith(2);
  });

  it("Item 4: WorkbenchShell prevents wheel scroll chaining past boundary of hovered inner scroll container", () => {
    const { container } = wrap(
      <WorkbenchShell
        activeTool="image2pdf"
        onSelectTool={vi.fn()}
        onCancelJob={vi.fn()}
        logs={[]}
        onClearLogs={vi.fn()}
        history={[]}
      >
        <div data-testid="inner-scroll" style={{ overflowY: "auto", height: "100px" }}>
          <div style={{ height: "400px" }}>Inner content</div>
        </div>
      </WorkbenchShell>,
    );

    const inner = screen.getByTestId("inner-scroll");
    const mainEl = container.querySelector("main") as HTMLElement;
    expect(mainEl).toBeTruthy();

    Object.defineProperty(inner, "scrollHeight", { value: 400, configurable: true });
    Object.defineProperty(inner, "clientHeight", { value: 100, configurable: true });
    Object.defineProperty(inner, "scrollTop", { value: 300, configurable: true });

    const wheelDownAtBottom = new WheelEvent("wheel", {
      deltaY: 50,
      bubbles: true,
      cancelable: true,
    });
    inner.dispatchEvent(wheelDownAtBottom);
    expect(wheelDownAtBottom.defaultPrevented).toBe(true);

    // When NOT at bottom (scrollTop = 100), allow scrolling inner container normally
    Object.defineProperty(inner, "scrollTop", { value: 100, configurable: true });
    const wheelDownMiddle = new WheelEvent("wheel", {
      deltaY: 50,
      bubbles: true,
      cancelable: true,
    });
    inner.dispatchEvent(wheelDownMiddle);
    expect(wheelDownMiddle.defaultPrevented).toBe(false);
  });

  it("Pdf2MdView renders scanned warning, triggers on-demand Gemini cleanup, and supports Undo AI", async () => {
    mockGetGeminiKeyStatus.mockResolvedValue({
      configured: true,
      masked_key: "AIza••••9999",
      storage_backend: "config_file",
      model: "gemini-2.5-flash",
    });
    mockPickFiles.mockResolvedValueOnce(["/tmp/scanned_notes.pdf"]);
    mockInspectPdf2Md.mockResolvedValueOnce({
      source_path: "/tmp/scanned_notes.pdf",
      page_count: 2,
      file_size_bytes: 4096,
      outlines: [],
      scanned_page_indices: [1],
      is_scanned_document: false,
      extracted_image_count: 1,
      markdown: "<!-- page: 1 -->\n\n# Raw Heading\n\nBroken line\nwrap text.",
      pages: [
        {
          page_index: 0,
          markdown: "# Raw Heading",
          word_count: 6,
          image_count: 0,
          is_likely_scanned: false,
        },
        {
          page_index: 1,
          markdown: "",
          word_count: 0,
          image_count: 1,
          is_likely_scanned: true,
        },
      ],
    });
    mockRefinePdfMdGemini.mockResolvedValueOnce({
      markdown: "<!-- page: 1 -->\n\n# Clean Heading\n\nJoined paragraph text.",
      model: "gemini-2.5-flash",
      total_chunks: 1,
      refined_chunks: 1,
      fallback_chunks: 0,
      warnings: [],
    });

    wrap(
      <Pdf2MdView
        onStartJob={vi.fn()}
        onJobEvent={vi.fn()}
        onFinishJob={vi.fn()}
        busy={false}
        isActive={true}
      />,
    );

    const pickBtn = screen.getByRole("button", { name: /Chọn tệp PDF/i });
    fireEvent.click(pickBtn);

    await waitFor(() => {
      expect(screen.getByTestId("pdf2md-scanned-warning")).toBeTruthy();
    });

    // Dropzone hides after importing a PDF and Change / Close buttons appear in header
    expect(screen.queryByRole("button", { name: /Chọn tệp PDF/i })).toBeNull();
    expect(screen.getByRole("button", { name: /Đổi tệp PDF/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Đóng tệp/i })).toBeTruthy();

    // Must not call Gemini automatically on load
    expect(mockRefinePdfMdGemini).not.toHaveBeenCalled();

    // Selecting without highlight shows error instead of calling Gemini
    fireEvent.click(screen.getByTestId("pdf2md-gemini-selection-btn"));
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(mockRefinePdfMdGemini).not.toHaveBeenCalled();

    // Refine full Markdown on demand
    fireEvent.click(screen.getByTestId("pdf2md-gemini-all-btn"));
    await waitFor(() => {
      expect(mockRefinePdfMdGemini).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("pdf2md-undo-ai-btn")).toBeTruthy();
    });

    expect(screen.getByText(/Gemini đã tinh chỉnh xong 1\/1/)).toBeTruthy();

    // Undo AI clears Undo button & restores previous Markdown snapshot
    fireEvent.click(screen.getByTestId("pdf2md-undo-ai-btn"));
    expect(screen.queryByTestId("pdf2md-undo-ai-btn")).toBeNull();
  });

  it("Pdf2MdView supports direct_export (import only without preview/extract) and md_only modes via select box", async () => {
    mockGetGeminiKeyStatus.mockResolvedValue({
      configured: false,
      masked_key: null,
      storage_backend: "none",
      model: "gemini-2.5-flash",
    });
    mockPickFiles.mockResolvedValueOnce(["/tmp/huge_200mb.pdf"]);
    mockPickSaveFile.mockResolvedValueOnce("/tmp/huge_200mb.md");
    mockConvertPdfFileToMd.mockResolvedValueOnce({
      output_path: "/tmp/huge_200mb.md",
      asset_dir: null,
      written_image_count: 0,
      bytes_written: 1024,
      page_count: 10,
    });
    mockInspectPdf2Md.mockResolvedValueOnce({
      source_path: "/tmp/huge_200mb.pdf",
      page_count: 10,
      file_size_bytes: 200 * 1024 * 1024,
      outlines: [],
      scanned_page_indices: [],
      is_scanned_document: false,
      extracted_image_count: 0,
      markdown: "# Loaded on switch",
      pages: [],
    });

    wrap(
      <Pdf2MdView
        onStartJob={vi.fn()}
        onJobEvent={vi.fn()}
        onFinishJob={vi.fn()}
        busy={false}
        isActive={true}
      />,
    );

    // Choose direct_export via custom Select component
    fireEvent.click(screen.getByTestId("pdf2md-load-mode-select"));
    fireEvent.click(
      screen.getByRole("option", {
        name: /Chỉ Import tệp/i,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: /Chọn tệp PDF/i }));
    await waitFor(() => {
      expect(screen.getByTestId("pdf2md-direct-export-banner")).toBeTruthy();
    });

    // Must not extract Markdown or load preview when importing in direct_export mode
    expect(mockInspectPdf2Md).not.toHaveBeenCalled();

    // Direct Export runs single-pass convertPdfFileToMd
    fireEvent.click(screen.getByTestId("pdf2md-export-btn"));
    await waitFor(() => {
      expect(mockConvertPdfFileToMd).toHaveBeenCalledTimes(1);
    });

    // Switching to md_only triggers Markdown extraction while keeping preview skipped
    fireEvent.click(screen.getByTestId("pdf2md-load-mode-select"));
    fireEvent.click(
      screen.getByRole("option", {
        name: /Chỉ chuyển Markdown/i,
      }),
    );
    await waitFor(() => {
      expect(mockInspectPdf2Md).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText("Xem trước PDF gốc")).toBeNull();
  });

  it("Pdf2MdView displays ~/ path preserving filename, shows large-PDF banner >=300MB, and confirms before overwriting edits on option toggle", async () => {
    mockGetGeminiKeyStatus.mockResolvedValue({
      configured: true,
      masked_key: "AIza••••9999",
      storage_backend: "keychain",
      model: "gemini-2.5-flash",
    });
    mockPickFiles.mockResolvedValueOnce([
      "/home/khoa/Downloads/very/deep/folder/structure/Konosuba_Vol_1_Special_Edition.pdf",
    ]);
    mockInspectPdf2Md
      .mockResolvedValueOnce({
        source_path:
          "/home/khoa/Downloads/very/deep/folder/structure/Konosuba_Vol_1_Special_Edition.pdf",
        page_count: 320,
        file_size_bytes: 350 * 1024 * 1024,
        outlines: [],
        scanned_page_indices: [],
        is_scanned_document: false,
        extracted_image_count: 2,
        markdown: "<!-- page: 1 -->\n\n# Original",
        pages: [],
      })
      .mockResolvedValueOnce({
        source_path:
          "/home/khoa/Downloads/very/deep/folder/structure/Konosuba_Vol_1_Special_Edition.pdf",
        page_count: 320,
        file_size_bytes: 350 * 1024 * 1024,
        outlines: [],
        scanned_page_indices: [],
        is_scanned_document: false,
        extracted_image_count: 2,
        markdown: "# Original without markers",
        pages: [],
      });
    mockRefinePdfMdGemini.mockResolvedValueOnce({
      markdown: "<!-- page: 1 -->\n\n# Manually or AI Edited",
      model: "gemini-2.5-flash",
      total_chunks: 1,
      refined_chunks: 1,
      fallback_chunks: 0,
      warnings: [],
    });

    wrap(
      <Pdf2MdView
        onStartJob={vi.fn()}
        onJobEvent={vi.fn()}
        onFinishJob={vi.fn()}
        busy={false}
        isActive={true}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Chọn tệp PDF/i }));
    await waitFor(() => {
      expect(screen.getByTestId("pdf2md-source-path")).toBeTruthy();
    });

    const sourcePathEl = screen.getByTestId("pdf2md-source-path");
    expect(sourcePathEl.textContent).toContain("~/Downloads/very/deep/folder/structure/");
    expect(sourcePathEl.textContent).toContain("Konosuba_Vol_1_Special_Edition.pdf");
    expect(screen.getByTestId("pdf2md-large-file-banner")).toBeTruthy();

    // Mutate markdown via AI refine so it diverges from lastExtractedMarkdownRef
    fireEvent.click(screen.getByTestId("pdf2md-gemini-all-btn"));
    await waitFor(() => {
      expect(screen.getByTestId("pdf2md-undo-ai-btn")).toBeTruthy();
    });

    // Toggling page markers checkbox when edited must prompt confirmation first
    const pageMarkersCheckbox = screen.getByLabelText(/Chèn đánh dấu trang/i);
    fireEvent.click(pageMarkersCheckbox);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(mockInspectPdf2Md).toHaveBeenCalledTimes(1);

    // Confirm regeneration -> calls cached extraction with updated option
    fireEvent.click(screen.getByRole("button", { name: /Áp dụng & Tạo lại/i }));
    await waitFor(() => {
      expect(mockInspectPdf2Md).toHaveBeenCalledTimes(2);
    });
  });

  it("SettingsView manages optional Gemini API key save, test, and clear flows", async () => {
    mockGetGeminiKeyStatus.mockResolvedValueOnce({
      configured: false,
      masked_key: null,
      storage_backend: "none",
      model: "gemini-2.5-flash",
    });
    mockSaveGeminiKey.mockResolvedValueOnce({
      configured: true,
      masked_key: "AIza••••5678",
      storage_backend: "keychain",
      model: "gemini-2.5-flash",
    });
    mockTestGeminiKey.mockResolvedValueOnce({
      configured: true,
      masked_key: "AIza••••5678",
      storage_backend: "keychain",
      model: "gemini-2.5-flash",
    });
    mockClearGeminiKey.mockResolvedValueOnce({
      configured: false,
      masked_key: null,
      storage_backend: "none",
      model: "gemini-2.5-flash",
    });

    wrap(
      <SettingsView
        fontFamily="system"
        onChangeFontFamily={vi.fn()}
        fontSizePx={14}
        onChangeFontSizePx={vi.fn()}
        logVerbosity="minimal"
        onChangeLogVerbosity={vi.fn()}
        defaultExportDir=""
        onChangeDefaultExportDir={vi.fn()}
      />,
    );

    expect(screen.getByTestId("settings-gemini-card")).toBeTruthy();
    const input = screen.getByTestId("settings-gemini-key-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "AIzaFakeSecretKey12345678" } });

    fireEvent.click(screen.getByTestId("settings-gemini-save-btn"));
    await waitFor(() => {
      expect(mockSaveGeminiKey).toHaveBeenCalledWith("AIzaFakeSecretKey12345678");
      expect(screen.getByText(/AIza••••5678/)).toBeTruthy();
    });
    expect(input.value).toBe("");

    fireEvent.click(screen.getByTestId("settings-gemini-test-btn"));
    await waitFor(() => {
      expect(mockTestGeminiKey).toHaveBeenCalledWith(null);
      expect(screen.getByText(/Kết nối Gemini thành công/)).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId("settings-gemini-clear-btn"));
    await waitFor(() => {
      expect(mockClearGeminiKey).toHaveBeenCalledTimes(1);
      expect(screen.getByText("Chưa cấu hình")).toBeTruthy();
    });
  });
});
