# PROGRESS.md — Nhật ký Tiến độ Dự án Knit

## Tổng quan Trạng thái
- **Giai đoạn hiện tại:** Hoàn tất toàn bộ 6 core crates (`knit-core`, `knit-archive`, `knit-manga`, `knit-renamer`, `knit-pdf`, `knit-docs`), Frontend React/TypeScript/Tailwind Workbench, lớp vỏ `src-tauri` Desktop Shell và GitHub Actions CI/Release.
- **Cập nhật lần cuối:** 2026-11-20

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

## PDF Merge & Split Performance Optimization (2026-11-17)
- **Rust-cached JPEG PDF Thumbnails**: Added `render_pdf_thumbnail_jpeg` in `knit-pdf` and `render_pdf_thumb_file` Tauri IPC command returning `.jpg` cache paths served via `convertFileSrc` instead of base64 PNG strings.
- **Viewport-driven Concurrent Queue & LRU Batching**: Wired `IntersectionObserver` + 3-worker LIFO queue (`thumbGenRef` cancellation), 40ms `flushPendingPdfThumbs` state batching (`mergeThumbCacheLru` cap 300), and `loading="lazy" decoding="async"`.
- **Memoized Cards & Virtualized Merge Grid**: Extracted `MergePageCard`, `SplitSourceCard`, and `SplitSectionItemCard` into `src/components/PdfPageCards.tsx`; virtualized the Merge grid (`computeVisibleRowRange` + `ResizeObserver`), eliminated `getComputedStyle`/`getBoundingClientRect` per-frame layout thrashing during `tickDrag`, added `mergeInsertAtRef` guard, GPU `translate3d` drag ghost, and `56px` edge auto-scroll.
- **Pointer Drag for Split PDF**: Replaced HTML5 `draggable` in Split source & section cards with pointer drag (`startSplitPointerDrag`), `elementFromPoint` hit-testing, `splitDragGhostRef`, and edge auto-scroll.
- **Verification**: `cargo test` (42/42), `cargo check -p knit-desktop` (exit 0), `pnpm build` (exit 0), `pnpm test` (26/26 across 9 files).

## Review v1.11 Implementation (2026-11-17)
- **Image → PDF & Toolbar Alignment**: Lifted the toolbar (Grid density, Sort, Undo, Bookmark toggle) above the `lg:grid-cols-3` container so toggling Bookmarks no longer shifts the button/toolbar; added `8` images/row option (`[2, 3, 4, 5, 6, 8]`).
- **Double-click Zoom Button Guard**: Prevented double-clicks on Rotate / Edit / Delete / Quick-Add buttons inside `PageCard`, `MergePageCard`, `SplitSourceCard`, and `SplitSectionItemCard` from bubbling up to open the zoom/edit modal.
- **Batch Rename Toast Heading**: Added `heading?: string` to `CompletedExportInfo` (`ExportSuccessToast`) and `onFinishJob`, displaying `"Đổi tên thành công"` / `"Rename Complete"` (and Undo heading) instead of `"Export Complete"`.
- **PDF Merge & Split Upgrades**:
  - Unified `ExportFilenameControl` at the top right below the `Merge` / `Split` mode switcher (filename for Merge, prefix for Split); added `8` pages/row option for Merge and `[2, 3, 4, 5, 6, 8]` for Split Source Pages.
  - Added PDF import loading indicator + progress inside `Dropzone`.
  - Virtualized Split `Source PDF Pages` with `computeVisibleRowRange`, `auto-rows-max`, and `shrink-0` cards (fixing >300-page row height collapse), and switched thumbnail scheduling in both Merge and Split to deterministic visible-window queuing (`enqueueThumbWindow` + 500-entry LRU) so scrolling down always loads page thumbnails.
  - Added multi-file PDF Split support (`split_multi_pdf` in `knit-pdf`, `pdf_split_multi` Tauri command, file filter pills, cross-file `file_index` tracking in sections, and batch rule splitting).
  - Upgraded Output PDF Sections drag & drop to `Image2Pdf`-style `hitTestGridInsertIndex` insertion bars + card thumbnail ghost, double-click zoom modal on section items, per-section height resize handles (`120..720px`), and matched the vertical width splitter styling to horizontal height resizers.
- **Verification**: `cargo check -p knit-desktop` (exit 0, 0 warnings), `cargo test` (43/43), `pnpm build` (exit 0), `pnpm test` (29/29 across 10 files).

## Frontend View Modularization & Shared UI/Hooks Refactor (2026-11-17)
- **Shared CSS Tokens & UI Primitives**: Added `@layer components` helpers (`.knit-card`, `.knit-input`, `.knit-btn-*`, `.knit-alert-error`) in `src/styles/tokens.css`, plus `ViewHeader`, `ErrorBanner`, `ConfirmModal`, `GridColumnSelector`, `PaneResizeHandle`, and `DocumentFindBar` in `src/components/`.
- **Shared Hooks**: Extracted `useThumbnailQueue` (LIFO worker pool, 40ms batching, generation cancellation, LRU eviction), `useVirtualizedGrid`, and `useHorizontalRatioResize` into `src/hooks/` with unit tests.
- **View Decomposition**:
  - `PdfOpsView.tsx` (2,876 → 1,107 lines) split into `src/views/pdf-ops/{pdfOpsTypes,LoadedPdfList,PdfMergePane,PdfSplitPane}`.
  - `Image2PdfView.tsx` (1,926 → 1,179 lines) split into `src/views/image2pdf/{ImagePageCard,Image2PdfSettingsCard,ImagePreviewModal}`.
  - `Docs2PdfView.tsx` (1,300 → 804 lines) split into `src/views/docs2pdf/{Docs2PdfSettingsCard,DocsSplitWorkbench}`.
  - `RenamerView.tsx` (1,159 → 615 lines) split into `src/views/renamer/{RenamerFilterCard,RenamerRuleCard,RenamerPreviewTable}`.
  - Adopted `ViewHeader` & `ErrorBanner` across `ArchiveView`, `MangaPackView`, and `SettingsView`.
- **Verification**: `pnpm build` (exit 0), `pnpm test` (15/15 files, 35/35 tests), `cargo check -p knit-desktop && cargo test` (43/43 tests).

## Review v1.12 Implementation (2026-11-18)
- **Image → PDF Selection Mode & Auto-Bookmark Remap**: Added multi-select mode (`400ms` long-press, `Ctrl+Click`, `Shift+Click`, batch rotate & delete with single Undo snapshot), `remapBookmarksAfterPageRemoval` (`[target, nextStop)` interval remap), and shared `BookmarkPageBadge` across Image2PDF and Merge PDF.
- **PDF Thumbnail & Preview Concurrency**: Added `HAYRO_PDF_CACHE` (4-entry `Arc<Pdf>` mmap LRU), isolated `preview_semaphore()` (2 permits) from background `thumb_semaphore()`, and updated `useThumbnailQueue` to prune scrolled-away keys and prioritize visible viewport cards.
- **Linux PSS RAM Measurement & Activity Log Pinning**: Switched `read_linux_process_ram_bytes` to read `Pss_Anon + Pss_Shmem` from `/proc/{pid}/smaps_rollup` and fixed `WorkbenchShell` log auto-follow with `useLayoutEffect` + `↓ Latest` pill.
- **Verification**: `cargo test --workspace` (46/46), `cargo check -p knit-desktop` (exit 0), `pnpm build` (exit 0), `pnpm test` (16/16 files, 41/41 tests).

## Review v1.13 Implementation (2026-11-19)
- **Non-blocking Output Size Estimation**: Added `estimate_archive_output`, `Story.total_bytes`, `get_file_size_bytes`, and `src/lib/sizeEstimate.ts` across all 5 export tools.
- **Bookmark Tree Drag-Drop, Validation & Resizable Sticky Layout**: Added pointer drag-drop (`moveBookmarkNode`), non-blocking logical warnings (`validateBookmarks`), 6-digit `w-28` page input, horizontal ratio splitter + sticky Bookmark column in `Image2PdfView`, and 9-action `ImageContextMenu`.
- **PDF Duplicate Filename Disambiguation & CSS Variable Splitter**: Added full-path disambiguation and duplicate-name warning badges in `LoadedPdfList`/`PdfSplitPane`, CSS variable `rAF` drag mode in `useHorizontalRatioResize` (eliminating React re-renders while dragging splitters on multi-GB PDFs), and fixed mid-document TOC placement (`introspector.page(loc)`) in `knit-docs`.
- **Verification**: `cargo test --workspace` (49/49), `cargo check -p knit-desktop` (exit 0), `pnpm build` (exit 0), `pnpm test` (18/18 files, 54/54 tests).

## Review v1.14 Implementation (2026-11-19)
- **Card Size Presets & Context Menus**: Added `CardSizeSelector` (`small` | `medium` | `large`) for Image2PDF and PDF Merge & Split, plus `PdfPageContextMenu` for Merge and Split cards.
- **Bookmark Tree UX & Undo**: Fixed warning badge dimensions (`knit-control-sm min-w-8`), unconstrained vertical resize height, edge auto-scroll in `useVerticalResize`, restricted nesting drop zone to the grip handle icon, added 50-step Bookmark Undo (`Ctrl+Z`), chunked async `handlePopulateSectionsFromRule` with UI lock, and simplified inline `~size` output estimate text.
- **Verification**: `cargo test --workspace` (49/49), `cargo check -p knit-desktop` (exit 0), `pnpm build` (exit 0), `pnpm test` (19/19 files, 62/62 tests).

## Review v1.15 Implementation (2026-11-20)
- **PDF Merge Per-Page / Per-File Modes & Split Item Context Menu**: Added `PdfMergeMode` (`per_page` ↔ `per_file` with `MergeFileCard` and contiguity confirmation guard) and extended `PdfPageContextMenu` in `Output PDF Sections` with Rotate (`90°`/`180°`/`270°`) and Delete actions.
- **Interactive Zoom & Pan Modal**: Created `ZoomPanViewport` (cursor-centered wheel zoom `100%..500%` + pointer pan) and wired it into `ImagePreviewModal`, `PdfPageZoomModal`, and double-click page zoom on `PdfJsPreview` (`Docs2PdfView`).
- **Localized Cancellation, English Activity Logs, 0-based Page Numbering & Multi-Card Drag**: Standardized Rust `JobReporter` logs to English, localized cancellation banners via `isJobCancelledError`, allowed `Start numbering at = 0` in `Docs2Pdf`, added pre-export `check_missing_files` validation + `Missing file` card badges in `Image2PdfView`, and enabled multi-selected card group drag-and-drop (`reorderSelectedPages`).
- **Verification**: `cargo test --workspace` (50/50), `cargo check -p knit-desktop` (exit 0), `pnpm build` (exit 0), `pnpm test` (20/20 files, 69/69 tests).

## Document → PDF Memory Hygiene & Preview Concurrency Fix (2026-11-20)
- **Typst `comemo` Cache Eviction & Shared Virtual Assets**: Added `comemo::evict(2)` via `ComemoEvictGuard` after each Typst compilation, `evict_typst_cache()`, and `Arc<HashMap<String, Bytes>>` in `KnitTypstWorld` to avoid cloning virtual asset maps across multi-pass TOC compilations.
- **Single-Entry Parsed EPUB Cache**: Added `LAST_PARSED_EPUB` in `crates/knit-docs/src/html_epub.rs` keyed by `(path, file_len, mtime_nanos)` so changing page numbering or layout options reuses pre-parsed markup and normalized image buffers without re-extracting the `.epub` archive.
- **Serialized Cancellable Preview IPC & PDF.js Canvas Release**: Added `docs_preview_cancel` + 1-permit `docs_preview_semaphore()` + `trim_process_heap()` in `src-tauri/src/lib.rs`, `destroyPdfDoc` (`doc.destroy()` / `loadingTask.destroy()`), and two-way `IntersectionObserver` off-screen `<canvas>` backing-store release (`canvas.width = 0; canvas.height = 0`) in `PdfJsPreview.tsx`.
- **Verification**: `cargo test --workspace` (51/51), `cargo check -p knit-desktop` (exit 0), `pnpm build` (exit 0), `pnpm test` (20/20 files, 69/69 tests), `python3 .agents/skills/knit-qa-gate/scripts/audit-rules.py` (Pass).
