// @vitest-environment jsdom
import React from "react";
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
  getVersion: vi.fn().mockResolvedValue("0.2.2"),
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

    const Harness: React.FC = () => {
      const [nodes, setNodes] = React.useState<BookmarkNode[]>(initial);
      current = nodes;
      return <BookmarkTreeEditor nodes={nodes} totalPages={20} onChange={setNodes} />;
    };

    render(
      <I18nProvider>
        <Harness />
      </I18nProvider>,
    );

    const editorRoot = document.querySelector('[data-bookmark-editor="true"]') as HTMLElement;
    const insertGroup = editorRoot.querySelector('[role="group"]') as HTMLElement;
    expect(insertGroup.className).toContain("knit-control-sm");

    const row0 = document.querySelector('[data-bookmark-path="0"]') as HTMLElement;
    const row2 = document.querySelector('[data-bookmark-path="2"]') as HTMLElement;

    // Dolphin single click selects 1 row while keeping single-row controls enabled
    fireEvent.pointerDown(row0, { clientX: 150, clientY: 20, button: 0, pointerType: "mouse" });
    fireEvent.pointerUp(window, { clientX: 150, clientY: 20 });
    expect(row0.getAttribute("data-bookmark-selected")).toBe("true");
    expect(screen.queryByTestId("bookmark-selection-bar")).toBeNull();

    const pageInput = row0.querySelector("input") as HTMLInputElement;
    expect(pageInput.disabled).toBe(false);
    const addChildBtn = row0.querySelector('button[title*="child"], button[title*="mục con"]') as HTMLButtonElement;
    expect(addChildBtn.disabled).toBe(false);

    // F2 renames the selected single row cleanly, Escape cancels
    fireEvent.keyDown(editorRoot, { key: "F2" });
    expect(row0.querySelectorAll("input")).toHaveLength(2);
    const inlineInput = row0.querySelector('input:not([inputmode="decimal"])') as HTMLInputElement;
    expect(inlineInput).toBeTruthy();
    fireEvent.keyDown(inlineInput, { key: "Escape" });
    expect(row0.querySelectorAll("input")).toHaveLength(1);

    // Ctrl+Click Sec 3 enters multi-select mode (2 rows) and shows selection bar
    fireEvent.pointerDown(row2, {
      clientX: 150,
      clientY: 100,
      button: 0,
      pointerType: "mouse",
      ctrlKey: true,
    });
    expect(screen.getByTestId("bookmark-selection-bar")).toBeTruthy();
    expect(screen.getByTestId("bookmark-selection-count").textContent).toContain("2");
    expect((row0.querySelector("input") as HTMLInputElement).disabled).toBe(true);
    expect((row0.querySelector('button[title*="child"], button[title*="mục con"]') as HTMLButtonElement).disabled).toBe(true);

    // Delete key removes Sec 1 and Sec 3, leaving Sec 2
    fireEvent.keyDown(editorRoot, { key: "Delete" });
    expect(current.map((n) => n.title)).toEqual(["Sec 2"]);
    expect(screen.queryByTestId("bookmark-selection-bar")).toBeNull();

    // Ctrl+A selects all remaining rows
    fireEvent.keyDown(editorRoot, { key: "a", ctrlKey: true });
    expect(document.querySelector('[data-bookmark-path="0"]')?.getAttribute("data-bookmark-selected")).toBe("true");
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
    expect(badge.textContent).toBe("v0.2.2");
  });
});
