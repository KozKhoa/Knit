// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "../i18n";
import { buildArchiveTreeFromEntries } from "../lib/archiveTree";
import { findActiveExportConflicts } from "../lib/exportPath";
import type { ArchiveTreeNode } from "../lib/archiveTree";
import type { BookmarkNode, PdfInfo, RunningJobInfo } from "../types/ipc";
import { ArchiveTreeEditor } from "./ArchiveTreeEditor";
import { ExportConflictModal } from "./ExportConflictModal";
import { PdfJsPreview } from "./PdfJsPreview";
import { WorkbenchShell } from "./WorkbenchShell";
import { DocsSplitWorkbench } from "../views/docs2pdf/DocsSplitWorkbench";
import { Image2PdfSettingsCard } from "../views/image2pdf/Image2PdfSettingsCard";
import { PdfMergePane } from "../views/pdf-ops/PdfMergePane";

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const wrap = (ui: React.ReactElement) => render(<I18nProvider>{ui}</I18nProvider>);

describe("Review 1.16 features", () => {
  it("Image2PdfSettingsCard omits loadThumbs and offers EmbedRichMedia animated policy", () => {
    const onChangeAnimated = vi.fn();
    wrap(
      <Image2PdfSettingsCard
        layoutMode="original_size"
        dpi={72}
        marginValue={24}
        marginUnit="pt"
        bgMode="white"
        bgCustomHex="#F8F9FA"
        exportMode="balanced"
        jpegQuality={88}
        losslessPassthrough={true}
        animatedPolicy="first_frame_only"
        splitMode="none"
        maxMb=""
        maxPagesPerFile={50}
        onChangeLayoutMode={vi.fn()}
        onChangeDpi={vi.fn()}
        onChangeMarginValue={vi.fn()}
        onSwitchMarginUnit={vi.fn()}
        onChangeBgMode={vi.fn()}
        onChangeBgCustomHex={vi.fn()}
        onChangeExportMode={vi.fn()}
        onChangeJpegQuality={vi.fn()}
        onChangeLosslessPassthrough={vi.fn()}
        onChangeAnimatedPolicy={onChangeAnimated}
        onChangeSplitMode={vi.fn()}
        onChangeMaxMb={vi.fn()}
        onChangeMaxPagesPerFile={vi.fn()}
      />,
    );

    expect(screen.queryByText("Tải ảnh xem trước")).toBeNull();
    const animSelect = screen.getByRole("combobox", { name: "Ảnh động (GIF / WebP)" });
    fireEvent.click(animSelect);
    const richOpt = screen.getByRole("option", {
      name: "Nhúng luồng Animation (/RichMedia & /Screen)",
    });
    fireEvent.click(richOpt);
    expect(onChangeAnimated).toHaveBeenCalledWith("embed_rich_media");
  });

  it("ExportConflictModal hides Overwrite button when path is locked by an active export job", () => {
    const onResolve = vi.fn();
    wrap(
      <ExportConflictModal
        conflictPaths={["/exports/out.pdf"]}
        isLockedByActiveJob={true}
        onResolve={onResolve}
      />,
    );

    expect(screen.getByText("Tệp đầu ra đang được tiến trình khác xuất")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Ghi đè tệp cũ" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tự thêm hậu tố (_1, _2)" }));
    expect(onResolve).toHaveBeenCalledWith("auto_rename");
  });

  it("findActiveExportConflicts detects case-insensitive path collisions against running jobs", () => {
    expect(
      findActiveExportConflicts(
        ["C:\\Out\\Merged.pdf"],
        ["c:/out/merged.pdf", "/tmp/other.zip"],
      ),
    ).toEqual(["C:\\Out\\Merged.pdf"]);
  });

  it("WorkbenchShell renders multiple parallel running jobs with independent cancel buttons", () => {
    const onCancelJob = vi.fn();
    const jobs: RunningJobInfo[] = [
      {
        jobId: "job-1",
        tool: "image2pdf",
        label: "Ảnh sang PDF",
        outputPaths: ["/a.pdf"],
        progress: {
          phase: "pack",
          done: 3,
          total: 10,
          bytes_done: 0,
          bytes_total: 0,
          current_item: "page_03.jpg",
        },
      },
      {
        jobId: "job-2",
        tool: "pdf-ops",
        label: "Gộp PDF",
        outputPaths: ["/b.pdf"],
        progress: {
          phase: "merge",
          done: 1,
          total: 2,
          bytes_done: 0,
          bytes_total: 0,
          current_item: "part2.pdf",
        },
      },
    ];

    wrap(
      <WorkbenchShell
        activeTool="image2pdf"
        onSelectTool={vi.fn()}
        runningJobs={jobs}
        onCancelJob={onCancelJob}
        logs={[]}
        onClearLogs={vi.fn()}
        history={[]}
      >
        <div>workspace</div>
      </WorkbenchShell>,
    );

    const cancelButtons = screen.getAllByRole("button", { name: "Hủy tác vụ" });
    expect(cancelButtons).toHaveLength(2);
    fireEvent.click(cancelButtons[1]);
    expect(onCancelJob).toHaveBeenCalledWith("job-2");
  });

  it("PdfMergePane renders horizontal width resize handle and triggers Alt+Click bookmark attach", () => {
    const onAttachPage = vi.fn();
    const onAttachFile = vi.fn();
    const files: PdfInfo[] = [
      { path: "/docs/sample.pdf", page_count: 2, file_size_bytes: 2048, bookmarks: [] },
    ];
    const bookmarks: BookmarkNode[] = [
      { title: "Chap 1", target_page_index: 0, children: [] },
    ];

    const { container } = wrap(
      <PdfMergePane
        active={true}
        files={files}
        selections={[
          { file_index: 0, page_index: 0, rotation_deg: 0 },
          { file_index: 0, page_index: 1, rotation_deg: 0 },
        ]}
        mergeMode="per_page"
        mergeFileOrder={[0]}
        mergeBookmarks={bookmarks}
        preserveBookmarks={true}
        showMergeBookmarks={true}
        bookmarksDisabled={false}
        mergeGridCols={4}
        mergeCardSize="small"
        thumbs={{}}
        onChangeMergeMode={vi.fn()}
        onTogglePreserveBookmarks={vi.fn()}
        onChangeMergeGridCols={vi.fn()}
        onChangeMergeCardSize={vi.fn()}
        onToggleShowBookmarks={vi.fn()}
        onChangeBookmarks={vi.fn()}
        onReorderSelection={vi.fn()}
        onReorderFileOrder={vi.fn()}
        onRotatePage={vi.fn()}
        onRemovePage={vi.fn()}
        onRemoveFile={vi.fn()}
        onDoubleClickPage={vi.fn()}
        onDoubleClickFile={vi.fn()}
        onContextMenuPage={vi.fn()}
        onContextMenuFile={vi.fn()}
        onAttachBookmarkAtPage={onAttachPage}
        onAttachBookmarkAtFile={onAttachFile}
        onRegisterThumbRef={vi.fn()}
        onEnqueueWindow={vi.fn()}
      />,
    );

    // Resize width separator exists between PDF grid and Bookmark tree
    expect(screen.getByRole("separator", { name: "Kéo để chỉnh chiều rộng 2 khung" })).toBeTruthy();

    // Alt+Click on 2nd page card calls onAttachBookmarkAtPage(1)
    const secondCard = container.querySelector('[data-pdf-thumb-key="0:1"]') as HTMLElement;
    expect(secondCard).toBeTruthy();
    secondCard.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, cancelable: true, button: 0, altKey: true }),
    );
    expect(onAttachPage).toHaveBeenCalledWith(1);
  });

  it("DocsSplitWorkbench renders horizontal width resize handle between editor and preview", () => {
    wrap(
      <DocsSplitWorkbench
        isEditableText={true}
        liveHeightPx={560}
        editorText="# Title"
        saveFeedback={null}
        previewLoading={false}
        previewError={null}
        previewPdfBytes={null}
        previewTotalPages={0}
        syncScroll={false}
        editorFindOpen={false}
        editorFindQuery=""
        activeEditorMatchIdx={null}
        editorMatchCount={0}
        previewFindOpen={false}
        previewFindQuery=""
        activePreviewMatchIdx={null}
        previewMatchCount={0}
        editorRef={React.createRef()}
        previewRef={React.createRef()}
        editorPaneRef={React.createRef()}
        previewPaneRef={React.createRef()}
        editorFindInputRef={React.createRef()}
        previewFindInputRef={React.createRef()}
        onChangeEditorText={vi.fn()}
        onSaveText={vi.fn()}
        onOpenEditorFind={vi.fn()}
        onChangeEditorFindQuery={vi.fn()}
        onStepEditorMatch={vi.fn()}
        onCloseEditorFind={vi.fn()}
        onOpenPreviewFind={vi.fn()}
        onChangePreviewFindQuery={vi.fn()}
        onStepPreviewMatch={vi.fn()}
        onClosePreviewFind={vi.fn()}
        onRefreshPreview={vi.fn()}
        onPageCountChange={vi.fn()}
        onSearchMatchCountChange={vi.fn()}
        onToggleSyncScroll={vi.fn()}
        onEditorScrollRatio={vi.fn()}
        onPreviewScrollRatio={vi.fn()}
        onGoToInEditor={vi.fn()}
        onStartHeightResize={vi.fn()}
      />,
    );

    expect(screen.getByRole("separator", { name: "Kéo để chỉnh chiều rộng 2 khung" })).toBeTruthy();
    expect(screen.getByRole("separator", { name: "Resize editor and preview height" })).toBeTruthy();
  });

  it("PdfJsPreview zooms on Ctrl + Wheel scroll without opening any modal on double click", () => {
    const { container } = wrap(
      <PdfJsPreview
        pdfBytes={null}
        emptyText="empty"
        loadingText="loading"
      />,
    );

    expect(screen.getByText("45%")).toBeTruthy();
    const scrollEl = container.querySelector('[tabindex="0"]') as HTMLElement;
    expect(scrollEl).toBeTruthy();

    fireEvent.wheel(scrollEl, { deltaY: -120, ctrlKey: true });
    expect(screen.getByText("57%")).toBeTruthy();

    fireEvent.wheel(scrollEl, { deltaY: 120, ctrlKey: true });
    expect(screen.getByText("45%")).toBeTruthy();
  });

  it("ArchiveTreeEditor deletes entries and supports Undo without renaming controls", () => {
    const initialNodes: ArchiveTreeNode[] = buildArchiveTreeFromEntries([
      { source_path: "/a/one.txt", archive_path: "a/one.txt", size_bytes: 100 },
      { source_path: "/a/two.txt", archive_path: "a/two.txt", size_bytes: 200 },
    ]);

    const Harness: React.FC = () => {
      const [nodes, setNodes] = React.useState<ArchiveTreeNode[]>(initialNodes);
      return <ArchiveTreeEditor nodes={nodes} onChange={setNodes} />;
    };

    wrap(<Harness />);
    expect(screen.getByText("one.txt")).toBeTruthy();
    expect(screen.getByText("two.txt")).toBeTruthy();
    // Strictly read-only labels: no text input inside ArchiveTreeEditor
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);

    const deleteButtons = screen.getAllByTitle("Loại khỏi gói nén");
    // Delete "one.txt" (index 1, after folder "a" at index 0)
    fireEvent.click(deleteButtons[1]);
    expect(screen.queryByText("one.txt")).toBeNull();
    expect(screen.getByText("two.txt")).toBeTruthy();

    // Undo restores "one.txt"
    fireEvent.click(screen.getByRole("button", { name: "Hoàn tác" }));
    expect(screen.getByText("one.txt")).toBeTruthy();
  });
});
