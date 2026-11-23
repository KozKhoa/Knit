---
title: Knit image2pdf Agent Integration & API Reference
description: Self-contained Tauri v2 IPC and pure-Rust knit-pdf integration guide for converting images into PDF with lossless passthrough, non-destructive edits, bookmarks, and chunked splitting.
version: 0.2.0
crates: [knit-pdf, knit-core, knit-desktop]
ipc_commands:
  - pdf_scan_images
  - pdf_sync_animated_drafts
  - render_image_thumb_file
  - render_page_draft_preview_file
  - check_missing_files
  - pdf_build_from_images
  - cancel_job
  - clear_image_preview_cache
schema: docs/specs/image2pdf.schema.json
architecture: docs/tools/image2pdf/image2pdf-architecture.md
deprecated: false
---

> Index: [`/llms.txt`](../../../llms.txt) · Machine-readable contract: [`docs/specs/image2pdf.schema.json`](../../specs/image2pdf.schema.json) · Architecture & Mermaid diagrams: [`docs/tools/image2pdf/image2pdf-architecture.md`](./image2pdf-architecture.md)

# Knit `image2pdf` — Agent Integration & API Reference (`v0.2.0`)

Convert static, vector, or animated images (`jpg`, `jpeg`, `jfif`, `png`, `webp`, `avif`, `gif`, `bmp`, `tiff`, `tif`, `svg`) into one or more PDF files using either:
1. **Frontend Tauri IPC wrappers** in `src/lib/ipc.ts` (inside a Tauri v2 WebView where `__TAURI_INTERNALS__` exists), or
2. **Pure-Rust library calls** in `crates/knit-pdf` (zero Tauri dependency; suitable for headless CLIs, integration tests, or Rust services).

> **Surface note:** Knit's machine-readable contract in [`docs/specs/image2pdf.schema.json`](../../specs/image2pdf.schema.json) uses Draft 2020-12 JSON Schema plus `x-ipc-operations`; annotation conventions (`operationId`, `summary`, `description`, `enum`, `x-enumDescriptions`) are inferred from OpenAPI agent-readability guidance.

---

## Quickstart: End-to-End Working Calls

### Path A: TypeScript / Tauri WebView (`@tauri-apps/api@^2.5.0`)

**Prerequisites:** Running inside the Knit Tauri desktop runtime (`isTauriRuntime() === true`), with `@tauri-apps/api/core` (`^2.5.0`) and wrappers from `src/lib/ipc.ts` + `src/types/ipc.ts`.

```ts
import {
  buildImage2Pdf,
  cancelActiveJob,
  checkMissingFiles,
  clearImagePreviewCache,
  isJobCancelledError,
  isTauriRuntime,
  scanImagesForPdf,
} from "../lib/ipc";
import type { Image2PdfConfig, PdfBuildResult } from "../types/ipc";

export async function convertFolderToPdf(
  folderPath: string,
  outputPdfPath: string,
): Promise<PdfBuildResult> {
  if (!isTauriRuntime()) {
    throw new Error("Tauri IPC is only available inside the Knit desktop window.");
  }

  // 1. Scan directory into PageDraft[] + folder-based BookmarkNode[]
  const scan = await scanImagesForPdf(
    [folderPath],
    true, // isFolder
    "first_frame_only",
    (ev) => {
      if (ev.kind === "progress") {
        console.log(`${ev.data.phase}: ${ev.data.done}/${ev.data.total}`);
      }
    },
  );
  if (scan.pages.length === 0) {
    throw new Error("No supported images found in folder.");
  }

  // 2. Preflight missing files before starting export
  const uniquePaths = Array.from(new Set(scan.pages.map((p) => p.source.path)));
  const missing = await checkMissingFiles(uniquePaths);
  if (missing.length > 0) {
    throw new Error(`Missing source files: ${missing.join(", ")}`);
  }

  // 3. Build config and stream PDF to disk
  const jobId = crypto.randomUUID();
  const config: Image2PdfConfig = {
    output_path: outputPdfPath, // e.g. "/tmp/album.pdf"
    layout: { mode: "original_size", dpi: 72.0 },
    jpeg_quality: 88,
    lossless_passthrough: true,
    animated_policy: "first_frame_only",
    export_mode: "balanced",
    max_mb: null,
    max_pages_per_file: null,
  };

  try {
    // Returns: { output_files: string[], total_pages: number, total_bytes: number, passthrough_pages: number }
    const result = await buildImage2Pdf(jobId, scan.pages, scan.bookmarks, config, (ev) => {
      if (ev.kind === "log" && ev.level === "error") {
        console.error(ev.message);
      }
    });
    console.log(result.output_files, result.total_pages, result.total_bytes, result.passthrough_pages);
    return result;
  } catch (err) {
    const msg = String(err);
    if (isJobCancelledError(msg)) {
      await cancelActiveJob(jobId).catch(() => {});
      throw new Error("Job cancelled by user");
    }
    throw err;
  } finally {
    // Optional when clearing the workspace list to wipe temp JPEGs + trim Linux heap
    await clearImagePreviewCache();
  }
}
```

### Path B: Pure-Rust Core Crate (`knit-pdf = 0.1.0`, `knit-core = 0.1.0`)

**Prerequisites:** Rust crate depending on `knit-pdf` and `knit-core` inside the Cargo workspace.

```rust
use knit_core::{CancellationToken, NoopReporter};
use knit_pdf::{
    build_pdf_from_drafts, scan_image_folder, AnimatedImagePolicy, Image2PdfConfig,
    PageLayoutPolicy, PdfBuildResult, PdfExportMode,
};
use std::path::Path;

pub fn export_album(folder: &Path, output_pdf: &Path) -> knit_core::Result<PdfBuildResult> {
    let scan = scan_image_folder(folder, AnimatedImagePolicy::FirstFrameOnly)?;

    let config = Image2PdfConfig {
        output_path: output_pdf.to_path_buf(),
        layout: PageLayoutPolicy::OriginalSize { dpi: 72.0 },
        jpeg_quality: 88,
        lossless_passthrough: true,
        animated_policy: AnimatedImagePolicy::FirstFrameOnly,
        export_mode: PdfExportMode::Balanced,
        max_mb: None,
        max_pages_per_file: None,
    };

    let cancel = CancellationToken::new();
    let result = build_pdf_from_drafts(
        &scan.pages,
        &scan.bookmarks,
        &config,
        &cancel,
        &NoopReporter,
    )?;

    // Prints: ["/tmp/album.pdf"] pages=12 bytes=5242880 passthrough=10
    println!(
        "{:?} pages={} bytes={} passthrough={}",
        result.output_files, result.total_pages, result.total_bytes, result.passthrough_pages
    );
    Ok(result)
}
```

> **Rust `PageLayoutPolicy` & `JobReporter` variants:**
> - Fit A4 / Fit Letter in Rust:
>   `PageLayoutPolicy::FitA4 { margin_pt: 20.0, background: PageBackground::White }` (or `PageBackground::Transparent`, `PageBackground::Black`, `PageBackground::Custom { r, g, b }`) and `PageLayoutPolicy::FitLetter { margin_pt, background }`.
> - Reporter-aware folder scan signature:
>   `scan_image_folder_with_reporter(root: &Path, animated_policy: AnimatedImagePolicy, reporter: &dyn knit_core::JobReporter) -> knit_core::Result<ImageScanResult>`.

> **TypeScript helper & `JobEvent` contract:**
> - `isJobCancelledError(message: string): boolean` in `src/lib/ipc.ts` checks case-insensitive substrings `"cancel"`, `"hủy"`, `"huy"`.
> - `JobEvent`: `{ kind: "progress"; data: { phase: string; done: number; total: number; bytes_done: number; bytes_total: number; current_item: string } } | { kind: "log"; level: "info" | "warn" | "error"; message: string }`.
> - In TypeScript `PageLayoutPolicy`, `fit_a4` and `fit_letter` require `background: PageBackground`; in Rust serde deserialization, `background` defaults to `PageBackground::Transparent`.

---

## Programmatic Equivalents for UI Actions

| UI Action in `Image2PdfView` | Programmatic IPC Call (`src/lib/ipc.ts`) | Rust Backend Implementation |
|---|---|---|
| Import Files / Drag-and-Drop files | `scanImagesForPdf(paths, false, animatedPolicy, onEvent)` | `pdf_scan_images` → `knit_pdf::scan_image_files_with_reporter` |
| Import Folder (auto folder bookmarks + `Cover`) | `scanImagesForPdf([dir], true, animatedPolicy, onEvent)` | `pdf_scan_images` → `knit_pdf::scan_image_folder_with_reporter` |
| Change animated GIF/WebP policy after import | `syncAnimatedDrafts(drafts, bookmarks, animatedPolicy)` | `pdf_sync_animated_drafts` → `knit_pdf::expand_drafts_for_animated_policy` |
| Render grid card thumbnail | `convertFileSrc(await renderImageThumbFile(path, 360))` | `render_image_thumb_file` (`thumb_semaphore`) → `render_image_thumbnail_jpeg` |
| Open Zoom modal / Edited card preview | `convertFileSrc(await renderPageDraftPreviewFile(draft, 1400))` | `render_page_draft_preview_file` (`preview_semaphore`) → `render_page_draft_preview_jpeg` |
| Edit page (Rotate / Crop / Text / Draw) | Mutate `PageDraft` in memory (`rotation_deg`, normalized `[0.0, 1.0]` `crop`, `annotations`) | Applied at render/export time by `knit_pdf::apply_edits` |
| Auto-remap bookmarks after page delete | `remapBookmarksAfterPageRemoval(bookmarks, total, removedIndices)` in `src/lib/bookmarks.ts` | Split-part bookmark slicing uses `knit_pdf::remap_tree` |
| Preflight missing files before Export | `checkMissingFiles(uniquePaths)` | `check_missing_files` (`Path::exists`) |
| Export PDF (`Fast` / `Balanced` / `Safe`) | `buildImage2Pdf(jobId, drafts, bookmarks, config, onEvent)` | `pdf_build_from_images` → `knit_pdf::build_pdf_from_drafts` |
| Cancel running export | `cancelActiveJob(jobId)` | `cancel_job` → `CancellationToken::cancel()` |
| Clear List (free caches & RAM) | `clearImagePreviewCache()` | `clear_image_preview_cache` → deletes `image-thumbs/` + `trim_process_heap()` |

> **Deprecated API notice:** `renderImageThumbBase64` (`render_image_thumb` returning a Base64 PNG string) is **deprecated for virtualized grids** in `v0.1.0`. Always use `renderImageThumbFile` + `convertFileSrc(path)` (and `renderPageDraftPreviewFile` when `PageDraft` has rotation/crop/annotations).

---

## Configuration, Enums & Bounds Reference

### `Image2PdfConfig` & Export Mode Matrix

| Field / Variant | Type / Values | Default | Behavior & Constraints |
|---|---|---|---|
| `output_path` | `string` (`PathBuf`) | *(required)* | Target `.pdf` file. When split produces `> 1` part, outputs `<stem>_part01.pdf`, `<stem>_part02.pdf`, etc. |
| `layout.mode` | `"original_size"` \| `"fit_a4"` \| `"fit_letter"` | `"original_size"` | Page box clamped to PDF ISO bounds `[3.0, 14400.0]` pt (`A4 = 595.28 x 841.89`, `Letter = 612.0 x 792.0`). |
| `layout.dpi` | `number` (`> 0`) | `72.0` | Used by `original_size` (`72.0` means `1px = 1pt`). |
| `layout.margin_pt` | `number` (`>= 0`) | `0` | Page margin in PDF points for `fit_a4` / `fit_letter` (`1 mm = 72 / 25.4 pt`). |
| `layout.background.kind` | `"transparent"` \| `"white"` \| `"black"` \| `"custom"` | `"transparent"` | `"custom"` requires integer `r`, `g`, `b` in `0..=255`. |
| `jpeg_quality` | `integer` (`1..=100`) | `88` | JPEG re-encode quality for non-passthrough or edited pages (clamped to `40..=95` for thumb/preview helpers). |
| `lossless_passthrough` | `boolean` | `true` | Unedited JPEG (with EXIF orientation 1), non-interlaced 8-bit `Gray`/`RGB` PNG without `tRNS`, and pure-Rust rasterized `SVG` (via `usvg`/`resvg` + `FlateStream`) bypass JPEG re-encode. Forced `true` in `fast` UI export. |
| `animated_policy` | `"first_frame_only"` \| `"unpack_all_frames"` \| `"embed_rich_media"` | `"first_frame_only"` | `"unpack_all_frames"` expands GIF/WebP frames into `AnimatedFrame` drafts with `duration_ms` written as PDF `/Dur`; `"embed_rich_media"` embeds animated GIFs via `/RichMedia` + `/Screen` annotations. |
| `export_mode` | `"fast"` \| `"balanced"` \| `"safe"` | `"balanced"` | Controls Rayon concurrency, `batch_size`, disk check, split behavior, and pixel verification (table below). |
| `max_mb` | `number \| null` (`> 0`) | `null` | Splits PDFs before exceeding `max_mb` MiB. Ignored when `export_mode == "fast"`. |
| `max_pages_per_file` | `integer \| null` (`>= 1`) | `null` | Splits PDFs after `N` pages. Ignored when `export_mode == "fast"`. |

### `PdfExportMode` Behavioral Guarantees

| `export_mode` | `worker_threads` | Rayon `batch_size` | `ensure_disk_space` | Splitting (`max_mb` / `max_pages_per_file`) | Passthrough Verification |
|---|---|---|---|---|---|
| `"fast"` | `cpus.clamp(4, 8)` | `24` | Skipped | Ignored (always 1 PDF) | Header-only JPEG/PNG check (`imaging.rs`) |
| `"balanced"` | `cpus.clamp(2, 4)` | `(cpus.clamp(2, 4) * 2).clamp(4, 8)` | Checked (`1x` est. input) | Enabled | Header-only JPEG/PNG check; fallback decode on malformed header |
| `"safe"` | `cpus.clamp(2, 4)` | `4` | Checked (`2x` est. input) | Enabled | **Full pixel decode** check before allowing passthrough |

### `PageDraft` Normalized Coordinate Contract (`[0.0, 1.0]`)

- `rotation_deg`: clockwise degrees in `{0, 90, 180, 270}`. Any `rotation_deg.rem_euclid(360) != 0` sets `has_pixel_edits() == true` and disables passthrough.
- `crop`: `CropRect { x, y, width, height }` normalized to `[0.0, 1.0]` relative to EXIF-oriented dimensions.
- `annotations.texts[]`: `x`, `y` in `[0.0, 1.0]`, `font_size_ratio` relative to post-crop/rotate image height (default `0.04`), `color_hex` (`#RRGGBB` or `#RRGGBBAA`).
- `annotations.strokes[]`: `points: [x, y][]` in `[0.0, 1.0]`, `stroke_width_ratio` relative to shortest image side (default `0.006`).
- **Overloaded term note:** `PageSource.kind === "pdf_page"` shares the `PageDraft` model definition in `models.rs`, **not** `image2pdf` export. Passing `pdf_page` into raster `load_source_image` fails because `image2pdf` only renders raster `image_file` and `animated_frame` sources.

---

## Exact Error String Mapping

| Exact Error Substring / Pattern | Source | Cause | Fix & Verification |
|---|---|---|---|
| `Chua chon anh hoac thu muc anh` | `src-tauri/src/lib.rs` (`pdf_scan_images`) | `paths` array is empty. | Pass `>= 1` valid image or directory paths. |
| `Khong co trang nao de tao PDF` | `crates/knit-pdf/src/packer.rs` | Empty `drafts` slice passed to `build_pdf_from_drafts`. | Ensure `drafts.length >= 1` before calling `buildImage2Pdf`. |
| `Invalid input: PdfPage duoc xu ly truc tiep trong PDF ops` | `crates/knit-pdf/src/imaging.rs` | Draft with `PageSource::PdfPage` (`kind: "pdf_page"`) passed into `image2pdf` export. | Only pass `image_file` or `animated_frame` drafts; use `pdf_merge` / `pdf_split` for PDF pages. |
| `Job cancelled by user` | `crates/knit-core/src/error.rs` (`KnitError::Cancelled`) | `cancel_job(jobId)` cancelled `CancellationToken`. | Match via `isJobCancelledError(msg)`, display localized cancel state; `TempFilesGuard` removes `.tmp` files automatically. |
| `Insufficient disk space: need ~<needed>, available <available>` | `crates/knit-core/src/error.rs` | Target drive free bytes `< 1x` (`balanced`) or `< 2x` (`safe`) estimated input bytes. | Free disk space, target another volume, or switch `export_mode` after verifying disk space. |
| `Path not found: <path>` | `crates/knit-core/src/error.rs` / `imaging.rs` | Folder root or source image deleted/moved after import. | Run `checkMissingFiles(uniquePaths)` preflight and remove or re-import missing entries. |
| `Khong tim thay font UTF-8 mac dinh` | `crates/knit-pdf/src/imaging.rs` | `typst_assets::fonts()` could not load a fallback `FontArc`. | Ensure `typst-assets` `fonts` feature is enabled in `crates/knit-pdf/Cargo.toml`. |
| `Loi giai ma anh <path>: <err>` / `AVIF decode loi <path>: <err>` | `crates/knit-pdf/src/imaging.rs` | Corrupted image payload or unsupported bitstream. | Inspect source file with `inspect_image_dimensions(&path)` or re-save source image before export. |
| `File selection is only available inside the Knit desktop window.` | `src/lib/ipc.ts` | Called native dialog/IPC outside Tauri WebView. | Check `isTauriRuntime()` or call `knit_pdf::*` directly in Rust tests/CLI. |
