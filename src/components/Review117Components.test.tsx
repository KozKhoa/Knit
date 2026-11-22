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
  readPdfFileBytes: vi.fn(),
  releasePdfCachedFiles: vi.fn(),
  renderPdfPagePreviewFile: vi.fn(),
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
  readPdfFileBytes: ipcMocks.readPdfFileBytes,
  releasePdfCachedFiles: ipcMocks.releasePdfCachedFiles,
  renderPdfPagePreviewFile: ipcMocks.renderPdfPagePreviewFile,
  writeDocTextFile: vi.fn(),
}));

import { PdfFilePreviewModal } from "./PdfFilePreviewModal";
import { Docs2PdfView } from "../views/Docs2PdfView";

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
  ipcMocks.renderPdfPagePreviewFile.mockResolvedValue("/tmp/page_0.png");
  ipcMocks.releasePdfCachedFiles.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Review 1.17 UI components", () => {
  it("Docs2PdfView renders read-only PDF preview and disables Typst settings when importing DOCX", async () => {
    vi.useFakeTimers();
    ipcMocks.pickFiles.mockResolvedValueOnce(["/docs/spec.docx"]);

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

    // Editor hidden, Preview pane visible, and Typst formatting fieldset disabled
    expect(screen.queryByText("Soạn thảo Markdown / Văn bản")).toBeNull();
    expect(screen.getByText("Xem trước PDF trực tiếp")).toBeTruthy();
    const themeCombo = screen.getByRole("combobox", { name: "Giao diện (Theme)" }) as HTMLButtonElement;
    expect(themeCombo.closest("fieldset")?.disabled).toBe(true);

    // Advance timer to trigger previewDocPdfBytes with inputPath for docx
    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    expect(ipcMocks.previewDocPdfBytes).toHaveBeenCalledWith(
      expect.objectContaining({
        inputKind: "docx",
        inputPath: "/docs/spec.docx",
      }),
    );
  });

  it("PdfFilePreviewModal streams lazy page renders instead of readPdfFileBytes and releases cache on close", async () => {
    const info: PdfInfo = {
      path: "/heavy/archive_2_8gb.pdf",
      page_count: 100,
      file_size_bytes: 2_800_000_000,
      bookmarks: [],
    };
    const onClose = vi.fn();

    render(
      <I18nProvider>
        <PdfFilePreviewModal pdfInfo={info} onClose={onClose} />
      </I18nProvider>,
    );

    await act(async () => {
      await Promise.resolve();
    });

    // Must never load whole multi-GB file bytes into JS memory
    expect(ipcMocks.readPdfFileBytes).not.toHaveBeenCalled();
    expect(ipcMocks.renderPdfPagePreviewFile).toHaveBeenCalled();
    expect(screen.getByText("1 / 100")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Đóng" }));
    expect(ipcMocks.releasePdfCachedFiles).toHaveBeenCalledWith([]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
