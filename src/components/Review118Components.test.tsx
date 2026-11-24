// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "../i18n";
import type { PdfInfo } from "../types/ipc";

const ipcMocks = vi.hoisted(() => ({
  getDocsEngineStatus: vi.fn(),
  getFileSizeBytes: vi.fn(),
  isTauriRuntime: vi.fn(),
  pickFiles: vi.fn(),
  previewDocPdfBytes: vi.fn(),
  readDocTextFile: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}));

vi.mock("../lib/ipc", () => ({
  checkExportConflicts: vi.fn().mockResolvedValue([]),
  convertDocContentToPdf: vi.fn(),
  convertDocToPdf: vi.fn(),
  formatBytes: (n: number) => `${n} B`,
  getDocsEngineStatus: ipcMocks.getDocsEngineStatus,
  getFileSizeBytes: ipcMocks.getFileSizeBytes,
  isJobCancelledError: () => false,
  isTauriRuntime: ipcMocks.isTauriRuntime,
  pickFiles: ipcMocks.pickFiles,
  pickSaveFile: vi.fn(),
  previewDocPdfBytes: ipcMocks.previewDocPdfBytes,
  readDocTextFile: ipcMocks.readDocTextFile,
  revealInExplorer: vi.fn(),
  writeDocTextFile: vi.fn(),
}));

import { ExportSuccessToast } from "./ExportSuccessToast";
import {
  collectSyntaxDiagnostics,
  detectEditorLanguage,
  MarkdownCodeEditor,
} from "./MarkdownCodeEditor";
import { Docs2PdfView, formatEditorContentForCompilation } from "../views/Docs2PdfView";
import { LoadedPdfList } from "../views/pdf-ops/LoadedPdfList";

const wrap = (ui: React.ReactElement) => render(<I18nProvider>{ui}</I18nProvider>);

beforeEach(() => {
  window.localStorage.clear();
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
  ipcMocks.getFileSizeBytes.mockResolvedValue(4096);
  ipcMocks.previewDocPdfBytes.mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Review 1.18 items", () => {
  it("Item 1: LoadedPdfList scales duplicate badge and path at text-sm (one step smaller than app font size)", () => {
    const files: PdfInfo[] = [
      { path: "/docs/a/report.pdf", page_count: 5, file_size_bytes: 10240, bookmarks: [] },
      { path: "/docs/a/report.pdf", page_count: 5, file_size_bytes: 10240, bookmarks: [] },
    ];

    render(
      <LoadedPdfList
        files={files}
        highlighted={false}
        onRequestClearAll={() => {}}
        onRequestRemoveFile={() => {}}
      />,
    );

    const badge = screen.getByTestId("duplicate-pdf-badge-0");
    const pathEl = screen.getByTestId("duplicate-pdf-path-0");
    expect(badge.className).toContain("text-sm");
    expect(badge.className).not.toContain("text-[10px]");
    expect(pathEl.className).toContain("text-sm");
    expect(pathEl.className).not.toContain("text-[11px]");
  });

  it("Item 2: detects HTML, CSS, JS, TS, JSX, TSX, and Markdown languages and switches Editor mode", async () => {
    expect(detectEditorLanguage("/work/slides/index.html", "")).toBe("html");
    expect(detectEditorLanguage("/work/styles/app.css", "")).toBe("css");
    expect(detectEditorLanguage("/work/src/main.js", "")).toBe("javascript");
    expect(detectEditorLanguage("/work/src/main.ts", "")).toBe("typescript");
    expect(detectEditorLanguage("/work/src/App.jsx", "")).toBe("jsx");
    expect(detectEditorLanguage("/work/src/App.tsx", "")).toBe("tsx");
    expect(detectEditorLanguage("/work/README.md", "")).toBe("markdown");
    expect(detectEditorLanguage(null, "<!DOCTYPE html><html></html>")).toBe("html");

    const tsWrapped = formatEditorContentForCompilation("const x: number = 1;", "typescript", "plain_text");
    expect(tsWrapped.kind).toBe("markdown");
    expect(tsWrapped.content).toContain("```ts\nconst x: number = 1;\n```");

    vi.useFakeTimers();
    ipcMocks.pickFiles.mockResolvedValueOnce(["/work/styles/theme.css"]);
    ipcMocks.readDocTextFile.mockResolvedValueOnce("body { color: #212529; }");

    wrap(
      <Docs2PdfView
        onStartJob={vi.fn()}
        onJobEvent={vi.fn()}
        onFinishJob={vi.fn()}
        busy={false}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Chọn tài liệu" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("Soạn thảo CSS")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Lưu (.css)" })).toBeTruthy();
    const editorHost = document.querySelector("[data-editor-language]") as HTMLElement;
    expect(editorHost?.dataset.editorLanguage).toBe("css");
  });

  it("Item 3 & 4: removes gray background on inline code and scales Editor font using rem units", () => {
    const { container } = wrap(
      <MarkdownCodeEditor
        value={"Text with `inline code` inside Markdown"}
        language="markdown"
        onChange={vi.fn()}
      />,
    );

    const styleTags = Array.from(document.querySelectorAll("style"));
    const combinedStyles = styleTags.map((s) => s.textContent ?? "").join("\n");
    expect(combinedStyles).not.toContain("#F3F3F3");
    expect(combinedStyles).not.toContain("#f3f3f3");
    expect(combinedStyles).toContain("0.875rem");
    expect(combinedStyles).not.toContain("12.5px");
    expect(container.querySelector(".cm-editor")).toBeTruthy();
  });

  it("Item 4: collectSyntaxDiagnostics catches HTML, CSS, JS/TS/JSX/TSX, and Markdown syntax errors", () => {
    const badHtml = "z<!DOCTYPE html><html><body><div><span></body></html>";
    expect(collectSyntaxDiagnostics(badHtml, "html").length).toBeGreaterThan(0);

    const badCss = "body { color: ;";
    expect(collectSyntaxDiagnostics(badCss, "css").length).toBeGreaterThan(0);

    const badJs = "const x = ;";
    expect(collectSyntaxDiagnostics(badJs, "javascript").length).toBeGreaterThan(0);

    const badTs = "interface Foo { x: ; }";
    expect(collectSyntaxDiagnostics(badTs, "typescript").length).toBeGreaterThan(0);

    const badMd = "```ts\nconst x = 1;\n";
    expect(collectSyntaxDiagnostics(badMd, "markdown").length).toBe(1);

    const validHtml = "<!DOCTYPE html><html><body><div><img src=\"a.png\"></div></body></html>";
    expect(collectSyntaxDiagnostics(validHtml, "html")).toEqual([]);
  });

  it("Item 5: Docs2PdfView switches to 2-column layout (Preview left, Controls right) at >=1200px when there is no editor", async () => {
    vi.useFakeTimers();
    ipcMocks.pickFiles.mockResolvedValueOnce(["/books/novel.epub"]);

    wrap(
      <Docs2PdfView
        onStartJob={vi.fn()}
        onJobEvent={vi.fn()}
        onFinishJob={vi.fn()}
        busy={false}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Chọn tài liệu" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const splitRoot = screen.getByTestId("docs2pdf-no-editor-split-layout");
    const controlsCol = screen.getByTestId("docs2pdf-no-editor-controls-col");
    const previewCol = screen.getByTestId("docs2pdf-no-editor-preview-col");

    expect(splitRoot.className).toContain("grid-cols-1");
    expect(splitRoot.className).toContain(
      "min-[1200px]:[grid-template-columns:var(--docs-no-editor-left)_12px_minmax(0,1fr)]",
    );
    expect(previewCol.className).toContain("min-[1200px]:order-1");
    expect(controlsCol.className).toContain("min-[1200px]:order-3");
    expect(controlsCol.className).toContain("min-[1200px]:sticky");
    expect(controlsCol.className).toContain("min-[1200px]:top-4");
    expect(
      splitRoot.querySelector('[role="separator"][aria-orientation="vertical"]'),
    ).toBeTruthy();
    expect(previewCol.textContent).toContain("Xem trước PDF trực tiếp");
    expect(controlsCol.textContent).toContain("/books/novel.epub");
    expect(screen.queryByText("Chọn hoặc kéo thả tài liệu")).toBeNull();
    expect(screen.getByRole("button", { name: /Đổi tài liệu/i })).toBeTruthy();

    const settingsCard = screen.getByTestId("docs2pdf-settings-card");
    const mainGrid = screen.getByTestId("docs2pdf-settings-main-grid");
    expect(settingsCard.className).toContain("@container");
    expect(mainGrid.className).toContain("@[380px]:grid-cols-2");
    expect(mainGrid.className).not.toContain("xl:grid-cols-8");

    fireEvent.click(screen.getByRole("button", { name: /Đóng tệp/i }));
    expect(screen.getByRole("button", { name: "Chọn tài liệu" })).toBeTruthy();
  });

  it("Item 7 (Review 1.18 #8): ExportSuccessToast path and Open Folder button use rem classes to scale with app font size", () => {
    wrap(
      <ExportSuccessToast
        result={{
          title: "PDF",
          summary: "Done",
          outputs: ["/tmp/output/document.pdf"],
        }}
        onClose={vi.fn()}
      />,
    );

    const pathSpan = screen.getByTitle("/tmp/output/document.pdf");
    const openBtn = screen.getByRole("button", { name: "Mở thư mục" });
    expect(pathSpan.className).toContain("text-xs");
    expect(pathSpan.className).not.toContain("text-[11px]");
    expect(openBtn.className).toContain("text-xs");
    expect(openBtn.className).not.toContain("text-[11px]");
  });
});
