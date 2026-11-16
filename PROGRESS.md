# PROGRESS.md — Nhật ký Tiến độ Dự án Knit

## Tổng quan Trạng thái
- **Giai đoạn hiện tại:** Hoàn tất toàn bộ 6 core crates (`knit-core`, `knit-archive`, `knit-manga`, `knit-renamer`, `knit-pdf`, `knit-docs`), Frontend React/TypeScript/Tailwind Workbench, lớp vỏ `src-tauri` Desktop Shell và GitHub Actions CI/Release.
- **Cập nhật lần cuối:** 2026-11-14

| Milestone | Trạng thái | Ghi chú |
|---|---|---|
| Phase 0: Grill, Domain Model, ADRs & Plan | Done | Hoàn tất PRD, ARCHITECTURE, RULES, TASK, glossary & ADR-001..005. |
| Milestone 0: Technical Spikes | Done | Đã kiểm chứng `oxideav-avif`, `lopdf` + `hayro`, `typst 0.15` + `zip` AES-256; S4 đo thực tế trên Fedora 44 (`Knit-0.1.0-1.x86_64.rpm` = 20.67 MiB <= 30 MB; ELF `knit-desktop` = 45,559,640 bytes). |
| Milestone 1: Workspace & Desktop Shell | Done | 6 crates + `src-tauri` + React/TS/Tailwind Workbench Shell + icons + capabilities. |
| Milestone 2: Image → PDF & Canvas Editor | Done | `knit-pdf` + `Image2PdfView` + `ImageCanvasEditorModal` (Crop, Text, Freehand Draw) + `BookmarkTreeEditor`. |
| Milestone 3: PDF Merge & Split | Done | `merge_pdfs`, `split_pdf`, `hayro` thumbnail renderer, `PdfOpsView`. |
| Milestone 4: Document → PDF | Done | `knit-docs` (Typst native cho MD/TXT/HTML/EPUB + `soffice` headless detector/runner cho DOCX/PPTX) + `Docs2PdfView`. |
| Milestone 5: Archive & Manga Packager | Done | `knit-archive` + `knit-manga` + `ArchiveView` + `MangaPackView`. |
| Milestone 6: Batch Renamer | Done | `knit-renamer` + `RenamerView` (2-layer filter, Prename, Presets, Bottom-Up, Undo). |
| Milestone 7: Cross-Platform Packaging & Release | In Progress | Đã tạo `.github/workflows/ci.yml` & `release.yml`, đồng thời build & đóng gói thành công trên Linux Fedora 44 (`knit-desktop` + `.rpm`); còn lại chạy CI `.exe` (NSIS) / `.AppImage` / `.deb` và QA thủ công trên máy sạch. |

---

## Nhật ký Phiên làm việc
- **2026-11-14:**
  - Chạy kiểm chứng thành công toàn bộ 29 unit/integration tests trên 6 pure-Rust core crates (`cargo test`).
  - Sửa lỗi sắp xếp Bottom-Up trong `knit-renamer` (ưu tiên `depth` giảm dần trước khi xét file/dir) và chuẩn hóa placeholder không xung đột escape Typst trong `knit-docs`.
  - Hoàn thiện frontend React/TypeScript/Tailwind theo `DESIGIN.md` (`tsc --noEmit`, `vite build`, và Vitest đều pass).
  - Hoàn thiện `src-tauri` (21 IPC commands, `ThrottledReporter`, icons), CI/Release workflows, và sửa bug loop `roots` trong `renamer_preview`.
  - Sau khi cài `webkit2gtk4.1-devel gtk3-devel libsoup3-devel librsvg2-devel`, đã build thành công `target/release/knit-desktop` (`45,559,640 bytes`) và `target/release/bundle/rpm/Knit-0.1.0-1.x86_64.rpm` (`20.67 MiB`).

## Review v1.8 Implementation (2026-11-15)
- **Manga Packager JSON Editor**: Replaced raw JSON `<textarea>` with light-themed CodeMirror 6 `JsonCodeEditor` (syntax highlighting + `color-scheme: light` scrollbars).
- **PDF Merge & Split**: Added horizontal pane width splitter, independent vertical pane height resizing, and `Shift`/`Ctrl`/`Meta` multi-select + multi-page drag-and-drop into output sections.
- **MD → PDF**: Added paper orientation (`portrait`/`landscape`), line spacing, exact TOC page placement (`toc_page` via 2-pass Typst introspection), and configurable page numbering (toggle, start number, start page, 6 positions, 3 formats).
- **Sidebar Resource Monitor**: Added native `/proc` (Linux) and Win32 ToolHelp/Psapi (Windows) process-tree CPU% + RAM aggregation (`get_app_metrics`) displayed at bottom-left of the sidebar.
- **Image → PDF**: Fixed parallel progress bar jumps (`AtomicUsize` + monotonic guard), added Auto Sort (`manual`, `import_order`, `name`, `size`, `type` + Asc/Desc) with `Ctrl+Z` / Undo stack, added `max_pages_per_file` split mode, and rendered edited previews (`render_page_draft_preview_file`) in both grid thumbnails and large preview modal.
- **Verification**: `cargo test` (42/42), `cargo check -p knit-desktop` (exit 0), `pnpm build` (exit 0), `pnpm test` (23/23 across 8 files).

## Review v1.9 Implementation (2026-11-16)
- **Image → PDF RAM Release**: Clicking Clear List now clears the undo stack, import-order refs, `pagesByIdRef`, `editedPreviewCache`, `hiResCache`, `thumbCache`, wipes cached temp thumbnails (`clear_image_preview_cache`), and calls `malloc_trim(0)` on Linux glibc (plus after heavy PDF/Archive/Manga jobs).
- **Import UX Feedback**: Added `ImportFeedbackToast` (~1.6s) and brief green container highlight when importing files across Image → PDF, PDF Merge & Split, Document → PDF, Archive Packager, and Manga Packager.
- **PDF Merge & Split Enhancements**:
  - Added high-res `PdfPageZoomModal` (`render_pdf_page_preview_file`) on double-click in both Split source pages and Merge/Reorder page cards.
  - Increased Source PDF Pages font sizing (`text-base` heading, `text-sm` hints/badges, `text-xs` page pill).
  - Replaced Merge page Up/Down arrows with HTML5 drag-and-drop card reordering, added `MERGE_GRID_OPTIONS` columns selector (`2..6`), integrated `BookmarkTreeEditor` (`custom_bookmarks` in `PdfMergeConfig`), and added file removal with confirmation modal warning about removing dependent pages.
- **Activity Logs & Verbosity**: Added `LogVerbosity` (`minimal` | `normal` | `detailed`) in Settings and `JobReporter::on_log_detail` across `knit-core`, `knit-pdf`, `knit-archive`, `knit-manga`, and `knit-docs`.
- **Export Filename & Default Export Directory**: Added writable directory validation (`validate_export_directory`) in Settings, per-tool `ExportFilenameControl` with realtime duplicate detection, and `ExportConflictModal` (`Overwrite` / `Auto-append _1, _2` / `Cancel`).
- **Verification**: `cargo test` (42/42), `cargo check -p knit-desktop` (exit 0), `pnpm build` (exit 0), `pnpm test` (25/25 across 9 files).

## Review v1.10 Implementation (2026-11-16)
- **Live Destination Conflict Detection**: `useExportFilenameCheck` re-checks `defaultTargetPath` asynchronously every 1500ms (skipped when document hidden) and immediately on window `focus` using O(1) `check_export_conflicts` stat calls.
- **PDF Merge & Split UX & Layout**:
  - Moved primary Merge/Split CTA to the top-right header bar (consistent with all other tools) and placed the Merge/Split mode tabs below the header.
  - Replaced HTML5 drag in Merge/Reorder with pointer-based `hitTestGridInsertIndex` + floating insert bar matching `Image2PdfView`.
  - Fixed 2px column-button width shift (`Image2PdfView` & `PdfOpsView`) by keeping `border` on active option buttons.
  - Added Clear All confirmation modal warning when clearing all loaded PDFs.
- **Terminal-style Activity Logs**: `WorkbenchShell` auto-scrolls Activity Logs to bottom whenever new logs arrive or when opening the Logs drawer (pauses automatically if scrolled up).
- **Batch Renamer Enhancements**:
  - Fixed sticky header top subpixel gap (`border-separate border-spacing-0` + `sticky top-0 shadow-[inset_0_-1px_0_#DEE2E6]`).
  - Fixed horizontal column jitter on scroll (`table-fixed` + `<colgroup>`).
  - Increased table font size to `text-sm` and added clickable header column sorting (`buildRenamerTree` sibling sort + `sortFlatRenameItems`).
  - Added Scanned Folders card with per-folder removal and dedicated empty filter-match state (also added empty scan state to Manga Packager).
- **Manga Packager Active Folder Banner**: Moved green import/rescan highlight onto a dedicated active source folder banner below Dropzone.
- **Verification**: `cargo test` (42/42), `cargo check -p knit-desktop` (exit 0), `pnpm build` (exit 0), `pnpm test` (26/26 across 9 files).
