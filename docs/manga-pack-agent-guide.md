---
title: Knit manga-pack Agent Integration & API Reference
description: Self-contained Tauri v2 IPC and pure-Rust knit-manga integration guide for scanning manga folder trees, inspecting warnings/metadata, and packing ZIP/CBZ volumes with optional Mangament stories.csv generation.
version: 0.2.0
crates: [knit-manga, knit-archive, knit-core, knit-desktop]
ipc_commands:
  - manga_scan
  - manga_pack
  - cancel_job
schema: docs/specs/manga-pack.schema.json
architecture: docs/manga-pack-architecture.md
deprecated: false
---

> Index: [`/llms.txt`](../llms.txt) · Machine-readable contract: [`docs/specs/manga-pack.schema.json`](./specs/manga-pack.schema.json) · Architecture & Mermaid diagram: [`docs/manga-pack-architecture.md`](./manga-pack-architecture.md)

# Knit `manga-pack` — Agent Integration & API Reference (`v0.2.0`)

Scan single-story or multi-story manga folders (parsing `Volume` / `Arc` / `Chapter`, `cover.*`, `info.json`, and Unicode NFC names) and pack them into `.zip` or `.cbz` archives (with optional `max_gb` whole-story splitting and `MangamentPackageMode` `stories.csv` generation) using either:
1. **Frontend Tauri IPC wrappers** in `src/lib/ipc.ts`, or
2. **Pure-Rust library calls** in `crates/knit-manga`.

---

## Quickstart: End-to-End Working Calls

### Path A: TypeScript / Tauri WebView (`@tauri-apps/api@^2.5.0`)

```ts
import {
  cancelActiveJob,
  isJobCancelledError,
  isTauriRuntime,
  packMangaStories,
  scanMangaFolder,
} from "../lib/ipc";
import type { MangaPackOptions, MangaPackSummary } from "../types/ipc";

export async function scanAndPackLibrary(
  libraryRoot: string,
  outputDir: string,
): Promise<MangaPackSummary> {
  if (!isTauriRuntime()) {
    throw new Error("Tauri IPC is only available inside the Knit desktop window.");
  }

  // 1. Scan single story or library (auto-detected)
  const stories = await scanMangaFolder(libraryRoot, "auto");
  if (stories.length === 0) {
    throw new Error("No manga stories found.");
  }
  for (const s of stories) {
    if (s.warnings.length > 0) {
      console.warn(`[${s.dir_name}] warnings:`, s.warnings);
    }
  }

  // 2. Pack into ZIP/CBZ with Store image compression and stories.csv
  const jobId = crypto.randomUUID();
  const options: MangaPackOptions = {
    mangament_package_mode: true,
    image_compression: 0, // Store (recommended for JPEG/PNG/WebP/AVIF)
    max_gb: 2.0,          // Split whole stories across _part01.zip, _part02.zip...
  };

  try {
    return await packMangaStories(
      jobId,
      stories,
      outputDir,
      options,
      (ev) => {
        if (ev.kind === "progress") console.log(ev.data.done, ev.data.total);
      },
      "manga_bundle.zip",
    );
  } catch (err) {
    if (isJobCancelledError(String(err))) {
      await cancelActiveJob(jobId).catch(() => {});
    }
    throw err;
  }
}
```

### Path B: Pure-Rust Core Crate (`knit-manga = 0.2.0`, `knit-core = 0.1.0`)

```rust
use knit_core::{CancellationToken, NoopReporter};
use knit_manga::{pack_stories, scan_stories, MangaPackOptions, MangaPackSummary, MangaScanMode};
use std::path::Path;

pub fn pack_single_story(
    story_dir: &Path,
    output_cbz: &Path,
) -> knit_core::Result<MangaPackSummary> {
    let stories = scan_stories(
        story_dir,
        MangaScanMode::Auto,
        None,  // story_filter
        0,     // limit (0 = unlimited)
        None,  // chapter_limit
        true,  // collapse_dupes
        &NoopReporter,
    )?;

    let options = MangaPackOptions {
        mangament_package_mode: false,
        image_compression: 0,
        max_gb: 0.0,
    };
    let cancel = CancellationToken::new();
    pack_stories(&stories, output_cbz, &options, &cancel, &NoopReporter)
}
```

---

## Programmatic Equivalents for UI Actions

| UI Action in `MangaPackView` | Programmatic IPC Call (`src/lib/ipc.ts`) | Rust Backend Implementation |
|---|---|---|
| Scan story or library folder | `scanMangaFolder(root, mode)` | `manga_scan` → `knit_manga::scan_stories(..., collapse_dupes=true)` |
| Edit/save `info.json` in `MangaInfoModal` | `readDocTextFile(infoPath)` / `writeDocTextFile(infoPath, json)` | `docs_read_text_file` / `docs_write_text_file` |
| Estimate packed `.zip`/`.cbz` output size | `estimateMangaPackOutput(stories, options)` (`src/lib/sizeEstimate.ts`) | Pure-JS estimation from `Story.total_bytes` |
| Pack stories into `.zip` / `.cbz` | `packMangaStories(jobId, stories, outputDir, options, onEvent, outputName)` | `manga_pack` → `knit_manga::pack_stories` |
| Cancel running pack job | `cancelActiveJob(jobId)` | `cancel_job` → `CancellationToken::cancel()` (cleans partial parts) |

---

## Configuration, Models & Bounds Reference

### `MangaScanMode` & `MangaPackOptions`

| Field / Variant | Type / Values | Default | Behavior & Constraints |
|---|---|---|---|
| `mode` (`MangaScanMode`) | `"auto"` \| `"single"` \| `"library"` | `"auto"` | `"auto"` uses `looks_like_single_story` (`info.json`/images at root, or `>= 50%` node-named subdirs). |
| `mangament_package_mode` | `boolean` | `false` | When `true`, writes RFC 4180 `stories.csv` (right-aligned `NODE_HEADERS * max_depth`) into every generated ZIP part alongside `info.json`. |
| `image_compression` | `integer` (`0..=9`) | `0` | `0` = `Store` (no recompression); `1..=3` = `Fast`; `4..=6` = `Normal`; `7..=9` = `Best`. |
| `max_gb` | `number` (`>= 0.0`) | `0.0` | `<= 0.0` produces 1 archive. `> 0.0` groups **whole stories** up to `max_gb * 2^30` bytes into `_part01`, `_part02`, ... (never splits 1 story across 2 parts). |
| `outputName` (IPC `manga_pack`) | `string \| null` | `null` | Trimmed & sanitized (`sanitize_filename(..., 140)`); appends `.zip` unless ending in `.zip` or `.cbz`; falls back to `<dir_name>.zip` (1 story) or `manga_batch.zip` (multi). |

### Folder Name Patterns (`parse_node_folder_name`)

- **Volume:** `volume`, `vol`, `tập`, `tap` + number (e.g., `Vol.2`, `Tập 1.5`)
- **Arc:** `arc`, `hồi`, `hoi` + number (e.g., `Arc 3`)
- **Chapter:** `chapter`, `chap`, `ch`, `c`, `chương`, `chuong`, or bare numeric folder (`05`, `12.5`)
- **Cover priority (`find_cover`):** `cover_art.*` > `cover.*` > `poster.*` (`jpg/jpeg/png/webp/avif`) at story root, or `info.json` `"cover_art"` verified via `safe_join_within`.

---

## Exact Error String Mapping

| Exact Error Substring / Pattern | Source | Cause | Fix & Verification |
|---|---|---|---|
| `Path not found: <path>` | `crates/knit-manga/src/scanner.rs` (`scan_stories`) | `root` is missing or not a directory. | Verify directory exists on disk before calling `manga_scan`. |
| `Không có truyện nào để đóng gói` | `crates/knit-manga/src/packer.rs` (`pack_stories`) | Empty `stories` slice passed to `pack_stories`. | Ensure `stories.length >= 1` after scanning. |
| `InvalidPath` (via `safe_join_within`) | `crates/knit-core/src/fs.rs` | `info.json` `"cover_art"` attempts path traversal (`../` or absolute path). | Ignored safely by `find_cover` during scan; keep `cover_art` relative inside story dir. |
| `Job cancelled by user` | `crates/knit-core/src/job.rs` | `cancel_job` aborted packing; all already-created parts in that batch are removed. | Handle via `isJobCancelledError(msg)`. |
