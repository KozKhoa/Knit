---
title: Knit pdf-ops Agent Integration & API Reference
description: Self-contained Tauri v2 IPC and pure-Rust knit-pdf integration guide for inspecting, merging, rotating, bookmarking, and splitting single or multiple PDF files.
version: 0.2.0
crates: [knit-pdf, knit-core, knit-desktop]
ipc_commands:
  - pdf_inspect
  - render_pdf_thumb_file
  - render_pdf_page_preview_file
  - read_pdf_file_bytes
  - pdf_release_cached_files
  - pdf_merge
  - pdf_split
  - pdf_split_multi
  - cancel_job
schema: docs/specs/pdf-ops.schema.json
architecture: docs/pdf-ops-architecture.md
deprecated: false
---

> Index: [`/llms.txt`](../llms.txt) · Machine-readable contract: [`docs/specs/pdf-ops.schema.json`](./specs/pdf-ops.schema.json) · Architecture & Mermaid diagrams: [`docs/pdf-ops-architecture.md`](./pdf-ops-architecture.md)

# Knit `pdf-ops` — Agent Integration & API Reference (`v0.2.0`)

Inspect metadata and `/Outlines`, render disk-cached page thumbnails/zoom previews via `hayro`, merge arbitrary page selections with rotation and bookmark remapping, or split single/multiple PDFs using either:
1. **Frontend Tauri IPC wrappers** in `src/lib/ipc.ts` (inside a Tauri v2 WebView where `__TAURI_INTERNALS__` exists), or
2. **Pure-Rust library calls** in `crates/knit-pdf` (zero Tauri dependency; suitable for headless CLIs, integration tests, or Rust services).

---

## Quickstart: End-to-End Working Calls

### Path A: TypeScript / Tauri WebView (`@tauri-apps/api@^2.5.0`)

**Prerequisites:** Running inside the Knit Tauri desktop runtime (`isTauriRuntime() === true`) with wrappers from `src/lib/ipc.ts` and types from `src/types/ipc.ts`.

```ts
import {
  cancelActiveJob,
  inspectPdfFile,
  isJobCancelledError,
  isTauriRuntime,
  mergePdfFiles,
  releasePdfCachedFiles,
  splitMultiPdfFiles,
} from "../lib/ipc";
import type { PdfBuildResult, PdfMergeConfig, PdfSplitRule } from "../types/ipc";

export async function mergeAndSplitPdfs(
  inputPaths: string[],
  mergedOutPath: string,
  splitOutDir: string,
): Promise<{ merged: PdfBuildResult; split: PdfBuildResult }> {
  if (!isTauriRuntime()) {
    throw new Error("Tauri IPC is only available inside the Knit desktop window.");
  }

  // 1. Lightweight mmap metadata + outline inspection (skips image streams)
  const infos = await Promise.all(inputPaths.map((p) => inspectPdfFile(p)));
  if (infos.length === 0) {
    throw new Error("At least 1 PDF file is required.");
  }

  // 2. Merge selected pages with custom rotation (0/90/180/270)
  const mergeJobId = crypto.randomUUID();
  const mergeConfig: PdfMergeConfig = {
    inputs: infos.map((f) => f.path),
    selected_pages: [
      { file_index: 0, page_index: 0, rotation_deg: 0 },
      { file_index: infos.length > 1 ? 1 : 0, page_index: 0, rotation_deg: 90 },
    ],
    output_path: mergedOutPath,
    preserve_bookmarks: true,
    custom_bookmarks: null,
  };

  let merged: PdfBuildResult;
  try {
    merged = await mergePdfFiles(mergeJobId, mergeConfig, (ev) => {
      if (ev.kind === "progress") {
        console.log(`${ev.data.phase}: ${ev.data.done}/${ev.data.total}`);
      }
    });
  } catch (err) {
    if (isJobCancelledError(String(err))) {
      await cancelActiveJob(mergeJobId).catch(() => {});
      throw new Error("Merge cancelled by user");
    }
    throw err;
  }

  // 3. Cross-file CustomGroups split (or single/batch split rules)
  const splitJobId = crypto.randomUUID();
  const rule: PdfSplitRule = {
    rule: "custom_groups",
    groups: [
      {
        name: "intro_extract",
        pages: [{ file_index: 0, page_index: 0, rotation_deg: 0 }],
      },
    ],
  };

  const split = await splitMultiPdfFiles(
    splitJobId,
    infos.map((f) => f.path),
    infos.map((_, idx) => `doc_${idx + 1}`),
    splitOutDir,
    rule,
  );

  // 4. Release Hayro mmap handles when clearing or removing files
  await releasePdfCachedFiles(infos.map((f) => f.path));
  return { merged, split };
}
```

### Path B: Pure-Rust Core Crate (`knit-pdf = 0.2.0`, `knit-core = 0.1.0`)

**Prerequisites:** Rust crate depending on `knit-pdf` and `knit-core` inside the Cargo workspace.

```rust
use knit_core::{CancellationToken, NoopReporter};
use knit_pdf::{
    clear_pdf_reader_cache, inspect_pdf, merge_pdfs, split_pdf, PageSelection, PdfBuildResult,
    PdfMergeConfig, PdfSplitRule,
};
use std::path::Path;

pub fn merge_and_split_every_2_pages(
    first_pdf: &Path,
    second_pdf: &Path,
    merged_out: &Path,
    split_dir: &Path,
) -> knit_core::Result<(PdfBuildResult, PdfBuildResult)> {
    let info_a = inspect_pdf(first_pdf)?;
    let info_b = inspect_pdf(second_pdf)?;
    println!("Loaded {} + {} pages", info_a.page_count, info_b.page_count);

    let cancel = CancellationToken::new();
    let merge_cfg = PdfMergeConfig {
        inputs: vec![first_pdf.to_path_buf(), second_pdf.to_path_buf()],
        selected_pages: Some(vec![
            PageSelection { file_index: 0, page_index: 0, rotation_deg: 0 },
            PageSelection { file_index: 1, page_index: 0, rotation_deg: 90 },
        ]),
        output_path: merged_out.to_path_buf(),
        preserve_bookmarks: true,
        custom_bookmarks: None,
    };
    let merged = merge_pdfs(&merge_cfg, &cancel, &NoopReporter)?;

    let split = split_pdf(
        merged_out,
        split_dir,
        "chapter",
        &PdfSplitRule::EveryNPages { n: 2 },
        &cancel,
        &NoopReporter,
    )?;

    clear_pdf_reader_cache();
    Ok((merged, split))
}
```

---

## Programmatic Equivalents for UI Actions

| UI Action in `PdfOpsView` | Programmatic IPC Call (`src/lib/ipc.ts`) | Rust Backend Implementation |
|---|---|---|
| Import / Drop PDF files | `inspectPdfFile(path)` | `pdf_inspect` → `knit_pdf::inspect_pdf` |
| Render grid page thumbnail | `convertFileSrc(await renderPdfThumbFile(path, pageIdx, 260))` | `render_pdf_thumb_file` (`thumb_semaphore`) → `render_pdf_thumbnail_jpeg` |
| Double-click page zoom modal | `convertFileSrc(await renderPdfPagePreviewFile(path, pageIdx, 1400))` | `render_pdf_page_preview_file` (`preview_semaphore`) → `render_pdf_thumbnail` |
| Remove PDF / Clear All | `releasePdfCachedFiles(paths)` / `clearImagePreviewCache()` | `pdf_release_cached_files` → `evict_pdf_reader_cache_paths` + `trim_process_heap` |
| Merge PDFs (`per_page` or `per_file`) | `mergePdfFiles(jobId, config, onEvent)` | `pdf_merge` → `knit_pdf::merge_pdfs` |
| Split single PDF | `splitPdfFile(jobId, inputPath, outputDir, stem, rule, onEvent)` | `pdf_split` → `knit_pdf::split_pdf` |
| Split across 1+ PDFs / `CustomGroups` | `splitMultiPdfFiles(jobId, inputs, stems, outputDir, rule, onEvent)` | `pdf_split_multi` → `knit_pdf::split_multi_pdf` |
| Read raw PDF bytes in WebView | `readPdfFileBytes(path)` | `read_pdf_file_bytes` → `tauri::ipc::Response` |
| Cancel running Merge / Split job | `cancelActiveJob(jobId)` | `cancel_job` → `CancellationToken::cancel()` |

> **Deprecated API notice:** `renderPdfThumbBase64` (`render_pdf_thumb` returning a Base64 PNG string) is **deprecated for virtualized grids**. Use `renderPdfThumbFile` + `convertFileSrc(path)`.

---

## Configuration, Rules & Bounds Reference

### `PdfMergeConfig`

| Field | Type / Values | Default | Behavior & Constraints |
|---|---|---|---|
| `inputs` | `string[]` (`PathBuf[]`) | *(required)* | Must contain `>= 1` existing `.pdf` file path. |
| `selected_pages` | `PageSelection[] \| null` | `null` | When `null` or empty, merges all pages of `inputs` sequentially with `rotation_deg = 0`. When provided, each item specifies `{ file_index, page_index, rotation_deg }` (0-based indices; `rotation_deg` normalized mod 360). |
| `output_path` | `string` (`PathBuf`) | *(required)* | Target merged `.pdf` path written atomically via `.tmp -> rename`. |
| `preserve_bookmarks` | `boolean` | `true` | Writes `/Outlines` if `true`; omits bookmarks if `false`. |
| `custom_bookmarks` | `BookmarkNode[] \| null` | `null` | Overrides automatic `remap_bookmarks_for_selection` when `preserve_bookmarks == true`. |

### `PdfSplitRule` Variants (`rule` discriminator)

| `rule` Tag | Parameters | Output Filenames | Behavior & Constraints |
|---|---|---|---|
| `"page_ranges"` | `ranges: string` | `<stem>_extracted.pdf` | 1-based inclusive ranges (e.g. `"1-5, 8, 12-10"` supports reverse order). |
| `"every_n_pages"` | `n: integer` (`>= 1`) | `<stem>_part01.pdf`, `<stem>_part02.pdf`, ... | Step clamped via `(*n).max(1)`. |
| `"extract_selected"` | `page_indices: integer[]` | `<stem>_selected.pdf` | 0-based page indices; rejects empty array or `idx >= total_pages`. |
| `"max_bytes"` | `max_mb: number` (`> 0.0`) | `<stem>_part01.pdf`, `<stem>_part02.pdf`, ... | Binary-searches max contiguous page count per part within `max_mb * 1024 * 1024` bytes. |
| `"custom_groups"` | `groups: { name: string, pages: PageSelection[] }[]` | `<sanitized_name>.pdf` (`_2`, `_3` on duplicate names) | Supports cross-file `PageSelection`s in `split_multi_pdf`; empty sections are skipped; all sections empty returns error. |

---

## Exact Error String Mapping

| Exact Error Substring / Pattern | Source | Cause | Fix & Verification |
|---|---|---|---|
| `Can it nhat 1 file PDF de gop` | `crates/knit-pdf/src/ops.rs` (`merge_pdfs`) | Empty `config.inputs` array passed to `merge_pdfs`. | Supply `>= 1` valid PDF path in `inputs`. |
| `Can it nhat 1 file PDF` | `crates/knit-pdf/src/ops.rs` (`split_multi_pdf`) | Empty `inputs` slice passed to `split_multi_pdf`. | Supply `>= 1` valid PDF path in `inputs`. |
| `file_index <n> khong hop le` | `crates/knit-pdf/src/ops.rs` (`merge_pdfs` / `split_multi_pdf`) | `PageSelection.file_index >= inputs.len()`. | Keep `0 <= file_index < inputs.len()`. |
| `page_index <p> khong ton tai trong file <f>` | `crates/knit-pdf/src/ops.rs` (`merge_pdfs`) | `PageSelection.page_index >= doc_pages.len()`. | Inspect PDF first with `pdf_inspect` to bound `0 <= page_index < page_count`. |
| `No pages selected to merge` | `crates/knit-pdf/src/ops.rs` (`merge_pdfs`) | Every input PDF had 0 pages or yielded 0 selected occurrences. | Ensure selected PDFs contain `>= 1` page. |
| `Failed to open PDF: <err>` / `Failed to load PDF <path>: <err>` | `crates/knit-pdf/src/ops.rs` | Corrupted, truncated, or encrypted/unreadable PDF stream. | Verify PDF readability via `pdf_inspect(path)` before queueing merge/split. |
| `PDF is empty (0 pages)` / `PDF khong co trang nao` | `crates/knit-pdf/src/ops.rs` (`split_pdf` / `parse_page_ranges`) | Source PDF has 0 `/Pages` entries. | Reject 0-page PDFs before splitting. |
| `So trang khong hop le: '<token>'` / `So trang <v> nam ngoai pham vi 1..=<total>` | `crates/knit-pdf/src/ops.rs` (`parse_page_ranges`) | Invalid range syntax, `0`, or page number `> total_pages`. | Validate 1-based range tokens against `PdfInfo.page_count`. |
| `Chua chon trang nao de trich xuat` | `crates/knit-pdf/src/ops.rs` (`split_pdf`) | `ExtractSelected` received an empty `page_indices` array. | Pass `>= 1` valid 0-based page index. |
| `max_mb phai lon hon 0` | `crates/knit-pdf/src/ops.rs` (`split_pdf`) | `MaxBytes` received `max_mb <= 0.0`. | Enforce `max_mb > 0.0`. |
| `Chua co trang nao trong cac section dau ra` | `crates/knit-pdf/src/ops.rs` (`split_pdf` / `split_multi_pdf`) | `CustomGroups` had no non-empty sections. | Ensure at least one `PdfSplitGroup` has `pages.length >= 1`. |
| `Job cancelled by user` | `crates/knit-core/src/error.rs` (`KnitError::Cancelled`) | `cancel_job(jobId)` aborted active operation. | Check `isJobCancelledError(msg)`; `TempFilesGuard` cleans `.tmp` automatically. |
