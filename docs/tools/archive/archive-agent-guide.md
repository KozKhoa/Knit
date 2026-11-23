---
title: Knit archive Agent Integration & API Reference
description: Self-contained Tauri v2 IPC and pure-Rust knit-archive integration guide for scanning inputs, customizing archive entry trees, estimating output bytes, and packing ZIP (AES-256 / ZipCrypto) or TAR/GZ/ZST archives.
version: 0.2.0
crates: [knit-archive, knit-core, knit-desktop]
ipc_commands:
  - archive_collect_entries
  - archive_estimate_size
  - archive_pack
  - get_file_size_bytes
  - cancel_job
schema: docs/specs/archive.schema.json
architecture: docs/tools/archive/archive-architecture.md
deprecated: false
---

> Index: [`/llms.txt`](../../../llms.txt) · Machine-readable contract: [`docs/specs/archive.schema.json`](../../specs/archive.schema.json) · Architecture & Mermaid diagram: [`docs/tools/archive/archive-architecture.md`](./archive-architecture.md)

# Knit `archive` — Agent Integration & API Reference (`v0.2.0`)

Pack files and folders into `.zip` (with optional **AES-256** or **ZipCrypto** password encryption), `.tar`, `.tar.gz`, or `.tar.zst` using either:
1. **Frontend Tauri IPC wrappers** in `src/lib/ipc.ts`, or
2. **Pure-Rust library calls** in `crates/knit-archive`.

---

## Quickstart: End-to-End Working Calls

### Path A: TypeScript / Tauri WebView (`@tauri-apps/api@^2.5.0`)

```ts
import {
  cancelActiveJob,
  collectArchiveEntries,
  createArchive,
  estimateArchiveSize,
  isJobCancelledError,
  isTauriRuntime,
} from "../lib/ipc";
import type { ArchiveOptions, ArchiveSummary } from "../types/ipc";

export async function packEncryptedZip(
  inputPaths: string[],
  outputZipPath: string,
  password: string,
): Promise<ArchiveSummary> {
  if (!isTauriRuntime()) {
    throw new Error("Tauri IPC is only available inside the Knit desktop window.");
  }

  const options: ArchiveOptions = {
    format: "zip",
    compression: "normal",
    encryption: { kind: "aes256", password },
  };

  // 1. Collect POSIX archive entries & estimate output bytes without reading payloads
  const entries = await collectArchiveEntries(inputPaths, true, true);
  const estimate = await estimateArchiveSize(inputPaths, true, true, options, entries);
  console.log(`Estimated archive size: ${estimate.estimated_output_bytes} bytes (${estimate.files_count} files)`);

  // 2. Pack atomically with optional custom entries
  const jobId = crypto.randomUUID();
  try {
    return await createArchive(
      jobId,
      inputPaths,
      outputZipPath,
      true,
      true,
      options,
      (ev) => {
        if (ev.kind === "progress") {
          console.log(`${ev.data.phase}: ${ev.data.done}/${ev.data.total}`);
        }
      },
      entries,
    );
  } catch (err) {
    if (isJobCancelledError(String(err))) {
      await cancelActiveJob(jobId).catch(() => {});
    }
    throw err;
  }
}
```

### Path B: Pure-Rust Core Crate (`knit-archive = 0.2.0`, `knit-core = 0.1.0`)

```rust
use knit_archive::{
    collect_entries, estimate_archive_entries, pack_entries, ArchiveFormat, ArchiveOptions,
    ArchiveSummary, CompressionLevel, ZipEncryption,
};
use knit_core::{CancellationToken, NoopReporter};
use std::path::{Path, PathBuf};

pub fn pack_folder_to_tar_zst(
    folder: &Path,
    output_tar_zst: &Path,
) -> knit_core::Result<ArchiveSummary> {
    let inputs = vec![folder.to_path_buf()];
    let entries = collect_entries(&inputs, true, true)?;
    let options = ArchiveOptions {
        format: ArchiveFormat::TarZst,
        compression: CompressionLevel::Normal,
        encryption: ZipEncryption::None,
    };
    let est = estimate_archive_entries(&entries, &options);
    println!("Estimated {} files -> {} bytes", est.files_count, est.estimated_output_bytes);

    let cancel = CancellationToken::new();
    pack_entries(&entries, output_tar_zst, &options, &cancel, &NoopReporter)
}
```

---

## Programmatic Equivalents for UI Actions

| UI Action in `ArchiveView` | Programmatic IPC Call (`src/lib/ipc.ts`) | Rust Backend Implementation |
|---|---|---|
| Add files/folders to `ArchiveTreeEditor` | `collectArchiveEntries(inputs, includeRootDir, ignoreHidden)` | `archive_collect_entries` → `knit_archive::collect_entries` |
| Compute live `~size` output estimate | `estimateArchiveSize(inputs, includeRootDir, ignoreHidden, options, customEntries)` | `archive_estimate_size` → `estimate_archive_entries` / `estimate_archive_output` |
| Create ZIP / TAR / TAR.GZ / TAR.ZST | `createArchive(jobId, inputs, outputPath, includeRootDir, ignoreHidden, options, onEvent, customEntries)` | `archive_pack` → `knit_archive::pack_entries` |
| Cancel running compression job | `cancelActiveJob(jobId)` | `cancel_job` → `CancellationToken::cancel()` |

---

## Configuration & Options Reference

| Field / Type | Values | Default | Behavior & Constraints |
|---|---|---|---|
| `format` (`ArchiveFormat`) | `"zip"` \| `"tar"` \| `"tar_gz"` \| `"tar_zst"` | `"zip"` | Only `"zip"` supports `encryption` (`aes256` / `zip_crypto`). |
| `compression` (`CompressionLevel`) | `"store"` \| `"fast"` \| `"normal"` \| `"best"` | `"normal"` | ZIP: Stored / Deflate 1 / 6 / 9; TarGz: flate2 0 / fast / default / best; TarZst: level 1 / 1 / 3 / 15. |
| `encryption` (`ZipEncryption`) | `{ kind: "none" }` \| `{ kind: "aes256", password }` \| `{ kind: "zip_crypto", password }` | `{ kind: "none" }` | Password must be non-empty when `kind != "none"`. |
| `includeRootDir` | `boolean` | `true` | Prepends folder basename to `archive_path` when walking directories. |
| `ignoreHidden` | `boolean` | `true` | Skips entries whose filename or relative path component starts with `.`. |
| `customEntries` | `ArchiveEntrySpec[] \| null` | `null` | When provided, bypasses re-walking inputs and supports per-file `compression_override`. |

---

## Exact Error String Mapping

| Exact Error Substring / Pattern | Source | Cause | Fix & Verification |
|---|---|---|---|
| `Chưa chọn file hoặc thư mục nào để nén` | `crates/knit-archive/src/lib.rs` (`collect_entries`) | Empty `inputs` array. | Pass `>= 1` existing file or directory path. |
| `Path not found: <path>` | `crates/knit-archive/src/lib.rs` (`collect_entries`) | Input path does not exist on disk. | Verify all `inputs` exist before scanning. |
| `Không tìm thấy tệp hợp lệ nào để nén` | `crates/knit-archive/src/lib.rs` (`collect_entries`) | Directories contained only empty folders or hidden files (`ignoreHidden=true`). | Check input contents or disable `ignoreHidden`. |
| `Danh sách tệp cần nén đang rỗng` | `crates/knit-archive/src/lib.rs` (`pack_entries`) | Empty `entries` / `customEntries` passed to `pack_entries`. | Ensure at least 1 `ArchiveEntrySpec` exists. |
| `Chỉ định dạng ZIP mới hỗ trợ đặt mật khẩu` | `crates/knit-archive/src/lib.rs` (`pack_entries`) | `encryption.kind != "none"` with `format` set to `tar`, `tar_gz`, or `tar_zst`. | Set `encryption: { kind: "none" }` for TAR formats or use `format: "zip"`. |
| `Mật khẩu ZIP không được để trống` | `crates/knit-archive/src/lib.rs` (`build_zip_options`) | Empty `""` password string for `aes256` or `zip_crypto`. | Require non-empty password string. |
| `Insufficient disk space: need ~<needed>, available <available>` | `crates/knit-core/src/fs.rs` (`ensure_disk_space`) | Target drive free bytes `< total + total/50 + 1 MiB`. | Free disk space or target another volume. |
| `Job cancelled by user` | `crates/knit-core/src/job.rs` (`CancellationToken::check`) | `cancel_job` stopped streaming loop. | Partial `.knit_tmp.*` file is removed automatically. |
