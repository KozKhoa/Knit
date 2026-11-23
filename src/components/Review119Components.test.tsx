// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "../i18n";
import type { BookmarkNode } from "../types/ipc";

const ipcMocks = vi.hoisted(() => ({
  checkDocMissingLinks: vi.fn(),
  getDocsEngineStatus: vi.fn(),
  isTauriRuntime: vi.fn(),
  pickFiles: vi.fn(),
  previewDocPdfBytes: vi.fn(),
  readDocTextFile: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}));

vi.mock("@tauri-apps/api/app", () => ({
  getVersion: vi.fn().mockResolvedValue("0.2.1"),
}));

vi.mock("../lib/ipc", () => ({
  checkDocMissingLinks: ipcMocks.checkDocMissingLinks,
  checkExportConflicts: vi.fn().mockResolvedValue([]),
  convertDocContentToPdf: vi.fn(),
  convertDocToPdf: vi.fn(),
  formatBytes: (n: number) => `${n} B`,
  getAppMetrics: vi.fn().mockResolvedValue(null),
  getDocsEngineStatus: ipcMocks.getDocsEngineStatus,
  getFileSizeBytes: vi.fn().mockResolvedValue(1024),
  isJobCancelledError: () => false,
  isTauriRuntime: ipcMocks.isTauriRuntime,
  pickFiles: ipcMocks.pickFiles,
  pickSaveFile: vi.fn(),
  previewDocPdfBytes: ipcMocks.previewDocPdfBytes,
  readDocTextFile: ipcMocks.readDocTextFile,
  revealInExplorer: vi.fn(),
  writeDocTextFile: vi.fn(),
}));

import { BookmarkTreeEditor } from "./BookmarkTreeEditor";
import { WorkbenchShell } from "./WorkbenchShell";
import { Docs2PdfView } from "../views/Docs2PdfView";

beforeEach(() => {
  window.localStorage.clear();
  class JsdomPointerEvent extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 1;
      this.pointerType = params.pointerType ?? "mouse";
    }
  }
  vi.stubGlobal("PointerEvent", JsdomPointerEvent);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  ipcMocks.isTauriRuntime.mockReturnValue(true);
  ipcMocks.getDocsEngineStatus.mockResolvedValue({
    libreoffice_available: true,
    executable_path: "/usr/bin/soffice",
    version_text: "LibreOffice 24",
    checked_paths: [],
  });
  ipcMocks.previewDocPdfBytes.mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
  ipcMocks.checkDocMissingLinks.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Review 1.19 items", () => {
  it("Item 1: Docs2Pdf shows English Not found warning when local image/folder links are missing", async () => {
    vi.useFakeTimers();
    ipcMocks.pickFiles.mockResolvedValueOnce(["/docs/note.md"]);
    ipcMocks.readDocTextFile.mockResolvedValueOnce(
      "# Title\n\n![missing](/home/khoa/missing.png)\n\n[folder](./missing-folder)\n",
    );
    ipcMocks.checkDocMissingLinks.mockResolvedValue([
      "/home/khoa/missing.png",
      "./missing-folder",
    ]);

    render(
      <I18nProvider>
        <Docs2PdfView
          onStartJob={() => {}}
          onJobEvent={() => {}}
          onFinishJob={() => {}}
          busy={false}
        />
      </I18nProvider>,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Chọn tài liệu" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    // Wait for debounced preview & missing link check
    await act(async () => {
      vi.advanceTimersByTime(700);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(ipcMocks.checkDocMissingLinks).toHaveBeenCalledWith(
      expect.stringContaining("/home/khoa/missing.png"),
      "/docs",
    );
    const warn = screen.getByTestId("docs2pdf-missing-links-warning");
    expect(warn.textContent).toContain("Not found (2):");
    expect(warn.textContent).toContain("/home/khoa/missing.png");
    expect(warn.textContent).toContain("./missing-folder");
  });

  it("Item 2a: BookmarkTreeEditor shows indicator and reorders when dropped in the gap between two sections", () => {
    const initial: BookmarkNode[] = [
      { title: "Sec 1", target_page_index: 0, children: [] },
      { title: "Sec 2", target_page_index: 4, children: [] },
      { title: "Sec 3", target_page_index: 8, children: [] },
    ];
    let current = initial;
    const onChange = vi.fn((next: BookmarkNode[]) => {
      current = next;
    });

    render(
      <I18nProvider>
        <BookmarkTreeEditor nodes={initial} totalPages={20} onChange={onChange} />
      </I18nProvider>,
    );

    const row0 = document.querySelector('[data-bookmark-path="0"]') as HTMLElement;
    const row1 = document.querySelector('[data-bookmark-path="1"]') as HTMLElement;
    const row2 = document.querySelector('[data-bookmark-path="2"]') as HTMLElement;
    const grip0 = row0.querySelector("[data-bookmark-drag-handle]") as HTMLElement;

    const listEl = row0.parentElement!.parentElement as HTMLElement;
    const scrollEl = listEl.parentElement!.parentElement as HTMLElement;

    vi.spyOn(scrollEl, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      right: 400,
      bottom: 300,
      width: 400,
      height: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    vi.spyOn(row0, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 10,
      right: 380,
      bottom: 46,
      width: 380,
      height: 36,
      x: 0,
      y: 10,
      toJSON: () => ({}),
    });
    vi.spyOn(row1, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 52,
      right: 380,
      bottom: 88,
      width: 380,
      height: 36,
      x: 0,
      y: 52,
      toJSON: () => ({}),
    });
    vi.spyOn(row2, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 94,
      right: 380,
      bottom: 130,
      width: 380,
      height: 36,
      x: 0,
      y: 94,
      toJSON: () => ({}),
    });

    // Simulate pointer hovering in the 6px gap between Sec 2 (bottom 88) and Sec 3 (top 94) at clientY = 91
    (document as unknown as { elementsFromPoint?: (x: number, y: number) => Element[] }).elementsFromPoint =
      () => [listEl];

    const rafSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 1;
      });

    fireEvent.pointerDown(grip0, { clientX: 20, clientY: 28, button: 0, pointerType: "mouse" });
    fireEvent.pointerMove(window, { clientX: 120, clientY: 91 });

    expect(screen.getByTestId("bookmark-drop-after-1")).toBeTruthy();

    fireEvent.pointerUp(window, { clientX: 120, clientY: 91 });
    rafSpy.mockRestore();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(current.map((n) => n.title)).toEqual(["Sec 2", "Sec 1", "Sec 3"]);
  });

  it("Item 2b: BookmarkTreeEditor supports hold & Ctrl/Shift selection mode, disables rename/page/add-child, and allows batch delete", () => {
    vi.useFakeTimers();
    const initial: BookmarkNode[] = [
      { title: "Sec 1", target_page_index: 0, children: [] },
      { title: "Sec 2", target_page_index: 4, children: [] },
      { title: "Sec 3", target_page_index: 8, children: [] },
    ];
    let current = initial;
    const onChange = vi.fn((next: BookmarkNode[]) => {
      current = next;
    });

    render(
      <I18nProvider>
        <BookmarkTreeEditor nodes={initial} totalPages={20} onChange={onChange} />
      </I18nProvider>,
    );

    const row0 = document.querySelector('[data-bookmark-path="0"]') as HTMLElement;
    const row2 = document.querySelector('[data-bookmark-path="2"]') as HTMLElement;

    // Long-press 400ms on Sec 1 enters selection mode
    fireEvent.pointerDown(row0, { clientX: 150, clientY: 20, button: 0, pointerType: "mouse" });
    act(() => {
      vi.advanceTimersByTime(420);
    });
    fireEvent.pointerUp(window, { clientX: 150, clientY: 20 });

    expect(screen.getByTestId("bookmark-selection-bar")).toBeTruthy();
    expect(screen.getByTestId("bookmark-selection-count").textContent).toContain("1");

    // Rename input, page NumberInput, and add-child button are disabled in selection mode
    const titleInputs = row0.querySelectorAll("input");
    expect((titleInputs[0] as HTMLInputElement).disabled).toBe(true);
    expect((titleInputs[1] as HTMLInputElement).disabled).toBe(true);
    const addChildBtn = row0.querySelector('button[title*="child"], button[title*="mục con"]') as HTMLButtonElement;
    expect(addChildBtn.disabled).toBe(true);

    // Ctrl+Click Sec 3 adds it to selection
    fireEvent.pointerDown(row2, {
      clientX: 150,
      clientY: 100,
      button: 0,
      pointerType: "mouse",
      ctrlKey: true,
    });
    expect(screen.getByTestId("bookmark-selection-count").textContent).toContain("2");

    // Batch delete removes Sec 1 and Sec 3, leaving Sec 2
    fireEvent.click(screen.getByTestId("bookmark-delete-selected-btn"));
    expect(current.map((n) => n.title)).toEqual(["Sec 2"]);
    expect(screen.queryByTestId("bookmark-selection-bar")).toBeNull();
  });

  it("Item 4: WorkbenchShell displays floating bottom-right app version badge", async () => {
    render(
      <I18nProvider>
        <WorkbenchShell
          activeTool="image2pdf"
          onSelectTool={() => {}}
          onCancelJob={() => {}}
          logs={[]}
          onClearLogs={() => {}}
          history={[]}
        >
          <div>Content</div>
        </WorkbenchShell>
      </I18nProvider>,
    );

    await act(async () => {
      await Promise.resolve();
    });

    const badge = screen.getByTestId("app-version-badge");
    expect(badge.textContent).toBe("v0.2.1");
  });
});
