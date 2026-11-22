// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BookmarkNode, PageDraft, PdfInfo } from "../types/ipc";
import { ImageContextMenu } from "../views/image2pdf/ImageContextMenu";
import { LoadedPdfList } from "../views/pdf-ops/LoadedPdfList";
import { BookmarkPageBadge } from "./BookmarkPageBadge";
import { BookmarkTreeEditor } from "./BookmarkTreeEditor";

afterEach(cleanup);

describe("Review 1.13 UI components", () => {
  it("renders BookmarkPageBadge with DESIGIN.md flat corporate colors and no shadow", () => {
    render(<BookmarkPageBadge titles={["Chapter 1"]} />);
    const badge = screen.getByTestId("page-bookmark-badge");
    expect(badge.className).toContain("bg-[#E7F1FF]");
    expect(badge.className).toContain("text-[#0056B3]");
    expect(badge.className).not.toContain("shadow-sm");
    expect(badge.className).not.toContain("bg-[#FFF3CD]");
  });

  it("shows inline path for same-name files without warning and Info badge only for exact duplicate path in LoadedPdfList", () => {
    const files: PdfInfo[] = [
      { path: "/docs/a/report.pdf", page_count: 5, file_size_bytes: 10240, bookmarks: [] },
      { path: "/docs/b/report.pdf", page_count: 8, file_size_bytes: 20480, bookmarks: [] },
      { path: "/docs/a/report.pdf", page_count: 5, file_size_bytes: 10240, bookmarks: [] },
      { path: "/docs/unique.pdf", page_count: 3, file_size_bytes: 4096, bookmarks: [] },
    ];

    render(
      <LoadedPdfList
        files={files}
        highlighted={false}
        onRequestClearAll={() => {}}
        onRequestRemoveFile={() => {}}
      />,
    );

    // Same name + same exact path (idx 0 and 2) show Info badge "Duplicate file" / "Trùng tệp"
    expect(screen.getByTestId("duplicate-pdf-badge-0")).toBeTruthy();
    expect(screen.getByTestId("duplicate-pdf-badge-2")).toBeTruthy();
    // Same name in different directory (idx 1) has NO duplicate badge
    expect(screen.queryByTestId("duplicate-pdf-badge-1")).toBeNull();
    expect(screen.queryByTestId("duplicate-pdf-badge-3")).toBeNull();
    // Same-name files show their paths inline next to the filename
    expect(screen.getByTestId("duplicate-pdf-path-0").textContent).toBe("/docs/a/report.pdf");
    expect(screen.getByTestId("duplicate-pdf-path-1").textContent).toBe("/docs/b/report.pdf");
    expect(screen.getByTestId("duplicate-pdf-path-2").textContent).toBe("/docs/a/report.pdf");
    expect(screen.queryByTestId("duplicate-pdf-path-3")).toBeNull();
  });

  it("displays bookmark order warning badges and wide 6-digit page input in BookmarkTreeEditor", () => {
    const nodes: BookmarkNode[] = [
      { title: "Ch 1", target_page_index: 99999, children: [] }, // p.100000
      { title: "Ch 2", target_page_index: 4, children: [] }, // p.5 < p.100000
    ];

    render(
      <BookmarkTreeEditor
        nodes={nodes}
        totalPages={120000}
        onChange={() => {}}
      />,
    );

    expect(screen.getByTestId("bookmark-warning-summary")).toBeTruthy();
    expect(screen.getByTestId("bookmark-row-warning-1")).toBeTruthy();
    const spinbuttons = screen.getAllByRole("spinbutton");
    expect((spinbuttons[0] as HTMLInputElement).value).toBe("100000");
    expect(spinbuttons[0].closest(".w-28")).toBeTruthy();
  });

  it("virtualizes thousands of bookmarks so only the visible window is mounted in DOM", () => {
    const manyNodes: BookmarkNode[] = Array.from({ length: 3000 }, (_, i) => ({
      title: `Bookmark ${i + 1}`,
      target_page_index: i,
      children: [],
    }));

    const { container } = render(
      <BookmarkTreeEditor
        nodes={manyNodes}
        totalPages={3000}
        onChange={() => {}}
      />,
    );

    const mountedRows = container.querySelectorAll("[data-bookmark-path]");
    expect(mountedRows.length).toBeGreaterThan(0);
    expect(mountedRows.length).toBeLessThan(60);
  });

  it("exposes all 9 actions in ImageContextMenu", () => {
    const page: PageDraft = {
      id: "pg-1",
      source: { kind: "image_file", path: "/manga/vol1/001.jpg" },
      rotation_deg: 0,
      crop: null,
      annotations: { texts: [], strokes: [] },
      duration_ms: null,
      label: "001.jpg",
      width_px: 800,
      height_px: 1200,
      file_size_bytes: 123456,
    };

    const onRotateBy = vi.fn();
    const onDelete = vi.fn();
    const onPreviewInfo = vi.fn();
    const onCopyImagePath = vi.fn();
    const onCopyFolderPath = vi.fn();
    const onAttachBookmark = vi.fn();
    const onSelectPage = vi.fn();
    const onClose = vi.fn();

    render(
      <ImageContextMenu
        page={page}
        pageIndex={0}
        x={100}
        y={100}
        onClose={onClose}
        onRotateBy={onRotateBy}
        onDelete={onDelete}
        onPreviewInfo={onPreviewInfo}
        onCopyImagePath={onCopyImagePath}
        onCopyFolderPath={onCopyFolderPath}
        onAttachBookmark={onAttachBookmark}
        onSelectPage={onSelectPage}
      />,
    );

    const items = screen.getAllByRole("menuitem");
    expect(items).toHaveLength(9);

    fireEvent.click(items[0]); // rotate +90
    expect(onRotateBy).toHaveBeenCalledWith("pg-1", 90);
    fireEvent.click(items[1]); // rotate 180
    expect(onRotateBy).toHaveBeenCalledWith("pg-1", 180);
    fireEvent.click(items[2]); // rotate -90 (270)
    expect(onRotateBy).toHaveBeenCalledWith("pg-1", 270);
    fireEvent.click(items[3]); // preview & info
    expect(onPreviewInfo).toHaveBeenCalledWith("pg-1");
    fireEvent.click(items[4]); // attach bookmark
    expect(onAttachBookmark).toHaveBeenCalledWith(page, 0);
    fireEvent.click(items[5]); // select
    expect(onSelectPage).toHaveBeenCalledWith("pg-1");
    fireEvent.click(items[6]); // copy image path
    expect(onCopyImagePath).toHaveBeenCalledWith("/manga/vol1/001.jpg");
    fireEvent.click(items[7]); // copy folder path
    expect(onCopyFolderPath).toHaveBeenCalledWith("/manga/vol1/001.jpg");
    fireEvent.click(items[8]); // delete
    expect(onDelete).toHaveBeenCalledWith("pg-1");
  });
});
