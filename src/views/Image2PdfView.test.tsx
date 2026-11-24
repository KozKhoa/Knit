// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "../i18n";
import type { BookmarkNode, PageDraft } from "../types/ipc";

const ipcMocks = vi.hoisted(() => ({
  buildImage2Pdf: vi.fn(),
  checkExportConflicts: vi.fn(),
  checkMissingFiles: vi.fn(),
  clearImagePreviewCache: vi.fn(),
  isTauriRuntime: vi.fn(),
  pickDirectory: vi.fn(),
  pickFiles: vi.fn(),
  pickSaveFile: vi.fn(),
  renderImageThumbBase64: vi.fn(),
  renderImageThumbFile: vi.fn(),
  renderPageDraftPreviewFile: vi.fn(),
  resolveUniqueExportPath: vi.fn(),
  scanImagesForPdf: vi.fn(),
  syncAnimatedDrafts: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}));

vi.mock("../lib/ipc", () => ({
  buildImage2Pdf: ipcMocks.buildImage2Pdf,
  checkExportConflicts: ipcMocks.checkExportConflicts,
  checkMissingFiles: ipcMocks.checkMissingFiles,
  clearImagePreviewCache: ipcMocks.clearImagePreviewCache,
  formatBytes: (n: number) => `${n} B`,
  isJobCancelledError: (msg: string) => {
    const lower = msg.toLowerCase();
    return lower.includes("cancel") || lower.includes("hủy") || lower.includes("huy");
  },
  isTauriRuntime: ipcMocks.isTauriRuntime,
  pickDirectory: ipcMocks.pickDirectory,
  pickFiles: ipcMocks.pickFiles,
  pickSaveFile: ipcMocks.pickSaveFile,
  renderImageThumbBase64: ipcMocks.renderImageThumbBase64,
  renderImageThumbFile: ipcMocks.renderImageThumbFile,
  renderPageDraftPreviewFile: ipcMocks.renderPageDraftPreviewFile,
  resolveUniqueExportPath: ipcMocks.resolveUniqueExportPath,
  scanImagesForPdf: ipcMocks.scanImagesForPdf,
  syncAnimatedDrafts: ipcMocks.syncAnimatedDrafts,
}));

import { Image2PdfView } from "./Image2PdfView";

function makeDraft(id: string, name: string): PageDraft {
  return {
    id,
    source: { kind: "image_file", path: `/${name}` },
    rotation_deg: 0,
    crop: null,
    annotations: { texts: [], strokes: [] },
    duration_ms: null,
    label: name,
    width_px: 200,
    height_px: 300,
    file_size_bytes: 2048,
  };
}

function makePointer(
  type: string,
  opts: {
    clientX?: number;
    clientY?: number;
    button?: number;
    shiftKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    timeStamp?: number;
  } = {},
): MouseEvent {
  const ev = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: opts.button ?? 0,
    clientX: opts.clientX ?? 10,
    clientY: opts.clientY ?? 10,
    shiftKey: opts.shiftKey ?? false,
    ctrlKey: opts.ctrlKey ?? false,
    metaKey: opts.metaKey ?? false,
    altKey: opts.altKey ?? false,
  });
  if (opts.timeStamp !== undefined) {
    Object.defineProperty(ev, "timeStamp", { value: opts.timeStamp });
  }
  return ev;
}

function renderImage2Pdf(
  overrides: Partial<React.ComponentProps<typeof Image2PdfView>> = {},
) {
  const onStartJob = vi.fn();
  const onJobEvent = vi.fn();
  const onFinishJob = vi.fn();
  const view = render(
    <I18nProvider>
      <Image2PdfView
        onStartJob={onStartJob}
        onJobEvent={onJobEvent}
        onFinishJob={onFinishJob}
        busy={false}
        {...overrides}
      />
    </I18nProvider>,
  );
  return { ...view, onStartJob, onJobEvent, onFinishJob };
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  ipcMocks.isTauriRuntime.mockReturnValue(false);
  ipcMocks.checkMissingFiles.mockResolvedValue([]);
  ipcMocks.checkExportConflicts.mockResolvedValue([]);
  ipcMocks.clearImagePreviewCache.mockResolvedValue(undefined);
  ipcMocks.resolveUniqueExportPath.mockImplementation(async (p: string) => p);
  ipcMocks.pickSaveFile.mockResolvedValue("/tmp/out.pdf");
  ipcMocks.buildImage2Pdf.mockImplementation(async (_jobId, drafts, _bms, config) => ({
    output_files: [config.output_path],
    total_pages: drafts.length,
    total_bytes: 1234,
    passthrough_pages: drafts.length,
  }));
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

async function importFourPages(bookmarks: BookmarkNode[] = []) {
  const pages = [
    makeDraft("p1", "1.jpg"),
    makeDraft("p2", "2.jpg"),
    makeDraft("p3", "3.jpg"),
    makeDraft("p4", "4.jpg"),
  ];
  ipcMocks.scanImagesForPdf.mockResolvedValueOnce({
    pages,
    bookmarks,
    warnings: [],
  });
  const ctx = renderImage2Pdf({
    droppedBatch: { seq: 1, paths: ["/1.jpg", "/2.jpg", "/3.jpg", "/4.jpg"] },
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return ctx;
}

describe("Image2PdfView functional automation (Layer 2)", () => {
  it("TC-ST-01 & TC-ST-02: distinguishes drag move (>=5px) from 400ms long-press SelectionMode, Shift range, batch rotate, Undo, and Esc", async () => {
    vi.useFakeTimers();
    const { container } = await importFourPages();

    // TC-ST-02: Pointer down on p1, move >=5px quickly -> cancels hold timer, does NOT enter SelectionMode
    const card1 = container.querySelector('[data-page-id="p1"]') as HTMLElement;
    act(() => {
      card1.dispatchEvent(makePointer("pointerdown", { clientX: 10, clientY: 10, timeStamp: 100 }));
      window.dispatchEvent(makePointer("pointermove", { clientX: 30, clientY: 10, timeStamp: 150 }));
      vi.advanceTimersByTime(450);
      window.dispatchEvent(makePointer("pointerup", { clientX: 30, clientY: 10, timeStamp: 600 }));
    });
    expect(screen.queryByRole("button", { name: "Thoát chọn (Esc)" })).toBeNull();
    expect(screen.queryByText(/Đang chọn \d+ ảnh/)).toBeNull();

    // TC-ST-01: Hold stationary on p2 for >=400ms -> enters SelectionMode with p2 selected
    const card2 = container.querySelector('[data-page-id="p2"]') as HTMLElement;
    act(() => {
      card2.dispatchEvent(makePointer("pointerdown", { clientX: 10, clientY: 10, timeStamp: 1000 }));
      vi.advanceTimersByTime(450);
      window.dispatchEvent(makePointer("pointerup", { clientX: 10, clientY: 10, timeStamp: 1450 }));
    });
    expect(screen.getByText("Đang chọn 1 ảnh")).toBeTruthy();

    // Shift+Click p4 -> selects range p2..p4 (3 pages)
    const card4 = container.querySelector('[data-page-id="p4"]') as HTMLElement;
    act(() => {
      card4.dispatchEvent(
        makePointer("pointerdown", { clientX: 10, clientY: 10, shiftKey: true, timeStamp: 1500 }),
      );
      window.dispatchEvent(
        makePointer("pointerup", { clientX: 10, clientY: 10, shiftKey: true, timeStamp: 1520 }),
      );
    });
    expect(screen.getByText("Đang chọn 3 ảnh")).toBeTruthy();

    // Batch rotate 90 deg -> 3 "Đã sửa" badges appear
    fireEvent.click(screen.getByText("Xoay 90°"));
    expect(screen.getAllByText("Đã sửa")).toHaveLength(3);

    // Undo restores original rotation -> 0 "Đã sửa" badges
    fireEvent.click(screen.getByTitle("Hoàn tác thao tác trang (Ctrl+Z)"));
    expect(screen.queryAllByText("Đã sửa")).toHaveLength(0);

    // Press Escape -> exits SelectionMode
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("button", { name: "Thoát chọn (Esc)" })).toBeNull();
  });

  it("TC-UCT-02: deleting pages remaps bookmark intervals and Ctrl+Z / Undo restores both pages and bookmarks", async () => {
    const bookmarks: BookmarkNode[] = [
      { title: "Chap 1", target_page_index: 0, children: [] },
      { title: "Chap 2", target_page_index: 2, children: [] },
    ];
    await importFourPages(bookmarks);
    expect(screen.getByText("Xuất PDF (4 trang)")).toBeTruthy();

    // Delete first page (p1, part of Chap 1): Chap 1 stays at idx 0 (now p2), Chap 2 shifts 2 -> 1
    fireEvent.click(screen.getAllByTitle("Xóa trang")[0]);
    expect(screen.getByText("Xuất PDF (3 trang)")).toBeTruthy();
    expect(screen.getAllByText("Chap 1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Chap 2").length).toBeGreaterThan(0);

    // Delete p2 (last remaining page of Chap 1): Chap 1 is dropped cleanly, Chap 2 shifts to idx 0
    fireEvent.click(screen.getAllByTitle("Xóa trang")[0]);
    expect(screen.getByText("Xuất PDF (2 trang)")).toBeTruthy();
    expect(screen.queryByText("Chap 1")).toBeNull();
    expect(screen.getAllByText("Chap 2").length).toBeGreaterThan(0);

    // Undo twice via Ctrl+Z -> restores all 4 pages and both Chap 1 & Chap 2
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    expect(screen.getByText("Xuất PDF (4 trang)")).toBeTruthy();
    expect(screen.getAllByText("Chap 1").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Chap 2").length).toBeGreaterThan(0);
  });

  it("TC-ST-04: preflight checkMissingFiles blocks export, marks missing card badge, and proceeds once fixed", async () => {
    await importFourPages();

    ipcMocks.checkMissingFiles.mockResolvedValueOnce(["/2.jpg"]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Xuất PDF (4 trang)" }));
    });

    expect(ipcMocks.buildImage2Pdf).not.toHaveBeenCalled();
    expect(screen.getByTestId("missing-image-badge-p2")).toBeTruthy();
    expect(screen.getByText(/Không tìm thấy 1 tệp ảnh trên đĩa/)).toBeTruthy();

    // Remove missing page p2, clear missing mock -> export proceeds
    fireEvent.click(screen.getAllByTitle("Xóa trang")[1]);
    ipcMocks.checkMissingFiles.mockResolvedValueOnce([]);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Xuất PDF (3 trang)" }));
    });

    expect(ipcMocks.buildImage2Pdf).toHaveBeenCalledTimes(1);
    expect(ipcMocks.buildImage2Pdf.mock.calls[0][1]).toHaveLength(3);
  });

  it("TC-ST-05 & TC-ST-06: disables export when empty and clears state + preview cache on Clear List", async () => {
    const emptyCtx = renderImage2Pdf();
    const emptyExportBtn = screen.getByRole("button", { name: "Xuất PDF (0 trang)" });
    expect((emptyExportBtn as HTMLButtonElement).disabled).toBe(true);
    emptyCtx.unmount();

    await importFourPages();
    expect(screen.getByText("Xuất PDF (4 trang)")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Xóa danh sách" }));
    expect(ipcMocks.clearImagePreviewCache).toHaveBeenCalledTimes(1);
    expect(
      (screen.getByRole("button", { name: "Xuất PDF (0 trang)" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("TC-UCT-04: resolves default directory filename conflict with Auto-append (_1, _2)", async () => {
    ipcMocks.scanImagesForPdf.mockResolvedValueOnce({
      pages: [makeDraft("p1", "1.jpg")],
      bookmarks: [],
      warnings: [],
    });
    ipcMocks.checkExportConflicts.mockResolvedValue(["/tmp/out/output.pdf"]);
    ipcMocks.resolveUniqueExportPath.mockResolvedValue("/tmp/out/output_1.pdf");

    renderImage2Pdf({
      defaultExportDir: "/tmp/out",
      droppedBatch: { seq: 1, paths: ["/1.jpg"] },
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Xuất PDF (1 trang)" }));
    });
    expect(screen.getByText("Tệp đầu ra đã tồn tại")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Tự thêm hậu tố (_1, _2)" }));
    });
    expect(ipcMocks.resolveUniqueExportPath).toHaveBeenCalledWith("/tmp/out/output.pdf");
    expect(ipcMocks.buildImage2Pdf).toHaveBeenCalledTimes(1);
    expect(ipcMocks.buildImage2Pdf.mock.calls[0][3].output_path).toBe("/tmp/out/output_1.pdf");
  });

  it("TC-EG-08: rapid double-click on card Rotate button rotates without opening ImagePreviewModal", async () => {
    await importFourPages();

    const rotateBtn = screen.getAllByTitle("Xoay 90°")[0];
    fireEvent.click(rotateBtn);
    fireEvent.doubleClick(rotateBtn);

    expect(screen.getByText("Đã sửa")).toBeTruthy();
    expect(screen.queryByTestId("zoom-pan-viewport")).toBeNull();
  });

  it("Review 1.16: prependNewFiles inserts new imports at top and Alt+Click attaches bookmark", async () => {
    const firstCtx = await importFourPages([
      { title: "ExistingChap", target_page_index: 0, children: [] },
    ]);

    // Separate display & import order card is rendered
    expect(screen.getByText("Hiển thị & Thứ tự thêm tệp")).toBeTruthy();
    const prependCheckbox = screen.getByRole("checkbox", {
      name: "Thêm ảnh mới vào đầu danh sách (thay vì cuối danh sách)",
    });
    fireEvent.click(prependCheckbox);

    // Import one new page -> prepended at start (5 pages total, 0.jpg is first)
    ipcMocks.scanImagesForPdf.mockResolvedValueOnce({
      pages: [makeDraft("p0", "0.jpg")],
      bookmarks: [{ title: "PrependedChap", target_page_index: 0, children: [] }],
      warnings: [],
    });
    firstCtx.rerender(
      <I18nProvider>
        <Image2PdfView
          onStartJob={firstCtx.onStartJob}
          onJobEvent={firstCtx.onJobEvent}
          onFinishJob={firstCtx.onFinishJob}
          busy={false}
          droppedBatch={{ seq: 2, paths: ["/0.jpg"] }}
        />
      </I18nProvider>,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const cards = Array.from(firstCtx.container.querySelectorAll("[data-page-id]"));
    expect(cards.map((el) => el.getAttribute("data-page-id"))).toEqual([
      "p0",
      "p1",
      "p2",
      "p3",
      "p4",
    ]);

    // Alt+Click on card p3 attaches bookmark "3" at page index 3 (page 4)
    const card3 = firstCtx.container.querySelector('[data-page-id="p3"]') as HTMLElement;
    act(() => {
      card3.dispatchEvent(makePointer("pointerdown", { altKey: true }));
    });
    const bmTitles = Array.from(
      firstCtx.container.querySelectorAll('[data-bookmark-title="true"]'),
    ).map((el) => el.textContent);
    expect(bmTitles).toContain("3");
    const pageSpinbuttons = screen.getAllByRole("spinbutton", { name: "Trang" }) as HTMLInputElement[];
    expect(pageSpinbuttons.some((el) => el.value === "4")).toBe(true);

    // Review 1.17 Item 2: Only ONE "Auto-update bookmarks when deleting pages" checkbox should exist
    expect(
      screen.getAllByRole("checkbox", { name: "Tự động cập nhật mục lục khi xóa ảnh" }),
    ).toHaveLength(1);
  });
});
