---
title: Knit renamer Agent Integration & API Reference
description: Self-contained Tauri v2 IPC and pure-Rust knit-renamer integration guide for dry-run filtering, Perl Prename / FixedPresets / FindReplace transformations, collision recomputation, bottom-up batch renaming, user presets, and undo rollback.
version: 0.2.0
crates: [knit-renamer, knit-core, knit-desktop]
ipc_commands:
  - renamer_preview
  - renamer_recompute_collisions
  - renamer_apply
  - renamer_undo_last
  - renamer_has_undo
  - renamer_list_presets
  - renamer_save_preset
  - renamer_delete_preset
schema: docs/specs/renamer.schema.json
architecture: docs/tools/renamer/renamer-architecture.md
deprecated: false
---

> Index: [`/llms.txt`](../../../llms.txt) · Machine-readable contract: [`docs/specs/renamer.schema.json`](../../specs/renamer.schema.json) · Architecture & Mermaid diagram: [`docs/tools/renamer/renamer-architecture.md`](./renamer-architecture.md)

# Knit `renamer` — Agent Integration & API Reference (`v0.2.0`)

Preview, filter, detect collisions, apply bottom-up batch renames, manage user presets, and undo the last batch rename using either:
1. **Frontend Tauri IPC wrappers** in `src/lib/ipc.ts`, or
2. **Pure-Rust library calls** in `crates/knit-renamer`.

---

## Quickstart: End-to-End Working Calls

### Path A: TypeScript / Tauri WebView (`@tauri-apps/api@^2.5.0`)

```ts
import {
  applyBatchRename,
  hasRenameUndo,
  isTauriRuntime,
  previewBatchRename,
  recomputeRenameCollisions,
  undoLastRename,
} from "../lib/ipc";
import type { RenameExecutionResult, RenameRule, ScanFilter } from "../types/ipc";

export async function previewAndApplyRename(
  roots: string[],
): Promise<RenameExecutionResult> {
  if (!isTauriRuntime()) {
    throw new Error("Tauri IPC is only available inside the Knit desktop window.");
  }

  const filter: ScanFilter = {
    target_type: "files",
    recursive: true,
    max_depth: null,
    ignore_hidden: true,
    include_extensions: ["jpg", "png"],
    include_patterns: [],
    exclude_patterns: [{ kind: "glob", pattern: "*_thumb*" }],
  };

  const rule: RenameRule = {
    mode: "perl_prename",
    expression: String.raw`s/\s+/_/g; s/\.jpeg$/.jpg/i`,
  };

  // 1. Dry-run preview (cached by roots+filter in AppState)
  let plan = await previewBatchRename(roots, filter, rule);

  // 2. Optionally uncheck item 0 and recompute case-insensitive collisions
  if (plan.items.length > 0) {
    plan.items[0].selected = false;
    plan = await recomputeRenameCollisions(plan);
  }

  const conflicts = plan.items.filter((i) => i.selected && i.status === "conflict");
  if (conflicts.length > 0) {
    throw new Error(`Resolve ${conflicts.length} naming conflicts before applying.`);
  }

  // 3. Apply Bottom-Up rename & persist UndoManifest
  const jobId = crypto.randomUUID();
  const result = await applyBatchRename(jobId, plan, (ev) => {
    if (ev.kind === "log") console.log(ev.level, ev.message);
  });

  console.log(`Renamed ${result.renamed_count}, undo available: ${await hasRenameUndo()}`);
  return result;
}

export async function rollbackLastRename(): Promise<RenameExecutionResult> {
  return await undoLastRename();
}
```

### Path B: Pure-Rust Core Crate (`knit-renamer = 0.2.0`, `knit-core = 0.1.0`)

```rust
use knit_core::NoopReporter;
use knit_renamer::{
    apply_rename_plan, build_rename_plan, compile_rule, scan_items, undo_manifest,
    FixedPreset, RenameExecutionResult, RenameRule, ScanFilter, TargetType,
};
use std::path::{Path, PathBuf};

pub fn normalize_manga_chapters(
    root: &Path,
    undo_manifest_path: &PathBuf,
) -> knit_core::Result<RenameExecutionResult> {
    let filter = ScanFilter {
        target_type: TargetType::Folders,
        recursive: false,
        ..Default::default()
    };
    let items = scan_items(root, &filter)?;
    let transform = compile_rule(&RenameRule::FixedPreset {
        preset: FixedPreset::MangaChapter,
    })?;
    let mut plan = build_rename_plan(items, transform);
    let res = apply_rename_plan(&mut plan, Some(undo_manifest_path), &NoopReporter)?;

    // Roll back later if needed:
    // let restored = undo_manifest(undo_manifest_path, &NoopReporter)?;
    Ok(res)
}
```

---

## Programmatic Equivalents for UI Actions

| UI Action in `RenamerView` | Programmatic IPC Call (`src/lib/ipc.ts`) | Rust Backend Implementation |
|---|---|---|
| Scan roots + compute Dry-Run table | `previewBatchRename(roots, filter, rule)` | `renamer_preview` → `scan_items` + `compile_rule` + `build_rename_plan` |
| Toggle row `selected` checkbox | `recomputeRenameCollisions(plan)` | `renamer_recompute_collisions` → `knit_renamer::recompute_collisions` |
| Execute Bottom-Up rename | `applyBatchRename(jobId, plan, onEvent)` | `renamer_apply` → `knit_renamer::apply_rename_plan` |
| Undo last rename batch | `undoLastRename()` / `hasRenameUndo()` | `renamer_undo_last` / `renamer_has_undo` → `undo_manifest` |
| Load / Save / Delete User Presets | `listRenamePresets()` / `saveRenamePreset(p)` / `deleteRenamePreset(id)` | `renamer_list_presets` / `renamer_save_preset` / `renamer_delete_preset` |

---

## Reference: `FixedPresetKind` & `PrenameEngine`

### 10 Built-in `FixedPresetKind` Values

| `preset` | Behavior | Example |
|---|---|---|
| `"manga_chapter"` | Normalizes chapter prefix + 2-digit zero-padded number (preserving decimals) | `"Chương 5 Extra"` → `"chapter 05 Extra"` |
| `"manga_volume"` | Normalizes volume/tập prefix + 2-digit zero-padded number | `"Vol. 3"` → `"volume 03"` |
| `"pad2"` / `"pad3"` | Zero-pads all numeric tokens to width `2` or `3` | `"page 7.5"` (`pad2`) → `"page 07.5"` |
| `"clean_tags"` | Strips `[...]`, `(...)`, `{...}` and collapses whitespace (falls back if result empty) | `"[Group] Title (v2)"` → `"Title"` |
| `"clean_whitespace"` | Replaces `_` with space and collapses whitespace | `"my__file  name"` → `"my file name"` |
| `"normalize_extensions"` | Normalizes `.jpeg/.jpe/.jfif/.JPG` → `.jpg`, `.PNG` → `.png`, `.TIFF` → `.tif`, etc. | `"scan.JPEG"` → `"scan.jpg"` |
| `"lowercase"` / `"uppercase"` / `"titlecase"` | Unicode case transformations | `"my file"` (`titlecase`) → `"My File"` |

### `PrenameEngine` Syntax (`RenameRule.mode === "perl_prename"`)

- Chain commands with `;` (escape literal `;` as `\;`).
- Allowed delimiters (10): `/`, `|`, `#`, `,`, `;`, `:`, `!`, `~`, `_`, `@`.
- Substitution: `s<d>pattern<d>replace<d>[igm s x a]` (`$1` and `\1` backreferences supported).
- Transliteration: `y<d>from<d>to<d>[d]` or `tr<d>from<d>to<d>[d]` (`a-z` ranges; `d` deletes unmapped chars).

---

## Exact Error String Mapping

| Exact Error Substring / Pattern | Source | Cause | Fix & Verification |
|---|---|---|---|
| `Path not found: <path>` | `crates/knit-renamer/src/scanner.rs` (`scan_items`) | A path in `roots` does not exist on disk. | Verify all root directories/files exist before previewing. |
| `Glob không hợp lệ '<pat>': <err>` | `crates/knit-renamer/src/scanner.rs` (`compile_patterns`) | Invalid glob syntax in `include_patterns` / `exclude_patterns`. | Fix glob bracket/escape syntax. |
| `Regex không hợp lệ: <err>` | `crates/knit-renamer/src/scanner.rs` / `engine.rs` | Invalid regex pattern in filter, `find_replace`, or `s///`. | Validate regex pattern before applying. |
| `Cú pháp prename không hợp lệ: '<expr>'...` | `crates/knit-renamer/src/engine.rs` | Missing delimiter/segments or unknown operator in `PerlPrename`. | Use `s/pat/repl/flags` or `y/from/to/flags`. |
| `Còn <n> xung đột tên chưa xử lý` | `crates/knit-renamer/src/renamer.rs` (`apply_rename_plan`) | Selected items have `status == "conflict"`. | Uncheck conflicting items or adjust rule, then call `renamer_recompute_collisions`. |
| `No rename history found to undo` | `crates/knit-renamer/src/renamer.rs` (`undo_manifest`) | `undo_manifest_path` missing on disk. | Check `hasRenameUndo()` before calling `undoLastRename()`. |
| `Lỗi đọc presets JSON: <err>` | `crates/knit-renamer/src/presets.rs` | Corrupt `renamer_presets.json` in OS config directory. | Fix or remove corrupt `renamer_presets.json`. |
